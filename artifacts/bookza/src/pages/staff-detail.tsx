import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  catalogKeys,
  deleteStaff,
  fetchStaffProfile,
  updateStaff,
  updateStaffWorkingDays,
} from "@/lib/catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Phone,
  Mail,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Star,
  CalendarIcon,
  MoreHorizontal,
  Pencil,
  ClipboardList,
  Clock,
  BriefcaseBusiness,
  Trash2,
  Search,
  Save,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link, useLocation } from "wouter";
import { format, isToday } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DetailPageSkeleton } from "@/components/skeletons/page-skeletons";

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

type StaffDetailSection = "overview" | "schedule" | "bookings" | "services" | "settings";
type BookingStatusFilter = "all" | "today" | "upcoming" | "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
type BookingDateFilter = "all" | "today" | "this_week" | "this_month" | "last_30";
type BookingSort = "soonest" | "latest" | "newest_created";

function getStatusColor(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-primary/10 text-primary border-primary/20";
    case "pending":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "cancelled":
      return "bg-[#dc4c5a]/10 text-[#b93443] border-[#dc4c5a]/20";
    case "completed":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "no_show":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export default function StaffDetailPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<StaffDetailSection>("overview");
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState<BookingStatusFilter>("all");
  const [bookingDateFilter, setBookingDateFilter] = useState<BookingDateFilter>("all");
  const [bookingSort, setBookingSort] = useState<BookingSort>("soonest");
  const [form, setForm] = useState({
    name: "",
    position: "",
    phone: "",
    email: "",
    isActive: true,
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.staffMember(id),
    queryFn: () => fetchStaffProfile(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    const next = profile?.staffMember?.workingDays ?? [];
    setWorkingDays(next);
  }, [profile?.staffMember?.id, profile?.staffMember?.workingDays?.join(",")]);

  const weekly = useMemo(() => {
    const availability = profile?.schedule.weeklyAvailability ?? [];
    return DAYS.map((day) => {
      const saved = availability.find((item) => item.day === day);
      const isAvailable = workingDays.includes(day);
      return {
        day,
        isAvailable,
        startTime: saved?.startTime ?? "09:00",
        endTime: saved?.endTime ?? "17:00",
      };
    });
  }, [profile?.schedule.weeklyAvailability, workingDays]);

  const saveWorkingDaysMutation = useMutation({
    mutationFn: (days: string[]) => updateStaffWorkingDays(id, days),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staffMember(id) });
      toast({ title: "Working days saved" });
    },
    onError: (err) => {
      toast({
        title: "Could not save working days",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateStaff>[1]) => updateStaff(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staffMember(id) });
      toast({ title: "Staff member updated" });
      setEditOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Could not update staff member",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: () => deleteStaff(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      toast({
        title: "Staff member deleted",
        description: "They have been permanently removed.",
      });
      setDeleteOpen(false);
      navigate("/staff");
    },
    onError: (err) => {
      toast({
        title: "Could not delete staff member",
        description: err instanceof Error ? err.message : "Please archive them instead.",
        variant: "destructive",
      });
    },
  });

  const handleSaveStaff = () => {
    if (!form.name.trim() || !form.position) {
      toast({ title: "Name and position are required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      name: form.name.trim(),
      position: form.position,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      isActive: form.isActive,
    });
  };

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!profile) return <div>Staff member not found</div>;

  const { staffMember, upcomingBookings, performanceMetrics } = profile;
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;
  const workingDaysCount = workingDays.length;
  const savedWorkingDays = staffMember.workingDays ?? [];
  const hasUnsavedWorkingDays =
    workingDays.length !== savedWorkingDays.length ||
    workingDays.some((day) => !savedWorkingDays.includes(day));
  const bookingMatchesDateFilter = (startTime: string) => {
    if (bookingDateFilter === "all") return true;

    const bookingDate = new Date(startTime);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfToday.getDate() + 1);

    if (bookingDateFilter === "today") {
      return bookingDate >= startOfToday && bookingDate < startOfTomorrow;
    }

    if (bookingDateFilter === "this_week") {
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      return bookingDate >= startOfWeek && bookingDate < endOfWeek;
    }

    if (bookingDateFilter === "this_month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return bookingDate >= startOfMonth && bookingDate < startOfNextMonth;
    }

    const last30Days = new Date(startOfToday);
    last30Days.setDate(startOfToday.getDate() - 30);
    return bookingDate >= last30Days;
  };
  const filteredBookings = upcomingBookings
    .filter((booking) => {
      const search = bookingSearch.trim().toLowerCase();
      const matchesSearch =
        !search ||
        booking.clientName.toLowerCase().includes(search) ||
        booking.serviceName.toLowerCase().includes(search);

      if (!matchesSearch || !bookingMatchesDateFilter(booking.startTime)) return false;
      if (bookingStatusFilter === "all") return true;
      if (bookingStatusFilter === "today") return isToday(new Date(booking.startTime));
      if (bookingStatusFilter === "upcoming") {
        return (
          new Date(booking.startTime).getTime() > Date.now() &&
          !["cancelled", "no_show", "completed"].includes(booking.status)
        );
      }

      return booking.status === bookingStatusFilter;
    })
    .sort((a, b) => {
      if (bookingSort === "latest") return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      if (bookingSort === "newest_created") {
        return new Date(b.createdAt ?? b.startTime).getTime() - new Date(a.createdAt ?? a.startTime).getTime();
      }
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  const hasBookingFilters =
    Boolean(bookingSearch.trim()) || bookingStatusFilter !== "all" || bookingDateFilter !== "all" || bookingSort !== "soonest";
  const clearBookingFilters = () => {
    setBookingSearch("");
    setBookingStatusFilter("all");
    setBookingDateFilter("all");
    setBookingSort("soonest");
  };
  const sectionMeta: Array<{ value: StaffDetailSection; label: string; description: string }> = [
    { value: "overview", label: "Overview", description: "Staff summary and activity" },
    { value: "schedule", label: "Schedule", description: "Weekly working days" },
    { value: "bookings", label: "Bookings", description: "Upcoming appointments" },
    { value: "services", label: "Services", description: "Assigned services coming soon" },
    { value: "settings", label: "Settings", description: "Edit, availability, services, or delete" },
  ];
  const activeSectionIndex = sectionMeta.findIndex((section) => section.value === activeSection);
  const activeSectionMeta = sectionMeta[activeSectionIndex] ?? sectionMeta[0];
  const goToSchedule = () => {
    setActiveSection("schedule");
    scrollToSection("staff-sections");
  };

  const openEdit = () => {
    setForm({
      name: staffMember.name,
      position: staffMember.position,
      phone: staffMember.phone ?? "",
      email: staffMember.email ?? "",
      isActive: staffMember.isActive,
    });
    setEditOpen(true);
  };

  const markInactive = () => {
    updateMutation.mutate({ isActive: false });
  };

  const scrollToSection = (sectionId: string) => {
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
  };

  const showManageServicesSoon = () => {
    toast({
      title: "Coming soon",
      description: "Service assignment controls are coming soon.",
    });
  };

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 bg-card">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Staff actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={openEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit staff member
        </DropdownMenuItem>
        <DropdownMenuItem onClick={showManageServicesSoon}>
          <BriefcaseBusiness className="mr-2 h-4 w-4" />
          Manage services
        </DropdownMenuItem>
        <DropdownMenuItem onClick={goToSchedule}>
          <Clock className="mr-2 h-4 w-4" />
          Set availability
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!staffMember.isActive} onClick={markInactive}>
          <AlertCircle className="mr-2 h-4 w-4" />
          Mark as inactive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-[#b93443] focus:text-[#b93443]"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete staff member
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/60 shadow-none">
              <CardHeader className="border-b border-border/60 pb-4">
                <CardTitle className="text-lg">Staff details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
                {[
                  { label: "Name", value: staffMember.name },
                  { label: "Position", value: staffMember.position },
                  { label: "Phone", value: staffMember.phone || "No phone" },
                  { label: "Email", value: staffMember.email || "No email" },
                  { label: "Status", value: staffMember.isActive ? "Active" : "Inactive" },
                  { label: "Working days", value: `${workingDaysCount} ${workingDaysCount === 1 ? "day" : "days"}` },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-none">
              <CardHeader className="border-b border-border/60 pb-4">
                <CardTitle className="text-lg">Performance summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
                {[
                  {
                    label: "Average rating",
                    value: performanceMetrics.averageRating ? `${performanceMetrics.averageRating.toFixed(1)} / 5` : "No ratings yet",
                    icon: Star,
                  },
                  { label: "Booking completion", value: performanceMetrics.completionRate > 0 ? `${performanceMetrics.completionRate}%` : "No data yet", icon: CheckCircle2 },
                  { label: "No-show rate", value: performanceMetrics.noShowRate > 0 ? `${performanceMetrics.noShowRate}%` : "No data yet", icon: AlertCircle },
                  { label: "Revenue this month", value: performanceMetrics.revenueThisMonth > 0 ? formatCurrency(performanceMetrics.revenueThisMonth) : "No revenue yet", icon: TrendingUp },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-xl border border-border/60 bg-muted/20 p-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                        <p className="truncate text-xs font-medium uppercase tracking-wider">{item.label}</p>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">{item.value}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-none lg:col-span-2">
              <CardHeader className="border-b border-border/60 pb-4">
                <CardTitle className="text-lg">Activity insight</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                <p className="text-sm leading-6 text-muted-foreground">
                  {!staffMember.isActive
                    ? "This staff member is currently inactive."
                    : upcomingBookings.length > 0
                      ? `This staff member has ${upcomingBookings.length} upcoming bookings and has generated ${formatCurrency(performanceMetrics.revenueThisMonth)} this month.`
                      : "This staff member has no upcoming bookings scheduled."}
                </p>
              </CardContent>
            </Card>
          </div>
        );

      case "schedule":
        return (
          <Card id="weekly-schedule" className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 py-4">
              <div>
                <CardTitle className="text-lg">Weekly Schedule</CardTitle>
                <p className="text-sm text-muted-foreground">Working hours by day.</p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {weekly.map((day) => (
                  <div
                    key={day.day}
                    className={cn(
                      "grid grid-cols-[1fr_auto] items-center gap-3 p-4 sm:grid-cols-[1fr_120px_120px_auto]",
                      !day.isAvailable && "bg-muted/30",
                    )}
                  >
                    <div>
                      <p className="font-semibold capitalize">{day.day}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "mt-1 rounded-full text-xs",
                          day.isAvailable
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground",
                        )}
                      >
                        {day.isAvailable ? "Working" : "Off"}
                      </Badge>
                    </div>
                    <div className="hidden text-sm sm:block">
                      <p className="text-xs text-muted-foreground">Start</p>
                      <p className="font-medium">{day.isAvailable ? day.startTime : "-"}</p>
                    </div>
                    <div className="hidden text-sm sm:block">
                      <p className="text-xs text-muted-foreground">End</p>
                      <p className="font-medium">{day.isAvailable ? day.endTime : "-"}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-sm sm:hidden">
                        <p className="font-medium">
                          {day.isAvailable ? `${day.startTime} - ${day.endTime}` : "Closed"}
                        </p>
                      </div>
                      <Switch
                        checked={day.isAvailable}
                        onCheckedChange={(checked) => {
                          setWorkingDays((current) => {
                            const next = new Set(current);
                            if (checked) next.add(day.day);
                            else next.delete(day.day);
                            return Array.from(next);
                          });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );

      case "bookings":
        return (
          <Card className="overflow-hidden border-border/60 shadow-none">
            <CardHeader className="space-y-4 border-b border-border/60 py-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Bookings</CardTitle>
                {upcomingBookings.length > 0 && (
                  <p className="text-sm text-muted-foreground">Showing {filteredBookings.length} of {upcomingBookings.length} bookings</p>
                )}
              </div>
              {upcomingBookings.length > 0 && (
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={bookingSearch}
                      onChange={(event) => setBookingSearch(event.target.value)}
                      placeholder="Search client or service..."
                      className="w-full bg-card pl-9"
                    />
                  </div>
                  <Select value={bookingStatusFilter} onValueChange={(value) => setBookingStatusFilter(value as BookingStatusFilter)}>
                    <SelectTrigger className="w-full bg-card lg:w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no_show">No-show</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={bookingDateFilter} onValueChange={(value) => setBookingDateFilter(value as BookingDateFilter)}>
                    <SelectTrigger className="w-full bg-card lg:w-[150px]"><SelectValue placeholder="All time" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="this_week">This week</SelectItem>
                      <SelectItem value="this_month">This month</SelectItem>
                      <SelectItem value="last_30">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={bookingSort} onValueChange={(value) => setBookingSort(value as BookingSort)}>
                    <SelectTrigger className="w-full bg-card lg:w-[170px]"><SelectValue placeholder="Soonest first" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="soonest">Soonest first</SelectItem>
                      <SelectItem value="latest">Latest first</SelectItem>
                      <SelectItem value="newest_created">Newest created first</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {upcomingBookings.length === 0 ? (
                <div className="p-8 text-center">
                  <CalendarIcon className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
                  <h3 className="font-medium">No upcoming bookings</h3>
                  <p className="mt-1 text-sm text-muted-foreground">This schedule is clear for now.</p>
                </div>
              ) : filteredBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                  <CalendarIcon className="h-10 w-10 rounded-full bg-muted p-2 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">No bookings match these filters.</p>
                  <Button variant="outline" size="sm" className="bg-card" onClick={clearBookingFilters} disabled={!hasBookingFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredBookings.map((booking) => {
                    const start = new Date(booking.startTime);
                    return (
                      <div key={booking.id} className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold">{booking.serviceName}</p>
                            <Badge
                              variant="outline"
                              className={cn("rounded-full text-[11px] capitalize", getStatusColor(booking.status))}
                            >
                              {booking.status.replace("_", " ")}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {booking.clientName} - {isToday(start) ? "Today" : format(start, "dd MMM")} at {format(start, "HH:mm")}
                          </p>
                        </div>
                        <Link href={`/bookings?q=${encodeURIComponent(booking.clientName)}`}>
                          <Button variant="outline" size="sm" className="h-8">
                            View
                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "services":
        return (
          <Card className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">Assigned Services</CardTitle>
                <Badge variant="secondary" className="rounded-full">Coming soon</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Soon you will be able to choose exactly which services this staff member can perform.
              </p>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {["Service assignment", "Staff-specific booking rules", "Service availability", "Performance by service"].map((item) => (
                  <div key={item} className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <ClipboardList className="mb-3 h-5 w-5 text-primary" />
                    <p className="text-sm font-semibold text-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );

      case "settings":
        return (
          <Card className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-lg">Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <button type="button" onClick={openEdit} className="rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                <Pencil className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Edit staff details</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Update name, role, contact details, and active status.</p>
              </button>
              <button type="button" onClick={goToSchedule} className="rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                <Clock className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Set availability</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Open this staff member's weekly schedule.</p>
              </button>
              <button type="button" onClick={showManageServicesSoon} className="rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                <BriefcaseBusiness className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Manage services</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Service assignment controls are coming soon.</p>
              </button>
              <button
                type="button"
                disabled={!staffMember.isActive || updateMutation.isPending}
                onClick={markInactive}
                className="rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
              >
                <AlertCircle className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Mark as inactive</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Hide this staff member from active scheduling.</p>
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-left transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="mb-3 h-5 w-5 text-[#b93443]" />
                <p className="text-sm font-semibold text-[#b93443]">Delete staff member</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Permanently remove this staff member if records allow it.</p>
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
      <Card className="overflow-hidden border-border/60 shadow-none">
        <CardContent className="p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <Link href="/staff">
              <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" /> Staff
              </Button>
            </Link>
            {actionsMenu}
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="h-16 w-16 border">
              <AvatarImage src={staffMember.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">
                {staffMember.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-2xl font-bold tracking-tight text-foreground md:text-3xl">{staffMember.name}</h1>
                <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                  {staffMember.position}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    staffMember.isActive
                      ? "border-primary/20 bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {staffMember.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Phone className="h-4 w-4 text-primary/60" />{staffMember.phone || "No phone"}</span>
                <span className="flex items-center gap-1.5"><Mail className="h-4 w-4 text-primary/60" />{staffMember.email || "No email"}</span>
                <span className="flex items-center gap-1.5"><CalendarIcon className="h-4 w-4 text-primary/60" />{workingDaysCount} working {workingDaysCount === 1 ? "day" : "days"}</span>
                <span className="flex items-center gap-1.5"><ClipboardList className="h-4 w-4 text-primary/60" />{upcomingBookings.length} upcoming</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div id="staff-sections" className="space-y-4">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-3">
            <div className="mb-3 px-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Staff sections</p>
            </div>
            <nav className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {sectionMeta.map((section, index) => {
                const selected = activeSection === section.value;
                return (
                  <button
                    key={section.value}
                    type="button"
                    onClick={() => setActiveSection(section.value)}
                    className={cn(
                      "min-w-0 rounded-lg border p-2 text-center transition-colors lg:p-3",
                      selected
                        ? "border-primary bg-primary/5 text-primary shadow-none"
                        : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                        selected ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="mt-2 block truncate text-xs font-medium sm:text-sm">{section.label}</span>
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        <div className="rounded-xl border border-border/60 bg-card/75 p-4 shadow-none">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Section {activeSectionIndex + 1} of {sectionMeta.length}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{activeSectionMeta.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{activeSectionMeta.description}</p>
        </div>

        <div className="min-w-0">{renderSection()}</div>
      </div>

      {hasUnsavedWorkingDays && (
        <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
          <Button
            className="h-11 rounded-full bg-primary px-5 text-white shadow-lg shadow-primary/20 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 hover:bg-primary/90"
            onClick={() => saveWorkingDaysMutation.mutate(workingDays)}
            disabled={saveWorkingDaysMutation.isPending}
          >
            {saveWorkingDaysMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save changes
              </>
            )}
          </Button>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Staff Member</DialogTitle>
            <DialogDescription>Update this team member's details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Full Name *</Label>
                <Input
                  placeholder="e.g. Sipho Nkosi"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Position *</Label>
                <Input
                  placeholder="e.g. Senior Barber"
                  value={form.position}
                  onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  placeholder="+27 82 000 0000"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="staff@yourbusiness.co.za"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Active / visible on calendar</Label>
                <p className="text-xs text-muted-foreground">
                  Clients can book this staff member online.
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleSaveStaff}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete {staffMember.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the staff member. Staff with bookings on record cannot be deleted;
              mark them as inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-[#dc4c5a] text-white hover:bg-[#c83d4b]"
              disabled={deleteStaffMutation.isPending}
              onClick={() => deleteStaffMutation.mutate()}
            >
              {deleteStaffMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete staff member"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
