import { useMemo } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { findGuide, GUIDES } from "@/lib/help-guides";

/**
 * One guide, as a page.
 *
 * It started as a panel inside /help with its own "All guides" button, which
 * meant the only way back was a control invented for this one screen while the
 * breadcrumb above it still said you were on the index. Every other record in
 * the app — a booking, a client, a service — is a route with a trail, and an
 * article is a record.
 */
export default function HelpGuidePage({ id }: { id: string }) {
  const guide = findGuide(id);

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Help & tutorials", href: "/help" },
        { label: "Guides", href: "/help?tab=guides" },
        { label: guide?.title ?? "Guide" },
      ],
    }),
    [guide?.title],
  );
  usePageChrome(pageChrome);

  if (!guide) {
    return (
      <div className="space-y-6">
        <PageHeader title="Guide not found" />
        <Card className="border-dashed">
          <CardContent className="flex min-h-64 items-center justify-center">
            <PageEmptyState
              title="That guide doesn't exist"
              description="It may have been renamed. Everything we've written is on the guides list."
              actions={
                <Button asChild>
                  <Link href="/help?tab=guides">Browse all guides</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const others = GUIDES.filter(
    (candidate) => candidate.id !== guide.id && candidate.topic === guide.topic,
  ).slice(0, 3);

  return (
    <div className="space-y-6">
      <PageHeader
        title={guide.title}
        description={guide.summary}
        badges={
          <Badge variant="outline" className="rounded-full">
            {guide.topic}
          </Badge>
        }
      />

      {/*
        Capped at a readable measure — the only place in the app that narrows
        itself, for the one reason that justifies it: a paragraph running the
        full width of a 1600px screen is genuinely harder to read.
      */}
      <div className="max-w-2xl space-y-8">
        <article className="space-y-6">
          {guide.sections.map((section, index) => (
            <section key={section.heading ?? index} className="space-y-2">
              {section.heading ? (
                <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
              ) : null}
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-[0.9375rem] leading-7 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {section.points ? (
                <ul className="list-disc space-y-1 pl-5 text-[0.9375rem] leading-7 text-muted-foreground marker:text-muted-foreground/50">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>

        {others.length > 0 ? (
          <section className="space-y-3 border-t border-border/50 pt-6">
            <h2 className="text-sm font-semibold text-foreground">
              More on {guide.topic.toLowerCase()}
            </h2>
            <ul className="space-y-2">
              {others.map((other) => (
                <li key={other.id}>
                  <Link
                    href={`/help/guides/${other.id}`}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {other.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
