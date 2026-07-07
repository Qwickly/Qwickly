import type { LucideIcon } from "lucide-react";
import {
  Scissors,
  Sparkles,
  Hand,
  Palette,
  Droplets,
  Brush,
  Eye,
  Paintbrush,
  SprayCan,
  Gem,
  Crown,
  Star,
  HeartPulse,
  Dumbbell,
  Flower2,
  Bath,
  Footprints,
  Leaf,
  Waves,
  HandHeart,
  Smile,
  UserRound,
  ChevronDown,
} from "lucide-react";
import type { CatalogService, ServiceInput } from "@/types/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const SERVICE_COLOR = "#10b981";
export const SERVICE_ICON = "scissors";

export const SERVICE_ICON_OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "scissors", label: "Hair", icon: Scissors },
  { value: "sparkles", label: "Beauty", icon: Sparkles },
  { value: "hand", label: "Nails", icon: Hand },
  { value: "palette", label: "Makeup", icon: Palette },
  { value: "droplets", label: "Spa", icon: Droplets },
  { value: "brush", label: "Lashes", icon: Brush },
  { value: "eye", label: "Brows", icon: Eye },
  { value: "paintbrush", label: "Colour", icon: Paintbrush },
  { value: "spray-can", label: "Tan", icon: SprayCan },
  { value: "gem", label: "Luxury", icon: Gem },
  { value: "crown", label: "Premium", icon: Crown },
  { value: "star", label: "Featured", icon: Star },
  { value: "heart-pulse", label: "Wellness", icon: HeartPulse },
  { value: "dumbbell", label: "Fitness", icon: Dumbbell },
  { value: "flower", label: "Massage", icon: Flower2 },
  { value: "bath", label: "Bath", icon: Bath },
  { value: "footprints", label: "Feet", icon: Footprints },
  { value: "leaf", label: "Natural", icon: Leaf },
  { value: "waves", label: "Relax", icon: Waves },
  { value: "hand-heart", label: "Care", icon: HandHeart },
  { value: "smile", label: "Consult", icon: Smile },
  { value: "user", label: "Personal", icon: UserRound },
];

export function getServiceIcon(icon?: string): LucideIcon {
  return SERVICE_ICON_OPTIONS.find((option) => option.value === icon)?.icon ?? Scissors;
}

export function getServiceIconOption(icon?: string) {
  return SERVICE_ICON_OPTIONS.find((option) => option.value === icon) ?? SERVICE_ICON_OPTIONS[0];
}

export type ServiceFormState = {
  name: string;
  description: string;
  duration: string;
  price: string;
  icon: string;
  isActive: boolean;
};

export const emptyServiceForm = (): ServiceFormState => ({
  name: "",
  description: "",
  duration: "60",
  price: "",
  icon: SERVICE_ICON,
  isActive: true,
});

export function formFromService(service: CatalogService): ServiceFormState {
  return {
    name: service.name,
    description: service.description ?? "",
    duration: String(service.duration),
    price: String(service.price),
    icon: service.icon ?? SERVICE_ICON,
    isActive: service.isActive,
  };
}

export function buildServicePayload(form: ServiceFormState): ServiceInput {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    duration: Number(form.duration),
    price: Number(form.price),
    icon: form.icon,
    color: SERVICE_COLOR,
    isActive: form.isActive,
  };
}

export function validateServiceForm(form: ServiceFormState): string | null {
  if (!form.name.trim()) return "Service name is required.";
  if (!form.price || Number(form.price) < 0) return "Enter a valid price.";
  if (!form.duration || Number(form.duration) < 5) return "Duration must be at least 5 minutes.";
  return null;
}

export function ServiceFormFields({
  form,
  setForm,
  idPrefix = "",
}: {
  form: ServiceFormState;
  setForm: React.Dispatch<React.SetStateAction<ServiceFormState>>;
  idPrefix?: string;
}) {
  const selectedIcon = getServiceIconOption(form.icon);
  const SelectedIcon = selectedIcon.icon;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}name`}>Service name *</Label>
        <Input
          id={`${idPrefix}name`}
          placeholder="e.g. Haircut & Style"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}description`}>Description</Label>
        <Textarea
          id={`${idPrefix}description`}
          placeholder="Describe what's included in this service…"
          rows={4}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Service icon</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full justify-between rounded-lg border-border/70 bg-background px-3 font-normal shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <SelectedIcon className="h-4 w-4" />
                </span>
                <span className="text-sm">{selectedIcon.label}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Choose an icon</p>
              <p className="text-xs text-muted-foreground">{SERVICE_ICON_OPTIONS.length} options</p>
            </div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
              {SERVICE_ICON_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = form.icon === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    className={cn(
                      "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border bg-card text-[10px] font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
                      selected && "border-primary bg-primary/10 text-primary ring-2 ring-primary/15",
                    )}
                    onClick={() => setForm((f) => ({ ...f, icon: option.value }))}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="max-w-full truncate px-1">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}duration`}>Duration (minutes) *</Label>
          <Input
            id={`${idPrefix}duration`}
            type="number"
            min="5"
            step="5"
            value={form.duration}
            onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}price`}>Price (R) *</Label>
          <Input
            id={`${idPrefix}price`}
            type="number"
            min="0"
            placeholder="0"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
        <div>
          <Label htmlFor={`${idPrefix}is-active`} className="font-medium">Active service</Label>
          <p className="mt-1 text-xs text-muted-foreground">Active services can be booked by clients.</p>
        </div>
        <Switch
          id={`${idPrefix}is-active`}
          checked={form.isActive}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
        />
      </div>
    </div>
  );
}
