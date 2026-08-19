import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  catalogKeys,
  fetchServiceProfile,
  updateService,
} from "@/lib/catalog";
import {
  ServiceFormFields,
  getServiceIcon,
  buildServicePayload,
  validateServiceForm,
  formFromService,
  emptyServiceForm,
} from "@/components/services/service-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { DetailHeroCard, DetailSectionNav } from "@/components/layout/detail-page-ui";
import { InfoTile } from "@/components/layout/page-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ArrowRight,
  Clock,
  Wallet,
  TrendingUp,
  CalendarClock,
  ClipboardList,
  CheckCircle2,
  Pencil,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DetailPageSkeleton } from "@/components/skeletons/page-skeletons";

type ServiceDetailSection = "overview" | "bookings" | "staff" | "settings";
type BookingStatusFilter = "all" | "upcoming" | "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
type BookingSort = "newest" | "oldest";
type StaffSort = "most_bookings" | "name_asc" | "name_desc";

export default function ServiceDetailPage({ id }: { id: string }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.service(id),
    queryFn: () => fetchServiceProfile(id),
    enabled: Boolean(id),
  });

  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(emptyServiceForm);
  const [activeSection, setActiveSection] = useState<ServiceDetailSection>("overview");
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState<BookingStatusFilter>("all");
  const [bookingSort, setBookingSort] = useState<BookingSort>("newest");
  const [staffSearch, setStaffSearch] = useState("");
  const [staffSort, setStaffSort] = useState<StaffSort>("most_bookings");
  const [bookingPage, setBookingPage] = useState(1);
  const [staffPage, setStaffPage] = useState(1);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: catalogKeys.service(id) });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.services });
  };

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateService>[1]) => updateService(id, input),
    onSuccess: () => {
      invalidate();
      toast("Service updated");
      setEditOpen(false);
    },
    onError: (err) => {
      toast.error("Could not update service", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) => {
      const base = profile ? buildServicePayload(formFromService(profile.service)) : null;
      if (!base) throw new Error("Service not loaded");
      return updateService(id, { ...base, isActive });
    },
    onSuccess: (_data, isActive) => {
      invalidate();
      toast(isActive ? "Service restored" : "Service archived");
    },
    onError: (err) => {
      toast.error("Could not update service", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!profile) return <div>Service not found</div>;

  const { service, metrics, recentBookings, staff } = profile;
  const ServiceIcon = getServiceIcon(service.icon);
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const openEdit = () => {
    setForm(formFromService(service));
    setEditOpen(true);
  };

  const performanceMetrics = [
    { label: "Total bookings", value: metrics.totalBookings > 0 ? metrics.totalBookings.toString() : "None yet", empty: metrics.totalBookings === 0, icon: ClipboardList },
    { label: "Completed", value: metrics.completedBookings > 0 ? metrics.completedBookings.toString() : "None yet", empty: metrics.completedBookings === 0, icon: CheckCircle2 },
    { label: "Upcoming", value: metrics.upcomingBookings > 0 ? metrics.upcomingBookings.toString() : "None scheduled", empty: metrics.upcomingBookings === 0, icon: CalendarClock },
    { label: "Revenue", value: metrics.revenue > 0 ? formatCurrency(metrics.revenue) : "No revenue yet", empty: metrics.revenue === 0, icon: TrendingUp },
  ];

  const normalizedBookingSearch = bookingSearch.trim().toLowerCase();
  const filteredBookings = recentBookings
    .filter((booking) => {
      const matchesSearch =
        !normalizedBookingSearch ||
        booking.clientName.toLowerCase().includes(normalizedBookingSearch) ||
        booking.staffName.toLowerCase().includes(normalizedBookingSearch);

      if (!matchesSearch) return false;
      if (bookingStatusFilter === "all") return true;
      if (bookingStatusFilter === "upcoming") {
        const inactiveStatuses = ["cancelled", "no_show", "completed"];
        return new Date(booking.startTime).getTime() > Date.now() && !inactiveStatuses.includes(booking.status);
      }

      return booking.status === bookingStatusFilter;
    })
    .sort((a, b) => {
      if (bookingSort === "oldest") {
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }

      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    });
  const hasBookingFilters = Boolean(normalizedBookingSearch) || bookingStatusFilter !== "all" || bookingSort !== "newest";

  const normalizedStaffSearch = staffSearch.trim().toLowerCase();
  const filteredStaff = staff
    .filter((member) => !normalizedStaffSearch || member.name.toLowerCase().includes(normalizedStaffSearch))
    .sort((a, b) => {
      if (staffSort === "name_asc") return a.name.localeCompare(b.name);
      if (staffSort === "name_desc") return b.name.localeCompare(a.name);
      return b.bookings - a.bookings;
    });
  const hasStaffFilters = Boolean(normalizedStaffSearch) || staffSort !== "most_bookings";
  const pageSize = 5;
  const bookingPageCount = Math.max(1, Math.ceil(filteredBookings.length / pageSize));
  const staffPageCount = Math.max(1, Math.ceil(filteredStaff.length / pageSize));
  const currentBookingPage = Math.min(bookingPage, bookingPageCount);
  const currentStaffPage = Math.min(staffPage, staffPageCount);
  const paginatedBookings = filteredBookings.slice((currentBookingPage - 1) * pageSize, currentBookingPage * pageSize);
  const paginatedStaff = filteredStaff.slice((currentStaffPage - 1) * pageSize, currentStaffPage * pageSize);

  const clearBookingFilters = () => {
    setBookingSearch("");
    setBookingStatusFilter("all");
    setBookingSort("newest");
    setBookingPage(1);
  };

  const clearStaffFilters = () => {
    setStaffSearch("");
    setStaffSort("most_bookings");
    setStaffPage(1);
  };

  const sectionMeta: Array<{
    value: ServiceDetailSection;
    label: string;
    description: string;
  }> = [
    { value: "overview", label: "Overview", description: "Performance and activity summary" },
    { value: "bookings", label: "Bookings", description: "Recent service bookings" },
    { value: "staff", label: "Staff", description: "People who perform it" },
    { value: "settings", label: "Settings", description: "Edit or archive service" },
  ];
  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">Service details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Duration", value: `${service.duration} min` },
                    { label: "Price", value: formatCurrency(service.price) },
                    { label: "Status", value: service.isActive ? "Active" : "Inactive" },
                    { label: "Revenue this month", value: formatCurrency(metrics.revenueThisMonth) },
                  ].map((item) => (
                    <InfoTile key={item.label}>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
                    </InfoTile>
                  ))}
                </div>
                <InfoTile>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {service.description || "No description provided."}
                  </p>
                </InfoTile>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">Performance summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Total bookings", value: metrics.totalBookings > 0 ? metrics.totalBookings.toString() : "None yet" },
                  { label: "Completed bookings", value: metrics.completedBookings > 0 ? metrics.completedBookings.toString() : "None yet" },
                  { label: "Upcoming bookings", value: metrics.upcomingBookings > 0 ? metrics.upcomingBookings.toString() : "None scheduled" },
                  { label: "Total revenue", value: metrics.revenue > 0 ? formatCurrency(metrics.revenue) : "No revenue yet" },
                ].map((item) => (
                  <InfoTile key={item.label}>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
                  </InfoTile>
                ))}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">Service activity insight</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  {metrics.totalBookings > 0
                    ? `This service has ${metrics.upcomingBookings} upcoming bookings and has generated ${formatCurrency(metrics.revenue)} in total revenue.`
                    : "This service has no bookings yet. Once clients start booking it, performance will appear here."}
                </p>
              </CardContent>
            </Card>
          </div>
        );

      case "bookings":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Bookings</CardTitle>
                {recentBookings.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Showing {filteredBookings.length} of {recentBookings.length} bookings
                  </p>
                )}
              </div>
              {recentBookings.length > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={bookingSearch}
                      onChange={(event) => {
                        setBookingSearch(event.target.value);
                        setBookingPage(1);
                      }}
                      placeholder="Search client or staff..."
                      className="w-full bg-card pl-9"
                    />
                  </div>
                  <Select
                    value={bookingStatusFilter}
                    onValueChange={(value) => {
                      setBookingStatusFilter(value as BookingStatusFilter);
                      setBookingPage(1);
                    }}
                  >
                    <SelectTrigger className="w-full bg-card sm:w-[160px]">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no_show">No Show</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={bookingSort}
                    onValueChange={(value) => {
                      setBookingSort(value as BookingSort);
                      setBookingPage(1);
                    }}
                  >
                    <SelectTrigger className="w-full bg-card sm:w-[150px]">
                      <SelectValue placeholder="Newest first" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="oldest">Oldest first</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {recentBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">No bookings yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">No bookings for this service yet.</p>
                  </div>
                </div>
              ) : filteredBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">No bookings match these filters.</p>
                    <p className="mt-1 text-sm text-muted-foreground">Try adjusting the search, status, or sort option.</p>
                  </div>
                  <Button variant="outline" size="sm" className="bg-card" onClick={clearBookingFilters} disabled={!hasBookingFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="divide-y divide-border/50">
                    {paginatedBookings.map((booking) => (
                      <Link key={booking.id} href={`/clients/${booking.clientId}`}>
                        <div className="flex items-start justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/40">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{booking.clientName}</p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {format(new Date(booking.startTime), "MMM d, yyyy")} at {format(new Date(booking.startTime), "h:mm a")}
                            </p>
                            <p className="mt-1 truncate text-sm text-muted-foreground">{booking.staffName}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <BookingStatusBadge status={booking.status} />
                            <p className="text-sm font-semibold text-foreground">{formatCurrency(booking.totalAmount)}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {bookingPageCount > 1 && (
                    <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        Page {currentBookingPage} of {bookingPageCount}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-card"
                          onClick={() => setBookingPage((page) => Math.max(1, page - 1))}
                          disabled={currentBookingPage === 1}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-card"
                          onClick={() => setBookingPage((page) => Math.min(bookingPageCount, page + 1))}
                          disabled={currentBookingPage === bookingPageCount}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "staff":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Performed by</CardTitle>
                {staff.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Showing {filteredStaff.length} of {staff.length} staff
                  </p>
                )}
              </div>
              {staff.length > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={staffSearch}
                      onChange={(event) => {
                        setStaffSearch(event.target.value);
                        setStaffPage(1);
                      }}
                      placeholder="Search staff..."
                      className="w-full bg-card pl-9"
                    />
                  </div>
                  <Select
                    value={staffSort}
                    onValueChange={(value) => {
                      setStaffSort(value as StaffSort);
                      setStaffPage(1);
                    }}
                  >
                    <SelectTrigger className="w-full bg-card sm:w-[180px]">
                      <SelectValue placeholder="Most bookings" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="most_bookings">Most bookings</SelectItem>
                      <SelectItem value="name_asc">Name A-Z</SelectItem>
                      <SelectItem value="name_desc">Name Z-A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {staff.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">No staff yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">No staff have performed this service yet.</p>
                  </div>
                </div>
              ) : filteredStaff.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">No staff match these filters.</p>
                    <p className="mt-1 text-sm text-muted-foreground">Try a different staff search or sort option.</p>
                  </div>
                  <Button variant="outline" size="sm" className="bg-card" onClick={clearStaffFilters} disabled={!hasStaffFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="divide-y divide-border/50">
                    {paginatedStaff.map((member) => (
                      <Link key={member.id} href={`/staff/${member.id}`}>
                        <div className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/40">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="h-10 w-10 border">
                              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                                {member.name.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">{member.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {member.bookings} {member.bookings === 1 ? "booking" : "bookings"}
                              </p>
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </Link>
                    ))}
                  </div>
                  {staffPageCount > 1 && (
                    <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        Page {currentStaffPage} of {staffPageCount}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-card"
                          onClick={() => setStaffPage((page) => Math.max(1, page - 1))}
                          disabled={currentStaffPage === 1}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-card"
                          onClick={() => setStaffPage((page) => Math.min(staffPageCount, page + 1))}
                          disabled={currentStaffPage === staffPageCount}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "settings":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-lg">Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={openEdit}
                className="rounded-xl border border-border/45 bg-muted/20 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <Pencil className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Edit service details</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Update name, description, duration, price, icon, and active status.</p>
              </button>
              <button
                type="button"
                disabled={activeMutation.isPending}
                onClick={() => activeMutation.mutate(!service.isActive)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
                  service.isActive
                    ? "border-destructive/20 bg-destructive/5 hover:bg-destructive/10"
                    : "border-border/60 bg-card hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                {service.isActive ? (
                  <Archive className="mb-3 h-5 w-5 text-destructive" />
                ) : (
                  <ArchiveRestore className="mb-3 h-5 w-5 text-primary" />
                )}
                <p className={cn("text-sm font-semibold", service.isActive ? "text-destructive" : "text-foreground")}>
                  {service.isActive ? "Archive service" : "Restore service"}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {service.isActive
                    ? "Hide this service from new client bookings."
                    : "Make this service available for client bookings again."}
                </p>
              </button>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <DetailHeroCard
        backHref="/services"
        backLabel="Services"
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10 bg-card">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Service actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openEdit}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit service
                </DropdownMenuItem>
                {service.isActive ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => activeMutation.mutate(false)}
                  >
                    <Archive className="mr-2 h-4 w-4" /> Archive service
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => activeMutation.mutate(true)}>
                    <ArchiveRestore className="mr-2 h-4 w-4" /> Restore service
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
        media={
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border bg-primary/10 text-primary">
            <ServiceIcon className="h-7 w-7" />
          </div>
        }
        title={service.name}
        badges={
          <Badge
            variant="outline"
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              service.isActive
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {service.isActive ? "Active" : "Inactive"}
          </Badge>
        }
        description={service.description || undefined}
        metaItems={
          <>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary/60" />{service.duration} min</span>
            <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4 text-primary/60" />{formatCurrency(service.price)}</span>
          </>
        }
      />

      <div className="space-y-4">
        <DetailSectionNav
          sections={sectionMeta}
          active={activeSection}
          onChange={(value) => setActiveSection(value as ServiceDetailSection)}
          navLabel="Service sections"
        />

        <div className="min-w-0">{renderSection()}</div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit service</DialogTitle>
            <DialogDescription>Update the details for this service.</DialogDescription>
          </DialogHeader>
          <ServiceFormFields form={form} setForm={setForm} idPrefix="edit-" />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={updateMutation.isPending || !form.name.trim() || !form.price}
              onClick={() => {
                const error = validateServiceForm(form);
                if (error) {
                  toast.error("Check the form", { description: error });
                  return;
                }
                updateMutation.mutate(buildServicePayload(form));
              }}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



