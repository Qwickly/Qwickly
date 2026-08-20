import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { catalogKeys, fetchCalendarEvents, fetchStaff } from "@/lib/catalog";
import type { CalendarEvent, CatalogStaff } from "@/types/catalog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TourOverlay, type TourStep } from "@/components/tour/TourOverlay";
import { BackToHelpLink } from "@/components/tour/BackToHelpLink";
import { CALENDAR_STEP_COPY } from "@/lib/tour-steps";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CalendarColumnSkeleton,
  AgendaListSkeleton,
  MonthDayCellSkeleton,
} from "@/components/skeletons/calendar-skeletons";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { PageHeader, PageEmptyState, PageToolbar } from "@/components/layout/page-ui";

const HOUR_HEIGHT = 96;
const DAY_START = 8;
const DAY_END = 20;

type CalendarViewMode = "day" | "week" | "month";

const viewModeOptions: Array<{ value: CalendarViewMode; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const CALENDAR_TOUR_ID = "calendar";

function getCalendarTourActive() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("tour") === CALENDAR_TOUR_ID;
}

function getCalendarQueryDate() {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("date");
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getCalendarQueryViewMode(): CalendarViewMode | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("view");
  return value === "day" || value === "week" || value === "month" ? value : null;
}

function createCalendarTourEvents(anchorDate: Date, staff: CatalogStaff[]): CalendarEvent[] {
  const demoDay = startOfDay(anchorDate);
  const staffPool =
    staff.length > 0
      ? staff
      : [
          {
            id: "tour-staff-maya",
            name: "Maya Stone",
            position: "Stylist",
            email: null,
            phone: null,
            avatarUrl: null,
            isActive: true,
            workingDays: [],
            upcomingBookings: 0,
            revenueGenerated: 0,
            completedBookings: 0,
            createdAt: demoDay.toISOString(),
          },
          {
            id: "tour-staff-lee",
            name: "Lee Adams",
            position: "Specialist",
            email: null,
            phone: null,
            avatarUrl: null,
            isActive: true,
            workingDays: [],
            upcomingBookings: 0,
            revenueGenerated: 0,
            completedBookings: 0,
            createdAt: demoDay.toISOString(),
          },
        ];

  const buildDate = (offsetDays: number, hour: number, minute = 0) => {
    const date = addDays(demoDay, offsetDays);
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  const makeEvent = (
    id: string,
    offsetDays: number,
    startHour: number,
    durationMinutes: number,
    clientName: string,
    serviceName: string,
    staffIndex: number,
    color: string,
    status: CalendarEvent["status"] = "confirmed",
  ): CalendarEvent => {
    const start = buildDate(offsetDays, startHour);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + durationMinutes);
    const member = staffPool[staffIndex % staffPool.length]!;

    return {
      id: `tour-${id}`,
      bookingId: `tour-booking-${id}`,
      clientName,
      clientPhone: "082 555 0198",
      serviceName,
      staffName: member.name,
      staffId: member.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      status,
      depositPaid: id !== "consultation",
      color,
      notes: "Sample appointment shown for the calendar tour.",
    };
  };

  return [
    makeEvent("cut", 0, 9, 45, "Nadia Jacobs", "Signature Cut", 0, "#24a36f"),
    makeEvent("colour", 0, 10, 90, "Thabo Mokoena", "Colour Refresh", 1, "#6366f1", "pending"),
    makeEvent("consultation", 0, 13, 30, "Aisha Khan", "Consultation", 0, "#f59e0b"),
    makeEvent("treatment", 0, 15, 60, "Liam Botha", "Treatment", 1, "#ec4899"),
    makeEvent("tomorrow", 1, 11, 60, "Priya Naidoo", "Style Session", 0, "#0ea5e9"),
    makeEvent("week", 3, 14, 45, "Daniel Smith", "Beard Trim", 1, "#14b8a6"),
  ];
}

function ViewModeSelect({
  value,
  onChange,
  className,
}: {
  value: CalendarViewMode;
  onChange: (value: CalendarViewMode) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as CalendarViewMode)}>
      <SelectTrigger
        data-tour-id="calendar-view-select"
        className={cn("w-[120px]", className)}
        aria-label="Calendar view"
      >
        <SelectValue placeholder="View" />
      </SelectTrigger>
      <SelectContent align="end">
        {viewModeOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getEventStyles(color: string) {
  const accent = color?.startsWith("#") ? color : "hsl(var(--primary))";
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
  onSelectSlot,
  className,
}: {
  events: CalendarEvent[];
  hours: number[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (hour: number) => void;
  className?: string;
}) {
  const layout = computeDayLayout(events);

  return (
    <div className={cn("relative", className)}>
      {hours.map((hour) =>
        onSelectSlot ? (
          <button
            key={hour}
            type="button"
            onClick={() => onSelectSlot(hour)}
            aria-label={`Book ${formatHourLabel(hour)}`}
            className="block h-24 w-full border-b border-border/40 transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none"
          />
        ) : (
          <div key={hour} className="h-24 border-b border-border/40" />
        ),
      )}

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
              "absolute rounded-md px-2 py-1.5 text-left overflow-hidden border border-border/40 border-l-[3px]",
              "cursor-pointer hover:brightness-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
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

function CalendarViewHeader({
  title,
  meta,
  onPrev,
  onNext,
}: {
  title: string;
  meta?: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2">
      <Button variant="ghost" size="icon" onClick={onPrev} aria-label="Previous">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 text-center">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {meta ? <p className="truncate text-xs text-muted-foreground">{meta}</p> : null}
      </div>
      <Button variant="ghost" size="icon" onClick={onNext} aria-label="Next">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function dayMeta(events: CalendarEvent[]) {
  if (events.length === 0) return "Nothing booked";
  const pending = events.filter((event) => event.status === "pending").length;
  return `${events.length} appointment${events.length === 1 ? "" : "s"}${pending > 0 ? ` · ${pending} pending` : ""}`;
}

function DayStaffScheduleView({
  day,
  staff,
  events,
  hours,
  isLoading,
  onSelectEvent,
  onSelectSlot,
  onPrev,
  onNext,
}: {
  day: Date;
  staff: CatalogStaff[];
  events: CalendarEvent[];
  hours: number[];
  isLoading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot: (hour: number, staffId: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [selectedStaffId, setSelectedStaffId] = useState(staff[0]?.id ?? null);
  const activeSelectedId = staff.some((s) => s.id === selectedStaffId) ? selectedStaffId : staff[0]?.id ?? null;

  return (
    <Card data-tour-id="calendar-day-summary" className="relative flex flex-col gap-0 overflow-hidden py-0">
      <CalendarViewHeader
        title={format(day, "EEEE, d MMMM yyyy")}
        meta={dayMeta(events)}
        onPrev={onPrev}
        onNext={onNext}
      />

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

      <div className="relative overflow-x-auto">
        <div className="flex min-w-max flex-col">
          {/* Desktop: staff header row */}
          <div className="hidden h-14 shrink-0 border-b bg-card sm:flex">
            <div className="sticky left-0 z-30 w-16 shrink-0 border-r bg-muted/20" />
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
              {hours.map((hour, idx) => (
                <div key={hour} className="h-24 border-b relative">
                  <span
                    className={cn(
                      "absolute left-0 right-2 text-right text-xs text-muted-foreground pr-2 font-medium bg-card",
                      idx === 0 ? "top-1" : "-top-3",
                    )}
                  >
                    {formatHourLabel(hour)}
                  </span>
                </div>
              ))}
            </div>

            {/* Desktop: all staff columns, fixed width, scroll horizontally */}
            <div className="hidden sm:flex flex-1">
              {staff.map((member, idx) =>
                isLoading ? (
                  <CalendarColumnSkeleton
                    key={member.id}
                    columnIndex={idx}
                    hours={hours}
                    className="w-[200px] shrink-0 border-r last:border-r-0"
                  />
                ) : (
                  <EventColumn
                    key={member.id}
                    events={events.filter((e) => e.staffId === member.id)}
                    hours={hours}
                    onSelectEvent={onSelectEvent}
                    onSelectSlot={(hour) => onSelectSlot(hour, member.id)}
                    className="w-[200px] shrink-0 border-r last:border-r-0"
                  />
                ),
              )}
            </div>

            {/* Mobile: single selected staff, full width */}
            <div className="sm:hidden flex-1">
              {isLoading ? (
                <CalendarColumnSkeleton hours={hours} className="w-full" />
              ) : (
                activeSelectedId && (
                  <EventColumn
                    events={events.filter((e) => e.staffId === activeSelectedId)}
                    hours={hours}
                    onSelectEvent={onSelectEvent}
                    onSelectSlot={(hour) => onSelectSlot(hour, activeSelectedId)}
                    className="w-full"
                  />
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function CalendarPage() {
  const [, setLocation] = useLocation();
  const calendarTourActive = getCalendarTourActive();
  const calendarTourDate = useMemo(() => addDays(startOfDay(new Date()), 2), []);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(
    () => getCalendarQueryViewMode() ?? (getCalendarTourActive() ? "month" : typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"),
  );
  const [currentDate, setCurrentDate] = useState(() => getCalendarQueryDate() ?? (getCalendarTourActive() ? calendarTourDate : new Date()));
  const [peekDay, setPeekDay] = useState<Date | null>(null);
  const [staffFilter, setStaffFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("staff") ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("status") ?? "all",
  );

  useEffect(() => {
    if (!calendarTourActive) return;
    setViewMode("month");
    setCurrentDate(calendarTourDate);
  }, [calendarTourActive, calendarTourDate]);

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
  const tourEvents = useMemo(
    () => (calendarTourActive ? createCalendarTourEvents(calendarTourDate, activeStaff) : []),
    [activeStaff, calendarTourActive, calendarTourDate],
  );
  const displayedEvents = useMemo(
    () => (calendarTourActive ? [...tourEvents, ...(events ?? [])] : events ?? []),
    [calendarTourActive, events, tourEvents],
  );

  // What the views actually render, once the toolbar's filters have had their say.
  const visibleEvents = useMemo(
    () =>
      displayedEvents.filter(
        (event) =>
          (staffFilter === "all" || event.staffId === staffFilter) &&
          (statusFilter === "all" || event.status === statusFilter),
      ),
    [displayedEvents, staffFilter, statusFilter],
  );

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

  // The view, the day you are looking at and the filters live in the URL, so a
  // refresh holds its place and a link carries it. Booking detail already links
  // in with ?date=&view=day; this is the other half of that.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", viewMode);
    params.set("date", format(currentDate, "yyyy-MM-dd"));
    if (staffFilter !== "all") params.set("staff", staffFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    const next = `/calendar?${params.toString()}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      setLocation(next, { replace: true });
    }
  }, [viewMode, currentDate, staffFilter, statusFilter, setLocation]);

  // An appointment opens its own page, which can confirm, cancel, reschedule and
  // link onward. The calendar used to answer a click with a read-only dialog
  // whose only action was Close.
  const openBooking = (event: CalendarEvent) => {
    setLocation(`/bookings/${event.bookingId}`);
  };

  // Clicking empty space books it: the new-booking page opens with this day,
  // hour and staff member already chosen.
  const bookSlot = (day: Date, hour: number, staffId?: string | null) => {
    const params = new URLSearchParams();
    params.set("date", format(day, "yyyy-MM-dd"));
    params.set("time", `${String(hour).padStart(2, "0")}:00`);
    if (staffId) params.set("staffId", staffId);
    setLocation(`/bookings/new?${params.toString()}`);
  };

  const openDay = (day: Date) => {
    setCurrentDate(day);
    setViewMode("day");
    setPeekDay(null);
  };

  const peekEvents = peekDay
    ? visibleEvents
        .filter((event) => isSameDay(new Date(event.startTime), peekDay))
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    : [];
  const calendarTourSteps: TourStep[] = [
    {
      targetId: "calendar-view-select",
      ...CALENDAR_STEP_COPY.viewSelect,
      onAdvance: () => {
        setViewMode("month");
        setCurrentDate(calendarTourDate);
      },
    },
    {
      targetId: "calendar-demo-day",
      ...CALENDAR_STEP_COPY.demoDay,
      onAdvance: () => {
        setPeekDay(calendarTourDate);
      },
    },
    {
      targetId: "calendar-day-summary-list",
      ...CALENDAR_STEP_COPY.daySummary,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 shrink-0">
        <PageHeader
          title="Calendar"
          description="View and manage your appointments by day, week, or month."
          primaryAction={
            <Button onClick={() => bookSlot(currentDate, 9)}>
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="sr-only sm:hidden">New booking</span>
              <span className="hidden sm:inline">New Booking</span>
            </Button>
          }
        />
        <PageToolbar className="flex-row flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button variant="outline" onClick={today}>
              {backToTodayLabel}
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="w-[132px]">
                <SelectValue placeholder="Staff" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {activeStaff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[132px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="no_show">No show</SelectItem>
              </SelectContent>
            </Select>
            <ViewModeSelect value={viewMode} onChange={setViewMode} className="shrink-0" />
          </div>
        </PageToolbar>
      </div>

      {viewMode === "month" ? (
        <MonthView
          monthDate={currentDate}
          events={visibleEvents}
          onPrev={goPrev}
          onNext={goNext}
          isLoading={isLoading && !calendarTourActive}
          onSelectEvent={openBooking}
          onExpandDay={setPeekDay}
          tourDay={calendarTourActive ? calendarTourDate : undefined}
        />
      ) : viewMode === "day" ? (
        activeStaff.length > 0 ? (
          <DayStaffScheduleView
            day={currentDate}
            staff={staffFilter === "all" ? activeStaff : activeStaff.filter((member) => member.id === staffFilter)}
            events={visibleEvents}
            hours={hours}
            isLoading={isLoading && !calendarTourActive}
            onSelectEvent={openBooking}
            onSelectSlot={(hour, staffId) => bookSlot(currentDate, hour, staffId)}
            onPrev={goPrev}
            onNext={goNext}
          />
        ) : (
          <DayAgendaView
            day={currentDate}
            events={visibleEvents}
            isLoading={isLoading && !calendarTourActive}
            onSelectEvent={openBooking}
            onPrev={goPrev}
            onNext={goNext}
          />
        )
      ) : (
        <Card className="relative flex flex-col gap-0 overflow-hidden py-0">
          <CalendarViewHeader
            title={navLabel}
            meta={dayMeta(visibleEvents)}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div className="relative overflow-x-auto">
            <div className="flex min-w-[800px] flex-col">
              <div className="flex h-14 shrink-0 border-b bg-card">
                <div className="sticky left-0 z-30 w-16 shrink-0 border-r bg-muted/20" />
                {weekDays.map((day) => (
                  <div
                    key={day.toString()}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 border-r bg-card text-center last:border-r-0",
                      isSameDay(day, new Date()) && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium uppercase tracking-wider",
                        isSameDay(day, new Date()) ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {format(day, "EEE")}
                    </span>
                    <span
                      className={cn(
                        "text-base",
                        isSameDay(day, new Date()) ? "font-bold text-primary" : "font-medium text-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                  </div>
                ))}
              </div>

              <div className="relative">
                <div className="flex min-h-max">
                  <div className="w-16 shrink-0 border-r bg-card sticky left-0 z-10">
                    {hours.map((hour, idx) => (
                      <div key={hour} className="h-24 border-b relative">
                        <span
                          className={cn(
                            "absolute left-0 right-2 text-right text-xs text-muted-foreground pr-2 font-medium bg-card",
                            idx === 0 ? "top-1" : "-top-3",
                          )}
                        >
                          {formatHourLabel(hour)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex-1 flex relative">
                {weekDays.map((day, idx) => {
                  if (isLoading) {
                    return (
                      <CalendarColumnSkeleton
                        key={day.toString()}
                        columnIndex={idx}
                        hours={hours}
                        className="flex-1 border-r last:border-r-0"
                      />
                    );
                  }

                  const dayEvents = visibleEvents.filter((e) => isSameDay(new Date(e.startTime), day));

                  return (
                    <EventColumn
                      key={day.toString()}
                      events={dayEvents}
                      hours={hours}
                      onSelectEvent={openBooking}
                      onSelectSlot={(hour) => bookSlot(day, hour)}
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

      <Dialog open={!!peekDay} onOpenChange={(open) => !open && setPeekDay(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{peekDay ? format(peekDay, "EEEE, d MMMM") : ""}</DialogTitle>
            <DialogDescription>
              {peekEvents.length === 0
                ? "Nothing booked on this day."
                : `${peekEvents.length} appointment${peekEvents.length === 1 ? "" : "s"} on this day.`}
            </DialogDescription>
          </DialogHeader>

          <div data-tour-id="calendar-day-summary-list" className="max-h-[50vh] space-y-2 overflow-y-auto">
            {peekEvents.map((event) => (
              <AgendaEventCard key={event.id} event={event} onSelect={openBooking} />
            ))}
          </div>

          <DialogFooter
            leading={
              peekDay ? (
                <Button variant="ghost" onClick={() => openDay(peekDay)}>
                  Open day view
                </Button>
              ) : null
            }
          >
            <Button variant="outline" onClick={() => setPeekDay(null)}>
              Close
            </Button>
            {peekDay ? (
              <Button onClick={() => bookSlot(peekDay, 9)}>
                <Plus className="mr-2 h-4 w-4" />
                Add booking
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TourOverlay
        tourId={CALENDAR_TOUR_ID}
        steps={calendarTourSteps}
        onFinish={() => setLocation("/help")}
      />
      <BackToHelpLink />
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
      className="w-full text-left rounded-lg border border-border/40 border-l-[3px] p-3 transition-all hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
        <BookingStatusBadge status={event.status} className="shrink-0" />
      </div>
    </button>
  );
}

function DayAgendaView({
  day,
  events,
  isLoading,
  onSelectEvent,
  onPrev,
  onNext,
}: {
  day: Date;
  events: CalendarEvent[];
  isLoading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const dayEvents = events
    .filter((e) => isSameDay(new Date(e.startTime), day))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return (
    <Card className="flex flex-col gap-0 overflow-hidden py-0">
      <CalendarViewHeader
        title={format(day, "EEEE, d MMMM yyyy")}
        meta={dayMeta(dayEvents)}
        onPrev={onPrev}
        onNext={onNext}
      />
      <div className="space-y-2 p-3">
        {isLoading ? (
          <AgendaListSkeleton count={4} />
        ) : dayEvents.length === 0 ? (
          <PageEmptyState icon={CalendarClock} title="No appointments this day" />
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
  onPrev,
  onNext,
  tourDay,
}: {
  monthDate: Date;
  events: CalendarEvent[];
  isLoading: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onExpandDay: (day: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  tourDay?: Date;
}) {
  const MAX_VISIBLE = 3;
  const gridStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <Card className="relative flex flex-col gap-0 overflow-hidden py-0">
      <CalendarViewHeader
        title={format(monthDate, "MMMM yyyy")}
        meta={dayMeta(events)}
        onPrev={onPrev}
        onNext={onNext}
      />
      <div className="grid shrink-0 grid-cols-7 border-b">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="border-r py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground last:border-r-0"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="relative">
        <div className="grid auto-rows-[minmax(120px,auto)] grid-cols-7">
          {days.map((day, idx) => {
            const inMonth = isSameMonth(day, monthDate);
            const dayEvents = events
              .filter((e) => isSameDay(new Date(e.startTime), day))
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
            const visible = dayEvents.slice(0, MAX_VISIBLE);
            const overflowCount = dayEvents.length - visible.length;

            return (
              <div
                key={day.toString()}
                data-tour-id={tourDay && isSameDay(day, tourDay) ? "calendar-demo-day" : undefined}
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
                  {isLoading ? (
                    <MonthDayCellSkeleton chips={inMonth ? idx % 3 : 0} />
                  ) : (
                    <>
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
                    </>
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

