import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, fetchClientProfile, updateClient, deleteClient } from "@/lib/catalog";
import { sendWhatsappMessage } from "@/lib/whatsapp-notify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClientFormFields, type ClientFormValue } from "@/components/clients/ClientFormFields";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Phone, Mail, MessageSquare, Bot, AlertTriangle, Sparkles, Edit, Trash2, TrendingUp, MoreHorizontal, CalendarClock, CreditCard, ClipboardList, Ban, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { DetailPageSkeleton } from "@/components/skeletons/page-skeletons";
import { cn } from "@/lib/utils";
import { BookingStatusBadge, ClientTypeBadge } from "@/components/ui/status-badge";
import { PageEmptyState, InfoTile } from "@/components/layout/page-ui";
import { DetailHeroCard } from "@/components/layout/detail-page-ui";

type ClientDetailSection = "overview" | "bookings" | "payments" | "notes" | "settings";
type BookingStatusFilter = "all" | "upcoming" | "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
type BookingDateFilter = "all" | "today" | "this_week" | "this_month" | "last_30";
type BookingSort = "newest" | "oldest" | "highest_value";
type PaymentTypeFilter = "all" | "deposit" | "full_payment" | "refund" | "other";
type PaymentSort = "newest" | "oldest" | "highest_amount";

export default function ClientDetailPage({ id }: { id: string }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.client(id),
    queryFn: () => fetchClientProfile(id),
    enabled: Boolean(id),
  });
  const insights: Array<{ id: string; type: "positive" | "warning" | "opportunity" | "neutral"; text: string }> = [];

  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [activeSection, setActiveSection] = useState<ClientDetailSection>("overview");
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState<BookingStatusFilter>("all");
  const [bookingDateFilter, setBookingDateFilter] = useState<BookingDateFilter>("all");
  const [bookingSort, setBookingSort] = useState<BookingSort>("newest");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<PaymentTypeFilter>("all");
  const [paymentSort, setPaymentSort] = useState<PaymentSort>("newest");
  const [form, setForm] = useState<ClientFormValue>({
    name: "",
    phone: "",
    email: "",
    clientType: "new",
    notes: "",
  });

  // Seed the notes editor from the loaded client; re-syncs after a save refetches.
  const loadedNotes = profile?.client.notes ?? "";
  useEffect(() => {
    setNotesDraft(loadedNotes);
  }, [loadedNotes]);

  const updateMutation = useMutation({
    mutationFn: (value: ClientFormValue) =>
      updateClient(id, {
        name: value.name,
        phone: value.phone,
        email: value.email || null,
        clientType: value.clientType,
        notes: value.notes || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.client(id) });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.clients });
      toast("Client updated");
      setEditOpen(false);
    },
    onError: (err) => {
      toast.error("Could not update client", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.clients });
      toast("Client deleted", { description: "The client has been removed from the client list." });
      setDeleteOpen(false);
      navigate("/clients");
    },
    onError: (err) => {
      toast.error("Could not delete client", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  const notesMutation = useMutation({
    mutationFn: (value: string) => updateClient(id, { notes: value || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.client(id) });
      toast("Notes saved");
    },
    onError: (err) => {
      toast.error("Could not save notes", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  const messageMutation = useMutation({
    mutationFn: (value: string) => sendWhatsappMessage(profile?.client.phone ?? "", value),
    onSuccess: () => {
      toast("Message sent");
      setMessageOpen(false);
      setMessageText("");
    },
    onError: (err) => {
      toast.error("Could not send message", { description: err instanceof Error ? err.message : "Please try again." });
    },
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!profile) {
    return (
      <Card>
        <CardContent>
          <PageEmptyState title="Client not found" description="This client may have been removed." />
        </CardContent>
      </Card>
    );
  }

  const { client, recentBookings, payments } = profile;
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;
  const completedBookings = recentBookings.filter((booking) => booking.status === "completed").length;
  const cancelledOrNoShow = recentBookings.filter((booking) => booking.status === "cancelled" || booking.status === "no_show").length;
  const upcomingBooking = recentBookings
    .filter((booking) => new Date(booking.startTime).getTime() > Date.now() && booking.status !== "cancelled")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  const bookingMatchesDateFilter = (startTime: string) => {
    if (bookingDateFilter === "all") return true;

    const bookingDate = new Date(startTime);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfToday.getDate() + 1);

    if (bookingDateFilter === "today") {
      return bookingDate >= startOfToday && bookingDate < startOfTomorrow;
    }

    if (bookingDateFilter === "this_week") {
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      return bookingDate >= startOfWeek && bookingDate < endOfWeek;
    }

    if (bookingDateFilter === "this_month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return bookingDate >= startOfMonth && bookingDate < startOfNextMonth;
    }

    const last30Days = new Date(startOfToday);
    last30Days.setDate(startOfToday.getDate() - 30);
    return bookingDate >= last30Days;
  };
  const filteredBookings = recentBookings
    .filter((booking) => {
      const search = bookingSearch.trim().toLowerCase();
      const matchesSearch =
        !search ||
        booking.serviceName.toLowerCase().includes(search) ||
        booking.staffName.toLowerCase().includes(search);

      if (!matchesSearch || !bookingMatchesDateFilter(booking.startTime)) return false;
      if (bookingStatusFilter === "all") return true;
      if (bookingStatusFilter === "upcoming") {
        return (
          new Date(booking.startTime).getTime() > Date.now() &&
          !["cancelled", "no_show", "completed"].includes(booking.status)
        );
      }

      return booking.status === bookingStatusFilter;
    })
    .sort((a, b) => {
      if (bookingSort === "oldest") return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      if (bookingSort === "highest_value") return b.totalAmount - a.totalAmount;
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    });
  const filteredPayments = payments
    .filter((payment) => {
      const search = paymentSearch.trim().toLowerCase();
      const matchesSearch =
        !search ||
        payment.type.replace("_", " ").toLowerCase().includes(search) ||
        payment.method.toLowerCase().includes(search);
      const matchesType =
        paymentTypeFilter === "all" ||
        (paymentTypeFilter === "other" ? !["deposit", "full_payment", "refund"].includes(payment.type) : payment.type === paymentTypeFilter);

      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      if (paymentSort === "oldest") return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (paymentSort === "highest_amount") return b.amount - a.amount;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  const hasBookingFilters =
    Boolean(bookingSearch.trim()) || bookingStatusFilter !== "all" || bookingDateFilter !== "all" || bookingSort !== "newest";
  const hasPaymentFilters = Boolean(paymentSearch.trim()) || paymentTypeFilter !== "all" || paymentSort !== "newest";
  const clearBookingFilters = () => {
    setBookingSearch("");
    setBookingStatusFilter("all");
    setBookingDateFilter("all");
    setBookingSort("newest");
  };
  const clearPaymentFilters = () => {
    setPaymentSearch("");
    setPaymentTypeFilter("all");
    setPaymentSort("newest");
  };
  const sectionMeta: Array<{ value: ClientDetailSection; label: string; description: string }> = [
    { value: "overview", label: "Overview", description: "Client summary and activity" },
    { value: "bookings", label: "Bookings", description: "Booking history and filters" },
    { value: "payments", label: "Payments", description: "Payment history and filters" },
    { value: "notes", label: "Notes", description: "Private client notes" },
    { value: "settings", label: "Settings", description: "Message, edit, or delete" },
  ];
  const activeSectionIndex = sectionMeta.findIndex((section) => section.value === activeSection);
  const activeSectionMeta = sectionMeta[activeSectionIndex] ?? sectionMeta[0];
  const openEdit = () => {
    setForm({
      name: client.name,
      phone: client.phone,
      email: client.email ?? "",
      clientType: client.clientType,
      notes: client.notes ?? "",
    });
    setEditOpen(true);
  };
  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-10 w-10 bg-card">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Client actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={openEdit}>
          <Edit className="mr-2 h-4 w-4" />
          Edit profile
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete client
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">Client details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Name", value: client.name },
                  { label: "Phone", value: client.phone },
                  { label: "Email", value: client.email || "No email" },
                  { label: "Client type", value: client.clientType.replace(/_/g, " ") },
                  { label: "Client since", value: format(new Date(client.createdAt), "MMM d, yyyy") },
                ].map((item) => (
                  <InfoTile key={item.label}>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="mt-1 truncate text-sm font-semibold capitalize text-foreground">{item.value}</p>
                  </InfoTile>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">Client summary</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Total spent", value: client.totalSpent > 0 ? formatCurrency(client.totalSpent) : "No spend yet", icon: CreditCard },
                  { label: "Completed bookings", value: completedBookings > 0 ? completedBookings.toString() : "None yet", icon: ClipboardList },
                  { label: "Upcoming booking", value: upcomingBooking ? format(new Date(upcomingBooking.startTime), "MMM d, h:mm a") : "None scheduled", icon: CalendarClock },
                  { label: "Cancels / no-shows", value: cancelledOrNoShow > 0 ? cancelledOrNoShow.toString() : "None", icon: Ban },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <InfoTile key={item.label}>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                        <p className="truncate text-xs font-medium uppercase tracking-wider">{item.label}</p>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">{item.value}</p>
                    </InfoTile>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">Activity insight</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  {recentBookings.length > 0
                    ? `This client has completed ${completedBookings} bookings and has spent ${formatCurrency(client.totalSpent)}.${
                        upcomingBooking ? ` Their next booking is ${format(new Date(upcomingBooking.startTime), "MMM d, yyyy")} at ${format(new Date(upcomingBooking.startTime), "h:mm a")}.` : ""
                      }`
                    : "This client has no booking history yet."}
                </p>
                {insights.length > 0 && (
                  <InfoTile className="space-y-3 border-primary/20 bg-primary/5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" /> AI Insights
                    </div>
                    {insights.map((insight) => (
                      <InfoTile key={insight.id} className="flex gap-3">
                        {insight.type === "positive" && <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
                        {insight.type === "warning" && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400" />}
                        {insight.type === "opportunity" && <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />}
                        {insight.type === "neutral" && <Bot className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                        <p className="text-sm font-medium">{insight.text}</p>
                      </InfoTile>
                    ))}
                  </InfoTile>
                )}
              </CardContent>
            </Card>
          </div>
        );

      case "bookings":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Bookings</CardTitle>
                {recentBookings.length > 0 && (
                  <p className="text-sm text-muted-foreground">Showing {filteredBookings.length} of {recentBookings.length} bookings</p>
                )}
              </div>
              {recentBookings.length > 0 && (
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={bookingSearch}
                      onChange={(event) => setBookingSearch(event.target.value)}
                      placeholder="Search service or staff..."
                      className="w-full bg-card pl-9"
                    />
                  </div>
                  <Select value={bookingStatusFilter} onValueChange={(value) => setBookingStatusFilter(value as BookingStatusFilter)}>
                    <SelectTrigger className="w-full bg-card lg:w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no_show">No-show</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={bookingDateFilter} onValueChange={(value) => setBookingDateFilter(value as BookingDateFilter)}>
                    <SelectTrigger className="w-full bg-card lg:w-[150px]"><SelectValue placeholder="All time" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="this_week">This week</SelectItem>
                      <SelectItem value="this_month">This month</SelectItem>
                      <SelectItem value="last_30">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={bookingSort} onValueChange={(value) => setBookingSort(value as BookingSort)}>
                    <SelectTrigger className="w-full bg-card lg:w-[150px]"><SelectValue placeholder="Newest first" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="oldest">Oldest first</SelectItem>
                      <SelectItem value="highest_value">Highest value</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {recentBookings.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">No booking history found for this client.</div>
              ) : filteredBookings.length === 0 ? (
                <PageEmptyState
                  icon={CalendarClock}
                  title="No bookings match these filters."
                  actions={
                    <Button variant="outline" size="sm" className="bg-card" onClick={clearBookingFilters} disabled={!hasBookingFilters}>Clear filters</Button>
                  }
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredBookings.map((booking) => (
                    <div key={booking.id} className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1fr_1.2fr_1fr_0.8fr_0.7fr] md:items-center">
                      <div>
                        <p className="font-medium text-foreground">{format(new Date(booking.startTime), "MMM d, yyyy")}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(booking.startTime), "h:mm a")}</p>
                      </div>
                      <p className="font-medium text-foreground">{booking.serviceName}</p>
                      <p className="text-muted-foreground">{booking.staffName}</p>
                      <div>
                        <BookingStatusBadge status={booking.status} />
                      </div>
                      <p className="font-semibold text-foreground md:text-right">{formatCurrency(booking.totalAmount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "payments":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Payments</CardTitle>
                {payments.length > 0 && (
                  <p className="text-sm text-muted-foreground">Showing {filteredPayments.length} of {payments.length} payments</p>
                )}
              </div>
              {payments.length > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={paymentSearch}
                      onChange={(event) => setPaymentSearch(event.target.value)}
                      placeholder="Search payments..."
                      className="w-full bg-card pl-9"
                    />
                  </div>
                  <Select value={paymentTypeFilter} onValueChange={(value) => setPaymentTypeFilter(value as PaymentTypeFilter)}>
                    <SelectTrigger className="w-full bg-card sm:w-[160px]"><SelectValue placeholder="All types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="deposit">Deposit</SelectItem>
                      <SelectItem value="full_payment">Final payment</SelectItem>
                      <SelectItem value="refund">Refund</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={paymentSort} onValueChange={(value) => setPaymentSort(value as PaymentSort)}>
                    <SelectTrigger className="w-full bg-card sm:w-[160px]"><SelectValue placeholder="Newest first" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="oldest">Oldest first</SelectItem>
                      <SelectItem value="highest_amount">Highest amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">No payment history found.</div>
              ) : filteredPayments.length === 0 ? (
                <PageEmptyState
                  icon={CreditCard}
                  title="No payments match these filters."
                  actions={
                    <Button variant="outline" size="sm" className="bg-card" onClick={clearPaymentFilters} disabled={!hasPaymentFilters}>Clear filters</Button>
                  }
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredPayments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-semibold capitalize text-foreground">{payment.type.replace("_", " ")}</p>
                        <p className="truncate text-xs text-muted-foreground">{format(new Date(payment.date), "MMM d, yyyy")} - {payment.method}</p>
                      </div>
                      <span className="shrink-0 font-semibold">{formatCurrency(payment.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "notes":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-lg">Private notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Private notes about this client - preferences, allergies, reminders..."
                className="min-h-[220px] resize-y bg-muted/40"
              />
              <div className="flex justify-end">
                <Button
                  disabled={notesMutation.isPending || notesDraft === (client.notes ?? "")}
                  onClick={() => notesMutation.mutate(notesDraft)}
                >
                  {notesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save notes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );

      case "settings":
        return (
          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-lg">Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => {
                  setMessageText("");
                  setMessageOpen(true);
                }}
                className="rounded-xl border border-border/45 bg-muted/20 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <MessageSquare className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Message client</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Send this client a WhatsApp message.</p>
              </button>
              <button
                type="button"
                onClick={openEdit}
                className="rounded-xl border border-border/45 bg-muted/20 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <Edit className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold text-foreground">Edit client profile</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Update contact details, type, and notes.</p>
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-left transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="mb-3 h-5 w-5 text-destructive" />
                <p className="text-sm font-semibold text-destructive">Delete client</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Permanently remove this client if no records block deletion.</p>
              </button>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* This page hand-rolled DetailHeroCard's exact markup — back link, media,
          title, badges, meta row — while staff-detail and service-detail used
          the shared component. That is why its title was `text-2xl md:text-3xl`
          against their `text-3xl`, and why its hero drifted every time the
          shared one was touched. */}
      <DetailHeroCard
        backHref="/clients"
        backLabel="Clients"
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setMessageText("");
                setMessageOpen(true);
              }}
            >
              <MessageSquare className="mr-2 h-4 w-4" /> Message
            </Button>
            {actionsMenu}
          </div>
        }
        media={
          <Avatar className="h-16 w-16 border">
            <AvatarImage src={client.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">
              {client.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        }
        title={client.name}
        badges={<ClientTypeBadge client={client} />}
        metaItems={
          <>
            <span className="flex items-center gap-1.5"><Phone className="h-4 w-4 text-primary/60" />{client.phone}</span>
            <span className="flex items-center gap-1.5"><Mail className="h-4 w-4 text-primary/60" />{client.email || "No email"}</span>
            <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-primary/60" />Client since {format(new Date(client.createdAt), "MMM yyyy")}</span>
          </>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardContent>
            <div className="mb-3 px-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client sections</p>
            </div>
            <nav className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {sectionMeta.map((section, index) => {
                const selected = activeSection === section.value;
                return (
                  <button
                    key={section.value}
                    type="button"
                    onClick={() => setActiveSection(section.value)}
                    className={cn(
                      "min-w-0 rounded-lg border p-2 text-center transition-colors lg:p-3",
                      selected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                        selected ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="mt-2 block truncate text-xs font-medium sm:text-sm">{section.label}</span>
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        <InfoTile>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Section {activeSectionIndex + 1} of {sectionMeta.length}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{activeSectionMeta.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{activeSectionMeta.description}</p>
        </InfoTile>

        <div className="min-w-0">{renderSection()}</div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
            <DialogDescription>Update this client's profile details.</DialogDescription>
          </DialogHeader>
          <ClientFormFields value={form} onChange={setForm} />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto"
              disabled={!form.name.trim() || !form.phone.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate(form)}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {client.name} from the client list?</DialogTitle>
            <DialogDescription>
              This removes the client from the client list. Existing bookings and payments remain
              on record and will stay linked to your business history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Message {client.name}</DialogTitle>
            <DialogDescription>
              Send a WhatsApp message to {client.phone || "this client"}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type your message…"
            className="min-h-[120px] resize-y"
          />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setMessageOpen(false)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto"
              disabled={!messageText.trim() || !client.phone || messageMutation.isPending}
              onClick={() => messageMutation.mutate(messageText)}
            >
              {messageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



