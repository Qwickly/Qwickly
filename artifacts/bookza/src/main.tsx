import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import App from "./App";
import "./index.css";

// API URL resolution (highest to lowest priority):
//  1. window.__ENV__.VITE_API_URL  — written at runtime by start.sh (production only)
//  2. import.meta.env.VITE_API_URL — baked in at Vite build time
//  3. In local dev (`pnpm dev`): leave unset so requests stay relative and go
//     through Vite's dev proxy to the local API server — same path every other
//     page already uses. Without this, the dashboard's generated-hook calls
//     silently hit production instead of your local data.
//  4. In a production build with neither override set: hardcoded Railway
//     backend URL, as a guaranteed fallback — unchanged from before.
const RAILWAY_BACKEND_URL = "https://qwickly-production.up.railway.app";
const apiUrl: string =
  (window as unknown as Record<string, Record<string, string>>).__ENV__?.VITE_API_URL ||
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "" : RAILWAY_BACKEND_URL);

console.log("Bookza API URL loaded from env:", apiUrl || "(relative — local dev proxy)");
console.log("Local storage conversations cache:", localStorage.getItem("whatsapp_conversations"));

setBaseUrl(apiUrl);
console.log("✓ API base URL configured:", apiUrl || "(relative — local dev proxy)");

setAuthTokenGetter(async () => {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch (error) {
    console.error("Failed to get auth token from Supabase:", error);
    return null;
  }
});

createRoot(document.getElementById("root")!).render(<App />);
