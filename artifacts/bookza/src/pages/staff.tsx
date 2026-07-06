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
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
  ChevronLeft,
  ChevronRight,
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

// we need to addd option to make their own choice, this should rather pull from the most common
const POSITION_OPTIONS = [
  { value: "Barber", label: "Barber" },
  { value: "Stylist", label: "Stylist" },
  { value: "Nail Technician", label: "Nail Technician" },
  { value: "Therapist", label: "Therapist" },
  { value: "Manager", label: "Manager" },
  { value: "Receptionist", label: "Receptionist" },
];

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

  // Get staff limit from subscription
  const staffLimit = subscription?.metadata?.staff || 
                    subscription?.plans?.metadata?.staff || 50;

  // Count active staff members
  const activeStaffCount = (staff ?? []).filter(s => s.isActive).length;

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
    if (activeStaffCount >= staffLimit) {
      toast({
        title: "Staff limit reached",
        description: `You've reached your plan limit of ${staffLimit} staff members. Upgrade your plan to add more.`,
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
    if (!editingId && activeStaffCount >= staffLimit) {
      toast({
        title: "Staff limit reached",
        description: `You've reached your plan limit of ${staffLimit} staff members. Upgrade your plan to add more.`,
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
      toast({
        title: editingId ? "Could not update staff member" : "Could not add staff member",
        description: err instanceof Error ? err.message : "Please try again",
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
    if (activeStaffCount >= staffLimit) {
      toast({
        title: "Staff limit reached",
        description: `You've reached your plan limit of ${staffLimit} staff members. Upgrade your plan to add more.`,
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Staff
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage your team members and their schedules.
          </p>
        </div>
        <Button
          className="w-full sm:w-auto shrink-0 bg-primary hover:bg-primary/90 shadow-sm"
          onClick={openAddStaff}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Staff Member
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search staff…"
            className="pl-9 bg-card w-full"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <Select value={statusFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-full bg-card sm:w-[170px]">
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
        <Card className="border-dashed bg-card/50">
          <CardContent className="h-64 flex flex-col items-center justify-center text-center p-6">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Plus className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium">
              {search ? "No staff found" : "No staff members"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {search
                ? "Try adjusting your search."
                : "Add your first staff member to start assigning bookings."}
            </p>
            {!search && (
              <Button
                className="mt-4 bg-primary text-primary-foreground"
                onClick={openAddStaff}
              >
                Add Staff Member
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((member) => (
            <Card
              key={member.id}
              className={cn(
                "group relative cursor-pointer overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99]",
                !member.isActive && "opacity-70",
              )}
              onClick={() => navigate(`/staff/${member.id}`)}
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
                        className="text-[#c83d4b] focus:text-[#c83d4b]"
                        onClick={() => setDeleteTarget(member)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Permanently delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <Avatar className="w-12 h-12 border">
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
                        : "border-slate-200 bg-slate-100 text-slate-600",
                    )}
                  >
                    {member.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                    {member.name}
                  </h3>
                  <p className="text-sm font-medium text-muted-foreground line-clamp-1">
                    {member.position}
                  </p>
                  <div className="flex flex-col gap-1.5 mt-2 text-sm text-muted-foreground">
                    {member.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>{member.phone}</span>
                      </div>
                    )}
                    {member.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span className="line-clamp-1">{member.email}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/50 pt-4 text-sm">
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs">Upcoming</span>
                      <span className="font-semibold text-foreground">{member.upcomingBookings}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs">Revenue</span>
                      <span className="font-semibold text-foreground">{formatCurrency(member.revenueGenerated)}</span>
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-primary/70 transition-all group-hover:gap-2 group-hover:text-primary">
                    <span>View Profile</span>
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center sm:justify-between gap-4 mt-6">
          <p className="text-sm text-muted-foreground">
            Showing{" "}
            {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}-
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length} staff
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
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
                <Select
                  value={form.position}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, position: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  Clients can book this staff member online.
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, isActive: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto order-2 sm:order-1">
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 order-1 sm:order-2"
              onClick={handleSaveStaff}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : editingId ? (
                "Save changes"
              ) : (
                "Add Staff Member"
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
