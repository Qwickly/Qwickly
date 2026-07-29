import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoTile } from "@/components/layout/page-ui";
import { cn } from "@/lib/utils";

/**
 * service-detail.tsx and staff-detail.tsx hand-rolled an identical profile hero card
 * (back link + actions + media/title/badges/meta row). Shared here so the two files
 * stop drifting from each other.
 */
export function DetailHeroCard({
  backHref,
  backLabel,
  actions,
  media,
  title,
  badges,
  description,
  metaItems,
}: {
  backHref: string;
  backLabel: string;
  actions?: ReactNode;
  media: ReactNode;
  title: string;
  badges?: ReactNode;
  description?: string;
  metaItems?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link href={backHref}>
            <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> {backLabel}
            </Button>
          </Link>
          {actions}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {media}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h1>
              {badges}
            </div>
            {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
            {metaItems ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                {metaItems}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export type DetailSection = {
  value: string;
  label: string;
  description?: string;
};

/**
 * The numbered-pill section switcher + "Section X of Y" indicator, also duplicated
 * verbatim between service-detail.tsx and staff-detail.tsx.
 */
export function DetailSectionNav({
  sections,
  active,
  onChange,
  navLabel,
  gridClassName = "grid-cols-4",
}: {
  sections: DetailSection[];
  active: string;
  onChange: (value: string) => void;
  navLabel: string;
  gridClassName?: string;
}) {
  const activeIndex = Math.max(
    sections.findIndex((section) => section.value === active),
    0,
  );
  const activeMeta = sections[activeIndex];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="mb-3 px-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{navLabel}</p>
          </div>
          <nav className={cn("grid gap-2", gridClassName)}>
            {sections.map((section, index) => {
              const selected = section.value === active;
              return (
                <button
                  key={section.value}
                  type="button"
                  onClick={() => onChange(section.value)}
                  className={cn(
                    "min-w-0 rounded-lg border p-2 text-center transition-colors lg:p-3",
                    selected
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                      selected ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="mt-2 block truncate text-xs font-medium sm:text-sm">{section.label}</span>
                </button>
              );
            })}
          </nav>
        </CardContent>
      </Card>

      {activeMeta ? (
        <InfoTile>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Section {activeIndex + 1} of {sections.length}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{activeMeta.label}</h2>
          {activeMeta.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{activeMeta.description}</p>
          ) : null}
        </InfoTile>
      ) : null}
    </div>
  );
}
