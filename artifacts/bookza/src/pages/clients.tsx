import { useState, type ChangeEvent } from "react";
import { getGetWhatsappConversationsQueryKey, useGetWhatsappConversations, type WhatsappConversation } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, createClient, deleteClient, fetchClients, updateClient } from "@/lib/catalog";
import { sendWhatsappMessage } from "@/lib/whatsapp-notify";
import { parseClientCsvText, parseClientPdfText, type ParsedClientCsvRow } from "@/lib/csv";
import type { CatalogClient, ClientType } from "@/types/catalog";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientFormFields } from "@/components/clients/ClientFormFields";
import {
  Search,
  Plus,
  Loader2,
  Phone,
  Mail,
  Calendar,
  ChevronLeft,
  ChevronRight,
  UploadCloud,
  MoreHorizontal,
  Pencil,
  MessageSquare,
  Trash2,
  FileSpreadsheet,
  FileText,
  Download,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { EntityGridSkeleton } from "@/components/skeletons/entity-card-skeleton";

const PAGE_SIZE = 8;

export default function ClientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [parsedImportClients, setParsedImportClients] = useState<ParsedClientCsvRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [form, setForm] = useState({ name: "", phone: "", email: "", clientType: "new" as ClientType, notes: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogClient | null>(null);
  const [messageTarget, setMessageTarget] = useState<CatalogClient | null>(null);
  const [messageText, setMessageText] = useState("");
  const { data: clientsData, isLoading } = useQuery({
    queryKey: [...catalogKeys.clients, currentPage, filter, search],
    queryFn: () => fetchClients(currentPage, PAGE_SIZE, filter, search),
  });

  const { data: metaWhatsappConnected = false, isLoading: loadingMetaWhatsapp } = useQuery({
    queryKey: ["meta-whatsapp-connection"],
    queryFn: async () => {
      const businessId = await ensureBusiness();
      const { data, error } = await supabase
        .from("meta_whatsapp_connections")
        .select("id")
        .eq("business_id", businessId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return !!data;
    },
    staleTime: 60_000,
  });

  const clients = clientsData?.clients ?? [];
  const totalCount = clientsData?.totalCount ?? 0;
  const canManageClients = metaWhatsappConnected && !loadingMetaWhatsapp;
  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.clients }),
  });
  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; input: Parameters<typeof updateClient>[1] }) =>
      updateClient(vars.id, vars.input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.clients }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteClient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.clients }),
  });
  const messageMutation = useMutation({
    mutationFn: (vars: { phone: string; message: string }) =>
      sendWhatsappMessage(vars.phone, vars.message),
  });
  const [, navigate] = useLocation();

  const totalPages = Math.ceil(totalCount / 8);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter);
    setCurrentPage(1);
  };

  const handleSearchChange = (newSearch: string) => {
    setSearch(newSearch);
    setCurrentPage(1);
  };

  const resetImportState = () => {
    setImportFileName(null);
    setParsedImportClients([]);
    setImportErrors([]);
    setImportWarnings([]);
    setIsImporting(false);
  };

  // WhatsApp import state
  const [showWhatsappImport, setShowWhatsappImport] = useState(false);
  const [whatsappSearch, setWhatsappSearch] = useState("");
  const [whatsappSelectedIds, setWhatsappSelectedIds] = useState<number[]>([]);

  const { data: whatsappConversations = [], isLoading: loadingWhatsappConversations } = useGetWhatsappConversations({
    query: { queryKey: getGetWhatsappConversationsQueryKey(), refetchInterval: false },
    // only fetch when the import dialog is open (we enable by checking importDialogOpen below)
    enabled: importDialogOpen,
  });

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setImportFileName(file.name);
    const text = await file.text();
    const { clients, errors, warnings } = parseClientCsvText(text);
    setParsedImportClients(clients);
    setImportErrors(errors);
    setImportWarnings(warnings);
  };

  const handleImportPdfFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setImportFileName(file.name);
    setParsedImportClients([]);
    setImportErrors([]);
    setImportWarnings([]);

    try {
      const { extractPdfText } = await import("@/lib/pdf-import");
      const text = await extractPdfText(file);
      const { clients, errors, warnings } = parseClientPdfText(text);
      setParsedImportClients(clients);
      setImportErrors(errors);
      setImportWarnings(warnings);
    } catch (error) {
      setImportErrors([
        error instanceof Error ? error.message : "Could not read this PDF. Try exporting the customer list as CSV instead.",
      ]);
      setImportWarnings([]);
    }
  };

  const handleDownloadExtractedNumbers = () => {
    if (parsedImportClients.length === 0) return;

    const csv = `phone\r\n${parsedImportClients.map((client) => client.phone).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "extracted_numbers.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClients = async () => {
    if (parsedImportClients.length === 0) {
      toast({ title: "No clients to import", description: "Upload a CSV or PDF file with client rows first.", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const results = await Promise.allSettled(
        parsedImportClients.map((client) =>
          createClient({
            name: client.name,
            phone: client.phone,
            email: client.email ?? null,
            notes: client.notes ?? null,
            clientType: client.clientType ?? "new",
          }),
        ),
      );

      const successes = results.filter((result) => result.status === "fulfilled").length;
      const failures = results.filter((result) => result.status === "rejected");

      queryClient.invalidateQueries({ queryKey: catalogKeys.clients });

      if (failures.length === 0) {
        toast({ title: "Clients imported", description: `${successes} clients added successfully.` });
      } else if (successes === 0) {
        toast({ title: "Import failed", description: `Failed to import all ${parsedImportClients.length} rows.`, variant: "destructive" });
      } else {
        toast({
          title: "Partial import",
          description: `${successes} clients imported, ${failures.length} failed.`,
        });
      }

      setImportDialogOpen(false);
      resetImportState();
    } catch (error) {
      toast({
        title: "Could not import clients",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const emptyClientForm = { name: "", phone: "", email: "", clientType: "new" as ClientType, notes: "" };

  const openAddClient = () => {
    setForm(emptyClientForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEditClient = (client: CatalogClient) => {
    setForm({
      name: client.name,
      phone: client.phone,
      email: client.email ?? "",
      clientType: client.clientType,
      notes: client.notes ?? "",
    });
    setEditingId(client.id);
    setDialogOpen(true);
  };

  const handleSaveClient = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Name and phone are required", variant: "destructive" });
      return;
    }
    const input = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      clientType: form.clientType,
      notes: form.notes.trim() || null,
    };
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, input });
        toast({ title: "Client updated", description: `${input.name} has been saved.` });
      } else {
        await createMutation.mutateAsync(input);
        toast({ title: "Client added", description: `${input.name} has been saved.` });
      }
      setForm(emptyClientForm);
      setEditingId(null);
      setDialogOpen(false);
    } catch (err) {
      toast({
        title: editingId ? "Could not update client" : "Could not add client",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDeleteClient = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteMutation.mutateAsync(target.id);
      toast({ title: "Client deleted", description: `${target.name} has been removed from the client list.` });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete client",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = async () => {
    if (!messageTarget || !messageText.trim()) return;
    try {
      await messageMutation.mutateAsync({ phone: messageTarget.phone, message: messageText.trim() });
      toast({ title: "Message sent" });
      setMessageTarget(null);
      setMessageText("");
    } catch (err) {
      toast({
        title: "Could not send message",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const getClientTypeBadge = (client: CatalogClient) => {
    const effectiveType = client.status === "new"
      ? "new"
      : client.noShowCount >= 2
      ? "no_show_risk"
      : client.status;
    const map: Record<string, string> = {
      new: "border-sky-200 bg-sky-50 text-sky-700",
      returning: "border-emerald-200 bg-emerald-50 text-emerald-700",
      vip: "border-primary/20 bg-primary/10 text-primary",
      no_show_risk: "border-[#f4c7cd] bg-[#fff1f3] text-[#c83d4b]",
      active: "border-emerald-200 bg-emerald-50 text-emerald-700",
      inactive: "border-slate-200 bg-slate-50 text-slate-600",
      archived: "border-slate-300 bg-slate-100 text-slate-700",
    };
    return cn("rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize shadow-none", map[effectiveType] ?? "border-slate-200 bg-slate-50 text-slate-600");
  };

  const getClientTypeLabel = (client: CatalogClient) => {
    const effectiveType = client.status === "new"
      ? "new"
      : client.noShowCount >= 2
      ? "no_show_risk"
      : client.status;
    if (effectiveType === "vip") return "VIP";
    return effectiveType.replace(/_/g, " ");
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Clients</h1>
          <p className="text-muted-foreground text-sm">Manage your client relationships and history.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          <Button
            className={`w-full sm:w-auto inline-flex items-center gap-2 ${canManageClients ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-slate-300 dark:bg-slate-600 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 cursor-not-allowed opacity-70"}`}
            onClick={() => canManageClients && setImportDialogOpen(true)}
            disabled={!canManageClients}
          >
            <UploadCloud className="w-4 h-4" />
            {canManageClients ? "Import Clients" : "Import Clients - Meta API required"}
          </Button>
          <Button
            className={`w-full sm:w-auto shrink-0 ${canManageClients ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-slate-300 dark:bg-slate-600 text-slate-600 dark:text-slate-400 cursor-not-allowed opacity-70"}`}
            onClick={() => canManageClients && openAddClient()}
            disabled={!canManageClients}
          >
            <Plus className="w-4 h-4 mr-2" />
            {canManageClients ? "Add Client" : "Add Client - Meta API required"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, phone, email…" className="w-full pl-9" value={search} onChange={e => handleSearchChange(e.target.value)} />
        </div>

        <Select value={filter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Client type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="returning">Returning</SelectItem>
            <SelectItem value="vip">VIP</SelectItem>
            <SelectItem value="no_show_risk">No-show risk</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <EntityGridSkeleton count={PAGE_SIZE} />
      ) : clients?.length === 0 ? (
        <Card className="border-dashed bg-card/50">
          <CardContent className="h-64 flex flex-col items-center justify-center text-center p-6">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium">No clients found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {search ? "No clients match your search." : "No clients in this segment yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {clients?.map((client) => (
            <Card
              key={client.id}
              className="group relative flex cursor-pointer flex-col overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99] md:min-h-[330px]"
              onClick={() => navigate(`/clients/${client.id}`)}
            >
              <CardContent className="flex flex-1 flex-col gap-3 p-4 md:gap-4 md:p-5">
                <div
                  className="absolute right-3 top-3"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-muted-foreground hover:bg-emerald-50 hover:text-primary"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                        <span className="sr-only">Client actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditClient(client)}>
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setMessageText("");
                          setMessageTarget(client);
                        }}
                      >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Message
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-[#c83d4b] focus:text-[#c83d4b]"
                        onClick={() => setDeleteTarget(client)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start justify-between gap-3 pr-9 md:pr-10">
                  <Avatar className="h-10 w-10 border md:h-12 md:w-12">
                    <AvatarImage src={client.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {client.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Badge variant="outline" className={getClientTypeBadge(client)}>
                    {getClientTypeLabel(client)}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col">
                  <h3 className="line-clamp-1 text-base font-semibold transition-colors group-hover:text-primary md:text-lg">{client.name}</h3>
                  <div className="mt-1.5 flex flex-col gap-1 text-sm text-muted-foreground md:mt-2 md:min-h-[74px] md:gap-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{client.phone}</span>
                    </div>
                    {client.email && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{client.email}</span>
                      </div>
                    )}
                    {client.lastVisit && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Last visit {format(new Date(client.lastVisit), "MMM d, yyyy")}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-auto space-y-2 border-t border-border/50 pt-3 text-sm md:space-y-3 md:pt-4">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary/15 bg-primary/5 p-2.5 md:gap-3 md:rounded-xl md:p-3">
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-muted-foreground">Total Spent</span>
                      <span className="mt-1 block truncate font-semibold text-foreground">{formatCurrency(client.totalSpent)}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-muted-foreground">Bookings</span>
                      <span className="mt-1 block truncate font-semibold text-foreground">{client.lifetimeBookings}</span>
                    </div>
                  </div>
                  <div className="flex w-full items-center justify-end gap-1 text-xs font-medium text-primary/70 transition-all group-hover:gap-2 group-hover:text-primary">
                    <span>View Profile</span>
                    <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center sm:justify-between gap-4 mt-6">
          <p className="text-sm text-muted-foreground">
            Showing {Math.min((currentPage - 1) * 8 + 1, totalCount)}-{Math.min(currentPage * 8, totalCount)} of {totalCount} clients
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Previous</span>
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
                    onClick={() => handlePageChange(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
              <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <span className="hidden sm:inline mr-1">Next</span>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Add / Edit Client Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyClientForm);
          }
        }}
      >
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Client" : "Add New Client"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update this client's profile details." : "Add a client to your contact list manually."}
            </DialogDescription>
          </DialogHeader>
          <ClientFormFields value={form} onChange={setForm} />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              onClick={handleSaveClient}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {editingId ? "Save changes" : "Add Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Message Client Dialog */}
      <Dialog
        open={!!messageTarget}
        onOpenChange={(open) => {
          if (!open) {
            setMessageTarget(null);
            setMessageText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Message {messageTarget?.name}</DialogTitle>
            <DialogDescription>
              Send a WhatsApp message to {messageTarget?.phone || "this client"}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type your message…"
            className="min-h-[120px] resize-y"
          />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setMessageTarget(null)}>Cancel</Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              disabled={!messageText.trim() || !messageTarget?.phone || messageMutation.isPending}
              onClick={() => void handleSendMessage()}
            >
              {messageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Client Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name} from the client list?</DialogTitle>
            <DialogDescription>
              This removes the client from the client list. Existing bookings and payments remain
              on record and will stay linked to your business history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" className="w-full sm:w-auto" disabled={deleteMutation.isPending} onClick={() => void handleDeleteClient()}>
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={(open) => { setImportDialogOpen(open); if (!open) resetImportState(); }}>
        <DialogContent className="sm:max-w-2xl w-[95vw] rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import clients</DialogTitle>
            <DialogDescription>
              Upload a customer CSV or a PDF report. You can review the parsed rows before adding them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">CSV upload</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Supports Shopify-style headers like First Name, Last Name, Email, Phone, Tags, and Notes.
                    </p>
                  </div>
                </div>
                <label htmlFor="clients-csv-upload" className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition hover:border-primary/60 hover:bg-primary/5">
                  <UploadCloud className="mb-2 h-5 w-5 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Choose CSV file</span>
                  <span className="mt-1 text-xs text-muted-foreground">.csv or .tsv</span>
                </label>
                <input
                  id="clients-csv-upload"
                  type="file"
                  accept=".csv,.tsv"
                  className="sr-only"
                  onChange={handleImportFile}
                />
              </div>

              <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">PDF customer report</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Reads quoted customer rows with South African +27 phone numbers and skips duplicate or unnamed records.
                    </p>
                  </div>
                </div>
                <label htmlFor="clients-pdf-upload" className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition hover:border-primary/60 hover:bg-primary/5">
                  <UploadCloud className="mb-2 h-5 w-5 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Choose PDF file</span>
                  <span className="mt-1 text-xs text-muted-foreground">Customer report PDF</span>
                </label>
                <input
                  id="clients-pdf-upload"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={handleImportPdfFile}
                />
              </div>

              <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Import from WhatsApp</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Load contacts who have messaged your connected WhatsApp session. Select which contacts to import into the client list.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button className="w-full sm:w-auto" onClick={() => setShowWhatsappImport((s) => !s)}>
                    {showWhatsappImport ? "Hide WhatsApp contacts" : "Show WhatsApp contacts"}
                  </Button>
                  <Button disabled={!canManageClients} variant="outline" className="w-full sm:w-auto">
                    {canManageClients ? "Connected" : "WhatsApp not connected"}
                  </Button>
                </div>

                {showWhatsappImport && (
                  <div className="mt-4 space-y-3">
                    <Input placeholder="Search contacts..." value={whatsappSearch} onChange={(e) => setWhatsappSearch(e.target.value)} className="bg-background" />
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">{loadingWhatsappConversations ? "Loading..." : `${(whatsappConversations as any).length} contacts`}</div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setWhatsappSelectedIds((whatsappConversations as any).map((c: any) => c.id)); }}>
                          Select all
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setWhatsappSelectedIds([])}>Clear</Button>
                      </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {(loadingWhatsappConversations ? Array.from({ length: 6 }) : (whatsappConversations as any))
                        .filter((c: any) => {
                          if (!whatsappSearch.trim()) return true;
                          const q = whatsappSearch.trim().toLowerCase();
                          return (c.name || "").toLowerCase().includes(q) || (c.remoteJid || "").toLowerCase().includes(q);
                        })
                        .map((conv: any) => {
                          const checked = whatsappSelectedIds.includes(conv.id);
                          const phone = conv.clientPhone ?? conv.remoteJid ?? conv.id;
                          return (
                            <label key={conv.id} className={`flex items-center gap-3 rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "border-border/60 bg-card"}`}>
                              <input type="checkbox" checked={checked} onChange={() => {
                                setWhatsappSelectedIds((prev) => prev.includes(conv.id) ? prev.filter((id) => id !== conv.id) : [...prev, conv.id]);
                              }} />
                              <div className="min-w-0">
                                <div className="font-semibold text-sm truncate">{conv.name ?? phone}</div>
                                <div className="text-xs text-muted-foreground truncate">{phone}</div>
                              </div>
                            </label>
                          );
                        })}
                    </div>

                    <div className="flex gap-2">
                      <Button className="w-full sm:w-auto" onClick={async () => {
                        const selected = (whatsappConversations as any).filter((c: any) => whatsappSelectedIds.includes(c.id));
                        if (selected.length === 0) {
                          toast({ title: "No contacts selected", description: "Please select at least one WhatsApp contact to import.", variant: "destructive" });
                          return;
                        }
                        const rows = selected.map((c: any, index: number) => ({ rowIndex: index, name: c.name ?? null, phone: c.clientPhone ?? c.remoteJid ?? String(c.id), email: null, notes: null, clientType: "new" }));
                        setParsedImportClients(rows as any);
                      }}>
                        Import selected
                      </Button>
                      <Button variant="ghost" onClick={() => { setWhatsappSelectedIds([]); setShowWhatsappImport(false); }}>Done</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {importFileName ? importFileName : "No file selected"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {parsedImportClients.length > 0
                      ? `${parsedImportClients.length} clients parsed and ready to review.`
                      : "Upload a file to preview clients before importing."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={handleDownloadExtractedNumbers}
                  disabled={parsedImportClients.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export numbers
                </Button>
              </div>
            </div>

            {(importErrors.length > 0 || importWarnings.length > 0) && (
              <div className="space-y-3">
                {importErrors.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                      <AlertTriangle className="h-4 w-4" />
                      Import errors
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-red-800">
                      {importErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {importWarnings.length > 0 && (
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-orange-800">
                      <AlertTriangle className="h-4 w-4" />
                      Warnings
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-orange-800">
                      {importWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {parsedImportClients.length > 0 && (
              <div className="rounded-xl border border-border/70 bg-card shadow-sm">
                <div className="flex flex-col gap-2 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Preview import
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {parsedImportClients.length > 20 ? "Showing first 20 rows" : "Showing all rows"}
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                    {parsedImportClients.length} ready
                  </Badge>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto p-4">
                  {parsedImportClients.slice(0, 20).map((client) => (
                    <div key={client.rowIndex} className="rounded-lg border border-border/70 bg-background p-3">
                      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">{client.name}</p>
                          <p className="truncate text-muted-foreground">{client.phone}{client.email ? ` · ${client.email}` : ""}</p>
                          {(client.city || client.street) && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {[client.street, client.city, client.state, client.countryCode].filter(Boolean).join(", ")}
                            </p>
                          )}
                          {(client.totalScore || client.categoryName) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {client.totalScore && `★ ${client.totalScore}`}
                              {client.totalScore && client.reviewsCount && ` (${client.reviewsCount} reviews)`}
                              {client.totalScore && client.categoryName && " · "}
                              {client.categoryName}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary" className="w-fit shrink-0 capitalize">
                          {client.clientType ?? "new"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setImportDialogOpen(false)} disabled={isImporting}>Cancel</Button>
            <Button className="w-full sm:w-auto bg-primary hover:bg-primary/90" onClick={handleImportClients} disabled={parsedImportClients.length === 0 || isImporting}>
              {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isImporting
                ? "Importing..."
                : parsedImportClients.length > 0
                ? `Import ${parsedImportClients.length} ${parsedImportClients.length === 1 ? "client" : "clients"}`
                : "Import clients"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
