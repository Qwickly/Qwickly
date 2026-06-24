import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  catalogKeys,
  createBooking,
  fetchBusinessBookingSlots,
  fetchCalendarEvents,
  fetchClients,
  fetchServices,
  fetchStaff,
} from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import type { CalendarEvent } from "@/types/catalog";
import type { BookingSlot } from "@/types/booking-page";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import { format, startOfWeek, endOfWeek, addDays, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";

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

const emptyBookingForm = () => ({
  clientId: "",
  serviceId: "",
  staffId: "",
  notes: "",
});

const ADMIN_PRIMARY_COLOR = "hsl(var(--primary))";
const ADMIN_RADIUS = "var(--radius)";

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState(emptyBookingForm);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const from = startOfWeek(currentDate, { weekStartsOn: 1 }).toISOString();
  const to = endOfWeek(currentDate, { weekStartsOn: 1 }).toISOString();

  const { data: events, isLoading } = useQuery({
    queryKey: catalogKeys.calendar(from, to),
    queryFn: () => fetchCalendarEvents(from, to),
  });
  const { data: clientsData } = useQuery({
    queryKey: catalogKeys.clients,
    queryFn: () => fetchClients(1, 100),
  });
  const clients = clientsData?.clients;
  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });
  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });
  const { data: openDays } = useQuery({
    queryKey: ["calendar", "open-days"],
    queryFn: fetchOpenDays,
  });

  const createBookingMutation = useMutation({
    mutationFn: createBooking,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.calendar(from, to) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() }),
      ]);
    },
  });
  const creatingBooking = createBookingMutation.isPending;

  const selectedStaffData = staff?.find((m) => m.id === bookingForm.staffId) ?? null;

  const weekdayName = (isoDate: string): string | null => {
    if (!isoDate) return null;
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return names[d.getDay()] ?? null;
  };

  const isDateAllowedForStaff = (isoDate: string): boolean => {
    if (!selectedStaffData?.workingDays || selectedStaffData.workingDays.length === 0) return true;
    const day = weekdayName(isoDate);
    if (!day) return true;
    return selectedStaffData.workingDays.includes(day);
  };

  const isOpenDay = (isoDate: string): boolean => {
    if (!openDays || openDays.length === 0) return true;
    const day = weekdayName(isoDate);
    return day ? openDays.includes(day) : true;
  };

  const isDateSelectable = (isoDate: string): boolean =>
    isoDate >= toIsoDate(new Date()) && isOpenDay(isoDate) && isDateAllowedForStaff(isoDate);

  useEffect(() => {
    if (!selectedDate) return;
    if (!isDateAllowedForStaff(selectedDate)) {
      setSelectedDate(null);
      setSelectedSlot(null);
    }
  }, [selectedDate, bookingForm.staffId]);

  useEffect(() => {
    if (!selectedDate || !bookingForm.serviceId) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);

    fetchBusinessBookingSlots({
      serviceId: bookingForm.serviceId,
      staffId: bookingForm.staffId || null,
      date: selectedDate,
    })
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setSlotsError(err instanceof Error ? err.message : "Could not load available times.");
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDate, bookingForm.serviceId, bookingForm.staffId]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)),
    [currentDate],
  );
  const hours = useMemo(() => Array.from({ length: DAY_END - DAY_START + 1 }).map((_, i) => i + DAY_START), []);

  const prevWeek = () => setCurrentDate(addDays(currentDate, -7));
  const nextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const today = () => setCurrentDate(new Date());

  const openNewBooking = () => {
    setBookingForm(emptyBookingForm());
    setSelectedDate(null);
    setSelectedSlot(null);
    setCalendarMonth(() => {
      const d = new Date(currentDate);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    });
    setNewBookingOpen(true);
  };

  const handleSelectDate = (iso: string) => {
    setSelectedDate(iso);
    setSelectedSlot(null);
  };

  const handleCreateBooking = async () => {
    if (!bookingForm.clientId || !bookingForm.serviceId) {
      toast({
        title: "Missing fields",
        description: "Please select a client and service.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedDate || !selectedSlot) {
      toast({
        title: "Missing date and time",
        description: "Please choose a date and time for the appointment.",
        variant: "destructive",
      });
      return;
    }

    const start = new Date(`${selectedDate}T${selectedSlot.startTime}:00`);
    if (Number.isNaN(start.getTime())) {
      toast({
        title: "Invalid date or time",
        description: "Please choose a valid appointment date and time.",
        variant: "destructive",
      });
      return;
    }

    try {
      await createBookingMutation.mutateAsync({
        clientId: bookingForm.clientId,
        serviceId: bookingForm.serviceId,
        staffId: bookingForm.staffId || null,
        startTime: start.toISOString(),
        notes: bookingForm.notes.trim() || null,
      });

      toast({ title: "Booking created", description: "The appointment has been added to your calendar." });
      setNewBookingOpen(false);
      setBookingForm(emptyBookingForm());
      setSelectedDate(null);
      setSelectedSlot(null);
    } catch (err) {
      toast({
        title: "Could not create booking",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

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
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-card border rounded-md p-1 shadow-sm">
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
          <Button className="shrink-0 bg-primary hover:bg-primary/90 shadow-sm" onClick={openNewBooking}>
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </div>
      </div>

      <Card className="flex-1 shadow-sm border-border/50 flex flex-col overflow-hidden bg-card min-h-0">
        <div className="flex border-b shrink-0 bg-muted/20">
          <div className="w-16 shrink-0 border-r" />
          {weekDays.map((day) => (
            <div
              key={day.toString()}
              className={cn(
                "flex-1 py-3 text-center border-r last:border-r-0",
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

        <div className="flex-1 overflow-y-auto relative min-h-0">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : null}

          <div className="flex min-h-max">
            <div className="w-16 shrink-0 border-r bg-muted/10">
              {hours.map((hour) => (
                <div key={hour} className="h-24 border-b relative">
                  <span className="absolute -top-3 left-0 right-2 text-right text-xs text-muted-foreground pr-2 font-medium">
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
      </Card>

      {/* Booking detail */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-md">
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

      {/* New booking */}
      <Dialog open={newBookingOpen} onOpenChange={setNewBookingOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New booking</DialogTitle>
            <DialogDescription>Schedule a new appointment on your calendar.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select
                value={bookingForm.clientId}
                onValueChange={(v) => setBookingForm((f) => ({ ...f, clientId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Service</Label>
              <Select
                value={bookingForm.serviceId}
                onValueChange={(v) => setBookingForm((f) => ({ ...f, serviceId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {services?.filter((s) => s.isActive).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} · R {Number(s.price).toLocaleString()} · {s.duration} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Staff member (optional)</Label>
              <Select
                value={bookingForm.staffId || "none"}
                onValueChange={(v) =>
                  setBookingForm((f) => ({ ...f, staffId: v === "none" ? "" : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {staff?.filter((m) => m.isActive).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} · {m.position}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bookingForm.serviceId ? (
              <div className="space-y-2">
                <Label>Date</Label>
                <BookingCalendarGrid
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  selectedDate={selectedDate}
                  onSelectDate={handleSelectDate}
                  isDateSelectable={isDateSelectable}
                  primaryColor={ADMIN_PRIMARY_COLOR}
                  radiusCss={ADMIN_RADIUS}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a service to choose a date and time.</p>
            )}

            {selectedDate && (
              <div className="space-y-2">
                <Label>Time</Label>
                <BookingSlotPicker
                  slots={slots}
                  selectedSlot={selectedSlot}
                  onSelect={setSelectedSlot}
                  loading={slotsLoading}
                  error={slotsError}
                  primaryColor={ADMIN_PRIMARY_COLOR}
                  radiusCss={ADMIN_RADIUS}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Any special requests or internal notes…"
                value={bookingForm.notes}
                onChange={(e) => setBookingForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
              />
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBookingOpen(false)} disabled={creatingBooking}>
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleCreateBooking}
              disabled={creatingBooking || !selectedDate || !selectedSlot}
            >
              {creatingBooking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
