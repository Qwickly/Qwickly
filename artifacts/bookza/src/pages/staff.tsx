import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveStaff,
  catalogKeys,
  deleteStaff,
  fetchStaff,
  unarchiveStaff,
} from "@/lib/catalog";
import { inviteStaffMember } from "@/lib/staff-invite";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { useEntitlements } from "@/hooks/use-entitlements";
import { hasSeatAvailable, formatLimit } from "@/lib/entitlements";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { DataViewToolbar, PageHeader, PageEmptyState, type DataViewMode } from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { TOUR_DEMO_STAFF, TOUR_DEMO_STAFF_ID } from "@/lib/tour-demo";
import { BackToHelpLink } from "@/components/tour/BackToHelpLink";
import { STAFF_TOUR_STEPS } from "@/lib/tour-steps";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Send,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { EntityGridSkeleton } from "@/components/skeletons/entity-card-skeleton";
import { TableRowsSkeleton } from "@/components/skeletons/table-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StatusFilter = "all" | "active" | "archived";

const PAGE_SIZE = 6;
const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-none";

const HEAD_CLASS = "h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground";

function StaffTable({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-border/70 bg-card py-0 shadow-none">
      <div className="overflow-x-auto">
        <Table className="min-w-[640px] table-fixed [&_td]:px-3 [&_th]:px-3 md:min-w-[860px] md:[&_td]:px-4 md:[&_th]:px-4">
          <colgroup>
            <col className="w-[36%] md:w-[28%]" />
            <col className="hidden md:table-column md:w-[18%]" />
            <col className="w-[20%] md:w-[14%]" />
            <col className="hidden md:table-column md:w-[12%]" />
            <col className="w-[22%] md:w-[16%]" />
            <col className="w-[48px]" />
          </colgroup>
          <TableHeader className="bg-muted/15">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>Staff member</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Contact</TableHead>
              <TableHead className={HEAD_CLASS}>Status</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Upcoming</TableHead>
              <TableHead className={`text-right ${HEAD_CLASS}`}>Revenue</TableHead>
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

export default function StaffPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [dataView, setDataView] = useState<DataViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "table",
  );
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
  // Same idea as the services list: an example team member, for the length of
  // the walkthrough only. See TOUR_DEMO_STAFF.
  const staffTourActive =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tour") === "add-staff";

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

  const filtered = [...(staffTourActive ? [TOUR_DEMO_STAFF] : []), ...(staff ?? [])].filter(
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
    // The seat check stays on the way in, so you are told before filling in a form.
    if (atSeatLimit) {
      toast.error("Staff limit reached", { description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.` });
      return;
    }
    navigate("/staff/new");
  };

  const handleArchiveStaff = async (member: StaffMember) => {
    try {
      await archiveMutation.mutateAsync(member.id);
      toast("Staff member archived", { description: `${member.name} is now inactive.` });
    } catch (err) {
      toast.error("Could not archive staff member", { description: err instanceof Error ? err.message : "Please try again" });
    }
  };

  const handleUnarchiveStaff = async (member: StaffMember) => {
    // Check staff limit when unarchiving (making active)
    if (atSeatLimit) {
      toast.error("Staff limit reached", { description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.` });
      return;
    }

    try {
      await unarchiveMutation.mutateAsync(member.id);
      toast("Staff member restored", { description: `${member.name} is active again and visible for bookings.` });
    } catch (err) {
      toast.error("Could not restore staff member", { description: err instanceof Error ? err.message : "Please try again" });
    }
  };

  const [resendingId, setResendingId] = useState<string | null>(null);

  const handleResendInvite = async (member: StaffMember) => {
    if (!member.email) {
      toast.error("No email on file", { description: "Add an email address to this staff member before inviting them." });
      return;
    }
    setResendingId(member.id);
    try {
      await inviteStaffMember(member.id);
      toast("Invite sent", { description: `${member.name} will receive an email with a temporary password to log in.` });
    } catch (err) {
      toast.error("Could not send invite", { description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setResendingId(null);
    }
  };

  const staffMenuItems = (member: StaffMember) => (
    <>
      <DropdownMenuItem onClick={() => navigate(`/staff/${member.id}/edit`)}>
        <Pencil className="w-4 h-4 mr-2" />
        Edit
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={resendingId === member.id}
        onClick={() => void handleResendInvite(member)}
      >
        <Send className="w-4 h-4 mr-2" />
        {resendingId === member.id ? "Sending…" : "Resend invite"}
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
    </>
  );

  const handleDeleteStaff = async () => {
    if (!deleteTarget) return;
    const member = deleteTarget;
    try {
      await deleteMutation.mutateAsync(member.id);
      toast("Staff member deleted", { description: `${member.name} has been permanently removed.` });
      setDeleteTarget(null);
    } catch (err) {
      toast.error("Could not delete staff member", { description: err instanceof Error
            ? err.message
            : "Please archive this staff member instead." });
    }
  };

  return (
    <div className="space-y-6">
      <TourOverlay
        tourId="add-staff"
        steps={STAFF_TOUR_STEPS}
        onFinish={() => navigate("/help")}
      />
      <BackToHelpLink />
      <PageHeader
        title="Staff"
        description="Manage your team members and their schedules."
        badges={
          <Badge
            variant="outline"
            className={cn(
              "tabular-nums font-semibold",
              atSeatLimit
                ? "border-amber-500/40 text-amber-600 dark:text-amber-500"
                : "text-muted-foreground",
            )}
          >
            <span data-tour-id="staff-seat-badge">
              {activeStaffCount} / {seatLimitLabel} {seatLimit === 1 ? "seat" : "seats"}
            </span>
          </Badge>
        }
        primaryAction={
          <Button data-tour-id="add-staff-button" onClick={openAddStaff}>
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="sr-only sm:hidden">Add staff member</span>
            <span className="hidden sm:inline">Add Staff Member</span>
          </Button>
        }
      />

      <DataViewToolbar viewMode={dataView} onViewModeChange={setDataView}>
        <div data-tour-id="staff-search" className="min-w-0 flex-1">
          <Input
            placeholder="Search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <Select value={statusFilter} onValueChange={handleFilterChange}>
          <SelectTrigger>
            <SelectValue placeholder="Staff status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            <SelectItem value="active">Active staff</SelectItem>
            <SelectItem value="archived">Archived staff</SelectItem>
          </SelectContent>
        </Select>
      </DataViewToolbar>

      {isLoading ? (
        dataView === "table" ? (
          <StaffTable>
            <TableRowsSkeleton rows={PAGE_SIZE} columns={6} />
          </StaffTable>
        ) : (
          <EntityGridSkeleton count={PAGE_SIZE} />
        )
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
              <Button onClick={openAddStaff}>
                Add Staff Member
              </Button>
            ) : undefined
          }
        />
      ) : dataView === "table" ? (
        <StaffTable>
          {paginated.map((member) => (
            <TableRow
              key={member.id}
              data-tour-id={`staff-card-${member.id}`}
              className="group h-16 cursor-pointer border-border/50 transition-colors hover:bg-muted/20 [&_td]:align-middle [&_td]:py-3.5"
              onClick={() => {
                if (member.id === TOUR_DEMO_STAFF_ID) return;
                navigate(`/staff/${member.id}`);
              }}
            >
              <TableCell>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-8 w-8 border">
                    <AvatarImage src={member.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                      {member.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                      {member.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{member.position}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground/75">{member.phone || "No phone"}</span>
                  <span className="truncate text-xs text-muted-foreground">{member.email || "No email"}</span>
                </div>
              </TableCell>
              <TableCell>
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
              </TableCell>
              <TableCell className="hidden text-sm text-foreground/75 md:table-cell">{member.upcomingBookings}</TableCell>
              <TableCell className="text-right text-sm font-semibold text-foreground">
                {formatCurrency(member.revenueGenerated)}
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
                      <span className="sr-only">Staff actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">{staffMenuItems(member)}</DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </StaffTable>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((member) => (
            <Card
              key={member.id}
              data-tour-id={`staff-card-${member.id}`}
              className={cn(
                "group relative flex cursor-pointer flex-col overflow-hidden border-2 border-primary/20 bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99] md:min-h-[330px]",
                !member.isActive && "opacity-70",
              )}
              onClick={() => {
                if (member.id === TOUR_DEMO_STAFF_ID) return;
                navigate(`/staff/${member.id}`);
              }}
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
                        <span className="sr-only">Staff actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {staffMenuItems(member)}
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
