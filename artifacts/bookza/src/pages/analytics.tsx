import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartSkeleton, ListRowsSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { PageHeaderSkeleton } from "@/components/skeletons/page-skeletons";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  CalendarCheck,
  CalendarDays,
  CalendarX,
  CircleDollarSign,
  Lock,
  ArrowRight,
  Users,
  UserPlus,
  Repeat2,
  Clock,
  Scissors,
  Send,
  Bot,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { useEntitlements } from "@/hooks/use-entitlements";
import {
  analyticsKeys,
  analyticsStatusLabel,
  fetchAnalyticsReport,
  type AnalyticsCampaigns,
  type AnalyticsChatbot,
  type AnalyticsClients,
  type AnalyticsMetric,
  type AnalyticsPeriod,
  type AnalyticsReport,
  type AnalyticsServices,
  type AnalyticsStaff,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

const COLORS = ["#42A324", "#2a78d6", "#1baf7a", "#eda100", "#4a3aa7", "#e34948"];
const CHART_PRIMARY = "#42A324";
const CHART_SECONDARY = "#2a78d6";
const CHART_GRID = "#e5e7eb";
const CHART_AXIS = "#64748b";
const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "10px",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
} as const;

function formatCurrency(value: number) {
  return `R ${Math.round(value).toLocaleString()}`;
}

function formatMetric(metric: AnalyticsMetric) {
  if (metric.format === "currency") return formatCurrency(Number(metric.value ?? 0));
  if (metric.format === "percent") return `${Number(metric.value ?? 0).toLocaleString()}%`;
  if (metric.format === "number") return Number(metric.value ?? 0).toLocaleString();
  return String(metric.value);
}

function metricIcon(metric: AnalyticsMetric) {
  const label = metric.label.toLowerCase();
  if (label.includes("revenue") || label.includes("value")) return CircleDollarSign;
  if (label.includes("client") || label.includes("retention")) return Users;
  if (label.includes("new")) return UserPlus;
  if (label.includes("rebook") || label.includes("return")) return Repeat2;
  if (label.includes("hour") || label.includes("lead") || label.includes("utilisation")) return Clock;
  if (label.includes("service")) return Scissors;
  if (label.includes("message") || label.includes("sent") || label.includes("delivery") || label.includes("reply")) return Send;
  if (label.includes("bot") || label.includes("review")) return Bot;
  if (label.includes("completion") || label.includes("conversion")) return TrendingUp;
  return CalendarDays;
}

function metricNumericValue(metric: AnalyticsMetric) {
  return typeof metric.value === "number" && Number.isFinite(metric.value)
    ? metric.value
    : undefined;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function SummaryGrid({ metrics }: { metrics: AnalyticsMetric[] }) {
  const desktopColumns = metrics.length > 0 && metrics.length % 4 === 0
    ? "xl:grid-cols-4"
    : metrics.length > 0 && metrics.length % 3 === 0
      ? "xl:grid-cols-3"
      : metrics.length <= 4
        ? "xl:grid-cols-4"
        : "xl:grid-cols-3";

  return (
    <section className={cn("grid gap-4 sm:grid-cols-2", desktopColumns)}>
      {metrics.map((metric) => (
        <MetricCard
          key={metric.label}
          title={metric.label}
          numericValue={metricNumericValue(metric)}
          textValue={typeof metric.value === "string" ? metric.value : undefined}
          formatValue={() => formatMetric(metric)}
          change={metric.change}
          icon={metricIcon(metric)}
          detail={metric.detail}
          loading={false}
        />
      ))}
    </section>
  );
}

function InsightTone({ tone }: { tone?: string }) {
  if (tone === "good") return "border-l-primary";
  if (tone === "warning") return "border-l-amber-500";
  if (tone === "opportunity") return "border-l-blue-500";
  return "border-l-slate-300";
}

function AnalyticsLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2 overflow-hidden rounded-lg bg-muted p-1">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-24" />
        ))}
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartSkeleton className="h-[300px]" />
        <ChartSkeleton className="h-[300px]" />
      </section>
      <Card className="border-border/60 shadow-none">
        <CardContent className="p-4">
          <ListRowsSkeleton rows={4} />
        </CardContent>
      </Card>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ClaimNotes({ claims }: { claims: string[] }) {
  if (!claims.length) return null;
  return (
    <Card className="border-border/60 bg-muted/30 shadow-none">
      <CardContent className="space-y-2 p-4">
        {claims.map((claim) => (
          <p key={claim} className="text-sm leading-6 text-muted-foreground">
            {claim}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function SimpleTable({
  headers,
  rows,
  emptyTitle,
  emptyText,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  emptyTitle: string;
  emptyText: string;
}) {
  if (!rows.length) return <EmptyState title={emptyTitle} text={emptyText} />;
  return (
    <div className="overflow-hidden rounded-2xl bg-card/60">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            {headers.map((header, index) => (
              <TableHead
                key={header}
                className={index === headers.length - 1 ? "text-right" : undefined}
              >
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow
              key={rowIndex}
              className="transition-colors hover:bg-muted/45 [&_td]:py-5"
            >
              {row.map((cell, cellIndex) => (
                <TableCell
                  key={cellIndex}
                  className={cellIndex === row.length - 1 ? "text-right" : undefined}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

function OverviewTab({ report }: { report: AnalyticsReport }) {
  const { overview, insights } = report;
  const missedBookingCount = overview.noShowCount + overview.cancelledCount;
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard
          title="Booked revenue"
          numericValue={overview.totalRevenue}
          formatValue={formatCurrency}
          change={overview.revenueChangePct}
          icon={CircleDollarSign}
          detail="Completed booked value"
          loading={false}
        />
        <MetricCard
          title="Bookings"
          numericValue={overview.totalBookings}
          formatValue={(value) => value.toLocaleString()}
          change={overview.bookingsChangePct}
          icon={CalendarDays}
          detail="Scheduled in this period"
          loading={false}
        />
        <MetricCard
          title="Future booked"
          numericValue={overview.futureBookedRevenue}
          formatValue={formatCurrency}
          icon={CalendarCheck}
          detail={`${overview.futureBookedBookings.toLocaleString()} upcoming booking${overview.futureBookedBookings === 1 ? "" : "s"}`}
          loading={false}
        />
        <MetricCard
          title="Lost booked value"
          numericValue={overview.revenueAtRisk}
          formatValue={formatCurrency}
          icon={CalendarX}
          detail={`${missedBookingCount} cancellation/no-show booking${missedBookingCount === 1 ? "" : "s"}`}
          loading={false}
          inverse
        />
      </section>

      <SummaryGrid
        metrics={[
          { label: "Completion rate", value: overview.completionRate, format: "percent", detail: "Past finished bookings only" },
          { label: "Returning clients", value: overview.retentionRate, format: "percent", detail: `${overview.returningClients} returning, ${overview.newClients} new` },
          { label: "Avg booking value", value: overview.averageBookingValue, format: "currency" },
          { label: "Peak hour", value: overview.peakHour, format: "text", detail: `${overview.peakHourBookings} bookings` },
        ]}
      />

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartCard title="Revenue and bookings trend" description="Revenue uses booked value from completed bookings.">
          {overview.revenueData.some((point) => point.bookings > 0) ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overview.revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="date" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis yAxisId="left" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "revenue" ? formatCurrency(Number(value)) : Number(value).toLocaleString()} />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.14} />
                  <Area yAxisId="right" type="monotone" dataKey="bookings" stroke={CHART_SECONDARY} fill={CHART_SECONDARY} fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No bookings in this period" text="Once bookings are scheduled, this trend will show revenue and demand movement." />
          )}
        </ChartCard>
        <ChartCard title="Booking health mix" description="Effective statuses include past confirmed bookings as completed.">
          {overview.statusBreakdown.length ? (
            <div className="space-y-3">
              {overview.statusBreakdown.map((row) => (
                <div key={row.status} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{analyticsStatusLabel(row.status)}</span>
                    <span className="text-sm text-muted-foreground">{row.count} bookings</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(row.percentageOfTotal, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No statuses yet" text="Booking statuses will appear as soon as this period has bookings." />
          )}
        </ChartCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Service revenue comparison" description={`Top service: ${overview.topServiceName} (${overview.topServiceShare}%).`}>
          {overview.serviceBreakdown.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overview.serviceBreakdown.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No completed services yet" text="Completed booked value by service will appear here." />
          )}
        </ChartCard>
        <ChartCard title="Decision snapshot" description="Quick signals that help decide what to do next.">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Best revenue day", overview.bestRevenueDay],
              ["Quietest day", overview.quietestDay],
              ["No-show rate", `${overview.noShowRate}%`],
              ["Cancellation rate", `${overview.cancellationRate}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-xl font-bold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        </ChartCard>
      </section>

      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Business insights</CardTitle>
          <CardDescription>Generated from the same analytics calculations shown on this page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {insights.length ? (
            insights.map((insight) => (
              <div key={`${insight.title}-${insight.text}`} className={`rounded-lg border border-l-4 bg-card p-4 ${InsightTone({ tone: insight.tone })}`}>
                <p className="font-semibold text-foreground">{insight.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{insight.text}</p>
                {insight.action ? <p className="mt-2 text-sm font-medium text-foreground">{insight.action}</p> : null}
              </div>
            ))
          ) : (
            <EmptyState title="No insights yet" text="Insights will appear once the period has enough bookings, clients, or messaging activity." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClientsTab({ data }: { data: AnalyticsClients }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <ChartCard title="New vs returning clients" description="Returning is calculated from booking history, not contact status.">
          {data.newClients || data.returningClients ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.newReturningData} dataKey="clients" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                    {data.newReturningData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No client activity" text="Client mix appears once clients have bookings in the selected period." />
          )}
        </ChartCard>
        <ChartCard title="Top clients" description="Ranked by completed booked value.">
          <SimpleTable
            headers={["Client", "Bookings", "Revenue", "Last visit", "Future"]}
            emptyTitle="No client value yet"
            emptyText="Completed bookings will reveal your highest-value clients."
            rows={data.topClients.map((row) => [
              <Link key="name" href={`/clients/${row.id}`} className="font-medium text-foreground hover:text-primary">{row.name}</Link>,
              row.bookings.toLocaleString(),
              formatCurrency(row.revenue),
              row.lastVisit,
              row.futureBookings.toLocaleString(),
            ])}
          />
        </ChartCard>
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Inactive clients" description="No future booking and last visit older than 60 days.">
          <SimpleTable
            headers={["Client", "Revenue", "Bookings", "Last visit"]}
            emptyTitle="No inactive clients found"
            emptyText="Clients with older visits and no upcoming booking will appear here."
            rows={data.inactiveClientRows.map((row) => [
              <Link key="name" href={`/clients/${row.id}`} className="font-medium text-foreground hover:text-primary">{row.name}</Link>,
              formatCurrency(row.revenue),
              row.bookings.toLocaleString(),
              row.lastVisit,
            ])}
          />
        </ChartCard>
        <ChartCard title="Clients without a future booking" description="Useful for retention campaigns and rebooking nudges.">
          <SimpleTable
            headers={["Client", "Revenue", "Bookings", "Last visit"]}
            emptyTitle="Everyone is covered"
            emptyText="Clients with bookings and no upcoming appointment will appear here."
            rows={data.noFutureBookingRows.map((row) => [
              <Link key="name" href={`/clients/${row.id}`} className="font-medium text-foreground hover:text-primary">{row.name}</Link>,
              formatCurrency(row.revenue),
              row.bookings.toLocaleString(),
              row.lastVisit,
            ])}
          />
        </ChartCard>
      </section>
    </div>
  );
}

function StaffTab({ data }: { data: AnalyticsStaff }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Revenue by staff member" description="Completed booked value by assigned staff.">
          {data.revenueData.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No staff bookings" text="Assigned completed bookings will show staff revenue here." />
          )}
        </ChartCard>
        <ChartCard title="Utilisation" description="Estimated from booked hours versus working days.">
          {data.utilisationData.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.utilisationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => `${Number(value)}%`} />
                  <Bar dataKey="utilisation" fill={CHART_SECONDARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No utilisation yet" text="Utilisation appears when staff have bookings in the selected period." />
          )}
        </ChartCard>
      </section>
      <ChartCard title="Staff performance table">
        <SimpleTable
          headers={["Staff", "Revenue", "Completed", "Avg value", "Utilisation", "No-show", "Revenue/hour"]}
          emptyTitle="No staff performance yet"
          emptyText="Assign bookings to staff to see detailed performance."
          rows={data.rows.map((row) => [
            row.id ? <Link key="name" href={`/staff/${row.id}`} className="font-medium text-foreground hover:text-primary">{row.name}</Link> : <span key="name" className="font-medium text-foreground">{row.name}</span>,
            formatCurrency(row.revenue),
            row.completedBookings.toLocaleString(),
            formatCurrency(row.averageBookingValue),
            `${row.utilisationRate}%`,
            `${row.noShowRate}%`,
            formatCurrency(row.revenuePerBookedHour),
          ])}
        />
      </ChartCard>
      <ClaimNotes claims={data.claims} />
    </div>
  );
}

function ServicesTab({ data }: { data: AnalyticsServices }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard title="Revenue by service" description="Completed booked value by service.">
          {data.revenueData.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No service revenue" text="Completed bookings will populate this chart." />
          )}
        </ChartCard>
        <ChartCard title="Revenue share" description="Which services carry the booked value.">
          {data.shareData.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.shareData} dataKey="value" nameKey="name" outerRadius={105}>
                    {data.shareData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No revenue share yet" text="Once services produce completed booked value, the mix will show here." />
          )}
        </ChartCard>
      </section>
      <ChartCard title="Service performance table">
        <SimpleTable
          headers={["Service", "Revenue", "Bookings", "Share", "Avg value", "Completion", "Cancel", "Revenue/hour"]}
          emptyTitle="No service performance yet"
          emptyText="Service analytics will appear once bookings are linked to services."
          rows={data.rows.map((row) => [
            row.id ? <Link key="name" href={`/services/${row.id}`} className="font-medium text-foreground hover:text-primary">{row.name}</Link> : <span key="name" className="font-medium text-foreground">{row.name}</span>,
            formatCurrency(row.revenue),
            row.bookings.toLocaleString(),
            `${row.revenueShare}%`,
            formatCurrency(row.averageSellingValue),
            `${row.completionRate}%`,
            `${row.cancellationRate}%`,
            formatCurrency(row.revenuePerBookedHour),
          ])}
        />
      </ChartCard>
    </div>
  );
}

function BookingsTab({ report }: { report: AnalyticsReport }) {
  const data = report.bookings;
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Status breakdown" description="Past confirmed bookings are treated as completed.">
          {data.statusBreakdown.length ? (
            <div className="space-y-3">
              {data.statusBreakdown.map((row) => (
                <Link key={row.status} href="/bookings" className="block rounded-lg border border-border/60 p-3 transition-colors hover:border-primary/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{analyticsStatusLabel(row.status)}</span>
                    <span className="text-sm text-muted-foreground">{row.count} bookings</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(row.percentageOfTotal, 100)}%` }} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No booking statuses" text="Status breakdown appears once bookings exist in the selected period." />
          )}
        </ChartCard>
        <ChartCard title="Busy and quiet hours" description="Based on bookings scheduled in this period.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SimpleTable
              headers={["Busy", "Bookings"]}
              emptyTitle="No busy hours"
              emptyText="Busy hours appear once bookings are scheduled."
              rows={data.busyHours.map((row) => [row.hour, row.bookings.toLocaleString()])}
            />
            <SimpleTable
              headers={["Quiet", "Bookings"]}
              emptyTitle="No quiet hours"
              emptyText="Quiet hours appear after there is enough booking activity."
              rows={data.quietHours.map((row) => [row.hour, row.bookings.toLocaleString()])}
            />
          </div>
        </ChartCard>
      </section>
      <ChartCard title="Weekday demand">
        {data.weekdayBreakdown.some((row) => row.bookings > 0) ? (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weekdayBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="day" stroke={CHART_AXIS} fontSize={12} />
                <YAxis stroke={CHART_AXIS} fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="bookings" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState title="No weekday demand" text="Bookings by weekday will appear here." />
        )}
      </ChartCard>
      <ClaimNotes claims={data.claims} />
    </div>
  );
}

function CampaignsTab({ data }: { data: AnalyticsCampaigns }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ChartCard title="Campaign engagement" description="Sent, opened, replied, and conversion tracking where present.">
          {data.engagementData.some((row) => row.value > 0) ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.engagementData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No campaign engagement" text="Sent messages and replies will appear once campaigns run." />
          )}
        </ChartCard>
        <ChartCard title="Campaign status">
          {data.statusData.some((row) => row.count > 0) ? (
            <div className="space-y-3">
              {data.statusData.map((row) => (
                <div key={row.name} className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <span className="capitalize text-foreground">{row.name}</span>
                  <span className="text-sm text-muted-foreground">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No campaigns in this period" text="Campaign status will appear after campaigns are created or sent." />
          )}
        </ChartCard>
      </section>
      <ChartCard title="Campaign table">
        <SimpleTable
          headers={["Campaign", "Status", "Sent", "Replies", "Delivery", "Revenue"]}
          emptyTitle="No campaigns yet"
          emptyText="Create or send campaigns to see campaign analytics."
          rows={data.rows.map((row) => [
            <Link key="name" href="/marketing" className="font-medium text-foreground hover:text-primary">{row.name}</Link>,
            <span key="status" className="capitalize">{row.status.replaceAll("_", " ")}</span>,
            row.sent.toLocaleString(),
            row.replies.toLocaleString(),
            `${row.deliveryRate}%`,
            row.revenueAttributed === null ? "Needs attribution" : formatCurrency(row.revenueAttributed),
          ])}
        />
      </ChartCard>
      <ClaimNotes claims={data.claims} />
    </div>
  );
}

function ChatbotTab({ data }: { data: AnalyticsChatbot }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard title="Chatbot message activity" description="Inbound messages and AI replies sent.">
          {data.messageData.some((row) => row.bookings > 0 || row.revenue > 0) ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.messageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="date" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="bookings" name="Inbound" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.14} />
                  <Area type="monotone" dataKey="revenue" name="AI replies" stroke={CHART_SECONDARY} fill={CHART_SECONDARY} fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No chatbot activity" text="Inbound WhatsApp messages and AI replies will appear here." />
          )}
        </ChartCard>
        <ChartCard title="Assistant setup" description="Core settings that affect automation output.">
          <div className="space-y-3">
            {[
              ["Bot enabled", data.settings.enabled ? "Yes" : "No"],
              ["Review mode", data.settings.reviewMode ? "On" : "Off"],
              ["Active FAQs", data.settings.faqCount.toLocaleString()],
            ].map(([label, value]) => (
              <Link key={label} href="/whatsapp/bot" className="flex items-center justify-between rounded-lg border border-border/60 p-3 hover:border-primary/40">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-sm text-muted-foreground">{value}</span>
              </Link>
            ))}
          </div>
        </ChartCard>
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Draft status">
          {data.draftStatusData.length ? (
            <div className="space-y-3">
              {data.draftStatusData.map((row) => (
                <div key={row.name} className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <span className="capitalize text-foreground">{row.name}</span>
                  <span className="text-sm text-muted-foreground">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No AI drafts" text="Draft statuses will appear when the assistant creates or sends replies." />
          )}
        </ChartCard>
        <ChartCard title="Recent assistant decisions">
          <SimpleTable
            headers={["Client", "Status", "Created", "Review"]}
            emptyTitle="No assistant decisions"
            emptyText="Recent AI decisions will appear here after chatbot activity."
            rows={data.recentDrafts.map((row) => [
              <Link key="phone" href="/whatsapp/bot" className="font-medium text-foreground hover:text-primary">{row.clientPhone}</Link>,
              <span key="status" className="capitalize">{row.status}</span>,
              row.createdAt,
              row.needsHuman ? "Needs human" : "Auto",
            ])}
          />
        </ChartCard>
      </section>
      <ClaimNotes claims={data.claims} />
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });
  const { data: entitlements, isLoading: loadingEntitlements } = useEntitlements();
  const analyticsEnabled = Boolean(
    entitlements?.entitled && entitlements.grants?.analytics,
  );
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [activeTab, setActiveTab] = useState("overview");
  const { data, isLoading } = useQuery({
    queryKey: analyticsKeys.report(period),
    queryFn: () => fetchAnalyticsReport(period),
    enabled: analyticsEnabled,
  });
  const sectionMeta = [
    { value: "overview", label: "Overview", description: "Business health summary" },
    { value: "clients", label: "Clients", description: "Retention and client value" },
    { value: "staff", label: "Staff", description: "Team performance" },
    { value: "services", label: "Services", description: "Service revenue and demand" },
    { value: "bookings", label: "Bookings", description: "Booking health and demand" },
    { value: "campaigns", label: "Campaigns", description: "Marketing message performance" },
    { value: "chatbot", label: "Chatbot", description: "WhatsApp assistant activity" },
  ];
  const activeSectionIndex = sectionMeta.findIndex((section) => section.value === activeTab);
  const activeSectionMeta = sectionMeta[activeSectionIndex] ?? sectionMeta[0];

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
            The analytics add-on unlocks deeper reports for revenue, bookings, clients, staff, services, campaigns, and the chatbot.
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
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Business health first, with deeper breakdowns for clients, staff, services, bookings, campaigns, and chatbot automation.
          </p>
        </div>
        <Select value={period} onValueChange={(value) => setPeriod(value as AnalyticsPeriod)}>
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
        <EmptyState title="No analytics data available" text="Once bookings, clients, campaigns, or chatbot activity exists, the analytics tabs will populate." />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-3">
              <div className="mb-3 px-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Analytics sections</p>
              </div>
              <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {sectionMeta.map((section, index) => {
                  const selected = activeTab === section.value;
                  return (
                    <button
                      key={section.value}
                      type="button"
                      onClick={() => setActiveTab(section.value)}
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

          <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-none backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Section {activeSectionIndex + 1} of {sectionMeta.length}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{activeSectionMeta.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{activeSectionMeta.description}</p>
          </div>

          <TabsContent value="overview" className="mt-0">
            <OverviewTab report={data} />
          </TabsContent>
          <TabsContent value="clients" className="mt-0">
            <ClientsTab data={data.clients} />
          </TabsContent>
          <TabsContent value="staff" className="mt-0">
            <StaffTab data={data.staff} />
          </TabsContent>
          <TabsContent value="services" className="mt-0">
            <ServicesTab data={data.services} />
          </TabsContent>
          <TabsContent value="bookings" className="mt-0">
            <BookingsTab report={data} />
          </TabsContent>
          <TabsContent value="campaigns" className="mt-0">
            <CampaignsTab data={data.campaigns} />
          </TabsContent>
          <TabsContent value="chatbot" className="mt-0">
            <ChatbotTab data={data.chatbot} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
