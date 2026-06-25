import { supabase } from "@/lib/supabase";

export async function sendWhatsappMessage(phone: string, message: string): Promise<void> {
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;

  const response = await fetch("/api/whatsapp/contacts/messages", {
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
