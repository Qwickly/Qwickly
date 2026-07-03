import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useGetDashboardSummary, useGetActivityFeed, useGetPopularServices, useGetRevenueChart, useGetBookings, useGetPaymentsSummary, useGetWhatsappConversations } from "@workspace/api-client-react";
import {
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
  Clock3,
  Loader2,
  MessageSquareText,
  CreditCard,
  Sparkles,
  Activity,
  BadgeCheck,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: loadingActivities } = useGetActivityFeed();
  const { data: services, isLoading: loadingServices } = useGetPopularServices();
  const { data: chartData, isLoading: loadingChart } = useGetRevenueChart({ period: "30d" });
  const { data: bookings, isLoading: loadingBookings } = useGetBookings({
    status: "confirmed",
  });
  const { data: paymentsSummary, isLoading: loadingPaymentsSummary } = useGetPaymentsSummary();
  const { data: whatsappConversations, isLoading: loadingWhatsapp, isError: whatsappError } = useGetWhatsappConversations();

  const formatCurrency = (val: any) => {
    const num = Number(val);
    if (Number.isNaN(num) || val === null || val === undefined) return "R 0";
    return `R ${num.toLocaleString()}`;
  };
  const activeChatCount = Array.isArray(whatsappConversations) ? whatsappConversations.length : 0;
  const unreadMessageCount = Array.isArray(whatsappConversations)
    ? whatsappConversations.reduce((sum, chat) => sum + (chat.unreadCount ?? 0), 0)
    : 0;

  const now = new Date();
  const upcomingBookings = Array.isArray(bookings)
    ? bookings
        .filter((b) => new Date(b.startTime) >= now)
        .slice()
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 4)
    : [];

  const recentBookings = Array.isArray(bookings)
    ? bookings
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5)
    : [];

  const quickStats = [
    {
      title: "Today's bookings",
      value: (summary && typeof summary === "object" && "todayAppointments" in summary && summary.todayAppointments != null) ? summary.todayAppointments.toString() : "-",
      change: (summary && typeof summary === "object" && "todayAppointmentsChange" in summary) ? (summary as any).todayAppointmentsChange : undefined,
      icon: CalendarDays,
      inverse: false,
    },
    {
      title: "Active chats",
      value: loadingWhatsapp ? "-" : whatsappError ? "Disconnected" : `${activeChatCount} (${unreadMessageCount} unread)`,
      change: undefined,
      icon: MessageSquareText,
      inverse: false,
    },
    {
      title: "Upcoming bookings",
      value: (summary && typeof summary === "object" && "upcomingBookings" in summary && summary.upcomingBookings != null) ? summary.upcomingBookings.toString() : "-",
      change: (summary && typeof summary === "object" && "upcomingChange" in summary) ? (summary as any).upcomingChange : undefined,
      icon: Clock3,
      inverse: false,
    },
    {
      title: "Payments",
      value: paymentsSummary ? formatCurrency(paymentsSummary.totalRevenue) : (summary && typeof summary === "object" && "revenueThisMonth" in summary && summary.revenueThisMonth != null) ? formatCurrency(summary.revenueThisMonth) : "-",
      change: paymentsSummary?.revenueChange ?? (summary && typeof summary === "object" && "revenueChange" in summary ? (summary as any).revenueChange : undefined),
      icon: CreditCard,
      inverse: false,
    },
  ];

  const serviceHighlights = Array.isArray(services) ? services.slice(0, 4) : [];

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-4 text-slate-900 sm:px-4 lg:px-6 lg:py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:gap-6">
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-lg sm:p-7 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
                <Sparkles className="h-4 w-4" />
                Live operations dashboard
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Business dashboard</h1>
                <p className="mt-2 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                  A clean, white workspace for live bookings, payments, conversations, and service demand.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="flex items-center gap-2 text-slate-600">
                <Activity className="h-4 w-4" />
                <span>Live status</span>
              </div>
              <p className="mt-1 text-lg font-semibold text-slate-900">Connected</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <MetricCard
                key={stat.title}
                title={stat.title}
                value={stat.value}
                change={stat.change}
                icon={Icon}
                loading={loadingSummary || loadingWhatsapp || loadingPaymentsSummary}
                inverse={stat.inverse}
              />
            );
          })}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Revenue pulse</CardTitle>
              <CardDescription className="text-slate-500">Daily revenue trend for the last 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChart ? (
                <div className="flex h-56 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
                </div>
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={Array.isArray(chartData) ? chartData : []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dashRevGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.24} />
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `R${v}`} width={50} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0" }}
                        itemStyle={{ color: "#0f172a" }}
                        formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#38bdf8" strokeWidth={2.5} fill="url(#dashRevGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Top booked services</CardTitle>
              <CardDescription className="text-slate-500">Current demand by service and revenue</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingServices ? (
                <div className="flex h-44 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : serviceHighlights.length === 0 ? (
                <div className="flex h-44 items-center justify-center text-slate-500">No services available.</div>
              ) : (
                <div className="space-y-3">
                  {serviceHighlights.map((service) => (
                    <div key={service.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{service.name}</p>
                          <p className="text-sm text-slate-500">{service.bookingCount} bookings</p>
                        </div>
                        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                          {formatCurrency(service.revenue)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Upcoming bookings</CardTitle>
              <CardDescription className="text-slate-500">The next confirmed appointments from your live schedule</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBookings ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : upcomingBookings.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-slate-500">No upcoming bookings scheduled.</div>
              ) : (
                <div className="space-y-3">
                  {upcomingBookings.map((booking) => (
                    <div key={booking.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <p className="font-semibold text-slate-900">{booking.clientName}</p>
                        <p className="text-sm text-slate-500">{format(new Date(booking.startTime), "h:mm a")}{booking.serviceName ? ` • ${booking.serviceName}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <CalendarDays className="h-4 w-4" />
                        {format(new Date(booking.startTime), "EEE")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">WhatsApp engagement</CardTitle>
              <CardDescription className="text-slate-500">Live conversations and unread messages from your chat inbox</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingWhatsapp ? (
                <div className="flex h-44 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : whatsappError ? (
                <div className="flex h-44 items-center justify-center text-slate-500">WhatsApp not connected or unauthorized.</div>
              ) : whatsappConversations?.length ? (
                <div className="space-y-3">
                  {whatsappConversations.slice(0, 3).map((conversation) => (
                    <div key={conversation.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{conversation.clientName}</p>
                          <p className="text-sm text-slate-500 truncate">{conversation.lastMessage}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-slate-500">{format(new Date(conversation.lastMessageAt), "h:mm a")}</p>
                          {conversation.unreadCount > 0 ? (
                            <div className="mt-1 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                              {conversation.unreadCount}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-44 items-center justify-center text-slate-500">No active WhatsApp conversations yet.</div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Recent bookings</CardTitle>
              <CardDescription className="text-slate-500">Live confirmed bookings from your schedule</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBookings ? (
                <div className="flex h-44 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : recentBookings.length === 0 ? (
                <div className="flex h-44 items-center justify-center text-slate-500">No recent bookings available.</div>
              ) : (
                <div className="space-y-3">
                  {recentBookings.map((booking) => (
                    <div key={booking.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{booking.clientName}</p>
                          <p className="text-sm text-slate-500">{booking.serviceName} · {format(new Date(booking.startTime), "EEE, h:mm a")}</p>
                        </div>
                        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                          {booking.status.replace("_", " ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Payments & follow-up</CardTitle>
              <CardDescription className="text-slate-500">Stay ahead of revenue, deposits, and overdue balances</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-700">
                  <CreditCard className="h-4 w-4" />
                  <p className="text-sm font-semibold text-slate-900">Payments received</p>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {loadingPaymentsSummary ? "-" : paymentsSummary ? formatCurrency(paymentsSummary.totalRevenue) : "-"}
                </p>
                <p className="mt-1 text-sm text-slate-500">Total revenue</p>
                <p className="mt-2 text-sm text-slate-500">
                  Deposits: {loadingPaymentsSummary ? "-" : paymentsSummary ? formatCurrency(paymentsSummary.depositsCollected) : "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-700">
                  <BadgeCheck className="h-4 w-4" />
                  <p className="text-sm font-semibold text-slate-900">Outstanding balance</p>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {loadingPaymentsSummary ? "-" : paymentsSummary ? formatCurrency(paymentsSummary.outstandingPayments) : "-"}
                </p>
                <p className="mt-1 text-sm text-slate-500">Awaiting payment</p>
                <p className="mt-2 text-sm text-slate-500">
                  No-show rate: {summary && typeof summary === "object" && "noShowRate" in summary && summary.noShowRate != null ? `${summary.noShowRate.toFixed(1)}%` : "-"}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ title, value, change, icon: Icon, loading, inverse = false }: any) {
  const isPositive = change > 0;
  const isGood = inverse ? !isPositive : isPositive;

  return (
<Card className="border border-slate-200 bg-white shadow-sm">
      <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none text-slate-500">{title}</p>
            {loading ? (
              <div className="h-8 w-24 animate-pulse rounded bg-slate-100" />
            ) : (
              <p className="text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-600">
            <Icon className="h-5 w-5" />
          </div>
        </div>

        {!loading && change !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium",
              isGood ? "bg-slate-100 text-slate-700" : "bg-red-100 text-red-700"
            )}>
              {isPositive ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
              {Math.abs(change)}%
            </span>
            <span className="text-xs text-slate-500">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
