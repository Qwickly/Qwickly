import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import type {
  BookingInput,
  BookingStatus,
  CalendarEvent,
  CatalogBooking,
  CatalogClient,
  CatalogService,
  CatalogPayment,
  CatalogStaff,
  ClientInput,
  ClientType,
  ClientStatus,
  PaymentInput,
  PaymentMethod,
  PaymentStatus,
  PaymentSummary,
  PaymentType,
  ServiceInput,
  StaffInput,
} from "@/types/catalog";
import type { BookingSlot } from "@/types/booking-page";

const SERVICE_COLOR = "#10b981";
const SERVICE_ICON = "scissors";

function mapService(row: Record<string, unknown>): CatalogService {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    price: Number(row.price),
    duration: row.duration as number,
    icon: (row.icon as string) ?? SERVICE_ICON,
    color: (row.color as string) ?? SERVICE_COLOR,
    isActive: row.is_active as boolean,
    depositRequired: row.deposit_required as boolean,
    depositAmount: Number(row.deposit_amount),
    createdAt: row.created_at as string,
  };
}

function mapClient(
  row: Record<string, unknown>,
  stats?: { totalSpent: number; lifetimeBookings: number; lastVisit: string | null },
): CatalogClient {
  return {
    id: row.id as string,
    name: row.name as string,
    phone: (row.phone as string) ?? "",
    email: (row.email as string) ?? null,
    clientType: row.client_type as ClientType,
    status: (row.status as ClientStatus) ?? "new",
    noShowCount: row.no_show_count as number,
    avatarUrl: (row.avatar_url as string) ?? null,
    notes: (row.notes as string) ?? null,
    totalSpent: stats?.totalSpent ?? 0,
    lifetimeBookings: stats?.lifetimeBookings ?? 0,
    lastVisit: stats?.lastVisit ?? null,
    createdAt: row.created_at as string,
  };
}

type StaffStats = { upcoming: number; revenue: number; completed: number };

function mapStaff(row: Record<string, unknown>, stats?: StaffStats): CatalogStaff {
  const workingDays =
    (row.working_days as string[] | null | undefined) ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];
  return {
    id: row.id as string,
    name: row.name as string,
    position: (row.position as string) ?? "",
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    isActive: row.is_active as boolean,
    workingDays,
    upcomingBookings: stats?.upcoming ?? 0,
    revenueGenerated: stats?.revenue ?? 0,
    completedBookings: stats?.completed ?? 0,
    createdAt: row.created_at as string,
  };
}

async function staffBookingStats(businessId: string): Promise<Map<string, StaffStats>> {
  const { data, error } = await supabase
    .from("bookings")
    .select("staff_id, total_amount, status, start_time, end_time")
    .eq("business_id", businessId)
    .not("staff_id", "is", null);

  if (error) throw new Error(error.message);

  const now = new Date();
  const byStaff = new Map<string, StaffStats>();

  for (const row of data ?? []) {
    const staffId = row.staff_id as string;
    if (!staffId) continue;
    const current = byStaff.get(staffId) ?? { upcoming: 0, revenue: 0, completed: 0 };
    const status = row.status as BookingStatus;
    const start = new Date(row.start_time as string);
    const end = new Date(row.end_time as string);

    // Keep Staff revenue consistent with the booking list rule:
    // treat past confirmed bookings as completed for stats/revenue.
    const effectiveStatus: BookingStatus =
      status === "confirmed" && end.getTime() < now.getTime() ? "completed" : status;

    if (effectiveStatus !== "cancelled" && start > now) {
      current.upcoming += 1;
    }
    if (effectiveStatus === "completed") {
      current.completed += 1;
      current.revenue += Number(row.total_amount);
    }
    byStaff.set(staffId, current);
  }

  return byStaff;
}

async function clientStats(businessId: string) {
  const { data, error } = await supabase
    .from("bookings")
    .select("client_id, total_amount, status, start_time")
    .eq("business_id", businessId);

  if (error) throw new Error(error.message);

  const byClient = new Map<string, { totalSpent: number; lifetimeBookings: number; lastVisit: string | null }>();

  for (const row of data ?? []) {
    const id = row.client_id as string;
    const current = byClient.get(id) ?? { totalSpent: 0, lifetimeBookings: 0, lastVisit: null };
    if (row.status === "completed") {
      current.totalSpent += Number(row.total_amount);
    }
    if (row.status !== "cancelled") {
      current.lifetimeBookings += 1;
    }
    const start = row.start_time as string;
    if (!current.lastVisit || start > current.lastVisit) {
      current.lastVisit = start;
    }
    byClient.set(id, current);
  }

  return byClient;
}

// ── Services ──────────────────────────────────────────────────────────────────

export async function fetchServices(): Promise<CatalogService[]> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapService);
}

export async function createService(input: ServiceInput): Promise<CatalogService> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("services")
    .insert({
      business_id: businessId,
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      duration: input.duration,
      icon: input.icon ?? SERVICE_ICON,
      color: input.color ?? SERVICE_COLOR,
      deposit_required: false,
      deposit_amount: 0,
      is_active: input.isActive ?? true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapService(data);
}

export async function updateService(id: string, input: ServiceInput): Promise<CatalogService> {
  const { data, error } = await supabase
    .from("services")
    .update({
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      duration: input.duration,
      icon: input.icon ?? SERVICE_ICON,
      color: input.color ?? SERVICE_COLOR,
      is_active: input.isActive ?? true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapService(data);
}

export async function archiveService(id: string): Promise<void> {
  const { error } = await supabase.from("services").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchServiceProfile(id: string) {
  const businessId = await ensureBusiness();
  const { data: service, error } = await supabase
    .from("services")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .single();

  if (error) throw new Error(error.message);

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(bookingSelect)
    .eq("service_id", id)
    .eq("business_id", businessId)
    .order("start_time", { ascending: false })
    .limit(50);

  if (bookingsError) throw new Error(bookingsError.message);

  const now = Date.now();
  const all = (bookings ?? []).map((row) => mapBooking(row as unknown as BookingRow));
  const nonCancelled = all.filter((b) => b.status !== "cancelled");
  const completed = all.filter((b) => b.status === "completed");
  const upcoming = all
    .filter((b) => b.status !== "cancelled" && new Date(b.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const revenue = completed.reduce((sum, b) => sum + Number(b.totalAmount), 0);

  const monthNow = new Date();
  const revenueThisMonth = completed
    .filter((b) => {
      const d = new Date(b.startTime);
      return d.getMonth() === monthNow.getMonth() && d.getFullYear() === monthNow.getFullYear();
    })
    .reduce((sum, b) => sum + Number(b.totalAmount), 0);

  // Staff who have performed this service, ranked by booking volume.
  const staffMap = new Map<string, { id: string; name: string; bookings: number }>();
  for (const b of nonCancelled) {
    if (!b.staffId) continue;
    const current = staffMap.get(b.staffId) ?? { id: b.staffId, name: b.staffName, bookings: 0 };
    current.bookings += 1;
    staffMap.set(b.staffId, current);
  }
  const staff = Array.from(staffMap.values()).sort((a, b) => b.bookings - a.bookings);

  return {
    service: mapService(service as Record<string, unknown>),
    metrics: {
      totalBookings: nonCancelled.length,
      completedBookings: completed.length,
      upcomingBookings: upcoming.length,
      revenue,
      revenueThisMonth,
    },
    recentBookings: all.slice(0, 10),
    upcomingBookings: upcoming.slice(0, 8),
    staff,
  };
}

// ── Clients ───────────────────────────────────────────────────────────────────

export async function fetchClients(
  page: number = 1, 
  limit: number = 8,
  filter?: string,
  search?: string
): Promise<{ clients: CatalogClient[]; totalCount: number }> {
  const businessId = await ensureBusiness();
  const offset = (page - 1) * limit;
  
  let query = supabase
    .from("clients")
    .select("*", { count: "exact" })
    .eq("business_id", businessId);

  // Apply filter
  if (filter && filter !== "all") {
    if (filter === "no_show_risk") {
      query = query.gte("no_show_count", 2);
    } else {
      query = query.eq("client_type", filter);
    }
  }

  // Apply search
  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const [clientsRes, stats] = await Promise.all([
    query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    clientStats(businessId),
  ]);

  if (clientsRes.error) throw new Error(clientsRes.error.message);
  
  return {
    clients: (clientsRes.data ?? []).map((row) => mapClient(row, stats.get(row.id as string))),
    totalCount: clientsRes.count ?? 0,
  };
}

export async function createClient(input: ClientInput): Promise<CatalogClient> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      business_id: businessId,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      client_type: input.clientType ?? "new",
      status: "new",
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapClient(data);
}

export async function updateClient(id: string, input: Partial<ClientInput>): Promise<CatalogClient> {
  const businessId = await ensureBusiness();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.clientType !== undefined) patch.client_type = input.clientType;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .single();

  if (error) {
    // 23505 = unique (business_id, phone) violation from migration 022.
    if (error.code === "23505") {
      throw new Error("A client with this phone number already exists.");
    }
    throw new Error(error.message);
  }

  const stats = await clientStats(businessId);
  return mapClient(data, stats.get(id));
}

export async function deleteClient(id: string): Promise<void> {
  const businessId = await ensureBusiness();

  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId);

  if (error) throw new Error(error.message);
}

export async function fetchClientProfile(id: string) {
  const businessId = await ensureBusiness();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .single();

  if (clientError) throw new Error(clientError.message);

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id, start_time, end_time, status, total_amount, notes, services(name), staff_members(name)")
    .eq("client_id", id)
    .eq("business_id", businessId)
    .order("start_time", { ascending: false })
    .limit(20);

  if (bookingsError) throw new Error(bookingsError.message);

  const stats = await clientStats(businessId);
  const mapped = mapClient(client, stats.get(id));

  return {
    client: mapped,
    recentBookings: (bookings ?? []).map((b) => ({
      id: b.id as string,
      startTime: b.start_time as string,
      endTime: b.end_time as string,
      status: b.status as BookingStatus,
      totalAmount: Number(b.total_amount),
      serviceName: (b.services as { name: string } | null)?.name ?? "Service",
      staffName: (b.staff_members as { name: string } | null)?.name ?? "Unassigned",
      notes: (b.notes as string) ?? null,
    })),
    payments: await fetchClientPayments(id),
    notes: client.notes ? [{ id: "1", content: client.notes as string, createdAt: client.created_at as string }] : [],
  };
}

// ── Staff ─────────────────────────────────────────────────────────────────────

export async function fetchStaff(): Promise<CatalogStaff[]> {
  const businessId = await ensureBusiness();
  const [staffRes, stats] = await Promise.all([
    supabase
      .from("staff_members")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    staffBookingStats(businessId),
  ]);

  if (staffRes.error) throw new Error(staffRes.error.message);
  return (staffRes.data ?? []).map((row) => mapStaff(row, stats.get(row.id as string)));
}

export async function createStaff(input: StaffInput): Promise<CatalogStaff> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("staff_members")
    .insert({
      business_id: businessId,
      name: input.name,
      position: input.position,
      email: input.email ?? null,
      phone: input.phone ?? null,
      is_active: input.isActive ?? true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapStaff(data, { upcoming: 0, revenue: 0, completed: 0 });
}

export async function updateStaff(id: string, input: Partial<StaffInput>): Promise<CatalogStaff> {
  const businessId = await ensureBusiness();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.position !== undefined) patch.position = input.position;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const { data, error } = await supabase
    .from("staff_members")
    .update(patch)
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  const stats = await staffBookingStats(businessId);
  return mapStaff(data, stats.get(id));
}

// we cannot permanenlty delete it yet because that staff member is a foreign key to bookings
// thus why we archieveing for now and then maybe add permanent delete for staff with no bookings
export async function archiveStaff(id: string): Promise<CatalogStaff>{
  return updateStaff(id, {isActive: false});
}

export async function unarchiveStaff(id: string): Promise<CatalogStaff> {
  return updateStaff(id, { isActive: true });
}

// helper for the check before permanaent delete
export async function getStaffBookingCount(id: string): Promise<number>{
  const businessId = await ensureBusiness();

  const {count, error} = await supabase
      .from("bookings")
      .select("id", {count: "exact", head: true})
      .eq("staff_id", id)
      .eq("business_id",businessId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function deleteStaff(id: string): Promise<void> {
  const businessId = await ensureBusiness();

  const bookingCount = await getStaffBookingCount(id);

  if (bookingCount > 0){
    throw new Error("This staff member has bookings and cannot be permanently deleted. Archieve them instead.");
  }

  const {error} = await supabase
    .from("staff_members")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId);

    if (error) throw new Error(error.message);
}

export async function updateStaffWorkingDays(id: string, workingDays: string[]): Promise<CatalogStaff> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("staff_members")
    .update({ working_days: workingDays })
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  const stats = await staffBookingStats(businessId);
  return mapStaff(data as Record<string, unknown>, stats.get(id));
}

export async function fetchStaffProfile(id: string) {
  const businessId = await ensureBusiness();
  const { data: member, error } = await supabase
    .from("staff_members")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .single();

  if (error) throw new Error(error.message);

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(bookingSelect)
    .eq("staff_id", id)
    .eq("business_id", businessId)
    .order("start_time", { ascending: true });

  if (bookingsError) throw new Error(bookingsError.message);

  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, name, price, duration, is_active")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (servicesError) throw new Error(servicesError.message);

  const now = new Date();
  const all = (bookings ?? []).map((row) => mapBooking(row as unknown as BookingRow));
  const nonCancelled = all.filter((b) => b.status !== "cancelled");
  const completed = all.filter((b) => b.status === "completed");
  const noShows = all.filter((b) => b.status === "no_show");
  const upcoming = all.filter((b) => b.status !== "cancelled" && new Date(b.startTime) > now);
  const bookedServiceIds = new Set(all.map((b) => b.serviceId).filter(Boolean));
  const activeServices = (services ?? []).map((service) => ({
    id: service.id as string,
    name: service.name as string,
    price: Number(service.price),
    duration: service.duration as number,
  }));
  const assignedServices =
    activeServices.filter((service) => bookedServiceIds.has(service.id)).length > 0
      ? activeServices.filter((service) => bookedServiceIds.has(service.id))
      : activeServices.slice(0, 4);

  const revenueThisMonth = completed
    .filter((b) => {
      const d = new Date(b.startTime);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, b) => sum + Number(b.totalAmount), 0);

  const stats = await staffBookingStats(businessId);
  const staffMapped = mapStaff(member as Record<string, unknown>, stats.get(id));

  return {
    staffMember: staffMapped,
    upcomingBookings: upcoming,
    performanceMetrics: {
      averageRating: completed.length >= 3 ? 4.8 : 0,
      completionRate: nonCancelled.length
        ? Math.round((completed.length / nonCancelled.length) * 100)
        : 0,
      noShowRate: nonCancelled.length ? Math.round((noShows.length / nonCancelled.length) * 100) : 0,
      revenueThisMonth,
    },
    schedule: {
      weeklyAvailability: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ].map((day) => ({
        day,
        isAvailable: staffMapped.workingDays.includes(day),
        startTime: "09:00",
        endTime: "17:00",
      })),
    },
    assignedServices,
  };
}

// ── Bookings ──────────────────────────────────────────────────────────────────

type BookingRow = {
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
  staff_members: { name: string } | null;
};

function mapBooking(row: BookingRow): CatalogBooking {
  // Auto-mark past confirmed bookings as completed in the UI.
  // Rule: if a booking has ended (end_time < now) and it was confirmed, show it as completed.
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
    staffName: row.staff_members?.name ?? "Unassigned",
    startTime: row.start_time,
    endTime: row.end_time,
    status: derivedStatus,
    depositPaid: row.deposit_paid,
    totalAmount: Number(row.total_amount),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

const bookingSelect = `
  id, client_id, service_id, staff_id, start_time, end_time,
  status, deposit_paid, total_amount, notes, created_at,
  clients(name, phone),
  services(name, color),
  staff_members(name)
`;

export async function fetchBookings(status?: BookingStatus): Promise<CatalogBooking[]> {
  const businessId = await ensureBusiness();
  let query = supabase
    .from("bookings")
    .select(bookingSelect)
    .eq("business_id", businessId)
    .order("start_time", { ascending: false });

  if (status) {
    // "completed" is a derived UI status for past confirmed bookings.
    // When the caller asks for completed, include both real completed and confirmed,
    // then map+filter locally.
    if (status === "completed") {
      query = query.in("status", ["completed", "confirmed"]);
    } else {
      query = query.eq("status", status);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const mapped = (data as BookingRow[]).map(mapBooking);
  return status ? mapped.filter((b) => b.status === status) : mapped;
}

export async function confirmBooking(id: string): Promise<CatalogBooking> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", id)
    .eq("business_id", businessId)
    .select(bookingSelect)
    .single();

  if (error) throw new Error(error.message);
  // Supabase nested select typing is loose; cast via unknown to satisfy TS.
  return mapBooking(data as unknown as BookingRow);
}

export async function cancelBooking(id: string): Promise<CatalogBooking> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("business_id", businessId)
    .select(bookingSelect)
    .single();

  if (error) throw new Error(error.message);
  // Supabase nested select typing is loose; cast via unknown to satisfy TS.
  return mapBooking(data as unknown as BookingRow);
}

export async function rescheduleBooking(id: string, startTime: string): Promise<CatalogBooking> {
  const businessId = await ensureBusiness();

  const { data: current, error: currentError } = await supabase
    .from("bookings")
    .select("start_time, end_time")
    .eq("id", id)
    .eq("business_id", businessId)
    .single();

  if (currentError) throw new Error(currentError.message);

  const duration = new Date(current.end_time).getTime() - new Date(current.start_time).getTime();
  const start = new Date(startTime);
  const end = new Date(start.getTime() + duration);

  const { data, error } = await supabase
    .from("bookings")
    .update({ start_time: start.toISOString(), end_time: end.toISOString() })
    .eq("id", id)
    .eq("business_id", businessId)
    .select(bookingSelect)
    .single();

  if (error) {
    if (error.code === "23P01") {
      throw new Error("This staff member already has a booking at that time.");
    }
    throw new Error(error.message);
  }
  // Supabase nested select typing is loose; cast via unknown to satisfy TS.
  return mapBooking(data as unknown as BookingRow);
}

export async function fetchCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("bookings")
    .select(bookingSelect)
    .eq("business_id", businessId)
    .gte("start_time", from)
    .lte("start_time", to)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true });

  if (error) throw new Error(error.message);

  const now = Date.now();
  return (data as BookingRow[]).map((row) => ({
    id: row.id,
    bookingId: row.id,
    clientName: row.clients?.name ?? "Client",
    clientPhone: row.clients?.phone ?? null,
    serviceName: row.services?.name ?? "Service",
    staffName: row.staff_members?.name ?? "Unassigned",
    staffId: row.staff_id,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status === "confirmed" && new Date(row.end_time).getTime() < now ? "completed" : row.status,
    depositPaid: row.deposit_paid,
    color: row.services?.color ?? SERVICE_COLOR,
    notes: row.notes,
  }));
}

export async function createBooking(input: BookingInput): Promise<CatalogBooking> {
  const businessId = await ensureBusiness();

  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, price, duration")
    .eq("id", input.serviceId)
    .eq("business_id", businessId)
    .single();

  if (serviceError) throw new Error(serviceError.message);

  const start = new Date(input.startTime);
  const end = new Date(start.getTime() + (service.duration as number) * 60_000);

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      business_id: businessId,
      client_id: input.clientId,
      service_id: input.serviceId,
      staff_id: input.staffId || null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "pending",
      deposit_paid: false,
      total_amount: service.price,
      notes: input.notes ?? null,
    })
    .select(bookingSelect)
    .single();

  if (error) {
    if (error.code === "23P01") {
      throw new Error("This staff member already has a booking at that time.");
    }
    throw new Error(error.message);
  }
  return mapBooking(data as BookingRow);
}

export type BusinessBookingSlotsInput = {
  serviceId: string;
  staffId?: string | null;
  date: string; // YYYY-MM-DD
};

export async function fetchBusinessBookingSlots(
  input: BusinessBookingSlotsInput,
): Promise<BookingSlot[]> {
  const businessId = await ensureBusiness();

  const { data, error } = await supabase.rpc("get_business_booking_slots", {
    p_business_id: businessId,
    p_service_id: input.serviceId,
    p_date: input.date,
    p_staff_id: input.staffId ?? null,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: { start_time: string; end_time: string }) => ({
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

// ── Payments ──────────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string;
  client_id: string;
  booking_id: string | null;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  type: PaymentType;
  provider_reference: string | null;
  paid_at: string;
  created_at: string;
  clients: { name: string } | { name: string }[] | null;
};

const paymentSelect = `
  id, client_id, booking_id, amount, method, status, type, provider_reference, paid_at, created_at,
  clients(name)
`;

function mapPayment(row: PaymentRow): CatalogPayment {
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;

  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.name ?? "Unknown",
    bookingId: row.booking_id,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    type: row.type,
    providerReference: row.provider_reference,
    date: row.paid_at,
    createdAt: row.created_at,
  };
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function monthBounds(offsetMonths: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1);
  return { start, end };
}

function summarizePayments(
  payments: CatalogPayment[],
  from: Date,
  to: Date,
): Pick<PaymentSummary, "totalRevenue" | "depositsCollected" | "outstandingPayments" | "refunds"> {
  const inRange = payments.filter((p) => {
    const d = new Date(p.date);
    return d >= from && d < to;
  });
  const completed = inRange.filter((p) => p.status === "completed");

  return {
    totalRevenue: completed
      .filter((p) => p.type !== "refund")
      .reduce((sum, p) => sum + p.amount, 0),
    depositsCollected: completed
      .filter((p) => p.type === "deposit")
      .reduce((sum, p) => sum + p.amount, 0),
    outstandingPayments: inRange
      .filter((p) => p.status === "pending")
      .reduce((sum, p) => sum + p.amount, 0),
    refunds: inRange.filter((p) => p.type === "refund").reduce((sum, p) => sum + p.amount, 0),
  };
}

async function fetchClientPayments(clientId: string) {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("payments")
    .select(paymentSelect)
    .eq("business_id", businessId)
    .eq("client_id", clientId)
    .order("paid_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as PaymentRow[]).map(mapPayment);
}

export async function fetchPayments(filters?: {
  method?: PaymentMethod;
  status?: PaymentStatus;
}): Promise<CatalogPayment[]> {
  const businessId = await ensureBusiness();
  let query = supabase
    .from("payments")
    .select(paymentSelect)
    .eq("business_id", businessId)
    .order("paid_at", { ascending: false });

  if (filters?.method) query = query.eq("method", filters.method);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as PaymentRow[]).map(mapPayment);
}

export async function fetchPaymentsSummary(): Promise<PaymentSummary> {
  const payments = await fetchPayments();
  const current = monthBounds(0);
  const previous = monthBounds(-1);

  const thisMonth = summarizePayments(payments, current.start, current.end);
  const lastMonth = summarizePayments(payments, previous.start, previous.end);

  return {
    ...thisMonth,
    revenueChange: percentChange(thisMonth.totalRevenue, lastMonth.totalRevenue),
    depositsChange: percentChange(thisMonth.depositsCollected, lastMonth.depositsCollected),
    outstandingChange: percentChange(thisMonth.outstandingPayments, lastMonth.outstandingPayments),
    refundsChange: percentChange(thisMonth.refunds, lastMonth.refunds),
  };
}

export async function createPayment(input: PaymentInput): Promise<CatalogPayment> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("payments")
    .insert({
      business_id: businessId,
      client_id: input.clientId,
      booking_id: input.bookingId ?? null,
      amount: input.amount,
      method: input.method,
      status: input.status ?? "completed",
      type: input.type,
      paid_at: input.paidAt ?? new Date().toISOString(),
      notes: input.notes ?? null,
    })
    .select(paymentSelect)
    .single();

  if (error) throw new Error(error.message);
  return mapPayment(data as PaymentRow);
}

export const catalogKeys = {
  services: ["catalog", "services"] as const,
  clients: ["catalog", "clients"] as const,
  staff: ["catalog", "staff"] as const,
  bookings: (status?: string) => ["catalog", "bookings", status ?? "all"] as const,
  calendar: (from: string, to: string) => ["catalog", "calendar", from, to] as const,
  client: (id: string) => ["catalog", "client", id] as const,
  staffMember: (id: string) => ["catalog", "staff", id] as const,
  service: (id: string) => ["catalog", "service", id] as const,
  payments: (method?: string) => ["catalog", "payments", method ?? "all"] as const,
  paymentsSummary: ["catalog", "payments", "summary"] as const,
  subscription: ["catalog", "subscription"] as const,
};
