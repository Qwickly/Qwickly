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
import { Badge } from "@/components/ui/badge";
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
import { PageHeaderSkeleton, MetricPanelSkeleton } from "@/components/skeletons/page-skeletons";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader, PageEmptyState } from "@/components/layout/page-ui";
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
  Scatter,
  ScatterChart,
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
  type ClientAnalyticsRow,
  type ClientValueDistributionPoint,
  type AnalyticsMetric,
  type AnalyticsPeriod,
  type AnalyticsReport,
  type AnalyticsServices,
  type AnalyticsStaff,
  type ServiceAnalyticsRow,
  type StaffAnalyticsRow,
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

const panelClass = "";
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
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/45 bg-muted/20 text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setVisibleMonth(previousMonth)}
            disabled={!canGoPrevious}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold text-foreground">{monthLabel(visibleMonth)}</p>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/45 bg-muted/20 text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setVisibleMonth(nextMonth)}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <PageEmptyState title="No working days found" description="Add operating hours in settings to show working-day booking density." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/45 bg-muted/20 text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setVisibleMonth(previousMonth)}
          disabled={!canGoPrevious}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-foreground">{monthLabel(visibleMonth)}</p>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/45 bg-muted/20 text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
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
              className="flex aspect-[1.45] min-h-8 items-end rounded-lg p-1.5 transition-colors duration-150 sm:min-h-9 sm:p-2"
              style={{ backgroundColor }}
            >
              <span className="text-[10px] font-semibold text-foreground">{new Date(`${point.isoDate}T00:00:00`).getDate()}</span>
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
      <MetricPanelSkeleton count={4} />
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
  if (!rows.length) return <PageEmptyState title={emptyTitle} description={emptyText} />;
  return (
    <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-2xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(150px,1.15fr)_minmax(0,3fr)] lg:items-center">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{headers[0]}</p>
              <div className="mt-1 truncate text-sm font-semibold text-foreground">{row[0]}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {row.slice(1).map((cell, cellIndex) => (
                <div key={`${rowIndex}-${headers[cellIndex + 1]}`} className="min-w-0 rounded-xl bg-primary/10 px-3 py-2">
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

function TopClientsList({ clients }: { clients: ClientAnalyticsRow[] }) {
  if (!clients.length) {
    return (
      <PageEmptyState
        title="No client value yet"
        description="Completed bookings will reveal your highest-value clients."
      />
    );
  }

  const maxRevenue = Math.max(1, ...clients.map((client) => client.revenue));

  return (
    <div className="flex max-h-[520px] min-h-[280px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {clients.map((client, index) => {
          const intensity = client.revenue / maxRevenue;
          const width = `${Math.max(10, Math.round(intensity * 100))}%`;

          return (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="group block rounded-xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <p className="truncate text-sm font-bold text-foreground">{client.name}</p>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-primary">{formatCurrency(client.revenue)}</p>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                >
                  {client.futureBookings} future
                </Badge>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width }} />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="font-medium">{client.bookings.toLocaleString()} booking{client.bookings === 1 ? "" : "s"}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {client.lastVisit}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      <Link
        href="/clients"
        className="group mt-4 inline-flex items-center gap-1.5 self-end text-sm font-semibold text-primary transition-colors hover:text-primary/80"
      >
        See all clients
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function InactiveClientsList({ clients }: { clients: ClientAnalyticsRow[] }) {
  if (!clients.length) {
    return (
      <PageEmptyState
        title="No inactive clients found"
        description="Clients with older visits and no upcoming booking will appear here."
      />
    );
  }

  return (
    <div className="flex max-h-[520px] min-h-[280px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {clients.map((client) => (
          <Link
            key={client.id}
            href={`/clients/${client.id}`}
            className="group block rounded-xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{client.name}</p>
                <p className="mt-1 text-xs font-semibold text-destructive">Win-back opportunity</p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 rounded-full border-destructive/20 bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive"
              >
                inactive
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Value</p>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">{formatCurrency(client.revenue)}</p>
              </div>
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Bookings</p>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">{client.bookings}</p>
              </div>
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Last visit</p>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">{client.lastVisit}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <Button className="mt-4 self-end" disabled>
        Send campaign msg
        <span className="ml-2 text-xs opacity-80">Coming soon</span>
      </Button>
    </div>
  );
}

function ClientSegmentDonut({ data }: { data: AnalyticsClients["clientTypeData"] }) {
  const [showLabels, setShowLabels] = useState(false);
  const total = data.reduce((sum, row) => sum + row.clients, 0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowLabels(true), 550);
    return () => window.clearTimeout(timeout);
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="clients" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
              {data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div
        className={cn(
          "grid gap-2 transition-all duration-500 sm:grid-cols-3",
          showLabels ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {data.map((row, index) => (
          <div key={row.name} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <p className="text-xs font-semibold text-muted-foreground">{row.name}</p>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="text-xl font-bold text-foreground">{row.clients.toLocaleString()}</p>
              <p className="pb-0.5 text-xs font-semibold text-muted-foreground">{total ? Math.round((row.clients / total) * 100) : 0}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientValueDistributionChart({ data }: { data: ClientValueDistributionPoint[] }) {
  const hasData = data.some((row) => row.clientCount > 0);

  return (
    <div>
      {!hasData ? (
        <PageEmptyState title="No client value yet" description="Completed bookings will show how active clients are distributed by value." />
      ) : (
        <div className="h-[320px] rounded-2xl bg-muted/20 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 18, left: 20, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} {...chartAxisProps} />
              <YAxis type="category" dataKey="band" tickLine={false} axisLine={false} width={98} fontSize={11} stroke={CHART_AXIS} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "hsl(var(--muted) / 0.45)" }}
                content={({ active, payload, label }) => {
                  const point = payload?.[0]?.payload as ClientValueDistributionPoint | undefined;
                  if (!active || !point) return null;
                  return (
                    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                      <p className="font-bold text-popover-foreground">{label}</p>
                      <p className="mt-1 text-muted-foreground">{point.clientCount} clients</p>
                      <p className="text-muted-foreground">{point.averageBookings} avg bookings</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="clientCount" name="Clients" radius={[0, 14, 14, 0]} barSize={28}>
                {data.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function StaffPerformanceList({ rows }: { rows: StaffAnalyticsRow[] }) {
  if (!rows.length) {
    return (
      <PageEmptyState
        title="No staff performance yet"
        description="Assign bookings to staff to see detailed performance."
      />
    );
  }

  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));

  return (
    <div className="flex max-h-[560px] min-h-[280px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {rows.map((row, index) => {
          const width = `${Math.max(8, Math.round((row.revenue / maxRevenue) * 100))}%`;
          const content = (
            <div className="rounded-xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <p className="truncate text-sm font-bold text-foreground">{row.name}</p>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-primary">{formatCurrency(row.revenue)} booked value</p>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                >
                  {row.utilisationRate}% utilised
                </Badge>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width }} />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Completed</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.completedBookings.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Avg value</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(row.averageBookingValue)}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Revenue/hour</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(row.revenuePerBookedHour)}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">No-show</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.noShowRate}%</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Cancellation</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.cancellationRate}%</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Booked hours</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.bookedHours.toLocaleString()}h</p>
                </div>
              </div>
            </div>
          );

          return row.id ? (
            <Link key={row.id} href={`/staff/${row.id}`} className="block">
              {content}
            </Link>
          ) : (
            <div key="unassigned">{content}</div>
          );
        })}
      </div>
      <Link
        href="/staff"
        className="group mt-4 inline-flex items-center gap-1.5 self-end text-sm font-semibold text-primary transition-colors hover:text-primary/80"
      >
        See all staff
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
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
      tone: "text-primary",
    },
    {
      label: "Quietest day",
      value: overview.quietestDay,
      detail: "Good campaign target",
      tone: "text-blue-700 dark:text-blue-400",
    },
    {
      label: "No-show rate",
      value: `${overview.noShowRate}%`,
      detail: overview.noShowRate > 10 ? "Tighten reminders" : "Healthy",
      tone: overview.noShowRate > 10 ? "text-amber-700 dark:text-amber-400" : "text-primary",
    },
    {
      label: "Cancellation rate",
      value: `${overview.cancellationRate}%`,
      detail: overview.cancellationRate > 10 ? "Review policy" : "Within range",
      tone: overview.cancellationRate > 10 ? "text-destructive" : "text-primary",
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
            <PageEmptyState title="No bookings in this period" description="Once bookings are scheduled, this trend will show revenue and demand movement." />
          )}
        </ChartCard>
        <ChartCard title="Booking health mix" description="Share of bookings by status. Past confirmed bookings count as completed.">
          {overview.statusBreakdown.length ? (
            <BookingHealthGauge statusBreakdown={overview.statusBreakdown} />
          ) : (
            <PageEmptyState title="No statuses yet" description="Booking statuses will appear as soon as this period has bookings." />
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
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted) / 0.45)" }} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" fill={CHART_PRIMARY} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <PageEmptyState title="No completed services yet" description="Completed booked value by service will appear here." />
          )}
        </ChartCard>
        <ChartCard title="Working-day fill" description="Booking density by open business day in this period. Closed days are hidden.">
          {overview.totalBookings > 0 ? (
            <WorkingDayFillBlocks points={overview.bookingDensityData ?? []} workingDays={overview.workingDays ?? []} />
          ) : (
            <PageEmptyState title="No bookings yet" description="Working-day booking density appears once bookings exist in this period." />
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
            <PageEmptyState title="No insights yet" description="Insights will appear once the period has enough bookings, clients, or messaging activity." />
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
        <ChartCard title="Client segment mix" description="Active clients in this period by the segment set on their profile: new, returning, and VIP.">
          {data.clientTypeData?.some((row) => row.clients > 0) ? (
            <ClientSegmentDonut data={data.clientTypeData} />
          ) : (
            <PageEmptyState title="No client segments yet" description="Client segment mix appears once active clients have a type selected." />
          )}
        </ChartCard>
        <ChartCard title="Client value distribution" description="See how your active clients are spread across different value levels.">
          <ClientValueDistributionChart data={data.clientValueDistribution ?? []} />
        </ChartCard>
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Top clients" description="Ranked by completed booked value.">
          <TopClientsList clients={data.topClients} />
        </ChartCard>
        <ChartCard title="Inactive clients" description="Win-back list: no future booking and last visit older than 60 days.">
          <InactiveClientsList clients={data.inactiveClientRows} />
        </ChartCard>
      </section>
    </div>
  );
}

function StaffTab({ data }: { data: AnalyticsStaff }) {
  const staffRows = data.rows.filter((row) => row.id);
  const totalBookedHours = staffRows.reduce((sum, row) => sum + row.bookedHours, 0);
  const totalAvailableHours = staffRows.reduce((sum, row) => sum + row.availableHours, 0);
  const capacityData = [
    { name: "Booked", value: totalBookedHours },
    { name: "Open capacity", value: Math.max(totalAvailableHours - totalBookedHours, 0) },
  ].filter((row) => row.value > 0);
  const efficiencyData = staffRows
    .filter((row) => row.bookedHours > 0 || row.revenue > 0)
    .map((row) => ({
      name: row.name,
      bookedHours: row.bookedHours,
      revenue: row.revenue,
      revenuePerBookedHour: row.revenuePerBookedHour,
    }));

  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartCard title="Revenue by staff" description="Completed booked value by assigned staff member.">
          {data.revenueData.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueData} layout="vertical" margin={{ top: 8, right: 18, left: 14, bottom: 4 }}>
                  <XAxis type="number" {...chartAxisProps} tickFormatter={(value) => formatCompactCurrency(Number(value))} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={92} fontSize={11} stroke={CHART_AXIS} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted) / 0.45)" }} formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" name="Revenue" radius={[0, 14, 14, 0]} barSize={28}>
                    {data.revenueData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <PageEmptyState title="No staff bookings" description="Assigned completed bookings will show staff revenue here." />
          )}
        </ChartCard>
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1">
          <ChartCard title="Team capacity" description="Booked hours versus business open-hour capacity for active staff.">
            {capacityData.length ? (
              <div className="grid gap-4 sm:grid-cols-[0.9fr_1.1fr] sm:items-center xl:grid-cols-1">
                <div className="h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={capacityData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3}>
                        {capacityData.map((_, index) => <Cell key={index} fill={[CHART_PRIMARY, CHART_SECONDARY][index % 2]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(value) => `${Number(value).toLocaleString()}h`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {capacityData.map((row, index) => (
                    <div key={row.name} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: [CHART_PRIMARY, CHART_SECONDARY][index % 2] }} />
                        <p className="text-xs font-semibold text-muted-foreground">{row.name}</p>
                      </div>
                      <p className="mt-2 text-sm font-bold text-foreground">{row.value.toLocaleString()}h</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <PageEmptyState title="No capacity yet" description="Capacity appears once business hours, active staff and bookings are available." />
            )}
          </ChartCard>
          <ChartCard title="Revenue efficiency" description="Booked hours compared with completed booked value.">
            {efficiencyData.length ? (
              <div className="space-y-3">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 12, right: 14, left: 18, bottom: 8 }}>
                      <XAxis
                        type="number"
                        dataKey="bookedHours"
                        name="Booked hours"
                        stroke={CHART_AXIS}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => (Number(value) === 0 ? "0" : `${Number(value)}h`)}
                      />
                      <YAxis
                        type="number"
                        dataKey="revenue"
                        name="Revenue"
                        stroke={CHART_AXIS}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={54}
                        tickFormatter={(value) => (Number(value) === 0 ? "" : formatCompactCurrency(Number(value)))}
                      />
                      <Tooltip
                        cursor={{ stroke: "rgba(15,118,110,0.18)", strokeDasharray: "3 3" }}
                        content={({ active, payload }) => {
                          const point = payload?.[0]?.payload as typeof efficiencyData[number] | undefined;
                          if (!active || !point) return null;
                          return (
                            <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                              <p className="font-bold text-popover-foreground">{point.name}</p>
                              <p className="mt-1 text-muted-foreground">{point.bookedHours.toLocaleString()} booked hours</p>
                              <p className="text-muted-foreground">{formatCurrency(point.revenue)} revenue</p>
                              <p className="text-muted-foreground">{formatCurrency(point.revenuePerBookedHour)} per hour</p>
                            </div>
                          );
                        }}
                      />
                      <Scatter data={efficiencyData} name="Staff">
                        {efficiencyData.map((_, index) => (
                          <Cell key={index} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {efficiencyData.map((row, index) => (
                    <div key={row.name} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                        <p className="truncate text-xs font-bold text-foreground">{row.name}</p>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {row.bookedHours.toLocaleString()}h booked · {formatCurrency(row.revenue)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <PageEmptyState title="No efficiency yet" description="Efficiency appears once staff have booked hours or completed booked value." />
            )}
          </ChartCard>
        </div>
      </section>
      <ChartCard title="Staff performance table">
        <StaffPerformanceList rows={data.rows} />
      </ChartCard>
      <ClaimNotes claims={data.claims} />
    </div>
  );
}

function ServicePerformanceList({ rows }: { rows: ServiceAnalyticsRow[] }) {
  if (!rows.length) {
    return (
      <PageEmptyState
        title="No service performance yet"
        description="Service analytics will appear once bookings are linked to services."
      />
    );
  }

  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));

  return (
    <div className="flex max-h-[560px] min-h-[280px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {rows.map((row, index) => {
          const width = `${Math.max(8, Math.round((row.revenue / maxRevenue) * 100))}%`;
          const content = (
            <div className="rounded-xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <p className="truncate text-sm font-bold text-foreground">{row.name}</p>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-primary">{formatCurrency(row.revenue)} booked value</p>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                >
                  {row.revenueShare}% share
                </Badge>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width }} />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Completed</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.completedBookings.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Avg value</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(row.averageSellingValue)}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Revenue/hour</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(row.revenuePerBookedHour)}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Bookings</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.bookings.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Completion</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.completionRate}%</p>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Cancellation</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{row.cancellationRate}%</p>
                </div>
              </div>
            </div>
          );

          return row.id ? (
            <Link key={row.id} href={`/services/${row.id}`} className="block">
              {content}
            </Link>
          ) : (
            <div key="unassigned-service">{content}</div>
          );
        })}
      </div>
      <Link
        href="/services"
        className="group mt-4 inline-flex items-center gap-1.5 self-end text-sm font-semibold text-primary transition-colors hover:text-primary/80"
      >
        See all services
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function ServiceDemandEfficiencyChart({ rows }: { rows: AnalyticsServices["rows"] }) {
  const chartData = rows
    .filter((row) => row.completedBookings > 0 || row.revenuePerBookedHour > 0)
    .slice(0, 8);
  const serviceColor = (name: string) => {
    const index = chartData.findIndex((row) => row.name === name);
    return COLORS[Math.max(index, 0) % COLORS.length];
  };
  const serviceDot = (props: { cx?: number; cy?: number; payload?: AnalyticsServices["rows"][number] }) => {
    if (props.cx === undefined || props.cy === undefined || !props.payload) return null;
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={4.5}
        fill={serviceColor(props.payload.name)}
        stroke="white"
        strokeWidth={2}
      />
    );
  };

  if (!chartData.length) {
    return (
      <PageEmptyState
        title="No service efficiency yet"
        description="Completed bookings will show service revenue efficiency here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 12, right: 14, left: -18, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="name" tick={false} tickLine={false} axisLine={false} height={8} />
            <YAxis
              stroke={CHART_AXIS}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={46}
              tickFormatter={(value) => formatCompactCurrency(Number(value))}
            />
            <Tooltip
              cursor={{ stroke: "rgba(15,118,110,0.18)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                const point = payload?.[0]?.payload as AnalyticsServices["rows"][number] | undefined;
                if (!active || !point) return null;
                return (
                  <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                    <p className="font-bold text-popover-foreground">{label}</p>
                    <p className="mt-1 text-muted-foreground">{point.completedBookings.toLocaleString()} completed bookings</p>
                    <p className="text-muted-foreground">{formatCurrency(point.revenue)} completed revenue</p>
                    <p className="text-muted-foreground">{formatCurrency(point.averageSellingValue)} average value</p>
                    <p className="text-muted-foreground">{formatCurrency(point.revenuePerBookedHour)} per hour</p>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="revenuePerBookedHour"
              name="Revenue/hour"
              stroke={CHART_SECONDARY}
              strokeWidth={2.5}
              dot={serviceDot}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="grid max-h-[150px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {chartData.map((row, index) => (
          <div key={row.name} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <p className="truncate text-xs font-bold text-foreground">{row.name}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {row.completedBookings.toLocaleString()} completed · {formatCurrency(row.revenuePerBookedHour)}/h
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ServiceRevenueShareDonut({ data }: { data: AnalyticsServices["shareData"] }) {
  const [showLabels, setShowLabels] = useState(false);
  const total = data.reduce((sum, row) => sum + row.value, 0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowLabels(true), 550);
    return () => window.clearTimeout(timeout);
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={3}>
              {data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div
        className={cn(
          "grid max-h-[150px] gap-2 overflow-y-auto pr-1 transition-all duration-500 sm:grid-cols-2",
          showLabels ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {data.map((row, index) => (
          <div key={row.name} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <p className="truncate text-xs font-semibold text-muted-foreground">{row.name}</p>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="truncate text-sm font-bold text-foreground">{formatCurrency(row.value)}</p>
              <p className="pb-0.5 text-xs font-semibold text-muted-foreground">{total ? Math.round((row.value / total) * 100) : 0}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ServicesTab({ data }: { data: AnalyticsServices }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard title="Service demand and efficiency" description="Compare completed bookings with the value each service produces per hour.">
          <ServiceDemandEfficiencyChart rows={data.rows} />
        </ChartCard>
        <ChartCard title="Revenue share" description="Which services carry the booked value.">
          {data.shareData.length ? (
            <ServiceRevenueShareDonut data={data.shareData} />
          ) : (
            <PageEmptyState title="No revenue share yet" description="Once services produce completed booked value, the mix will show here." />
          )}
        </ChartCard>
      </section>
      <ChartCard title="Service performance table">
        <ServicePerformanceList rows={data.rows} />
      </ChartCard>
    </div>
  );
}

function BookingJourneyFlow({ journey }: { journey: AnalyticsReport["bookings"]["journey"] }) {
  if (!journey.scheduled) {
    return <PageEmptyState title="No booking journey yet" description="Bookings will appear here once this period has scheduled appointments." />;
  }

  const flow = [
    { label: "Scheduled", value: journey.scheduled },
    { label: "Attended", value: journey.attended },
    { label: "Completed", value: journey.completed },
  ];
  const dropOffs = [
    { label: "Pending", value: journey.pending, color: "#eda100" },
    { label: "No-show", value: journey.noShow, color: "#64748b" },
    { label: "Cancelled", value: journey.cancelled, color: "#e34948" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {flow.map((step, index) => (
          <div key={step.label} className="relative rounded-xl border border-border/45 bg-muted/20 p-4">
            <p className="text-xs font-semibold text-muted-foreground">{step.label}</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{step.value.toLocaleString()}</p>
            {index < flow.length - 1 ? (
              <div className="absolute right-[-18px] top-1/2 hidden h-0.5 w-9 bg-primary/30 md:block" />
            ) : null}
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {dropOffs.map((item) => (
          <div key={item.label} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
            </div>
            <p className="mt-2 text-lg font-bold text-foreground">{item.value.toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendLineChart({
  data,
  emptyTitle,
  emptyText,
  primaryLabel,
  secondaryLabel,
  secondaryFormatter = (value) => value.toLocaleString(),
}: {
  data: Array<{ date: string; bookings: number; revenue: number }>;
  emptyTitle: string;
  emptyText: string;
  primaryLabel: string;
  secondaryLabel: string;
  secondaryFormatter?: (value: number) => string;
}) {
  const chartData = data.filter((point) => point.bookings > 0 || point.revenue > 0);

  if (!chartData.length) {
    return <PageEmptyState title={emptyTitle} description={emptyText} />;
  }

  const trendDot = (props: { cx?: number; cy?: number; index?: number }) => {
    if (props.cx === undefined || props.cy === undefined || props.index === undefined) return null;
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={4.5}
        fill={COLORS[props.index % COLORS.length]}
        stroke="white"
        strokeWidth={2}
      />
    );
  };

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 12, right: 14, left: -18, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="date" tick={false} tickLine={false} axisLine={false} height={8} />
          <YAxis
            stroke={CHART_AXIS}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "rgba(15,118,110,0.18)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              const point = payload?.[0]?.payload as { bookings: number; revenue: number } | undefined;
              if (!active || !point) return null;
              return (
                <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                  <p className="font-bold text-popover-foreground">{label}</p>
                  <p className="mt-1 text-muted-foreground">{point.bookings.toLocaleString()} {primaryLabel.toLowerCase()}</p>
                  <p className="text-muted-foreground">{secondaryFormatter(point.revenue)} {secondaryLabel.toLowerCase()}</p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="bookings"
            name={primaryLabel}
            stroke={CHART_SECONDARY}
            strokeWidth={2.5}
            dot={trendDot}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function BookingOutcomesTable({ rows }: { rows: AnalyticsReport["bookings"]["outcomeRows"] }) {
  if (!rows.some((row) => row.bookings > 0)) {
    return <PageEmptyState title="No booking outcomes yet" description="Booking outcomes appear once bookings exist." />;
  }

  return (
    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => (
        <Link key={row.status} href="/bookings" className="block rounded-2xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-foreground">{row.outcome}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.share}% of bookings</p>
            </div>
            <p className="text-sm font-bold text-foreground">{row.bookings.toLocaleString()}</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-primary/10 px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">Booked value</p>
              <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(row.bookedValue)}</p>
            </div>
            <div className="rounded-xl bg-primary/10 px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">Average value</p>
              <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(row.averageValue)}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function BookingPressurePointsTable({ rows }: { rows: AnalyticsReport["bookings"]["pressurePoints"] }) {
  if (!rows.length) {
    return <PageEmptyState title="No pressure points yet" description="Signals appear once there is enough booking activity to compare periods." />;
  }

  return (
    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.period} className="rounded-2xl border border-border/45 bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-foreground">{row.period}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.signal}</p>
            </div>
            <p className="text-sm font-bold text-foreground">{row.bookings.toLocaleString()} bookings</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-primary/10 px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">Completion</p>
              <p className="mt-1 text-sm font-bold text-foreground">{row.completionRate}%</p>
            </div>
            <div className="rounded-xl bg-primary/10 px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">No-show</p>
              <p className="mt-1 text-sm font-bold text-foreground">{row.noShowRate}%</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BookingsTab({ report }: { report: AnalyticsReport }) {
  const data = report.bookings;
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <ChartCard title="Booking journey" description="How bookings move from scheduled to completed, including drop-offs.">
        <BookingJourneyFlow journey={data.journey} />
      </ChartCard>
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Bookings over time" description="Scheduled booking volume across the selected period.">
          <TrendLineChart
            data={data.bookingTrendData ?? []}
            emptyTitle="No booking trend yet"
            emptyText="Bookings over time appear once this period has scheduled appointments."
            primaryLabel="Bookings"
            secondaryLabel="Booked value"
            secondaryFormatter={formatCurrency}
          />
        </ChartCard>
        <ChartCard title="Working-day fill" description="Booking density by open business day in this period. Closed days are hidden.">
          {data.summary.some((metric) => metric.label === "Total bookings" && Number(metric.value) > 0) ? (
            <WorkingDayFillBlocks points={report.overview.bookingDensityData ?? []} workingDays={report.overview.workingDays ?? []} />
          ) : (
            <PageEmptyState title="No bookings yet" description="Working-day booking density appears once bookings exist in this period." />
          )}
        </ChartCard>
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Booking outcomes" description="Outcome mix with booked value and average value.">
          <BookingOutcomesTable rows={data.outcomeRows ?? []} />
        </ChartCard>
        <ChartCard title="Booking pressure points" description="Rule-based signals by weekday using current booking data.">
          <BookingPressurePointsTable rows={data.pressurePoints ?? []} />
        </ChartCard>
      </section>
      <ClaimNotes claims={data.claims} />
    </div>
  );
}

function CampaignFunnel({ stages }: { stages: AnalyticsCampaigns["funnel"] }) {
  if (!stages.some((stage) => stage.value > 0)) {
    return <PageEmptyState title="No campaign funnel yet" description="The funnel appears once campaigns have recipients, sends or replies." />;
  }

  const maxValue = Math.max(1, ...stages.map((stage) => stage.value));

  return (
    <div className="space-y-3">
      {stages.map((stage, index) => (
        <div key={stage.name} className="rounded-xl border border-border/45 bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <p className="text-sm font-bold text-foreground">{stage.name}</p>
                {stage.unavailable ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400"
                  >
                    Not carrier delivered
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-2xl font-bold text-foreground">{stage.format === "currency" ? formatCurrency(stage.value) : stage.value.toLocaleString()}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{stage.previousRate}% from previous</p>
              <p>{stage.overallRate}% overall</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full border border-border/45 bg-muted/20">
            <div className="h-full rounded-full" style={{ width: `${Math.max(8, (stage.value / maxValue) * 100)}%`, backgroundColor: COLORS[index % COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignChannelPerformance({ rows }: { rows: AnalyticsCampaigns["channelRows"] }) {
  if (!rows.length) {
    return <PageEmptyState title="No channel data yet" description="Channel performance appears once campaigns are sent." />;
  }

  const totalSent = rows.reduce((sum, row) => sum + row.sent, 0);

  return (
    <div className="space-y-4">
      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="sent" nameKey="channel" innerRadius={54} outerRadius={82} paddingAngle={3}>
              {rows.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div key={row.channel} className="rounded-2xl border border-border/45 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <p className="truncate text-xs font-bold text-foreground">{row.channel}</p>
              </div>
              <p className="text-xs font-semibold text-muted-foreground">{totalSent ? Math.round((row.sent / totalSent) * 100) : 0}%</p>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <span>{row.sent.toLocaleString()} sent</span>
              <span>{row.replies.toLocaleString()} replies</span>
              <span>{row.bookings === null ? "Needs attribution" : `${row.bookings} booked`}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignComparisonTable({ rows }: { rows: AnalyticsCampaigns["rows"] }) {
  if (!rows.length) {
    return <PageEmptyState title="No campaigns yet" description="Create or send campaigns to see campaign analytics." />;
  }

  return (
    <div className="flex max-h-[560px] min-h-[280px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {rows.map((row) => (
          <Link key={row.id} href="/marketing" className="block rounded-xl border border-border/45 bg-muted/20 p-4 transition-colors duration-150 hover:bg-muted/35">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{row.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.channel} · <span className="capitalize">{row.status.replaceAll("_", " ")}</span></p>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
              >
                {row.deliveryRate}% sent rate
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Audience</p>
                <p className="mt-1 text-sm font-bold text-foreground">{row.audience.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Sent / replies</p>
                <p className="mt-1 text-sm font-bold text-foreground">{row.sent.toLocaleString()} / {row.replies.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Bookings</p>
                <p className="mt-1 text-sm font-bold text-foreground">{row.bookingsGenerated === null ? "Needs attribution" : row.bookingsGenerated.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-primary/10 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground">Revenue / ROI</p>
                <p className="mt-1 text-sm font-bold text-foreground">{row.revenueAttributed === null ? "Needs attribution" : formatCurrency(row.revenueAttributed)} · {row.roi === null ? "No cost" : `${row.roi}x`}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <Link href="/marketing" className="group mt-4 inline-flex items-center gap-1.5 self-end text-sm font-semibold text-primary transition-colors hover:text-primary/80">
        See all campaigns
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function CampaignsTab({ data }: { data: AnalyticsCampaigns }) {
  return (
    <div className="space-y-6">
      <SummaryGrid metrics={data.summary} />
      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartCard title="Campaign performance" description="Sent messages and replies across the selected period.">
          <TrendLineChart
            data={data.trendData ?? []}
            emptyTitle="No campaign trend yet"
            emptyText="Campaign sends and replies appear once campaigns run in this period."
            primaryLabel="Sent"
            secondaryLabel="Replies"
          />
        </ChartCard>
        <ChartCard title="Channel performance" description="Compare campaign activity by channel.">
          <CampaignChannelPerformance rows={data.channelRows ?? []} />
        </ChartCard>
      </section>
      <ChartCard title="Campaign funnel" description="Recipients, sends, replies and explicitly tracked campaign conversions.">
        <CampaignFunnel stages={data.funnel ?? []} />
      </ChartCard>
      <ChartCard title="Campaign comparison" description="Compare audience, sends, replies and tracked conversions by campaign.">
        <CampaignComparisonTable rows={data.rows} />
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
            <PageEmptyState title="No chatbot activity" description="Inbound WhatsApp messages and AI replies will appear here." />
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
            <PageEmptyState title="No AI drafts" description="Draft statuses will appear when the assistant creates or sends replies." />
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
        <Card className="w-full max-w-lg p-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold text-foreground">Analytics locked</h2>
          <p className="mb-6 text-sm leading-7 text-muted-foreground">
            The analytics add-on unlocks deeper reports for revenue, bookings, clients, staff, services, campaigns, and the chatbot.
          </p>
          <Button className="w-full bg-primary text-white hover:bg-primary/90" asChild>
            <a href="/billing" className="!text-white hover:!text-white">
              Upgrade plan <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Analytics"
        description="Business health first, with deeper breakdowns for clients, staff, services, bookings, campaigns, and chatbot automation."
        actions={
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
        }
      />

      {isLoading ? (
        <AnalyticsLoadingSkeleton />
      ) : !data ? (
        <PageEmptyState title="No analytics data available" description="Once bookings, clients, campaigns, or chatbot activity exists, the analytics tabs will populate." />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <Card className={cn("overflow-hidden", panelClass)}>
            <CardContent className="p-3">
              <div className="mb-2 px-2 sm:mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Analytics sections</p>
              </div>
              <nav className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-7">
                {sectionMeta.map((section) => {
                  const selected = activeTab === section.value;
                  return (
                    <button
                      key={section.value}
                      type="button"
                      onClick={() => setActiveTab(section.value)}
                      className={cn(
                        "flex min-w-[112px] shrink-0 items-center justify-center rounded-full border px-3 py-2 text-center transition-colors sm:min-w-0 sm:rounded-lg sm:p-2 lg:p-3",
                          selected
                            ? "border-primary bg-primary text-white shadow-none sm:bg-primary/5 sm:text-primary"
                          : "border-transparent bg-muted/45 text-muted-foreground hover:bg-muted/75 hover:text-foreground sm:bg-transparent sm:hover:bg-muted/50",
                      )}
                    >
                      <span className="block truncate text-xs font-semibold sm:font-medium sm:text-sm">{section.label}</span>
                    </button>
                  );
                })}
              </nav>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-none backdrop-blur">
            <h2 className="text-xl font-semibold text-foreground">{activeSectionMeta.label}</h2>
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

