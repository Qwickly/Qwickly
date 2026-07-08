import puppeteer from "puppeteer";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.WHATSAPP_BROWSER_PATH;

console.log("Testing Puppeteer Chromium launch...");
console.log("executablePath=", executablePath || "(Puppeteer default Chromium)");
console.log("NODE_ENV=", process.env.NODE_ENV);
console.log("DBUS_SESSION_BUS_ADDRESS=", JSON.stringify(process.env.DBUS_SESSION_BUS_ADDRESS));
console.log("DBUS_SYSTEM_BUS_ADDRESS=", JSON.stringify(process.env.DBUS_SYSTEM_BUS_ADDRESS));
console.log("DISPLAY=", JSON.stringify(process.env.DISPLAY));
console.log("WAYLAND_DISPLAY=", JSON.stringify(process.env.WAYLAND_DISPLAY));
console.log("XAUTHORITY=", JSON.stringify(process.env.XAUTHORITY));

try {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    dumpio: true,
    args: [
      "--headless",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-infobars",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--metrics-recording-only",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--disable-crashpad",
      "--disable-features=TranslateUI,site-per-process,VizDisplayCompositor,AudioServiceOutOfProcess,UseDBus,UseOzonePlatform",
      "--ozone-platform=offscreen",
      "--window-size=1280,720",
      "--use-gl=swiftshader",
      "--disable-ipc-flooding-protection",
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
