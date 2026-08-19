import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchMyBookings, fetchMyStaffMembership, staffUpdateBookingStatus } from "@/lib/staff-portal";
import { StaffPortalShell } from "@/components/staff-portal/StaffPortalShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { Calendar, Loader2, User } from "lucide-react";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StaffMyBookingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: membership, isLoading: membershipLoading } = useQuery({
    queryKey: ["staff-membership", user?.id],
    queryFn: () => fetchMyStaffMembership(user!.id),
    enabled: Boolean(user?.id),
  });

  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ["staff-my-bookings", membership?.id],
    queryFn: () => fetchMyBookings(membership!.id),
    enabled: Boolean(membership?.id),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: "completed" | "no_show" }) =>
      staffUpdateBookingStatus(vars.id, vars.status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-my-bookings", membership?.id] }),
  });

  const handleUpdateStatus = async (id: string, status: "completed" | "no_show") => {
    setPendingId(id);
    try {
      await statusMutation.mutateAsync({ id, status });
      toast(status === "completed" ? "Marked as completed" : "Marked as no-show");
    } catch (err) {
      toast.error("Could not update booking", { description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setPendingId(null);
    }
  };

  const isLoading = membershipLoading || bookingsLoading;
  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) => b.status !== "cancelled" && b.status !== "completed" && b.status !== "no_show" && new Date(b.startTime).getTime() >= now,
  );
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b));

  return (
    <StaffPortalShell staffName={membership?.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bookings assigned to you{membership?.name ? `, ${membership.name}` : ""}.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (bookings ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">No bookings yet</p>
            <p className="text-sm text-muted-foreground">Bookings assigned to you will show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h2>
              {upcoming.map((booking) => (
                <Card key={booking.id}>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-semibold">{booking.clientName}</span>
                        <BookingStatusBadge status={booking.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">{booking.serviceName}</p>
                      <p className="text-sm text-muted-foreground">{formatDateTime(booking.startTime)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingId === booking.id}
                        onClick={() => void handleUpdateStatus(booking.id, "completed")}
                      >
                        Mark completed
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingId === booking.id}
                        onClick={() => void handleUpdateStatus(booking.id, "no_show")}
                      >
                        No-show
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Past</h2>
              {past.map((booking) => (
                <Card key={booking.id} className="opacity-80">
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-semibold">{booking.clientName}</span>
                        <BookingStatusBadge status={booking.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">{booking.serviceName}</p>
                      <p className="text-sm text-muted-foreground">{formatDateTime(booking.startTime)}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}
        </div>
      )}
    </StaffPortalShell>
  );
}
