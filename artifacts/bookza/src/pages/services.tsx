import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  catalogKeys,
  fetchServices,
  fetchStaff,
  updateService,
} from "@/lib/catalog";
import type { CatalogService } from "@/types/catalog";
import { getServiceIcon, buildServicePayload, formFromService } from "@/components/services/service-form";
import { Card, CardContent } from "@/components/ui/card";
import { DataViewToolbar, PageHeader, PageEmptyState, type DataViewMode } from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { BackToHelpLink } from "@/components/tour/BackToHelpLink";
import { SERVICE_TOUR_STEPS, serviceCreatedSteps } from "@/lib/tour-steps";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntityGridSkeleton } from "@/components/skeletons/entity-card-skeleton";
import { TableRowsSkeleton } from "@/components/skeletons/table-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus,
  Clock,
  MoreHorizontal,
  Edit,
  Copy,
  Archive,
  ArchiveRestore,
  Scissors,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 8;
const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-none";

const HEAD_CLASS = "h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground";

function ServicesTable({ children }: { children: ReactNode }) {
  return (
    <Card
      data-tour-id="services-list"
      className="gap-0 overflow-hidden rounded-xl border-border/70 bg-card py-0 shadow-none"
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[600px] table-fixed [&_td]:px-3 [&_th]:px-3 md:min-w-[820px] md:[&_td]:px-4 md:[&_th]:px-4">
          <colgroup>
            <col className="w-[42%] md:w-[38%]" />
            <col className="w-[18%] md:w-[14%]" />
            <col className="hidden md:table-column md:w-[14%]" />
            <col className="w-[22%] md:w-[16%]" />
            <col className="w-[48px]" />
          </colgroup>
          <TableHeader className="bg-muted/15">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>Service</TableHead>
              <TableHead className={HEAD_CLASS}>Duration</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Status</TableHead>
              <TableHead className={`text-right ${HEAD_CLASS}`}>Price</TableHead>
              <TableHead className={HEAD_CLASS}>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </Card>
  );
}

export default function ServicesPage() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const queryClient = useQueryClient();
  const { data: services, isLoading } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });
  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateService>[1] }) =>
      updateService(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
  });
  const assignedStaffCount = (staff ?? []).filter((member) => member.isActive).length;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [dataView, setDataView] = useState<DataViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "table",
  );
  const [justCreatedServiceId, setJustCreatedServiceId] = useState<string | null>(null);

  // The new-service page hands back the id of a business's genuinely first
  // service so the one-time tour can spotlight the real card here.
  const createdServiceId = new URLSearchParams(queryString).get("created");
  useEffect(() => {
    if (!createdServiceId) return;
    setJustCreatedServiceId(createdServiceId);
    navigate("/services", { replace: true });
  }, [createdServiceId, navigate]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value as "all" | "active" | "inactive");
    setCurrentPage(1);
  };

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const serviceMenuItems = (service: CatalogService) => (
    <>
      <DropdownMenuItem onClick={() => navigate(`/services/${service.id}/edit`)}>
        <Edit className="w-4 h-4 mr-2" /> Edit
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => navigate(`/services/new?duplicateOf=${service.id}`)}>
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
    </>
  );

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


  const handleArchive = async (service: CatalogService) => {
    try {
      await updateMutation.mutateAsync({ id: service.id, input: { ...buildServicePayload(formFromService(service)), isActive: false } });
      toast("Service archived", { description: `${service.name} is no longer bookable.` });
    } catch (err) {
      toast.error("Could not archive service", { description: err instanceof Error ? err.message : "Please try again" });
    }
  };

  const handleRestore = async (service: CatalogService) => {
    try {
      await updateMutation.mutateAsync({ id: service.id, input: { ...buildServicePayload(formFromService(service)), isActive: true } });
      toast("Service restored", { description: `${service.name} is available for booking again.` });
    } catch (err) {
      toast.error("Could not restore service", { description: err instanceof Error ? err.message : "Please try again" });
    }
  };


  return (
    <div className="space-y-6">
      <TourOverlay
        tourId="add-service"
        steps={SERVICE_TOUR_STEPS}
        onFinish={() => navigate("/help")}
      />
      {justCreatedServiceId && (
        <TourOverlay
          tourId="service-created"
          forceActive
          steps={serviceCreatedSteps(justCreatedServiceId)}
          onFinish={() => navigate("/help")}
        />
      )}
      <BackToHelpLink />
      <PageHeader
        title="Services"
        description="Create and manage the services your business offers for online booking."
        primaryAction={
          <Button data-tour-id="add-service-button" onClick={() => navigate("/services/new")}>
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="sr-only sm:hidden">Add service</span>
            <span className="hidden sm:inline">Add Service</span>
          </Button>
        }
      />

      <DataViewToolbar viewMode={dataView} onViewModeChange={setDataView}>
        <div data-tour-id="services-search" className="min-w-0 flex-1">
          <Input
            placeholder="Search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
          <SelectTrigger>
            <SelectValue placeholder="Service status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active services</SelectItem>
            <SelectItem value="inactive">Inactive services</SelectItem>
            <SelectItem value="all">All services</SelectItem>
          </SelectContent>
        </Select>
      </DataViewToolbar>

      {isLoading ? (
        dataView === "table" ? (
          <ServicesTable>
            <TableRowsSkeleton rows={PAGE_SIZE} columns={5} />
          </ServicesTable>
        ) : (
          <EntityGridSkeleton count={PAGE_SIZE} />
        )
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
              <Button onClick={() => navigate("/services/new")}>
                Add your first service
              </Button>
            ) : undefined
          }
        />
      ) : dataView === "table" ? (
        <ServicesTable>
          {paginated.map((service) => {
            const ServiceIcon = getServiceIcon(service.icon);

            return (
              <TableRow
                key={service.id}
                data-tour-id={`service-card-${service.id}`}
                className="group h-16 cursor-pointer border-border/50 transition-colors hover:bg-muted/20 [&_td]:align-middle [&_td]:py-3.5"
                onClick={() => navigate(`/services/${service.id}`)}
              >
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-primary/10 text-primary">
                      <ServiceIcon className="h-4 w-4" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                        {service.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {service.description || "No description"}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-foreground/75">{service.duration} mins</TableCell>
                <TableCell className="hidden md:table-cell">
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
                </TableCell>
                <TableCell className="text-right text-sm font-semibold text-foreground">
                  {formatCurrency(service.price)}
                </TableCell>
                <TableCell className="text-center" onClick={(event) => event.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-foreground"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                        <span className="sr-only">Service actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">{serviceMenuItems(service)}</DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </ServicesTable>
      ) : (
        <div data-tour-id="services-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((service) => (
            (() => {
              const ServiceIcon = getServiceIcon(service.icon);

              return (
            <Card
              key={service.id}
              data-tour-id={`service-card-${service.id}`}
              className={cn(
                "group relative flex cursor-pointer flex-col overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99] md:min-h-[330px]",
                !service.isActive && "opacity-70",
              )}
              onClick={() => navigate(`/services/${service.id}`)}
            >
              <CardContent className="flex flex-1 flex-col gap-3 md:gap-4">
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
                      {serviceMenuItems(service)}
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

    </div>
  );
}
