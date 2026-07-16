import type { ReactNode } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function SubscriptionGuard({ children }: { children: ReactNode }) {
  const { data: entitlements, isLoading } = useEntitlements();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!entitlements?.entitled) {
    const trialUsed = Boolean(entitlements?.trialUsed);

    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-xl border-primary/25 bg-primary/[0.045] shadow-sm shadow-primary/10">
          <CardContent className="p-7 text-center sm:p-9">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              Subscription required
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {trialUsed
                ? "Your free trial has already been used. Choose a plan in Billing to continue using Qwickly."
                : "Start your free trial in Billing to unlock the dashboard and business tools."}
            </p>
            <Button asChild className="mt-6 bg-primary hover:bg-primary/90">
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
