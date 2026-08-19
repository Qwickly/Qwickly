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
  badges,
  primaryAction,
  secondaryActions,
  overflowActions,
  actions,
  controls,
  className,
}: {
  title: string;
  description?: string;
  badges?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  overflowActions?: ReactNode;
  /**
   * Legacy escape hatch while pages are migrated to primary/secondary actions.
   */
  actions?: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  const hasStructuredActions = Boolean(primaryAction || secondaryActions || overflowActions);
  const resolvedActions = actions ?? (hasStructuredActions ? (
      <>
        {secondaryActions}
        {primaryAction}
        {overflowActions}
      </>
    ) : null);

  return (
    <header
      className={cn(
        "flex min-w-0 flex-col gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              {title}
            </h1>
            {badges}
          </div>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {resolvedActions ? <PageHeaderActionGroup>{resolvedActions}</PageHeaderActionGroup> : null}
      </div>
      {controls ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          {controls}
        </div>
      ) : null}
    </header>
  );
}

export function PageHeaderActionGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end",
        className,
      )}
    >
      {children}
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
