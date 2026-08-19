import type { ReactNode } from "react";
import { ArrowRight, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { AppBootLoader } from "@/components/layout/AppBootLoader";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function SubscriptionGuard({ children }: { children: ReactNode }) {
  const { data: entitlements, isLoading, isError, refetch, isRefetching } = useEntitlements();

  if (isLoading) {
    // Inline: this runs inside AppLayout, with the sidebar already painted.
    // A fixed cover would black out the navigation the reader is waiting on.
    return <AppBootLoader inline label="Checking your subscription" />;
  }

  // A failed request is NOT "no subscription". The query client uses
  // retry: false, so one network blip (server restart, flaky connection) used
  // to lock a paying customer behind the subscribe wall until a full reload.
  // Fail neutral: say we couldn't check, offer a retry, block nothing else.
  if (isError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-xl border-border/60 shadow-sm">
          <CardContent className="text-center">
            <h1 className="text-2xl font-black tracking-tight">
              Couldn&apos;t check your subscription
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We couldn&apos;t reach the server to confirm your plan. This is a
              connection problem, not a billing problem — your subscription is
              unaffected.
            </p>
            <Button
              className="mt-6"
              variant="outline"
              disabled={isRefetching}
              onClick={() => refetch()}
            >
              {isRefetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!entitlements?.entitled) {
    const trialUsed = Boolean(entitlements?.trialUsed);

    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="tint-primary w-full max-w-xl border-primary/25">
          <CardContent className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              {trialUsed ? "Subscription required" : "Start your 14-day free trial"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {trialUsed
                ? "Your free trial has already been used. Choose a plan in Billing to continue using Qwickly."
                : "Enter your card details to activate your trial — no charge until day 14, cancel anytime."}
            </p>
            <Button asChild className="mt-6">
              <a href="/billing" className="!text-white hover:!text-white">
                {trialUsed ? "Open Billing" : "Start free trial"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return children;
}
