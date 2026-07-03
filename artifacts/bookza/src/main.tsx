import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import App from "./App";
import "./index.css";

// API URL resolution (highest to lowest priority):
//  1. window.__ENV__.VITE_API_URL  — written at runtime by start.sh
//  2. import.meta.env.VITE_API_URL — baked in at Vite build time
//  3. Hardcoded Railway backend URL — always works as a guaranteed fallback
const RAILWAY_BACKEND_URL = "https://bookza-production.up.railway.app";
const apiUrl: string =
  (window as unknown as Record<string, Record<string, string>>).__ENV__?.VITE_API_URL ||
  import.meta.env.VITE_API_URL ||
  RAILWAY_BACKEND_URL;

console.log("Bookza API URL loaded from env:", apiUrl);
console.log("Local storage conversations cache:", localStorage.getItem("whatsapp_conversations"));

setBaseUrl(apiUrl);
console.log("✓ API base URL configured:", apiUrl);

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
