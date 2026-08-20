import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { sendEmail, isEmailConfigured } from "../lib/email-sender";
import { logger } from "../lib/logger";

/**
 * Free-trial conversion reminders.
 *
 * This worker exists because of what the card-free trial gave up. Under the old
 * flow a card was captured at signup and PayFast charged it on day 14 — the
 * trial converted itself, and a reminder was a courtesy nobody depended on.
 *
 * Now nothing converts on its own. A trial that runs out while its owner is not
 * looking is simply a customer lost in silence, which makes these two emails
 * part of the revenue path rather than a nicety.
 *
 * Two sends, deliberately few:
 *   'three_days' — enough runway to actually decide.
 *   'final'      — the last working day, when the loss is concrete.
 *
 * Anything more is nagging a customer who has already made up their mind.
 *
 * Neither lands on a weekend. A booking business is at its busiest on Saturday
 * and shut on Sunday, so an email asking someone to sit down and think about
 * billing is worst-timed exactly then. A weekend send date is pulled BACK to the
 * Friday before, never pushed forward — the trial ends when it ends, and a
 * reminder that arrives after the deadline is not a reminder.
 */

/** Days remaining at which the first reminder is aimed, before weekend shifting. */
const FIRST_REMINDER_DAYS = 3;

/**
 * How wide a net to cast when querying. A Sunday deadline pulls the final
 * reminder back two days and the first one back as far as five, so the query
 * has to see trials further out than the nominal windows suggest.
 */
const LOOKAHEAD_DAYS = FIRST_REMINDER_DAYS + 3;

/**
 * SAST is a fixed UTC+2 with no daylight saving, so "which day is it for the
 * customer" is an offset rather than a timezone library. Same approach as
 * daily-summary.ts.
 */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day of week in SAST: 0 = Sunday, 6 = Saturday. */
function sastDayOfWeek(date: Date): number {
  return new Date(date.getTime() + SAST_OFFSET_MS).getUTCDay();
}

/**
 * Moves a send date off a weekend, backwards onto the preceding Friday.
 *
 * Backwards is the whole point. Pushing a Saturday reminder to Monday would,
 * for a trial ending Sunday, deliver it after the account had already locked.
 */
function avoidWeekend(date: Date): Date {
  const day = sastDayOfWeek(date);
  if (day === 6) return new Date(date.getTime() - DAY_MS); // Saturday → Friday
  if (day === 0) return new Date(date.getTime() - 2 * DAY_MS); // Sunday → Friday
  return date;
}

/**
 * When each reminder should actually go out for a trial ending at `endsAt`.
 *
 * `three_days` is null when the weekend shift has collapsed it into the final
 * reminder — a trial ending Sunday would otherwise mail on Thursday and again
 * on Friday, which reads as pestering rather than reminding.
 */
function scheduleFor(endsAt: Date): { three_days: Date | null; final: Date } {
  const final = avoidWeekend(endsAt);
  const first = avoidWeekend(new Date(endsAt.getTime() - FIRST_REMINDER_DAYS * DAY_MS));

  // Same day or later than the final send — one email is enough.
  return {
    three_days: first.getTime() < final.getTime() - DAY_MS / 2 ? first : null,
    final,
  };
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

type ReminderKind = "three_days" | "final";

type TrialRow = {
  id: string;
  business_id: string | null;
  user_id: string | null;
  current_period_end: string | null;
};

function billingUrl(): string {
  const base = (
    process.env["APP_BASE_URL"]?.trim() ||
    process.env["APP_PUBLIC_URL"]?.trim() ||
    "https://qwickly.co.za"
  ).replace(/\/+$/, "");
  return `${base}/billing`;
}

/**
 * Whole days from now until the trial ends, rounded up: a trial ending in six
 * hours has "1 day left", not zero. Returns 0 or less once it has run out.
 */
function daysRemaining(periodEnd: string): number {
  const ms = new Date(periodEnd).getTime() - Date.now();
  if (!Number.isFinite(ms)) return Number.NaN;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Which reminder, if any, is due for this trial right now.
 *
 * The final one wins when both are due — that happens when a trial was created
 * inside the first reminder's window, and the more urgent message is the one
 * worth sending.
 */
function dueReminder(endsAt: Date): ReminderKind | null {
  // Already over. The sweep in subscription-charger.ts handles those, and "your
  // trial ends soon" about a trial that ended yesterday is worse than silence.
  if (endsAt.getTime() <= Date.now()) return null;

  const schedule = scheduleFor(endsAt);
  const now = Date.now();

  if (now >= schedule.final.getTime()) return "final";
  if (schedule.three_days && now >= schedule.three_days.getTime()) return "three_days";
  return null;
}

function buildMessage(
  kind: ReminderKind,
  businessName: string,
  daysLeft: number,
): { subject: string; text: string } {
  const name = businessName.trim() || "your business";
  const url = billingUrl();

  if (kind === "final") {
    // The weekend shift can send this up to two days early, so neither the
    // subject nor the first line can assume "today".
    const whenSubject = daysLeft <= 1 ? "ends today" : `ends in ${daysLeft} days`;
    const whenBody = daysLeft <= 1 ? "ends today" : `ends in ${daysLeft} days`;

    return {
      subject: `Your Qwickly trial ${whenSubject}`,
      text:
        `Your free trial for ${name} ${whenBody}.\n\n` +
        `When it does, your dashboard locks until you choose a plan — but nothing is deleted. ` +
        `Your bookings, clients, services and settings stay exactly as they are, and your booking page ` +
        `stays live so customers can keep booking.\n\n` +
        `Keep everything running for R129/month: ${url}\n\n` +
        `If Qwickly isn't right for you, you don't need to do anything at all. There's no card on file ` +
        `and nothing will be charged.`,
    };
  }

  return {
    subject: `${daysLeft} days left on your Qwickly trial`,
    text:
      `Your free trial for ${name} has ${daysLeft} days to run.\n\n` +
      `If you'd like to keep going, you can choose a plan any time before it ends — and you'll keep ` +
      `every free day you have left. We won't charge you until the trial is over.\n\n` +
      `Choose a plan: ${url}\n\n` +
      `Nothing to cancel if you'd rather not continue. There's no card on file.`,
  };
}

/** The address to reach the owner on: the business's, else the account's. */
async function resolveOwnerEmail(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  businessId: string | null,
  userId: string | null,
): Promise<{ email: string; businessName: string } | null> {
  let businessName = "";

  if (businessId) {
    const { data: business } = await supabase
      .from("businesses")
      .select("email, business_name")
      .eq("id", businessId)
      .maybeSingle();

    businessName = (business?.business_name as string | null) ?? "";
    const businessEmail = ((business?.email as string | null) ?? "").trim();
    if (businessEmail) return { email: businessEmail, businessName };
  }

  // businesses.email defaults to an empty string and onboarding never forces it,
  // so falling back to the login address is the common path, not the edge case.
  if (userId) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    const authEmail = data?.user?.email?.trim();
    if (!error && authEmail) return { email: authEmail, businessName };
  }

  return null;
}

export async function sendTrialReminders(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    logger.error("[Trial Reminders] Supabase is not configured");
    return;
  }

  if (!isEmailConfigured()) {
    // Not an error worth shouting about on every tick — the reminder is simply
    // not sendable yet, and nothing has been claimed, so it goes out once the
    // provider is configured.
    logger.debug("[Trial Reminders] Email not configured; skipping");
    return;
  }

  const supabase = getSupabaseAdmin();
  const horizon = new Date(Date.now() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  try {
    const { data: trials, error } = await supabase
      .from("subscriptions")
      .select("id, business_id, user_id, current_period_end")
      .eq("status", "trialing")
      .gt("current_period_end", new Date().toISOString())
      .lte("current_period_end", horizon.toISOString());

    if (error) {
      logger.error({ err: error }, "[Trial Reminders] Error fetching trials");
      return;
    }

    if (!trials || trials.length === 0) return;

    for (const trial of trials as TrialRow[]) {
      if (!trial.current_period_end) continue;

      const endsAt = new Date(trial.current_period_end);
      const kind = dueReminder(endsAt);
      if (!kind) continue;

      const daysLeft = daysRemaining(trial.current_period_end);

      // Claim before sending. The composite primary key on
      // (subscription_id, kind) means two overlapping ticks cannot both decide
      // they are the one sending this reminder — the loser gets a unique
      // violation and does nothing.
      const { error: claimError } = await supabase
        .from("trial_reminder_log")
        .insert({ subscription_id: trial.id, kind });

      if (claimError) {
        // Already sent (or being sent). Not worth logging at error level: this
        // is the expected outcome on every tick after the first.
        continue;
      }

      const owner = await resolveOwnerEmail(supabase, trial.business_id, trial.user_id);

      if (!owner) {
        logger.warn(
          { subscriptionId: trial.id },
          "[Trial Reminders] No address for owner; releasing claim",
        );
        await releaseClaim(supabase, trial.id, kind);
        continue;
      }

      const { subject, text } = buildMessage(kind, owner.businessName, daysLeft);

      try {
        await sendEmail({ to: owner.email, subject, text });
        logger.info(
          { subscriptionId: trial.id, kind, daysLeft },
          "[Trial Reminders] Reminder sent",
        );
      } catch (sendError) {
        // Release the claim so the next tick tries again. Leaving it in place
        // would mean one SendGrid blip silently costs a customer their only
        // warning that the trial is ending.
        logger.error(
          { err: sendError, subscriptionId: trial.id, kind },
          "[Trial Reminders] Send failed; releasing claim for retry",
        );
        await releaseClaim(supabase, trial.id, kind);
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[Trial Reminders] Error processing reminders");
  }
}

async function releaseClaim(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  subscriptionId: string,
  kind: ReminderKind,
): Promise<void> {
  const { error } = await supabase
    .from("trial_reminder_log")
    .delete()
    .eq("subscription_id", subscriptionId)
    .eq("kind", kind);

  if (error) {
    logger.error(
      { err: error, subscriptionId, kind },
      "[Trial Reminders] Failed to release claim; this reminder will not retry",
    );
  }
}

/**
 * Runs the reminder pass at boot and then hourly. Day-level precision is all
 * this needs — the windows are days wide.
 */
export function startTrialReminderWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  void sendTrialReminders();
  setInterval(() => {
    void sendTrialReminders();
  }, intervalMs);
  logger.info({ intervalMs }, "[Trial Reminders] Worker started");
}
