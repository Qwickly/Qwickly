import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

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

export default defineConfig(({ mode }) => {
  // Only used to read VITE_API_PROXY_TARGET from .env(.local) for the dev
  // proxy below — does not affect production builds, which don't run a
  // dev server and never touch this value.
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8080";

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), runtimeErrorOverlay(), ...replitPlugins],
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
          oldHomepage: path.resolve(import.meta.dirname, "index.backup.html"),
          features: path.resolve(import.meta.dirname, "features.html"),
          onlineBooking: path.resolve(import.meta.dirname, "online-booking.html"),
          campaigns: path.resolve(import.meta.dirname, "campaigns.html"),
          whatsappAi: path.resolve(import.meta.dirname, "whatsapp-ai.html"),
          pricing: path.resolve(import.meta.dirname, "pricing.html"),
          custom: path.resolve(import.meta.dirname, "custom.html"),
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
