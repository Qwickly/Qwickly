import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SettingsPanelProps = {
  children: ReactNode;
  className?: string;
};

export const settingsSectionNavCardClass = "flex flex-col gap-1 p-2";

export const settingsSectionTabsListClass =
  "flex h-auto w-full flex-col items-stretch justify-start gap-1 rounded-none border-none bg-transparent p-0";

export const settingsSectionTabsTriggerClass =
  "group w-full justify-start gap-2.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 data-[state=active]:border-border/60 data-[state=active]:bg-muted/80 data-[state=active]:text-foreground data-[state=active]:shadow-none";

export const settingsSectionNavButtonClass =
  "group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/60";

export const settingsSectionNavButtonActiveClass =
  "border-border/60 bg-muted/80 text-foreground shadow-none";

export const settingsSectionNavIconClass = "h-4 w-4 shrink-0 text-muted-foreground";

export const settingsSectionNavIconActiveClass = "text-foreground";

/**
 * A Card, and now literally one.
 *
 * This was a bare <div> impersonating a card, and it is why every panel on the
 * settings page looked like a different material from every other card in the
 * app. It carried its own radius (rounded-2xl against Card's rounded-xl), its
 * own border alpha, its own shadow, and — the visible part — `bg-card` plus
 * ``, so the panel was translucent. Against the flat white page
 * that used to be behind it you could not tell; against the gradient shell it
 * reads as frosted glass, which is the bug.
 *
 * There was also a `md:` twist that swapped the fill to `bg-card` and
 * dropped the shadow, so the panel was one material on a phone and another on a
 * desktop.
 *
 * Keeps Card's base padding and gap so settings panels follow the same shadcn
 * surface rules as the rest of the app.
 */
export function SettingsPanel({ children, className }: SettingsPanelProps) {
  return <Card className={cn("overflow-hidden", className)}>{children}</Card>;
}

/**
 * Groups rows inside a {@link SettingsPanel}. Draws no box of its own.
 *
 * It used to be `rounded-2xl border border-border/45 bg-muted/20` — a bordered,
 * filled, rounded box sitting inside a Card that is already a bordered, filled,
 * rounded box. With a tile inside it (the WhatsApp connect steps) that is three
 * nested frames for one list, which is what made these pages read as cards
 * stacked on cards.
 *
 * `-mx-6` cancels CardContent's `px-6` so the row dividers reach the panel edge
 * instead of stopping short of it, and `[&>*]:px-6` puts that padding back on
 * the rows themselves so their text still lines up with the CardHeader above.
 * Doing it here rather than in SettingsRow is deliberate: booking-page.tsx uses
 * SettingsToggleRow outside any group, and those rows must keep their own
 * padding.
 */
export function SettingsGroup({ children, className }: SettingsPanelProps) {
  return (
    <div className={cn("-mx-6 overflow-hidden [&>*]:px-6", className)}>
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
  "data-tour-id": dataTourId,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  "data-tour-id"?: string;
}) {
  return (
    <div
      data-tour-id={dataTourId}
      className={cn(
        "flex flex-col gap-3 border-t border-border/45 px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <Label className="text-sm font-semibold text-foreground">{title}</Label>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className="min-w-0 w-full sm:w-auto sm:max-w-xs sm:shrink-0">{children}</div>}
    </div>
  );
}

export function SettingsToggleRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
  "data-tour-id": dataTourId,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  "data-tour-id"?: string;
}) {
  return (
    <SettingsRow title={title} description={description} data-tour-id={dataTourId}>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="shrink-0"
      />
    </SettingsRow>
  );
}

export function SettingsNumberUnitField({
  value,
  unit,
  min = 0,
  onChange,
}: {
  value: number;
  unit: string;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    // Shaped like the stock Input beside it: same h-9, rounded-md, border-input
    // and focus ring. It previously carried its own rounded-xl, an inset
    // highlight shadow and a primary-tinted focus glow, so a number field looked
    // like a different control from every other field on the page.
    <div className="flex w-full items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 sm:w-48 dark:bg-input/30">
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 min-w-0 flex-1 border-0 bg-transparent px-3 py-1 text-base outline-none md:text-sm"
      />
      <span className="flex h-9 items-center border-l border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

export function SettingsSegmentedControl<T extends string>({
  value,
  options,
  disabled,
  className,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className={cn(
        // Opaque `bg-muted`, not `bg-muted/70`: a translucent track let the
        // shell gradient through the card it sits on.
        "flex min-w-0 items-center justify-center gap-1 rounded-md bg-muted p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          data-tour-id={`segment-${option.value}`}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 min-w-0 flex-1 rounded-sm px-3 text-sm font-medium leading-none transition-[background-color,box-shadow,color] disabled:cursor-not-allowed disabled:opacity-50",
            value === option.value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="block truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
