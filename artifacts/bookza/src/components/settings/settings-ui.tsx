import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SettingsPanelProps = {
  children: ReactNode;
  className?: string;
};

export function SettingsPanel({ children, className }: SettingsPanelProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/55 bg-white/80 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] backdrop-blur-xl md:border-border/60 md:bg-card/75 md:shadow-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsGroup({ children, className }: SettingsPanelProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/45 bg-muted/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
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
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingsRow title={title} description={description}>
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
    <div className="flex w-full items-center overflow-hidden rounded-xl border border-border/80 bg-background/90 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),inset_0_1px_0_hsl(var(--background)/0.8)] focus-within:border-primary/70 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.10),0_1px_2px_hsl(var(--foreground)/0.04)] sm:w-48">
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3.5 py-2 text-base outline-none md:text-sm"
      />
      <span className="flex h-11 items-center border-l border-border/60 bg-muted/35 px-3 text-sm font-medium text-muted-foreground">
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
        "flex min-w-0 items-center justify-center gap-1 rounded-xl bg-muted/70 p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-9 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold leading-none transition-[background-color,box-shadow,color] disabled:cursor-not-allowed disabled:opacity-50",
            value === option.value
              ? "bg-background text-foreground shadow-[0_1px_3px_hsl(var(--foreground)/0.14)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="block truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
