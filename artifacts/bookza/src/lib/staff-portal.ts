import { supabase } from "@/lib/supabase";
import type { BookingStatus, CatalogBooking } from "@/types/catalog";

/**
 * Data access for the staff self-service portal (/staff-login, /staff/*).
 * Deliberately separate from catalog.ts, which assumes the caller is the
 * business owner (via ensureBusiness()) — a staff session is scoped to their
 * own staff_members row and RLS-restricted reads, not the whole business.
 */

export type StaffMembership = {
  id: string;
  businessId: string;
  name: string;
  email: string | null;
};

export async function fetchMyStaffMembership(userId: string): Promise<StaffMembership | null> {
  const { data, error } = await supabase
    .from("staff_members")
    .select("id, business_id, name, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id as string,
    businessId: data.business_id as string,
    name: data.name as string,
    email: (data.email as string | null) ?? null,
  };
}

type StaffBookingRow = {
  id: string;
  client_id: string;
  service_id: string;
  staff_id: string | null;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  deposit_paid: boolean;
  total_amount: number;
  notes: string | null;
  created_at: string;
  clients: { name: string; phone: string | null } | null;
  services: { name: string; color: string } | null;
};

function mapStaffBooking(row: StaffBookingRow): CatalogBooking {
  const now = Date.now();
  const derivedStatus: BookingStatus =
    row.status === "confirmed" && new Date(row.end_time).getTime() < now ? "completed" : row.status;

  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.name ?? "Client",
    clientPhone: row.clients?.phone ?? null,
    serviceId: row.service_id,
    serviceName: row.services?.name ?? "Service",
    staffId: row.staff_id,
    staffName: "",
    startTime: row.start_time,
    endTime: row.end_time,
    status: derivedStatus,
    depositPaid: row.deposit_paid,
    totalAmount: Number(row.total_amount),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function fetchMyBookings(staffMemberId: string): Promise<CatalogBooking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, client_id, service_id, staff_id, start_time, end_time,
       status, deposit_paid, total_amount, notes, created_at,
       clients(name, phone),
       services(name, color)`,
    )
    .eq("staff_id", staffMemberId)
    .order("start_time", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StaffBookingRow[]).map(mapStaffBooking);
}

export async function staffUpdateBookingStatus(
  bookingId: string,
  status: "completed" | "no_show",
): Promise<void> {
  const { error } = await supabase.rpc("staff_update_booking_status", {
    p_booking_id: bookingId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}
