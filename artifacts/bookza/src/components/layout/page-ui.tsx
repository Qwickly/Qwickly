import type { ReactNode } from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  /**
   * Sits beside the title, not in `actions`.
   *
   * Added because ai-assistant.tsx wanted an "AI powered" badge next to its
   * heading, had nowhere to put it, and hand-rolled the whole header to get it
   * — at which point its `<h1>` was free to drift from every other page's.
   * DetailHeroCard has had a `badges` slot all along; this is the same idea for
   * the flat page header.
   */
  badges,
  actions,
  className,
}: {
  title: string;
  description?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {badges}
        </div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The "info tile" idiom (rounded-xl border-border/45 bg-muted/20 p-4) was copy-pasted,
 * unchanged, across bookings.tsx, calendar.tsx, client-detail.tsx, dashboard.tsx, and both
 * detail pages for mini-stats, detail-info grids, and notes boxes. Promoted here so it's a
 * real shared component instead of a convention nobody named.
 */
export function InfoTile({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/45 bg-muted/20 p-4", className)}>
      {children}
    </div>
  );
}

export function PageBackButton({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link href={href}>
      <Button
        variant="ghost"
        size="sm"
        className={cn("-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground", className)}
      >
        <ArrowLeft className="h-4 w-4" />
        {label}
      </Button>
    </Link>
  );
}

export function PageEmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("min-h-40 border-0 p-6", className)}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon" className="size-12 rounded-xl text-muted-foreground">
            <Icon className="size-6" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {actions ? <EmptyContent>{actions}</EmptyContent> : null}
    </Empty>
  );
}
