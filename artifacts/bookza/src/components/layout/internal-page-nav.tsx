import type { ComponentType, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type InternalPageNavItem = {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: ReactNode;
  dataTourId?: string;
};

export function InternalPageNav({
  items,
  active,
  onChange,
  ariaLabel = "Page sections",
  variant = "card",
  className,
}: {
  items: InternalPageNavItem[];
  active: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  variant?: "card" | "chrome";
  className?: string;
}) {
  const nav = (
    <nav
      className={cn(
        "min-w-0 max-w-full overflow-x-auto",
        variant === "chrome" && "chrome-scrollbar pb-1",
        "flex gap-1",
        variant === "card" ? "p-2" : "p-0",
      )}
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = item.value === active;
        const Icon = item.icon;

        return (
          <button
            key={item.value}
            type="button"
            data-tour-id={item.dataTourId}
            aria-current={selected ? "page" : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex h-10 min-w-max shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              selected && "border-border/60 bg-muted/80 text-foreground shadow-none",
            )}
          >
            {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
            <span>{item.label}</span>
            {item.badge ? (
              <Badge variant="secondary" className="ml-1 text-[10px] font-medium">
                {item.badge}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </nav>
  );

  if (variant === "chrome") {
    return <div className={cn("min-w-0 overflow-hidden", className)}>{nav}</div>;
  }

  return (
    <Card className={cn("overflow-hidden py-0", className)}>
      {nav}
    </Card>
  );
}
