import { useState } from "react";
import { useSearch } from "wouter";
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
import { NewBookingDialog } from "@/components/booking/NewBookingDialog";
import { downloadCsv, rowsToCsv } from "@/lib/csv";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { Search, Plus, Loader2, MoreHorizontal, CheckCircle, XCircle, CalendarClock, Eye, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { BookingTableSkeleton, BookingCardListSkeleton } from "@/components/skeletons/booking-skeleton";

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

export default function BookingsPage() {
  const queryString = useSearch();
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState(
    () => new URLSearchParams(queryString).get("q") ?? "",
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [viewBooking, setViewBooking] = useState<any>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState(emptyExportFilters);
  const [rescheduleBookingTarget, setRescheduleBookingTarget] = useState<any>(null);
  const [rescheduleMonth, setRescheduleMonth] = useState<Date>(new Date());
  const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
  const [rescheduleSlot, setRescheduleSlot] = useState<BookingSlot | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
      toast({ title: "Booking confirmed" });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Could not confirm booking",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: (id: string) => cancelBooking(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog", "bookings"] });
      toast({ title: "Booking cancelled" });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Could not cancel booking",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
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
      toast({
        title: "Booking rescheduled",
        description: updated.clientPhone
          ? "The client will be notified via WhatsApp."
          : "No phone number on file — the client was not notified.",
      });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Could not reschedule booking",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
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
      toast({
        title: "Choose a date and time",
        description: "Please select an available slot first.",
        variant: "destructive",
      });
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
      onConfirm: () =>
        confirmBookingMutation.mutate(booking.id, {
          onSuccess: () => setViewBooking((current: any) => (current?.id === booking.id ? null : current)),
        }),
    });
  };

  const requestCancelBooking = (booking: any) => {
    setConfirmation({
      title: "Cancel this booking?",
      description: `Cancel ${booking.clientName}'s ${booking.serviceName} booking for ${format(new Date(booking.startTime), "EEEE, MMM d")} at ${format(new Date(booking.startTime), "h:mm a")}.`,
      confirmLabel: "Cancel booking",
      tone: "danger",
      onConfirm: () =>
        cancelBookingMutation.mutate(booking.id, {
          onSuccess: () => setViewBooking((current: any) => (current?.id === booking.id ? null : current)),
        }),
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
      toast({
        title: "Nothing to export",
        description: "There are no bookings matching the filters you selected.",
        variant: "destructive",
      });
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
    toast({
      title: "Export ready",
      description: `Downloaded ${toExport.length} booking${toExport.length === 1 ? "" : "s"}.`,
    });
    setExportDialogOpen(false);
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case "confirmed": return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "pending":   return "border-amber-200 bg-amber-50 text-amber-700";
      case "cancelled": return "border-[#f4c7cd] bg-[#fff1f3] text-[#c83d4b]";
      case "completed": return "border-primary/20 bg-primary/10 text-primary";
      case "no_show":   return "border-slate-200 bg-slate-100 text-slate-600";
      default:          return "border-slate-200 bg-slate-50 text-slate-600";
    }
  };

  const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize shadow-none";

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Bookings</h1>
          <p className="text-muted-foreground text-sm">View and manage all customer appointments.</p>
        </div>
        <div className="flex w-full flex-col items-center gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" className="w-full bg-card sm:w-auto" onClick={openExportDialog}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button className="w-full shrink-0 bg-primary hover:bg-primary/90 sm:w-auto" onClick={() => setNewBookingOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by client, service, or staff…" className="pl-9 bg-card w-full" value={search} onChange={e => handleSearchChange(e.target.value)} />
        </div>
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-full sm:w-[160px] bg-card">
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

      <Card className="hidden border-border/50 shadow-sm md:block">
        <div className="overflow-x-auto px-2 pb-2">
          <Table className="border-separate border-spacing-y-2">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <BookingTableSkeleton rows={6} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center text-muted-foreground">
                    No bookings found.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((booking) => (
                  <TableRow
                    key={booking.id}
                    className="cursor-pointer bg-card transition-colors hover:bg-muted/50 [&_td]:border-y [&_td]:border-border/50 [&_td]:py-5 [&_td:first-child]:rounded-l-xl [&_td:first-child]:border-l [&_td:last-child]:rounded-r-xl [&_td:last-child]:border-r"
                    onClick={() => setViewBooking(booking)}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{booking.clientName}</span>
                        <span className="text-xs text-muted-foreground">{booking.clientPhone || "No phone"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{booking.serviceName}</TableCell>
                    <TableCell className="text-muted-foreground">{booking.staffName}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{format(new Date(booking.startTime), "MMM d, yyyy")}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(booking.startTime), "h:mm a")}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(statusBadgeClass, getStatusColor(booking.status))}>
                        {booking.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(booking.totalAmount)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewBooking(booking)}>
                            <Eye className="w-4 h-4 mr-2" /> View Details
                          </DropdownMenuItem>
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
                              className="text-rose-600"
                              disabled={isMutating}
                              onClick={() => requestCancelBooking(booking)}
                            >
                              <XCircle className="w-4 h-4 mr-2" /> Cancel Booking
                            </DropdownMenuItem>
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
        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}-
              {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} bookings
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => p - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      className="w-8 h-8"
                      onClick={() => setCurrentPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => p + 1)}
                disabled={currentPage === totalPages}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Mobile Card List */}
      <div className="md:hidden flex flex-col gap-4">
        {isLoading ? (
          <BookingCardListSkeleton count={4} />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground bg-card rounded-xl border border-border/50">
            No bookings found.
          </div>
        ) : (
          paginated.map((booking) => (
            <Card
              key={booking.id}
              className="relative overflow-hidden border-border/60 bg-card shadow-sm transition-all duration-200 active:scale-[0.99] active:bg-muted/40"
              onClick={() => setViewBooking(booking)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setViewBooking(booking);
                }
              }}
            >
              <div className="space-y-4 p-4 pr-14">
                <div
                  className="absolute right-3 top-3"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:bg-emerald-50 hover:text-primary">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Booking actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setViewBooking(booking)}>
                        <Eye className="w-4 h-4 mr-2" /> View Details
                      </DropdownMenuItem>
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
                        <DropdownMenuItem className="text-rose-600" disabled={isMutating} onClick={() => requestCancelBooking(booking)}>
                          <XCircle className="w-4 h-4 mr-2" /> Cancel Booking
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg leading-tight">{booking.clientName}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{booking.clientPhone || "No phone"}</p>
                  </div>
                  <Badge variant="outline" className={cn(statusBadgeClass, "shrink-0", getStatusColor(booking.status))}>
                    {booking.status.replace("_", " ")}
                  </Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm bg-muted/30 p-3 rounded-lg border border-border/50">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Service</p>
                    <p className="font-medium">{booking.serviceName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Staff</p>
                    <p className="font-medium">{booking.staffName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Date</p>
                    <p className="font-medium">{format(new Date(booking.startTime), "MMM d, yyyy")}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Time</p>
                    <p className="font-medium">{format(new Date(booking.startTime), "h:mm a")}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="font-bold text-lg text-primary">{formatCurrency(booking.totalAmount)}</div>
                </div>
              </div>
            </Card>
          ))
        )}
        
        {filtered.length > 0 && (
          <div className="flex flex-col items-center gap-3 pt-2 pb-4">
            <p className="text-xs text-muted-foreground">
              Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}-
              {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2 w-full justify-between">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setCurrentPage((p) => p - 1)} disabled={currentPage === 1}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <div className="text-sm font-medium px-4">
                {currentPage} / {totalPages}
              </div>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setCurrentPage((p) => p + 1)} disabled={currentPage === totalPages}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* View booking detail modal */}
      <Dialog open={!!viewBooking} onOpenChange={() => setViewBooking(null)}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>Full information for this appointment.</DialogDescription>
          </DialogHeader>
          {viewBooking && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-muted-foreground text-xs mb-1">Client</p><p className="font-semibold">{viewBooking.clientName}</p></div>
                <div><p className="text-muted-foreground text-xs mb-1">Phone</p><p className="font-medium">{viewBooking.clientPhone || "—"}</p></div>
                <div><p className="text-muted-foreground text-xs mb-1">Service</p><p className="font-medium">{viewBooking.serviceName}</p></div>
                <div><p className="text-muted-foreground text-xs mb-1">Staff</p><p className="font-medium">{viewBooking.staffName}</p></div>
                <div><p className="text-muted-foreground text-xs mb-1">Date</p><p className="font-medium">{format(new Date(viewBooking.startTime), "EEEE, MMM d yyyy")}</p></div>
                <div><p className="text-muted-foreground text-xs mb-1">Time</p><p className="font-medium">{format(new Date(viewBooking.startTime), "h:mm a")} – {format(new Date(viewBooking.endTime), "h:mm a")}</p></div>
                <div><p className="text-muted-foreground text-xs mb-1">Status</p>
                  <Badge variant="outline" className={cn(statusBadgeClass, getStatusColor(viewBooking.status))}>
                    {viewBooking.status.replace("_", " ")}
                  </Badge>
                </div>
                <div><p className="text-muted-foreground text-xs mb-1">Amount</p><p className="font-bold text-primary">{formatCurrency(viewBooking.totalAmount)}</p></div>
              </div>
              {viewBooking.notes && (
                <div className="p-3 bg-muted/50 rounded-lg border text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p>{viewBooking.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            {viewBooking?.status === "pending" && (
              <Button
                className="w-full bg-primary text-white hover:bg-primary/90 sm:w-auto"
                disabled={isMutating}
                onClick={() => requestConfirmBooking(viewBooking)}
              >
                {confirmBookingMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Confirm booking
              </Button>
            )}
            {viewBooking?.status !== "cancelled" && (
              <Button
                className="w-full bg-[#dc4c5a] text-white hover:bg-[#c83d4b] sm:w-auto"
                disabled={isMutating}
                onClick={() => requestCancelBooking(viewBooking)}
              >
                {cancelBookingMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Cancel booking
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setRescheduleBookingTarget(null)}
              disabled={rescheduleBookingMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="w-full bg-primary text-white hover:bg-primary/90 sm:w-auto"
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
          <DialogFooter className="mt-4 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setConfirmation(null)}
              disabled={isMutating}
            >
              Go back
            </Button>
            <Button
              className={cn(
                "w-full text-white sm:w-auto",
                confirmation?.tone === "danger"
                  ? "bg-[#dc4c5a] hover:bg-[#c83d4b]"
                  : "bg-primary hover:bg-primary/90",
              )}
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

      <NewBookingDialog open={newBookingOpen} onOpenChange={setNewBookingOpen} />

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

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="w-full sm:w-auto bg-primary hover:bg-primary/90" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
