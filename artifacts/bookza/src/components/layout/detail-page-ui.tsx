import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { usePageChrome } from "@/components/layout/page-chrome";

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
  const chrome = useMemo(
    () => ({ back: { href: backHref, label: backLabel } }),
    [backHref, backLabel],
  );
  usePageChrome(chrome);

  return (
    <Card className="overflow-hidden">
      <CardContent>
        {actions ? (
          <div className="mb-5 flex items-center justify-end gap-4">
            {actions}
          </div>
        ) : null}

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
