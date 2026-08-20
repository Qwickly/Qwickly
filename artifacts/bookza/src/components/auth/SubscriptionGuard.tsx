import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { Loader2, RefreshCw } from "lucide-react";
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

  /*
    No live subscription: hand the whole screen to /reactivate rather than
    rendering a locked card inside a shell the customer can still click around.
    A portal you can navigate but not use is a maze — and the one page that could
    fix it was several clicks away behind a padlocked sidebar.

    A PayFast return trip is let through for the same reason RequireOnboarding
    lets it through: the customer comes back to a URL carrying the payment
    reference, and the subscription may take a few seconds more to be confirmed
    by the ITN. Bouncing them back to /reactivate mid-return would drop that
    reference and strand a customer who has just paid.
  */
  if (!entitlements?.entitled) {
    const returningFromPayFast =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("payfast");

    if (!returningFromPayFast) return <Redirect to="/reactivate" />;
  }

  return children;
}
