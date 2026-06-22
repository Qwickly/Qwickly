import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useGetDashboardSummary, useGetActivityFeed, useGetPopularServices, useGetRevenueChart } from "@workspace/api-client-react";
import { ArrowUpRight, ArrowDownRight, Calendar, DollarSign, Users, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: loadingActivities } = useGetActivityFeed();
  const { data: services, isLoading: loadingServices } = useGetPopularServices();
  const { data: chartData, isLoading: loadingChart } = useGetRevenueChart({ period: "30d" });

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Good morning, Aiden</h1>
        <p className="text-muted-foreground text-sm">Here's what's happening at your business today.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Today's Appointments"
          value={summary?.todayAppointments.toString() ?? "-"}
          change={summary?.todayAppointmentsChange}
          icon={Calendar}
          loading={loadingSummary}
        />
        <MetricCard
          title="Revenue This Month"
          value={summary ? formatCurrency(summary.revenueThisMonth) : "-"}
          change={summary?.revenueChange}
          icon={DollarSign}
          loading={loadingSummary}
        />
        <MetricCard
          title="Upcoming Bookings"
          value={summary?.upcomingBookings.toString() ?? "-"}
          change={summary?.upcomingChange}
          icon={Users}
          loading={loadingSummary}
        />
        <MetricCard
          title="No-Show Rate"
          value={summary ? `${summary.noShowRate}%` : "-"}
          change={summary?.noShowChange}
          icon={Clock}
          loading={loadingSummary}
          inverse
        />
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Revenue This Month</CardTitle>
          <CardDescription>Daily revenue trend for the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingChart ? (
            <div className="h-56 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `R${v}`} width={50} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "8px", border: "1px solid hsl(var(--border))" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    formatter={(v: number) => [`R ${v.toLocaleString()}`, "Revenue"]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#dashRevGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 lg:col-span-2 shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Popular Services</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingServices ? (
              <div className="h-48 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : services?.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">No services data available.</div>
            ) : (
              <div className="space-y-3">
                {services?.slice(0, 6).map((service, i) => {
                  const maxRevenue = Math.max(...(services?.map(s => s.revenue) ?? [1]));
                  const pct = Math.round((service.revenue / maxRevenue) * 100);
                  return (
                    <div key={service.id} className="flex items-center gap-4">
                      <span className="text-xs text-muted-foreground w-4 font-medium">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm truncate">{service.name}</span>
                          <span className="text-sm font-semibold ml-4 shrink-0">{formatCurrency(service.revenue)}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{service.bookingCount} bookings</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1 shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Activity Feed</CardTitle>
          </CardHeader>
          <CardContent className="overflow-y-auto max-h-80">
            {loadingActivities ? (
              <div className="h-48 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : activities?.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground">No recent activity.</div>
            ) : (
              <div className="space-y-4 relative before:absolute before:left-4 before:top-0 before:h-full before:w-0.5 before:bg-border">
                {activities?.slice(0, 8).map((activity) => (
                  <div key={activity.id} className="relative flex items-start gap-3 pl-9">
                    <div className="absolute left-3 top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-card z-10" />
                    <div className="flex-1 min-w-0 pb-1">
                      <span className="text-xs text-muted-foreground block mb-0.5">
                        {format(new Date(activity.timestamp), "h:mm a")}
                      </span>
                      <span className="text-sm font-medium block">{activity.message}</span>
                      <span className="text-xs text-muted-foreground">{activity.clientName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, change, icon: Icon, loading, inverse = false }: any) {
  const isPositive = change > 0;
  const isGood = inverse ? !isPositive : isPositive;

  return (
    <Card className="shadow-sm border-border/50 hover:shadow-md transition-shadow">
      <CardContent className="p-6 flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground leading-none">{title}</p>
            {loading ? (
              <div className="h-8 w-24 bg-muted animate-pulse rounded" />
            ) : (
              <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
            )}
          </div>
          <div className="p-3 bg-primary/10 rounded-xl">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>

        {!loading && change !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "flex items-center text-xs font-medium px-1.5 py-0.5 rounded-sm",
              isGood ? "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50" : "text-destructive bg-destructive/10"
            )}>
              {isPositive ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
              {Math.abs(change)}%
            </span>
            <span className="text-xs text-muted-foreground">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
