import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useGetDashboardSummary, useGetRevenueChart, useGetBookings, useGetPaymentsSummary, useGetWhatsappConversations } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { catalogKeys, fetchClients } from "@/lib/catalog";
import {
  AlertCircle,
  CalendarDays,
  Clock3,
  MessageSquareText,
  CreditCard,
  ChevronDown,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChartSkeleton, ListRowsSkeleton, HeatmapSkeleton, SplitStatSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { MetricCard } from "@/components/dashboard/metric-card";

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
      numericValue: rangeBookings.length,
      formatValue: (n: number) => Math.round(n).toString(),
      change: (summary && typeof summary === "object" && "todayAppointmentsChange" in summary) ? (summary as any).todayAppointmentsChange : undefined,
      icon: CalendarDays,
      detail: selectedPeriod.label,
      loading: loadingBookings,
      inverse: false,
      href: "/bookings",
    },
    {
      title: "Active chats",
      numericValue: whatsappError ? undefined : activeChatCount,
      textValue: whatsappError ? "Disconnected" : undefined,
      formatValue: (n: number) => Math.round(n).toString(),
      change: undefined,
      icon: MessageSquareText,
      detail: whatsappError
        ? "Reconnect WhatsApp"
        : unreadMessageCount > 0
          ? `${unreadMessageCount} unread messages`
          : "No unread messages",
      loading: loadingWhatsapp,
      inverse: false,
      href: "/whatsapp",
    },
    {
      title: "Needs attention",
      numericValue: pendingBookings.length,
      formatValue: (n: number) => Math.round(n).toString(),
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
      inverse: true,
      href: "/bookings",
    },
    {
      title: "Payments",
      numericValue: periodRevenue,
      formatValue: formatCurrency,
      change: undefined,
      icon: CreditCard,
      detail: selectedPeriod.label,
      loading: loadingChart,
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
    <div className="flex flex-col gap-5 text-slate-900 lg:gap-6">
      <section className="flex flex-col gap-1">
        <div className="flex flex-row items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Dashboard</h1>
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
        </div>
        <p className="text-slate-500 text-sm">A quick overview of your bookings, revenue, and what needs your attention.</p>
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
              numericValue={stat.numericValue}
              textValue={stat.textValue}
              formatValue={stat.formatValue}
              change={stat.change}
              icon={Icon}
              detail={stat.detail}
              loading={stat.loading}
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
              <ChartSkeleton />
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
              <ChartSkeleton />
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
              <ListRowsSkeleton rows={3} />
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

      <PaymentFollowUpCard
        loading={loadingBookings}
        bookings={rangeBookings}
        periodLabel={selectedPeriod.label}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

function PaymentFollowUpCard({ loading, bookings, periodLabel, formatCurrency }: any) {
  const pending = bookings.filter((booking: any) => booking.status === "pending");
  const recovery = bookings.filter((booking: any) => booking.status === "cancelled" || booking.status === "no_show");
  const unpaidDeposits = bookings.filter((booking: any) =>
    booking.depositPaid === false &&
    booking.status !== "cancelled" &&
    booking.status !== "no_show",
  );
  const unpaidValue = unpaidDeposits.reduce((sum: number, booking: any) => sum + Number(booking.totalAmount ?? 0), 0);
  const followUps = [
    ...unpaidDeposits.map((booking: any) => ({ ...booking, followUpType: "deposit" })),
    ...pending.map((booking: any) => ({ ...booking, followUpType: "pending" })),
    ...recovery.map((booking: any) => ({ ...booking, followUpType: "recovery" })),
  ]
    .filter((booking: any, index: number, list: any[]) =>
      list.findIndex((item) => item.id === booking.id) === index,
    )
    .slice()
    .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 4);
  const hasFollowUps = followUps.length > 0;

  return (
    <section>
      <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-slate-950">Payment follow-up</CardTitle>
              <CardDescription className="mt-1 text-slate-500">
                Deposit and booking actions from {periodLabel.toLowerCase()}
              </CardDescription>
            </div>
            <div
              className={cn(
                "w-fit rounded-full border px-3 py-1 text-xs font-semibold",
                hasFollowUps
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
            >
              {loading ? "Checking..." : hasFollowUps ? `${followUps.length} to review` : "No follow-up due"}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          {loading ? (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <SplitStatSkeleton />
              <ListRowsSkeleton rows={3} />
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <CreditCard className="h-4 w-4" />
                    <p className="text-xs font-semibold uppercase tracking-wide">Deposits</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{unpaidDeposits.length}</p>
                  <p className="mt-1 text-xs text-slate-600">{formatCurrency(unpaidValue)} not marked paid</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <AlertCircle className="h-4 w-4" />
                    <p className="text-xs font-semibold uppercase tracking-wide">Confirm</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{pending.length}</p>
                  <p className="mt-1 text-xs text-slate-600">Pending bookings</p>
                </div>
                <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4">
                  <div className="flex items-center gap-2 text-rose-700">
                    <Clock3 className="h-4 w-4" />
                    <p className="text-xs font-semibold uppercase tracking-wide">Recovery</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-950">{recovery.length}</p>
                  <p className="mt-1 text-xs text-slate-600">Cancelled or no-show</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Action queue</p>
                    <p className="mt-0.5 text-xs text-slate-500">Unpaid deposits, pending bookings, and recovery items from this filter</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {followUps.length}
                  </span>
                </div>
                {followUps.length === 0 ? (
                  <div className="mt-4 flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-center text-sm text-slate-500">
                    No payment or booking follow-ups for this period.
                  </div>
                ) : (
                  <div className="mt-4 divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-white">
                    {followUps.map((booking: any) => (
                      <div key={booking.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">{booking.clientName}</p>
                          <p className="truncate text-xs text-slate-500">
                            {booking.serviceName ? `${booking.serviceName} · ` : ""}
                            {format(new Date(booking.startTime), "EEE, d MMM h:mm a")}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize",
                            booking.followUpType === "deposit"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : booking.followUpType === "pending"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-rose-200 bg-rose-50 text-rose-700",
                          )}
                        >
                          {booking.followUpType === "deposit" ? "Deposit" : booking.status.replace("_", " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {hasFollowUps
                ? "Use bookings to confirm appointments, mark deposits, or recover cancelled and no-show clients."
                : "This selected period does not currently need payment follow-up."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/bookings"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary/15 transition-colors hover:bg-primary/90"
              >
                View bookings
              </Link>
              <Link
                href="/payments"
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950"
              >
                View payments
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
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
          <SplitStatSkeleton />
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
            <ListRowsSkeleton rows={5} />
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

const defaultHeatmapHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
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

function buildHeatmapHours(bookings: any[]) {
  const bookedHours = bookings
    .map((booking) => new Date(booking.startTime).getHours())
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);

  if (bookedHours.length === 0) return defaultHeatmapHours;

  const minHour = Math.min(defaultHeatmapHours[0], ...bookedHours);
  const maxHour = Math.max(defaultHeatmapHours[defaultHeatmapHours.length - 1], ...bookedHours);
  return Array.from({ length: maxHour - minHour + 1 }, (_, index) => minHour + index);
}

function buildBookingHeatmap(bookings: any[], range: { start: Date; end: Date }) {
  const periodBookings = bookings.filter((booking) => {
    const date = new Date(booking.startTime);
    return isWithinRange(date, range.start, range.end);
  });

  const hours = buildHeatmapHours(periodBookings);
  const counts = hours.map((hour) =>
    heatmapDays.map((_, day) => ({
      day,
      hour,
      count: 0,
    })),
  );

  periodBookings.forEach((booking) => {
    const date = new Date(booking.startTime);
    const hourIndex = hours.indexOf(date.getHours());
    if (hourIndex === -1) return;
    counts[hourIndex][date.getDay()].count += 1;
  });

  const total = counts.flat().reduce((sum, cell) => sum + cell.count, 0);
  return { rows: counts, hours, total };
}

function BookingHeatmapCard({ loading, heatmap, range }: any) {
  return (
    <Card className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950">Bookings by time</h2>
            <p className="mt-1 text-sm text-slate-500">
              {range.label} bookings grouped by day and start time
            </p>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {heatmap.total} bookings
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] font-medium text-slate-500">
          {[
            ["bg-slate-100", "0"],
            ["bg-emerald-100", "1 booking"],
            ["bg-emerald-200", "2-3 bookings"],
            ["bg-emerald-400", "4-5 bookings"],
            ["bg-primary", "6+ bookings"],
          ].map(([color, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
              {label}
            </div>
          ))}
        </div>

        {loading ? (
          <HeatmapSkeleton />
        ) : (
          <div className="mt-6 grid grid-cols-[32px_1fr] gap-3">
            <div className="grid gap-1.5 text-right text-[11px] text-slate-400">
              {heatmap.hours.map((hour: number) => (
                <div key={hour} className="flex h-7 items-center justify-end sm:h-8">
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
                        "h-7 rounded-md border border-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.03)] transition-colors sm:h-8",
                        cell.count === 0 ? "bg-slate-100" : heatmapCellColor(cell.count),
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

function heatmapCellColor(count: number) {
  if (count >= 6) return "bg-primary text-primary-foreground";
  if (count >= 4) return "bg-emerald-400";
  if (count >= 2) return "bg-emerald-200";
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
