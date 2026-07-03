import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, fetchCalendarEvents } from "@/lib/catalog";
import type { CalendarEvent } from "@/types/catalog";
import { NewBookingDialog } from "@/components/booking/NewBookingDialog";
import { format, startOfWeek, endOfWeek, addDays, isSameDay } from "date-fns";
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

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

  const from = startOfWeek(currentDate, { weekStartsOn: 1 }).toISOString();
  const to = endOfWeek(currentDate, { weekStartsOn: 1 }).toISOString();

  const { data: events, isLoading } = useQuery({
    queryKey: catalogKeys.calendar(from, to),
    queryFn: () => fetchCalendarEvents(from, to),
  });

  const weekDays = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)),
    [currentDate],
  );
  const hours = useMemo(() => Array.from({ length: DAY_END - DAY_START + 1 }).map((_, i) => i + DAY_START), []);

  const prevWeek = () => setCurrentDate(addDays(currentDate, -7));
  const nextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const today = () => setCurrentDate(new Date());

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Calendar</h1>
          <p className="text-muted-foreground text-sm">
            {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d")} –{" "}
            {format(endOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center bg-card border rounded-md p-1 shadow-sm grow sm:grow-0 justify-between sm:justify-start">
            <Button variant="ghost" size="icon" onClick={prevWeek} className="h-8 w-8 rounded-sm hover:bg-muted">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" className="h-8 px-3 rounded-sm font-medium hover:bg-muted" onClick={today}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={nextWeek} className="h-8 w-8 rounded-sm hover:bg-muted">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button className="shrink-0 bg-primary hover:bg-primary/90 shadow-sm grow sm:grow-0" onClick={() => setNewBookingOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </div>
      </div>

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
              {weekDays.map((day) => (
                <div key={day.toString()} className="flex-1 border-r last:border-r-0 relative">
                  {hours.map((hour) => (
                    <div key={hour} className="h-24 border-b border-border/40" />
                  ))}

                  {events
                    ?.filter((e) => isSameDay(new Date(e.startTime), day))
                    .map((event) => {
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

                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => setSelectedEvent(event)}
                          className={cn(
                            "absolute left-1 right-1 rounded-md px-2 py-1.5 text-left overflow-hidden shadow-sm border border-border/40 border-l-[3px]",
                            "cursor-pointer hover:shadow-md hover:brightness-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          )}
                          style={{
                            top: `${top}px`,
                            height: `${blockHeight}px`,
                            ...eventStyles,
                          }}
                          title={`${event.clientName} — ${event.serviceName}`}
                        >
                          <div className="text-foreground font-semibold text-[11px] leading-tight truncate">
                            {event.clientName}
                          </div>
                          {!isCompact && (
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
                          {isCompact && (
                            <div className="text-muted-foreground text-[10px] truncate mt-0.5">
                              {format(start, "h:mm a")}
                            </div>
                          )}
                        </button>
                      );
                    })}
                </div>
              ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

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

      <NewBookingDialog
        open={newBookingOpen}
        onOpenChange={setNewBookingOpen}
        initialMonth={currentDate}
        onCreated={() => queryClient.invalidateQueries({ queryKey: catalogKeys.calendar(from, to) })}
      />
    </div>
  );
}
