import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  TrendingUp,
  Users,
  CalendarX,
  Sparkles,
  Clock,
  Star,
  Lock,
  ArrowRight,
  CircleDollarSign,
  CheckCircle2,
  CalendarDays,
  BarChart3,
  Activity,
} from "lucide-react";
import { analyticsKeys, fetchAnalyticsInsights, fetchAnalyticsOverview, type AnalyticsPeriod } from "@/lib/analytics";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { fetchSubscription } from "@/lib/catalog-subscriptions";

const COLORS = ["#7dff9d", "#3ddc84", "#68f0a2", "#b8f7c4", "#4ade80", "#22c55e"];

export default function AnalyticsPage() {
  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  const analyticsEnabled = subscription?.metadata?.analyticsEnabled || subscription?.plans?.metadata?.analyticsEnabled || false;

  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const { data, isLoading } = useQuery({
    queryKey: analyticsKeys.overview(period),
    queryFn: () => fetchAnalyticsOverview(period),
  });
  const { data: insights, isLoading: loadingInsights } = useQuery({
    queryKey: analyticsKeys.insights(period),
    queryFn: () => fetchAnalyticsInsights(period),
  });

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;
  const handlePeriodChange = (value: string) => {
    setPeriod(value as AnalyticsPeriod);
  };

  const totalRevenue = Number(data?.totalRevenue ?? 0);
  const totalBookings = Number(data?.totalBookings ?? 0);
  const completedBookings = Number(data?.completedBookings ?? 0);
  const averageBookingValue = Number(data?.averageBookingValue ?? 0);
  const completionRate = Number(data?.completionRate ?? 0);
  const retentionRate = Number(data?.retentionRate ?? 0);
  const noShowRate = Number(data?.noShowRate ?? 0);
  const noShowCount = Number(data?.noShowCount ?? 0);
  const peakHour = data?.peakHour ?? "00:00";
  const peakHourBookings = Number(data?.peakHourBookings ?? 0);

  if (loadingSubscription) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-8">
        <div className="rounded-[24px] border border-emerald-900/70 bg-[#07180f]/95 p-6 shadow-[0_24px_80px_rgba(3,20,11,0.35)]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
        </div>
      </div>
    );
  }

  if (!analyticsEnabled) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-8">
        <Card className="w-full max-w-lg border border-emerald-900/70 bg-[radial-gradient(circle_at_top,_rgba(125,255,157,0.16),_transparent_55%),linear-gradient(135deg,_#07180f_0%,_#0d2418_100%)] p-6 text-center shadow-[0_24px_80px_rgba(3,20,11,0.35)]">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10">
            <Lock className="h-8 w-8 text-emerald-300" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold text-white">Analytics locked</h2>
          <p className="mb-6 text-sm leading-7 text-emerald-100/80">
            The analytics dashboard is not included in your current plan. Upgrade to unlock premium insights and growth visibility.
          </p>
          <Button className="w-full rounded-full bg-emerald-400 text-[#04110a] hover:bg-emerald-300" asChild>
            <a href="/billing">
              Upgrade plan <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(125,255,157,0.16),_transparent_35%),linear-gradient(135deg,_#04110a_0%,_#07180f_45%,_#0b2418_100%)] px-3 py-4 text-emerald-50 sm:px-4 lg:px-6 lg:py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:gap-6">
        <section className="rounded-[28px] border border-emerald-900/70 bg-[#07180f]/90 p-5 shadow-[0_24px_80px_rgba(3,20,11,0.35)] sm:p-7 lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200">
                <Sparkles className="h-4 w-4" />
                Business intelligence
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Analytics</h1>
                <p className="max-w-xl text-sm leading-7 text-emerald-100/80 sm:text-base">
                  Understand demand, revenue quality, and client retention at a glance with a sharper, more premium view of your business performance.
                </p>
              </div>
            </div>
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="1y">Last year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        {isLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center rounded-[28px] border border-emerald-900/70 bg-[#07180f]/85 p-6 shadow-[0_24px_80px_rgba(3,20,11,0.25)]">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
          </div>
        ) : !data ? (
          <div className="flex min-h-[50vh] items-center justify-center rounded-[28px] border border-emerald-900/70 bg-[#07180f]/85 p-6 text-emerald-100/80 shadow-[0_24px_80px_rgba(3,20,11,0.25)]">
            No analytics data available.
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  title: "Total revenue",
                  value: formatCurrency(totalRevenue),
                  footer: `${totalBookings} bookings tracked`,
                  icon: CircleDollarSign,
                  accent: "text-emerald-300",
                  bg: "bg-emerald-500/12",
                },
                {
                  title: "Completion rate",
                  value: `${completionRate}%`,
                  footer: `${completedBookings} completed bookings`,
                  icon: CheckCircle2,
                  accent: "text-emerald-300",
                  bg: "bg-emerald-500/12",
                },
                {
                  title: "Retention rate",
                  value: `${retentionRate}%`,
                  footer: "Returning clients",
                  icon: Users,
                  accent: "text-lime-300",
                  bg: "bg-lime-500/12",
                },
                {
                  title: "No-show rate",
                  value: `${noShowRate}%`,
                  footer: `${noShowCount} no-shows`,
                  icon: CalendarX,
                  accent: "text-emerald-200",
                  bg: "bg-emerald-500/10",
                },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <Card key={stat.title} className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_18px_45px_rgba(4,23,14,0.28)]">
                    <CardContent className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className={`rounded-2xl border border-emerald-400/20 p-3 ${stat.bg}`}>
                          <Icon className={`h-5 w-5 ${stat.accent}`} />
                        </div>
                        <Badge variant="outline" className="border-emerald-800/70 bg-[#0d2b1d]/70 text-[11px] uppercase tracking-[0.2em] text-emerald-200">
                          Live
                        </Badge>
                      </div>
                      <div className="mt-5">
                        <p className="text-sm text-emerald-100/70">{stat.title}</p>
                        <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
                        <p className="mt-1 text-xs text-emerald-100/70">{stat.footer}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              {[
                {
                  title: "Average booking value",
                  value: formatCurrency(averageBookingValue),
                  icon: TrendingUp,
                },
                {
                  title: "Peak booking hour",
                  value: peakHour,
                  footer: `${peakHourBookings} bookings`,
                  icon: Clock,
                },
                {
                  title: "Bookings this period",
                  value: totalBookings.toString(),
                  footer: "Across your business calendar",
                  icon: CalendarDays,
                },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <Card key={metric.title} className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_14px_35px_rgba(4,23,14,0.24)]">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-emerald-300">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm text-emerald-100/70">{metric.title}</p>
                          <p className="mt-1 text-xl font-semibold text-white">{metric.value}</p>
                          {metric.footer ? <p className="text-xs text-emerald-100/70">{metric.footer}</p> : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_20px_60px_rgba(4,23,14,0.3)]">
                <CardHeader>
                  <CardTitle className="text-white">Revenue & bookings trend</CardTitle>
                  <CardDescription className="text-emerald-100/70">A daily pulse of the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#7dff9d" stopOpacity={0.33} />
                            <stop offset="95%" stopColor="#7dff9d" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorBookings" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3ddc84" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3ddc84" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1d4d33" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9fcfb4" }} />
                        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9fcfb4" }} tickFormatter={(v) => `R${v}`} width={50} />
                        <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9fcfb4" }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#07180f", borderRadius: "10px", border: "1px solid #1d4d33" }}
                          itemStyle={{ color: "#f4fff6" }}
                          formatter={(v: number, name: string) => [name === "revenue" ? `R ${v.toLocaleString()}` : v, name === "revenue" ? "Revenue" : "Bookings"]}
                        />
                        <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#7dff9d" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
                        <Area yAxisId="right" type="monotone" dataKey="bookings" stroke="#3ddc84" strokeWidth={2} fillOpacity={1} fill="url(#colorBookings)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_20px_60px_rgba(4,23,14,0.3)]">
                <CardHeader>
                  <CardTitle className="text-white">Peak booking times</CardTitle>
                  <CardDescription className="text-emerald-100/70">When your business is busiest</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.weekdayBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1d4d33" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9fcfb4" }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9fcfb4" }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#07180f", borderRadius: "10px", border: "1px solid #1d4d33" }}
                          formatter={(v: number, name: string) => [name === "bookings" ? `${v} bookings` : `R ${v.toLocaleString()}`, name === "bookings" ? "Bookings" : "Revenue"]}
                        />
                        <Line type="monotone" dataKey="bookings" stroke="#7dff9d" strokeWidth={2.5} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Card className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_20px_60px_rgba(4,23,14,0.3)]">
                <CardHeader>
                  <CardTitle className="text-white">Service breakdown</CardTitle>
                  <CardDescription className="text-emerald-100/70">Revenue share by service</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex h-[300px] flex-col gap-4 md:flex-row md:items-center md:gap-4">
                    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                      <PieChart>
                        <Pie data={data.serviceBreakdown} dataKey="revenue" cx="50%" cy="50%" outerRadius={90} innerRadius={52}>
                          {data.serviceBreakdown.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: "#07180f", borderRadius: "10px", border: "1px solid #1d4d33" }}
                          formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {data.serviceBreakdown.slice(0, 6).map((service, i) => (
                        <div key={service.name} className="flex items-center gap-2 text-sm">
                          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="flex-1 truncate text-xs text-emerald-100/70">{service.name}</span>
                          <span className="text-xs font-semibold text-white">R {service.revenue.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_20px_60px_rgba(4,23,14,0.3)]">
                <CardHeader>
                  <CardTitle className="text-white">Service revenue comparison</CardTitle>
                  <CardDescription className="text-emerald-100/70">How each service contributes over the period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.serviceBreakdown} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1d4d33" />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9fcfb4" }} tickFormatter={(v) => `R${v}`} />
                        <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#f4fff6" }} width={120} />
                        <Tooltip
                          cursor={{ fill: "rgba(125,255,157,0.08)" }}
                          contentStyle={{ backgroundColor: "#07180f", borderRadius: "10px", border: "1px solid #1d4d33" }}
                          formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                        />
                        <Bar dataKey="revenue" fill="#7dff9d" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section>
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-300" />
                <h2 className="text-xl font-semibold text-white">Business insights</h2>
              </div>
              {loadingInsights ? (
                <div className="flex h-24 items-center justify-center rounded-[24px] border border-emerald-900/70 bg-[#07180f]/85">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {insights?.map((insight, i) => {
                    const icons = [TrendingUp, Users, Clock, Star, CalendarX, Sparkles];
                    const Icon = icons[i % icons.length];
                    return (
                      <Card key={i} className="border border-emerald-900/70 bg-[#0b2118]/90 shadow-[0_14px_35px_rgba(4,23,14,0.2)]">
                        <CardContent className="flex items-start gap-3 p-4">
                          <div className="shrink-0 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-2 text-emerald-300">
                            <Icon className="h-4 w-4" />
                          </div>
                          <p className="text-sm leading-7 text-emerald-100/80">{insight.text}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
