import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import App from "./App";
import "./index.css";

// Tell the API client where the backend is hosted (Railway backend URL)
const apiUrl = import.meta.env.VITE_API_URL;
if (!apiUrl) {
  console.warn(
    "⚠️ VITE_API_URL is not configured. " +
    "API calls will fail unless your frontend and backend are on the same domain. " +
    "Set VITE_API_URL environment variable pointing to your backend (e.g., https://api.railway.app)"
  );
} else {
  setBaseUrl(apiUrl);
  console.log("✓ API base URL configured:", apiUrl);
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
