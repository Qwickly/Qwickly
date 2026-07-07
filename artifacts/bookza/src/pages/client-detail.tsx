import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, fetchClientProfile, updateClient, deleteClient } from "@/lib/catalog";
import { sendWhatsappMessage } from "@/lib/whatsapp-notify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClientFormFields, type ClientFormValue } from "@/components/clients/ClientFormFields";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Phone, Mail, MessageSquare, Bot, AlertTriangle, Sparkles, Edit, Trash2, TrendingUp, MoreHorizontal, CalendarClock, CreditCard, ClipboardList, Ban } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";

export default function ClientDetailPage({ id }: { id: string }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.client(id),
    queryFn: () => fetchClientProfile(id),
    enabled: Boolean(id),
  });
  const insights: Array<{ id: string; type: "positive" | "warning" | "opportunity" | "neutral"; text: string }> = [];

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
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
      toast({ title: "Client updated" });
      setEditOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Could not update client",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteClient(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.clients });
      toast({ title: "Client deleted", description: "The client has been permanently removed." });
      setDeleteOpen(false);
      navigate("/clients");
    },
    onError: (err) => {
      toast({
        title: "Could not delete client",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const notesMutation = useMutation({
    mutationFn: (value: string) => updateClient(id, { notes: value || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.client(id) });
      toast({ title: "Notes saved" });
    },
    onError: (err) => {
      toast({
        title: "Could not save notes",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const messageMutation = useMutation({
    mutationFn: (value: string) => sendWhatsappMessage(profile?.client.phone ?? "", value),
    onSuccess: () => {
      toast({ title: "Message sent" });
      setMessageOpen(false);
      setMessageText("");
    },
    onError: (err) => {
      toast({
        title: "Could not send message",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) return <div>Client not found</div>;

  const { client, recentBookings, payments } = profile;
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;
  const completedBookings = recentBookings.filter((booking) => booking.status === "completed").length;
  const cancelledOrNoShow = recentBookings.filter((booking) => booking.status === "cancelled" || booking.status === "no_show").length;
  const upcomingBooking = recentBookings
    .filter((booking) => new Date(booking.startTime).getTime() > Date.now() && booking.status !== "cancelled")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize shadow-none";
  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed": return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "pending": return "border-amber-200 bg-amber-50 text-amber-700";
      case "completed": return "border-primary/20 bg-primary/10 text-primary";
      case "cancelled": return "border-[#f4c7cd] bg-[#fff1f3] text-[#c83d4b]";
      case "no_show": return "border-slate-200 bg-slate-100 text-slate-600";
      default: return "border-slate-200 bg-slate-50 text-slate-600";
    }
  };
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
        <DropdownMenuItem className="text-[#c83d4b] focus:text-[#c83d4b]" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete client
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/clients">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Clients
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Button
              className="bg-primary text-white hover:bg-primary/90"
              onClick={() => {
                setMessageText("");
                setMessageOpen(true);
              }}
            >
              <MessageSquare className="w-4 h-4 mr-2" /> Message
            </Button>
            {actionsMenu}
          </div>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16 border">
            <AvatarImage src={client.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">
              {client.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{client.name}</h1>
              <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-primary">
                {client.clientType.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Phone className="h-4 w-4 text-primary/60" />{client.phone}</span>
              <span className="flex items-center gap-1.5"><Mail className="h-4 w-4 text-primary/60" />{client.email || "No email"}</span>
              <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-primary/60" />Client since {format(new Date(client.createdAt), "MMM yyyy")}</span>
            </div>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
          {[
            { label: "Total spent", value: client.totalSpent > 0 ? formatCurrency(client.totalSpent) : "No spend yet", empty: client.totalSpent === 0, icon: CreditCard },
            { label: "Completed bookings", value: completedBookings > 0 ? completedBookings.toString() : "None yet", empty: completedBookings === 0, icon: ClipboardList },
            { label: "Upcoming booking", value: upcomingBooking ? format(new Date(upcomingBooking.startTime), "MMM d, h:mm a") : "None scheduled", empty: !upcomingBooking, icon: CalendarClock },
            { label: "Cancels / no-shows", value: cancelledOrNoShow > 0 ? cancelledOrNoShow.toString() : "None", empty: cancelledOrNoShow === 0, icon: Ban },
          ].map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="flex flex-col gap-1 bg-card p-3.5 sm:gap-1.5 sm:p-5">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <p className="truncate text-[10px] font-medium uppercase tracking-wider sm:text-[11px]">{metric.label}</p>
                </div>
                <p className={`truncate font-semibold ${metric.empty ? "text-sm text-muted-foreground/70 sm:text-sm" : "text-base text-foreground sm:text-lg"}`}>{metric.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      {insights && insights.length > 0 && (
        <Card className="relative overflow-hidden border border-primary/20 bg-primary/5 shadow-none">
          <div className="absolute right-0 top-0 p-4 opacity-10">
            <Bot className="h-24 w-24" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" /> AI Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="relative z-10 space-y-3">
            {insights.map(insight => (
              <div key={insight.id} className="flex gap-3 rounded-lg border border-border/50 bg-card p-3 shadow-sm">
                {insight.type === "positive" && <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />}
                {insight.type === "warning" && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />}
                {insight.type === "opportunity" && <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />}
                {insight.type === "neutral" && <Bot className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                <p className="text-sm font-medium">{insight.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-lg">Booking History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentBookings.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No booking history found for this client.</div>
            ) : (
              <div>
                <div className="hidden grid-cols-[1fr_1.2fr_1fr_0.8fr_0.7fr] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:grid">
                  <span>Date</span>
                  <span>Service</span>
                  <span>Staff</span>
                  <span>Status</span>
                  <span className="text-right">Amount</span>
                </div>

                <div className="divide-y divide-border/50 md:hidden">
                  {recentBookings.map((booking) => (
                    <div key={booking.id} className="flex items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{booking.serviceName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{format(new Date(booking.startTime), "MMM d, yyyy")} at {format(new Date(booking.startTime), "h:mm a")}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{booking.staffName}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge variant="outline" className={`${statusBadgeClass} ${getStatusColor(booking.status)}`}>
                          {booking.status.replace("_", " ")}
                        </Badge>
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(booking.totalAmount)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden divide-y divide-border/50 md:block">
                  {recentBookings.map((booking) => (
                    <div key={booking.id} className="grid gap-4 px-5 py-4 text-sm md:grid-cols-[1fr_1.2fr_1fr_0.8fr_0.7fr] md:items-center">
                    <div>
                      <p className="font-medium text-foreground">{format(new Date(booking.startTime), "MMM d, yyyy")}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(booking.startTime), "h:mm a")}</p>
                    </div>
                    <p className="font-medium text-foreground">{booking.serviceName}</p>
                    <p className="text-muted-foreground">{booking.staffName}</p>
                    <div>
                      <Badge variant="outline" className={`${statusBadgeClass} ${getStatusColor(booking.status)}`}>
                        {booking.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="font-semibold text-foreground md:text-right">{formatCurrency(booking.totalAmount)}</p>
                  </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-lg">Payments</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No payment history found.</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {payments.map(payment => (
                    <div key={payment.id} className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-semibold capitalize text-foreground">{payment.type.replace("_", " ")}</p>
                        <p className="truncate text-xs text-muted-foreground">{format(new Date(payment.date), "MMM d, yyyy")} • {payment.method}</p>
                      </div>
                      <span className="shrink-0 font-semibold">{formatCurrency(payment.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-lg">Private Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              <Textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Private notes about this client - preferences, allergies, reminders..."
                className="min-h-[180px] resize-y bg-muted/40"
              />
              <div className="flex justify-end">
                <Button
                  className="bg-primary hover:bg-primary/90"
                  disabled={notesMutation.isPending || notesDraft === (client.notes ?? "")}
                  onClick={() => notesMutation.mutate(notesDraft)}
                >
                  {notesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save notes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
            <DialogDescription>Update this client's profile details.</DialogDescription>
          </DialogHeader>
          <ClientFormFields value={form} onChange={setForm} />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              disabled={!form.name.trim() || !form.phone.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate(form)}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permanently delete {client.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the client. Clients with bookings or payments on record
              can&apos;t be deleted.
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
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
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
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
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
