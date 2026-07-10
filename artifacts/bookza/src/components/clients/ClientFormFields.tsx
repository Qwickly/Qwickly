import type { ClientType } from "@/types/catalog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ClientFormValue = {
  name: string;
  phone: string;
  email: string;
  clientType: ClientType;
  notes: string;
};

export function ClientFormFields({
  value,
  onChange,
}: {
  value: ClientFormValue;
  onChange: (next: ClientFormValue) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Full Name *</Label>
        <Input
          placeholder="e.g. Zanele Dlamini"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Phone *</Label>
          <Input
            placeholder="+27 82 000 0000"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="client@email.com"
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Input
          placeholder="Any preferences or notes…"
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </div>
    </div>
  );
}
