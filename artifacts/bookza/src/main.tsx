import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import App from "./App";
import "./index.css";

// API URL resolution (highest to lowest priority):
//  1. window.__ENV__.VITE_API_URL — written at runtime by start.sh (production only)
//  2. import.meta.env.VITE_API_URL — baked in at Vite build time
//  3. In local dev (`pnpm dev`): leave unset so requests stay relative and go
//     through Vite's dev proxy to the local API server.
//  4. In production builds with neither override set: use the Railway backend
//     fallback and let the browser call it directly.
const RAILWAY_BACKEND_URL = "https://qwickly-production.up.railway.app";
const runtimeApiUrl = (window as unknown as Record<string, Record<string, string | undefined>>).__ENV__?.VITE_API_URL;
const apiUrl: string =
  runtimeApiUrl !== undefined
    ? runtimeApiUrl
    : import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "" : RAILWAY_BACKEND_URL);

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
