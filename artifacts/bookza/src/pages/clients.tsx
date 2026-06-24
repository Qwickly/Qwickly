import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, createClient, fetchClients } from "@/lib/catalog";
import { parseClientCsvText, type ParsedClientCsvRow } from "@/lib/csv";
import type { ClientType } from "@/types/catalog";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ClientFormFields } from "@/components/clients/ClientFormFields";
import { Search, Plus, Loader2, Phone, Mail, Star, Calendar, ChevronLeft, ChevronRight, UploadCloud } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { format } from "date-fns";

export default function ClientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [parsedCsvClients, setParsedCsvClients] = useState<ParsedClientCsvRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [form, setForm] = useState({ name: "", phone: "", email: "", clientType: "new" as ClientType, notes: "" });
  const { data: clientsData, isLoading } = useQuery({
    queryKey: [...catalogKeys.clients, currentPage, filter, search],
    queryFn: () => fetchClients(currentPage, 8, filter, search),
  });

  const clients = clientsData?.clients ?? [];
  const totalCount = clientsData?.totalCount ?? 0;
  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.clients }),
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
    setParsedCsvClients([]);
    setImportErrors([]);
    setImportWarnings([]);
    setIsImporting(false);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setImportFileName(file.name);
    const text = await file.text();
    const { clients, errors, warnings } = parseClientCsvText(text);
    setParsedCsvClients(clients);
    setImportErrors(errors);
    setImportWarnings(warnings);
  };

  const handleImportClients = async () => {
    if (parsedCsvClients.length === 0) {
      toast({ title: "No clients to import", description: "Upload a CSV file with client rows first.", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const results = await Promise.allSettled(
        parsedCsvClients.map((client) =>
          createClient({
            name: client.name,
            phone: client.phone,
            email: client.email ?? null,
            notes: client.notes ?? null,
            clientType: client.clientType ?? "new",
          }),
        ),
      );

      const successes = results.filter((result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled").length;
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      queryClient.invalidateQueries({ queryKey: catalogKeys.clients });

      if (failures.length === 0) {
        toast({ title: "Clients imported", description: `${successes} clients added successfully.` });
      } else if (successes === 0) {
        toast({ title: "Import failed", description: `Failed to import all ${parsedCsvClients.length} rows.`, variant: "destructive" });
      } else {
        toast({
          title: "Partial import",
          description: `${successes} clients imported, ${failures.length} failed.`,
          variant: "warning",
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

  const handleAddClient = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Name and phone are required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        clientType: form.clientType,
        notes: form.notes.trim() || null,
      });
      toast({ title: "Client added", description: `${form.name.trim()} has been saved.` });
      setForm({ name: "", phone: "", email: "", clientType: "new", notes: "" });
      setDialogOpen(false);
    } catch (err) {
      toast({
        title: "Could not add client",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const getClientTypeBadge = (type: string) => {
    const map: Record<string, string> = {
      new: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400",
      returning: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400",
      vip: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400",
      no_show_risk: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400",
    };
    return map[type] ?? "bg-muted text-muted-foreground";
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Clients</h1>
          <p className="text-muted-foreground text-sm">Manage your client relationships and history.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="inline-flex items-center gap-2 rounded-full bg-card border border-border/60 text-sm font-medium text-foreground hover:border-primary/80 hover:bg-primary/5" onClick={() => setImportDialogOpen(true)}>
            <UploadCloud className="w-4 h-4" />
            Import Clients
          </Button>
          <Button className="shrink-0 bg-primary hover:bg-primary/90" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Client
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <Tabs value={filter} onValueChange={handleFilterChange} className="w-full sm:w-auto">
          <TabsList className="bg-card">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="new">New</TabsTrigger>
            <TabsTrigger value="returning">Returning</TabsTrigger>
            <TabsTrigger value="vip">VIP</TabsTrigger>
            <TabsTrigger value="no_show_risk">Risk</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, phone, email…" className="pl-9 bg-card" value={search} onChange={e => handleSearchChange(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
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
              className="shadow-sm hover:shadow-md transition-all cursor-pointer border-border/50 group hover:border-primary/30"
              onClick={() => navigate(`/clients/${client.id}`)}
            >
              <CardContent className="p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <Avatar className="w-12 h-12 border">
                    <AvatarImage src={client.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {client.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Badge variant="outline" className={getClientTypeBadge(client.noShowCount >= 2 ? "no_show_risk" : client.clientType)}>
                    {client.clientType === "vip" ? "⭐ VIP" : client.clientType.replace(/_/g, " ")}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">{client.name}</h3>
                  <div className="flex flex-col gap-1.5 mt-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span>{client.phone}</span>
                    </div>
                    {client.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span className="line-clamp-1">{client.email}</span>
                      </div>
                    )}
                    {client.lastVisit && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        <span>Last visit {format(new Date(client.lastVisit), "MMM d, yyyy")}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between text-sm">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground text-xs">Total Spent</span>
                    <span className="font-semibold text-foreground">{formatCurrency(client.totalSpent)}</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-muted-foreground text-xs">Bookings</span>
                    <span className="font-semibold text-foreground">{client.lifetimeBookings}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-muted-foreground">
            Showing {Math.min((currentPage - 1) * 8 + 1, totalCount)}-{Math.min(currentPage * 8, totalCount)} of {totalCount} clients
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
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
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Add Client Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
            <DialogDescription>Add a client to your contact list manually.</DialogDescription>
          </DialogHeader>
          <ClientFormFields value={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={handleAddClient} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={(open) => { setImportDialogOpen(open); if (!open) resetImportState(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Clients</DialogTitle>
            <DialogDescription>
              Upload a CSV file from Shopify or any common customer export format. Supported delimiters: comma, semicolon, tab, pipe.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-3xl border border-border/50 bg-card p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">CSV upload</p>
                  <p className="text-xs text-muted-foreground">Choose a file containing client rows. Shopify header names like First Name, Last Name, Email, Phone, Tags, Notes are supported.</p>
                </div>
                <div className="text-sm text-muted-foreground">{importFileName ?? "No file selected"}</div>
              </div>
              <div className="mt-3">
                <label htmlFor="clients-csv-upload" className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/80 hover:bg-primary/5 cursor-pointer">
                  Select CSV file
                </label>
                <input
                  id="clients-csv-upload"
                  type="file"
                  accept=".csv,.tsv"
                  className="sr-only"
                  onChange={handleImportFile}
                />
              </div>
            </div>

            {(importErrors.length > 0 || importWarnings.length > 0) && (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-4 space-y-2">
                {importErrors.length > 0 && (
                  <div>
                    <p className="font-semibold text-sm text-red-800">Import errors</p>
                    <ul className="list-disc pl-5 text-xs text-red-800">
                      {importErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {importWarnings.length > 0 && (
                  <div>
                    <p className="font-semibold text-sm text-orange-800">Warnings</p>
                    <ul className="list-disc pl-5 text-xs text-orange-800">
                      {importWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {parsedCsvClients.length > 0 && (
              <div className="rounded-3xl border border-border/50 bg-card p-4">
                <div className="flex items-center justify-between gap-4 mb-3 text-sm text-muted-foreground">
                  <span>{parsedCsvClients.length} rows ready to import</span>
                  <span>{parsedCsvClients.length > 20 ? "Showing first 20 rows" : "Showing all rows"}</span>
                </div>
                <div className="grid gap-2">
                  {parsedCsvClients.slice(0, 20).map((client) => (
                    <div key={client.rowIndex} className="rounded-2xl border border-border/70 bg-background p-3">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-2 text-sm">
                        <div>
                          <p className="font-semibold">{client.name}</p>
                          <p className="text-muted-foreground">{client.phone}{client.email ? ` · ${client.email}` : ""}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          Type: {client.clientType ?? "new"}
                          {client.notes ? ` · ${client.notes}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={isImporting}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={handleImportClients} disabled={parsedCsvClients.length === 0 || isImporting}>
              {isImporting ? "Importing…" : "Import clients"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
