import type { LucideIcon } from "lucide-react";
import { ChevronLeft, X } from "lucide-react";
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
      <div className="mb-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 inline-flex h-11 items-center gap-1 rounded-full px-2.5 text-base font-semibold text-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <ChevronLeft className="h-6 w-6" />
          {backLabel}
        </button>
        <button
          type="button"
          onClick={onBack}
          aria-label={`Close ${title}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="min-w-0">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary md:hidden">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
