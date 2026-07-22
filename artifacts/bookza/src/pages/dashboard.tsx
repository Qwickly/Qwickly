import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  Bot,
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
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartSkeleton, ListRowsSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  type DashboardAttentionItem,
  type DashboardDay,
} from "@/lib/dashboard";
import type { CatalogBooking } from "@/types/catalog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function formatCurrency(value: number) {
  return `R ${Math.round(value).toLocaleString()}`;
}

function statusClass(status: string) {
  switch (status) {
    case "confirmed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "completed":
      return "border-primary/20 bg-primary/10 text-primary";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "no_show":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function priorityClass(priority: DashboardAttentionItem["priority"]) {
  if (priority === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function phoneHref(phone: string | null) {
  if (!phone) return "/clients";
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : "/whatsapp";
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
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
      href: "#attention",
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
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <CardContent className="flex min-h-[92px] items-center justify-between gap-4 p-4">
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
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next up</p>
          <p className="mt-1 truncate text-lg font-semibold text-foreground">
            {booking.clientName} at {format(new Date(booking.startTime), "h:mm a")}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {booking.serviceName} with {booking.staffName}
          </p>
        </div>
        <Button asChild className="bg-primary text-white hover:bg-primary/90">
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
  const { toast } = useToast();

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
      toast({ title: "Booking updated" });
    },
    onError: (err) => {
      toast({
        title: "Could not update booking",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
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
      toast({ title: "Payment recorded" });
    },
    onError: (err) => {
      toast({
        title: "Could not record payment",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
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
    <Card className="border-border/60 shadow-none">
      <CardHeader className="border-b border-border/60 bg-muted/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Today's schedule</CardTitle>
            <CardDescription>The appointments that matter right now.</CardDescription>
          </div>
          <Button variant="outline" asChild className="bg-card">
            <Link href="/calendar">Open calendar</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {bookings.length === 0 ? (
          <EmptyPanel title="No appointments today" text="Create a booking or use the time to follow up with clients." />
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => {
              const starts = new Date(booking.startTime);
              const ends = new Date(booking.endTime);
              const hasWarning = booking.status === "pending" || !booking.staffId || !booking.clientPhone;
              return (
                <div
                  key={booking.id}
                  className="rounded-xl border border-border/60 bg-card/65 p-4 shadow-none transition-colors hover:bg-muted/30"
                >
                  <div className="grid gap-4 lg:grid-cols-[100px_1fr_auto] lg:items-start">
                    <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-center">
                      <p className="text-lg font-semibold text-foreground">{format(starts, "HH:mm")}</p>
                      <p className="text-xs text-muted-foreground">{format(ends, "HH:mm")}</p>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-foreground">{booking.clientName}</p>
                        <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize", statusClass(booking.status))}>
                          {booking.status.replace("_", " ")}
                        </Badge>
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
                          <Button size="sm" variant="outline" className="bg-card" onClick={() => statusMutation.mutate({ id: booking.id, action: "complete" })}>
                            Complete
                          </Button>
                          <Button size="sm" variant="outline" className="bg-card" onClick={() => statusMutation.mutate({ id: booking.id, action: "no_show" })}>
                            No-show
                          </Button>
                        </>
                      ) : null}
                      <Button size="sm" variant="outline" className="bg-card" onClick={() => paymentMutation.mutate(booking)}>
                        Pay
                      </Button>
                      <Button size="sm" variant="outline" className="bg-card" asChild>
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

function AttentionQueue({ items }: { items: DashboardAttentionItem[] }) {
  return (
    <Card id="attention" className="border-border/60 shadow-none">
      <CardHeader className="border-b border-border/60 bg-muted/30">
        <CardTitle>Attention required</CardTitle>
        <CardDescription>Prioritised operational tasks from bookings, messages, notifications, and payments.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {items.length === 0 ? (
          <EmptyPanel title="Nothing needs attention" text="Pending bookings, failed notifications, unpaid visits, and AI drafts will appear here." />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/65 p-3 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{item.title}</p>
                    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize", priorityClass(item.priority))}>
                      {item.priority}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                </div>
                <span className="shrink-0 text-sm font-medium text-primary">{item.action}</span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UpcomingSchedule({ days }: { days: DashboardDay[] }) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="border-b border-border/60 bg-muted/30">
        <CardTitle>Upcoming schedule</CardTitle>
        <CardDescription>Tomorrow and the next few days.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5">
        {days.map((day) => (
          <Link
            key={day.date}
            href="/calendar"
            className="grid gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:border-primary/40 hover:bg-muted/30 sm:grid-cols-[1fr_auto]"
          >
            <div>
              <p className="font-semibold text-foreground">{day.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {day.count === 0
                  ? "No bookings scheduled"
                  : `${day.count} booking${day.count === 1 ? "" : "s"} from ${day.firstTime} to ${day.lastTime}`}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="font-semibold text-foreground">{formatCurrency(day.value)}</p>
              <p className="text-xs text-muted-foreground">{day.staffCount} staff assigned</p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function QuickActions({ onNewBooking }: { onNewBooking: () => void }) {
  const { toast } = useToast();
  const { data: bookingPage } = useQuery({
    queryKey: ["booking-page", "settings", "dashboard-link"],
    queryFn: fetchBookingPageSettings,
  });

  const actions = [
    { label: "New booking", detail: "Add an appointment now", icon: Plus, onClick: onNewBooking, featured: true },
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
          toast({ title: "Booking page not ready", description: "Publish your booking page first." });
          return;
        }
        await navigator.clipboard.writeText(bookingPageUrl(bookingPage.slug));
        toast({ title: "Booking link copied" });
      },
    },
  ];

  return (
    <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-primary/10 via-card/85 to-emerald-50/70 shadow-none">
      <CardHeader className="border-b border-border/60 bg-white/70 backdrop-blur">
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Clean shortcuts for the work you do most often.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const content = (
            <>
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                  action.featured ? "bg-white/20 text-white" : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-semibold", action.featured ? "text-white" : "text-foreground")}>{action.label}</span>
                <span className={cn("mt-0.5 block text-xs", action.featured ? "text-white/75" : "text-muted-foreground")}>{action.detail}</span>
              </span>
              <ArrowRight
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5",
                  action.featured ? "text-white/80" : "text-muted-foreground",
                )}
              />
            </>
          );
          const className = cn(
            "group flex min-h-[102px] items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5",
            action.featured
              ? "border-primary bg-primary hover:bg-primary/90"
              : "border-border/70 bg-white hover:border-primary/30",
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
      <Card className="border-border/60 shadow-none">
        <CardHeader className="border-b border-border/60 bg-muted/30">
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
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{progress}% ready. Complete the next steps below to unlock a cleaner day-to-day workflow.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {nextSteps.map((item, index) => (
              <Link
                key={item.label}
                href={item.href}
                className="group flex min-h-[98px] items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
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
      <Card className="border-border/60 shadow-none">
      <CardHeader className="border-b border-border/60 bg-muted/30">
        <CardTitle>System status</CardTitle>
        <CardDescription>Connected systems and operational health.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3 2xl:grid-cols-6">
        {data.systems.map((system) => (
          <Link
            key={system.label}
            href={system.href}
            className="flex min-h-[104px] flex-col justify-between rounded-xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
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
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Today&apos;s schedule, urgent tasks, and Qwickly system health in one operational view.
          </p>
        </div>
        <Button className="bg-primary text-white hover:bg-primary/90" onClick={() => setNewBookingOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New booking
        </Button>
      </section>

      <TodaySummary data={data} loading={isLoading} />

      {isLoading ? (
        <ChartSkeleton className="h-[92px]" />
      ) : (
        <NextUp booking={data?.today.nextBooking} />
      )}

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <TodaySchedule bookings={data?.today.bookings ?? []} loading={isLoading} />
        <AttentionQueue items={data?.attention ?? []} />
      </section>

      {data ? <SetupOrStatus data={data.systemStatus} /> : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <UpcomingSchedule days={data?.tomorrowAndNext ?? []} />
        <Card className="border-border/60 shadow-none">
          <CardHeader className="border-b border-border/60 bg-muted/30">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>Automation and business events from the shared activity feed.</CardDescription>
              </div>
              <Bot className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <ActivityFeed limit={10} />
          </CardContent>
        </Card>
      </section>

      <QuickActions onNewBooking={() => setNewBookingOpen(true)} />

      <NewBookingDialog
        open={newBookingOpen}
        onOpenChange={setNewBookingOpen}
      />
    </div>
  );
}
