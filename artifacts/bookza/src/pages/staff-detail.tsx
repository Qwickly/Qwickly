import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  catalogKeys,
  deleteStaff,
  fetchStaffProfile,
  updateStaff,
  updateStaffWorkingDays,
} from "@/lib/catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Phone,
  Mail,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Star,
  CalendarIcon,
  MoreHorizontal,
  Pencil,
  ClipboardList,
  Clock,
  BriefcaseBusiness,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link, useLocation } from "wouter";
import { format, isToday } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const POSITION_OPTIONS = [
  { value: "Barber", label: "Barber" },
  { value: "Stylist", label: "Stylist" },
  { value: "Nail Technician", label: "Nail Technician" },
  { value: "Therapist", label: "Therapist" },
  { value: "Manager", label: "Manager" },
  { value: "Receptionist", label: "Receptionist" },
];

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function getStatusColor(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-primary/10 text-primary border-primary/20";
    case "pending":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "cancelled":
      return "bg-[#dc4c5a]/10 text-[#b93443] border-[#dc4c5a]/20";
    case "completed":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "no_show":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function metricValue(value: number, suffix = "") {
  return value > 0 ? `${value}${suffix}` : "Not enough data";
}

export default function StaffDetailPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    position: "",
    phone: "",
    email: "",
    isActive: true,
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.staffMember(id),
    queryFn: () => fetchStaffProfile(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    const next = profile?.staffMember?.workingDays ?? [];
    setWorkingDays(next);
  }, [profile?.staffMember?.id, profile?.staffMember?.workingDays?.join(",")]);

  const weekly = useMemo(() => {
    const availability = profile?.schedule.weeklyAvailability ?? [];
    return DAYS.map((day) => {
      const saved = availability.find((item) => item.day === day);
      const isAvailable = workingDays.includes(day);
      return {
        day,
        isAvailable,
        startTime: saved?.startTime ?? "09:00",
        endTime: saved?.endTime ?? "17:00",
      };
    });
  }, [profile?.schedule.weeklyAvailability, workingDays]);

  const saveWorkingDaysMutation = useMutation({
    mutationFn: (days: string[]) => updateStaffWorkingDays(id, days),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staffMember(id) });
      toast({ title: "Working days saved" });
    },
    onError: (err) => {
      toast({
        title: "Could not save working days",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateStaff>[1]) => updateStaff(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staffMember(id) });
      toast({ title: "Staff member updated" });
      setEditOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Could not update staff member",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: () => deleteStaff(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      toast({
        title: "Staff member deleted",
        description: "They have been permanently removed.",
      });
      setDeleteOpen(false);
      navigate("/staff");
    },
    onError: (err) => {
      toast({
        title: "Could not delete staff member",
        description: err instanceof Error ? err.message : "Please archive them instead.",
        variant: "destructive",
      });
    },
  });

  const handleSaveStaff = () => {
    if (!form.name.trim() || !form.position) {
      toast({ title: "Name and position are required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      name: form.name.trim(),
      position: form.position,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      isActive: form.isActive,
    });
  };

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) return <div>Staff member not found</div>;

  const { staffMember, upcomingBookings, performanceMetrics } = profile;
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const openEdit = () => {
    setForm({
      name: staffMember.name,
      position: staffMember.position,
      phone: staffMember.phone ?? "",
      email: staffMember.email ?? "",
      isActive: staffMember.isActive,
    });
    setEditOpen(true);
  };

  const markInactive = () => {
    updateMutation.mutate({ isActive: false });
  };

  const scrollToSection = (sectionId: string) => {
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
  };

  const showManageServicesSoon = () => {
    toast({
      title: "Coming soon",
      description: "Service assignment controls are coming soon.",
    });
  };

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 bg-card">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Staff actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={openEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit staff member
        </DropdownMenuItem>
        <DropdownMenuItem onClick={showManageServicesSoon}>
          <BriefcaseBusiness className="mr-2 h-4 w-4" />
          Manage services
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => scrollToSection("weekly-schedule")}>
          <Clock className="mr-2 h-4 w-4" />
          Set availability
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!staffMember.isActive} onClick={markInactive}>
          <AlertCircle className="mr-2 h-4 w-4" />
          Mark as inactive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-[#b93443] focus:text-[#b93443]"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete staff member
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center gap-3">
        <Link href="/staff">
          <Button variant="outline" size="icon" className="h-9 w-9 bg-card shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Staff details
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage schedule, services, and performance.
          </p>
        </div>
        <div className="sm:hidden">{actionsMenu}</div>
      </div>

      <Card className="shadow-sm border-border/50">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <Avatar className="h-14 w-14 border border-border bg-card">
                <AvatarImage src={staffMember.avatarUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                  {staffMember.name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight truncate">{staffMember.name}</h2>
                  <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-primary">
                    {staffMember.position}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full",
                      staffMember.isActive
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {staffMember.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                  {staffMember.phone && (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" />
                      {staffMember.phone}
                    </span>
                  )}
                  {staffMember.email && (
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {staffMember.email}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="w-full bg-primary hover:bg-primary/90 sm:w-auto"
                onClick={() => scrollToSection("weekly-schedule")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                Edit schedule
              </Button>
              <div className="hidden sm:block">{actionsMenu}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="shadow-sm border-border/50">
          <CardContent className="p-4">
            <Star className="mb-3 h-4 w-4 text-primary" />
            <p className="text-xs font-medium text-muted-foreground">Average rating</p>
            <p className="mt-1 text-xl font-bold">
              {performanceMetrics.averageRating
                ? `${performanceMetrics.averageRating.toFixed(1)} / 5`
                : "Not enough data"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/50">
          <CardContent className="p-4">
            <CheckCircle2 className="mb-3 h-4 w-4 text-primary" />
            <p className="text-xs font-medium text-muted-foreground">Booking completion</p>
            <p className="mt-1 text-xl font-bold">{metricValue(performanceMetrics.completionRate, "%")}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/50">
          <CardContent className="p-4">
            <AlertCircle className="mb-3 h-4 w-4 text-[#b93443]" />
            <p className="text-xs font-medium text-muted-foreground">No-show rate</p>
            <p className="mt-1 text-xl font-bold">{metricValue(performanceMetrics.noShowRate, "%")}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/50">
          <CardContent className="p-4">
            <TrendingUp className="mb-3 h-4 w-4 text-primary" />
            <p className="text-xs font-medium text-muted-foreground">Revenue this month</p>
            <p className="mt-1 text-xl font-bold">{formatCurrency(performanceMetrics.revenueThisMonth)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card id="weekly-schedule" className="shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/50 py-4">
            <div>
              <CardTitle className="text-base">Weekly Schedule</CardTitle>
              <p className="text-sm text-muted-foreground">Working hours by day.</p>
            </div>
            <Button
              className="bg-primary hover:bg-primary/90"
              disabled={saveWorkingDaysMutation.isPending}
              onClick={() => saveWorkingDaysMutation.mutate(workingDays)}
            >
              {saveWorkingDaysMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {weekly.map((day) => (
                <div
                  key={day.day}
                  className={cn(
                    "grid grid-cols-[1fr_auto] items-center gap-3 p-4 sm:grid-cols-[1fr_120px_120px_auto]",
                    !day.isAvailable && "bg-muted/30",
                  )}
                >
                  <div>
                    <p className="font-semibold capitalize">{day.day}</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "mt-1 rounded-full text-xs",
                        day.isAvailable
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {day.isAvailable ? "Working" : "Off"}
                    </Badge>
                  </div>
                  <div className="hidden text-sm sm:block">
                    <p className="text-xs text-muted-foreground">Start</p>
                    <p className="font-medium">{day.isAvailable ? day.startTime : "-"}</p>
                  </div>
                  <div className="hidden text-sm sm:block">
                    <p className="text-xs text-muted-foreground">End</p>
                    <p className="font-medium">{day.isAvailable ? day.endTime : "-"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm sm:hidden">
                      <p className="font-medium">
                        {day.isAvailable ? `${day.startTime} - ${day.endTime}` : "Closed"}
                      </p>
                    </div>
                    <Switch
                      checked={day.isAvailable}
                      onCheckedChange={(checked) => {
                        setWorkingDays((current) => {
                          const next = new Set(current);
                          if (checked) next.add(day.day);
                          else next.delete(day.day);
                          return Array.from(next);
                        });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/50 overflow-hidden">
          <CardHeader className="border-b border-border/50 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Upcoming Bookings</CardTitle>
                <p className="text-sm text-muted-foreground">Next appointments for {staffMember.name}.</p>
              </div>
              <Badge variant="secondary" className="rounded-full">
                {upcomingBookings.length} upcoming
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {upcomingBookings.length === 0 ? (
              <div className="p-8 text-center">
                <CalendarIcon className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
                <h3 className="font-medium">No upcoming bookings</h3>
                <p className="mt-1 text-sm text-muted-foreground">This schedule is clear for now.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {upcomingBookings.slice(0, 8).map((booking) => {
                  const start = new Date(booking.startTime);
                  return (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate">{booking.serviceName}</p>
                          <Badge
                            variant="outline"
                            className={cn("rounded-full text-[11px] capitalize", getStatusColor(booking.status))}
                          >
                            {booking.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground truncate">
                          {booking.clientName} · {isToday(start) ? "Today" : format(start, "dd MMM")} at{" "}
                          {format(start, "HH:mm")}
                        </p>
                      </div>
                      <Link href={`/bookings?q=${encodeURIComponent(booking.clientName)}`}>
                        <Button variant="outline" size="sm" className="h-8">
                          View
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="border-t border-border/50 p-4">
              <Link href={`/bookings?q=${encodeURIComponent(staffMember.name)}`}>
                <Button variant="outline" className="w-full justify-center">
                  View all staff member bookings
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card id="assigned-services" className="shadow-sm border-border/50">
        <CardHeader className="border-b border-border/50 py-4">
          <CardTitle className="text-base">Assigned Services</CardTitle>
          <p className="text-sm text-muted-foreground">
            Service assignment controls are not live yet.
          </p>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <h3 className="font-semibold">Service assignment coming soon</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Soon you will be able to choose exactly which services this staff member can perform.
            For now, bookings can still be assigned from the booking flow.
          </p>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Staff Member</DialogTitle>
            <DialogDescription>Update this team member's details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Full Name *</Label>
                <Input
                  placeholder="e.g. Sipho Nkosi"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Position *</Label>
                <Select
                  value={form.position}
                  onValueChange={(value) => setForm((f) => ({ ...f, position: value }))}
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
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="staff@yourbusiness.co.za"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Active / visible on calendar</Label>
                <p className="text-xs text-muted-foreground">
                  Clients can book this staff member online.
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleSaveStaff}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete {staffMember.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the staff member. Staff with bookings on record cannot be deleted;
              mark them as inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-[#dc4c5a] text-white hover:bg-[#c83d4b]"
              disabled={deleteStaffMutation.isPending}
              onClick={() => deleteStaffMutation.mutate()}
            >
              {deleteStaffMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete staff member"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
