import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { catalogKeys, fetchBooking, fetchServices, fetchStaff, updateBooking } from "@/lib/catalog";
import type { BookingSlot } from "@/types/booking-page";
import type { BookingStatus } from "@/types/catalog";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import { useBookingSlots } from "@/components/booking/useBookingSlots";
import { InfoTile, PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const statuses: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled", "no_show"];

function startOfMonth(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function timeValue(date: Date) {
  return format(date, "HH:mm");
}

export default function BookingEditPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    serviceId: "",
    staffId: "",
    status: "pending" as BookingStatus,
    depositPaid: false,
    notes: "",
  });
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);

  const { data: booking, isLoading, isError } = useQuery({
    queryKey: catalogKeys.booking(id),
    queryFn: () => fetchBooking(id),
  });

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Bookings", href: "/bookings" },
        { label: booking?.clientName ?? "Booking", href: `/bookings/${id}` },
        { label: "Edit" },
      ],
    }),
    [booking?.clientName, id],
  );
  usePageChrome(pageChrome);

  useEffect(() => {
    if (!booking) return;
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);
    setForm({
      serviceId: booking.serviceId,
      staffId: booking.staffId ?? "",
      status: booking.status,
      depositPaid: booking.depositPaid,
      notes: booking.notes ?? "",
    });
    setCalendarMonth(startOfMonth(start));
    setSelectedDate(format(start, "yyyy-MM-dd"));
    setSelectedSlot({ startTime: timeValue(start), endTime: timeValue(end) });
  }, [booking]);

  const { slots, loading: slotsLoading, error: slotsError } = useBookingSlots({
    serviceId: form.serviceId || null,
    staffId: form.staffId || null,
    date: selectedDate,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedDate || !selectedSlot) throw new Error("Choose a date and time.");
      const start = new Date(`${selectedDate}T${selectedSlot.startTime}:00`);
      return updateBooking(id, {
        clientId: booking?.clientId,
        serviceId: form.serviceId,
        staffId: form.staffId || null,
        status: form.status,
        depositPaid: form.depositPaid,
        startTime: start.toISOString(),
        notes: form.notes.trim() || null,
      });
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.booking(id) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() }),
      ]);
      toast("Booking updated");
      navigate(`/bookings/${updated.id}`);
    },
    onError: (err) => {
      toast.error("Could not update booking", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit booking" description="Loading appointment..." />
      </div>
    );
  }

  if (isError || !booking) {
    return (
      <div className="space-y-6">
        <PageEmptyState title="Booking not found" description="This booking may have been removed." />
      </div>
    );
  }

  const bookingDateIso = format(new Date(booking.startTime), "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit booking"
        description={`${booking.clientName} · ${format(new Date(booking.startTime), "d MMM yyyy, h:mm a")}`}
      />

      <Card>
        <CardContent className="grid gap-6">
          <div className="space-y-2">
            <Label>Client</Label>
            <InfoTile className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{booking.clientName}</p>
                <p className="truncate text-xs text-muted-foreground">{booking.clientPhone || "No phone"}</p>
              </div>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link href={`/clients/${booking.clientId}`}>
                  View client
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </InfoTile>
            <p className="text-xs text-muted-foreground">
              The client stays with this booking. To move it to someone else, cancel it and create a new one.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={form.serviceId} onValueChange={(v) => setForm((f) => ({ ...f, serviceId: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {(services ?? []).map((s) => (
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
                value={form.staffId || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, staffId: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(staff ?? []).map((m) => (
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
            <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <BookingCalendarGrid
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selectedDate={selectedDate}
                onSelectDate={(iso) => {
                  setSelectedDate(iso);
                  setSelectedSlot(null);
                }}
                isDateSelectable={(iso) => iso >= toIsoDate(new Date()) || iso === bookingDateIso}
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
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as BookingStatus }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-paid">Deposit</Label>
              <div className="flex h-9 w-full items-center justify-between gap-3 rounded-md border border-input bg-transparent px-3 shadow-xs dark:bg-input/30">
                <span className="text-sm text-muted-foreground">{form.depositPaid ? "Paid" : "Outstanding"}</span>
                <Switch
                  id="deposit-paid"
                  checked={form.depositPaid}
                  onCheckedChange={(depositPaid) => setForm((f) => ({ ...f, depositPaid }))}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Any special requests or internal notes..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate(`/bookings/${id}`)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !selectedDate || !selectedSlot}>
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
