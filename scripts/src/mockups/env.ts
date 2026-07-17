/**
 * Shared config + Supabase clients for the mockup-recording toolkit.
 *
 * These scripts drive the REAL dev app (web on :23168, api on :8080) with
 * Playwright to capture clean, chrome-free marketing videos, and seed a
 * dedicated demo business into the live Supabase project so those videos have
 * attractive data to show. Everything here is namespaced to that demo business
 * and is fully removable via `pnpm mockups:teardown`.
 *
 * Env is loaded from artifacts/api-server/.env(.local), same as the wa:* tests,
 * because that's the only place the SUPABASE_SERVICE_ROLE_KEY lives.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dir, "../../..");
const API_ROOT = path.join(REPO_ROOT, "artifacts/api-server");

function loadEnvFile(filepath: string): void {
  try {
    const text = readFileSync(filepath, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      )
        val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* file not present — fine */
  }
}

loadEnvFile(path.join(API_ROOT, ".env"));
loadEnvFile(path.join(API_ROOT, ".env.local"));

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) {
    throw new Error(
      `Missing ${name}${fallback ? ` (or ${fallback})` : ""} in artifacts/api-server/.env.local`,
    );
  }
  return value;
}

export const SUPABASE_URL = requireEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
export const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

/** Service-role client: bypasses RLS. Used only by seed/teardown. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anon client: used to sign in as the demo user and call ensure_my_business. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Demo business identity ──────────────────────────────────────────────────
// Everything the seed creates hangs off this one account. Change nothing here
// without also re-running the seed, or teardown won't find the old rows.

export const DEMO = {
  email: "demo.glowstudio@qwickly.dev",
  password: "GlowStudioDemo!2026",
  businessName: "Glow Beauty Studio",
  slug: "glow-studio-demo",
} as const;

// ── Recording targets / paths ───────────────────────────────────────────────

export const WEB_URL = process.env.MOCKUP_WEB_URL ?? "http://localhost:23168";
export const API_URL = process.env.MOCKUP_API_URL ?? "http://localhost:8080";

/** Where the app serves marketing videos from — final mp4s land here. */
export const VIDEO_OUT_DIR = path.join(REPO_ROOT, "artifacts/bookza/public/videos");
/** Scratch area for raw .webm captures + saved auth state (gitignored). */
export const WORK_DIR = path.join(__dir, ".work");
export const STORAGE_STATE = path.join(WORK_DIR, "storage-state.json");
