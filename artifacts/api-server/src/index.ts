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
const { autoBootWhatsappSessions } = await import("./lib/whatsapp");
const { startNotificationWorkers } = await import("./lib/notification-worker");
const { startPlatformNotificationWorker } = await import("./lib/platform-notification-worker");
const { startDailySummaryScheduler } = await import("./lib/daily-summary");
const { getGlobalScheduler } = await import("./lib/campaign-scheduler");
const { startEmailCampaignWorker } = await import("./lib/email-campaign-worker");
const { startSubscriptionLifecycleWorker } = await import("./workers/subscription-charger");

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

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
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
  // cancelled; this ends their access at the right moment.
  startSubscriptionLifecycleWorker(); // hourly

});
