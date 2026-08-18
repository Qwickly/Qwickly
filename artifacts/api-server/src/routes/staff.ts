import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { sendEmail, isEmailConfigured } from "../lib/email-sender";
import { generateTempPassword } from "../lib/password";

/**
 * Staff invite: creates (or resets) a Supabase Auth login for a bookable
 * staff_members row and emails them a one-time temporary password. This is
 * the only server-side mutation for staff — everything else (create/update/
 * archive the staff_members row itself) stays client-side via Supabase RLS,
 * same as email-domains.ts does for its reads/writes.
 */

const router = Router();

async function getBusinessForUser(userId: string): Promise<{ id: string; name: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id, business_name")
    .eq("user_id", userId)
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Business not found");
  }
  return { id: data.id as string, name: (data.business_name as string) || null };
}

function staffLoginUrl(): string {
  const base = (process.env["APP_BASE_URL"] || "").replace(/\/$/, "");
  return `${base}/staff-login`;
}

router.post("/staff/:id/invite", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const admin = getSupabaseAdmin();

    const staffId = req.params.id;
    const { data: staffRow, error: staffError } = await admin
      .from("staff_members")
      .select("id, business_id, name, email")
      .eq("id", staffId)
      .single();

    if (staffError || !staffRow) {
      return res.status(404).json({ error: "Staff member not found" });
    }
    if (staffRow.business_id !== business.id) {
      return res.status(403).json({ error: "Not permitted" });
    }
    const email = (staffRow.email as string | null)?.trim();
    if (!email) {
      return res.status(400).json({ error: "This staff member needs an email address before they can be invited" });
    }

    const tempPassword = generateTempPassword();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: "staff",
        staff_member_id: staffRow.id,
        must_change_password: true,
      },
    });

    let staffUserId: string;
    if (createError) {
      // Email already has an auth account — treat this as a resend/reset of
      // their password rather than a hard failure.
      const alreadyExists = /already.*registered|already.*exists|email_exists/i.test(createError.message);
      if (!alreadyExists) {
        throw new Error(createError.message);
      }
      const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw new Error(listError.message);
      const existingUser = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existingUser) throw new Error("Could not resolve existing account for this email");

      const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
        password: tempPassword,
        user_metadata: {
          ...existingUser.user_metadata,
          role: "staff",
          staff_member_id: staffRow.id,
          must_change_password: true,
        },
      });
      if (updateError) throw new Error(updateError.message);
      staffUserId = existingUser.id;
    } else {
      staffUserId = created.user.id;
    }

    const { error: linkError } = await admin
      .from("staff_members")
      .update({ user_id: staffUserId, invite_status: "invited" })
      .eq("id", staffRow.id);
    if (linkError) throw new Error(linkError.message);

    if (isEmailConfigured()) {
      const loginUrl = staffLoginUrl();
      await sendEmail({
        to: email,
        subject: "You've been added as staff",
        text: `Hi ${staffRow.name},\n\n${business.name ?? "Your business"} has added you as a staff member on Qwickly. You can now log in to view your bookings.\n\nLogin: ${loginUrl}\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou'll be asked to set your own password the first time you log in.`,
        fromName: business.name ?? undefined,
      });
    } else {
      req.log.warn("[staff invite] Email provider not configured — temp password not delivered");
    }

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    const message = err instanceof Error ? err.message : "Could not invite staff member";
    return res.status(500).json({ error: message });
  }
});

export default router;
