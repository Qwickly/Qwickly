import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase";

export type ActivityActorType = "user" | "ai" | "system" | "client";

export type ActivityEventInput = {
  businessId: string;
  actorType: ActivityActorType;
  actorId?: string | null;
  entityType: string;
  entityId?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

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

type ActivityEventRow = {
  id: string;
  business_id: string;
  actor_type: ActivityActorType;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

function mapActivityEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    businessId: row.business_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    title: row.title,
    description: row.description,
    metadata: row.metadata ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function recordActivity(input: ActivityEventInput): Promise<void> {
  if (!isSupabaseAdminConfigured()) return;

  const { error } = await getSupabaseAdmin()
    .from("activity_events")
    .insert({
      business_id: input.businessId,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      event_type: input.eventType,
      title: input.title,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    });

  if (error) {
    console.warn("[Activity] Failed to record event:", error.message);
  }
}

export async function listRecentActivityEvents(
  businessId: string,
  limit = 25,
): Promise<ActivityEvent[]> {
  if (!isSupabaseAdminConfigured()) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("activity_events")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw new Error(error.message);
  return ((data ?? []) as ActivityEventRow[]).map(mapActivityEvent);
}

export async function countUnreadActivityEvents(businessId: string): Promise<number> {
  if (!isSupabaseAdminConfigured()) return 0;

  const { count, error } = await getSupabaseAdmin()
    .from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("read_at", null);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markActivityEventsRead(businessId: string): Promise<void> {
  if (!isSupabaseAdminConfigured()) return;

  const { error } = await getSupabaseAdmin()
    .from("activity_events")
    .update({ read_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .is("read_at", null);

  if (error) throw new Error(error.message);
}
