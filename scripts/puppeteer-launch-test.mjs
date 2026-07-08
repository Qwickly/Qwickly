import puppeteer from "puppeteer";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.WHATSAPP_BROWSER_PATH || "/usr/bin/chromium";

console.log("Testing Puppeteer Chromium launch...");
console.log("executablePath=", executablePath);
console.log("NODE_ENV=", process.env.NODE_ENV);
console.log("DBUS_SESSION_BUS_ADDRESS=", JSON.stringify(process.env.DBUS_SESSION_BUS_ADDRESS));
console.log("DBUS_SYSTEM_BUS_ADDRESS=", JSON.stringify(process.env.DBUS_SYSTEM_BUS_ADDRESS));
console.log("DISPLAY=", JSON.stringify(process.env.DISPLAY));
console.log("WAYLAND_DISPLAY=", JSON.stringify(process.env.WAYLAND_DISPLAY));
console.log("XAUTHORITY=", JSON.stringify(process.env.XAUTHORITY));

try {
  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-networking",
      "--disable-features=UseDBus,UseOzonePlatform",
      "--ozone-platform=offscreen",
      "--window-size=1280,720",
    ],
  });

  console.log("Browser launched successfully.");

  const page = await browser.newPage();
  await page.goto("about:blank");
  console.log("Page opened:", await page.url());

  await browser.close();
  console.log("Browser closed successfully.");
  process.exit(0);
} catch (error) {
  console.error("Launch test failed:", error);
  process.exit(1);
}
