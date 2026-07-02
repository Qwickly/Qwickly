import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, createBooking, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import type { BookingSlot } from "@/types/booking-page";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import { useBookingSlots } from "@/components/booking/useBookingSlots";
import { ClientPicker } from "@/components/booking/ClientPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

export function NewBookingDialog({
  open,
  onOpenChange,
  initialMonth,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMonth?: Date;
  onCreated?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bookingForm, setBookingForm] = useState(emptyBookingForm);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(initialMonth ?? new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);

  useEffect(() => {
    if (!open) return;
    setBookingForm(emptyBookingForm());
    setCalendarMonth(startOfMonth(initialMonth ?? new Date()));
    setSelectedDate(null);
    setSelectedSlot(null);
  }, [open]);

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
    enabled: open,
  });

  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
    enabled: open,
  });

  const { data: openDays } = useQuery({
    queryKey: ["booking", "open-days"],
    queryFn: fetchOpenDays,
    enabled: open,
  });

  const { slots, loading: slotsLoading, error: slotsError } = useBookingSlots({
    serviceId: bookingForm.serviceId || null,
    staffId: bookingForm.staffId || null,
    date: selectedDate,
  });

  const createBookingMutation = useMutation({
    mutationFn: createBooking,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() });
      await onCreated?.();
      toast({ title: "Booking created", description: "The appointment has been added." });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Could not create booking",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });
  const creatingBooking = createBookingMutation.isPending;

  const selectedStaffData = (staff ?? []).find((m) => m.id === bookingForm.staffId) ?? null;

  const weekdayName = (isoDate: string): string | null => {
    if (!isoDate) return null;
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return names[d.getDay()] ?? null;
  };

  const isOpenDay = (isoDate: string): boolean => {
    if (!openDays || openDays.length === 0) return true;
    const day = weekdayName(isoDate);
    return day ? openDays.includes(day) : true;
  };

  const isDateAllowedForStaff = (isoDate: string): boolean => {
    if (!selectedStaffData?.workingDays || selectedStaffData.workingDays.length === 0) return true;
    const day = weekdayName(isoDate);
    if (!day) return true;
    return selectedStaffData.workingDays.includes(day);
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

    // Check monthly booking limit
    try {
      const subscription = await fetchSubscription();
      const businessId = await ensureBusiness();
      
      console.log("[Booking Limit Check] subscription:", subscription);
      console.log("[Booking Limit Check] businessId:", businessId);
      
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      console.log("[Booking Limit Check] startOfMonth:", startOfMonth.toISOString());
      console.log("[Booking Limit Check] endOfMonth:", endOfMonth.toISOString());
      
      const { data: monthlyBookings } = await supabase
        .from("bookings")
        .select("id")
        .eq("business_id", businessId)
        .gte("start_time", startOfMonth.toISOString())
        .lte("start_time", endOfMonth.toISOString());
      
      const bookingsThisMonth = monthlyBookings?.length || 0;
      console.log("[Booking Limit Check] monthlyBookings:", monthlyBookings);
      console.log("[Booking Limit Check] bookingsThisMonth:", bookingsThisMonth);
      
      let monthlyLimit = 100; // Default limit
      const rawMetadata = subscription?.metadata ?? subscription?.plans?.metadata;
      const parsedMetadata = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : rawMetadata;
      const customMetadata = parsedMetadata?.custom_config ?? parsedMetadata;
      monthlyLimit = customMetadata?.bookingsPerMonth ?? customMetadata?.bookings ?? 100;
      console.log("[Booking Limit Check] subscription metadata:", parsedMetadata);
      console.log("[Booking Limit Check] monthlyLimit:", monthlyLimit);
      
      if (bookingsThisMonth >= monthlyLimit) {
        console.log("[Booking Limit Check] BLOCKED: Limit reached");
        toast({
          title: "Monthly booking limit reached",
          description: `You've created ${bookingsThisMonth} bookings this month. Your plan limit is ${monthlyLimit}. Upgrade your plan to create more bookings.`,
          variant: "destructive",
        });
        return;
      }
      console.log("[Booking Limit Check] PASSED: Proceeding with booking creation");
    } catch (limitError) {
      console.error("Failed to check monthly booking limit:", limitError);
      // Continue anyway if limit check fails
    }

    try {
      await createBookingMutation.mutateAsync({
        clientId: bookingForm.clientId,
        serviceId: bookingForm.serviceId,
        staffId: bookingForm.staffId || null,
        startTime: start.toISOString(),
        notes: bookingForm.notes.trim() || null,
      });
    } catch {
      // The mutation onError handler already shows the toast.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>Schedule a new appointment.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="space-y-2">
            <Label>Client</Label>
            <ClientPicker
              value={bookingForm.clientId}
              onChange={(client) => setBookingForm((f) => ({ ...f, clientId: client.id }))}
            />
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
                {(services ?? []).filter((s) => s.isActive).map((s) => (
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
              onValueChange={(v) => setBookingForm((f) => ({ ...f, staffId: v === "none" ? "" : v }))}
            >
              <SelectTrigger>
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

          {bookingForm.serviceId ? (
            <div className="space-y-2">
              <Label>Date</Label>
              <BookingCalendarGrid
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                isDateSelectable={isDateSelectable}
                primaryColor="hsl(var(--primary))"
                radiusCss="var(--radius)"
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
                primaryColor="hsl(var(--primary))"
                radiusCss="var(--radius)"
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creatingBooking}>
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
  );
}
