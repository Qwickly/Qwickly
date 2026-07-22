import { Router } from "express";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";

const router = Router();

// Simple in-memory per-IP rate limit: max submissions per window.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const submissionLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (submissionLog.get(ip) ?? []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    submissionLog.set(ip, recent);
    return true;
  }
  recent.push(now);
  submissionLog.set(ip, recent);
  // Prune stale IPs occasionally so the map doesn't grow unbounded.
  if (submissionLog.size > 1000) {
    for (const [key, timestamps] of submissionLog) {
      if (timestamps.every((ts) => now - ts >= RATE_LIMIT_WINDOW_MS)) {
        submissionLog.delete(key);
      }
    }
  }
  return false;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

router.post("/contact", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Honeypot: real users never fill this hidden field. Pretend success for bots.
    if (cleanText(body["company_website"], 200)) {
      return res.json({ ok: true });
    }

    const name = cleanText(body["name"], 200);
    const email = cleanText(body["email"], 320);
    const businessName = cleanText(body["business_name"], 200);
    const phone = cleanText(body["phone"], 50);
    const businessType = cleanText(body["business_type"], 200);
    const helpWith = cleanText(body["help_with"], 100);
    const message = cleanText(body["message"], 5000);

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (isRateLimited(req.ip ?? "unknown")) {
      return res
        .status(429)
        .json({ error: "Too many messages sent. Please try again later." });
    }

    if (!isSupabaseAdminConfigured()) {
      req.log.error("Contact form submitted but Supabase admin is not configured");
      return res
        .status(503)
        .json({ error: "Message could not be saved. Please email us directly." });
    }

    const { error } = await getSupabaseAdmin().from("contact_submissions").insert({
      name,
      email,
      business_name: businessName,
      phone,
      business_type: businessType,
      help_with: helpWith,
      message,
    });

    if (error) throw new Error(error.message);

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res
      .status(500)
      .json({ error: "Message could not be saved. Please email us directly." });
  }
});

export default router;
