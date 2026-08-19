import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, createStaff, fetchStaff } from "@/lib/catalog";
import { inviteStaffMember } from "@/lib/staff-invite";
import { useEntitlements } from "@/hooks/use-entitlements";
import { hasSeatAvailable, formatLimit } from "@/lib/entitlements";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { CatalogStaff } from "@/types/catalog";

const emptyForm = { name: "", position: "", phone: "", email: "", isActive: true };

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
  const [form, setForm] = useState(emptyForm);

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
    if (!form.name.trim() || !form.position) {
      toast.error("Name and position are required");
      return;
    }
    if (!form.email.trim() || !form.email.includes("@")) {
      toast.error("A valid email is required", { description: "Staff members are invited to log in and view their bookings by email." });
      return;
    }
    if (atSeatLimit) {
      toast.error("Staff limit reached", { description: `You've reached your seat limit of ${seatLimitLabel} bookable staff. Add an Additional Staff seat in Billing to add more.` });
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

      setForm(emptyForm);
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
        if (!next) setForm(emptyForm);
      }}
    >
      <DialogContent className="w-[95vw] sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add Staff Member</DialogTitle>
          <DialogDescription>Add a new bookable team member to your business.</DialogDescription>
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
              <Input
                placeholder="e.g. Senior Barber"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              />
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
              <Label>Email *</Label>
              <Input
                type="email"
                required
                placeholder="staff@yourbusiness.co.za"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                They'll be emailed a temporary password to log in and view their bookings.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Active / visible on calendar</Label>
              <p className="text-xs text-muted-foreground">Inactive staff are hidden from scheduling.</p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(value) => setForm((f) => ({ ...f, isActive: value }))}
            />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
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
