import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelBooking,
  catalogKeys,
  confirmBooking,
  createBooking,
  fetchBookings,
  fetchClients,
  fetchServices,
  fetchStaff,
} from "@/lib/catalog";
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
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Search, Plus, Loader2, MoreHorizontal, CheckCircle, XCircle, CalendarClock, Eye, MessageSquare, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const emptyBookingForm = () => ({
  clientId: "",
  serviceId: "",
  staffId: "",
  date: format(new Date(), "yyyy-MM-dd"),
  time: "09:00",
  notes: "",
});

const PAGE_SIZE = 10;

const emptyExportFilters = () => ({
  status: "all",
  dateFrom: "",
  dateTo: "",
  staffId: "all",
  serviceId: "all",
});

export default function BookingsPage() {
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewBooking, setViewBooking] = useState<any>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState(emptyBookingForm);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState(emptyExportFilters);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: clientsData } = useQuery({
    queryKey: catalogKeys.clients,
    queryFn: () => fetchClients(1, 100),
  });
  const clients = clientsData?.clients ?? [];

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });

  const createBookingMutation = useMutation({
    mutationFn: createBooking,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["catalog", "bookings"] });
      toast({ title: "Booking created", description: "The appointment has been added." });
      setNewBookingOpen(false);
      setBookingForm(emptyBookingForm());
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Could not create booking",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
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

  const isMutating = confirmBookingMutation.isPending || cancelBookingMutation.isPending;
  const { data: bookings, isLoading } = useQuery({
    queryKey: catalogKeys.bookings(),
    queryFn: () => fetchBookings(),
  });

  const creatingBooking = createBookingMutation.isPending;

  const openNewBooking = () => {
    setBookingForm(emptyBookingForm());
    setNewBookingOpen(true);
  };

  const handleStatusChange = (next: string) => {
    setStatus(next);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
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

    const start = new Date(`${bookingForm.date}T${bookingForm.time}:00`);
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
    } catch {
      // The mutation onError handler already shows the toast.
    }
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
      case "confirmed": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800";
      case "pending":   return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800";
      case "cancelled": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800";
      case "completed": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800";
      case "no_show":   return "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700";
      default:          return "bg-gray-100 text-gray-800";
    }
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const statusCounts = {
    all: bookings?.length ?? 0,
    confirmed: bookings?.filter(b => b.status === "confirmed").length ?? 0,
    pending: bookings?.filter(b => b.status === "pending").length ?? 0,
    completed: bookings?.filter(b => b.status === "completed").length ?? 0,
    cancelled: bookings?.filter(b => b.status === "cancelled").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Bookings</h1>
          <p className="text-muted-foreground text-sm">View and manage all customer appointments.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="bg-card" onClick={openExportDialog}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button className="shrink-0 bg-primary hover:bg-primary/90" onClick={openNewBooking}>
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(["all", "confirmed", "pending", "completed", "cancelled"] as const).map(s => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            className={cn(
              "p-3 rounded-lg border text-left transition-all",
              status === s ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card border-border/50 hover:border-primary/30"
            )}
          >
            <div className={cn("text-xl font-bold", status === s ? "" : "text-foreground")}>{statusCounts[s]}</div>
            <div className={cn("text-xs capitalize mt-0.5", status === s ? "text-primary-foreground/80" : "text-muted-foreground")}>{s === "all" ? "All Bookings" : s}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by client, service, or staff…" className="pl-9 bg-card" value={search} onChange={e => handleSearchChange(e.target.value)} />
        </div>
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[160px] bg-card">
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

      <Card className="shadow-sm border-border/50">
        <div className="overflow-x-auto">
          <Table>
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
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center text-muted-foreground">
                    No bookings found.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((booking) => (
                  <TableRow key={booking.id} className="hover:bg-muted/50 transition-colors">
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
                      <Badge variant="outline" className={cn("capitalize rounded-sm", getStatusColor(booking.status))}>
                        {booking.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(booking.totalAmount)}
                    </TableCell>
                    <TableCell>
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
                          <DropdownMenuItem>
                            <MessageSquare className="w-4 h-4 mr-2" /> Message Client
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {booking.status === "pending" && (
                            <DropdownMenuItem
                              className="text-emerald-700"
                              disabled={isMutating}
                              onClick={() => confirmBookingMutation.mutate(booking.id)}
                            >
                              <CheckCircle className="w-4 h-4 mr-2" /> Confirm Booking
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem>
                            <CalendarClock className="w-4 h-4 mr-2" /> Reschedule
                          </DropdownMenuItem>
                          {booking.status !== "cancelled" && (
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={isMutating}
                              onClick={() => cancelBookingMutation.mutate(booking.id)}
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

      {/* View booking detail modal */}
      <Dialog open={!!viewBooking} onOpenChange={() => setViewBooking(null)}>
        <DialogContent className="max-w-md">
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
                  <Badge variant="outline" className={cn("capitalize rounded-sm text-xs", getStatusColor(viewBooking.status))}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewBooking(null)}>Close</Button>
            {viewBooking?.status === "pending" && (
              <Button
                className="bg-primary hover:bg-primary/90"
                disabled={isMutating}
                onClick={() =>
                  confirmBookingMutation.mutate(viewBooking.id, {
                    onSuccess: () => setViewBooking(null),
                  })
                }
              >
                {confirmBookingMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Confirm
              </Button>
            )}
            {viewBooking?.status !== "cancelled" && (
              <Button
                variant="destructive"
                disabled={isMutating}
                onClick={() =>
                  cancelBookingMutation.mutate(viewBooking.id, {
                    onSuccess: () => setViewBooking(null),
                  })
                }
              >
                {cancelBookingMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Cancel
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New booking */}
      <Dialog open={newBookingOpen} onOpenChange={setNewBookingOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New booking</DialogTitle>
            <DialogDescription>Schedule an appointment from the bookings list.</DialogDescription>
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
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} · {c.phone}
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
                onValueChange={(v) =>
                  setBookingForm((f) => ({ ...f, staffId: v === "none" ? "" : v }))
                }
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={bookingForm.date}
                  onChange={(e) => setBookingForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input
                  type="time"
                  value={bookingForm.time}
                  onChange={(e) => setBookingForm((f) => ({ ...f, time: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Any internal notes for this booking..."
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
            <Button className="bg-primary hover:bg-primary/90" onClick={handleCreateBooking} disabled={creatingBooking}>
              {creatingBooking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export bookings */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
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
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
