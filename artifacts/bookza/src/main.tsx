import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import App from "./App";
import "./index.css";

// Always use the browser's same-origin /api path in production and local dev.
// The frontend Express server proxies /api to the upstream Railway backend,
// so we should never emit a cross-origin absolute backend URL to the browser.
const apiUrl = "";

console.log("Bookza API URL loaded from env:", "(relative — same-origin proxy)");
console.log("Local storage conversations cache:", localStorage.getItem("whatsapp_conversations"));

setBaseUrl(apiUrl);
console.log("✓ API base URL configured:", "(relative — same-origin proxy)");

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
