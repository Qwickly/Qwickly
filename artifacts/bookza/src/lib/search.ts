import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";

export type SearchResultType = "booking" | "client" | "service" | "staff" | "page";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export async function searchPlatform(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const businessId = await ensureBusiness();
  const searchTerm = query.trim().toLowerCase();
  const results: SearchResult[] = [];

  try {
    // Search bookings
    const { data: bookings } = await supabase
      .from("bookings")
      .select(`
        id,
        start_time,
        status,
        clients!inner (
          id,
          name,
          phone
        ),
        services!inner (
          id,
          name
        ),
        staff_members (
          id,
          name
        )
      `)
      .eq("business_id", businessId)
      .or(`clients.name.ilike.%${searchTerm}%,clients.phone.ilike.%${searchTerm}%`)
      .order("start_time", { ascending: false })
      .limit(5);

    if (bookings) {
      bookings.forEach((booking: any) => {
        const clientName = booking.clients?.[0]?.name || "Unknown";
        const serviceName = booking.services?.[0]?.name || "Unknown";
        const staffName = booking.staff_members?.[0]?.name || null;
        
        results.push({
          id: booking.id,
          type: "booking",
          title: `${serviceName} - ${clientName}`,
          subtitle: staffName ? `with ${staffName}` : undefined,
          url: `/bookings/${booking.id}`,
          metadata: {
            status: booking.status,
            startTime: booking.start_time,
          },
        });
      });
    }

    // Search clients
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, phone, email")
      .eq("business_id", businessId)
      .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .order("created_at", { ascending: false })
      .limit(5);

    if (clients) {
      clients.forEach((client) => {
        results.push({
          id: client.id,
          type: "client",
          title: client.name,
          subtitle: client.phone || client.email || undefined,
          url: `/clients/${client.id}`,
        });
      });
    }

    // Search services
    const { data: services } = await supabase
      .from("services")
      .select("id, name, description, is_active")
      .eq("business_id", businessId)
      .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
      .eq("is_active", true)
      .order("name")
      .limit(5);

    if (services) {
      services.forEach((service) => {
        results.push({
          id: service.id,
          type: "service",
          title: service.name,
          subtitle: service.description ? service.description.substring(0, 50) + "..." : undefined,
          url: `/services/${service.id}`,
        });
      });
    }

    // Search staff
    const { data: staff } = await supabase
      .from("staff_members")
      .select("id, name, position, email, phone")
      .eq("business_id", businessId)
      .or(`name.ilike.%${searchTerm}%,position.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .eq("is_active", true)
      .order("name")
      .limit(5);

    if (staff) {
      staff.forEach((member) => {
        results.push({
          id: member.id,
          type: "staff",
          title: member.name,
          subtitle: member.position || member.email || undefined,
          url: `/staff/${member.id}`,
        });
      });
    }

    // Search pages (navigation)
    const pages = [
      { id: "settings", title: "Settings", subtitle: "Business profile, notifications, team", url: "/settings" },
      { id: "staff", title: "Staff", subtitle: "Manage team members and schedules", url: "/staff" },
      { id: "services", title: "Services", subtitle: "Manage your services and pricing", url: "/services" },
      { id: "clients", title: "Clients", subtitle: "View and manage client database", url: "/clients" },
      { id: "bookings", title: "Bookings", subtitle: "View and manage bookings", url: "/bookings" },
      { id: "billing", title: "Billing", subtitle: "Subscription and payment management", url: "/billing" },
      { id: "whatsapp", title: "WhatsApp", subtitle: "Messaging and automation", url: "/whatsapp" },
      { id: "marketing", title: "Marketing", subtitle: "Campaigns and promotions", url: "/marketing" },
      { id: "analytics", title: "Analytics", subtitle: "Business insights and reports", url: "/analytics" },
    ];

    pages.forEach((page) => {
      if (page.title.toLowerCase().includes(searchTerm) || page.subtitle.toLowerCase().includes(searchTerm)) {
        results.push({
          id: page.id,
          type: "page",
          title: page.title,
          subtitle: page.subtitle,
          url: page.url,
        });
      }
    });

    return results.slice(0, 15); // Limit total results
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}
