import { Link } from "wouter";
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
import { PageHeader } from "@/components/layout/page-ui";
import {
  dismissGettingStartedStep,
  fetchGettingStartedStatus,
  type GettingStartedStep,
  type GettingStartedStepId,
} from "@/lib/getting-started";

/**
 * Guided walkthroughs of the real screens.
 *
 * This was the Getting Started checklist, and it looked like it: an accordion
 * of eight steps, each with a hand-written block of JSX and a `tourButtonClass`
 * that overrode the Button primitive's own colours. Eight blocks that differed
 * only in a link, a label and an icon is a table pretending to be a layout —
 * so it is a table now, driven from {@link TUTORIALS}, drawn with the same
 * cards as every other grid in the app.
 *
 * Nothing here is labelled "optional" any more. Everything on a help page is
 * optional; saying so on each card only made the page look like a to-do list
 * that had given up on itself.
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
    cta: "Add a service",
    dismissible: false,
  },
  first_staff: {
    href: "/staff?tour=add-staff",
    cta: "Add a team member",
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

export default function HelpPage() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["getting-started"],
    queryFn: fetchGettingStartedStatus,
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
    <Card className={step.complete ? "h-full border-border/60" : "h-full"}>
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
