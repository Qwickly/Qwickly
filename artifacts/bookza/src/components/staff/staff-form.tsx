import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type StaffFormValue = {
  name: string;
  position: string;
  phone: string;
  email: string;
  isActive: boolean;
};

export const emptyStaffForm = (): StaffFormValue => ({
  name: "",
  position: "",
  phone: "",
  email: "",
  isActive: true,
});

export function staffFormFromMember(member: {
  name: string;
  position: string;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
}): StaffFormValue {
  return {
    name: member.name,
    position: member.position,
    phone: member.phone ?? "",
    email: member.email ?? "",
    isActive: member.isActive,
  };
}

export function buildStaffPayload(form: StaffFormValue) {
  return {
    name: form.name.trim(),
    position: form.position,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    isActive: form.isActive,
  };
}

export function validateStaffForm(form: StaffFormValue): string | null {
  if (!form.name.trim() || !form.position.trim()) return "Name and position are required.";
  // Staff log in to see their own bookings, so the invite email is not optional.
  if (!form.email.trim() || !form.email.includes("@")) return "A valid email address is required.";
  return null;
}

/**
 * The five staff fields, shared by the add dialog in Settings and the
 * new/edit staff pages. These were copy-pasted in three places and had already
 * started to drift.
 */
export function StaffFormFields({
  value,
  onChange,
}: {
  value: StaffFormValue;
  onChange: (next: StaffFormValue) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-2">
          <Label>Full Name *</Label>
          <Input
            placeholder="e.g. Sipho Nkosi"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Position *</Label>
          <Input
            placeholder="e.g. Senior Barber"
            value={value.position}
            onChange={(e) => onChange({ ...value, position: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input
            placeholder="+27 82 000 0000"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>Email *</Label>
          <Input
            type="email"
            required
            placeholder="staff@yourbusiness.co.za"
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            They'll be emailed a temporary password to log in and view their bookings.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label className="font-medium">Active / visible on calendar</Label>
          <p className="text-xs text-muted-foreground">Inactive staff are hidden from scheduling.</p>
        </div>
        <Switch
          checked={value.isActive}
          onCheckedChange={(isActive) => onChange({ ...value, isActive })}
        />
      </div>
    </div>
  );
}
