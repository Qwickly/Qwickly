import { supabase } from "@/lib/supabase";

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

  const response = await fetch(`/api/activity/events?${params.toString()}`, {
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

export async function markActivityEventsRead(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch("/api/activity/events/read", {
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
