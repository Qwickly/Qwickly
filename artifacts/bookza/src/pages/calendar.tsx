import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, fetchCalendarEvents, fetchStaff } from "@/lib/catalog";
import type { CalendarEvent, CatalogStaff } from "@/types/catalog";
import { NewBookingDialog } from "@/components/booking/NewBookingDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  Plus,
  Loader2,
  Clock,
  User,
  Phone,
  Scissors,
  CalendarClock,
  Banknote,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const HOUR_HEIGHT = 96;
const DAY_START = 8;
const DAY_END = 20;

function getStatusColor(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200";
    case "pending":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200";
    case "cancelled":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200";
    case "completed":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200";
    case "no_show":
      return "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getEventStyles(color: string) {
  const accent = color?.startsWith("#") ? color : "#10b981";
  return {
    backgroundColor: `${accent}1a`,
    borderLeftColor: accent,
  };
}

function formatHourLabel(hour: number) {
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function formatRelativeDayLabel(date: Date) {
  const now = new Date();
  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, addDays(now, -1))) return "Yesterday";
  if (isSameDay(date, addDays(now, 1))) return "Tomorrow";
  return format(date, "d MMMM");
}

type DayLayout = { columnIndex: number; columnCount: number };

function computeDayLayout(dayEvents: CalendarEvent[]): Map<CalendarEvent["id"], DayLayout> {
  const sorted = [...dayEvents].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const layout = new Map<CalendarEvent["id"], DayLayout>();
  const columnEndTimes: number[] = [];
  let cluster: CalendarEvent[] = [];
  let clusterEnd = -Infinity;

  const finalizeCluster = () => {
    if (cluster.length === 0) return;
    const columnCount = Math.max(...cluster.map((e) => layout.get(e.id)!.columnIndex)) + 1;
    cluster.forEach((e) => {
      layout.get(e.id)!.columnCount = columnCount;
    });
    cluster = [];
  };

  for (const event of sorted) {
    const start = new Date(event.startTime).getTime();
    const end = new Date(event.endTime).getTime();

    if (start >= clusterEnd) {
      finalizeCluster();
      columnEndTimes.length = 0;
      clusterEnd = -Infinity;
    }

    let columnIndex = columnEndTimes.findIndex((endTime) => endTime <= start);
    if (columnIndex === -1) {
      columnIndex = columnEndTimes.length;
    }
    columnEndTimes[columnIndex] = end;
    layout.set(event.id, { columnIndex, columnCount: 1 });
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, end);
  }
  finalizeCluster();

  return layout;
}

function EventColumn({
  events,
  hours,
  onSelectEvent,
  className,
}: {
  events: CalendarEvent[];
  hours: number[];
  onSelectEvent: (event: CalendarEvent) => void;
  className?: string;
}) {
  const layout = computeDayLayout(events);

  return (
    <div className={cn("relative", className)}>
      {hours.map((hour) => (
        <div key={hour} className="h-24 border-b border-border/40" />
      ))}

      {events.map((event) => {
        const start = new Date(event.startTime);
        const end = new Date(event.endTime);
        const startHour = start.getHours() + start.getMinutes() / 60;
        const endHour = end.getHours() + end.getMinutes() / 60;

        if (startHour < DAY_START || startHour > DAY_END) return null;

        const top = (startHour - DAY_START) * HOUR_HEIGHT;
        const height = (endHour - startHour) * HOUR_HEIGHT;
        const blockHeight = Math.max(height, 40);
        const isCompact = blockHeight < 56;
        const eventStyles = getEventStyles(event.color);
        const { columnIndex, columnCount } = layout.get(event.id) ?? { columnIndex: 0, columnCount: 1 };
        const widthPct = 100 / columnCount;
        const isNarrow = columnCount > 1;

        return (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent(event)}
            className={cn(
              "absolute rounded-md px-2 py-1.5 text-left overflow-hidden shadow-sm border border-border/40 border-l-[3px]",
              "cursor-pointer hover:shadow-md hover:brightness-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            )}
            style={{
              top: `${top}px`,
              height: `${blockHeight}px`,
              left: `calc(${widthPct * columnIndex}% + 2px)`,
              width: `calc(${widthPct}% - 4px)`,
              zIndex: columnIndex + 1,
              ...eventStyles,
            }}
            title={`${event.clientName} — ${event.serviceName}`}
          >
            <div className="text-foreground font-semibold text-[11px] leading-tight truncate">
              {event.clientName}
            </div>
            {!isCompact && !isNarrow && (
              <>
                <div className="text-muted-foreground text-[10px] leading-tight truncate mt-0.5">
                  {event.serviceName}
                </div>
                <div className="flex items-center gap-1 text-muted-foreground text-[10px] mt-1">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {format(start, "h:mm")} – {format(end, "h:mm a")}
                  </span>
                </div>
              </>
            )}
            {(isCompact || isNarrow) && (
              <div className="text-muted-foreground text-[10px] truncate mt-0.5">
                {format(start, "h:mm a")}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function DayStaffScheduleView({
  staff,
  events,
  hours,
  isLoading,
  onSelectEvent,
}: {
  staff: CatalogStaff[];
  events: CalendarEvent[];
  hours: number[];
  isLoading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const [selectedStaffId, setSelectedStaffId] = useState(staff[0]?.id ?? null);
  const activeSelectedId = staff.some((s) => s.id === selectedStaffId) ? selectedStaffId : staff[0]?.id ?? null;

  return (
    <Card className="flex-1 shadow-sm border-border/50 flex flex-col overflow-hidden bg-card min-h-0 relative">
      {/* Mobile: staff switcher */}
      <div className="sm:hidden border-b shrink-0 overflow-x-auto">
        <div className="flex gap-1 p-2 w-max">
          {staff.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setSelectedStaffId(member.id)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-1 rounded-lg px-3 py-1.5 transition-colors",
                activeSelectedId === member.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Avatar className="h-9 w-9">
                <AvatarImage src={member.avatarUrl ?? undefined} alt={member.name} />
                <AvatarFallback className="text-xs">{getInitials(member.name)}</AvatarFallback>
              </Avatar>
              <span className="text-[11px] font-medium max-w-[64px] truncate">{member.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto relative min-h-0">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-40">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : null}

        <div className="min-w-max flex flex-col min-h-full">
          {/* Desktop: staff header row */}
          <div className="hidden sm:flex border-b shrink-0 sticky top-0 z-20 shadow-sm bg-card">
            <div className="w-16 shrink-0 border-r bg-muted/20 sticky left-0 z-30" />
            {staff.map((member) => (
              <div
                key={member.id}
                className="w-[200px] shrink-0 border-r last:border-r-0 py-3 flex flex-col items-center gap-1.5 bg-card"
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage src={member.avatarUrl ?? undefined} alt={member.name} />
                  <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate max-w-[160px]">{member.name}</span>
              </div>
            ))}
          </div>

          <div className="flex min-h-max">
            <div className="w-16 shrink-0 border-r bg-card sticky left-0 z-10">
              {hours.map((hour) => (
                <div key={hour} className="h-24 border-b relative">
                  <span className="absolute -top-3 left-0 right-2 text-right text-xs text-muted-foreground pr-2 font-medium bg-card">
                    {formatHourLabel(hour)}
                  </span>
                </div>
              ))}
            </div>

            {/* Desktop: all staff columns, fixed width, scroll horizontally */}
            <div className="hidden sm:flex flex-1">
              {staff.map((member) => (
                <EventColumn
                  key={member.id}
                  events={events.filter((e) => e.staffId === member.id)}
                  hours={hours}
                  onSelectEvent={onSelectEvent}
                  className="w-[200px] shrink-0 border-r last:border-r-0"
                />
              ))}
            </div>

            {/* Mobile: single selected staff, full width */}
            <div className="sm:hidden flex-1">
              {activeSelectedId && (
                <EventColumn
                  events={events.filter((e) => e.staffId === activeSelectedId)}
                  hours={hours}
                  onSelectEvent={onSelectEvent}
                  className="w-full"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">(
    () => (typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"),
  );
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

  const monthGridStart = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
  const monthGridEnd = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });

  const from = (
    viewMode === "month" ? monthGridStart : viewMode === "day" ? startOfDay(currentDate) : startOfWeek(currentDate, { weekStartsOn: 1 })
  ).toISOString();
  const to = (
    viewMode === "month" ? monthGridEnd : viewMode === "day" ? endOfDay(currentDate) : endOfWeek(currentDate, { weekStartsOn: 1 })
  ).toISOString();

  const { data: events, isLoading } = useQuery({
    queryKey: catalogKeys.calendar(from, to),
    queryFn: () => fetchCalendarEvents(from, to),
  });

  const { data: staffList } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });
  const activeStaff = (staffList ?? []).filter((s) => s.isActive);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)),
    [currentDate],
  );
  const hours = useMemo(() => Array.from({ length: DAY_END - DAY_START + 1 }).map((_, i) => i + DAY_START), []);

  const goPrev = () => {
    if (viewMode === "month") setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === "day") setCurrentDate(addDays(currentDate, -1));
    else setCurrentDate(addDays(currentDate, -7));
  };
  const goNext = () => {
    if (viewMode === "month") setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === "day") setCurrentDate(addDays(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 7));
  };
  const today = () => setCurrentDate(new Date());

  const navLabel =
    viewMode === "month"
      ? format(currentDate, "MMMM")
      : viewMode === "day"
        ? formatRelativeDayLabel(currentDate)
        : `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d")} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d")}`;

  const backToTodayLabel = viewMode === "month" ? "Back to This Month" : viewMode === "week" ? "Back to This Week" : "Back to Today";

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col gap-3 shrink-0">
        {/* Mobile header */}
        <div className="flex flex-col gap-3 sm:hidden">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Calendar</h1>
              <label className="relative inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <select
                  value={viewMode}
                  onChange={(event) => setViewMode(event.target.value as "day" | "week" | "month")}
                  className="appearance-none bg-transparent pr-5 text-sm font-medium capitalize outline-none"
                  aria-label="Calendar view"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
              </label>
            </div>
            <p className="text-muted-foreground text-sm">View and manage your appointments by day, week, or month.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-9 shrink-0 text-xs font-semibold" onClick={today}>
              {backToTodayLabel}
            </Button>
            <div className="flex flex-1 items-center justify-between bg-card border rounded-md p-1 shadow-sm">
              <Button variant="ghost" size="icon" onClick={goPrev} className="h-8 w-8 shrink-0 rounded-sm hover:bg-muted">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="min-w-[110px] px-2 text-center text-sm font-medium text-foreground truncate">
                {navLabel}
              </span>
              <Button variant="ghost" size="icon" onClick={goNext} className="h-8 w-8 shrink-0 rounded-sm hover:bg-muted">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Button className="w-full bg-primary hover:bg-primary/90 shadow-sm" onClick={() => setNewBookingOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </div>

        {/* Desktop header */}
        <div className="hidden sm:flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Calendar</h1>
            <p className="text-muted-foreground text-sm mt-0.5">View and manage your appointments by day, week, or month.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-9 shrink-0 text-xs font-semibold" onClick={today}>
              {backToTodayLabel}
            </Button>
            <div className="flex items-center bg-card border rounded-md p-1 shadow-sm shrink-0">
              <Button variant="ghost" size="icon" onClick={goPrev} className="h-8 w-8 shrink-0 rounded-sm hover:bg-muted">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="min-w-[110px] px-2 text-center text-sm font-medium text-foreground truncate">
                {navLabel}
              </span>
              <Button variant="ghost" size="icon" onClick={goNext} className="h-8 w-8 shrink-0 rounded-sm hover:bg-muted">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <label className="relative inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <select
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value as "day" | "week" | "month")}
                className="appearance-none bg-transparent pr-5 text-sm font-medium capitalize outline-none"
                aria-label="Calendar view"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
            </label>
            <Button className="shrink-0 bg-primary hover:bg-primary/90 shadow-sm" onClick={() => setNewBookingOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Booking
            </Button>
          </div>
        </div>
      </div>

      {viewMode === "month" ? (
        <MonthView
          monthDate={currentDate}
          events={events ?? []}
          isLoading={isLoading}
          onSelectEvent={setSelectedEvent}
          onExpandDay={setExpandedDay}
        />
      ) : viewMode === "day" ? (
        activeStaff.length > 0 ? (
          <DayStaffScheduleView
            staff={activeStaff}
            events={events ?? []}
            hours={hours}
            isLoading={isLoading}
            onSelectEvent={setSelectedEvent}
          />
        ) : (
          <DayAgendaView
            day={currentDate}
            events={events ?? []}
            isLoading={isLoading}
            onSelectEvent={setSelectedEvent}
          />
        )
      ) : (
        <Card className="flex-1 shadow-sm border-border/50 flex flex-col overflow-hidden bg-card min-h-0 relative">
          <div className="flex-1 overflow-auto relative min-h-0">
            <div className="min-w-[800px] flex flex-col min-h-full">
              {/* Sticky Header */}
              <div className="flex border-b shrink-0 sticky top-0 z-20 shadow-sm">
                <div className="w-16 shrink-0 border-r bg-muted/20 sticky left-0 z-30" />
                {weekDays.map((day) => (
                  <div
                    key={day.toString()}
                    className={cn(
                      "flex-1 py-3 text-center border-r last:border-r-0 bg-card",
                      isSameDay(day, new Date()) && "bg-primary/5",
                    )}
                  >
                    <div
                      className={cn(
                        "text-xs font-medium uppercase tracking-wider mb-1",
                        isSameDay(day, new Date()) ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {format(day, "EEE")}
                    </div>
                    <div
                      className={cn(
                        "text-lg",
                        isSameDay(day, new Date()) ? "font-bold text-primary" : "font-medium text-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex-1 relative">
                {isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-40">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : null}

                <div className="flex min-h-max">
                  <div className="w-16 shrink-0 border-r bg-card sticky left-0 z-10">
                    {hours.map((hour) => (
                      <div key={hour} className="h-24 border-b relative">
                        <span className="absolute -top-3 left-0 right-2 text-right text-xs text-muted-foreground pr-2 font-medium bg-card">
                          {formatHourLabel(hour)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex-1 flex relative">
                {weekDays.map((day) => {
                  const dayEvents = (events ?? []).filter((e) => isSameDay(new Date(e.startTime), day));

                  return (
                    <EventColumn
                      key={day.toString()}
                      events={dayEvents}
                      hours={hours}
                      onSelectEvent={setSelectedEvent}
                      className="flex-1 border-r last:border-r-0"
                    />
                  );
                })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Booking detail */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Appointment details</DialogTitle>
            <DialogDescription>Full information for this calendar booking.</DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: selectedEvent.color || "#10b981" }}
                  />
                  <span className="font-semibold text-lg truncate">{selectedEvent.clientName}</span>
                </div>
                <Badge
                  variant="outline"
                  className={cn("capitalize shrink-0", getStatusColor(selectedEvent.status))}
                >
                  {selectedEvent.status.replace("_", " ")}
                </Badge>
              </div>

              <div className="grid gap-3 text-sm">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                  <User className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Client</p>
                    <p className="font-medium">{selectedEvent.clientName}</p>
                    {selectedEvent.clientPhone && (
                      <p className="text-muted-foreground text-xs mt-0.5 flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {selectedEvent.clientPhone}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                  <Scissors className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Service</p>
                    <p className="font-medium">{selectedEvent.serviceName}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">With {selectedEvent.staffName}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                  <CalendarClock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">When</p>
                    <p className="font-medium">
                      {format(new Date(selectedEvent.startTime), "EEEE, MMM d, yyyy")}
                    </p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {format(new Date(selectedEvent.startTime), "h:mm a")} –{" "}
                      {format(new Date(selectedEvent.endTime), "h:mm a")}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                  <Banknote className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Deposit</p>
                    <p className="font-medium">{selectedEvent.depositPaid ? "Paid" : "Not paid yet"}</p>
                  </div>
                </div>

                {selectedEvent.notes && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                    <FileText className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Notes</p>
                      <p className="text-sm">{selectedEvent.notes}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedEvent(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* All bookings for an overflowed day */}
      <Dialog open={!!expandedDay} onOpenChange={(open) => !open && setExpandedDay(null)}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{expandedDay ? format(expandedDay, "EEEE, MMM d, yyyy") : ""}</DialogTitle>
            <DialogDescription>All appointments for this day.</DialogDescription>
          </DialogHeader>
          {expandedDay && (
            <div className="space-y-2">
              {(events ?? [])
                .filter((e) => isSameDay(new Date(e.startTime), expandedDay))
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .map((event) => (
                  <AgendaEventCard
                    key={event.id}
                    event={event}
                    onSelect={(e) => {
                      setSelectedEvent(e);
                      setExpandedDay(null);
                    }}
                  />
                ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <NewBookingDialog
        open={newBookingOpen}
        onOpenChange={setNewBookingOpen}
        initialMonth={currentDate}
        onCreated={() => queryClient.invalidateQueries({ queryKey: catalogKeys.calendar(from, to) })}
      />
    </div>
  );
}

function AgendaEventCard({ event, onSelect }: { event: CalendarEvent; onSelect: (event: CalendarEvent) => void }) {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const eventStyles = getEventStyles(event.color);

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="w-full text-left rounded-lg border border-border/40 border-l-[3px] p-3 shadow-sm hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={eventStyles}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="w-3 h-3 shrink-0" />
            {format(start, "h:mm a")} – {format(end, "h:mm a")}
          </div>
          <div className="mt-1 font-semibold text-foreground truncate">{event.clientName}</div>
          <div className="text-sm text-muted-foreground truncate">
            {event.serviceName} · {event.staffName}
          </div>
        </div>
        <Badge variant="outline" className={cn("capitalize shrink-0", getStatusColor(event.status))}>
          {event.status.replace("_", " ")}
        </Badge>
      </div>
    </button>
  );
}

function DayAgendaView({
  day,
  events,
  isLoading,
  onSelectEvent,
}: {
  day: Date;
  events: CalendarEvent[];
  isLoading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const dayEvents = events
    .filter((e) => isSameDay(new Date(e.startTime), day))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return (
    <Card className="flex-1 shadow-sm border-border/50 overflow-hidden bg-card min-h-0">
      <div className="h-full overflow-auto p-3 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : dayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <CalendarClock className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm font-medium">No appointments this day</p>
          </div>
        ) : (
          dayEvents.map((event) => <AgendaEventCard key={event.id} event={event} onSelect={onSelectEvent} />)
        )}
      </div>
    </Card>
  );
}

function MonthView({
  monthDate,
  events,
  isLoading,
  onSelectEvent,
  onExpandDay,
}: {
  monthDate: Date;
  events: CalendarEvent[];
  isLoading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onExpandDay: (day: Date) => void;
}) {
  const MAX_VISIBLE = 3;
  const gridStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <Card className="flex-1 shadow-sm border-border/50 flex flex-col overflow-hidden bg-card min-h-0 relative">
      <div className="grid grid-cols-7 border-b shrink-0">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground border-r last:border-r-0"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : null}
        <div className="grid grid-cols-7 auto-rows-[minmax(96px,1fr)]">
          {days.map((day) => {
            const inMonth = isSameMonth(day, monthDate);
            const dayEvents = events
              .filter((e) => isSameDay(new Date(e.startTime), day))
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
            const visible = dayEvents.slice(0, MAX_VISIBLE);
            const overflowCount = dayEvents.length - visible.length;

            return (
              <div
                key={day.toString()}
                role="button"
                tabIndex={0}
                onClick={() => onExpandDay(day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onExpandDay(day);
                }}
                className={cn(
                  "border-r border-b last:border-r-0 p-1.5 flex flex-col gap-1 min-w-0 overflow-hidden cursor-pointer hover:bg-muted/40 transition-colors",
                  !inMonth && "bg-muted/20",
                  isSameDay(day, new Date()) && "bg-primary/5",
                )}
              >
                <div
                  className={cn(
                    "text-xs font-medium self-end px-1 shrink-0",
                    !inMonth
                      ? "text-muted-foreground/50"
                      : isSameDay(day, new Date())
                        ? "text-primary font-bold"
                        : "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </div>
                <div className="flex flex-col gap-1 min-h-0">
                  {visible.map((event) => {
                    const eventStyles = getEventStyles(event.color);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEvent(event);
                        }}
                        className="w-full text-left rounded px-1.5 py-1 border-l-[3px] overflow-hidden hover:brightness-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        style={eventStyles}
                        title={`${event.clientName} — ${event.serviceName}`}
                      >
                        <div className="text-foreground font-semibold text-[10px] leading-tight truncate">
                          {event.clientName}
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground text-[9px] mt-0.5">
                          <Clock className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">
                            {format(new Date(event.startTime), "h:mm")}–{format(new Date(event.endTime), "h:mm a")}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {overflowCount > 0 && (
                    <span className="text-[8px] leading-none font-medium text-primary px-1.5 shrink-0">
                      +{overflowCount} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
