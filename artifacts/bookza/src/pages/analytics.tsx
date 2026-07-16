import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton, ListRowsSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { PageHeaderSkeleton } from "@/components/skeletons/page-skeletons";
import {
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
import { useEntitlements } from "@/hooks/use-entitlements";

// Validated categorical palette (CVD-safe, worst adjacent ΔE 24.2) for the
// service breakdown pie/bar — identity is also carried by legend + axis labels.
const COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948"];
const CHART_PRIMARY = "#42A324"; // brand green (matches --primary)
const CHART_SECONDARY = "#1baf7a"; // aqua, for the second trend series
const CHART_GRID = "#e5e7eb";
const CHART_AXIS = "#64748b";
// Tooltip chrome uses CSS vars so it adapts to light/dark (it's an HTML layer).
const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "10px",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
} as const;

function AnalyticsLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 bg-card p-4 sm:p-5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 bg-card p-4 sm:p-5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton className="h-[280px]" />
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-44" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton className="h-[280px]" />
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton className="h-[300px]" />
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton className="h-[300px]" />
          </CardContent>
        </Card>
      </section>
      <Card className="border-border/60 shadow-none">
        <CardContent className="p-4">
          <ListRowsSkeleton rows={3} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  // Analytics is a paid add-on (free during trial). This read two metadata flags
  // that no plan carries any more, so the page was blocked for everyone.
  const { data: entitlements, isLoading: loadingEntitlements } = useEntitlements();
  const analyticsEnabled = Boolean(
    entitlements?.entitled && entitlements.grants?.analytics,
  );

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

  if (loadingSubscription || loadingEntitlements) {
    return (
      <div className="space-y-6 pb-12">
        <PageHeaderSkeleton actions={1} />
        <AnalyticsLoadingSkeleton />
      </div>
    );
  }

  if (!analyticsEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
        <Card className="w-full max-w-lg border-border/60 p-6 text-center shadow-none">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold text-foreground">Analytics locked</h2>
          <p className="mb-6 text-sm leading-7 text-muted-foreground">
            The analytics dashboard is not included in your current plan. Upgrade to unlock premium insights and growth visibility.
          </p>
          <Button className="w-full bg-primary text-white hover:bg-primary/90" asChild>
            <a href="/billing">
              Upgrade plan <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Analytics</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Understand demand, revenue quality, and client retention at a glance.
          </p>
        </div>
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-full sm:w-[180px]">
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

      {isLoading ? (
        <AnalyticsLoadingSkeleton />
      ) : !data ? (
        <div className="flex min-h-[50vh] items-center justify-center rounded-xl border border-border/60 text-sm text-muted-foreground">
          No analytics data available.
        </div>
      ) : (
        <>
            <section className="overflow-hidden rounded-xl border border-border/60">
              <div className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
                {[
                  { label: "Total revenue", value: formatCurrency(totalRevenue), footer: `${totalBookings} bookings tracked`, icon: CircleDollarSign },
                  { label: "Completion rate", value: `${completionRate}%`, footer: `${completedBookings} completed`, icon: CheckCircle2 },
                  { label: "Retention rate", value: `${retentionRate}%`, footer: "Returning clients", icon: Users },
                  { label: "No-show rate", value: `${noShowRate}%`, footer: `${noShowCount} no-shows`, icon: CalendarX },
                ].map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="flex flex-col gap-1.5 bg-card p-4 sm:p-5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <p className="truncate text-[10px] font-medium uppercase tracking-wider sm:text-[11px]">{stat.label}</p>
                      </div>
                      <p className="truncate text-xl font-semibold text-foreground">{stat.value}</p>
                      <p className="truncate text-xs text-muted-foreground">{stat.footer}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border/60">
              <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-3">
                {[
                  { label: "Average booking value", value: formatCurrency(averageBookingValue), footer: "Per booking", icon: TrendingUp },
                  { label: "Peak booking hour", value: peakHour, footer: `${peakHourBookings} bookings`, icon: Clock },
                  { label: "Bookings this period", value: totalBookings.toString(), footer: "Across your calendar", icon: CalendarDays },
                ].map((metric) => {
                  const Icon = metric.icon;
                  return (
                    <div key={metric.label} className="flex flex-col gap-1.5 bg-card p-4 sm:p-5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <p className="truncate text-[10px] font-medium uppercase tracking-wider sm:text-[11px]">{metric.label}</p>
                      </div>
                      <p className="truncate text-xl font-semibold text-foreground">{metric.value}</p>
                      <p className="truncate text-xs text-muted-foreground">{metric.footer}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="border-border/60 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Revenue &amp; bookings trend</CardTitle>
                  <CardDescription>A daily pulse of the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_PRIMARY} stopOpacity={0.28} />
                            <stop offset="95%" stopColor={CHART_PRIMARY} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorBookings" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={CHART_SECONDARY} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={CHART_SECONDARY} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} />
                        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} tickFormatter={(v) => `R${v}`} width={50} />
                        <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          itemStyle={{ color: "hsl(var(--foreground))" }}
                          formatter={(v: number, name: string) => [name === "revenue" ? `R ${v.toLocaleString()}` : v, name === "revenue" ? "Revenue" : "Bookings"]}
                        />
                        <Area yAxisId="left" type="monotone" dataKey="revenue" stroke={CHART_PRIMARY} strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
                        <Area yAxisId="right" type="monotone" dataKey="bookings" stroke={CHART_SECONDARY} strokeWidth={2} fillOpacity={1} fill="url(#colorBookings)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Peak booking times</CardTitle>
                  <CardDescription>When your business is busiest</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.weekdayBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number, name: string) => [name === "bookings" ? `${v} bookings` : `R ${v.toLocaleString()}`, name === "bookings" ? "Bookings" : "Revenue"]}
                        />
                        <Line type="monotone" dataKey="bookings" stroke={CHART_PRIMARY} strokeWidth={2.5} dot={{ r: 4, fill: CHART_PRIMARY }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Card className="border-border/60 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Service breakdown</CardTitle>
                  <CardDescription>Revenue share by service</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex h-[300px] flex-col gap-4 md:flex-row md:items-center md:gap-4">
                    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                      <PieChart>
                        <Pie data={data.serviceBreakdown} dataKey="revenue" cx="50%" cy="50%" outerRadius={90} innerRadius={52} paddingAngle={2}>
                          {data.serviceBreakdown.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="hsl(var(--card))" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {data.serviceBreakdown.slice(0, 6).map((service, i) => (
                        <div key={service.name} className="flex items-center gap-2 text-sm">
                          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="flex-1 truncate text-xs text-muted-foreground">{service.name}</span>
                          <span className="text-xs font-semibold text-foreground">R {service.revenue.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Service revenue comparison</CardTitle>
                  <CardDescription>How each service contributes over the period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.serviceBreakdown} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID} />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} tickFormatter={(v) => `R${v}`} />
                        <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_AXIS }} width={120} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))" }}
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                        />
                        <Bar dataKey="revenue" fill={CHART_PRIMARY} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section>
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Business insights</h2>
              </div>
              {loadingInsights ? (
                <Card className="border-border/60 shadow-none">
                  <CardContent className="p-4">
                    <ListRowsSkeleton rows={3} />
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {insights?.map((insight, i) => {
                    const icons = [TrendingUp, Users, Clock, Star, CalendarX, Sparkles];
                    const Icon = icons[i % icons.length];
                    return (
                      <Card key={i} className="border-border/60 shadow-none">
                        <CardContent className="flex items-start gap-3 p-4">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">{insight.text}</p>
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
  );
}
