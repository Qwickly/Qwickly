import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  catalogKeys,
  createService,
  fetchServices,
  fetchStaff,
  updateService,
} from "@/lib/catalog";
import type { CatalogService } from "@/types/catalog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EntityGridSkeleton } from "@/components/skeletons/entity-card-skeleton";
import {
  Search,
  Plus,
  Loader2,
  Clock,
  MoreHorizontal,
  Edit,
  Copy,
  Archive,
  ArchiveRestore,
  Scissors,
  Sparkles,
  HeartPulse,
  Dumbbell,
  Flower2,
  Smile,
  UserRound,
  Hand,
  Palette,
  Droplets,
  Gem,
  Crown,
  Star,
  Eye,
  Brush,
  Paintbrush,
  Bath,
  SprayCan,
  Footprints,
  Leaf,
  Waves,
  HandHeart,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SERVICE_COLOR = "#10b981";
const SERVICE_ICON = "scissors";
const PAGE_SIZE = 8;
const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-none";

const SERVICE_ICON_OPTIONS = [
  { value: "scissors", label: "Hair", icon: Scissors },
  { value: "sparkles", label: "Beauty", icon: Sparkles },
  { value: "hand", label: "Nails", icon: Hand },
  { value: "palette", label: "Makeup", icon: Palette },
  { value: "droplets", label: "Spa", icon: Droplets },
  { value: "brush", label: "Lashes", icon: Brush },
  { value: "eye", label: "Brows", icon: Eye },
  { value: "paintbrush", label: "Colour", icon: Paintbrush },
  { value: "spray-can", label: "Tan", icon: SprayCan },
  { value: "gem", label: "Luxury", icon: Gem },
  { value: "crown", label: "Premium", icon: Crown },
  { value: "star", label: "Featured", icon: Star },
  { value: "heart-pulse", label: "Wellness", icon: HeartPulse },
  { value: "dumbbell", label: "Fitness", icon: Dumbbell },
  { value: "flower", label: "Massage", icon: Flower2 },
  { value: "bath", label: "Bath", icon: Bath },
  { value: "footprints", label: "Feet", icon: Footprints },
  { value: "leaf", label: "Natural", icon: Leaf },
  { value: "waves", label: "Relax", icon: Waves },
  { value: "hand-heart", label: "Care", icon: HandHeart },
  { value: "smile", label: "Consult", icon: Smile },
  { value: "user", label: "Personal", icon: UserRound },
];

function getServiceIcon(icon?: string) {
  return SERVICE_ICON_OPTIONS.find((option) => option.value === icon)?.icon ?? Scissors;
}

function getServiceIconOption(icon?: string) {
  return SERVICE_ICON_OPTIONS.find((option) => option.value === icon) ?? SERVICE_ICON_OPTIONS[0];
}

type ServiceFormState = {
  name: string;
  description: string;
  duration: string;
  price: string;
  icon: string;
  isActive: boolean;
};

const emptyForm = (): ServiceFormState => ({
  name: "",
  description: "",
  duration: "60",
  price: "",
  icon: SERVICE_ICON,
  isActive: true,
});

function formFromService(service: CatalogService): ServiceFormState {
  return {
    name: service.name,
    description: service.description ?? "",
    duration: String(service.duration),
    price: String(service.price),
    icon: service.icon ?? SERVICE_ICON,
    isActive: service.isActive,
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
  const selectedIcon = getServiceIconOption(form.icon);
  const SelectedIcon = selectedIcon.icon;

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

      <div className="space-y-2">
        <Label>Service icon</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full justify-between rounded-lg border-border/70 bg-background px-3 font-normal shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <SelectedIcon className="h-4 w-4" />
                </span>
                <span className="text-sm">{selectedIcon.label}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Choose an icon</p>
              <p className="text-xs text-muted-foreground">{SERVICE_ICON_OPTIONS.length} options</p>
            </div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
              {SERVICE_ICON_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = form.icon === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    className={cn(
                      "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border bg-card text-[10px] font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
                      selected && "border-primary bg-primary/10 text-primary ring-2 ring-primary/15",
                    )}
                    onClick={() => setForm((f) => ({ ...f, icon: option.value }))}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="max-w-full truncate px-1">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
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

      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
        <div>
          <Label htmlFor={`${idPrefix}is-active`} className="font-medium">Active service</Label>
          <p className="mt-1 text-xs text-muted-foreground">Active services can be booked by clients.</p>
        </div>
        <Switch
          id={`${idPrefix}is-active`}
          checked={form.isActive}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
        />
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
  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
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
  const creating = createMutation.isPending;
  const updating = updateMutation.isPending;
  const assignedStaffCount = (staff ?? []).filter((member) => member.isActive).length;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
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

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value as "all" | "active" | "inactive");
    setCurrentPage(1);
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const filtered = (services ?? []).filter((service) => {
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? service.isActive : !service.isActive);
    const query = search.toLowerCase();
    const matchesSearch =
      !query ||
      service.name.toLowerCase().includes(query) ||
      (service.description ?? "").toLowerCase().includes(query);

    return matchesStatus && matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const buildPayload = (form: ServiceFormState) => ({
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    duration: Number(form.duration),
    price: Number(form.price),
    icon: form.icon,
    color: SERVICE_COLOR,
    isActive: form.isActive,
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
      await updateMutation.mutateAsync({ id: service.id, input: { ...buildPayload(formFromService(service)), isActive: false } });
      toast({ title: "Service archived", description: `${service.name} is no longer bookable.` });
    } catch (err) {
      toast({
        title: "Could not archive service",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleRestore = async (service: CatalogService) => {
    try {
      await updateMutation.mutateAsync({ id: service.id, input: { ...buildPayload(formFromService(service)), isActive: true } });
      toast({ title: "Service restored", description: `${service.name} is available for booking again.` });
    } catch (err) {
      toast({
        title: "Could not restore service",
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
          Add Service
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services…"
            className="w-full pl-9"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue placeholder="Service status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active services</SelectItem>
            <SelectItem value="inactive">Inactive services</SelectItem>
            <SelectItem value="all">All services</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <EntityGridSkeleton count={PAGE_SIZE} />
      ) : filtered.length === 0 ? (
        <Card className="border-dashed bg-card/50">
          <CardContent className="h-64 flex flex-col items-center justify-center text-center p-6">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Scissors className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium">No services found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {search
                ? "No services match your search."
                : statusFilter === "inactive"
                  ? "Archived services will appear here."
                  : "Create your first service so clients can book appointments."}
            </p>
            {!search && statusFilter !== "inactive" && (
              <Button className="mt-4 bg-primary" onClick={openAdd}>
                Add your first service
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((service) => (
            (() => {
              const ServiceIcon = getServiceIcon(service.icon);

              return (
            <Card
              key={service.id}
              className={cn(
                "group relative cursor-pointer overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99]",
                !service.isActive && "opacity-70",
              )}
              onClick={() => openEdit(service)}
            >
              <CardContent className="p-5 pr-14 flex flex-col gap-4">
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
                        <span className="sr-only">Service actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(service)}>
                        <Edit className="w-4 h-4 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(service)}>
                        <Copy className="w-4 h-4 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      {service.isActive ? (
                        <DropdownMenuItem
                          className="text-[#c83d4b] focus:text-[#c83d4b]"
                          onClick={() => handleArchive(service)}
                        >
                          <Archive className="w-4 h-4 mr-2" /> Archive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => handleRestore(service)}>
                          <ArchiveRestore className="w-4 h-4 mr-2" /> Restore
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-primary/10 text-primary">
                    <ServiceIcon className="h-5 w-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      statusBadgeClass,
                      service.isActive
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-slate-200 bg-slate-100 text-slate-600",
                    )}
                  >
                    {service.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                    {service.name}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{service.duration} mins</span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2">
                  {service.description || "No description provided."}
                </p>

                <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/50 pt-4 text-sm">
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs">Price</span>
                      <span className="font-semibold text-foreground">{formatCurrency(service.price)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs">Staff</span>
                      <span className="font-semibold text-foreground">{assignedStaffCount}</span>
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-primary/70 transition-all group-hover:gap-2 group-hover:text-primary">
                    <span>View Service</span>
                    <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
              );
            })()
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
