import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveService,
  catalogKeys,
  createService,
  fetchServices,
  updateService,
} from "@/lib/catalog";
import type { CatalogService } from "@/types/catalog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  Loader2,
  Clock,
  MoreVertical,
  Edit,
  Copy,
  Archive,
  Scissors,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SERVICE_COLOR = "#10b981";
const PAGE_SIZE = 8;

type ServiceFormState = {
  name: string;
  description: string;
  duration: string;
  price: string;
};

const emptyForm = (): ServiceFormState => ({
  name: "",
  description: "",
  duration: "60",
  price: "",
});

function formFromService(service: CatalogService): ServiceFormState {
  return {
    name: service.name,
    description: service.description ?? "",
    duration: String(service.duration),
    price: String(service.price),
  };
}

function ServiceFormFields({
  form,
  setForm,
  idPrefix = "",
}: {
  form: ServiceFormState;
  setForm: React.Dispatch<React.SetStateAction<ServiceFormState>>;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}name`}>Service name *</Label>
        <Input
          id={`${idPrefix}name`}
          placeholder="e.g. Haircut & Style"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}description`}>Description</Label>
        <Textarea
          id={`${idPrefix}description`}
          placeholder="Describe what's included in this service…"
          rows={4}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}duration`}>Duration (minutes) *</Label>
          <Input
            id={`${idPrefix}duration`}
            type="number"
            min="5"
            step="5"
            value={form.duration}
            onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}price`}>Price (R) *</Label>
          <Input
            id={`${idPrefix}price`}
            type="number"
            min="0"
            placeholder="0"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </div>
      </div>
    </div>
  );
}

export default function ServicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: services, isLoading } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });
  const createMutation = useMutation({
    mutationFn: createService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateService>[1] }) =>
      updateService(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
  });
  const creating = createMutation.isPending;
  const updating = updateMutation.isPending;

  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editService, setEditService] = useState<CatalogService | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const activeServices = services?.filter((s) => s.isActive) ?? [];
  const filtered = activeServices.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const buildPayload = (form: ServiceFormState) => ({
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    duration: Number(form.duration),
    price: Number(form.price),
    color: SERVICE_COLOR,
  });

  const validateForm = (form: ServiceFormState): string | null => {
    if (!form.name.trim()) return "Service name is required.";
    if (!form.price || Number(form.price) < 0) return "Enter a valid price.";
    if (!form.duration || Number(form.duration) < 5) return "Duration must be at least 5 minutes.";
    return null;
  };

  const openAdd = () => {
    setCreateForm(emptyForm());
    setCreateDialogOpen(true);
  };

  const handleCreate = async () => {
    const error = validateForm(createForm);
    if (error) {
      toast({ title: "Check the form", description: error, variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync(buildPayload(createForm));
      toast({ title: "Service created", description: `${createForm.name.trim()} is now available for booking.` });
      setCreateForm(emptyForm());
      setCreateDialogOpen(false);
    } catch (err) {
      toast({
        title: "Could not create service",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async () => {
    if (!editService) return;
    const error = validateForm(editForm);
    if (error) {
      toast({ title: "Check the form", description: error, variant: "destructive" });
      return;
    }

    try {
      await updateMutation.mutateAsync({ id: editService.id, input: buildPayload(editForm) });
      toast({ title: "Service updated", description: `${editForm.name.trim()} has been saved.` });
      setEditDialogOpen(false);
      setEditService(null);
    } catch (err) {
      toast({
        title: "Could not update service",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async (service: CatalogService) => {
    try {
      await archiveMutation.mutateAsync(service.id);
      toast({ title: "Service archived", description: `${service.name} is no longer bookable.` });
    } catch (err) {
      toast({
        title: "Could not archive service",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = (service: CatalogService) => {
    setCreateForm({
      ...formFromService(service),
      name: `${service.name} (Copy)`,
    });
    setCreateDialogOpen(true);
  };

  const openEdit = (service: CatalogService) => {
    setEditService(service);
    setEditForm(formFromService(service));
    setEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Services</h1>
          <p className="text-muted-foreground text-sm">
            Create and manage the services your business offers for online booking.
          </p>
        </div>
        <Button className="w-full sm:w-auto shrink-0 bg-primary hover:bg-primary/90 shadow-sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" />
          Add service
        </Button>
      </div>

      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search services…"
          className="pl-9 bg-card w-full"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed bg-card/50">
          <CardContent className="h-64 flex flex-col items-center justify-center text-center p-6">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Scissors className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium">No services yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {search
                ? "No services match your search."
                : "Create your first service so clients can book appointments."}
            </p>
            {!search && (
              <Button className="mt-4 bg-primary" onClick={openAdd}>
                Add your first service
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((service) => (
            <Card
              key={service.id}
              className="shadow-sm hover:shadow-md transition-shadow group border-border/50 overflow-hidden flex flex-col"
            >
              <div className="h-2 w-full bg-primary" />
              <CardContent className="p-5 flex flex-col flex-1 gap-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base line-clamp-1 group-hover:text-primary transition-colors">
                      {service.name}
                    </h3>
                    <div className="flex items-center text-muted-foreground text-sm mt-1 gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{service.duration} mins</span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 sm:h-8 sm:w-8 -mr-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      >
                        <MoreVertical className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(service)}>
                        <Edit className="w-4 h-4 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(service)}>
                        <Copy className="w-4 h-4 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleArchive(service)}
                      >
                        <Archive className="w-4 h-4 mr-2" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
                  {service.description || "No description provided."}
                </p>

                <div className="pt-3 border-t border-border/50">
                  <div className="text-xl font-bold text-foreground">{formatCurrency(service.price)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center sm:justify-between gap-4 mt-6">
          <p className="text-sm text-muted-foreground">
            Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}-
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} services
          </p>
          <div className="flex flex-wrap justify-center items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => p - 1)}
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
              <span className="hidden sm:inline mr-1">Next</span>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCreateForm(emptyForm());
        }}
      >
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add new service</DialogTitle>
            <DialogDescription>
              Add a service clients can book. Set the duration and price.
            </DialogDescription>
          </DialogHeader>
          <ServiceFormFields form={createForm} setForm={setCreateForm} idPrefix="create-" />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCreateDialogOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              onClick={handleCreate}
              disabled={creating || !createForm.name.trim() || !createForm.price}
            >
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit service</DialogTitle>
            <DialogDescription>Update the details for this service.</DialogDescription>
          </DialogHeader>
          <ServiceFormFields form={editForm} setForm={setEditForm} idPrefix="edit-" />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditDialogOpen(false)} disabled={updating}>
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              onClick={handleUpdate}
              disabled={updating || !editForm.name.trim() || !editForm.price}
            >
              {updating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
