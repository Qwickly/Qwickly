import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./lib/logger";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectDir = path.resolve(currentDir, "..");

loadEnv({ path: path.resolve(projectDir, ".env") });
loadEnv({ path: path.resolve(projectDir, ".env.local"), override: process.env.NODE_ENV !== "production" });

// IMPORTANT:
// Many modules (e.g. Supabase client) read env vars at import-time.
// Using a dynamic import here guarantees dotenv has loaded before those modules execute.
const { default: app } = await import("./app");
const { autoBootWhatsappSessions, backupAllConnectedSessions } = await import("./lib/whatsapp");
const { startNotificationWorkers } = await import("./lib/notification-worker");
const { startPlatformNotificationWorker } = await import("./lib/platform-notification-worker");
const { startDailySummaryScheduler } = await import("./lib/daily-summary");
const { getGlobalScheduler } = await import("./lib/campaign-scheduler");
const { startEmailCampaignWorker } = await import("./lib/email-campaign-worker");
const { startSubscriptionLifecycleWorker } = await import("./workers/subscription-charger");
const { startTrialReminderWorker } = await import("./workers/trial-reminders");
const { startGraceBookingWorker } = await import("./workers/grace-bookings");
const { startBookingExpiryWorker } = await import("./workers/booking-expiry");
const { assertPayFastOriginConfigured } = await import("./lib/payfast");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught Exception - Server continuing');
  // Don't exit, just log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Promise Rejection - Server continuing');
  // Don't exit, just log and continue
});

// Graceful shutdown: backup all connected WhatsApp sessions before exiting.
// Railway sends SIGTERM before killing the container on redeploy, giving us
// a window to persist session data to Supabase so connections survive.
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received — backing up WhatsApp sessions before shutdown`);
  try {
    await backupAllConnectedSessions();
    logger.info('WhatsApp session backup completed');
  } catch (err) {
    logger.error({ err }, 'Failed to backup WhatsApp sessions on shutdown');
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('beforeExit', (code) => {
  logger.info({ code }, 'Process beforeExit event');
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  logger.info(
    { appBaseUrl: process.env["APP_BASE_URL"] || "(unset)" },
    "APP_BASE_URL resolved at boot",
  );

  // Print the exact notify_url PayFast will be handed. A wrong one is otherwise
  // completely silent — checkout succeeds, the ITN goes nowhere, and the
  // payment just sits at 'pending'. Compare this line against the notify_url
  // shown in the PayFast dashboard when a payment does not confirm.
  assertPayFastOriginConfigured({
    warn: (msg) => logger.warn(msg),
    info: (msg) => logger.info(msg),
  });

  // Start the campaign scheduler
  const scheduler = getGlobalScheduler();
  scheduler.start();
  logger.info("Campaign scheduler started");

  // Automatically resume any WhatsApp sessions that were connected before
  // the server restarted. This keeps the bot running in the background
  // so it can receive and auto-reply to messages at any time.
  void autoBootWhatsappSessions().catch((bootErr) => {
    logger.error({ err: bootErr }, "WhatsApp auto-boot failed");
  });

  // Start the background worker that drains the staff + client notification
  // queues (retry/backoff, auto-pause, jittered sends).
  startNotificationWorkers(10000); // Check every 10 seconds

    // Start the email campaign worker which processes scheduled recipients
    startEmailCampaignWorker(30000);

  // Drain the platform → owner WhatsApp queue (sent from the official Qwickly
  // number). Today it pings owners about AI replies awaiting approval; the queue
  // is generic so future kinds (revenue/AI summaries, reports) share it.
  startPlatformNotificationWorker(60000); // Batched; check every 60 seconds

  // Enqueue staff daily-schedule summaries once a day after 07:00 SAST.
  startDailySummaryScheduler();

  // Flip cancel_at_period_end subscriptions to 'canceled' once their paid
  // period ends. PayFast was already told to stop charging when the customer
  // cancelled; this ends their access at the right moment. Also expires
  // finished free trials, which since going card-free nothing else does.
  startSubscriptionLifecycleWorker(); // hourly

  // Two emails near the end of a free trial. Without a card on file nothing
  // converts by itself, so a trial ending unnoticed is a customer lost in
  // silence — these are the conversion path, not a courtesy.
  startTrialReminderWorker(); // hourly

  // During the week after a trial expires the booking page stays live but the
  // owner is locked out, so bookings pile up where they cannot see them. This
  // tells them how many — the best conversion argument we have, and the only
  // warning that real commitments are accumulating out of sight.
  startGraceBookingWorker(); // every 6 hours

  // Releases the slot held by a deposit-required booking nobody ever paid
  // for. DRY-RUN on first deploy — a bug in the cancel predicate is the
  // highest-blast-radius risk in the whole deposits feature (it could cancel
  // unrelated pending bookings platform-wide), so this only logs what it
  // WOULD cancel until BOOKING_EXPIRY_DRY_RUN is explicitly set to "false"
  // after watching the logs for a while.
  startBookingExpiryWorker(60_000, {
    dryRun: process.env["BOOKING_EXPIRY_DRY_RUN"] !== "false",
  });

});
