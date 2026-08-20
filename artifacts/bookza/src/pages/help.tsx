import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataViewToolbar, PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { cn } from "@/lib/utils";
import { usePageChrome } from "@/components/layout/page-chrome";
import {
  dismissGettingStartedStep,
  fetchGettingStartedStatus,
  type GettingStartedStep,
  type GettingStartedStepId,
} from "@/lib/getting-started";
import { Input } from "@/components/ui/input";
import { GUIDE_TOPICS, searchGuides, type GuideTopic } from "@/lib/help-guides";

/**
 * Two ways of being taught, on two tabs.
 *
 * Walkthroughs are good at "this control does that" and bad at anything with
 * more than one moving part — why a slot is missing from the booking page, when
 * a token gets spent. A spotlight has room for two sentences and no room for a
 * sequence, so the questions that generate actual support messages had nowhere
 * to live. They live in Guides.
 *
 * This page was the Getting Started checklist and looked like it: an accordion
 * of eight steps, each a hand-written block of JSX, and a `tourButtonClass`
 * constant that overrode the Button primitive's own colours. Eight blocks
 * differing only in a link and a label is a table pretending to be a layout, so
 * the walkthroughs are a table now, drawn with the same cards as every other
 * grid in the app.
 */

type Tutorial = {
  href: string;
  /** Verb for the button when the walkthrough hasn't been taken yet. */
  cta: string;
  /**
   * Whether it can be waved off. The ones that can are the ones whose
   * completion is a purchase or an integration the business may never want —
   * marking those done by hand is the only way they ever leave the list.
   */
  dismissible: boolean;
};

const TUTORIALS: Record<GettingStartedStepId, Tutorial> = {
  business_details: {
    href: "/settings?tab=profile&tour=settings-tour",
    cta: "Tour Settings",
    dismissible: false,
  },
  first_service: {
    href: "/services?tour=add-service",
    cta: "Tour Services",
    dismissible: false,
  },
  first_staff: {
    href: "/staff?tour=add-staff",
    cta: "Tour Staff",
    dismissible: false,
  },
  staff_topup: {
    href: "/billing?tour=billing",
    cta: "Tour Billing",
    dismissible: true,
  },
  whatsapp_bot: {
    href: "/whatsapp/bot?tour=whatsapp-bot",
    cta: "Set up WhatsApp",
    dismissible: true,
  },
  custom_email: {
    href: "/settings?tab=profile&tour=custom-email",
    cta: "Set up your email domain",
    dismissible: true,
  },
  booking_page: {
    href: "/booking-page?tour=booking-page",
    cta: "Customise your page",
    dismissible: true,
  },
  calendar: {
    href: "/calendar?tour=calendar",
    cta: "Tour the calendar",
    dismissible: true,
  },
};

type HelpTab = "walkthroughs" | "guides";

export default function HelpPage() {
  const queryClient = useQueryClient();
  const queryString = useSearch();
  const [tab, setTab] = useState<HelpTab>(() =>
    new URLSearchParams(queryString).get("tab") === "guides" ? "guides" : "walkthroughs",
  );
  const [guideSearch, setGuideSearch] = useState("");
  const [guideTopic, setGuideTopic] = useState<GuideTopic | null>(null);

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [{ label: "Help & tutorials" }],
      internalNav: {
        items: [
          { value: "walkthroughs", label: "Walkthroughs" },
          { value: "guides", label: "Guides" },
        ],
        active: tab,
        onChange: (value: string) => setTab(value as HelpTab),
        ariaLabel: "Help sections",
      },
    }),
    [tab],
  );
  usePageChrome(pageChrome);

  const { data: status, isLoading } = useQuery({
    queryKey: ["getting-started"],
    queryFn: fetchGettingStartedStatus,
    enabled: tab === "walkthroughs",
  });

  const dismissMutation = useMutation({
    mutationFn: (stepId: GettingStartedStepId) => {
      if (!status) throw new Error("Not ready");
      return dismissGettingStartedStep(status.businessId, stepId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getting-started"] });
    },
    onError: (err) => {
      toast.error("Couldn't update that", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  const matchingGuides = searchGuides(guideSearch, guideTopic);

  if (tab === "guides") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Help & tutorials"
          description="The parts of Qwickly with more than one moving part, written out."
        />

        <DataViewToolbar>
          <div className="min-w-0 flex-1">
            <Input
              placeholder="Search guides"
              value={guideSearch}
              onChange={(event) => setGuideSearch(event.target.value)}
            />
          </div>
        </DataViewToolbar>

        {/* Topics as filter pills rather than a select: there are six of them,
            they fit on one line, and a select would hide the whole shape of
            what has been written behind a click. */}
        <div className="flex flex-wrap gap-2">
          <TopicPill selected={guideTopic === null} onClick={() => setGuideTopic(null)}>
            All
          </TopicPill>
          {GUIDE_TOPICS.map((topic) => (
            <TopicPill
              key={topic}
              selected={guideTopic === topic}
              onClick={() => setGuideTopic(guideTopic === topic ? null : topic)}
            >
              {topic}
            </TopicPill>
          ))}
        </div>

        {matchingGuides.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex min-h-64 items-center justify-center">
              <PageEmptyState
                title="Nothing matches that"
                description="Try a different word, or clear the topic filter to see everything we've written."
                actions={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setGuideSearch("");
                      setGuideTopic(null);
                    }}
                  >
                    Clear search
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {matchingGuides.map((guide) => (
              <Card key={guide.id} className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{guide.title}</CardTitle>
                    <Badge variant="secondary" className="shrink-0 rounded-full text-[11px]">
                      {guide.topic}
                    </Badge>
                  </div>
                  <CardDescription className="leading-6">{guide.summary}</CardDescription>
                </CardHeader>
                <CardContent className="flex h-full flex-col">
                  <div className="mt-auto flex items-center gap-3">
                    <Button variant="outline" asChild>
                      <Link href={`/help/guides/${guide.id}`}>Read</Link>
                    </Button>
                    <span className="text-xs text-muted-foreground">{guide.minutes} min read</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Help & tutorials"
          description="Short guided walkthroughs of the real screens — take them in any order, and replay any of them whenever you like."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // Untaken first. Someone opening this page is looking for what they have not
  // done, and eight cards in a fixed order buries that under whatever happens
  // to sort first.
  const ordered = [...status.steps].sort(
    (a, b) => Number(a.complete) - Number(b.complete),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help & tutorials"
        description="Short guided walkthroughs of the real screens — take them in any order, and replay any of them whenever you like."
        badges={
          <Badge variant="outline" className="rounded-full">
            {status.completedCount} of {status.total} done
          </Badge>
        }
      />

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((step) => (
          <TutorialCard
            key={step.id}
            step={step}
            onDismiss={() => dismissMutation.mutate(step.id)}
            dismissing={dismissMutation.isPending && dismissMutation.variables === step.id}
          />
        ))}
      </div>
    </div>
  );
}

function TutorialCard({
  step,
  onDismiss,
  dismissing,
}: {
  step: GettingStartedStep;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const tutorial = TUTORIALS[step.id];

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{step.title}</CardTitle>
          {step.complete ? (
            <Badge
              variant="outline"
              className="shrink-0 rounded-full border-primary/25 bg-primary/10 text-[11px] text-primary"
            >
              Done
            </Badge>
          ) : null}
        </div>
        <CardDescription className="leading-6">{step.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex h-full flex-col">
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button variant={step.complete ? "outline" : "default"} asChild>
            <Link href={tutorial.href}>
              {step.complete ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Replay
                </>
              ) : (
                tutorial.cta
              )}
            </Link>
          </Button>

          {tutorial.dismissible && !step.complete ? (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={onDismiss}
              disabled={dismissing}
            >
              Not for me
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function TopicPill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
