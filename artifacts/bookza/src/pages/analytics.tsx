import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, Users, CalendarX, Sparkles, Clock, Star } from "lucide-react";
import { analyticsKeys, fetchAnalyticsInsights, fetchAnalyticsOverview, type AnalyticsPeriod } from "@/lib/analytics";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

const COLORS = ["hsl(var(--primary))", "#3b82f6", "#8b5cf6", "#f97316", "#ef4444", "#06b6d4"];

export default function AnalyticsPage() {
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
  const retentionRate = Number(data?.retentionRate ?? 0);
  const noShowRate = Number(data?.noShowRate ?? 0);
  const noShowCount = Number(data?.noShowCount ?? 0);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Analytics</h1>
          <p className="text-muted-foreground text-sm">Deep dive into your business performance.</p>
        </div>
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-[180px] bg-card">
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
        <div className="h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !data ? (
        <div className="h-[60vh] flex items-center justify-center text-muted-foreground">No analytics data available.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="shadow-sm border-border/50 bg-gradient-to-br from-card to-emerald-50/20 dark:to-emerald-950/20">
              <CardContent className="p-6">
                <div className="p-3 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg w-fit">
                  <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                  <p className="text-3xl font-bold mt-1">{formatCurrency(totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{totalBookings} bookings</p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50 bg-gradient-to-br from-card to-blue-50/20 dark:to-blue-950/20">
              <CardContent className="p-6">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/50 rounded-lg w-fit">
                  <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-muted-foreground">Retention Rate</p>
                  <p className="text-3xl font-bold mt-1">{retentionRate}%</p>
                  <p className="text-xs text-muted-foreground mt-1">Returning clients</p>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50 bg-gradient-to-br from-card to-red-50/20 dark:to-red-950/20">
              <CardContent className="p-6">
                <div className="p-3 bg-red-100 dark:bg-red-900/50 rounded-lg w-fit">
                  <CalendarX className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-muted-foreground">No-Show Rate</p>
                  <p className="text-3xl font-bold mt-1">{noShowRate}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{noShowCount} no-shows in this period</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-sm border-border/50">
              <CardHeader>
                <CardTitle>Revenue & Bookings Trend</CardTitle>
                <CardDescription>Daily performance over the selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorBookings" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `R${v}`} width={50} />
                      <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number, name: string) => [name === "revenue" ? `R ${v.toLocaleString()}` : v, name === "revenue" ? "Revenue" : "Bookings"]}
                      />
                      <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
                      <Area yAxisId="right" type="monotone" dataKey="bookings" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorBookings)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader>
                <CardTitle>Service Breakdown</CardTitle>
                <CardDescription>Revenue share by service</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full flex items-center gap-4">
                  <ResponsiveContainer width="50%" height="100%">
                    <PieChart>
                      <Pie data={data.serviceBreakdown} dataKey="revenue" cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                        {data.serviceBreakdown.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
                        formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {data.serviceBreakdown.slice(0, 6).map((s, i) => (
                      <div key={s.name} className="flex items-center gap-2 text-sm">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="truncate text-xs text-muted-foreground flex-1">{s.name}</span>
                        <span className="font-semibold text-xs">R {s.revenue.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm border-border/50">
            <CardHeader>
              <CardTitle>Service Revenue Comparison</CardTitle>
              <CardDescription>Revenue generated per service over the period</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.serviceBreakdown} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `R${v}`} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} width={120} />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted)/0.5)" }}
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
                      formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Business Insights
            </h2>
            {loadingInsights ? (
              <div className="h-24 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {insights?.map((insight, i) => {
                  const icons = [TrendingUp, Users, Clock, Star, CalendarX, Sparkles];
                  const colors = [
                    "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50",
                    "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50",
                    "bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900/50",
                    "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50",
                    "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50",
                    "bg-cyan-50 text-cyan-700 border-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-400 dark:border-cyan-900/50",
                  ];
                  const Icon = icons[i % icons.length];
                  return (
                    <Card key={i} className={`border shadow-none ${colors[i % colors.length]}`}>
                      <CardContent className="p-4 flex gap-3 items-start">
                        <div className="p-2 rounded-lg bg-white/50 dark:bg-black/20 shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <p className="text-sm font-medium leading-snug">{insight.text}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
