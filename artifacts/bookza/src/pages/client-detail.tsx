import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, fetchClientProfile, updateClient, deleteClient } from "@/lib/catalog";
import { sendWhatsappMessage } from "@/lib/whatsapp-notify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ClientFormFields, type ClientFormValue } from "@/components/clients/ClientFormFields";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Phone, Mail, MessageSquare, Bot, AlertTriangle, Sparkles, Edit, Trash2, TrendingUp } from "lucide-react";
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

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/clients">
            <Button variant="outline" size="icon" className="h-9 w-9 bg-card">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              {client.name}
              <Badge variant="outline" className="uppercase text-[10px] tracking-wider">{client.clientType.replace(/_/g, ' ')}</Badge>
            </h1>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="bg-card"
            onClick={() => {
              setMessageText("");
              setMessageOpen(true);
            }}
          >
            <MessageSquare className="w-4 h-4 mr-2" /> Message
          </Button>
          <Button
            className="bg-primary hover:bg-primary/90"
            onClick={() => {
              setForm({
                name: client.name,
                phone: client.phone,
                email: client.email ?? "",
                clientType: client.clientType,
                notes: client.notes ?? "",
              });
              setEditOpen(true);
            }}
          >
            <Edit className="w-4 h-4 mr-2" /> Edit Profile
          </Button>
          <Button
            variant="outline"
            className="bg-card text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-sm border-border/50 md:col-span-1 h-fit">
          <CardContent className="p-6">
            <div className="flex flex-col items-center text-center pb-6 border-b border-border/50">
              <Avatar className="w-24 h-24 mb-4 border-2 border-border shadow-sm">
                <AvatarImage src={client.avatarUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-2xl font-semibold">
                  {client.name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <h2 className="text-xl font-bold">{client.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">Client since {format(new Date(client.createdAt), "MMM yyyy")}</p>
            </div>
            
            <div className="py-6 space-y-4 border-b border-border/50">
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{client.phone}</span>
              </div>
              {client.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span>{client.email}</span>
                </div>
              )}
            </div>

            <div className="pt-6 grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Spent</p>
                <p className="text-xl font-bold text-foreground">{formatCurrency(client.totalSpent)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Bookings</p>
                <p className="text-xl font-bold text-foreground">{client.lifetimeBookings}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          {insights && insights.length > 0 && (
            <Card className="border border-primary/20 bg-primary/5 shadow-none relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Bot className="w-24 h-24" />
              </div>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" /> AI Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 relative z-10">
                {insights.map(insight => (
                  <div key={insight.id} className="flex gap-3 bg-card p-3 rounded-lg border border-border/50 shadow-sm">
                    {insight.type === 'positive' && <Sparkles className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />}
                    {insight.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
                    {insight.type === 'opportunity' && <TrendingUp className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />}
                    {insight.type === 'neutral' && <Bot className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />}
                    <p className="text-sm font-medium">{insight.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="bookings" className="w-full">
            <TabsList className="w-full grid grid-cols-3 bg-card shadow-sm border border-border/50">
              <TabsTrigger value="bookings">Booking History</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="notes">Private Notes</TabsTrigger>
            </TabsList>
            
            <TabsContent value="bookings" className="mt-4 m-0 space-y-4">
              {recentBookings.length === 0 ? (
                <div className="p-8 border border-dashed rounded-lg bg-card/50 text-center text-muted-foreground">
                  No booking history found for this client.
                </div>
              ) : (
                recentBookings.map(booking => (
                  <Card key={booking.id} className="shadow-sm border-border/50">
                    <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-muted flex flex-col items-center justify-center border text-center shrink-0">
                          <span className="text-xs font-bold text-muted-foreground leading-none">{format(new Date(booking.startTime), "MMM")}</span>
                          <span className="text-lg font-bold leading-tight">{format(new Date(booking.startTime), "d")}</span>
                        </div>
                        <div>
                          <h4 className="font-semibold">{booking.serviceName}</h4>
                          <p className="text-sm text-muted-foreground">with {booking.staffName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 w-full sm:w-auto">
                        <Badge variant="outline" className="capitalize ml-auto sm:ml-0">
                          {booking.status.replace('_', ' ')}
                        </Badge>
                        <span className="font-bold whitespace-nowrap">{formatCurrency(booking.totalAmount)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
            
            <TabsContent value="payments" className="mt-4 m-0 space-y-4">
              {payments.length === 0 ? (
                <div className="p-8 border border-dashed rounded-lg bg-card/50 text-center text-muted-foreground">
                  No payment history found.
                </div>
              ) : (
                payments.map(payment => (
                  <Card key={payment.id} className="shadow-sm border-border/50">
                    <CardContent className="p-4 flex justify-between items-center">
                      <div>
                        <h4 className="font-semibold capitalize">{payment.type.replace('_', ' ')}</h4>
                        <p className="text-sm text-muted-foreground">{format(new Date(payment.date), "MMM d, yyyy")} • {payment.method}</p>
                      </div>
                      <span className="font-bold">{formatCurrency(payment.amount)}</span>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
            
            <TabsContent value="notes" className="mt-4 m-0 space-y-4">
              <Card className="shadow-sm border-border/50">
                <CardContent className="p-4 space-y-3">
                  <Textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Private notes about this client — preferences, allergies, reminders…"
                    className="min-h-[180px] resize-y bg-amber-50/30 dark:bg-amber-950/20"
                  />
                  <div className="flex justify-end">
                    <Button
                      className="bg-primary hover:bg-primary/90"
                      disabled={notesMutation.isPending || notesDraft === (client.notes ?? "")}
                      onClick={() => notesMutation.mutate(notesDraft)}
                    >
                      {notesMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Notes"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
            <DialogDescription>Update this client's profile details.</DialogDescription>
          </DialogHeader>
          <ClientFormFields value={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              disabled={!form.name.trim() || !form.phone.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate(form)}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete {client.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the client. Clients with bookings or payments on record
              can&apos;t be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="max-w-md">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setMessageOpen(false)}>Cancel</Button>
            <Button
              className="bg-primary hover:bg-primary/90"
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
