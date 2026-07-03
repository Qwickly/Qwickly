import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import App from "./App";
import "./index.css";

// API URL: read from runtime config (window.__ENV__, injected by start.sh at container startup)
// first, then fall back to build-time env var (VITE_API_URL).
// This means the value in Railway's "Variables" tab always takes effect immediately
// without needing to rebuild the frontend.
const apiUrl: string | undefined =
  (window as unknown as Record<string, Record<string, string>>).__ENV__?.VITE_API_URL ||
  import.meta.env.VITE_API_URL;

console.log("Bookza API URL loaded from env:", apiUrl);
console.log("Local storage conversations cache:", localStorage.getItem("whatsapp_conversations"));

if (apiUrl) {
  setBaseUrl(apiUrl);
  console.log("✓ API base URL configured:", apiUrl);
} else {
  console.warn(
    "⚠️ VITE_API_URL is not configured. " +
    "API calls will fail unless your frontend and backend are on the same domain. " +
    "Set VITE_API_URL environment variable pointing to your backend (e.g., https://api.railway.app)"
  );
}

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
