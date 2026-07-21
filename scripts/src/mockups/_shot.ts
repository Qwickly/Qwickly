import { chromium } from "playwright";
import { WEB_URL } from "./env";

const SP =
  "C:/Users/dylan/AppData/Local/Temp/claude/c--dev-SAAS-bookza/57bc4129-2add-40da-9b10-ceba82a24c67/scratchpad";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.25 });
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${WEB_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  // Center step 2 so the sticky panel should show the services mock.
  await page.locator("[data-how-step]").nth(1).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -100));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SP}/d-how.png` });
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "(none)");
  await browser.close();
}
main();
