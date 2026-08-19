import type { ComponentType, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type InternalPageNavItem = {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: ReactNode;
  dataTourId?: string;
};

/**
 * The section switcher on a detail page, as a tab rail: labels on the chrome
 * bar's baseline with the active one underlined in the brand colour.
 *
 * It used to be a row of pill buttons — bordered, filled when selected — which
 * on a phone became a scrolling strip of chips that read as a toolbar rather
 * than as the page's own sections. The underline carries the same information
 * with no box around it, and degrades far better when the row has to scroll.
 *
 * The rail has no rule of its own: it sits flush on the header's bottom border,
 * which the chrome bar arranges by dropping its bottom padding when a nav is
 * present. Two parallel lines a few pixels apart is what a self-drawn rule here
 * would produce.
 */
export function InternalPageNav({
  items,
  active,
  onChange,
  ariaLabel = "Page sections",
  className,
}: {
  items: InternalPageNavItem[];
  active: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav
      className={cn("scrollbar-none flex min-w-0 max-w-full gap-5 overflow-x-auto", className)}
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
              // -mb-px pulls the tab's own border down onto the header's, so the
              // active underline replaces that segment rather than stacking on it.
              "-mb-px inline-flex h-10 min-w-max shrink-0 items-center gap-2 border-b-2 border-transparent px-0.5",
              "text-sm font-medium text-muted-foreground transition-colors",
              "hover:border-border hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected && "border-primary text-foreground hover:border-primary",
            )}
          >
            {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
            <span>{item.label}</span>
            {item.badge ? (
              <Badge variant="secondary" className="text-[10px] font-medium">
                {item.badge}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
