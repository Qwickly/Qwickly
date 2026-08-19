import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { catalogKeys, createBooking, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { ensureBusiness, fetchOpenDays } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import type { BookingSlot } from "@/types/booking-page";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import { ClientPicker } from "@/components/booking/ClientPicker";
import { useBookingSlots } from "@/components/booking/useBookingSlots";
import { PageHeader } from "@/components/layout/page-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const emptyBookingForm = () => ({
  clientId: "",
  serviceId: "",
  staffId: "",
  notes: "",
});

function startOfMonth(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

export default function BookingNewPage() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const queryClient = useQueryClient();

  // The calendar links in with a slot already chosen — click 10:00 on Thursday
  // under a staff member and land here with that filled in. A dialog could not
  // be linked to like this, which is half the reason creating moved to a page.
  const prefill = new URLSearchParams(queryString);
  const prefillDate = prefill.get("date");
  const prefillTime = prefill.get("time");
  const prefillStaffId = prefill.get("staffId");

  const [bookingForm, setBookingForm] = useState(() => ({
    ...emptyBookingForm(),
    staffId: prefillStaffId ?? "",
  }));
  const [calendarMonth, setCalendarMonth] = useState<Date>(() =>
    startOfMonth(prefillDate ? new Date(`${prefillDate}T00:00:00`) : new Date()),
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(prefillDate);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [prefillTimeApplied, setPrefillTimeApplied] = useState(false);

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });

  const { data: openDays } = useQuery({
    queryKey: ["booking", "open-days"],
    queryFn: fetchOpenDays,
  });

  const { slots, loading: slotsLoading, error: slotsError } = useBookingSlots({
    serviceId: bookingForm.serviceId || null,
    staffId: bookingForm.staffId || null,
    date: selectedDate,
  });

  useEffect(() => {
    if (prefillTimeApplied || !prefillTime || slots.length === 0) return;
    const match = slots.find((slot) => slot.startTime === prefillTime);
    if (match) setSelectedSlot(match);
    setPrefillTimeApplied(true);
  }, [slots, prefillTime, prefillTimeApplied]);

  const selectedStaffData = (staff ?? []).find((m) => m.id === bookingForm.staffId) ?? null;

  const weekdayName = (isoDate: string): string | null => {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()] ?? null;
  };

  const isOpenDay = (isoDate: string): boolean => {
    if (!openDays || openDays.length === 0) return true;
    const day = weekdayName(isoDate);
    return day ? openDays.includes(day) : true;
  };

  const isDateAllowedForStaff = (isoDate: string): boolean => {
    if (!selectedStaffData?.workingDays || selectedStaffData.workingDays.length === 0) return true;
    const day = weekdayName(isoDate);
    return day ? selectedStaffData.workingDays.includes(day) : true;
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

  const createBookingMutation = useMutation({
    mutationFn: createBooking,
    onSuccess: async (booking) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() });
      toast("Booking created", { description: "The appointment has been added." });
      navigate(`/bookings/${booking.id}`);
    },
    onError: (err) => {
      toast.error("Could not create booking", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  const handleCreateBooking = async () => {
    if (!bookingForm.clientId || !bookingForm.serviceId) {
      toast.error("Missing fields", { description: "Please select a client and service." });
      return;
    }

    if (!selectedDate || !selectedSlot) {
      toast.error("Missing date and time", { description: "Please choose a date and time for the appointment." });
      return;
    }

    const start = new Date(`${selectedDate}T${selectedSlot.startTime}:00`);
    if (Number.isNaN(start.getTime())) {
      toast.error("Invalid date or time", { description: "Please choose a valid appointment date and time." });
      return;
    }

    try {
      const subscription = await fetchSubscription();
      const businessId = await ensureBusiness();
      const now = new Date();
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const { data: monthlyBookings } = await supabase
        .from("bookings")
        .select("id")
        .eq("business_id", businessId)
        .gte("start_time", startOfThisMonth.toISOString())
        .lte("start_time", endOfThisMonth.toISOString());
      const rawMetadata = subscription?.metadata ?? subscription?.plans?.metadata;
      const parsedMetadata = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : rawMetadata;
      const customMetadata = parsedMetadata?.custom_config ?? parsedMetadata;
      const monthlyLimit = customMetadata?.bookingsPerMonth ?? customMetadata?.bookings ?? 100;

      if ((monthlyBookings?.length || 0) >= monthlyLimit) {
        toast.error("Monthly booking limit reached", {
          description: `You've created ${monthlyBookings?.length || 0} bookings this month. Your plan limit is ${monthlyLimit}.`,
        });
        return;
      }
    } catch {
      // Continue if the friendly pre-check cannot run; the create call remains authoritative.
    }

    await createBookingMutation.mutateAsync({
      clientId: bookingForm.clientId,
      serviceId: bookingForm.serviceId,
      staffId: bookingForm.staffId || null,
      startTime: start.toISOString(),
      notes: bookingForm.notes.trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="New booking" description="Schedule a client appointment." />

      <Card>
        <CardContent className="grid gap-6">
          <div className="space-y-2">
            <Label>Client</Label>
            <ClientPicker
              value={bookingForm.clientId}
              onChange={(client) => setBookingForm((f) => ({ ...f, clientId: client.id }))}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={bookingForm.serviceId} onValueChange={(v) => setBookingForm((f) => ({ ...f, serviceId: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {(services ?? []).filter((s) => s.isActive).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} · R {Number(s.price).toLocaleString()} · {s.duration} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Staff member</Label>
              <Select
                value={bookingForm.staffId || "none"}
                onValueChange={(v) => setBookingForm((f) => ({ ...f, staffId: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(staff ?? []).filter((m) => m.isActive).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} · {m.position || "Staff"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Date &amp; time</Label>
            {bookingForm.serviceId ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                <BookingCalendarGrid
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  selectedDate={selectedDate}
                  onSelectDate={(iso) => {
                    setSelectedDate(iso);
                    setSelectedSlot(null);
                  }}
                  isDateSelectable={isDateSelectable}
                  primaryColor="hsl(var(--primary))"
                  radiusCss="var(--radius)"
                  tone="app"
                />

                <div className="flex min-h-[220px] flex-col rounded-xl border border-border bg-card p-3">
                  {selectedDate ? (
                    <>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Times for {format(new Date(`${selectedDate}T00:00:00`), "EEE d MMM")}
                      </p>
                      <BookingSlotPicker
                        slots={slots}
                        selectedSlot={selectedSlot}
                        onSelect={setSelectedSlot}
                        loading={slotsLoading}
                        error={slotsError}
                        primaryColor="hsl(var(--primary))"
                        radiusCss="var(--radius)"
                        tone="app"
                        className="flex-1"
                      />
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                      Pick a date to see available times.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
                Choose a service first — available dates and times depend on how long it takes.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Any special requests or internal notes..."
              value={bookingForm.notes}
              onChange={(e) => setBookingForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate("/bookings")} disabled={createBookingMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleCreateBooking} disabled={createBookingMutation.isPending || !selectedDate || !selectedSlot}>
              {createBookingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create booking
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
