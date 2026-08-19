import { useCallback, useEffect, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { usePageChrome } from "@/components/layout/page-chrome";

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
