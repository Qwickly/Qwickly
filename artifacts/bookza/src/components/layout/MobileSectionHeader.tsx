import type { LucideIcon } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type MobileSectionHeaderProps = {
  backLabel: string;
  onBack: () => void;
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
};

/**
 * Back header for mobile drill-down sections (Settings, Bot Setup, and any
 * other nested-tabs page). Renders in place of the page-level header, which
 * callers must hide while a section is open — otherwise the two compete for
 * space at the top of the screen.
 */
export function MobileSectionHeader({
  backLabel,
  onBack,
  icon: Icon,
  title,
  description,
  className,
}: MobileSectionHeaderProps) {
  return (
    <div className={cn("duration-200 ease-out animate-in fade-in slide-in-from-left-2", className)}>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 -ml-2 inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted active:bg-muted"
      >
        <ChevronLeft className="h-5 w-5" />
        {backLabel}
      </button>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
