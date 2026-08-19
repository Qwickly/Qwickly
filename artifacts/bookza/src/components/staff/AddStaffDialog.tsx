import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, createStaff, fetchStaff } from "@/lib/catalog";
import { inviteStaffMember } from "@/lib/staff-invite";
import { useEntitlements } from "@/hooks/use-entitlements";
import { hasSeatAvailable, formatLimit } from "@/lib/entitlements";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import {
  StaffFormFields,
  buildStaffPayload,
  emptyStaffForm,
  validateStaffForm,
  type StaffFormValue,
} from "@/components/staff/staff-form";
import type { CatalogStaff } from "@/types/catalog";

/**
 * The "add bookable staff member" form — same create+invite flow as
 * pages/staff.tsx (createStaff then inviteStaffMember), packaged so it can
 * also be opened from the Settings > Team tab without duplicating the form.
 */
export function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (staff: CatalogStaff) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StaffFormValue>(emptyStaffForm);

  const { data: staff } = useQuery({ queryKey: catalogKeys.staff, queryFn: fetchStaff });
  const { data: entitlements } = useEntitlements();
  const seatLimit = entitlements?.seats?.staff ?? null;
  const activeStaffCount = (staff ?? []).filter((s) => s.isActive).length;
  const atSeatLimit = !hasSeatAvailable(seatLimit, activeStaffCount);
  const seatLimitLabel = formatLimit(seatLimit);

  const createMutation = useMutation({
    mutationFn: createStaff,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
  });

  const handleSave = async () => {
    const invalid = validateStaffForm(form);
    if (invalid) {
      toast.error("Check the form", { description: invalid });
      return;
    }
    if (atSeatLimit) {
      toast.error("Staff limit reached", { description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.` });
      return;
    }

    const input = buildStaffPayload(form);

    try {
      const created = await createMutation.mutateAsync(input);
      toast("Staff member added", { description: `${input.name} has been saved.` });
      onCreated?.(created);

      try {
        await inviteStaffMember(created.id);
        toast("Invite sent", { description: `${input.name} will receive an email with a temporary password to log in.` });
      } catch (inviteErr) {
        toast.error("Staff added, but the invite email failed", { description: inviteErr instanceof Error
              ? inviteErr.message
              : "You can resend the invite from the Staff page." });
      }

      setForm(emptyStaffForm());
      onOpenChange(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const isSeatLimit = raw.includes("staff_seat_limit_reached");
      toast.error(isSeatLimit ? "Seat limit reached" : "Could not add staff member", { description: isSeatLimit
          ? `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.`
          : raw || "Please try again" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setForm(emptyStaffForm());
      }}
    >
      <DialogContent className="w-[95vw] sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add Staff Member</DialogTitle>
          <DialogDescription>Add a new bookable team member to your business.</DialogDescription>
        </DialogHeader>
        <StaffFormFields value={form} onChange={setForm} />
        <DialogFooter>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={() => void handleSave()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add staff"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
