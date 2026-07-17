/**
 * Logs into the running web app as the demo user by driving the real login
 * form, then saves Playwright storageState (the Supabase session in
 * localStorage) so every authed recording can reuse it without re-logging-in.
 *
 * Requires the dev servers up (pnpm dev). Run:  pnpm mockups:auth
 */
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { DEMO, STORAGE_STATE, WEB_URL } from "./env";

async function main() {
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Opening login…");
  await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle" });

  await page.locator("#email").fill(DEMO.email);
  await page.locator("#password").fill(DEMO.password);
  // Client-side beta gate on the login form (login.tsx).
  await page.locator("#accessKey").fill("Qwickly2026@");
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // Wait until the session lands us on an authed route.
  await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30000 });
  await page.waitForTimeout(1500);

  await context.storageState({ path: STORAGE_STATE });
  console.log(`✅ Saved auth state -> ${STORAGE_STATE}`);
  console.log(`   Landed on: ${new URL(page.url()).pathname}`);

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error("❌ Auth failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
