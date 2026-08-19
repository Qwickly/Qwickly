import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  MessageSquareText,
  Plus,
  Scissors,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { NewBookingDialog } from "@/components/booking/NewBookingDialog";
import { GettingStartedBanner } from "@/components/dashboard/GettingStartedBanner";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartSkeleton, ListRowsSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookingStatusBadge, bookingStatusSurface } from "@/components/ui/status-badge";
import { PageHeader, PageEmptyState, InfoTile } from "@/components/layout/page-ui";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  cancelBooking,
  catalogKeys,
  completeBooking,
  confirmBooking,
  createPayment,
  markBookingNoShow,
} from "@/lib/catalog";
import { bookingPageUrl, fetchBookingPageSettings } from "@/lib/booking-page";
import {
  dashboardKeys,
  fetchDashboardOperations,
  type DashboardDay,
} from "@/lib/dashboard";
import type { CatalogBooking } from "@/types/catalog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function formatCurrency(value: number) {
  return `R ${Math.round(value).toLocaleString()}`;
}

function phoneHref(phone: string | null) {
  if (!phone) return "/clients";
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : "/whatsapp";
}

function TodaySummary({
  data,
  loading,
}: {
  data: Awaited<ReturnType<typeof fetchDashboardOperations>> | undefined;
  loading: boolean;
}) {
  const today = data?.today;
  const stats = [
    {
      title: "Today's bookings",
      value: today?.bookingCount ?? 0,
      icon: CalendarDays,
      detail: "Active bookings today",
      href: "/bookings",
    },
    {
      title: "Expected value",
      value: today?.expectedValue ?? 0,
      icon: CircleDollarSign,
      detail: "Booked value, not paid revenue",
      href: "/bookings",
      money: true,
    },
    {
      title: "Remaining",
      value: today?.remaining ?? 0,
      icon: Clock3,
      detail: "Still to happen today",
      href: "/calendar",
    },
    {
      title: "Needs attention",
      value: today?.needsAttention ?? 0,
      icon: AlertCircle,
      detail: today?.needsAttention ? "Action queue is waiting" : "All caught up",
      href: "/bookings",
      inverse: true,
    },
    {
      title: "Completed",
      value: today?.completed ?? 0,
      icon: CheckCircle2,
      detail: "Finished appointments",
      href: "/bookings",
    },
    {
      title: "New clients",
      value: today?.newClients ?? 0,
      icon: UserPlus,
      detail: "Created and booked today",
      href: "/clients",
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-4 xl:grid-cols-3">
      {stats.map((stat) => (
        <MetricCard
          key={stat.title}
          title={stat.title}
          numericValue={stat.value}
          formatValue={stat.money ? formatCurrency : (value) => value.toLocaleString()}
          icon={stat.icon}
          detail={stat.detail}
          loading={loading}
          inverse={stat.inverse}
          href={stat.href}
        />
      ))}
    </section>
  );
}

function NextUp({ booking }: { booking: CatalogBooking | null | undefined }) {
  if (!booking) {
    return (
      <Card className="border-border/60 shadow-none">
        <CardContent className="flex min-h-[92px] items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">No more appointments today</p>
            <p className="mt-1 text-sm text-muted-foreground">Your remaining schedule is clear.</p>
          </div>
          <Clock3 className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next up</p>
          <p className="mt-1 truncate text-lg font-semibold text-foreground">
            {booking.clientName} at {format(new Date(booking.startTime), "h:mm a")}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {booking.serviceName} with {booking.staffName}
          </p>
        </div>
        <Button asChild>
          <Link href="/bookings" className="!text-white hover:!text-white">
            Open
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function TodaySchedule({
  bookings,
  loading,
}: {
  bookings: CatalogBooking[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardKeys.operations }),
      queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() }),
      queryClient.invalidateQueries({ queryKey: catalogKeys.payments() }),
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "confirm" | "complete" | "no_show" | "cancel" }) => {
      if (action === "confirm") return confirmBooking(id);
      if (action === "complete") return completeBooking(id);
      if (action === "no_show") return markBookingNoShow(id);
      return cancelBooking(id);
    },
    onSuccess: async () => {
      await invalidate();
      toast("Booking updated");
    },
    onError: (err) => {
      toast.error("Could not update booking", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (booking: CatalogBooking) =>
      createPayment({
        clientId: booking.clientId,
        bookingId: booking.id,
        amount: booking.totalAmount,
        method: "cash",
        type: "full_payment",
        status: "completed",
      }),
    onSuccess: async () => {
      await invalidate();
      toast("Payment recorded");
    },
    onError: (err) => {
      toast.error("Could not record payment", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  if (loading) {
    return (
      <Card className="border-border/60 shadow-none">
        <CardHeader>
          <CardTitle>Today's schedule</CardTitle>
          <CardDescription>Loading appointments...</CardDescription>
        </CardHeader>
        <CardContent>
          <ListRowsSkeleton rows={6} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/60 shadow-none">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Today's schedule</CardTitle>
            <CardDescription>The appointments that matter right now.</CardDescription>
          </div>
          <Button variant="outline" asChild>
            <Link href="/calendar">Open calendar</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {bookings.length === 0 ? (
          <PageEmptyState title="No appointments today" description="Create a booking or use the time to follow up with clients." />
        ) : (
          <div className="divide-y divide-border/60">
            {bookings.map((booking) => {
              const starts = new Date(booking.startTime);
              const ends = new Date(booking.endTime);
              const hasWarning = booking.status === "pending" || !booking.staffId || !booking.clientPhone;
              return (
                <div
                  key={booking.id}
                  className="-mx-4 px-4 py-4 transition-colors first:pt-0 last:pb-0 hover:bg-muted/35 sm:-mx-5 sm:px-5"
                >
                  <div className="grid gap-4 lg:grid-cols-[100px_1fr_auto] lg:items-start">
                    <div className="rounded-2xl bg-primary/10 px-3 py-2 text-center">
                      <p className="text-lg font-semibold text-foreground">{format(starts, "HH:mm")}</p>
                      <p className="text-xs text-muted-foreground">{format(ends, "HH:mm")}</p>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-foreground">{booking.clientName}</p>
                        <BookingStatusBadge status={booking.status} />
                        {hasWarning ? (
                          <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                            Check
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {booking.serviceName} with {booking.staffName || "Unassigned"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{formatCurrency(booking.totalAmount)} booked value</span>
                        <span>{booking.depositPaid ? "Deposit paid" : "Deposit not marked paid"}</span>
                        <span>{booking.notes ? "Has notes" : "No notes"}</span>
                        <span>{booking.clientPhone ? booking.clientPhone : "No phone"}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {booking.status === "pending" ? (
                        <Button size="sm" onClick={() => statusMutation.mutate({ id: booking.id, action: "confirm" })}>
                          Confirm
                        </Button>
                      ) : null}
                      {!["completed", "cancelled", "no_show"].includes(booking.status) ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: booking.id, action: "complete" })}>
                            Complete
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: booking.id, action: "no_show" })}>
                            No-show
                          </Button>
                        </>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => paymentMutation.mutate(booking)}>
                        Pay
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={phoneHref(booking.clientPhone)} target={booking.clientPhone ? "_blank" : undefined} rel="noreferrer">
                          Contact
                        </a>
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href="/bookings">View</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type BookingGraphRange = "3d" | "6d" | "all";

function BookingTrendGraph({
  today,
  days,
  loading,
}: {
  today: Awaited<ReturnType<typeof fetchDashboardOperations>>["today"] | undefined;
  days: DashboardDay[];
  loading: boolean;
}) {
  const [range, setRange] = useState<BookingGraphRange>("6d");
  const todayPoint = {
    label: "Today",
    bookings: today?.bookingCount ?? 0,
    value: today?.expectedValue ?? 0,
  };
  const allPoints = [
    todayPoint,
    ...days.map((day) => ({
      label: day.label.replace(",", ""),
      bookings: day.count,
      value: day.value,
    })),
  ];
  const visiblePoints = range === "3d" ? allPoints.slice(0, 3) : range === "6d" ? allPoints.slice(0, 6) : allPoints;
  const totalBookings = visiblePoints.reduce((sum, point) => sum + point.bookings, 0);
  const totalValue = visiblePoints.reduce((sum, point) => sum + point.value, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Bookings graph</CardTitle>
            <CardDescription>Upcoming booking volume and booked value.</CardDescription>
          </div>
          <Select value={range} onValueChange={(value) => setRange(value as BookingGraphRange)}>
            <SelectTrigger className="w-full rounded-full bg-background sm:w-[180px]">
              <SelectValue placeholder="Timeframe" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="3d">Next 3 days</SelectItem>
              <SelectItem value="6d">Next 6 days</SelectItem>
              <SelectItem value="all">All upcoming</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <ChartSkeleton className="h-[330px]" />
        ) : totalBookings === 0 ? (
          <PageEmptyState title="No bookings in this window" description="Bookings will appear here once your upcoming schedule starts filling up." />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <InfoTile>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Bookings</p>
                <p className="mt-2 text-xl font-bold tabular-nums text-foreground sm:text-3xl">{totalBookings}</p>
              </InfoTile>
              <InfoTile>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Booked value</p>
                <p className="mt-2 text-xl font-bold tabular-nums text-foreground sm:text-3xl">{formatCurrency(totalValue)}</p>
              </InfoTile>
            </div>
            <div className="h-[270px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={visiblePoints} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.55} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.45)" }}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "16px",
                      boxShadow: "none",
                    }}
                    formatter={(value: number, name) => [
                      name === "value" ? formatCurrency(value) : value.toLocaleString(),
                      name === "value" ? "Booked value" : "Bookings",
                    ]}
                  />
                  <Bar dataKey="bookings" radius={[16, 16, 16, 16]} fill="hsl(var(--primary))" maxBarSize={54} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AppointmentOverview({
  bookings,
  loading,
  onNewBooking,
}: {
  bookings: CatalogBooking[];
  loading: boolean;
  onNewBooking: () => void;
}) {
  return (
    <Card className="flex max-h-[520px] min-h-[420px] flex-col overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Appointment overview</CardTitle>
            <CardDescription>Today&apos;s schedule at a glance.</CardDescription>
          </div>
          <Button size="icon" variant="secondary" className="h-8 w-8" onClick={onNewBooking}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <ListRowsSkeleton rows={4} />
        ) : bookings.length === 0 ? (
          <PageEmptyState title="No appointments" description="Today's bookings will appear here once scheduled." />
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {bookings.map((booking) => {
                const starts = new Date(booking.startTime);
                const ends = new Date(booking.endTime);
                const tone = bookingStatusSurface(booking.status);
                return (
                  <Link
                    key={booking.id}
                    href="/bookings"
                    className={cn(
                      "group relative block overflow-hidden rounded-xl p-4 transition-colors duration-150",
                      tone.card,
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 pl-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{booking.clientName}</p>
                        <p className="mt-1 text-xs font-semibold text-primary">{formatCurrency(booking.totalAmount)}</p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize", tone.badge)}>
                        {booking.status.replace("_", " ")}
                      </Badge>
                    </div>

                    <p className={cn("mt-3 line-clamp-1 pl-2 text-sm font-semibold", tone.service)}>
                      {booking.serviceName}
                    </p>

                    <div className="mt-4 flex items-center justify-between gap-3 pl-2 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate font-medium">{booking.staffName || "Unassigned"}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
                        <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                        {format(starts, "HH:mm")}-{format(ends, "HH:mm")}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
            <Link
              href="/bookings"
              className="group mt-4 inline-flex items-center gap-1.5 self-end text-sm font-semibold text-primary transition-colors hover:text-primary/80"
            >
              See all bookings
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UpcomingSchedule({ days }: { days: DashboardDay[] }) {
  return (
    <Card className="flex max-h-[520px] min-h-[420px] flex-col overflow-hidden">
      <CardHeader>
        <CardTitle>Upcoming schedule</CardTitle>
        <CardDescription>Tomorrow and the next few days.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {days.map((day) => (
            <Link
              key={day.date}
              href="/calendar"
              className="group block rounded-xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{day.label}</p>
                  <p className="mt-1 text-xs font-semibold text-primary">{formatCurrency(day.value)}</p>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full border-foreground/20 bg-background px-2.5 py-1 text-[11px] font-semibold">
                  {day.count} booking{day.count === 1 ? "" : "s"}
                </Badge>
              </div>
              <p className="mt-3 line-clamp-1 text-sm font-semibold text-primary">
                {day.count === 0 ? "No bookings scheduled" : `${day.firstTime} - ${day.lastTime}`}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="min-w-0 truncate font-medium">{day.staffCount} staff assigned</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  Open day
                </span>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivityCard() {
  return (
    <Card className="flex max-h-[520px] min-h-[420px] flex-col overflow-hidden">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Automation and business events from the shared activity feed.</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        <div className="rounded-xl bg-muted/35 p-3">
          <ActivityFeed limit={10} />
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActions({ onNewBooking }: { onNewBooking: () => void }) {
  const { data: bookingPage } = useQuery({
    queryKey: ["booking-page", "settings", "dashboard-link"],
    queryFn: fetchBookingPageSettings,
  });

  const actions = [
    { label: "New booking", detail: "Add an appointment now", icon: Plus, onClick: onNewBooking },
    { label: "Open calendar", detail: "Manage today visually", icon: CalendarDays, href: "/calendar" },
    { label: "Add client", detail: "Create a client profile", icon: UserPlus, href: "/clients" },
    { label: "WhatsApp inbox", detail: "Reply to active chats", icon: MessageSquareText, href: "/whatsapp" },
    { label: "Record payment", detail: "Capture a paid booking", icon: CreditCard, href: "/payments" },
    { label: "Create campaign", detail: "Fill quiet slots", icon: Send, href: "/marketing" },
    { label: "Add service", detail: "Update your menu", icon: Scissors, href: "/services" },
    { label: "Add staff", detail: "Grow the team", icon: Users, href: "/staff" },
    {
      label: "Copy booking link",
      detail: "Share your live page",
      icon: Copy,
      onClick: async () => {
        if (!bookingPage?.slug) {
          toast("Booking page not ready", { description: "Publish your booking page first." });
          return;
        }
        await navigator.clipboard.writeText(bookingPageUrl(bookingPage.slug));
        toast("Booking link copied");
      },
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Clean shortcuts for the work you do most often.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const content = (
            <>
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                  "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{action.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{action.detail}</span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </>
          );
          const className = cn(
            "group flex min-h-[96px] items-center gap-4 rounded-2xl p-4 text-left transition-colors duration-150",
            "bg-muted/45 hover:bg-muted/75",
          );
          if (action.href) {
            return (
              <Link key={action.label} href={action.href} className={className}>
                {content}
              </Link>
            );
          }
          return (
            <button key={action.label} type="button" className={className} onClick={action.onClick}>
              {content}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SetupOrStatus({ data }: { data: Awaited<ReturnType<typeof fetchDashboardOperations>>["systemStatus"] }) {
  if (!data.setupComplete) {
    const completeCount = data.setupItems.filter((item) => item.complete).length;
    const totalCount = data.setupItems.length;
    const progress = totalCount ? Math.round((completeCount / totalCount) * 100) : 0;
    const nextSteps = data.setupItems.filter((item) => !item.complete).slice(0, 3);

    return (
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Setup progress</CardTitle>
              <CardDescription>Finish the highest-impact basics so Qwickly can run smoothly.</CardDescription>
            </div>
            <Badge variant="secondary" className="w-fit">
              {completeCount} of {totalCount} complete
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{progress}% ready. Complete the next steps below to unlock a cleaner day-to-day workflow.</p>
          </div>

          <div className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-muted/25 md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
            {nextSteps.map((item, index) => (
              <Link
                key={item.label}
                href={item.href}
                className="group flex min-h-[98px] items-center justify-between gap-4 p-4 transition-colors hover:bg-primary/5"
              >
                <span>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Step {index + 1}</span>
                  <span className="mt-1 block text-sm font-semibold text-foreground">{item.label}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>

          {completeCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {completeCount} setup {completeCount === 1 ? "item is" : "items are"} already complete and hidden from this shortlist.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
      <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>Connected systems and operational health.</CardDescription>
      </CardHeader>
      <CardContent className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-3 2xl:grid-cols-6">
        {data.systems.map((system) => (
          <Link
            key={system.label}
            href={system.href}
            className="flex min-h-[104px] flex-col justify-between p-4 transition-colors hover:bg-primary/5"
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-foreground">{system.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{system.detail}</span>
              </span>
              <span
                className={cn(
                  "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                  system.status === "good" ? "bg-primary" : system.status === "warning" ? "bg-amber-500" : "bg-muted-foreground/40",
                )}
              />
            </span>
            <span className="mt-4 flex items-center gap-1 text-xs font-semibold text-primary">
              Manage
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: dashboardKeys.operations,
    queryFn: fetchDashboardOperations,
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Dashboard"
        description="Today's schedule, urgent tasks, and Qwickly system health in one operational view."
        actions={
          <Button onClick={() => setNewBookingOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New booking
          </Button>
        }
      />

      <GettingStartedBanner />

      <TodaySummary data={data} loading={isLoading} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <BookingTrendGraph today={data?.today} days={data?.tomorrowAndNext ?? []} loading={isLoading} />
        <AppointmentOverview bookings={data?.today.bookings ?? []} loading={isLoading} onNewBooking={() => setNewBookingOpen(true)} />
      </section>

      {data?.systemStatus.setupComplete ? <SetupOrStatus data={data.systemStatus} /> : null}

      <section className="grid gap-6 xl:grid-cols-2">
        <UpcomingSchedule days={data?.tomorrowAndNext ?? []} />
        <RecentActivityCard />
      </section>

      <QuickActions onNewBooking={() => setNewBookingOpen(true)} />

      <NewBookingDialog
        open={newBookingOpen}
        onOpenChange={setNewBookingOpen}
      />
    </div>
  );
}

