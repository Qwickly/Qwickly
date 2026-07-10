import { supabase } from "@/lib/supabase";

/**
 * Public (unauthenticated) self-service booking management, keyed by the
 * unguessable per-booking token from the confirmation email. Backed by the
 * SECURITY DEFINER RPCs in migration 045.
 */

export type ManagedBooking = {
  bookingId: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  startTime: string; // ISO
  endTime: string; // ISO
  serviceId: string;
  serviceName: string;
  staffId: string | null;
  staffName: string | null;
  businessId: string;
  businessName: string;
  businessSlug: string | null;
  clientName: string | null;
  canCancel: boolean;
  canReschedule: boolean;
};

function mapRow(row: Record<string, unknown>): ManagedBooking {
  return {
    bookingId: row["booking_id"] as string,
    status: row["status"] as ManagedBooking["status"],
    startTime: row["start_time"] as string,
    endTime: row["end_time"] as string,
    serviceId: row["service_id"] as string,
    serviceName: row["service_name"] as string,
    staffId: (row["staff_id"] as string | null) ?? null,
    staffName: (row["staff_name"] as string | null) ?? null,
    businessId: row["business_id"] as string,
    businessName: row["business_name"] as string,
    businessSlug: (row["business_slug"] as string | null) ?? null,
    clientName: (row["client_name"] as string | null) ?? null,
    canCancel: Boolean(row["can_cancel"]),
    canReschedule: Boolean(row["can_reschedule"]),
  };
}

export async function fetchManagedBooking(token: string): Promise<ManagedBooking | null> {
  const { data, error } = await supabase.rpc("get_booking_by_manage_token", { p_token: token });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRow(row as Record<string, unknown>) : null;
}

export async function cancelManagedBooking(token: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_booking_by_manage_token", { p_token: token });
  if (error) throw new Error(error.message);
}

export async function rescheduleManagedBooking(token: string, newStartIso: string): Promise<void> {
  const { error } = await supabase.rpc("reschedule_booking_by_manage_token", {
    p_token: token,
    p_new_start: newStartIso,
  });
  if (error) throw new Error(error.message);
}
