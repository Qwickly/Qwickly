import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

const replitPlugins =
  process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
    ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          }),
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) =>
          m.devBanner(),
        ),
      ]
    : [];

const copyStaticAssetFiles = () => ({
  name: "copy-static-asset-files",
  writeBundle() {
    const sourceDir = path.resolve(import.meta.dirname, "assets");
    const targetDir = path.resolve(import.meta.dirname, "dist/public/assets");

    if (!fs.existsSync(sourceDir) || !fs.existsSync(targetDir)) {
      return;
    }

    const filesToCopy = [
      "qwickly-auth-nav.js",
      "qwickly-accordion.js",
      "qwickly-os-mock.js",
    ];

    for (const file of filesToCopy) {
      const sourceFile = path.join(sourceDir, file);
      const targetFile = path.join(targetDir, file);
      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, targetFile);
      }
    }
  },
});

export default defineConfig(({ mode }) => {
  // Only used to read VITE_API_PROXY_TARGET from .env(.local) for the dev
  // proxy below — does not affect production builds, which don't run a
  // dev server and never touch this value.
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8080";

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), runtimeErrorOverlay(), copyStaticAssetFiles(), ...replitPlugins],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: path.resolve(import.meta.dirname, "index.html"),
          preSignup: path.resolve(import.meta.dirname, "pre-signup.html"),
          features: path.resolve(import.meta.dirname, "features.html"),
          onlineBooking: path.resolve(import.meta.dirname, "online-booking.html"),
          campaigns: path.resolve(import.meta.dirname, "campaigns.html"),
          whatsappAi: path.resolve(import.meta.dirname, "whatsapp-ai.html"),
          pricing: path.resolve(import.meta.dirname, "pricing.html"),
          custom: path.resolve(import.meta.dirname, "custom.html"),
          salons: path.resolve(import.meta.dirname, "salons.html"),
          barbers: path.resolve(import.meta.dirname, "barbers.html"),
          beautyStudios: path.resolve(import.meta.dirname, "beauty-studios.html"),
          wellness: path.resolve(import.meta.dirname, "wellness.html"),
          consultants: path.resolve(import.meta.dirname, "consultants.html"),
          tutors: path.resolve(import.meta.dirname, "tutors.html"),
          about: path.resolve(import.meta.dirname, "about.html"),
          contact: path.resolve(import.meta.dirname, "contact.html"),
          status: path.resolve(import.meta.dirname, "status.html"),
          terms: path.resolve(import.meta.dirname, "terms.html"),
          privacy: path.resolve(import.meta.dirname, "privacy.html"),
        },
      },
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
