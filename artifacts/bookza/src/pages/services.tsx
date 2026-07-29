import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  catalogKeys,
  createService,
  fetchServices,
  fetchStaff,
  updateService,
} from "@/lib/catalog";
import type { CatalogService } from "@/types/catalog";
import {
  ServiceFormFields,
  getServiceIcon,
  buildServicePayload,
  validateServiceForm,
  emptyServiceForm,
  formFromService,
} from "@/components/services/service-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageEmptyState } from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { SERVICE_TOUR_STEPS } from "@/lib/tour-steps";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 8;
const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-none";

export default function ServicesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
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
  const [createForm, setCreateForm] = useState(emptyServiceForm);
  const [editForm, setEditForm] = useState(emptyServiceForm);

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

  const openAdd = () => {
    setCreateForm(emptyServiceForm());
    setCreateDialogOpen(true);
  };

  const handleCreate = async () => {
    const error = validateServiceForm(createForm);
    if (error) {
      toast({ title: "Check the form", description: error, variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync(buildServicePayload(createForm));
      toast({ title: "Service created", description: `${createForm.name.trim()} is now available for booking.` });
      setCreateForm(emptyServiceForm());
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
    const error = validateServiceForm(editForm);
    if (error) {
      toast({ title: "Check the form", description: error, variant: "destructive" });
      return;
    }

    try {
      await updateMutation.mutateAsync({ id: editService.id, input: buildServicePayload(editForm) });
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
      await updateMutation.mutateAsync({ id: service.id, input: { ...buildServicePayload(formFromService(service)), isActive: false } });
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
      await updateMutation.mutateAsync({ id: service.id, input: { ...buildServicePayload(formFromService(service)), isActive: true } });
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
      <TourOverlay tourId="add-service" steps={SERVICE_TOUR_STEPS} />
      <PageHeader
        title="Services"
        description="Create and manage the services your business offers for online booking."
        actions={
          <Button
            data-tour-id="add-service-button"
            className="w-full sm:w-auto shrink-0 bg-primary hover:bg-primary/90 shadow-sm"
            onClick={openAdd}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Service
          </Button>
        }
      />

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
        <PageEmptyState
          icon={Scissors}
          title="No services found"
          description={
            search
              ? "No services match your search."
              : statusFilter === "inactive"
                ? "Archived services will appear here."
                : "Create your first service so clients can book appointments."
          }
          actions={
            !search && statusFilter !== "inactive" ? (
              <Button className="bg-primary" onClick={openAdd}>
                Add your first service
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div data-tour-id="services-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((service) => (
            (() => {
              const ServiceIcon = getServiceIcon(service.icon);

              return (
            <Card
              key={service.id}
              className={cn(
                "group relative flex cursor-pointer flex-col overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99] md:min-h-[330px]",
                !service.isActive && "opacity-70",
              )}
              onClick={() => navigate(`/services/${service.id}`)}
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
                        className="h-9 w-9 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
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
                          className="text-destructive focus:text-destructive"
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

                <div className="flex items-start justify-between gap-3 pr-9 md:pr-10">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-primary/10 text-primary md:h-12 md:w-12">
                    <ServiceIcon className="h-4 w-4 md:h-5 md:w-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      statusBadgeClass,
                      service.isActive
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {service.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col">
                  <h3 className="line-clamp-1 text-base font-semibold transition-colors group-hover:text-primary md:text-lg">
                    {service.name}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{service.duration} mins</span>
                  </div>

                  <p className="mt-2 line-clamp-1 text-sm text-muted-foreground md:mt-3 md:min-h-[44px] md:line-clamp-2">
                    {service.description || "No description provided."}
                  </p>
                </div>

                <div className="mt-auto space-y-2 border-t border-border/50 pt-3 text-sm md:space-y-3 md:pt-4">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary/15 bg-primary/5 p-2.5 md:gap-3 md:rounded-xl md:p-3">
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-muted-foreground">Price</span>
                      <span className="mt-1 block truncate font-semibold text-foreground">{formatCurrency(service.price)}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-muted-foreground">Staff</span>
                      <span className="mt-1 block truncate font-semibold text-foreground">{assignedStaffCount}</span>
                    </div>
                  </div>
                  <div className="flex w-full items-center justify-end gap-1 text-xs font-medium text-primary/70 transition-all group-hover:gap-2 group-hover:text-primary">
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

      <EntityListPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        totalCount={filtered.length}
        pageSize={PAGE_SIZE}
        itemLabel="services"
      />

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCreateForm(emptyServiceForm());
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
