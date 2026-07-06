import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useGetDashboardSummary, useGetRevenueChart, useGetBookings, useGetPaymentsSummary, useGetWhatsappConversations } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { catalogKeys, fetchClients } from "@/lib/catalog";
import {
  ArrowUpRight,
  AlertCircle,
  CalendarDays,
  Clock3,
  Loader2,
  MessageSquareText,
  CreditCard,
  BadgeCheck,
  ChevronDown,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const [periodKey, setPeriodKey] = useState("7d");
  const now = new Date();
  const periodOptions = getPeriodOptions(now);
  const selectedPeriod = periodOptions.find((period) => period.key === periodKey) ?? periodOptions[1];
  const range = getPeriodRange(selectedPeriod.key, now);
  const chartPeriod = getChartPeriod(selectedPeriod.key);

  const { data: summary } = useGetDashboardSummary();
  const { data: chartData, isLoading: loadingChart } = useGetRevenueChart({ period: chartPeriod });
  const { data: bookings, isLoading: loadingBookings } = useGetBookings();
  const { data: paymentsSummary, isLoading: loadingPaymentsSummary } = useGetPaymentsSummary();
  const { data: whatsappConversations, isLoading: loadingWhatsapp, isError: whatsappError } = useGetWhatsappConversations();
  const { data: clientsData, isLoading: loadingClients } = useQuery({
    queryKey: [...catalogKeys.clients, "dashboard-lookup"],
    queryFn: () => fetchClients(1, 1000),
  });
  const clients = clientsData?.clients ?? [];

  const formatCurrency = (val: any) => {
    const num = Number(val);
    if (Number.isNaN(num) || val === null || val === undefined) return "R 0";
    return `R ${num.toLocaleString()}`;
  };
  const activeChatCount = Array.isArray(whatsappConversations) ? whatsappConversations.length : 0;
  const unreadMessageCount = Array.isArray(whatsappConversations)
    ? whatsappConversations.reduce((sum, chat) => sum + (chat.unreadCount ?? 0), 0)
    : 0;

  const allBookings = Array.isArray(bookings) ? bookings : [];
  const rangeBookings = allBookings.filter((booking) => isWithinRange(new Date(booking.startTime), range.start, range.end));
  const selectedPastMonth = selectedPeriod.key.startsWith("month-");
  const upcomingBookings = Array.isArray(bookings)
    ? allBookings
        .filter((b) => selectedPastMonth || new Date(b.startTime) >= now)
        .filter((b) => isWithinRange(new Date(b.startTime), range.upcomingStart, range.upcomingEnd))
        .slice()
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    : [];

  const recentBookings = Array.isArray(bookings)
    ? allBookings
        .filter((b) => isWithinRange(new Date(b.startTime), range.recentStart, range.recentEnd))
        .filter((b) => selectedPastMonth || new Date(b.startTime) <= now)
        .slice()
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    : [];
  const bookingHeatmap = buildBookingHeatmap(allBookings, range);
  const filteredChartData = Array.isArray(chartData)
    ? chartData.filter((point: any) => isWithinRange(new Date(point.date), range.start, range.end))
    : [];
  const chartDisplayData = filteredChartData;

  const periodRevenue = chartDisplayData.reduce((sum: number, point: any) => sum + Number(point.revenue ?? 0), 0);

  const pendingBookings = allBookings.filter((b) => b.status === "pending");
  const outstandingAmount = paymentsSummary?.outstandingPayments;
  const hasOutstanding = typeof outstandingAmount === "number" && outstandingAmount > 0;

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const todaysBookings = allBookings
    .filter((b) => isWithinRange(new Date(b.startTime), todayStart, todayEnd) && b.status !== "cancelled")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const nextBooking = todaysBookings.find((b) => new Date(b.startTime) >= now);
  const todaysPendingCount = todaysBookings.filter((b) => b.status === "pending").length;

  const quickStats = [
    {
      title: "Bookings",
      value: loadingBookings ? "-" : rangeBookings.length.toString(),
      change: (summary && typeof summary === "object" && "todayAppointmentsChange" in summary) ? (summary as any).todayAppointmentsChange : undefined,
      icon: CalendarDays,
      detail: selectedPeriod.label,
      loading: loadingBookings,
      tone: "emerald",
      inverse: false,
      href: "/bookings",
    },
    {
      title: "Active chats",
      value: loadingWhatsapp ? "-" : whatsappError ? "Disconnected" : activeChatCount.toString(),
      change: undefined,
      icon: MessageSquareText,
      detail: whatsappError
        ? "Reconnect WhatsApp"
        : unreadMessageCount > 0
          ? `${unreadMessageCount} unread messages`
          : "No unread messages",
      loading: loadingWhatsapp,
      tone: "sky",
      inverse: false,
      href: "/whatsapp",
    },
    {
      title: "Needs attention",
      value: loadingBookings ? "-" : pendingBookings.length.toString(),
      change: undefined,
      icon: AlertCircle,
      detail: loadingPaymentsSummary
        ? "Checking balances..."
        : hasOutstanding
          ? `+ ${formatCurrency(outstandingAmount)} outstanding`
          : pendingBookings.length > 0
            ? "Awaiting your confirmation"
            : "All caught up",
      loading: loadingBookings,
      tone: "amber",
      inverse: true,
      href: "/bookings",
    },
    {
      title: "Payments",
      value: loadingChart ? "-" : formatCurrency(periodRevenue),
      change: undefined,
      icon: CreditCard,
      detail: selectedPeriod.label,
      loading: loadingChart,
      tone: "slate",
      inverse: false,
      href: "/payments",
    },
  ];

  const serviceChartData = buildServiceDistribution(rangeBookings).slice(0, 4);
  const serviceBookingTotal = serviceChartData.reduce((sum, service) => sum + service.bookings, 0);

  const clientsById = new Map((Array.isArray(clients) ? clients : []).map((c) => [c.id, c]));
  const rangeClientIds = new Set(rangeBookings.map((b) => String(b.clientId)));
  let newClientCount = 0;
  let returningClientCount = 0;
  rangeClientIds.forEach((clientId) => {
    const client = clientsById.get(clientId);
    if (client?.clientType === "new" || !client) {
      newClientCount += 1;
    } else {
      returningClientCount += 1;
    }
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 text-slate-900 lg:gap-6">
      <section className="flex flex-row items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl lg:text-3xl">Dashboard</h1>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:h-10 sm:gap-2 sm:px-3 sm:text-sm">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" />
            <select
              value={periodKey}
              onChange={(event) => setPeriodKey(event.target.value)}
              className="w-full max-w-[7.5rem] appearance-none bg-transparent pr-5 text-xs font-medium outline-none sm:max-w-none sm:pr-6 sm:text-sm"
              aria-label="Dashboard period"
            >
              {periodOptions.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-slate-400 sm:right-3" />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Clock3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-950">
              {loadingBookings
                ? "Loading today's schedule..."
                : todaysBookings.length === 0
                  ? "No appointments today"
                  : `${todaysBookings.length} appointment${todaysBookings.length === 1 ? "" : "s"} today`}
            </p>
            <p className="text-sm text-slate-500">
              {!loadingBookings && todaysPendingCount > 0
                ? `${todaysPendingCount} still awaiting confirmation`
                : "Independent of the period filter above"}
            </p>
          </div>
        </div>
        {!loadingBookings && nextBooking ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next up</p>
              <p className="text-sm font-semibold text-slate-950">
                {nextBooking.clientName} · {format(new Date(nextBooking.startTime), "h:mm a")}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {quickStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <MetricCard
              key={stat.title}
              title={stat.title}
              value={stat.value}
              change={stat.change}
              icon={Icon}
              detail={stat.detail}
              loading={stat.loading}
              tone={stat.tone}
              inverse={stat.inverse}
              href={stat.href}
            />
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-slate-100 bg-slate-50/60">
            <div>
              <CardTitle className="text-slate-950">Revenue pulse</CardTitle>
              <CardDescription className="mt-1 text-slate-500">Daily revenue trend for the last 30 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            {loadingChart ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              </div>
            ) : chartDisplayData.length === 0 || periodRevenue === 0 ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-500">No revenue recorded for this period.</div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartDisplayData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashRevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickFormatter={formatChartTick}
                      minTickGap={24}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `R${v}`} width={50} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 12px 30px rgba(15,23,42,0.08)" }}
                      itemStyle={{ color: "#0f172a" }}
                      formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#dashRevGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-slate-100 bg-slate-50/60">
            <div>
              <CardTitle className="text-slate-950">Top booked services</CardTitle>
              <CardDescription className="mt-1 text-slate-500">Booking share by service for {selectedPeriod.label.toLowerCase()}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            {loadingBookings ? (
              <div className="grid h-64 place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              </div>
            ) : serviceChartData.length === 0 ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-500">No services available for this period.</div>
            ) : (
              <div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serviceChartData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        interval={0}
                        tickFormatter={shortServiceName}
                      />
                      <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} width={42} />
                      <Tooltip
                        cursor={{ fill: "rgba(16,185,129,0.08)" }}
                        contentStyle={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 12px 30px rgba(15,23,42,0.08)" }}
                        itemStyle={{ color: "#0f172a" }}
                        formatter={(value: number) => [`${value.toLocaleString()} bookings`, "Bookings"]}
                        labelFormatter={(label) => label}
                      />
                      <Bar dataKey="bookings" radius={[8, 8, 0, 0]} barSize={42}>
                        {serviceChartData.map((service, index) => (
                          <Cell key={service.name} fill={index === 0 ? "#10b981" : "#a7f3d0"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-xs text-slate-500">Top service</p>
                    <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-950">{serviceChartData[0]?.bookings.toLocaleString()} bookings</p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-right">
                    <p className="max-w-32 truncate text-sm font-semibold text-emerald-900">{serviceChartData[0]?.name}</p>
                    <p className="text-xs text-emerald-700">{serviceBookingTotal.toLocaleString()} total bookings</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <BookingHeatmapCard loading={loadingBookings} heatmap={bookingHeatmap} range={range} />

        <BookingsListCard loading={loadingBookings} upcomingBookings={upcomingBookings} recentBookings={recentBookings} />

      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60">
            <CardTitle className="text-slate-950">WhatsApp engagement</CardTitle>
            <CardDescription className="text-slate-500">Live conversations and unread messages from your chat inbox</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5 sm:p-6">
            {loadingWhatsapp ? (
              <div className="flex h-44 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : whatsappError ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-500">WhatsApp not connected or unauthorized.</div>
            ) : Array.isArray(whatsappConversations) && whatsappConversations.length ? (
              <div className="divide-y divide-slate-100">
                {whatsappConversations.slice(0, 3).map((conversation) => (
                  <div key={conversation.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{conversation.clientName}</p>
                      <p className="truncate text-sm text-slate-500">{conversation.lastMessage}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{format(new Date(conversation.lastMessageAt), "h:mm a")}</p>
                      {conversation.unreadCount > 0 ? (
                        <div className="mt-1 inline-flex items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {conversation.unreadCount}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-500">No active WhatsApp conversations yet.</div>
            )}
            <div className="border-t border-slate-100 pt-4">
              <Link
                href="/whatsapp"
                className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950"
              >
                See all conversations
              </Link>
            </div>
          </CardContent>
        </Card>

        <NewVsReturningCard loading={loadingBookings || loadingClients} newCount={newClientCount} returningCount={returningClientCount} periodLabel={selectedPeriod.label} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr]">
        <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60">
            <CardTitle className="text-slate-950">Payments & follow-up</CardTitle>
            <CardDescription className="text-slate-500">Stay ahead of revenue, deposits, and overdue balances</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:p-6">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex items-center gap-2 text-emerald-700">
                <CreditCard className="h-4 w-4" />
                <p className="text-sm font-semibold">Payments received</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950">
                {loadingPaymentsSummary ? "-" : paymentsSummary ? formatCurrency(paymentsSummary.totalRevenue) : "-"}
              </p>
              <p className="mt-1 text-sm text-slate-600">All-time revenue</p>
              <p className="mt-3 rounded-full bg-white/80 px-3 py-1 text-sm font-medium text-slate-600">
                Deposits: {loadingPaymentsSummary ? "-" : paymentsSummary ? formatCurrency(paymentsSummary.depositsCollected) : "-"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-slate-700">
                <BadgeCheck className="h-4 w-4" />
                <p className="text-sm font-semibold text-slate-950">Outstanding balance</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950">
                {loadingPaymentsSummary ? "-" : paymentsSummary ? formatCurrency(paymentsSummary.outstandingPayments) : "-"}
              </p>
              <p className="mt-1 text-sm text-slate-500">Awaiting payment</p>
              <p className="mt-3 rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-600">
                No-show rate: {summary && typeof summary === "object" && "noShowRate" in summary && summary.noShowRate != null ? `${summary.noShowRate.toFixed(1)}%` : "-"}
              </p>
            </div>
            <Link
              href="/payments"
              className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950"
            >
              View all payments
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({ title, value, change, icon: Icon, detail, loading, tone = "slate", inverse = false, href }: any) {
  const isPositive = change > 0;
  const isGood = inverse ? !isPositive : isPositive;
  const hasUsefulChange = typeof change === "number" && Math.abs(change) > 0;

  const card = (
    <Card className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/70 text-slate-950 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
      <CardContent className="flex min-h-[140px] flex-col justify-between p-3 sm:min-h-[168px] sm:p-5">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-primary shadow-sm sm:h-8 sm:w-8">
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <p className="truncate text-[11px] font-semibold sm:text-xs">{title}</p>
          </div>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm sm:h-9 sm:w-9">
            <ArrowUpRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
        </div>

        <div className="space-y-1.5 sm:space-y-2">
          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-emerald-100 sm:h-10 sm:w-28" />
          ) : (
            <p className="truncate text-2xl font-semibold tracking-tight sm:text-4xl lg:text-[2.55rem]">{value}</p>
          )}
          <div className="flex items-end justify-between gap-3">
            <p className="min-w-0 text-[11px] font-medium text-slate-500">{detail}</p>
            {!loading && hasUsefulChange ? (
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold",
                  isGood ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
                )}
              >
                {isPositive ? "+" : "-"}
                {Math.abs(change)}%
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {card}
      </Link>
    );
  }

  return card;
}

function NewVsReturningCard({ loading, newCount, returningCount, periodLabel }: any) {
  const total = newCount + returningCount;
  const newPct = total > 0 ? Math.round((newCount / total) * 100) : 0;

  return (
    <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/60">
        <CardTitle className="text-slate-950">New vs returning</CardTitle>
        <CardDescription className="text-slate-500">Who booked with you during {periodLabel.toLowerCase()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5 sm:p-6">
        {loading ? (
          <div className="flex h-44 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : total === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-500">No bookings in this period yet.</div>
        ) : (
          <>
            <div className="flex overflow-hidden rounded-full bg-slate-100">
              <div className="h-2.5 bg-primary" style={{ width: `${newPct}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
                <div className="flex items-center gap-2 text-emerald-700">
                  <UserPlus className="h-4 w-4" />
                  <p className="text-xs font-semibold">New clients</p>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{newCount}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-slate-700">
                  <Users className="h-4 w-4" />
                  <p className="text-xs font-semibold">Returning clients</p>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{returningCount}</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BookingsListCard({ loading, upcomingBookings, recentBookings }: any) {
  const [view, setView] = useState<"upcoming" | "recent">("upcoming");
  const visibleBookings = (view === "upcoming" ? upcomingBookings : recentBookings).slice(0, 5);
  const emptyText = view === "upcoming" ? "No upcoming bookings scheduled." : "No recent bookings available.";

  return (
    <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/60">
        <div>
          <CardTitle className="text-slate-950">Appointments</CardTitle>
          <CardDescription className="mt-1 text-slate-500">
            Switch between your upcoming and recent bookings
          </CardDescription>
        </div>
        <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(["upcoming", "recent"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                view === option ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-5 sm:p-6">
        <div>
          {loading ? (
            <div className="flex h-52 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : visibleBookings.length === 0 ? (
            <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-500">{emptyText}</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleBookings.map((booking: any) => (
                <div key={booking.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-sm font-semibold text-emerald-700">
                      {format(new Date(booking.startTime), "HH")}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{booking.clientName}</p>
                      <p className="truncate text-sm text-slate-500">
                        {booking.serviceName ? `${booking.serviceName} · ` : ""}
                        {format(new Date(booking.startTime), "EEE, h:mm a")}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium capitalize text-slate-700">
                    {booking.status.replace("_", " ")}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <Link
              href="/bookings"
              className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950"
            >
              See all bookings
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const heatmapHours = [8, 9, 10, 11, 12, 13, 14];
const heatmapDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getPeriodOptions(now: Date) {
  const options = [
    { key: "7d", label: "7 days" },
    { key: "this-month", label: "This month" },
  ];

  for (let offset = 1; offset <= 6; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    options.push({
      key: `month-${offset}`,
      label: format(date, "MMMM yyyy"),
    });
  }

  return options;
}

function getPeriodRange(key: string, now: Date) {
  if (key === "today") {
    const start = startOfDay(now);
    const end = endOfDay(now);
    return {
      start,
      end,
      upcomingStart: start,
      upcomingEnd: end,
      recentStart: start,
      recentEnd: end,
      label: "Today",
    };
  }

  if (key === "7d") {
    return {
      start: startOfDay(addDays(now, -6)),
      end: endOfDay(now),
      upcomingStart: now,
      upcomingEnd: endOfDay(addDays(now, 7)),
      recentStart: startOfDay(addDays(now, -6)),
      recentEnd: endOfDay(now),
      label: "7 days",
    };
  }

  if (key === "this-month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return {
      start,
      end,
      upcomingStart: now,
      upcomingEnd: end,
      recentStart: start,
      recentEnd: end,
      label: format(now, "MMMM yyyy"),
    };
  }

  const match = key.match(/^month-(\d+)$/);
  const offset = match ? Number(match[1]) : 1;
  const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const end = endOfDay(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));

  return {
    start,
    end,
    upcomingStart: start,
    upcomingEnd: end,
    recentStart: start,
    recentEnd: end,
    label: format(monthDate, "MMMM yyyy"),
  };
}

function getChartPeriod(key: string) {
  if (key === "today" || key === "7d") return "7d";
  if (key === "this-month") return "30d";
  return "1y";
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isWithinRange(date: Date, start: Date, end: Date) {
  const time = date.getTime();
  return !Number.isNaN(time) && time >= start.getTime() && time <= end.getTime();
}

function buildServiceDistribution(bookings: any[]) {
  const byService = new Map<string, number>();

  bookings.forEach((booking) => {
    const name = booking.serviceName || "Unassigned";
    byService.set(name, (byService.get(name) ?? 0) + 1);
  });

  return Array.from(byService.entries())
    .map(([name, bookings]) => ({ name, bookings }))
    .sort((a, b) => b.bookings - a.bookings);
}

function buildBookingHeatmap(bookings: any[], range: { start: Date; end: Date }) {
  const monthlyBookings = bookings.filter((booking) => {
    const date = new Date(booking.startTime);
    return isWithinRange(date, range.start, range.end);
  });

  const counts = heatmapHours.map((hour) =>
    heatmapDays.map((_, day) => ({
      day,
      hour,
      count: 0,
    })),
  );

  monthlyBookings.forEach((booking) => {
    const date = new Date(booking.startTime);
    const hourIndex = heatmapHours.indexOf(date.getHours());
    if (hourIndex === -1) return;
    counts[hourIndex][date.getDay()].count += 1;
  });

  const max = Math.max(...counts.flat().map((cell) => cell.count), 1);
  const total = monthlyBookings.length;
  return { rows: counts, max, total };
}

function BookingHeatmapCard({ loading, heatmap, range }: any) {
  return (
    <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950">Bookings by time</h2>
            <p className="mt-1 text-sm text-slate-500">
              {range.label} schedule pattern from all bookings
            </p>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {heatmap.total} bookings
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] font-medium text-slate-500">
          {[
            ["bg-slate-100", "Quiet"],
            ["bg-emerald-100", "Light"],
            ["bg-emerald-400", "Busy"],
            ["bg-primary", "Full"],
          ].map(([color, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
              {label}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 grid h-48 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-[32px_1fr] gap-3">
            <div className="grid gap-1.5 text-right text-[11px] text-slate-400">
              {heatmapHours.map((hour) => (
                <div key={hour} className="flex h-8 items-center justify-end">
                  {formatHour(hour)}
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <div className="grid grid-cols-7 gap-1.5">
                {heatmap.rows.flatMap((row: any[]) =>
                  row.map((cell) => (
                    <div
                      key={`${cell.day}-${cell.hour}`}
                      className={cn(
                        "h-8 rounded-md border border-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.03)]",
                        cell.count === 0 ? "bg-[repeating-linear-gradient(135deg,rgba(15,23,42,0.06)_0_1px,transparent_1px_5px)]" : heatmapCellColor(cell.count, heatmap.max),
                      )}
                      title={`${heatmapDays[cell.day]} ${formatHour(cell.hour)}: ${cell.count} bookings`}
                    />
                  )),
                )}
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-[11px] text-slate-400">
                {heatmapDays.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function heatmapCellColor(count: number, max: number) {
  const intensity = count / max;
  if (intensity >= 0.85) return "bg-primary";
  if (intensity >= 0.55) return "bg-emerald-400";
  if (intensity >= 0.3) return "bg-emerald-200";
  return "bg-emerald-100";
}

function formatHour(hour: number) {
  if (hour === 12) return "12pm";
  if (hour > 12) return `${hour - 12}pm`;
  return `${hour}am`;
}

function formatChartTick(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "EEE");
}

function shortServiceName(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 11)}...`;
}
