import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  catalogKeys,
  fetchServiceProfile,
  updateService,
} from "@/lib/catalog";
import {
  ServiceFormFields,
  getServiceIcon,
  buildServicePayload,
  validateServiceForm,
  formFromService,
  emptyServiceForm,
} from "@/components/services/service-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  Loader2,
  ArrowLeft,
  ArrowRight,
  Clock,
  Wallet,
  TrendingUp,
  CalendarClock,
  ClipboardList,
  CheckCircle2,
  Pencil,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const statusBadgeClass = "rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize shadow-none";

function getStatusColor(status: string) {
  switch (status) {
    case "confirmed": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "pending": return "border-amber-200 bg-amber-50 text-amber-700";
    case "completed": return "border-primary/20 bg-primary/10 text-primary";
    case "cancelled": return "border-[#f4c7cd] bg-[#fff1f3] text-[#c83d4b]";
    case "no_show": return "border-slate-200 bg-slate-100 text-slate-600";
    default: return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export default function ServiceDetailPage({ id }: { id: string }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.service(id),
    queryFn: () => fetchServiceProfile(id),
    enabled: Boolean(id),
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(emptyServiceForm);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: catalogKeys.service(id) });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.services });
  };

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateService>[1]) => updateService(id, input),
    onSuccess: () => {
      invalidate();
      toast({ title: "Service updated" });
      setEditOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Could not update service",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) => {
      const base = profile ? buildServicePayload(formFromService(profile.service)) : null;
      if (!base) throw new Error("Service not loaded");
      return updateService(id, { ...base, isActive });
    },
    onSuccess: (_data, isActive) => {
      invalidate();
      toast({ title: isActive ? "Service restored" : "Service archived" });
    },
    onError: (err) => {
      toast({
        title: "Could not update service",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) return <div>Service not found</div>;

  const { service, metrics, recentBookings, staff } = profile;
  const ServiceIcon = getServiceIcon(service.icon);
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const openEdit = () => {
    setForm(formFromService(service));
    setEditOpen(true);
  };

  const detailRows: Array<{ label: string; value: string }> = [
    { label: "Duration", value: `${service.duration} min` },
    { label: "Price", value: formatCurrency(service.price) },
    { label: "Revenue this month", value: formatCurrency(metrics.revenueThisMonth) },
    { label: "Status", value: service.isActive ? "Active" : "Inactive" },
  ];

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/services">
            <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Services
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Button className="bg-primary text-white hover:bg-primary/90" onClick={openEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10 bg-card">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Service actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {service.isActive ? (
                  <DropdownMenuItem
                    className="text-[#c83d4b] focus:text-[#c83d4b]"
                    onClick={() => activeMutation.mutate(false)}
                  >
                    <Archive className="mr-2 h-4 w-4" /> Archive service
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => activeMutation.mutate(true)}>
                    <ArchiveRestore className="mr-2 h-4 w-4" /> Restore service
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border bg-primary/10 text-primary">
            <ServiceIcon className="h-7 w-7" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{service.name}</h1>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  service.isActive
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {service.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary/60" />{service.duration} min</span>
              <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4 text-primary/60" />{formatCurrency(service.price)}</span>
            </div>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
          {[
            { label: "Total bookings", value: metrics.totalBookings > 0 ? metrics.totalBookings.toString() : "None yet", empty: metrics.totalBookings === 0, icon: ClipboardList },
            { label: "Completed", value: metrics.completedBookings > 0 ? metrics.completedBookings.toString() : "None yet", empty: metrics.completedBookings === 0, icon: CheckCircle2 },
            { label: "Upcoming", value: metrics.upcomingBookings > 0 ? metrics.upcomingBookings.toString() : "None scheduled", empty: metrics.upcomingBookings === 0, icon: CalendarClock },
            { label: "Revenue", value: metrics.revenue > 0 ? formatCurrency(metrics.revenue) : "No revenue yet", empty: metrics.revenue === 0, icon: TrendingUp },
          ].map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="flex flex-col gap-1 bg-card p-3.5 sm:gap-1.5 sm:p-5">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <p className="truncate text-[10px] font-medium uppercase tracking-wider sm:text-[11px]">{metric.label}</p>
                </div>
                <p className={`truncate font-semibold ${metric.empty ? "text-sm text-muted-foreground/70 sm:text-sm" : "text-base text-foreground sm:text-lg"}`}>{metric.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-lg">Recent Bookings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentBookings.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No bookings for this service yet.</div>
            ) : (
              <div className="divide-y divide-border/50">
                {recentBookings.map((booking) => (
                  <div key={booking.id} className="flex items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{booking.clientName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {format(new Date(booking.startTime), "MMM d, yyyy")} at {format(new Date(booking.startTime), "h:mm a")}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{booking.staffName}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge variant="outline" className={`${statusBadgeClass} ${getStatusColor(booking.status)}`}>
                        {booking.status.replace("_", " ")}
                      </Badge>
                      <p className="text-sm font-semibold text-foreground">{formatCurrency(booking.totalAmount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-lg">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                {service.description || "No description provided."}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {detailRows.map((row) => (
                  <div key={row.label} className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{row.label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">{row.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="text-lg">Performed by</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {staff.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No staff have performed this service yet.</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {staff.map((member) => (
                    <Link key={member.id} href={`/staff/${member.id}`}>
                      <div className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-9 w-9 border">
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {member.name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {member.bookings} {member.bookings === 1 ? "booking" : "bookings"}
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit service</DialogTitle>
            <DialogDescription>Update the details for this service.</DialogDescription>
          </DialogHeader>
          <ServiceFormFields form={form} setForm={setForm} idPrefix="edit-" />
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
              disabled={updateMutation.isPending || !form.name.trim() || !form.price}
              onClick={() => {
                const error = validateServiceForm(form);
                if (error) {
                  toast({ title: "Check the form", description: error, variant: "destructive" });
                  return;
                }
                updateMutation.mutate(buildServicePayload(form));
              }}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
