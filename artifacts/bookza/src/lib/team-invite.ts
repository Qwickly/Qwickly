import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";

/**
 * Client for the team-invite route on the api-server
 * (artifacts/api-server/src/routes/team.ts). Same shape as lib/staff-invite.ts.
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

export async function inviteTeamMemberAccount(teamMemberId: string): Promise<void> {
  const res = await fetch(buildApiUrl(`/api/team/${teamMemberId}/invite`), {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(),
  });
  await parse<{ ok: boolean }>(res, "Could not send team invite");
}
