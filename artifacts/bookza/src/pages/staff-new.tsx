import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { catalogKeys, createStaff, fetchStaff } from "@/lib/catalog";
import { inviteStaffMember } from "@/lib/staff-invite";
import { useEntitlements } from "@/hooks/use-entitlements";
import { formatLimit, hasSeatAvailable } from "@/lib/entitlements";
import {
  StaffFormFields,
  buildStaffPayload,
  emptyStaffForm,
  validateStaffForm,
  type StaffFormValue,
} from "@/components/staff/staff-form";
import { PageHeader } from "@/components/layout/page-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export default function StaffNewPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StaffFormValue>(emptyStaffForm);

  const { data: staff } = useQuery({ queryKey: catalogKeys.staff, queryFn: fetchStaff });
  const { data: entitlements } = useEntitlements();

  // Seat limit from real entitlements. The DB trigger (migration 058) is the
  // authoritative check; this is the friendly pre-check, kept in step with the
  // one on the staff list so you cannot reach this page over your limit.
  const seatLimit = entitlements?.seats?.staff ?? null;
  const activeStaffCount = (staff ?? []).filter((member) => member.isActive).length;
  const atSeatLimit = !hasSeatAvailable(seatLimit, activeStaffCount);
  const seatLimitLabel = formatLimit(seatLimit);
  const seatLimitMessage = `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.`;

  const createMutation = useMutation({
    mutationFn: createStaff,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      toast("Staff member added", { description: `${created.name} has been saved.` });

      try {
        await inviteStaffMember(created.id);
        toast("Invite sent", {
          description: `${created.name} will receive an email with a temporary password to log in.`,
        });
      } catch (inviteErr) {
        toast.error("Staff added, but the invite email failed", {
          description:
            inviteErr instanceof Error
              ? inviteErr.message
              : "You can resend the invite from this staff member's page.",
        });
      }

      // A business's genuinely first staff member hands the list page the new id
      // so its one-time tour can spotlight the real card.
      const wasFirstStaff = (staff ?? []).length === 0;
      navigate(wasFirstStaff ? `/staff?created=${created.id}` : `/staff/${created.id}`);
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "";
      const isSeatLimit = raw.includes("staff_seat_limit_reached");
      toast.error(isSeatLimit ? "Seat limit reached" : "Could not add staff member", {
        description: isSeatLimit ? seatLimitMessage : raw || "Please try again.",
      });
    },
  });

  const handleSave = () => {
    const invalid = validateStaffForm(form);
    if (invalid) {
      toast.error("Check the form", { description: invalid });
      return;
    }
    if (atSeatLimit) {
      toast.error("Staff limit reached", { description: seatLimitMessage });
      return;
    }
    createMutation.mutate(buildStaffPayload(form));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="New staff member"
        description="Add someone who takes bookings. They'll be emailed a login for their own schedule."
      />

      <Card>
        <CardContent className="grid gap-6">
          <StaffFormFields value={form} onChange={setForm} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate("/staff")} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add staff member
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
