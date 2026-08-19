import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle, Edit, Loader2, XCircle } from "lucide-react";
import { cancelBooking, catalogKeys, confirmBooking, fetchBooking } from "@/lib/catalog";
import { BookingStatusBadge } from "@/components/ui/status-badge";
import { PageHeader, PageEmptyState, PageOverflowMenu } from "@/components/layout/page-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/hooks/use-permissions";
import { usePageChrome } from "@/components/layout/page-chrome";
import { toast } from "sonner";
import { useMemo, useState } from "react";

type ConfirmationState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "primary" | "danger";
  onConfirm: () => void;
} | null;

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 py-4 text-sm sm:grid-cols-[160px_1fr] sm:gap-6">
      <div className="text-muted-foreground">{label}</div>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

export default function BookingDetailPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { canWriteBookings } = usePermissions();
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);

  const { data: booking, isLoading, isError } = useQuery({
    queryKey: catalogKeys.booking(id),
    queryFn: () => fetchBooking(id),
  });

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Bookings", href: "/bookings" },
        { label: booking?.clientName ?? "Booking" },
      ],
    }),
    [booking?.clientName],
  );
  usePageChrome(pageChrome);

  const confirmBookingMutation = useMutation({
    mutationFn: () => confirmBooking(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.booking(id) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() }),
      ]);
      toast("Booking confirmed");
    },
    onError: (err) => {
      toast.error("Could not confirm booking", { description: err instanceof Error ? err.message : "Something went wrong." });
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: () => cancelBooking(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.booking(id) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.bookings() }),
      ]);
      toast("Booking cancelled");
    },
    onError: (err) => {
      toast.error("Could not cancel booking", { description: err instanceof Error ? err.message : "Something went wrong." });
    },
  });

  const isMutating = confirmBookingMutation.isPending || cancelBookingMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Booking" description="Loading appointment..." />
      </div>
    );
  }

  if (isError || !booking) {
    return (
      <div className="space-y-6">
        <PageEmptyState title="Booking not found" description="This booking may have been removed." />
      </div>
    );
  }

  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const whenLabel = `${format(start, "EEEE, MMM d")} at ${format(start, "h:mm a")}`;

  // A pending booking's most urgent action is accepting it, so Confirm takes the
  // primary slot and Edit steps back to secondary. Anything already confirmed has
  // Edit as its primary action instead. Cancel is destructive and always sits in
  // the overflow menu, matching the row actions on the bookings list.
  const showConfirm = canWriteBookings && booking.status === "pending";
  const showCancel = canWriteBookings && booking.status !== "cancelled";

  const editButton = (
    <Button
      variant={showConfirm ? "outline" : "default"}
      onClick={() => navigate(`/bookings/${booking.id}/edit`)}
    >
      <Edit className="mr-2 h-4 w-4" />
      Edit
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={booking.clientName}
        description={`${booking.serviceName} with ${booking.staffName}`}
        badges={<BookingStatusBadge status={booking.status} />}
        secondaryActions={showConfirm ? editButton : null}
        primaryAction={
          canWriteBookings ? (
            showConfirm ? (
              <Button
                disabled={isMutating}
                onClick={() =>
                  setConfirmation({
                    title: "Confirm this booking?",
                    description: `Confirm ${booking.clientName}'s booking for ${whenLabel}.`,
                    confirmLabel: "Confirm booking",
                    tone: "primary",
                    onConfirm: () => confirmBookingMutation.mutate(),
                  })
                }
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Confirm
              </Button>
            ) : (
              editButton
            )
          ) : null
        }
        overflowActions={
          showCancel ? (
            <PageOverflowMenu label="Booking actions">
              <DropdownMenuItem
                className="text-destructive"
                disabled={isMutating}
                onClick={() =>
                  setConfirmation({
                    title: "Cancel this booking?",
                    description: `Cancel ${booking.clientName}'s booking for ${whenLabel}.`,
                    confirmLabel: "Cancel booking",
                    tone: "danger",
                    onConfirm: () => cancelBookingMutation.mutate(),
                  })
                }
              >
                <XCircle className="mr-2 h-4 w-4" />
                Cancel booking
              </DropdownMenuItem>
            </PageOverflowMenu>
          ) : null
        }
      />

      <Card>
        <CardContent className="divide-y">
          <DetailRow label="Client">
            <Link href={`/clients/${booking.clientId}`} className="font-medium hover:text-primary">
              {booking.clientName}
            </Link>
            <span className="text-muted-foreground">{booking.clientPhone || "No phone"}</span>
          </DetailRow>
          <DetailRow label="Service">
            <Link href={`/services/${booking.serviceId}`} className="font-medium hover:text-primary">
              {booking.serviceName}
            </Link>
          </DetailRow>
          <DetailRow label="Staff">
            {booking.staffId ? (
              <Link href={`/staff/${booking.staffId}`} className="font-medium hover:text-primary">
                {booking.staffName}
              </Link>
            ) : (
              <span className="font-medium">Unassigned</span>
            )}
          </DetailRow>
          <DetailRow label="Date">
            <Link href={`/calendar?date=${format(start, "yyyy-MM-dd")}&view=day`} className="font-medium hover:text-primary">
              {format(start, "EEEE, d MMM yyyy")}
            </Link>
          </DetailRow>
          <DetailRow label="Time">
            <span className="font-medium">{format(start, "h:mm a")} - {format(end, "h:mm a")}</span>
          </DetailRow>
          <DetailRow label="Status">
            <BookingStatusBadge status={booking.status} />
          </DetailRow>
          <DetailRow label="Amount">
            <span className="font-medium">R {booking.totalAmount.toLocaleString()}</span>
          </DetailRow>
          <DetailRow label="Deposit">
            <span className="font-medium">{booking.depositPaid ? "Paid" : "Outstanding"}</span>
          </DetailRow>
          <DetailRow label="Notes">
            <span className="whitespace-pre-wrap text-muted-foreground">{booking.notes || "No notes"}</span>
          </DetailRow>
        </CardContent>
      </Card>

      <Dialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}>
        <DialogContent className="w-[95vw] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)} disabled={isMutating}>
              Go back
            </Button>
            <Button
              variant={confirmation?.tone === "danger" ? "destructive" : "default"}
              disabled={isMutating}
              onClick={() => {
                const action = confirmation?.onConfirm;
                setConfirmation(null);
                action?.();
              }}
            >
              {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {confirmation?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
