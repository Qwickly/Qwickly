import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import {
  OnboardingLayout,
  OnboardingPanel,
  OnboardingScreenBody,
} from "@/components/onboarding/onboarding-ui";
import { StateLine } from "@/components/ui/state-line";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAddons } from "@/lib/addons";
import { createSubscriptionWithPayFast } from "@/lib/catalog-subscriptions";
import { cn } from "@/lib/utils";

/**
 * The whole screen, when the account can no longer be used.
 *
 * This replaced an in-shell locked state: the sidebar collapsed to a padlock,
 * the dashboard showed a card, and the customer was left to navigate a portal
 * that could not do anything to the one page that could. It repeated the mistake
 * RequireOnboarding was built to fix — the first thing you saw was a list of what
 * you could not do, in a shell you could still wander around.
 *
 * So this owns the screen the way setup does, and it has exactly one job: get
 * them subscribed, or let them decide not to be.
 *
 * The part that earns its place is the add-on picker. Someone whose trial has
 * lapsed is being asked to commit to a monthly bill for the first time, and the
 * bill in front of them includes everything they switched on while it was all
 * free. "Pay R444 or leave" loses a customer who would happily have paid R129.
 * Every add-on here can be dropped before paying, and the total moves as they go.
 */

const BASE_PLAN_NAME = "Starter";

function formatRand(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString("en-ZA")}`;
}

function submitPayFastForm(action: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

export default function ReactivatePage() {
  const { data: entitlements } = useEntitlements();
  const { signOut } = useAuth();

  const { data: addonsData, isLoading: loadingAddons } = useQuery({
    queryKey: ["addons"],
    queryFn: fetchAddons,
  });

  // Which add-ons the customer is choosing to keep. Seeded from what they had.
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const attached = useMemo(
    () =>
      (addonsData?.attached ?? []).filter(
        (row) => !row.remove_at || new Date(row.remove_at).getTime() > Date.now(),
      ),
    [addonsData],
  );

  const catalogById = useMemo(() => {
    const map = new Map<string, { name: string; priceCents: number }>();
    for (const addon of addonsData?.catalog ?? []) {
      map.set(addon.id, { name: addon.name, priceCents: addon.price_cents });
    }
    return map;
  }, [addonsData]);

  const basePlanCents = 12900;

  const keptCents = attached.reduce((sum, row) => {
    if (dropped.has(row.addon_id)) return sum;
    const catalog = catalogById.get(row.addon_id);
    return sum + (catalog?.priceCents ?? 0) * (row.quantity ?? 1);
  }, 0);

  const monthlyCents = basePlanCents + keptCents;

  const reactivate = useMutation({
    mutationFn: () =>
      createSubscriptionWithPayFast(
        BASE_PLAN_NAME,
        attached.filter((row) => !dropped.has(row.addon_id)).map((row) => row.addon_id),
      ),
    onSuccess: (data) => submitPayFastForm(data.action, data.fields),
  });

  const reason = entitlements?.reason;

  const { title, description } = (() => {
    if (reason === "trial_expired") {
      return {
        title: "Your free trial has ended",
        description:
          "Fourteen days are up. Nothing has been deleted and your booking page is still taking bookings — subscribe to open your dashboard again.",
      };
    }
    if (reason === "past_due_expired" || reason === "past_due_grace") {
      return {
        title: "We couldn't take your last payment",
        description:
          "Your bank declined the monthly charge. Your account is untouched — pay now and everything opens straight back up.",
      };
    }
    return {
      title: "Your plan is inactive",
      description:
        "Choose a plan to get back into your dashboard. Your bookings, clients and settings are exactly where you left them.",
    };
  })();

  const toggleDropped = (addonId: string) =>
    setDropped((prev) => {
      const next = new Set(prev);
      next.has(addonId) ? next.delete(addonId) : next.add(addonId);
      return next;
    });

  return (
    <OnboardingLayout>
      <OnboardingScreenBody
        title={title}
        description={description}
        actions={
          <>
            <Button
              size="lg"
              className="min-w-[15rem]"
              disabled={reactivate.isPending}
              onClick={() => reactivate.mutate()}
            >
              {reactivate.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening PayFast
                </>
              ) : (
                <>
                  Reactivate — {formatRand(monthlyCents)}/month
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            {reactivate.isError ? (
              <p className="max-w-sm text-xs leading-5 text-destructive">
                {(reactivate.error as Error)?.message ??
                  "Couldn't start the payment. Please try again."}
              </p>
            ) : (
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                Billed monthly. Cancel any time.
              </p>
            )}

            <button
              type="button"
              onClick={() => void signOut()}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Sign out
            </button>
          </>
        }
      >
        <div className="w-full space-y-4 text-left">
          {/* What is still running, and what is not. */}
          <OnboardingPanel className="px-5 py-1 sm:px-6">
            <StateLine
              state="live"
              label="Your booking page"
              value="still taking bookings"
            />
            <StateLine
              state="live"
              label="Bookings, clients and settings"
              value="saved as they were"
            />
            <StateLine state="off" label="Your dashboard" value="locked" />
          </OnboardingPanel>

          {/* The bill, itemised and editable. Unpadded so the rows and their
              dividers run edge to edge, the way a statement reads. */}
          <OnboardingPanel tone="primary" padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-4 sm:px-6">
              <div>
                <p className="text-sm font-semibold text-foreground">{BASE_PLAN_NAME} plan</p>
                <p className="text-xs text-muted-foreground">
                  Bookings, clients, booking page and reminders
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {formatRand(basePlanCents)}
              </p>
            </div>

            {loadingAddons ? (
              <p className="px-5 py-4 text-xs text-muted-foreground sm:px-6">
                Loading your add-ons…
              </p>
            ) : attached.length === 0 ? null : (
              <>
                <p className="px-5 pt-4 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-6">
                  Your add-ons — keep or drop
                </p>
                {attached.map((row) => {
                  const catalog = catalogById.get(row.addon_id);
                  const isDropped = dropped.has(row.addon_id);
                  const lineCents = (catalog?.priceCents ?? 0) * (row.quantity ?? 1);

                  return (
                    <button
                      key={row.addon_id}
                      type="button"
                      onClick={() => toggleDropped(row.addon_id)}
                      aria-pressed={!isDropped}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-primary/5 sm:px-6"
                    >
                      <span
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
                          isDropped
                            ? "border-border bg-transparent"
                            : "border-primary bg-primary text-white",
                        )}
                      >
                        {!isDropped && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm font-medium",
                            isDropped
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                          )}
                        >
                          {catalog?.name ?? row.addon_id}
                          {row.quantity > 1 ? ` ×${row.quantity}` : ""}
                        </span>
                      </span>

                      <span
                        className={cn(
                          "shrink-0 text-sm tabular-nums",
                          isDropped
                            ? "text-muted-foreground line-through"
                            : "font-semibold text-foreground",
                        )}
                      >
                        {formatRand(lineCents)}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border/50 bg-primary/5 px-5 py-4 sm:px-6">
              <p className="text-sm font-semibold text-foreground">Monthly total</p>
              <p className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
                {formatRand(monthlyCents)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span>
              </p>
            </div>
          </OnboardingPanel>

          {dropped.size > 0 ? (
            <p className="text-xs leading-6 text-muted-foreground">
              Dropped add-ons stop billing straight away. You can add any of them back
              from Billing whenever you want.
            </p>
          ) : null}
        </div>
      </OnboardingScreenBody>
    </OnboardingLayout>
  );
}
