import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";

/**
 * Client for the staff-invite route on the api-server
 * (artifacts/api-server/src/routes/staff.ts). Creates/resets the staff
 * member's Supabase Auth login and emails them a temp password — that work
 * needs the service-role key, so it can't happen from the browser.
 */

async function authHeaders(json = false): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const payload = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : fallback;
    throw new Error(message);
  }
  return payload as T;
}

export async function inviteStaffMember(staffId: string): Promise<void> {
  const res = await fetch(buildApiUrl(`/api/staff/${staffId}/invite`), {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(),
  });
  await parse<{ ok: boolean }>(res, "Could not send staff invite");
}
