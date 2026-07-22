import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
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
import { ChartSkeleton, ListRowsSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { PageHeaderSkeleton } from "@/components/skeletons/page-skeletons";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  CalendarCheck,
  CalendarDays,
  CalendarX,
  ChevronLeft,
  ChevronRight,
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
  ComposedChart,
  Legend,
  Line,
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
  type BookingDensityPoint,
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

const panelClass = "border-transparent bg-emerald-50/70 shadow-[0_18px_45px_rgba(15,118,110,0.12),0_2px_10px_rgba(15,23,42,0.06)]";
const chartMargin = { top: 10, right: 4, left: -28, bottom: 0 };
const chartAxisProps = {
  stroke: CHART_AXIS,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  width: 28,
};

function formatCurrency(value: number) {
  return `R ${Math.round(value).toLocaleString()}`;
}

function formatCompactCurrency(value: number) {
  if (Math.abs(value) >= 1000) {
    const thousands = value / 1000;
    return `R${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return `R${Math.round(value)}`;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#42A324",
  confirmed: "#1baf7a",
  pending: "#eda100",
  cancelled: "#e34948",
  no_show: "#94a3b8",
};

function statusColor(status: string, index: number) {
  return STATUS_COLORS[status] ?? COLORS[index % COLORS.length];
}

function BookingHealthGauge({
  statusBreakdown,
}: {
  statusBreakdown: { status: string; count: number; percentageOfTotal: number }[];
}) {
  const total = statusBreakdown.reduce((sum, row) => sum + row.count, 0);
  const completedRow = statusBreakdown.find((row) => row.status === "completed");
  const completedPct = completedRow ? Math.round(completedRow.percentageOfTotal) : 0;
  const data = statusBreakdown.map((row, index) => ({
    name: analyticsStatusLabel(row.status),
    count: row.count,
    color: statusColor(row.status, index),
  }));

  return (
    <div className="flex h-[300px] flex-col">
      <div className="relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="78%"
              startAngle={180}
              endAngle={0}
              innerRadius="70%"
              outerRadius="100%"
              paddingAngle={2}
              cornerRadius={10}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name) => [`${value} bookings`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-x-0 bottom-[18%] flex flex-col items-center">
          <span className="text-4xl font-bold tabular-nums text-foreground">{completedPct}%</span>
          <span className="mt-1 text-xs font-medium text-muted-foreground">Bookings completed</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-xs font-medium text-foreground">{entry.name}</span>
            <span className="text-xs text-muted-foreground">
              {total ? Math.round((entry.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, amount: number) {
  const [year, month] = key.split("-").map(Number);
  const next = new Date(year, month - 1 + amount, 1);
  return monthKey(next);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-ZA", {
    month: "long",
    year: "numeric",
  });
}

function monthDates(key: string) {
  const [year, month] = key.split("-").map(Number);
  const dates: string[] = [];
  const cursor = new Date(year, month - 1, 1);
  while (cursor.getMonth() === month - 1) {
    dates.push(format(cursor, "yyyy-MM-dd"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function WorkingDayFillBlocks({
  points,
  workingDays,
}: {
  points?: BookingDensityPoint[];
  workingDays?: string[];
}) {
  const currentMonthKey = monthKey(new Date());
  const minMonthKey = shiftMonth(currentMonthKey, -12);
  const maxMonthKey = shiftMonth(currentMonthKey, 12);
  const [visibleMonth, setVisibleMonth] = useState(currentMonthKey);

  useEffect(() => {
    setVisibleMonth(currentMonthKey);
  }, [currentMonthKey]);

  const safeWorkingDays = workingDays?.length
    ? workingDays
    : ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const safePoints = points ?? [];
  const openDays = new Set(safeWorkingDays.map((day) => day.toLowerCase()));
  const pointsByDate = new Map(safePoints.map((point) => [point.isoDate, point]));
  const visiblePoints = monthDates(visibleMonth)
    .filter((isoDate) => {
      const day = DAY_KEYS[new Date(`${isoDate}T00:00:00`).getDay()];
      return openDays.has(day);
    })
    .map((isoDate) => {
      const point = pointsByDate.get(isoDate);
      return {
        isoDate,
        date: point?.date ?? format(new Date(`${isoDate}T00:00:00`), "MMM d"),
        bookedValue: point?.bookedValue ?? 0,
        totalBookings: point?.totalBookings ?? 0,
        statusCounts: point?.statusCounts ?? {},
      };
    });
  const maxBookings = Math.max(1, ...visiblePoints.map((point) => point.totalBookings));
  const previousMonth = shiftMonth(visibleMonth, -1);
  const nextMonth = shiftMonth(visibleMonth, 1);
  const canGoPrevious = previousMonth >= minMonthKey;
  const canGoNext = nextMonth <= maxMonthKey;

  if (!visiblePoints.length) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/55 text-foreground transition-colors hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setVisibleMonth(previousMonth)}
            disabled={!canGoPrevious}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold text-foreground">{monthLabel(visibleMonth)}</p>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/55 text-foreground transition-colors hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setVisibleMonth(nextMonth)}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <EmptyState title="No working days found" text="Add operating hours in settings to show working-day booking density." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/55 text-foreground transition-colors hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setVisibleMonth(previousMonth)}
          disabled={!canGoPrevious}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-foreground">{monthLabel(visibleMonth)}</p>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/55 text-foreground transition-colors hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setVisibleMonth(nextMonth)}
          disabled={!canGoNext}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7 sm:gap-2">
        {visiblePoints.map((point) => {
          const intensity = point.totalBookings / maxBookings;
          const backgroundColor =
            point.totalBookings === 0
              ? "rgba(66, 163, 36, 0.07)"
              : `rgba(66, 163, 36, ${0.1 + intensity * 0.72})`;
          const statusSummary = Object.entries(point.statusCounts)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => `${count} ${analyticsStatusLabel(status).toLowerCase()}`)
            .join(", ");
          return (
            <Link
              key={point.isoDate}
              href="/calendar"
              title={`${point.date}: ${point.totalBookings} booking${point.totalBookings === 1 ? "" : "s"}${statusSummary ? ` - ${statusSummary}` : ""}. Booked value: ${formatCurrency(point.bookedValue)}. Open calendar.`}
              className="flex aspect-[1.45] min-h-8 items-end rounded-lg p-1.5 transition-transform duration-200 hover:-translate-y-0.5 sm:min-h-9 sm:p-2"
              style={{ backgroundColor }}
            >
              <span className="text-[10px] font-semibold text-emerald-950/70">{new Date(`${point.isoDate}T00:00:00`).getDate()}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
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
    <section className={cn("grid grid-cols-2 gap-3 sm:gap-4", desktopColumns)}>
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
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[150px] rounded-2xl sm:h-[172px]" />
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
    <Card className={cn("overflow-hidden", panelClass)}>
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
    <Card className={cn("overflow-hidden", panelClass)}>
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
    <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-2xl bg-white/55 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/80"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(150px,1.15fr)_minmax(0,3fr)] lg:items-center">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{headers[0]}</p>
              <div className="mt-1 truncate text-sm font-semibold text-foreground">{row[0]}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {row.slice(1).map((cell, cellIndex) => (
                <div key={`${rowIndex}-${headers[cellIndex + 1]}`} className="min-w-0 rounded-xl bg-emerald-50/65 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">{headers[cellIndex + 1]}</p>
                  <div className="mt-1 truncate text-sm font-semibold text-foreground">{cell}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ report }: { report: AnalyticsReport }) {
  const { overview, insights } = report;
  const missedBookingCount = overview.noShowCount + overview.cancelledCount;
  const decisionSignals = [
    {
      label: "Best revenue day",
      value: overview.bestRevenueDay,
      detail: "Protect this slot",
      tone: "text-emerald-700",
    },
    {
      label: "Quietest day",
      value: overview.quietestDay,
      detail: "Good campaign target",
      tone: "text-blue-700",
    },
    {
      label: "No-show rate",
      value: `${overview.noShowRate}%`,
      detail: overview.noShowRate > 10 ? "Tighten reminders" : "Healthy",
      tone: overview.noShowRate > 10 ? "text-amber-700" : "text-emerald-700",
    },
    {
      label: "Cancellation rate",
      value: `${overview.cancellationRate}%`,
      detail: overview.cancellationRate > 10 ? "Review policy" : "Within range",
      tone: overview.cancellationRate > 10 ? "text-rose-700" : "text-emerald-700",
    },
  ];
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
        <ChartCard
          title="Revenue and bookings trend"
          description="Green area is booked revenue (left axis). Blue line is booking count (right axis)."
        >
          {overview.revenueData.some((point) => point.bookings > 0) ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={overview.revenueData} margin={chartMargin}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_PRIMARY} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={CHART_PRIMARY} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="date" stroke={CHART_AXIS} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="left"
                    stroke={CHART_PRIMARY}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    tickFormatter={(value) => formatCompactCurrency(Number(value))}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke={CHART_SECONDARY}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={24}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => name === "Revenue" ? formatCurrency(Number(value)) : Number(value).toLocaleString()}
                  />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={CHART_PRIMARY}
                    strokeWidth={2}
                    fill="url(#revenueFill)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="bookings"
                    name="Bookings"
                    stroke={CHART_SECONDARY}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No bookings in this period" text="Once bookings are scheduled, this trend will show revenue and demand movement." />
          )}
        </ChartCard>
        <ChartCard title="Booking health mix" description="Share of bookings by status. Past confirmed bookings count as completed.">
          {overview.statusBreakdown.length ? (
            <BookingHealthGauge statusBreakdown={overview.statusBreakdown} />
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
                <BarChart data={overview.serviceBreakdown.slice(0, 8)} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis {...chartAxisProps} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No completed services yet" text="Completed booked value by service will appear here." />
          )}
        </ChartCard>
        <ChartCard title="Working-day fill" description="Booking density by open business day in this period. Closed days are hidden.">
          {overview.totalBookings > 0 ? (
            <WorkingDayFillBlocks points={overview.bookingDensityData ?? []} workingDays={overview.workingDays ?? []} />
          ) : (
            <EmptyState title="No bookings yet" text="Working-day booking density appears once bookings exist in this period." />
          )}
        </ChartCard>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {decisionSignals.map((signal) => (
          <Card key={signal.label} className={cn("overflow-hidden", panelClass)}>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-muted-foreground">{signal.label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{signal.value}</p>
              <p className={cn("mt-1 text-xs font-semibold", signal.tone)}>{signal.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className={cn("overflow-hidden", panelClass)}>
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
                <BarChart data={data.revenueData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis {...chartAxisProps} />
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
                <BarChart data={data.utilisationData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis {...chartAxisProps} />
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
                <BarChart data={data.revenueData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis {...chartAxisProps} />
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
              <BarChart data={data.weekdayBreakdown} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="day" stroke={CHART_AXIS} fontSize={12} />
                <YAxis {...chartAxisProps} />
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
                <BarChart data={data.engagementData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis {...chartAxisProps} />
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
                <AreaChart data={data.messageData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="date" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis {...chartAxisProps} />
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
          <Card className={cn("overflow-hidden", panelClass)}>
            <CardContent className="p-3">
              <div className="mb-2 px-2 sm:mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Analytics sections</p>
              </div>
              <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-7">
                {sectionMeta.map((section, index) => {
                  const selected = activeTab === section.value;
                  return (
                    <button
                      key={section.value}
                      type="button"
                      onClick={() => setActiveTab(section.value)}
                      className={cn(
                        "flex min-w-[112px] shrink-0 items-center justify-center gap-2 rounded-full border px-3 py-2 text-center transition-colors sm:min-w-0 sm:rounded-lg sm:p-2 lg:p-3",
                          selected
                            ? "border-primary bg-primary text-white shadow-none sm:bg-primary/5 sm:text-primary"
                          : "border-transparent bg-white/45 text-muted-foreground hover:bg-white/75 hover:text-foreground sm:bg-transparent sm:hover:bg-muted/50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold sm:mx-auto sm:h-6 sm:w-6 sm:text-xs",
                          selected ? "bg-white text-primary sm:bg-primary sm:text-white" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="block truncate text-xs font-semibold sm:mt-2 sm:font-medium sm:text-sm">{section.label}</span>
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
