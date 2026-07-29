import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveStaff,
  catalogKeys,
  createStaff,
  deleteStaff,
  fetchStaff,
  unarchiveStaff,
  updateStaff,
} from "@/lib/catalog";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { useEntitlements } from "@/hooks/use-entitlements";
import { hasSeatAvailable, formatLimit } from "@/lib/entitlements";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageEmptyState } from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { STAFF_TOUR_STEPS } from "@/lib/tour-steps";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Plus,
  Loader2,
  Phone,
  Mail,
  MoreHorizontal,
  ArchiveRestore,
  Archive,
  Trash2,
  Pencil,
  ArrowRight,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { EntityGridSkeleton } from "@/components/skeletons/entity-card-skeleton";

type StatusFilter = "all" | "active" | "archived";

const emptyForm = {
  name: "",
  position: "",
  phone: "",
  email: "",
  isActive: true,
};

const PAGE_SIZE = 6;
const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-none";

export default function StaffPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [, navigate] = useLocation();

  const { data: staff, isLoading } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  // Seat limit from real entitlements: base plan staff + purchased Additional
  // Staff seats. `null` = unlimited. This used to read a stale metadata flag that
  // defaulted to 50 and ignored purchased seats. The DB trigger (migration 058)
  // is the authoritative enforcement; this is the friendly pre-check.
  const { data: entitlements } = useEntitlements();
  const seatLimit = entitlements?.seats?.staff ?? null;

  // Count active staff members
  const activeStaffCount = (staff ?? []).filter(s => s.isActive).length;
  const atSeatLimit = !hasSeatAvailable(seatLimit, activeStaffCount);
  const seatLimitLabel = formatLimit(seatLimit);

  type StaffMember = NonNullable<typeof staff>[number];
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createStaff,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; input: Parameters<typeof updateStaff>[1] }) =>
      updateStaff(vars.id, vars.input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveStaff,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
  });

  const unarchiveMutation = useMutation({
    mutationFn: unarchiveStaff,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStaff,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleFilterChange = (value: string) => {
    setStatusFilter(value as StatusFilter);
    setCurrentPage(1);
  };

  const filtered = (staff ?? []).filter(
    (s) =>
      (statusFilter === "all" ||
        (statusFilter === "active" ? s.isActive : !s.isActive)) &&
      (!search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.position.toLowerCase().includes(search.toLowerCase())),
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const openAddStaff = () => {
    // Check staff limit before opening dialog
    if (atSeatLimit) {
      toast({
        title: "Staff limit reached",
        description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.`,
        variant: "destructive",
      });
      return;
    }
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEditStaff = (member: StaffMember) => {
    setForm({
      name: member.name,
      position: member.position,
      phone: member.phone ?? "",
      email: member.email ?? "",
      isActive: member.isActive,
    });
    setEditingId(member.id);
    setDialogOpen(true);
  };

  const handleSaveStaff = async () => {
    if (!form.name.trim() || !form.position) {
      toast({
        title: "Name and position are required",
        variant: "destructive",
      });
      return;
    }

    // Check staff limit when adding new staff
    if (!editingId && atSeatLimit) {
      toast({
        title: "Staff limit reached",
        description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.`,
        variant: "destructive",
      });
      return;
    }

    const input = {
      name: form.name.trim(),
      position: form.position,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      isActive: form.isActive,
    };
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, input });
        toast({ title: "Staff member updated", description: `${input.name} has been saved.` });
      } else {
        await createMutation.mutateAsync(input);
        toast({ title: "Staff member added", description: `${input.name} has been saved.` });
      }
      setForm(emptyForm);
      setEditingId(null);
      setDialogOpen(false);
    } catch (err) {
      // The DB seat-limit trigger (migration 058) is the authoritative check —
      // catch it here in case the pre-check was bypassed or entitlements were
      // stale, and show the same friendly guidance rather than the raw SQL error.
      const raw = err instanceof Error ? err.message : "";
      const isSeatLimit = raw.includes("staff_seat_limit_reached");
      toast({
        title: isSeatLimit
          ? "Seat limit reached"
          : editingId ? "Could not update staff member" : "Could not add staff member",
        description: isSeatLimit
          ? `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.`
          : raw || "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleArchiveStaff = async (member: StaffMember) => {
    try {
      await archiveMutation.mutateAsync(member.id);
      toast({
        title: "Staff member archived",
        description: `${member.name} is now inactive.`,
      });
    } catch (err) {
      toast({
        title: "Could not archive staff member",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleUnarchiveStaff = async (member: StaffMember) => {
    // Check staff limit when unarchiving (making active)
    if (atSeatLimit) {
      toast({
        title: "Staff limit reached",
        description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.`,
        variant: "destructive",
      });
      return;
    }

    try {
      await unarchiveMutation.mutateAsync(member.id);
      toast({
        title: "Staff member restored",
        description: `${member.name} is active again and visible for bookings.`,
      });
    } catch (err) {
      toast({
        title: "Could not restore staff member",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDeleteStaff = async () => {
    if (!deleteTarget) return;
    const member = deleteTarget;
    try {
      await deleteMutation.mutateAsync(member.id);
      toast({
        title: "Staff member deleted",
        description: `${member.name} has been permanently removed.`,
      });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete staff member",
        description:
          err instanceof Error
            ? err.message
            : "Please archive this staff member instead.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <TourOverlay tourId="add-staff" steps={STAFF_TOUR_STEPS} />
      <PageHeader
        title="Staff"
        description="Manage your team members and their schedules."
        actions={
          <>
            {/* Bookable-seat usage. Mirrors entitlements.seats.staff (null =
                unlimited); turns amber once every seat is filled so the limit is
                visible before someone hits the "Add Staff" wall. */}
            <Badge
              variant="outline"
              className={cn(
                "tabular-nums font-semibold",
                atSeatLimit
                  ? "border-amber-500/40 text-amber-600 dark:text-amber-500"
                  : "text-muted-foreground",
              )}
            >
              {activeStaffCount} / {seatLimitLabel} {seatLimit === 1 ? "seat" : "seats"}
            </Badge>
            <Button
              data-tour-id="add-staff-button"
              className="w-full sm:w-auto shrink-0 bg-primary hover:bg-primary/90 shadow-sm"
              onClick={openAddStaff}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Staff Member
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search staff…"
            className="w-full pl-9"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <Select value={statusFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue placeholder="Staff status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            <SelectItem value="active">Active staff</SelectItem>
            <SelectItem value="archived">Archived staff</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <EntityGridSkeleton count={PAGE_SIZE} />
      ) : filtered.length === 0 ? (
        <PageEmptyState
          icon={Plus}
          title={search ? "No staff found" : "No staff members"}
          description={
            search
              ? "Try adjusting your search."
              : "Add your first staff member to start assigning bookings."
          }
          actions={
            !search ? (
              <Button className="bg-primary text-primary-foreground" onClick={openAddStaff}>
                Add Staff Member
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((member) => (
            <Card
              key={member.id}
              className={cn(
                "group relative flex cursor-pointer flex-col overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99] md:min-h-[330px]",
                !member.isActive && "opacity-70",
              )}
              onClick={() => navigate(`/staff/${member.id}`)}
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
                        <span className="sr-only">Staff actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditStaff(member)}>
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      {member.isActive ? (
                        <DropdownMenuItem
                          disabled={archiveMutation.isPending}
                          onClick={() => void handleArchiveStaff(member)}
                        >
                          <Archive className="w-4 h-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          disabled={unarchiveMutation.isPending}
                          onClick={() => void handleUnarchiveStaff(member)}
                        >
                          <ArchiveRestore className="w-4 h-4 mr-2" />
                          Unarchive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(member)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Permanently delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start justify-between gap-3 pr-9 md:pr-10">
                  <Avatar className="h-10 w-10 border md:h-12 md:w-12">
                    <AvatarImage src={member.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {member.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Badge
                    variant="outline"
                    className={cn(
                      statusBadgeClass,
                      member.isActive
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {member.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col">
                  <h3 className="line-clamp-1 text-base font-semibold transition-colors group-hover:text-primary md:text-lg">
                    {member.name}
                  </h3>
                  <p className="text-sm font-medium text-muted-foreground line-clamp-1">
                    {member.position}
                  </p>
                  <div className="mt-1.5 flex flex-col gap-1 text-sm text-muted-foreground md:mt-2 md:min-h-[50px] md:gap-1.5">
                    {member.phone && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{member.phone}</span>
                      </div>
                    )}
                    {member.email && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{member.email}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-auto space-y-2 border-t border-border/50 pt-3 text-sm md:space-y-3 md:pt-4">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary/15 bg-primary/5 p-2.5 md:gap-3 md:rounded-xl md:p-3">
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-muted-foreground">Upcoming</span>
                      <span className="mt-1 block truncate font-semibold text-foreground">{member.upcomingBookings}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-medium text-muted-foreground">Revenue</span>
                      <span className="mt-1 block truncate font-semibold text-foreground">{formatCurrency(member.revenueGenerated)}</span>
                    </div>
                  </div>
                  <div className="flex w-full items-center justify-end gap-1 text-xs font-medium text-primary/70 transition-all group-hover:gap-2 group-hover:text-primary">
                    <span>View Profile</span>
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EntityListPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        totalCount={filtered.length}
        pageSize={PAGE_SIZE}
        itemLabel="staff members"
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="w-[95vw] sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Staff Member" : "Add Staff Member"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this team member's details."
                : "Add a new team member to your business."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Full Name *</Label>
                <Input
                  placeholder="e.g. Sipho Nkosi"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Position *</Label>
                <Input
                  placeholder="e.g. Senior Barber"
                  value={form.position}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, position: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  placeholder="+27 82 000 0000"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="staff@yourbusiness.co.za"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">
                  Active / visible on calendar
                </Label>
                <p className="text-xs text-muted-foreground">
                  Inactive staff are hidden from scheduling.
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(value) =>
                  setForm((f) => ({ ...f, isActive: value }))
                }
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              onClick={handleSaveStaff}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : editingId ? (
                "Save changes"
              ) : (
                "Add staff"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {deleteTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. It only works if this staff member has
              no bookings — if they do, archive them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteStaff();
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
