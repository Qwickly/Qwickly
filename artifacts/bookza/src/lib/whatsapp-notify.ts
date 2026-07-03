import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";

export async function sendWhatsappMessage(phone: string, message: string): Promise<void> {
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;

  const response = await fetch(buildApiUrl("/api/whatsapp/contacts/messages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ phone, message }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Failed to send WhatsApp message.");
  }
}
