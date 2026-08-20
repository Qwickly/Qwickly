import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  fetchSubscription,
  updateSubscription,
  cancelSubscription,
  createSubscriptionWithPayFast,
  checkPayFastPaymentStatus,
  fetchInvoices,
  fetchStaffCount,
} from "@/lib/catalog-subscriptions";
import { catalogKeys } from "@/lib/catalog";
import {
  fetchCreditBalances,
  fetchCreditBundles,
  purchaseCreditBundle,
  submitPayFastForm,
  formatRand,
  type CreditBalance,
  type CreditKind,
} from "@/lib/credits";
import {
  fetchAddons, attachAddon, detachAddon, attachAddonsBatch,
  type PlanAddon, type AttachAddonResult, type DetachAddonResult,
  type AttachAddonsBatchResult,
} from "@/lib/addons";
import { useEntitlements } from "@/hooks/use-entitlements";
import { resolvePostAuthPath } from "@/lib/onboarding";
import { TourOverlay, type TourStep } from "@/components/tour/TourOverlay";
import { BackToChecklistLink } from "@/components/tour/BackToChecklistLink";
import { BILLING_STEP_COPY, ADDON_TOUR_COPY } from "@/lib/tour-steps";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DataViewToolbar,
  InfoTile,
  PageEmptyState,
  PageHeader,
  PageOverflowMenu,
  RoadmapLink,
} from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TableRowsSkeleton } from "@/components/skeletons/table-skeleton";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// Icons are deliberately scarce here: the page is a price list, and a
// medallion beside every line item made it read as a dashboard.
import { Download, Receipt, Sparkles, Plus, AlertTriangle, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingPageSkeleton } from "@/components/skeletons/page-skeletons";


// ─────────────────────────────────────────────────────────────────────────────
// Launch plans — display data only. The Starter price is enforced server-side
// (edge fn PLAN_PRICES + the plans table); Teams is a disabled coming-soon card.
// `checkoutPlanName` MUST match the plan name the edge fn expects ("Starter").
//
// Copy rule (pricing.md §12): never name the mechanism. No "WhatsApp Web", no
// "QR code", no "session" — describe what the customer gets.
// ─────────────────────────────────────────────────────────────────────────────

type LaunchPlan = {
  name: string;
  checkoutPlanName?: "Starter";
  priceLabel: string;
  tagline: string;
  highlight: boolean;
  badge?: string;
  priceNote: string;
  comingSoon?: boolean;
  features: string[];
};

const LAUNCH_PLANS: LaunchPlan[] = [
  {
    name: "Starter",
    checkoutPlanName: "Starter",
    priceLabel: "R 129",
    highlight: true,
    badge: "Recommended",
    tagline: "Everything a solo business needs to manage bookings and customer communication.",
    priceNote: "14-day free trial · card required",
    features: [
      "1 calendar, 1 bookable staff member",
      "Unlimited bookings, clients & services",
      "Booking page + shareable link",
      "Automated booking emails",
      "One connected WhatsApp business number",
      "Unlimited WhatsApp booking confirmations & reminders",
      "Clients added automatically from incoming WhatsApp messages",
      "WhatsApp campaigns to existing inbox contacts (using tokens)",
      "100 marketing emails / mo",
    ],
  },
  {
    name: "Teams",
    priceLabel: "Coming soon",
    highlight: false,
    badge: "Coming soon",
    tagline: "Built for service teams that need shared calendars, staff access and tighter operational control.",
    priceNote: "Team member login and permissions are in progress",
    comingSoon: true,
    features: [
      "Multiple staff logins",
      "Role-based team access",
      "Shared calendars and availability",
      "Staff performance views",
      "Internal handover notes",
      "Priority team workflows",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Add-ons — the à-la-carte half of the plan (pricing.md §2-§8)
// ─────────────────────────────────────────────────────────────────────────────

// Add-ons unlocked free during the trial. MUST match TRIAL_INCLUDED_GRANTS in the
// server resolver (artifacts/api-server/src/lib/entitlements.ts) — this only
// changes the billing UI's labels, the server decides actual access.
const TRIAL_INCLUDED_ADDONS: string[] = ["whatsapp_chatbot", "analytics", "branded_email"];

// Display order for the add-ons list. Staff sits under the branded-email sender
// (it's a paid seat add-on, not a try-it-free toggle); the coming-soon items
// trail at the end. Unknown ids sort first — harmless, all current ids are here.
const ADDON_DISPLAY_ORDER = [
  "whatsapp_chatbot",
  "analytics",
  "branded_email",
  "extra_staff",
  "ai_assistant",
  "custom_domain",
];
const addonOrder = (id: string): number => {
  const i = ADDON_DISPLAY_ORDER.indexOf(id);
  return i === -1 ? -1 : i;
};

/** Customer-facing blurb per add-on. Prices come from the server, never here. */
const ADDON_COPY: Record<string, { blurb: string; unit?: string }> = {
  whatsapp_chatbot: {
    blurb: "Let customers ask questions, check availability and book through WhatsApp 24/7, answered automatically.",
  },
  analytics: {
    blurb: "Detailed reports on bookings, revenue, services, clients and staff.",
  },
  branded_email: {
    blurb: "Send booking notifications and campaigns from your own verified business email address.",
  },
  extra_staff: {
    blurb: "Add another bookable team member with their own availability, services and schedule.",
    unit: "per staff member",
  },
  ai_assistant: {
    blurb: "Search bookings and clients, check availability and get suggested business actions using AI.",
  },
  custom_domain: {
    blurb: "Connect your own domain or subdomain to your Qwickly booking page.",
  },
};

type PrintableInvoice = {
  invoiceNumber: string;
  paymentDate: string;
  description: string | null;
  amount: number;
  currency?: string;
  status: string;
  paymentMethod?: string;
};

/**
 * Opens a print-ready receipt in a new tab and triggers the browser's print
 * dialog, from which the customer can "Save as PDF". No PDF library needed — the
 * browser does the rendering. Everything is inlined so it works in a blank tab.
 */
function printInvoice(inv: PrintableInvoice): void {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const amount = `${inv.currency ?? "ZAR"} ${Number(inv.amount).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
  const date = new Date(inv.paymentDate).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.invoiceNumber)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:48px;max-width:640px;margin:0 auto}
  .brand{font-size:22px;font-weight:800;color:#167a57;letter-spacing:-.02em}
  .muted{color:#64748b}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e2e8f0}
  .row:last-child{border-bottom:0}
  .label{color:#64748b;font-size:14px}
  .val{font-weight:600;font-size:14px;text-align:right}
  .total{margin-top:24px;padding-top:16px;border-top:2px solid #0f172a;display:flex;justify-content:space-between;align-items:baseline}
  .total .amt{font-size:26px;font-weight:800}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#dcfce7;color:#15803d;text-transform:capitalize}
  header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
  h1{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:2px}
</style></head><body>
  <header>
    <div><div class="brand">Qwickly</div><div class="muted" style="font-size:13px;margin-top:2px">qwickly.co.za</div></div>
    <div style="text-align:right"><h1>Invoice</h1><div class="muted" style="font-size:13px">#${esc(inv.invoiceNumber)}</div></div>
  </header>
  <div class="row"><span class="label">Date</span><span class="val">${esc(date)}</span></div>
  <div class="row"><span class="label">Description</span><span class="val">${esc(inv.description || "Subscription")}</span></div>
  <div class="row"><span class="label">Payment method</span><span class="val" style="text-transform:capitalize">${esc(inv.paymentMethod ?? "PayFast")}</span></div>
  <div class="row"><span class="label">Status</span><span class="val"><span class="pill">${esc(inv.status)}</span></span></div>
  <div class="total"><span class="label" style="font-size:15px">Total paid</span><span class="amt">${esc(amount)}</span></div>
  <p class="muted" style="margin-top:40px;font-size:12px">Thank you for your business. This receipt was generated by Qwickly.</p>
  <script>window.onload=function(){window.print()}</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return; // popup blocked
  w.document.write(html);
  w.document.close();
}

/**
 * One purchasable add-on. `extra_staff` is priced per seat and opens its own
 * stepper instead of a plain add/remove, since the quantity is the whole point.
 */
function AddonCard({
  addon, quantity, removeAt, pending, disabled, isTrialing, isTrialIncluded,
  daysInPeriod, daysRemaining, staged, onToggleStage, onAttach, onDetach, onManageSeats, subscribed,
}: {
  addon: PlanAddon;
  /** No subscription yet — the card is a price, not a control. */
  subscribed: boolean;
  quantity: number;
  removeAt: string | null;
  pending: boolean;
  disabled: boolean;
  /** Subscription is currently in its free trial. */
  isTrialing: boolean;
  /** This add-on is one of the features unlocked free during the trial. */
  isTrialIncluded: boolean;
  daysInPeriod: number;
  daysRemaining: number;
  /** Staged into the combined batch purchase. */
  staged: boolean;
  onToggleStage: (id: string) => void;
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  onManageSeats: () => void;
}) {
  const copy = ADDON_COPY[addon.id] ?? { blurb: "" };
  const attached = quantity > 0;
  const comingSoon = !addon.is_active;
  const ending = Boolean(removeAt);
  const perSeat = addon.id === "extra_staff";

  // What attaching mid-cycle actually costs today. Mirrors the server's quote in
  // subscription-management (price × daysRemaining / daysInPeriod) so the number
  // on this card matches the number on the PayFast page. Display only — the
  // server recomputes and the webhook verifies the paid amount independently.
  const dueTodayCents = daysInPeriod > 0
    ? Math.round((addon.price_cents * daysRemaining) / daysInPeriod)
    : addon.price_cents;

  const endsOn = removeAt
    ? new Date(removeAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : null;

  // Trial card: this feature is free right now, and the choice is only whether to
  // keep paying for it after the trial. "On next bill" = attached and not
  // scheduled to drop, i.e. it carries into the first real charge.
  const trialCard = isTrialing && isTrialIncluded && !comingSoon;
  const onNextBill = attached && !ending;
  const selected = !comingSoon && !trialCard && (staged || onNextBill);

  const badge = comingSoon ? (
    <Badge variant="secondary" className="shrink-0 rounded-full text-[11px]">Coming soon</Badge>
  ) : ending ? (
    <Badge variant="outline" className="shrink-0 rounded-full border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300">
      Ends {endsOn}
    </Badge>
  ) : trialCard ? (
    <Badge variant="outline" className="shrink-0 rounded-full border-primary/25 bg-primary/10 text-[11px] text-primary">
      Free in trial
    </Badge>
  ) : attached ? (
    <Badge variant="outline" className="shrink-0 rounded-full border-primary/25 bg-primary/10 text-[11px] text-primary">
      Active
    </Badge>
  ) : null;

  return (
    <Card
      data-tour-id={`addon-${addon.id}`}
      className={cn(
        "h-full",
        selected && "border-primary",
        ending && "border-amber-500/40",
        comingSoon && "opacity-75",
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{addon.name}</CardTitle>
          {badge}
        </div>
        <CardDescription className="leading-5">
          {ending
            ? `You keep this until ${endsOn}, then it won't renew. Re-add it before then at no extra cost.`
            : copy.blurb}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex h-full flex-col gap-4">
        {comingSoon ? (
          <p className="mt-auto text-sm text-muted-foreground">
            Not available yet — <RoadmapLink section="ai-automation" />.
          </p>
        ) : (
          <>
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatRand(addon.price_cents)}
                <span className="text-sm font-normal text-muted-foreground">
                  /mo{perSeat ? " per seat" : ""}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {!subscribed
                  ? isTrialIncluded
                    ? "Free for your whole 14-day trial, then this price if you keep it."
                    : "Charged monthly, on top of your plan."
                  : trialCard
                  ? onNextBill
                    ? "Free for the rest of your trial, then added to your first bill."
                    : "Free for the rest of your trial. Add it to your first bill to keep it."
                  : attached || ending
                    ? `${quantity > 1 ? `${quantity} × ` : ""}already on your plan`
                    : `${formatRand(dueTodayCents)} today for the rest of this cycle, then the full price from your next bill.`}
              </p>
            </div>

            <div className="mt-auto">
              {perSeat ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={disabled || !subscribed}
                  onClick={onManageSeats}
                >
                  {!subscribed
                    ? "Add after subscribing"
                    : attached
                      ? `Manage seats (${quantity})`
                      : "Add seats"}
                </Button>
              ) : trialCard ? (
                <Button
                  variant={onNextBill ? "outline" : "default"}
                  className="w-full"
                  disabled={disabled || pending}
                  onClick={() => (onNextBill ? onDetach(addon.id) : onAttach(addon.id))}
                >
                  {pending ? <RefreshCw className="h-4 w-4 animate-spin" /> : onNextBill ? "Remove from next bill" : "Add to next bill"}
                </Button>
              ) : ending ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={disabled || pending}
                  onClick={() => onAttach(addon.id)}
                >
                  {pending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Keep it"}
                </Button>
              ) : attached ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={disabled || pending}
                  onClick={() => onDetach(addon.id)}
                >
                  {pending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Remove"}
                </Button>
              ) : !subscribed ? (
                <Button variant="outline" className="w-full" disabled>
                  {isTrialIncluded ? "Included in trial" : "Add after subscribing"}
                </Button>
              ) : (
                <Button
                  variant={staged ? "outline" : "default"}
                  className="w-full"
                  disabled={disabled}
                  onClick={() => onToggleStage(addon.id)}
                >
                  {staged ? "Selected — remove" : "Add"}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff seats — the extra_staff add-on, given a dedicated card
//
// A per-seat recurring charge deserves more than a bare +/- stepper: the card
// states how many seats they have now, and adding opens a form that shows the
// new total, the monthly increase and the pro-rated amount due today before it
// hands off to PayFast. Adding staff always costs — even during the trial — so
// nobody can stack 20 free seats for 14 days (pricing.md: only chatbot /
// analytics / branded email are "included in the trial").
// ─────────────────────────────────────────────────────────────────────────────

function StaffTopUpDialog({
  open, onOpenChange, addon, currentExtra, totalSeats,
  daysInPeriod, daysRemaining, isTrialing, pending, disabled, onConfirm, onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The extra_staff catalog entry. `undefined` while add-ons load. */
  addon: PlanAddon | undefined;
  /** Extra seats already purchased (0 = only the plan's included seat). */
  currentExtra: number;
  /** Total bookable seats incl. the base seat. `null` = unlimited, `undefined` = loading. */
  totalSeats: number | null | undefined;
  daysInPeriod: number;
  daysRemaining: number;
  isTrialing: boolean;
  pending: boolean;
  disabled: boolean;
  onConfirm: (newQuantity: number) => void;
  /** Schedule all extra seats to drop at period end. */
  onRemove: () => void;
}) {
  const [addCount, setAddCount] = useState(1);

  // Reset to 1 each time it opens.
  useEffect(() => {
    if (open) setAddCount(1);
  }, [open]);

  const seats = typeof totalSeats === "number" ? totalSeats : 0;
  const baseSeats = Math.max(0, seats - currentExtra);
  const maxQty = addon?.max_quantity ?? 1;
  const priceCents = addon?.price_cents ?? 0;
  const remainingCapacity = Math.max(0, maxQty - currentExtra);
  const canAddMore = remainingCapacity > 0;

  // Matches the server's pro-rata formula so the previewed "due today" lines up
  // with what PayFast will actually charge (server is authoritative regardless).
  const dueTodayCents = daysInPeriod > 0
    ? Math.round((priceCents * addCount * daysRemaining) / daysInPeriod)
    : 0;

  const seatWord = (n: number) => (n === 1 ? "staff member" : "staff members");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add staff members</DialogTitle>
          <DialogDescription>
            You currently have {seats} {seatWord(seats)}
            {currentExtra > 0 && <> ({baseSeats} included + {currentExtra} extra)</>}
            {" "}and are adding {addCount} more. Choose how many bookable members to add.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Stepper */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm font-medium">Members to add</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                disabled={addCount <= 1}
                onClick={() => setAddCount((n) => Math.max(1, n - 1))}
              >
                <span className="text-base leading-none">−</span>
              </Button>
              <span className="w-8 text-center font-bold tabular-nums">{addCount}</span>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                disabled={addCount >= remainingCapacity}
                onClick={() => setAddCount((n) => Math.min(remainingCapacity, n + 1))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Cost summary */}
          <InfoTile className="rounded-lg bg-muted/50 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">New total</span>
              <span className="font-semibold tabular-nums">
                {seats + addCount} {seatWord(seats + addCount)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Added to your plan</span>
              <span className="font-semibold tabular-nums">
                +{formatRand(priceCents * addCount)}/mo
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Due today · {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left in this {isTrialing ? "trial" : "cycle"}
              </span>
              <span className="font-bold tabular-nums">
                {formatRand(dueTodayCents)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1">
              You'll be taken to PayFast to pay the once-off amount for the rest of
              this {isTrialing ? "trial" : "billing cycle"}. The exact total is
              confirmed on the payment screen.
            </p>
          </InfoTile>
        </div>

        <DialogFooter
          leading={
            currentExtra > 0 ? (
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={disabled || pending}
                onClick={onRemove}
              >
                Remove extra seats
              </Button>
            ) : null
          }
        >
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={disabled || pending || !canAddMore} onClick={() => onConfirm(currentExtra + addCount)}>
            {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Continue to payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Credits — WhatsApp campaign tokens + marketing email credits
// ─────────────────────────────────────────────────────────────────────────────

function TopUpSection() {
  const [kind, setKind] = useState<CreditKind>("whatsapp_tokens");
  const [pendingBundleId, setPendingBundleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One fetch for the whole catalogue — switching tabs is a filter, not a
  // refetch, so prices do not flicker in as you flip between them.
  const { data: bundles, isLoading } = useQuery({
    queryKey: ["credit-bundles"],
    queryFn: () => fetchCreditBundles(),
  });

  const shown = (bundles ?? []).filter((bundle) => bundle.kind === kind);
  const unitLabel = kind === "whatsapp_tokens" ? "tokens" : "emails";

  async function handleBuy(bundleId: string) {
    setPendingBundleId(bundleId);
    setError(null);
    try {
      // The server prices this from credit_bundles and signs the PayFast fields.
      // Submitting is a real form POST so PayFast can redirect the customer.
      const { action, fields } = await purchaseCreditBundle(bundleId);
      submitPayFastForm(action, fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setPendingBundleId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Top-ups</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One-off bundles for a month that runs long. No subscription and no card stored — bought
            credit does not expire while you stay subscribed.
          </p>
        </div>
        <Tabs value={kind} onValueChange={(value) => setKind(value as CreditKind)}>
          <TabsList>
            <TabsTrigger value="whatsapp_tokens">WhatsApp tokens</TabsTrigger>
            <TabsTrigger value="marketing_emails">Marketing emails</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[62px] w-full rounded-xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-40 items-center justify-center">
            <PageEmptyState
              icon={Sparkles}
              title={`No ${unitLabel} bundles available`}
              description="Bundles are published by the server — check back shortly."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {shown.map((bundle) => (
            <Card key={bundle.id} className="gap-0 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium tabular-nums">
                    {bundle.amount.toLocaleString("en-ZA")} {unitLabel}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    R{(bundle.price_cents / 100 / bundle.amount).toFixed(2)} each
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <p className="text-base font-semibold tabular-nums">{formatRand(bundle.price_cents)}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingBundleId !== null}
                    onClick={() => handleBuy(bundle.id)}
                  >
                    {pendingBundleId === bundle.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      "Buy"
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}


function UsageBar({
  label,
  value,
  total,
  caption,
  kind = "remaining",
}: {
  label: string;
  value: number;
  /** `null` = unlimited. */
  total: number | null;
  caption?: string;
  kind?: "remaining" | "used";
}) {
  const pct = total === null ? 100 : total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const low = kind === "remaining" && total !== null && pct <= 15;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className={cn("tabular-nums", low ? "font-medium text-destructive" : "text-muted-foreground")}>
          {total === null
            ? "unlimited"
            : kind === "remaining"
              ? `${value.toLocaleString("en-ZA")} of ${total.toLocaleString("en-ZA")} left`
              : `${value.toLocaleString("en-ZA")} of ${total.toLocaleString("en-ZA")} in use`}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(low && "bg-destructive/20 [&_[data-slot=progress-indicator]]:bg-destructive")}
      />
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}

/** A single billing option card. */
function PlanCard({
  plan, pending, disabled, trialUsed, onSelect,
}: {
  plan: LaunchPlan;
  pending: boolean;
  disabled: boolean;
  /** This business already used its one free trial — subscribing bills now. */
  trialUsed: boolean;
  onSelect: (name: "Starter") => void;
}) {
  const canCheckout = Boolean(plan.checkoutPlanName) && !plan.comingSoon;

  return (
    <Card className={cn("h-full", plan.highlight && "border-primary")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          {plan.badge ? (
            <Badge
              variant={plan.highlight ? "default" : "secondary"}
              className="shrink-0 rounded-full text-[11px]"
            >
              {plan.badge}
            </Badge>
          ) : null}
        </div>
        <CardDescription className="leading-5">{plan.tagline}</CardDescription>
      </CardHeader>

      <CardContent className="flex h-full flex-col gap-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {plan.priceLabel}
            {!plan.comingSoon ? (
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{plan.priceNote}</p>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground marker:text-muted-foreground/50">
          {plan.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        <div className="mt-auto">
          {plan.comingSoon ? (
            <p className="text-sm text-muted-foreground">
              Not available yet — <RoadmapLink section="team-controls" />.
            </p>
          ) : (
            <Button
              className="w-full"
              disabled={disabled || !canCheckout}
              onClick={() => {
                if (plan.checkoutPlanName) onSelect(plan.checkoutPlanName);
              }}
            >
              {pending
                ? "Redirecting to PayFast..."
                : trialUsed
                  ? `Subscribe — ${plan.priceLabel}/mo`
                  : "Start free trial"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


const INVOICE_PAGE_SIZE = 10;

const HEAD_CLASS = "h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground";

function InvoiceTable({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-border/70 bg-card py-0 shadow-none">
      <div className="overflow-x-auto">
        <Table className="min-w-[480px] table-fixed [&_td]:px-3 [&_th]:px-3 md:min-w-[820px] md:[&_td]:px-4 md:[&_th]:px-4">
          <colgroup>
            <col className="w-[34%] md:w-[20%]" />
            <col className="hidden md:table-column md:w-[14%]" />
            <col className="hidden md:table-column md:w-[26%]" />
            <col className="w-[24%] md:w-[14%]" />
            <col className="w-[26%] md:w-[14%]" />
            <col className="w-[16%] md:w-[12%]" />
          </colgroup>
          <TableHeader className="bg-muted/15">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>Invoice</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Date</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Description</TableHead>
              <TableHead className={HEAD_CLASS}>Amount</TableHead>
              <TableHead className={HEAD_CLASS}>Status</TableHead>
              <TableHead className={`text-right ${HEAD_CLASS}`}>Receipt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  // Set when a PayFast return trip is for a brand-new (or reactivated) trial —
  // once the subscription is confirmed trialing/active, we continue the user
  // onward into onboarding/dashboard instead of stranding them on Billing.
  // See fixes.md item 1.
  const pendingTrialRedirect = useRef(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [staffTopUpOpen, setStaffTopUpOpen] = useState(false);

  // Static content (matches the real add-on render order in ADDON_DISPLAY_ORDER,
  // minus extra_staff which is covered by the Usage Summary step instead) — safe
  // to build once, since rebuilding this array on every render would give
  // TourOverlay's step object a new identity each time and retrigger its
  // target-measuring effect even while no step actually changed.
  const billingTourSteps = useMemo<TourStep[]>(() => {
    const addonSteps: TourStep[] = ADDON_DISPLAY_ORDER
      .filter((id) => id !== "extra_staff")
      .map((id) => ({
        targetId: `addon-${id}`,
        title: ADDON_TOUR_COPY[id].title,
        description: ADDON_TOUR_COPY[id].description,
      }));
    return [
      { targetId: "current-plan-card", ...BILLING_STEP_COPY.plan },
      { targetId: "usage-summary", ...BILLING_STEP_COPY.usage },
      { targetId: "addons-section", ...BILLING_STEP_COPY.addonsIntro },
      ...addonSteps,
      { targetId: "billing-history", ...BILLING_STEP_COPY.invoices },
    ];
  }, []);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: catalogKeys.subscription,
    queryFn: fetchSubscription,
  });

  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: fetchInvoices,
  });

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("all");
  const filteredInvoices = useMemo(() => {
    const list = invoices ?? [];
    const q = invoiceSearch.trim().toLowerCase();
    return list.filter((inv) => {
      if (invoiceStatus !== "all" && inv.status !== invoiceStatus) return false;
      if (!q) return true;
      return [inv.invoiceNumber, inv.description, String(inv.amount)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [invoices, invoiceSearch, invoiceStatus]);

  const [invoicePage, setInvoicePage] = useState(1);
  const invoiceTotalPages = Math.max(1, Math.ceil(filteredInvoices.length / INVOICE_PAGE_SIZE));
  const paginatedInvoices = filteredInvoices.slice(
    (invoicePage - 1) * INVOICE_PAGE_SIZE,
    invoicePage * INVOICE_PAGE_SIZE,
  );
  useEffect(() => {
    setInvoicePage(1);
  }, [invoiceSearch, invoiceStatus]);

  const { data: staffCount } = useQuery({
    queryKey: ["staff-count"],
    queryFn: fetchStaffCount,
  });

  const { data: creditData } = useQuery({
    queryKey: ["credit-balances"],
    queryFn: fetchCreditBalances,
  });

  const { data: entitlements } = useEntitlements();

  const { data: addonData, isError: addonsFailed, error: addonsError } = useQuery({
    queryKey: ["addons"],
    queryFn: fetchAddons,
    retry: false,
  });

  // Attaching/detaching changes what PayFast bills, so entitlements change too —
  // invalidate both so gated features light up (or go dark) without a reload.
  // Attach and detach return different shapes (attach may demand a pro-rata
  // payment; detach reports when access ends), so the result is a union.
  const addonMutation = useMutation<
    AttachAddonResult | DetachAddonResult,
    Error,
    { addonId: string; quantity: number }
  >({
    mutationFn: ({ addonId, quantity }) =>
      quantity > 0 ? attachAddon(addonId, quantity) : detachAddon(addonId),
    onSuccess: (result) => {
      // Attaching mid-cycle needs a pro-rata payment first — hand off to PayFast.
      // The add-on activates when the ITN settles, not when we get back.
      if (result && "requiresPayment" in result && result.requiresPayment && result.action && result.fields) {
        submitPayFastForm(result.action, result.fields);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      queryClient.invalidateQueries({ queryKey: ["entitlements"] });
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
    },
  });

  // Add-ons the user has staged to buy together on one payment. Keyed by id.
  const [stagedAddons, setStagedAddons] = useState<Set<string>>(new Set());
  const toggleStaged = (id: string) =>
    setStagedAddons((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Attach every staged add-on on a single combined pro-rata payment.
  const batchMutation = useMutation<AttachAddonsBatchResult, Error, void>({
    mutationFn: () =>
      attachAddonsBatch(
        [...stagedAddons].map((addonId) => ({ addonId, quantity: 1 })),
      ),
    onSuccess: (result) => {
      if (result.requiresPayment && result.action && result.fields) {
        submitPayFastForm(result.action, result.fields);
        return;
      }
      // All free (trial) — attached already; refresh and clear the selection.
      setStagedAddons(new Set());
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      queryClient.invalidateQueries({ queryKey: ["entitlements"] });
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
    },
  });

  const attachedQuantities = new Map(
    (addonData?.attached ?? []).map((row) => [row.addon_id, row.quantity]),
  );
  const scheduledRemovals = new Map(
    (addonData?.attached ?? [])
      .filter((row) => row.remove_at)
      .map((row) => [row.addon_id, row.remove_at as string]),
  );

  // Days in / left of the current billing (or trial) period, for previewing the
  // pro-rated cost of adding staff. Mirrors the server's formula; the server
  // still recomputes and is authoritative. Falls back to a 30-day period until
  // entitlements load.
  const MS_PER_DAY = 86_400_000;
  const periodStart = entitlements?.currentPeriodStart
    ? new Date(entitlements.currentPeriodStart)
    : null;
  const periodEnd = entitlements?.currentPeriodEnd
    ? new Date(entitlements.currentPeriodEnd)
    : null;
  const periodDays = {
    total: periodStart && periodEnd
      ? Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY))
      : 30,
    remaining: periodEnd
      ? Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / MS_PER_DAY))
      : 0,
  };

  // Plan price comes from the subscription (which reads the plans table) — never
  // hardcoded here, or this drifts the next time the plan is repriced. The server
  // recomputes this same total independently before charging; this is display only.
  //
  // Add-ons scheduled for removal are excluded: they're still usable, but they
  // aren't part of what renews, which is what this total represents.
  const addonMonthlyCents = (addonData?.catalog ?? []).reduce((sum, addon) => {
    if (scheduledRemovals.has(addon.id)) return sum;
    const qty = attachedQuantities.get(addon.id) ?? 0;
    return sum + addon.price_cents * qty;
  }, 0);

  const monthlyTotalCents =
    Math.round((subscription?.price ?? 0) * 100) + addonMonthlyCents;

  const activeAddonLabels = (addonData?.catalog ?? [])
    .map((addon) => {
      if (scheduledRemovals.has(addon.id)) return null;
      const qty = attachedQuantities.get(addon.id) ?? 0;
      if (qty <= 0) return null;
      return qty > 1 ? `${addon.name} x${qty}` : addon.name;
    })
    .filter((label): label is string => Boolean(label));

  // ── Staged batch summary ────────────────────────────────────────────────────
  // The pro-rated amount due today and the resulting new monthly total for the
  // add-ons the user has staged. Same formula the server quotes; display only.
  const stagedLines = (addonData?.catalog ?? [])
    .filter((addon) => stagedAddons.has(addon.id))
    .map((addon) => ({
      id: addon.id,
      name: addon.name,
      priceCents: addon.price_cents,
      dueTodayCents:
        periodDays.total > 0
          ? Math.round((addon.price_cents * periodDays.remaining) / periodDays.total)
          : addon.price_cents,
    }));
  const stagedDueTodayCents = stagedLines.reduce((sum, l) => sum + l.dueTodayCents, 0);
  const stagedMonthlyIncreaseCents = stagedLines.reduce((sum, l) => sum + l.priceCents, 0);
  const stagedNewMonthlyCents = monthlyTotalCents + stagedMonthlyIncreaseCents;



  // ── Derived state ──────────────────────────────────────────────────────────

  const isActiveOrTrialing = subscription?.status === "active" || subscription?.status === "trialing";

  const whatsappCredit = creditData?.balances.find((balance) => balance.kind === "whatsapp_tokens");
  const emailCredit = creditData?.balances.find((balance) => balance.kind === "marketing_emails");

  /** What is left right now: this cycle's unused allowance plus anything bought. */
  const creditRemaining = (balance: CreditBalance | undefined) =>
    balance ? (balance.includedRemaining ?? 0) + balance.purchased : 0;

  /** The ceiling `creditRemaining` is measured against. `null` = unlimited. */
  const creditCapacity = (balance: CreditBalance | undefined) =>
    !balance ? 0 : balance.includedLimit === null ? null : balance.includedLimit + balance.purchased;

  // Cancelling outranks the status itself: the subscription is still "active",
  // but what the business needs to see is that it stops at the period end.
  const planStatusLabel = !subscription
    ? ""
    : subscription.cancelAtPeriodEnd
      ? "Cancelling"
      : subscription.status === "trialing"
        ? "Free trial"
        : subscription.status === "active"
          ? "Active"
          : subscription.status.replace(/_/g, " ");

  const planStatusClass = !subscription
    ? ""
    : subscription.cancelAtPeriodEnd || subscription.status === "past_due"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : isActiveOrTrialing
        ? "border-primary/25 bg-primary/10 text-primary"
        : "border-border bg-muted text-muted-foreground";


  // ── PayFast return URL handling ────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payfastStatus = params.get("payfast");
    const subscriptionId = params.get("subscription_id");

    if (payfastStatus === "success" && subscriptionId) {
      pendingTrialRedirect.current = true;
      checkPayFastPaymentStatus(subscriptionId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
          queryClient.invalidateQueries({ queryKey: ["entitlements"] });
          // Confirmed trialing/active already — continue straight into
          // onboarding (or dashboard) instead of leaving the user on Billing.
          pendingTrialRedirect.current = false;
          resolvePostAuthPath()
            .then(({ path }) => setLocation(path))
            .catch(() => {});
        })
        .catch(() => {
          // Webhook (the only path allowed to activate a subscription, see
          // subscription-management/index.ts check-status handler) may not
          // have landed yet — leave pendingTrialRedirect set so the retry
          // below can pick up the redirect once entitlements confirm it.
          queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
        })
        .finally(() => {
          window.history.replaceState(null, "", window.location.pathname);
        });
      const retry = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
        queryClient.invalidateQueries({ queryKey: ["entitlements"] });
      }, 4000);
      return () => clearTimeout(retry);
    } else if (payfastStatus === "credits_success") {
      // Credits are granted by the PayFast ITN (server-to-server), not by this
      // redirect — so the balance may not have moved yet when the customer lands
      // here. Refetch now and once more shortly after to catch the ITN.
      queryClient.invalidateQueries({ queryKey: ["credit-balances"] });
      const retry = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["credit-balances"] });
      }, 4000);
      window.history.replaceState(null, "", window.location.pathname);
      return () => clearTimeout(retry);
    } else if (payfastStatus === "addon_success") {
      // Same as credits: the add-on is attached by the ITN, not by this redirect,
      // so refetch now and again shortly after to catch it landing.
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      queryClient.invalidateQueries({ queryKey: ["entitlements"] });
      const retry = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["addons"] });
        queryClient.invalidateQueries({ queryKey: ["entitlements"] });
      }, 4000);
      window.history.replaceState(null, "", window.location.pathname);
      return () => clearTimeout(retry);
    } else if (
      payfastStatus === "cancelled" ||
      payfastStatus === "credits_cancelled" ||
      payfastStatus === "addon_cancelled"
    ) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    return undefined;
  }, [queryClient, setLocation]);

  // Delayed-webhook fallback: if the initial check-status call above still saw
  // "incomplete" (ITN hasn't landed), the 4s retry above will eventually
  // refetch entitlements as trialing/active. Catch that transition here and
  // finish the redirect that the effect above deferred.
  useEffect(() => {
    if (pendingTrialRedirect.current && entitlements?.entitled) {
      pendingTrialRedirect.current = false;
      resolvePostAuthPath()
        .then(({ path }) => setLocation(path))
        .catch(() => {});
    }
  }, [entitlements, setLocation]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: createSubscriptionWithPayFast,
    onSuccess: (data) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.action;
      form.style.display = "none";
      Object.entries(data.fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: (subscription) => {
      queryClient.setQueryData(catalogKeys.subscription, subscription);
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      queryClient.invalidateQueries({ queryKey: ["entitlements"] });
      setCancelDialogOpen(false);
    },
  });

  const formatDate = (v: string) =>
    new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(v));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingSubscription) {
    return <BillingPageSkeleton />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Billing"
        description={
          subscription
            ? "Your plan and its allowance, the add-ons you can put on top, and every invoice."
            : "Pick a plan to start taking bookings, sending reminders and running campaigns."
        }
        overflowActions={
          subscription ? (
            <PageOverflowMenu label="Subscription actions" contentClassName="w-52">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelMutation.isPending || subscription.cancelAtPeriodEnd}
              >
                {subscription.cancelAtPeriodEnd
                  ? "Cancellation scheduled"
                  : cancelMutation.isPending
                    ? "Cancelling..."
                    : "Cancel plan"}
              </DropdownMenuItem>
            </PageOverflowMenu>
          ) : null
        }
      />

      {/* ── Subscription ── */}
      {subscription ? (
        <Card data-tour-id="current-plan-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">{subscription.planName} plan</CardTitle>
                <CardDescription>
                  {subscription.cancelAtPeriodEnd
                    ? "Cancelled — you keep everything until the period ends, then you can resubscribe."
                    : subscription.status === "trialing"
                      ? "Free trial. Your allowance refreshes when the first charge goes through."
                      : "Your allowance refreshes at the start of each billing cycle."}
                </CardDescription>
              </div>
              <p className="shrink-0 text-2xl font-semibold tabular-nums">
                {formatRand(monthlyTotalCents)}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <Badge variant="outline" className={cn("rounded-full", planStatusClass)}>
                {planStatusLabel}
              </Badge>
              {subscription.currentPeriodEnd ? (
                <span className="text-muted-foreground">
                  {subscription.cancelAtPeriodEnd
                    ? "access until"
                    : subscription.status === "trialing"
                      ? "first charge"
                      : "renews"}{" "}
                  {formatDate(subscription.currentPeriodEnd)}
                </span>
              ) : null}
              {activeAddonLabels.length > 0 ? (
                <span className="text-muted-foreground">
                  including {activeAddonLabels.join(", ").toLowerCase()}
                </span>
              ) : null}
            </div>

            <div data-tour-id="usage-summary" className="space-y-4">
              <UsageBar
                label="WhatsApp tokens"
                value={creditRemaining(whatsappCredit)}
                total={creditCapacity(whatsappCredit)}
                caption="Spent on campaign sends. Booking confirmations and reminders are free."
              />
              <UsageBar
                label="Marketing emails"
                value={creditRemaining(emailCredit)}
                total={creditCapacity(emailCredit)}
                caption={
                  emailCredit && emailCredit.purchased > 0
                    ? `Includes ${emailCredit.purchased.toLocaleString("en-ZA")} topped up, which carry over.`
                    : undefined
                }
              />
              <UsageBar
                label="Staff seats"
                kind="used"
                value={staffCount ?? 0}
                total={entitlements?.seats?.staff ?? null}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        /* No subscription — choose a plan */
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Plans</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {entitlements?.trialUsed
                ? "You've already used your free trial — subscribing bills your card today. Cancel any time."
                : "Start with a 14-day free trial. Card required, no charge until day 14, cancel any time."}
            </p>
          </div>

          <div className="grid items-stretch gap-4 md:grid-cols-2">
            {LAUNCH_PLANS.map((plan) => (
              <PlanCard
                key={plan.name}
                plan={plan}
                pending={Boolean(plan.checkoutPlanName) && createMutation.isPending && createMutation.variables === plan.checkoutPlanName}
                disabled={createMutation.isPending}
                trialUsed={Boolean(entitlements?.trialUsed)}
                onSelect={(name) => createMutation.mutate(name)}
              />
            ))}
          </div>

          {createMutation.isError ? (
            <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {(createMutation.error as Error)?.message || "Could not start checkout. Please try again."}
            </p>
          ) : null}
        </section>
      )}

      {/* ── Add-ons ── */}
      <section data-tour-id="addons-section" className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Add-ons</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {subscription
              ? "Extra features on top of your plan. Adding one costs the rest of this cycle up front, then the full price from your next bill — dropping one keeps it until the cycle ends."
              : "Optional extras you can put on top of any plan once you have subscribed."}
          </p>
        </div>

        {addonsFailed ? (
          /* Loading add-ons failed — say so rather than silently rendering
             nothing. The usual cause is the edge function not being deployed
             with the /addons routes yet, which is invisible if the section
             just disappears. */
          <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-semibold">Couldn&apos;t load add-ons</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {(addonsError as Error)?.message || "Please refresh and try again."}
              </p>
            </div>
          </div>
        ) : !addonData ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...addonData.catalog]
              .sort((a, b) => addonOrder(a.id) - addonOrder(b.id))
              .map((addon: PlanAddon) => (
                <AddonCard
                  key={addon.id}
                  addon={addon}
                  quantity={attachedQuantities.get(addon.id) ?? 0}
                  removeAt={scheduledRemovals.get(addon.id) ?? null}
                  isTrialing={subscription?.status === "trialing"}
                  isTrialIncluded={TRIAL_INCLUDED_ADDONS.includes(addon.id)}
                  daysInPeriod={periodDays.total}
                  daysRemaining={periodDays.remaining}
                  staged={stagedAddons.has(addon.id)}
                  onToggleStage={toggleStaged}
                  pending={addonMutation.isPending && addonMutation.variables?.addonId === addon.id}
                  disabled={!subscription || addonMutation.isPending || batchMutation.isPending}
                  onAttach={(id) => addonMutation.mutate({ addonId: id, quantity: 1 })}
                  onDetach={(id) => addonMutation.mutate({ addonId: id, quantity: 0 })}
                  onManageSeats={() => setStaffTopUpOpen(true)}
                  subscribed={Boolean(subscription)}
                />
              ))}
          </div>
        )}

        {/* Selecting more than one add-on pays for them together on a single
            pro-rata charge, rather than sending the customer to PayFast once
            per feature. */}
        {stagedLines.length > 0 ? (
          <Card className="border-primary">
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {stagedLines.length} add-on{stagedLines.length > 1 ? "s" : ""} selected —{" "}
                  <span className="tabular-nums">{formatRand(stagedDueTodayCents)}</span> due today
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Covers the rest of this cycle ({periodDays.remaining} of {periodDays.total} days),
                  then {formatRand(stagedNewMonthlyCents)}/mo from your next bill.
                </p>
              </div>
              <Button
                className="shrink-0"
                disabled={batchMutation.isPending}
                onClick={() => batchMutation.mutate()}
              >
                {batchMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  "Continue to payment"
                )}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {batchMutation.isError ? (
          <p className="text-sm text-destructive">
            {(batchMutation.error as Error)?.message || "Could not add these add-ons."}
          </p>
        ) : null}
        {addonMutation.isError ? (
          <p className="text-sm text-destructive">
            {(addonMutation.error as Error)?.message || "Could not update your add-ons."}
          </p>
        ) : null}
      </section>

      {/* ── Top-ups ── */}
      {subscription ? <TopUpSection /> : null}

      <StaffTopUpDialog
        open={staffTopUpOpen}
        onOpenChange={setStaffTopUpOpen}
        addon={addonData?.catalog.find((a) => a.id === "extra_staff")}
        currentExtra={attachedQuantities.get("extra_staff") ?? 0}
        totalSeats={entitlements?.seats?.staff}
        daysInPeriod={periodDays.total}
        daysRemaining={periodDays.remaining}
        isTrialing={subscription?.status === "trialing"}
        pending={addonMutation.isPending && addonMutation.variables?.addonId === "extra_staff"}
        disabled={addonMutation.isPending}
        onConfirm={(newQuantity) => {
          addonMutation.mutate({ addonId: "extra_staff", quantity: newQuantity });
          setStaffTopUpOpen(false);
        }}
        onRemove={() => {
          addonMutation.mutate({ addonId: "extra_staff", quantity: 0 });
          setStaffTopUpOpen(false);
        }}
      />


      {/* ── Billing History ── */}
      {subscription || (invoices && invoices.length > 0) || loadingInvoices ? (
        <section data-tour-id="billing-history" className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Billing history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every payment on this account. Open one to print it or save it as a PDF.
            </p>
          </div>

          <DataViewToolbar>
            <div className="min-w-0 flex-1">
              <Input
                placeholder="Search"
                value={invoiceSearch}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setInvoiceSearch(event.target.value)}
              />
            </div>
            <Select value={invoiceStatus} onValueChange={setInvoiceStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </DataViewToolbar>

          {loadingInvoices ? (
            <InvoiceTable>
              <TableRowsSkeleton rows={INVOICE_PAGE_SIZE} columns={6} />
            </InvoiceTable>
          ) : filteredInvoices.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-64 items-center justify-center">
                <PageEmptyState
                  icon={Receipt}
                  title={
                    (invoices?.length ?? 0) === 0
                      ? "No invoices yet"
                      : "No invoices match your filters"
                  }
                  description={
                    (invoices?.length ?? 0) === 0
                      ? "Your first payment will appear here, ready to print or save as a PDF."
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <InvoiceTable>
              {paginatedInvoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="group h-16 border-border/50 transition-colors hover:bg-muted/20 [&_td]:align-middle [&_td]:py-3.5"
                >
                  <TableCell className="font-medium tabular-nums">{inv.invoiceNumber}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {new Date(inv.paymentDate).toLocaleDateString("en-ZA")}
                  </TableCell>
                  <TableCell className="hidden truncate text-sm text-foreground/75 md:table-cell">
                    {inv.description || "Subscription"}
                  </TableCell>
                  <TableCell className="text-sm font-semibold tabular-nums text-foreground">
                    R {inv.amount.toLocaleString("en-ZA")}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Download / print invoice"
                      onClick={() => printInvoice(inv)}
                    >
                      <Download className="h-4 w-4 text-muted-foreground" />
                      <span className="sr-only">Download invoice {inv.invoiceNumber}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </InvoiceTable>
          )}

          <EntityListPagination
            currentPage={invoicePage}
            totalPages={invoiceTotalPages}
            onPageChange={setInvoicePage}
            totalCount={filteredInvoices.length}
            pageSize={INVOICE_PAGE_SIZE}
            itemLabel="invoices"
          />
        </section>
      ) : null}


      {/* ══════════════════════════════════════════════════════════════════════
          Cancel Dialog
         ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-lg">
              Cancel renewal?
            </DialogTitle>
            <DialogDescription className="leading-6">
              This stops future renewals. Your current access stays active until the end of this billing period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            <div>
              <p className="text-sm font-semibold">What changes</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                You can keep using your plan until the period ends. After that, plan features and add-ons will be removed.
              </p>
            </div>
            <ul className="space-y-2.5 rounded-lg border bg-muted/30 p-4">
              {[
                "Your booking page and its shareable link",
                "Automated booking emails and WhatsApp messages",
                "Marketing campaigns and any remaining token balance",
                ...activeAddonLabels,
              ].map((f) => (
                <li key={f} className="flex gap-2 text-sm leading-5 text-muted-foreground">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/45" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {cancelMutation.isError && (
              <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {(cancelMutation.error as Error)?.message || "Could not cancel your subscription. Please try again."}
              </p>
            )}
          </div>

          <DialogFooter variant="bordered">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Keep My Plan
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Scheduling...</>
              ) : (
                "Cancel Renewal"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TourOverlay tourId="billing" steps={billingTourSteps} onFinish={() => setLocation("/get-started")} />
      <BackToChecklistLink />
    </div>
  );
}
