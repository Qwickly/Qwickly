import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveStaff,
  catalogKeys,
  createStaff,
  deleteStaff,
  fetchStaff,
  unarchiveStaff,
} from "@/lib/catalog";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  Calendar as CalendarIcon,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  ArchiveRestore,
  Archive,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { Switch } from "@/components/ui/switch";

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

  type StaffMember = NonNullable<typeof staff>[number];
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);

  const createMutation = useMutation({
    mutationFn: createStaff,
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

  const handleAddStaff = async () => {
    if (!form.name.trim() || !form.position) {
      toast({
        title: "Name and position are required",
        variant: "destructive",
      });
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: form.name.trim(),
        position: form.position,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        isActive: form.isActive,
      });
      toast({
        title: "Staff member added",
        description: `${form.name.trim()} has been saved.`,
      });
      setForm(emptyForm);
      setDialogOpen(false);
    } catch (err) {
      toast({
        title: "Could not add staff member",
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
          className="shrink-0 bg-primary hover:bg-primary/90 shadow-sm"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Staff Member
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search staff…"
            className="pl-9 bg-card"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <Tabs value={statusFilter} onValueChange={handleFilterChange}>
          <TabsList className="bg-card">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="active"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Active
            </TabsTrigger>
            <TabsTrigger
              value="archived"
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
            >
              Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
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
                onClick={() => setDialogOpen(true)}
              >
                Add Staff Member
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginated.map((member) => (
            <Card
              key={member.id}
              className="relative shadow-sm hover:shadow-md transition-shadow cursor-pointer border-border/50 group overflow-hidden"
              onClick={() => navigate(`/staff/${member.id}`)}
            >
              <div
                className={`h-24 bg-gradient-to-r ${
                  member.isActive
                    ? "from-emerald-600 to-emerald-400 dark:from-emerald-900 dark:to-emerald-800"
                    : "from-gray-400 to-gray-300 dark:from-gray-700 dark:to-gray-600"
                }`}
              />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 z-10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="w-4 h-4 text-white drop-shadow" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                >
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

              <CardContent className="p-6 pt-0 flex flex-col gap-4 relative">
                <Avatar className="w-20 h-20 border-4 border-card absolute -top-10 left-6 bg-card shadow-sm">
                  <AvatarImage src={member.avatarUrl || undefined} />
                  <AvatarFallback
                    className={
                      member.isActive
                        ? "bg-primary/10 text-primary font-bold text-xl"
                        : "bg-muted text-muted-foreground font-bold text-xl"
                    }
                  >
                    {member.name.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex justify-end pt-3">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
                      member.isActive
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {member.isActive ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="mt-1">
                  <h3 className="font-bold text-xl line-clamp-1 group-hover:text-primary transition-colors">
                    {member.name}
                  </h3>
                  <p className="text-muted-foreground text-sm font-medium mt-0.5">
                    {member.position}
                  </p>
                </div>

                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {member.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 shrink-0" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                  {member.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 shrink-0" />
                      <span className="line-clamp-1">{member.email}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-2 pt-4 border-t border-border/50">
                  <div className="bg-muted/50 rounded-lg p-3 flex flex-col gap-0.5">
                    <div className="flex items-center text-muted-foreground text-xs font-medium">
                      <CalendarIcon className="w-3 h-3 mr-1" /> Upcoming
                    </div>
                    <span className="text-xl font-semibold text-foreground">
                      {member.upcomingBookings}
                    </span>
                  </div>
                  <div className="bg-primary/5 rounded-lg p-3 flex flex-col gap-0.5 col-span-2">
                    <div className="flex items-center text-primary text-xs font-medium">
                      <TrendingUp className="w-3 h-3 mr-1" /> Revenue
                    </div>
                    <span className="text-xl font-semibold text-primary">
                      {formatCurrency(member.revenueGenerated)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-muted-foreground">
            Showing{" "}
            {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}-
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length} staff
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => p - 1)}
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
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
            <DialogDescription>
              Add a new team member to your business.
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleAddStaff}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
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
