import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { LayoutGrid, MoreHorizontal, Table2 } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePageChrome } from "@/components/layout/page-chrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type DataViewMode = "table" | "cards";

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
      <div className="flex min-w-0 items-start justify-between gap-3">
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
      {controls ? <PageToolbar>{controls}</PageToolbar> : null}
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
        "flex flex-wrap items-center gap-2 sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        // shadcn inputs and select triggers are transparent, which disappears
        // against the page's gradient ground in light mode. Dark mode already
        // separates via the stock `bg-input/30`, so it is left alone.
        "[&_input]:bg-card [&_[data-slot=select-trigger]]:bg-card",
        "dark:[&_input]:bg-input/30 dark:[&_[data-slot=select-trigger]]:bg-input/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DataViewToolbar({
  children,
  viewMode,
  onViewModeChange,
  className,
}: {
  children: ReactNode;
  viewMode?: DataViewMode;
  onViewModeChange?: (viewMode: DataViewMode) => void;
  className?: string;
}) {
  return (
    <PageToolbar className={cn("flex-row items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {children}
      </div>
      {viewMode && onViewModeChange ? (
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value === "table" || value === "cards") onViewModeChange(value);
          }}
          variant="outline"
          aria-label="View mode"
        >
          <ToggleGroupItem value="table">
            <Table2 className="h-4 w-4" />
            <span className="hidden sm:inline">Table</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="cards">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Cards</span>
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
    </PageToolbar>
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

/**
 * The "..." trigger for a page's secondary/destructive actions. Four pages had
 * hand-rolled this button and drifted to three different sizes (h-10 w-10, h-9
 * w-9, bare size="icon"), so the same menu looked different depending on which
 * record you were looking at. Pass the DropdownMenuItems as children.
 */
export function PageOverflowMenu({
  label,
  align = "end",
  contentClassName,
  children,
}: {
  /** Screen-reader name for the trigger, e.g. "Client actions". */
  label: string;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
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

export type DetailSection = {
  value: string;
  label: string;
  description?: string;
};

/**
 * The section switcher on a detail page: it publishes the section list to the
 * chrome bar's internal nav and renders the active section's heading. Lived in
 * its own detail-page-ui.tsx alongside a hero card that no page uses any more.
 */
export function DetailSectionNav({
  sections,
  active,
  onChange,
  navLabel,
}: {
  sections: DetailSection[];
  active: string;
  onChange: (value: string) => void;
  navLabel: string;
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const handleChange = useCallback((value: string) => {
    onChangeRef.current(value);
  }, []);

  const activeIndex = Math.max(
    sections.findIndex((section) => section.value === active),
    0,
  );
  const activeMeta = sections[activeIndex];
  const chrome = useMemo(
    () => ({
      internalNav: {
        items: sections,
        active,
        onChange: handleChange,
        ariaLabel: navLabel,
      },
    }),
    [active, handleChange, navLabel, sections],
  );
  usePageChrome(chrome);

  return (
    <div>
      {activeMeta ? (
        <Card>
          <CardContent>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {navLabel.replace(/s$/i, "")} {activeIndex + 1} of {sections.length}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{activeMeta.label}</h2>
            {activeMeta.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{activeMeta.description}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
