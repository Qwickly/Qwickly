import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";

export type ActivityActorType = "user" | "ai" | "system" | "client";

export type ActivityEvent = {
  id: string;
  businessId: string;
  actorType: ActivityActorType;
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  eventType: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type ActivityEventsResponse = {
  events: ActivityEvent[];
  unreadCount: number;
};

export async function fetchActivityEvents(limit = 25): Promise<ActivityEventsResponse> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const params = new URLSearchParams({ limit: String(limit) });

  const response = await fetch(buildApiUrl(`/api/activity/events?${params.toString()}`), {
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | ActivityEventsResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "Could not load activity",
    );
  }

  return {
    events: (payload as ActivityEventsResponse | null)?.events ?? [],
    unreadCount: (payload as ActivityEventsResponse | null)?.unreadCount ?? 0,
  };
}

export type LogActivityInput = {
  entityType: string;
  entityId?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  actorType?: ActivityActorType;
};

/**
 * Records a dashboard activity event for the current business.
 *
 * Fire-and-forget by design: activity logging is a side effect that must never
 * break the mutation it is describing, so every failure is swallowed with a
 * warning rather than thrown. Callers should NOT await-block their happy path on
 * this — call it after the mutation has already succeeded.
 *
 * The insert is authorised by the `activity_events_all_own` RLS policy (owner of
 * the business), so this only works for authenticated dashboard users. Bot and
 * public-booking activity is logged server-side / in SQL instead.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const businessId = await ensureBusiness();
    const { data } = await supabase.auth.getUser();

    const { error } = await supabase.from("activity_events").insert({
      business_id: businessId,
      actor_type: input.actorType ?? "user",
      actor_id: data.user?.id ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      event_type: input.eventType,
      title: input.title,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) console.warn("[Activity] Failed to record event:", error.message);
  } catch (err) {
    console.warn("[Activity] Failed to record event:", err);
  }
}

export async function markActivityEventsRead(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(buildApiUrl("/api/activity/events/read"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Could not mark activity as read");
  }
}
