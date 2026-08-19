import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelBooking,
  catalogKeys,
  confirmBooking,
  fetchBookings,
  fetchServices,
  fetchStaff,
  rescheduleBooking,
} from "@/lib/catalog";
import type { BookingSlot } from "@/types/booking-page";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import { useBookingSlots } from "@/components/booking/useBookingSlots";
import { downloadCsv, rowsToCsv } from "@/lib/csv";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { Plus, Loader2, MoreHorizontal, CheckCircle, XCircle, CalendarClock, Eye, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { BookingTableSkeleton, BookingCardListSkeleton } from "@/components/skeletons/booking-skeleton";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { DataViewToolbar, PageHeader, PageEmptyState, PageOverflowMenu, type DataViewMode } from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { usePermissions } from "@/hooks/use-permissions";

const PAGE_SIZE = 10;

const emptyExportFilters = () => ({
  status: "all",
  dateFrom: "",
  dateTo: "",
  staffId: "all",
  serviceId: "all",
});

type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "primary" | "danger";
  onConfirm: () => void;
} | null;

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function BookingsPage() {
  const { canWriteBookings } = usePermissions();
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const [status, setStatus] = useState<string>("all");
  const [dataView, setDataView] = useState<DataViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "table",
  );
  const [search, setSearch] = useState(
    () => new URLSearchParams(queryString).get("q") ?? "",
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState(emptyExportFilters);
  const [rescheduleBookingTarget, setRescheduleBookingTarget] = useState<any>(null);
  const [rescheduleMonth, setRescheduleMonth] = useState<Date>(new Date());
  const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
  const [rescheduleSlot, setRescheduleSlot] = useState<BookingSlot | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const queryClient = useQueryClient();

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });

  const { slots: rescheduleSlots, loading: rescheduleSlotsLoading, error: rescheduleSlotsError } = useBookingSlots({
    serviceId: rescheduleBookingTarget?.serviceId ?? null,
    staffId: rescheduleBookingTarget?.staffId ?? null,
    date: rescheduleDate,
  });

  const confirmBookingMutation = useMutation({
    mutationFn: (id: string) => confirmBooking(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog", "bookings"] });
      toast("Booking confirmed");
    },
    onError: (err) => {
      toast.error("Could not confirm booking", { description: err instanceof Error ? err.message : "Something went wrong." });
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: (id: string) => cancelBooking(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog", "bookings"] });
      toast("Booking cancelled");
    },
    onError: (err) => {
      toast.error("Could not cancel booking", { description: err instanceof Error ? err.message : "Something went wrong." });
    },
  });

  const rescheduleBookingMutation = useMutation({
    mutationFn: ({ id, startTime }: { id: string; startTime: string }) => rescheduleBooking(id, startTime),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["catalog", "bookings"] });
      setRescheduleBookingTarget(null);

      // The rescheduling_alerts DB trigger queues the client (and staff, if
      // enabled) WhatsApp notification. Do not send it directly here — that
      // caused duplicate messages.
      toast("Booking rescheduled", { description: updated.clientPhone
          ? "The client will be notified via WhatsApp."
          : "No phone number on file — the client was not notified." });
    },
    onError: (err) => {
      toast.error("Could not reschedule booking", { description: err instanceof Error ? err.message : "Something went wrong." });
    },
  });

  const isMutating = confirmBookingMutation.isPending || cancelBookingMutation.isPending || rescheduleBookingMutation.isPending;
  const { data: bookings, isLoading } = useQuery({
    queryKey: catalogKeys.bookings(),
    queryFn: () => fetchBookings(),
  });

  const openReschedule = (booking: any) => {
    const start = new Date(booking.startTime);
    setRescheduleMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    setRescheduleDate(toIsoDate(start));
    setRescheduleSlot(null);
    setRescheduleBookingTarget(booking);
  };

  const handleSelectRescheduleDate = (iso: string) => {
    setRescheduleDate(iso);
    setRescheduleSlot(null);
  };

  const handleReschedule = () => {
    if (!rescheduleBookingTarget || !rescheduleDate || !rescheduleSlot) {
      toast.error("Choose a date and time", { description: "Please select an available slot first." });
      return;
    }
    const start = new Date(`${rescheduleDate}T${rescheduleSlot.startTime}:00`);
    setConfirmation({
      title: "Reschedule this booking?",
      description: `Move ${rescheduleBookingTarget.clientName}'s booking to ${format(start, "EEEE, MMM d")} at ${format(start, "h:mm a")}. The client will be notified via WhatsApp.`,
      confirmLabel: "Reschedule booking",
      tone: "primary",
      onConfirm: () => rescheduleBookingMutation.mutate({ id: rescheduleBookingTarget.id, startTime: start.toISOString() }),
    });
  };

  const requestConfirmBooking = (booking: any) => {
    setConfirmation({
      title: "Confirm this booking?",
      description: `Confirm ${booking.clientName}'s ${booking.serviceName} booking for ${format(new Date(booking.startTime), "EEEE, MMM d")} at ${format(new Date(booking.startTime), "h:mm a")}.`,
      confirmLabel: "Confirm booking",
      tone: "primary",
      onConfirm: () => confirmBookingMutation.mutate(booking.id),
    });
  };

  const requestCancelBooking = (booking: any) => {
    setConfirmation({
      title: "Cancel this booking?",
      description: `Cancel ${booking.clientName}'s ${booking.serviceName} booking for ${format(new Date(booking.startTime), "EEEE, MMM d")} at ${format(new Date(booking.startTime), "h:mm a")}.`,
      confirmLabel: "Cancel booking",
      tone: "danger",
      onConfirm: () => cancelBookingMutation.mutate(booking.id),
    });
  };

  const handleStatusChange = (next: string) => {
    setStatus(next);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const byStatus = (bookings ?? []).filter((b) => status === "all" || b.status === status);

  const filtered = byStatus.filter(b =>
    !search ||
    b.clientName.toLowerCase().includes(search.toLowerCase()) ||
    b.serviceName.toLowerCase().includes(search.toLowerCase()) ||
    b.staffName.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const openExportDialog = () => {
    setExportFilters(emptyExportFilters());
    setExportDialogOpen(true);
  };

  const handleExport = () => {
    const fromTime = exportFilters.dateFrom ? new Date(`${exportFilters.dateFrom}T00:00:00`).getTime() : null;
    const toTime = exportFilters.dateTo ? new Date(`${exportFilters.dateTo}T23:59:59`).getTime() : null;

    const toExport = (bookings ?? []).filter((b) => {
      if (exportFilters.status !== "all" && b.status !== exportFilters.status) return false;
      if (exportFilters.staffId !== "all" && b.staffId !== exportFilters.staffId) return false;
      if (exportFilters.serviceId !== "all" && b.serviceId !== exportFilters.serviceId) return false;
      const startMs = new Date(b.startTime).getTime();
      if (fromTime !== null && startMs < fromTime) return false;
      if (toTime !== null && startMs > toTime) return false;
      return true;
    });

    if (toExport.length === 0) {
      toast.error("Nothing to export", { description: "There are no bookings matching the filters you selected." });
      return;
    }

    const csv = rowsToCsv(
      ["Date", "Time", "Client", "Phone", "Service", "Staff", "Status", "Deposit Paid", "Amount (R)", "Notes"],
      toExport.map((b) => [
        format(new Date(b.startTime), "yyyy-MM-dd"),
        format(new Date(b.startTime), "HH:mm"),
        b.clientName,
        b.clientPhone ?? "",
        b.serviceName,
        b.staffName,
        b.status,
        b.depositPaid ? "Yes" : "No",
        b.totalAmount,
        b.notes ?? "",
      ]),
    );

    downloadCsv(`bookings-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    toast("Export ready", { description: `Downloaded ${toExport.length} booking${toExport.length === 1 ? "" : "s"}.` });
    setExportDialogOpen(false);
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="View and manage all customer appointments."
        primaryAction={
          canWriteBookings ? (
            <Button onClick={() => navigate("/bookings/new")}>
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="sr-only sm:hidden">New booking</span>
              <span className="hidden sm:inline">New Booking</span>
            </Button>
          ) : null
        }
        overflowActions={
          <PageOverflowMenu label="Booking list actions">
            <DropdownMenuItem onClick={openExportDialog}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </DropdownMenuItem>
          </PageOverflowMenu>
        }
      />

      <DataViewToolbar viewMode={dataView} onViewModeChange={setDataView}>
        <div className="min-w-0 flex-1">
          <Input
            placeholder="Search"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="no_show">No Show</SelectItem>
          </SelectContent>
        </Select>
      </DataViewToolbar>

      {dataView === "table" ? (
      <Card className="gap-0 overflow-hidden rounded-xl border-border/70 bg-card py-0 shadow-none">
        <div className="overflow-x-auto">
          <Table className="min-w-[620px] table-fixed [&_td]:px-3 [&_th]:px-3 md:min-w-[860px] md:[&_td]:px-4 md:[&_th]:px-4">
            <colgroup>
              <col className="w-[30%] md:w-[22%]" />
              <col className="w-[24%] md:w-[14%]" />
              <col className="hidden md:table-column md:w-[17%]" />
              <col className="w-[20%] md:w-[18%]" />
              <col className="w-[14%] md:w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[48px]" />
            </colgroup>
            <TableHeader className="bg-muted/15">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">Client</TableHead>
                <TableHead className="h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground md:hidden">Appointment</TableHead>
                <TableHead className="hidden h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground md:table-cell">Service</TableHead>
                <TableHead className="hidden h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground md:table-cell">Staff</TableHead>
                <TableHead className="h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">Date & Time</TableHead>
                <TableHead className="h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">Status</TableHead>
                <TableHead className="h-10 text-right text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">Amount</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <BookingTableSkeleton rows={6} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64">
                    <PageEmptyState title="No bookings found" />
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((booking) => (
                  <TableRow
                    key={booking.id}
                    className="group h-16 cursor-pointer border-border/50 transition-colors hover:bg-muted/20 [&_td]:align-middle [&_td]:py-3.5"
                    onClick={() => navigate(`/bookings/${booking.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/clients/${booking.clientId}`}
                        className="group/client inline-flex max-w-full items-center gap-3 rounded-lg py-1 pr-2 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/35 text-[11px] font-semibold text-muted-foreground transition-colors group-hover/client:border-primary/30 group-hover/client:bg-primary/10 group-hover/client:text-primary">
                          {initials(booking.clientName)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover/client:text-primary">{booking.clientName}</span>
                          <span className="truncate text-xs text-muted-foreground">{booking.clientPhone || "No phone"}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/services/${booking.serviceId}`}
                        className="inline-flex max-w-full rounded-md py-1 pr-2 text-sm font-normal text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:font-normal"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="truncate">{booking.serviceName}</span>
                      </Link>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 md:hidden">
                        {booking.staffId ? (
                          <Link
                            href={`/staff/${booking.staffId}`}
                            className="truncate rounded-md text-xs text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {booking.staffName}
                          </Link>
                        ) : (
                          <span className="truncate text-xs text-muted-foreground">Unassigned</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {booking.staffId ? (
                        <Link
                          href={`/staff/${booking.staffId}`}
                          className="group/staff inline-flex max-w-full items-center gap-2 rounded-md py-1 pr-2 text-sm text-foreground/75 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/45 text-[10px] font-semibold text-muted-foreground transition-colors group-hover/staff:bg-primary/10 group-hover/staff:text-primary">
                            {initials(booking.staffName)}
                          </span>
                          <span className="truncate">{booking.staffName}</span>
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/calendar?date=${format(new Date(booking.startTime), "yyyy-MM-dd")}&view=day`}
                        className="inline-flex max-w-full flex-col rounded-md py-1 pr-2 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-foreground">{format(new Date(booking.startTime), "d MMM yyyy")}</span>
                        <span className="truncate text-xs text-muted-foreground transition-colors hover:text-primary">{format(new Date(booking.startTime), "h:mm a")}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <BookingStatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold text-foreground">
                      {formatCurrency(booking.totalAmount)}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-foreground">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/bookings/${booking.id}`)}>
                            <Eye className="w-4 h-4 mr-2" /> View Details
                          </DropdownMenuItem>
                          {canWriteBookings && (
                            <>
                              <DropdownMenuSeparator />
                              {booking.status === "pending" && (
                                <DropdownMenuItem
                                  className="text-primary"
                                  disabled={isMutating}
                                  onClick={() => requestConfirmBooking(booking)}
                                >
                                  <CheckCircle className="w-4 h-4 mr-2" /> Confirm Booking
                                </DropdownMenuItem>
                              )}
                              {booking.status !== "cancelled" && (
                                <DropdownMenuItem onClick={() => openReschedule(booking)}>
                                  <CalendarClock className="w-4 h-4 mr-2" /> Reschedule
                                </DropdownMenuItem>
                              )}
                              {booking.status !== "cancelled" && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  disabled={isMutating}
                                  onClick={() => requestCancelBooking(booking)}
                                >
                                  <XCircle className="w-4 h-4 mr-2" /> Cancel Booking
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
      ) : null}

      {/* Mobile Card List */}
      {dataView === "cards" ? (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <BookingCardListSkeleton count={4} />
        ) : filtered.length === 0 ? (
          <Card className="sm:col-span-2 xl:col-span-3">
            <PageEmptyState title="No bookings found" />
          </Card>
        ) : (
          paginated.map((booking) => (
            <Card
              key={booking.id}
              className="group relative min-h-[245px] gap-0 overflow-hidden rounded-2xl border-border/60 bg-card py-0 shadow-sm transition-[border-color,box-shadow,background-color] hover:border-border hover:bg-card hover:shadow-md active:bg-muted/25"
              onClick={() => navigate(`/bookings/${booking.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/bookings/${booking.id}`);
                }
              }}
            >
              <div className="flex h-full flex-col p-5">
                <div
                  className="absolute right-3.5 top-3.5"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-[10px] text-muted-foreground hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Booking actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/bookings/${booking.id}`)}>
                        <Eye className="w-4 h-4 mr-2" /> View Details
                      </DropdownMenuItem>
                      {canWriteBookings && (
                        <>
                          <DropdownMenuSeparator />
                          {booking.status === "pending" && (
                            <DropdownMenuItem className="text-primary" disabled={isMutating} onClick={() => requestConfirmBooking(booking)}>
                              <CheckCircle className="w-4 h-4 mr-2" /> Confirm Booking
                            </DropdownMenuItem>
                          )}
                          {booking.status !== "cancelled" && (
                            <DropdownMenuItem onClick={() => openReschedule(booking)}>
                              <CalendarClock className="w-4 h-4 mr-2" /> Reschedule
                            </DropdownMenuItem>
                          )}
                          {booking.status !== "cancelled" && (
                            <DropdownMenuItem className="text-destructive" disabled={isMutating} onClick={() => requestCancelBooking(booking)}>
                              <XCircle className="w-4 h-4 mr-2" /> Cancel Booking
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <Link
                  href={`/clients/${booking.clientId}`}
                  className="group/client-card -ml-1 inline-flex min-w-0 max-w-full items-center gap-3 rounded-xl p-1 pr-10 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/35 text-xs font-semibold text-muted-foreground transition-colors group-hover/client-card:border-primary/30 group-hover/client-card:bg-primary/10 group-hover/client-card:text-primary">
                    {initials(booking.clientName)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[17px] font-semibold leading-tight text-foreground transition-colors group-hover/client-card:text-primary">{booking.clientName}</span>
                    <span className="mt-1 block truncate text-[13px] text-muted-foreground">{booking.clientPhone || "No phone"}</span>
                  </span>
                </Link>

                <div className="mt-6 flex min-w-0 items-center gap-2">
                  <Link
                    href={`/services/${booking.serviceId}`}
                    className="truncate rounded-md text-[13px] font-semibold uppercase text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {booking.serviceName}
                  </Link>
                  {booking.staffId ? (
                    <Link
                      href={`/staff/${booking.staffId}`}
                      className="min-w-0 truncate rounded-md text-[13px] text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {booking.staffName}
                    </Link>
                  ) : (
                    <p className="min-w-0 truncate text-[13px] text-muted-foreground">Unassigned</p>
                  )}
                  <BookingStatusBadge status={booking.status} className="shrink-0 border-0" />
                </div>

                <div className="mt-6 grid grid-cols-[1fr_auto] items-end gap-4 pb-6">
                  <div className="min-w-0">
                    <Link
                      href={`/calendar?date=${format(new Date(booking.startTime), "yyyy-MM-dd")}&view=day`}
                      className="inline-flex max-w-full flex-col rounded-lg outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="text-[11px] font-medium uppercase text-muted-foreground">
                        {format(new Date(booking.startTime), "EEE")} · {format(new Date(booking.startTime), "d MMM")}
                      </span>
                      <span className="mt-1 text-2xl font-semibold leading-none text-foreground transition-colors hover:text-primary">
                        {format(new Date(booking.startTime), "h:mm a")}
                      </span>
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-medium uppercase text-muted-foreground">Amount</p>
                    <p className="mt-1 text-[18px] font-semibold leading-none text-foreground">{formatCurrency(booking.totalAmount)}</p>
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/50 pt-5 text-xs text-muted-foreground">
                  <span>{booking.depositPaid ? "Deposit paid" : "Deposit outstanding"}</span>
                  <span>Ends {format(new Date(booking.endTime), "h:mm a")}</span>
                </div>
              </div>
            </Card>
          ))
        )}
        
      </div>
      ) : null}

      <EntityListPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        totalCount={filtered.length}
        pageSize={PAGE_SIZE}
        itemLabel="bookings"
      />

      {/* Reschedule booking */}
      <Dialog open={!!rescheduleBookingTarget} onOpenChange={(open) => !open && setRescheduleBookingTarget(null)}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reschedule booking</DialogTitle>
            <DialogDescription>
              Choose a new available time for {rescheduleBookingTarget?.clientName}'s appointment. The client will be notified via WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <BookingCalendarGrid
              month={rescheduleMonth}
              onMonthChange={setRescheduleMonth}
              selectedDate={rescheduleDate}
              onSelectDate={handleSelectRescheduleDate}
              isDateSelectable={(iso) => iso >= toIsoDate(new Date())}
              primaryColor="hsl(var(--primary))"
              radiusCss="var(--radius)"
              tone="app"
            />

            {rescheduleDate && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Available times</Label>
                <BookingSlotPicker
                  slots={rescheduleSlots}
                  selectedSlot={rescheduleSlot}
                  onSelect={setRescheduleSlot}
                  loading={rescheduleSlotsLoading}
                  error={rescheduleSlotsError}
                  primaryColor="hsl(var(--primary))"
                  radiusCss="var(--radius)"
                  tone="app"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setRescheduleBookingTarget(null)}
              disabled={rescheduleBookingMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={handleReschedule}
              disabled={rescheduleBookingMutation.isPending || !rescheduleSlot}
            >
              {rescheduleBookingMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save new time
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}>
        <DialogContent className="w-[95vw] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setConfirmation(null)}
              disabled={isMutating}
            >
              Go back
            </Button>
            <Button
              variant={confirmation?.tone === "danger" ? "destructive" : "default"}
              className="w-full sm:w-auto"
              disabled={isMutating}
              onClick={() => {
                const action = confirmation?.onConfirm;
                setConfirmation(null);
                action?.();
              }}
            >
              {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {confirmation?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export bookings */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Export bookings</DialogTitle>
            <DialogDescription>Choose which bookings to include in the CSV export.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={exportFilters.status}
                onValueChange={(v) => setExportFilters((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>From date</Label>
                <Input
                  type="date"
                  value={exportFilters.dateFrom}
                  onChange={(e) => setExportFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>To date</Label>
                <Input
                  type="date"
                  value={exportFilters.dateTo}
                  onChange={(e) => setExportFilters((f) => ({ ...f, dateTo: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Staff member</Label>
              <Select
                value={exportFilters.staffId}
                onValueChange={(v) => setExportFilters((f) => ({ ...f, staffId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  {(staff ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Service</Label>
              <Select
                value={exportFilters.serviceId}
                onValueChange={(v) => setExportFilters((f) => ({ ...f, serviceId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Services</SelectItem>
                  {(services ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="w-full sm:w-auto" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
