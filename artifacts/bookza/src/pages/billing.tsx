import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  fetchSubscription,
  updateSubscription,
  cancelSubscription,
  createSubscriptionWithPayFast,
  checkPayFastPaymentStatus,
  createCustomPlanWithPayFast,
  updateCustomPlanWithPayFast,
  fetchInvoices,
  fetchTodayUsage,
  fetchMonthlyBookingCount,
  fetchStaffCount,
} from "@/lib/catalog-subscriptions";
import { catalogKeys } from "@/lib/catalog";
import {
  fetchCreditBalances,
  fetchCreditBundles,
  purchaseCreditBundle,
  submitPayFastForm,
  formatCredits,
  formatRand,
  type CreditBalance,
  type CreditKind,
} from "@/lib/credits";
import {
  fetchAddons, attachAddon, detachAddon,
  type PlanAddon, type AttachAddonResult, type DetachAddonResult,
} from "@/lib/addons";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CreditCard, Download, Receipt, Building2, Sparkles,
  Plus, Sliders, MessageSquare, Bot, BarChart3, Users, MapPin,
  Calendar, Phone, Mail, Crown, Percent, Info, Star, Globe,
  ArrowRight, TrendingUp, Shield, Rocket, AlertTriangle, CheckCircle2,
  RefreshCw, Lock, X, MoreHorizontal,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { BillingPageSkeleton } from "@/components/skeletons/page-skeletons";


// ─────────────────────────────────────────────────────────────────────────────
// Plan definitions — single source of truth
// ─────────────────────────────────────────────────────────────────────────────

type PlanFeature = {
  icon: React.ElementType;
  label: string;
  included: boolean;
  highlight?: boolean;
};

type PlanTier = {
  name: string;
  monthlyPrice: number;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  borderColor: string;
  badgeColor: string;
  icon: React.ElementType;
  tagline: string;
  limits: {
    locations: number;
    staff: number;
    bookingsPerMonth: number;
    marketingMessages: number;
  };
  features: PlanFeature[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Custom plan builder
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_PRICING = {
  basePrice: 99,
  locations: 50,
  staff: 20,
  bookingsPerMonth: 1, // R1 per booking
  marketingMessagesPerDay: 0.20, // R0.20 per message (will be multiplied by 31 for monthly)
  whatsappEnabled: 149,
  whatsappMessagesPerDay: 0.02,
  analyticsEnabled: 99,
  aiAssistantEnabled: 199,
  whiteLabelEnabled: 199,
  customDomainEnabled: 99,
  reviewRequestsEnabled: 49,
  automatedCampaignsEnabled: 79,
  prioritySupportEnabled: 99,
};

const DISCOUNT_TIERS = [
  { threshold: 0, discount: 0 },
  { threshold: 500, discount: 5 },
  { threshold: 1000, discount: 10 },
  { threshold: 2000, discount: 15 },
  { threshold: 5000, discount: 20 },
  { threshold: 10000, discount: 25 },
];

const MAX_MESSAGES_PER_DAY = 2000;

type CustomPlanConfig = {
  name: string;
  locations: number;
  staff: number;
  bookingsPerMonth: number;
  marketingMessagesPerDay: number;
  whatsappEnabled: boolean;
  whatsappMessagesPerDay: number;
  analyticsEnabled: boolean;
  aiAssistantEnabled: boolean;
  whiteLabelEnabled: boolean;
  customDomainEnabled: boolean;
  reviewRequestsEnabled: boolean;
  automatedCampaignsEnabled: boolean;
  prioritySupportEnabled: boolean;
};



type BillingInvoice = {
  id: string;
  date: string;
  plan: string;
  amount: number;
  status: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Animated usage ring */
function UsageRing({
  value, max, label, sublabel, color,
}: {
  value: number; max: number | null; label: string; sublabel: string; color: string;
}) {
  const pct = max ? Math.min(Math.round((value / max) * 100), 100) : null;
  const isDanger = pct !== null && pct >= 90;
  const isWarn   = pct !== null && pct >= 70;

  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = pct !== null ? circumference * (1 - pct / 100) : 0;

  return (
    <div className="flex flex-col items-center gap-2 p-4 bg-card rounded-xl border border-border/60 hover:shadow-md transition-shadow">
      <div className="relative w-20 h-20 flex items-center justify-center">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
          {/* Background track */}
          <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="6"
            className="stroke-muted" />
          {/* Progress arc */}
          {pct !== null && (
            <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="6"
              strokeLinecap="round"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: dashOffset,
                transition: "stroke-dashoffset 1s ease",
              }}
              className={cn(
                isDanger ? "stroke-red-500" :
                isWarn   ? "stroke-amber-500" :
                           color,
              )}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn(
            "text-xs font-bold leading-none",
            isDanger ? "text-red-600" : isWarn ? "text-amber-600" : "text-foreground",
          )}>
            {pct !== null ? `${pct}%` : "∞"}
          </span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
      </div>
    </div>
  );
}

/** Usage bar with label */
function UsageBar({
  used, max, label, icon: Icon, color,
}: {
  used: number; max: number | null; label: string; icon: React.ElementType; color: string;
}) {
  const pct = max ? Math.min(Math.round((used / max) * 100), 100) : null;
  const isDanger = pct !== null && pct >= 90;
  const isWarn   = pct !== null && pct >= 70;

  const barColor = isDanger ? "bg-red-500" : isWarn ? "bg-amber-500" : color;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", isDanger ? "text-red-500" : isWarn ? "text-amber-500" : "text-primary")} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{used.toLocaleString()}</span>
          {max ? ` / ${max.toLocaleString()}` : " / ∞"}
        </span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", barColor)}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      {isDanger && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Nearing limit — consider upgrading
        </p>
      )}
    </div>
  );
}

/** Feature access chip — shown or locked */
function FeatureChip({
  icon: Icon, label, included, highlight,
}: {
  icon: React.ElementType; label: string; included: boolean; highlight?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2.5 p-3 rounded-lg border text-sm transition-all",
      included
        ? highlight
          ? "bg-primary/5 border-primary/20 text-foreground"
          : "bg-card border-border/50 text-foreground"
        : "bg-muted/30 border-border/30 text-muted-foreground opacity-60",
    )}>
      <div className={cn(
        "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
        included ? (highlight ? "bg-primary/10" : "bg-muted") : "bg-muted/50",
      )}>
        {included
          ? <Icon className={cn("w-3.5 h-3.5", highlight ? "text-primary" : "text-muted-foreground")} />
          : <Lock className="w-3 h-3 text-muted-foreground/50" />
        }
      </div>
      <span className={cn("flex-1 font-medium", !included && "line-through decoration-muted-foreground/40")}>
        {label}
      </span>
      {included
        ? <CheckCircle2 className={cn("w-4 h-4 shrink-0", highlight ? "text-primary" : "text-emerald-500")} />
        : <X className="w-4 h-4 shrink-0 text-muted-foreground/40" />
      }
    </div>
  );
}

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
  icon: React.ElementType;
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
    icon: Sparkles,
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
    icon: Users,
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
const ADDON_COPY: Record<string, { icon: React.ElementType; blurb: string; unit?: string }> = {
  whatsapp_chatbot: {
    icon: Bot,
    blurb: "Let customers ask questions, check availability and book through WhatsApp 24/7, answered automatically.",
  },
  analytics: {
    icon: BarChart3,
    blurb: "Detailed reports on bookings, revenue, services, clients and staff.",
  },
  branded_email: {
    icon: Mail,
    blurb: "Send booking notifications and campaigns from your own verified business email address.",
  },
  extra_staff: {
    icon: Users,
    blurb: "Add another bookable team member with their own availability, services and schedule.",
    unit: "per staff member",
  },
  ai_assistant: {
    icon: Sparkles,
    blurb: "Search bookings and clients, check availability and get suggested business actions using AI.",
  },
  custom_domain: {
    icon: Globe,
    blurb: "Connect your own domain or subdomain to your Qwickly booking page.",
  },
};

function AddonRow({
  addon, quantity, removeAt, pending, disabled, isTrialing, isTrialIncluded,
  daysInPeriod, daysRemaining,
  onAttach, onDetach, onQuantityChange,
}: {
  addon: PlanAddon;
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
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  onQuantityChange: (id: string, quantity: number) => void;
}) {
  const copy = ADDON_COPY[addon.id] ?? { icon: Plus, blurb: "" };
  const Icon = copy.icon;
  const attached = quantity > 0;
  const comingSoon = !addon.is_active;
  const isQuantityAddon = addon.max_quantity > 1;
  const ending = Boolean(removeAt);

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

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        attached && !ending && "border-primary/40 bg-primary/[0.03]",
        ending && "border-amber-500/40 bg-amber-500/[0.03]",
        comingSoon && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn(
          "rounded-lg p-2 shrink-0",
          ending ? "bg-amber-500/10 text-amber-600 dark:text-amber-500"
            : attached ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{addon.name}</span>
            {comingSoon && <Badge variant="outline" className="text-[10px]">Coming soon</Badge>}
            {trialCard && (
              <Badge className="text-[10px] bg-primary/15 text-primary hover:bg-primary/15 border-0">
                Included in trial
              </Badge>
            )}
            {trialCard && onNextBill && (
              <Badge variant="outline" className="text-[10px]">On next bill</Badge>
            )}
            {!trialCard && attached && !comingSoon && !ending && (
              <Badge className="text-[10px] bg-primary/15 text-primary hover:bg-primary/15 border-0">
                Active
              </Badge>
            )}
            {!trialCard && ending && (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-500">
                Ends {endsOn}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {trialCard
              ? onNextBill
                ? `Free during your trial, then ${formatRand(addon.price_cents)}/mo — added to your first bill.`
                : `Free during your trial. Add it to your first bill to keep it afterwards.`
              : ending
                ? `Cancelled — you keep this until ${endsOn}, then it won't renew. Re-add it before then at no extra cost.`
                : copy.blurb}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:shrink-0 sm:pl-3">
        <div className="text-right">
          {comingSoon ? (
            <span className="text-sm text-muted-foreground">TBC</span>
          ) : !trialCard && !attached && !ending ? (
            // Not attached: what PayFast will actually charge today (pro-rated
            // for the rest of this cycle), with the ongoing monthly price below.
            <>
              <div className="font-black tabular-nums leading-none">
                {formatRand(dueTodayCents)}
                <span className="text-xs font-normal text-muted-foreground"> today</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                covers the rest of this cycle
                <br />
                then {formatRand(addon.price_cents)}/mo from your next bill
              </div>
            </>
          ) : (
            <>
              <div className="font-black tabular-nums leading-none">
                {formatRand(addon.price_cents)}
                <span className="text-xs font-normal text-muted-foreground">/mo</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {trialCard ? "after trial" : copy.unit}
              </div>
            </>
          )}
        </div>

        {!comingSoon && (
          trialCard ? (
            <Button
              variant={onNextBill ? "outline" : "default"}
              size="sm"
              disabled={disabled || pending}
              onClick={() => (onNextBill ? onDetach(addon.id) : onAttach(addon.id))}
              className="min-w-[120px]"
            >
              {pending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : onNextBill ? "Remove" : "Add to next bill"}
            </Button>
          ) : ending ? (
            <Button
              variant="outline" size="sm"
              disabled={disabled || pending}
              onClick={() => onAttach(addon.id)}
              className="min-w-[76px]"
            >
              {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Keep"}
            </Button>
          ) : isQuantityAddon && attached ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                disabled={disabled || pending}
                onClick={() =>
                  quantity <= 1 ? onDetach(addon.id) : onQuantityChange(addon.id, quantity - 1)
                }
              >
                <span className="text-base leading-none">−</span>
              </Button>
              <span className="w-6 text-center font-semibold tabular-nums text-sm">{quantity}</span>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                disabled={disabled || pending || quantity >= addon.max_quantity}
                onClick={() => onQuantityChange(addon.id, quantity + 1)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              variant={attached ? "outline" : "default"}
              size="sm"
              disabled={disabled || pending}
              onClick={() => (attached ? onDetach(addon.id) : onAttach(addon.id))}
              className="min-w-[76px]"
            >
              {pending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : attached ? "Remove" : "Add"}
            </Button>
          )
        )}
      </div>
    </div>
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

function StaffSeatsCard({
  addon, currentExtra, totalSeats, removeAt, isTrialing,
  daysInPeriod, daysRemaining, pending, disabled,
  onSetQuantity, onDetach,
}: {
  addon: PlanAddon;
  /** Extra seats already purchased (0 = only the plan's included seat). */
  currentExtra: number;
  /** Total bookable seats incl. the base seat. `null` = unlimited, `undefined` = still loading. */
  totalSeats: number | null | undefined;
  removeAt: string | null;
  isTrialing: boolean;
  daysInPeriod: number;
  daysRemaining: number;
  pending: boolean;
  disabled: boolean;
  onSetQuantity: (quantity: number) => void;
  onDetach: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [addCount, setAddCount] = useState(1);

  const loading = totalSeats === undefined;
  const unlimited = totalSeats === null;
  const seats = typeof totalSeats === "number" ? totalSeats : 0;
  const baseSeats = Math.max(0, seats - currentExtra);
  const ending = Boolean(removeAt);
  const endsOn = removeAt
    ? new Date(removeAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : null;

  const remainingCapacity = Math.max(0, addon.max_quantity - currentExtra);
  const canAddMore = remainingCapacity > 0;

  // Matches the server's pro-rata formula so the previewed "due today" lines up
  // with what PayFast will actually charge (server is authoritative regardless).
  const monthlyAddCents = addon.price_cents * addCount;
  const dueTodayCents = daysInPeriod > 0
    ? Math.round((addon.price_cents * addCount * daysRemaining) / daysInPeriod)
    : 0;

  const seatWord = (n: number) => (n === 1 ? "staff member" : "staff members");

  const openForm = () => {
    setAddCount(1);
    setOpen(true);
  };

  const confirm = () => {
    onSetQuantity(currentExtra + addCount);
    setOpen(false);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        currentExtra > 0 && !ending && "border-primary/40 bg-primary/[0.03]",
        ending && "border-amber-500/40 bg-amber-500/[0.03]",
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn(
          "rounded-lg p-2 shrink-0",
          ending ? "bg-amber-500/10 text-amber-600 dark:text-amber-500"
            : currentExtra > 0 ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}>
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Staff Members</span>
            {ending && (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-500">
                Extra seats end {endsOn}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {loading
              ? "Loading your seats…"
              : unlimited
                ? "Your plan includes unlimited bookable staff members."
                : (
                  <>
                    You currently have{" "}
                    <span className="font-semibold text-foreground">
                      {seats} {seatWord(seats)}
                    </span>
                    {currentExtra > 0 && (
                      <> ({baseSeats} included + {currentExtra} extra)</>
                    )}
                    .{" "}
                    {ending
                      ? `Extra seats stay until ${endsOn}, then won't renew.`
                      : `Each extra member is ${formatRand(addon.price_cents)}/mo.`}
                  </>
                )}
          </p>
        </div>
      </div>

      {!loading && !unlimited && (
        <div className="flex items-center gap-2 sm:shrink-0 sm:pl-3">
          {ending ? (
            <Button
              variant="outline" size="sm"
              disabled={disabled || pending}
              onClick={() => onSetQuantity(currentExtra)}
              className="min-w-[76px]"
            >
              {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Keep"}
            </Button>
          ) : (
            <>
              {currentExtra > 0 && (
                <Button
                  variant="ghost" size="sm"
                  disabled={disabled || pending}
                  onClick={onDetach}
                  className="text-muted-foreground"
                >
                  Remove extra
                </Button>
              )}
              <Button
                size="sm"
                disabled={disabled || pending || !canAddMore}
                onClick={openForm}
              >
                {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : (
                  <><Plus className="h-3.5 w-3.5 mr-1" /> Add more members</>
                )}
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── Add-seats form ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add staff members</DialogTitle>
            <DialogDescription>
              You currently have {seats} {seatWord(seats)}
              {currentExtra > 0 && <> ({baseSeats} included + {currentExtra} extra)</>}.
              Choose how many more bookable members to add.
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
            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">New total</span>
                <span className="font-semibold tabular-nums">
                  {seats + addCount} {seatWord(seats + addCount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Added to your plan</span>
                <span className="font-semibold tabular-nums">
                  +{formatRand(monthlyAddCents)}/mo
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Due today · {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left in this {isTrialing ? "trial" : "cycle"}
                </span>
                <span className="font-black tabular-nums">
                  {formatRand(dueTodayCents)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                You'll be taken to PayFast to pay the once-off amount for the rest of
                this {isTrialing ? "trial" : "billing cycle"}. The exact total is
                confirmed on the payment screen.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={disabled || pending} onClick={confirm}>
              {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Continue to payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Credits — WhatsApp campaign tokens + marketing email credits
// ─────────────────────────────────────────────────────────────────────────────

const CREDIT_COPY: Record<CreditKind, { title: string; icon: React.ElementType; blurb: string }> = {
  whatsapp_tokens: {
    title: "WhatsApp campaign tokens",
    icon: MessageSquare,
    blurb: "Used for campaigns to existing WhatsApp inbox contacts. New-number WhatsApp outreach is coming soon.",
  },
  marketing_emails: {
    title: "Marketing emails",
    icon: Mail,
    blurb: "Used for email campaigns. Booking emails are unlimited and never use credits.",
  },
};

/** One balance card: included allowance for this month + purchased credits. */
function CreditBalanceCard({
  balance,
  onTopUp,
}: {
  balance: CreditBalance;
  onTopUp: (kind: CreditKind) => void;
}) {
  const copy = CREDIT_COPY[balance.kind];
  const Icon = copy.icon;
  const unlimited = balance.includedLimit === null;
  const includedRemaining = balance.includedRemaining ?? 0;
  const total = unlimited ? null : includedRemaining + balance.purchased;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">{copy.title}</CardTitle>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black tabular-nums leading-none">
              {formatCredits(total)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">available</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 flex-1">
        {!unlimited && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border p-2.5">
              <div className="text-muted-foreground text-[11px]">Included this month</div>
              <div className="font-semibold tabular-nums">
                {includedRemaining.toLocaleString("en-ZA")}
                <span className="text-muted-foreground font-normal">
                  {" "}/ {(balance.includedLimit ?? 0).toLocaleString("en-ZA")}
                </span>
              </div>
            </div>
            <div className="rounded-lg border p-2.5">
              <div className="text-muted-foreground text-[11px]">Purchased</div>
              <div className="font-semibold tabular-nums">
                {balance.purchased.toLocaleString("en-ZA")}
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">{copy.blurb}</p>

        {!unlimited && (
          <p className="text-[11px] text-muted-foreground">
            Included credits reset each billing month. Purchased credits don't expire while your
            subscription is active.
          </p>
        )}

        <Button
          size="sm"
          className="mt-auto w-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          onClick={() => onTopUp(balance.kind)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Top up
        </Button>
      </CardContent>
    </Card>
  );
}

/** Bundle picker. Prices come from the server catalog — never hardcoded here. */
function TopUpDialog({
  open, kind, onOpenChange,
}: {
  open: boolean;
  kind: CreditKind | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pendingBundleId, setPendingBundleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: bundles, isLoading } = useQuery({
    queryKey: ["credit-bundles", kind],
    queryFn: () => fetchCreditBundles(kind ?? undefined),
    enabled: open && Boolean(kind),
  });

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buy {unitLabel}</DialogTitle>
          <DialogDescription>
            A once-off payment — no subscription, no card stored. Your balance updates a few seconds
            after payment confirms.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {(bundles ?? []).map((bundle) => {
              const perUnit = bundle.price_cents / 100 / bundle.amount;
              return (
                <button
                  key={bundle.id}
                  onClick={() => handleBuy(bundle.id)}
                  disabled={pendingBundleId !== null}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                    "hover:border-primary hover:bg-primary/5",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                  )}
                >
                  <div>
                    <div className="font-semibold tabular-nums">
                      {bundle.amount.toLocaleString("en-ZA")} {unitLabel}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      R{perUnit.toFixed(2)} each
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-black tabular-nums">{formatRand(bundle.price_cents)}</span>
                    {pendingBundleId === bundle.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function MiniUsageBar({
  label,
  used,
  total,
}: {
  label: string;
  used: number;
  total: number | null;
}) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-lg font-black leading-none tabular-nums text-white">
            {total === null
              ? `${used.toLocaleString("en-ZA")} / ∞`
              : `${used.toLocaleString("en-ZA")} / ${total.toLocaleString("en-ZA")}`}
          </div>
          <div className="mt-1 text-[11px] text-white/60">{label}</div>
        </div>
        {total !== null && (
          <span className="text-[11px] font-medium text-white/60">{pct}%</span>
        )}
      </div>
      <div className="h-2.5 max-w-[86%] overflow-hidden rounded-full bg-white/12">
        <div
          className="h-full rounded-full bg-white transition-all"
          style={{ width: total === null ? "100%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SubscriptionUsageSummary({
  creditData,
  onTopUp,
}: {
  creditData: Awaited<ReturnType<typeof fetchCreditBalances>> | undefined;
  onTopUp: (kind: CreditKind) => void;
}) {
  const whatsapp = creditData?.balances.find((balance) => balance.kind === "whatsapp_tokens");
  const email = creditData?.balances.find((balance) => balance.kind === "marketing_emails");

  const creditTotal = (balance: CreditBalance | undefined) =>
    balance
      ? balance.includedLimit === null
        ? null
        : (balance.includedRemaining ?? 0) + balance.purchased
      : 0;

  return (
    // Dark counterpart to the green Current Plan card — same structure, the
    // site's navy (#09111d → #0f172a) instead of green — so the two cards carry
    // equal weight. White CTA with dark text mirrors the green card's white CTA.
    <Card className="rounded-xl border-0 bg-[radial-gradient(circle_at_92%_10%,rgba(255,255,255,0.14),transparent_28%),linear-gradient(145deg,#09111d_0%,#0f172a_100%)] text-white shadow-[0_26px_68px_rgba(15,23,42,0.28)]">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between border-b border-white/15 pb-3">
          <h2 className="text-sm font-bold">Usage Summary</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-8 border-0 bg-white text-[#0f172a] shadow-[0_14px_32px_rgba(0,0,0,0.28)] hover:bg-white/90 hover:text-[#0f172a] focus-visible:!ring-white/40 focus-visible:!ring-offset-0"
              >
                Top up
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => onTopUp("whatsapp_tokens")}>
                <MessageSquare className="h-4 w-4" />
                WhatsApp tokens
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onTopUp("marketing_emails")}>
                <Mail className="h-4 w-4" />
                Marketing emails
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="space-y-6">
          <MiniUsageBar
            label="WhatsApp Tokens Available"
            used={creditTotal(whatsapp) ?? 0}
            total={whatsapp?.includedLimit === null ? null : (whatsapp?.includedLimit ?? 0) + (whatsapp?.purchased ?? 0)}
          />
          <MiniUsageBar
            label="Marketing Emails Available"
            used={creditTotal(email) ?? 0}
            total={email?.includedLimit === null ? null : (email?.includedLimit ?? 0) + (email?.purchased ?? 0)}
          />
        </div>
      </CardContent>
    </Card>
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
  const Icon = plan.icon;
  const isFeatured = plan.highlight;
  const canCheckout = Boolean(plan.checkoutPlanName) && !plan.comingSoon;

  return (
    <div className={cn(
      "relative flex min-h-full flex-col overflow-hidden rounded-2xl border p-6 transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-md active:scale-[0.99]",
      isFeatured
        ? "border-emerald-500/25 bg-[radial-gradient(circle_at_92%_10%,rgba(255,255,255,0.18),transparent_28%),linear-gradient(145deg,#0f3b35_0%,#167a57_100%)] text-white shadow-2xl shadow-emerald-900/20"
        : "border-border/70 bg-card text-foreground shadow-sm",
      plan.comingSoon && "opacity-80",
    )}>
      {plan.badge && (
        <Badge className={cn(
          "absolute right-5 top-5 border-0 text-[11px] font-black",
          isFeatured
            ? "bg-white/16 text-white hover:bg-white/16"
            : "bg-muted text-muted-foreground hover:bg-muted",
        )}>
          {plan.badge}
        </Badge>
      )}

      <div className="mb-1 flex items-center gap-2 pr-24">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          isFeatured ? "bg-white/14 text-white" : "bg-primary/10 text-primary",
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-lg font-bold">{plan.name}</h3>
      </div>

      <p className={cn(
        "min-h-[3rem] text-sm leading-6",
        isFeatured ? "text-white/78" : "text-muted-foreground",
      )}>
        {plan.tagline}
      </p>

      <div className="mt-2 mb-1">
        <span className="text-4xl font-black tracking-tight">{plan.priceLabel}</span>
        {!plan.comingSoon && (
          <span className={cn(
            "font-medium",
            isFeatured ? "text-white/68" : "text-muted-foreground",
          )}> / month</span>
        )}
      </div>

      <p className={cn(
        "mb-4 text-xs",
        isFeatured ? "text-white/70" : "text-muted-foreground",
      )}>
        {plan.priceNote}
      </p>

      <ul className="space-y-2 mb-6 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              isFeatured ? "text-white" : "text-primary",
            )} />
            <span className={isFeatured ? "text-white/78" : undefined}>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        className={cn(
          "w-full font-semibold",
          isFeatured && "bg-white text-emerald-900 shadow-lg shadow-black/15 hover:bg-white/90",
        )}
        variant={isFeatured ? "default" : "outline"}
        disabled={disabled || !canCheckout}
        onClick={() => {
          if (plan.checkoutPlanName) onSelect(plan.checkoutPlanName);
        }}
      >
        {plan.comingSoon
          ? "Coming soon"
          : pending
            ? "Redirecting to PayFast..."
            : trialUsed
              ? `Subscribe · ${plan.priceLabel}/mo`
              : "Start 14-day free trial"}
        {!pending && !plan.comingSoon && <ArrowRight className="w-4 h-4 ml-2" />}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [customPlanOpen, setCustomPlanOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [enterpriseDialogOpen, setEnterpriseDialogOpen] = useState(false);
  const [enterpriseRequested, setEnterpriseRequested] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set());
  const [tabWarningOpen, setTabWarningOpen] = useState(false);
  const [topUpKind, setTopUpKind] = useState<CreditKind | null>(null);
  const [manageAddonsOpen, setManageAddonsOpen] = useState(false);

  const handleTabChange = (value: string) => {
    setVisitedTabs(prev => new Set([...prev, value]));
  };

  const [customPlan, setCustomPlan] = useState<CustomPlanConfig>({
    name: "Custom Plan",
    locations: 1,
    staff: 2,
    bookingsPerMonth: 150,
    marketingMessagesPerDay: 100,
    whatsappEnabled: false,
    whatsappMessagesPerDay: 50,
    analyticsEnabled: false,
    aiAssistantEnabled: false,
    whiteLabelEnabled: false,
    customDomainEnabled: false,
    reviewRequestsEnabled: false,
    automatedCampaignsEnabled: false,
    prioritySupportEnabled: false,
  });

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: catalogKeys.subscription,
    queryFn: fetchSubscription,
  });

  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: fetchInvoices,
  });

  const { data: todayUsage } = useQuery({
    queryKey: ["today-usage"],
    queryFn: fetchTodayUsage,
  });

  const { data: monthlyBookingCount } = useQuery({
    queryKey: ["monthly-booking-count"],
    queryFn: fetchMonthlyBookingCount,
  });

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



  // ── Derived state ──────────────────────────────────────────────────────────

  const isActiveOrTrialing = subscription?.status === "active" || subscription?.status === "trialing";

  // Check if subscription is a custom plan
  const isCustomPlan = subscription?.planId?.startsWith("custom_") || subscription?.planName === "Custom Plan";

  // For custom plans, extract limits from subscription metadata
  let currentTier: PlanTier | null = null;
  let limits: PlanTier["limits"] | null = null;
  
  if (isCustomPlan && subscription) {
    const customConfig = (subscription as any).plans?.metadata || {};
    console.log("[Billing] Custom config from subscription:", customConfig);
    limits = {
      locations: customConfig.locations || 1,
      staff: customConfig.staff || 1,
      bookingsPerMonth: customConfig.bookingsPerMonth || 100,
      marketingMessages: customConfig.marketingMessagesPerDay || 50,
    };
    currentTier = {
      name: customConfig.name || "Custom Plan",
      monthlyPrice: subscription.price,
      color: "text-purple-600",
      gradientFrom: "from-purple-50",
      gradientTo: "to-pink-50",
      borderColor: "border-purple-200",
      badgeColor: "bg-purple-100 text-purple-700",
      icon: Sliders,
      tagline: "Tailored to your specific needs",
      limits: limits,
      features: [
        { icon: MapPin, label: `${customConfig.locations || 1} location(s)`, included: true, highlight: true },
        { icon: Users, label: `Up to ${customConfig.staff || 1} staff members`, included: true, highlight: true },
        { icon: Calendar, label: `Up to ${customConfig.bookingsPerMonth || 100} bookings / month`, included: true, highlight: true },
        { icon: Globe, label: "Public booking page", included: true, highlight: true },
        { icon: CreditCard, label: "PayFast payments & deposits", included: true, highlight: true },
        { icon: Mail, label: `${customConfig.marketingMessagesPerDay || 50} marketing messages / day`, included: true, highlight: true },
        { icon: Star, label: "Review requests", included: Boolean(customConfig.reviewRequestsEnabled), highlight: false },
        { icon: Phone, label: "WhatsApp automation & inbox", included: Boolean(customConfig.whatsappEnabled), highlight: false },
        { icon: BarChart3, label: "Analytics dashboard", included: Boolean(customConfig.analyticsEnabled), highlight: false },
        { icon: Bot, label: "AI assistant", included: Boolean(customConfig.aiAssistantEnabled), highlight: false },
        { icon: Building2, label: "White-label booking page", included: Boolean(customConfig.whiteLabelEnabled), highlight: false },
        { icon: Globe, label: "Custom domain", included: Boolean(customConfig.customDomainEnabled), highlight: false },
        { icon: Sparkles, label: "Automated campaigns", included: Boolean(customConfig.automatedCampaignsEnabled), highlight: false },
        { icon: Shield, label: "Priority support", included: Boolean(customConfig.prioritySupportEnabled), highlight: false },
      ] as PlanFeature[],
    };
  }

  // Real usage limits from the current plan tier
  // For custom plans, use actual limits from metadata
  // For regular plans, use tier limits
  // Note: usageValues represents current usage from usage_tracking table
  const usageValues = limits
    ? {
        locations: 1, // Fixed at 1 for now (multi-location coming soon)
        staff: staffCount || 0,
        bookingsThisMonth: monthlyBookingCount || 0,
        marketingMessages: todayUsage?.marketingMessagesSent || 0,
      }
    : null;

  // ── PayFast return URL handling ────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payfastStatus = params.get("payfast");
    const subscriptionId = params.get("subscription_id");

    if (payfastStatus === "success" && subscriptionId) {
      checkPayFastPaymentStatus(subscriptionId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
        })
        .catch(() => {
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
  }, [queryClient]);

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

  const updatePlanMutation = useMutation({
    mutationFn: updateCustomPlanWithPayFast,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
      setCustomPlanOpen(false);
      if (!data.payFastUpdated) {
        alert("Plan updated locally but PayFast update failed. Please contact support.");
      }
    },
  });

  // ── Custom plan ────────────────────────────────────────────────────────────

  const handleCustomPlanChange = <K extends keyof CustomPlanConfig>(
    key: K, value: CustomPlanConfig[K],
  ) => {
    setCustomPlan((prev) => ({ ...prev, [key]: value }));
  };

  const calculateCustomPlanPrice = (config: CustomPlanConfig) => {
    let price = FEATURE_PRICING.basePrice;
    price += config.locations * FEATURE_PRICING.locations;
    price += config.staff * FEATURE_PRICING.staff;
    price += config.bookingsPerMonth * FEATURE_PRICING.bookingsPerMonth; // R1 per booking
    price += config.marketingMessagesPerDay * 31 * FEATURE_PRICING.marketingMessagesPerDay; // R0.20 per message x 31 days
    if (config.whatsappEnabled) {
      price += FEATURE_PRICING.whatsappEnabled;
      price += config.whatsappMessagesPerDay * FEATURE_PRICING.whatsappMessagesPerDay;
    }
    if (config.analyticsEnabled) price += FEATURE_PRICING.analyticsEnabled;
    if (config.aiAssistantEnabled) price += FEATURE_PRICING.aiAssistantEnabled;
    if (config.whiteLabelEnabled) price += FEATURE_PRICING.whiteLabelEnabled;
    if (config.customDomainEnabled) price += FEATURE_PRICING.customDomainEnabled;
    if (config.reviewRequestsEnabled) price += FEATURE_PRICING.reviewRequestsEnabled;
    if (config.automatedCampaignsEnabled) price += FEATURE_PRICING.automatedCampaignsEnabled;
    if (config.prioritySupportEnabled) price += FEATURE_PRICING.prioritySupportEnabled;
    let discount = 0;
    for (const tier of DISCOUNT_TIERS) {
      if (price >= tier.threshold) discount = tier.discount;
    }
    return {
      basePrice: Math.round(price),
      discount,
      finalPrice: Math.round(price * (1 - discount / 100)),
    };
  };

  const customPlanPricing = calculateCustomPlanPrice(customPlan);

  // Core items totals (used for the 50% off for first 6 months display)
  const coreOriginalTotal = (
    customPlan.locations * FEATURE_PRICING.locations +
    customPlan.staff * FEATURE_PRICING.staff +
    Math.round(customPlan.bookingsPerMonth * FEATURE_PRICING.bookingsPerMonth) +
    Math.round(customPlan.marketingMessagesPerDay * 31 * FEATURE_PRICING.marketingMessagesPerDay)
  );
  const coreDiscountedTotal = Math.round(coreOriginalTotal * 0.5);
  const totalFirstSixMonths = Math.max(0, customPlanPricing.finalPrice - coreOriginalTotal + coreDiscountedTotal);
  const totalAfterSixMonths = customPlanPricing.finalPrice;

  const handleCustomPlanSubmit = async (skipTabCheck = false) => {
    // Check if user has explored all tabs (unless skipping)
    if (!skipTabCheck) {
      const allTabs = ["core", "features", "branding"];
      const hasExploredAllTabs = allTabs.every(tab => visitedTabs.has(tab));
      
      if (!hasExploredAllTabs) {
        setTabWarningOpen(true);
        return;
      }
    }

    const isEnterpriseLevel = customPlanPricing.finalPrice > 10000;
    if (isEnterpriseLevel) {
      // Show enterprise contact dialog and do not generate PayFast link
      setEnterpriseDialogOpen(true);
      return;
    }
    // Check if user already has an active or trialing subscription
    if (subscription && isActiveOrTrialing) {
      // Update existing subscription
      await updatePlanMutation.mutateAsync({
        ...customPlan,
        finalPrice: customPlanPricing.finalPrice,
      });
    } else {
      // Create new subscription
      const result = await createCustomPlanWithPayFast({
        ...customPlan,
        finalPrice: customPlanPricing.finalPrice,
      });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.action;
      form.style.display = "none";
      Object.entries(result.fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    }
  };

  const formatDate = (v: string) =>
    new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(v));

  const isActionPending = createMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingSubscription) {
    return <BillingPageSkeleton />;
  }

  return (
    <div className="space-y-8 pb-16 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Billing & Subscription</h1>
          <p className="text-muted-foreground mt-1">
            Manage your plan, usage, and features.
          </p>
        </div>
      </div>

      {/* ── Subscription overview ── */}
      {subscription ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold">Subscription Overview</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Same treatment as the featured pricing card on the marketing site
                (.pricing-card.featured in qwickly-site.css): dark-green gradient,
                white text, white CTA with green text. */}
            <Card className="rounded-xl border-0 bg-[radial-gradient(circle_at_92%_10%,rgba(255,255,255,0.18),transparent_28%),linear-gradient(145deg,#0f3b35_0%,#167a57_100%)] text-white shadow-[0_26px_68px_rgba(22,122,87,0.24)]">
              <CardContent className="flex min-h-[230px] flex-col p-5">
                <div className="mb-5 flex items-start justify-between gap-4 border-b border-white/15 pb-3">
                  <div>
                    <h2 className="text-sm font-bold">Current Plan</h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge className={cn(
                      "border-0 text-[11px] font-bold capitalize",
                      subscription.cancelAtPeriodEnd
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                        : subscription.status === "active" || subscription.status === "trialing"
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-100",
                    )}>
                      {subscription.cancelAtPeriodEnd
                        ? "Cancels"
                        : subscription.status === "trialing"
                        ? "Trial"
                        : subscription.status}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Subscription actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem
                          className="text-red-700 focus:text-red-800"
                          onClick={() => setCancelDialogOpen(true)}
                          disabled={cancelMutation.isPending || subscription.cancelAtPeriodEnd}
                        >
                          <AlertTriangle className="h-4 w-4" />
                          {subscription.cancelAtPeriodEnd
                            ? "Cancellation scheduled"
                            : cancelMutation.isPending
                            ? "Cancelling..."
                            : "Cancel plan"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div>
                  <div>
                    <div className="text-lg font-bold tracking-tight">
                      {subscription.planName} Plan
                    </div>
                    <div className="mt-2">
                      <span className="text-4xl font-black tracking-tight tabular-nums">
                        R {(monthlyTotalCents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0 })}
                      </span>
                      <span className="ml-1 text-sm text-white/70">/ Month</span>
                    </div>
                    {activeAddonLabels.length > 0 && (
                      <p className="mt-2 text-xs text-white/70">
                        Add-ons:{" "}
                        <span className="font-medium text-white">
                          {activeAddonLabels.join(", ")}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {subscription.currentPeriodEnd ? (
                      <p className="text-sm leading-6 text-white/70">
                        {subscription.cancelAtPeriodEnd
                          ? "Access until"
                          : subscription.status === "trialing"
                          ? "First charge"
                          : "Renews"}{" "}
                        {formatDate(subscription.currentPeriodEnd)}
                      </p>
                    ) : (
                      <span />
                    )}
                    <Button
                      className="border-0 bg-white text-[#167a57] shadow-[0_14px_32px_rgba(0,0,0,0.16)] hover:bg-[#f2fff9] hover:text-[#167a57]"
                      onClick={() => setManageAddonsOpen(true)}
                    >
                      Manage Add-ons
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <SubscriptionUsageSummary
              creditData={creditData}
              onTopUp={setTopUpKind}
            />
          </div>
        </div>
      ) : (
        /* No subscription — choose a plan */
        <div>
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black tracking-tight">Choose your plan</h2>
            <p className="text-muted-foreground text-sm mt-1">
              {entitlements?.trialUsed
                ? "You've already used your free trial — subscribing bills your card today. Cancel anytime."
                : "Start with a 14-day free trial. Card required — no charge until day 14, cancel anytime."}
            </p>
          </div>
          <div className="grid gap-5 mx-auto max-w-4xl items-stretch md:grid-cols-2">
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
          {createMutation.isError && (
            <p className="text-center text-sm text-destructive mt-4">
              {(createMutation.error as Error)?.message || "Could not start checkout. Please try again."}
            </p>
          )}
        </div>
      )}

      {/* Loading add-ons failed — say so rather than silently rendering nothing.
          The usual cause is the edge function not being deployed with the /addons
          routes yet, which is invisible if the section just disappears. */}
      {subscription && addonsFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Couldn't load add-ons</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(addonsError as Error)?.message || "Please refresh and try again."}
              </p>
            </div>
          </div>
        </div>
      )}

      <Dialog open={manageAddonsOpen} onOpenChange={setManageAddonsOpen}>
        <DialogContent className="max-w-4xl max-h-[90dvh] overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle>Manage Add-ons</DialogTitle>
                <DialogDescription>
                  Add or remove features on your current plan.
                </DialogDescription>
              </div>
              <div className="mr-8 text-right">
                <div className="text-xs text-muted-foreground">Monthly total</div>
                <div className="text-xl font-black tabular-nums leading-tight">
                  {formatRand(monthlyTotalCents)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(90dvh-150px)] px-6 py-4">
            {!addonData ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2.5">
                {[...addonData.catalog]
                  .sort((a, b) => addonOrder(a.id) - addonOrder(b.id))
                  .map((addon: PlanAddon) =>
                    addon.id === "extra_staff" ? (
                      <StaffSeatsCard
                        key={addon.id}
                        addon={addon}
                        currentExtra={attachedQuantities.get(addon.id) ?? 0}
                        totalSeats={entitlements?.seats?.staff}
                        removeAt={scheduledRemovals.get(addon.id) ?? null}
                        isTrialing={subscription?.status === "trialing"}
                        daysInPeriod={periodDays.total}
                        daysRemaining={periodDays.remaining}
                        pending={addonMutation.isPending && addonMutation.variables?.addonId === addon.id}
                        disabled={addonMutation.isPending}
                        onSetQuantity={(quantity) => addonMutation.mutate({ addonId: addon.id, quantity })}
                        onDetach={() => addonMutation.mutate({ addonId: addon.id, quantity: 0 })}
                      />
                    ) : (
                      <AddonRow
                        key={addon.id}
                        addon={addon}
                        quantity={attachedQuantities.get(addon.id) ?? 0}
                        removeAt={scheduledRemovals.get(addon.id) ?? null}
                        isTrialing={subscription?.status === "trialing"}
                        isTrialIncluded={TRIAL_INCLUDED_ADDONS.includes(addon.id)}
                        daysInPeriod={periodDays.total}
                        daysRemaining={periodDays.remaining}
                        pending={addonMutation.isPending && addonMutation.variables?.addonId === addon.id}
                        disabled={addonMutation.isPending}
                        onAttach={(id) => addonMutation.mutate({ addonId: id, quantity: 1 })}
                        onDetach={(id) => addonMutation.mutate({ addonId: id, quantity: 0 })}
                        onQuantityChange={(id, quantity) => addonMutation.mutate({ addonId: id, quantity })}
                      />
                    ),
                  )}
              </div>
            )}

            {addonMutation.isError && (
              <p className="text-sm text-destructive mt-3">
                {(addonMutation.error as Error)?.message || "Could not update your add-ons."}
              </p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>


      {/* ── Marketing credits ──────────────────────────────────────────────────
          Hidden until there is a subscription. Subscribed users top up from the
          usage summary, so this legacy block stays out of the no-plan state. */}
      {false && creditData && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">Marketing credits</h2>
              <p className="text-sm text-muted-foreground">
                Only campaigns use these. Booking confirmations, reminders and cancellation
                notices are unlimited.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {creditData.balances.map((balance) => (
              <CreditBalanceCard
                key={balance.kind}
                balance={balance}
                onTopUp={setTopUpKind}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground mt-3">
            A campaign message to an existing client costs{" "}
            <strong>{creditData.rates.tokensPerExistingContact} token</strong>. Reaching a new or
            cold contact (through WhatsApp&apos;s official channel) is{" "}
            <strong>coming soon</strong> — those sends aren&apos;t available yet and can&apos;t be charged.
          </p>
        </div>
      )}

      <TopUpDialog
        open={Boolean(subscription && topUpKind)}
        kind={subscription ? topUpKind : null}
        onOpenChange={(open) => { if (!open) setTopUpKind(null); }}
      />

      {/* ── Usage & Features grid (only when subscribed) ── */}
      {false && subscription && currentTier && usageValues && limits && (
        <>
          {/* Usage section */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Plan Usage</h2>
              <Badge variant="outline" className="text-xs">
                <RefreshCw className="w-3 h-3 mr-1" /> Resets daily
              </Badge>
            </div>

            {/* Ring meters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <UsageRing
                value={usageValues.locations}
                max={limits.locations}
                label="Locations"
                sublabel={`${limits.locations} included`}
                color="stroke-primary"
              />
              <UsageRing
                value={usageValues.staff}
                max={limits.staff}
                label="Staff Members"
                sublabel={`${limits.staff} included`}
                color="stroke-primary"
              />
              <UsageRing
                value={usageValues.bookingsThisMonth}
                max={limits.bookingsPerMonth}
                label="Bookings"
                sublabel={`${limits.bookingsPerMonth.toLocaleString()} / mo`}
                color="stroke-primary"
              />
              <UsageRing
                value={usageValues.marketingMessages}
                max={limits.marketingMessages}
                label="Messages"
                sublabel={`${limits.marketingMessages.toLocaleString()} / day`}
                color="stroke-primary"
              />
            </div>

            {/* Detail bars */}
            <Card className="p-6 border-border/50">
              <div className="space-y-5">
                <UsageBar
                  icon={MapPin}
                  label="Locations"
                  used={usageValues.locations}
                  max={limits.locations}
                  color="bg-primary"
                />
                <UsageBar
                  icon={Users}
                  label="Staff Members"
                  used={usageValues.staff}
                  max={limits.staff}
                  color="bg-primary"
                />
                <UsageBar
                  icon={Calendar}
                  label="Bookings This Month"
                  used={usageValues.bookingsThisMonth}
                  max={limits.bookingsPerMonth}
                  color="bg-primary"
                />
                <UsageBar
                  icon={Mail}
                  label="Marketing Messages"
                  used={usageValues.marketingMessages}
                  max={limits.marketingMessages}
                  color="bg-primary"
                />
              </div>
            </Card>
          </div>

          {/* Features section */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Your Features</h2>
              <Button variant="outline" size="sm" onClick={() => {
                setVisitedTabs(new Set());
                setCustomPlanOpen(true);
              }}>
                <TrendingUp className="w-3.5 h-3.5 mr-1.5" /> Upgrade to unlock more
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {currentTier.features.map((f) => (
                <FeatureChip
                  key={f.label}
                  icon={f.icon}
                  label={f.label}
                  included={f.included}
                  highlight={f.highlight}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Billing History ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-bold">Billing History</h2>
        </div>
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto px-2 pb-2">
              <Table className="border-separate border-spacing-y-2">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingInvoices ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow
                    key={`invoice-skeleton-${index}`}
                    className="bg-card [&_td]:border-y [&_td]:border-border/50 [&_td]:py-5 [&_td:first-child]:rounded-l-xl [&_td:first-child]:border-l [&_td:last-child]:rounded-r-xl [&_td:last-child]:border-r"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-4 w-28" />
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-8 w-8 rounded-md" />
                    </TableCell>
                  </TableRow>
                ))
              ) : !invoices || invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <Receipt className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm font-medium">No invoices yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Billing history will appear after your first payment.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="bg-card transition-colors hover:bg-muted/50 [&_td]:border-y [&_td]:border-border/50 [&_td]:py-5 [&_td:first-child]:rounded-l-xl [&_td:first-child]:border-l [&_td:last-child]:rounded-r-xl [&_td:last-child]:border-r"
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-muted-foreground" />
                        {inv.invoiceNumber}
                      </div>
                    </TableCell>
                    <TableCell>{new Date(inv.paymentDate).toLocaleDateString("en-ZA")}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.description || "Subscription"}</TableCell>
                    <TableCell>R {inv.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          inv.status === "paid"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : inv.status === "pending"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : inv.status === "refunded"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }
                      >
                        {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" disabled>
                        <Download className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Custom Plan Builder Dialog
         ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={customPlanOpen} onOpenChange={setCustomPlanOpen}>
        <DialogContent className="max-w-6xl max-h-[95dvh] overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2 text-xl font-black">
              <Sliders className="w-5 h-5 text-primary" />
              Build Your Custom Plan
            </DialogTitle>
            <DialogDescription>
              Pay only for what you use. Volume discounts up to 25% off.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col lg:flex-row gap-0 h-[calc(95dvh-140px)] overflow-hidden">
            {/* Config panel */}
            <ScrollArea className="flex-1 lg:max-w-[55%] px-6 py-4">
              <Tabs defaultValue="core" className="w-full" onValueChange={handleTabChange}>
                <TabsList className="grid w-full grid-cols-3 mb-6">
                  <TabsTrigger value="core" className="relative">
                    Core
                    {!visitedTabs.has("core") && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="features" className="relative">
                    Features
                    {!visitedTabs.has("features") && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="branding" className="relative">
                    Branding
                    {!visitedTabs.has("branding") && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* ── Core tab ── */}
                <TabsContent value="core" className="space-y-4">
                  {[
                    {
                      icon: Mail, key: "marketingMessagesPerDay" as keyof CustomPlanConfig,
                      label: "Marketing Messages / Day",
                      min: 10, max: MAX_MESSAGES_PER_DAY, step: 10,
                      note: `R ${FEATURE_PRICING.marketingMessagesPerDay} per message (x31 days for monthly)`,
                    },
                    {
                      icon: MapPin, key: "locations" as keyof CustomPlanConfig,
                      label: "Locations", min: 1, max: 1, step: 1, disabled: true,
                      note: `R ${FEATURE_PRICING.locations} per location (Coming Soon - Multi-location)`,
                    },
                    {
                      icon: Users, key: "staff" as keyof CustomPlanConfig,
                      label: "Staff Members", min: 1, max: 50, step: 1,
                      note: `R ${FEATURE_PRICING.staff} per staff member`,
                    },
                    {
                      icon: Calendar, key: "bookingsPerMonth" as keyof CustomPlanConfig,
                      label: "Bookings / Month", min: 50, max: 30000, step: 100,
                      note: `R ${FEATURE_PRICING.bookingsPerMonth} per booking`,
                    },
                  ].map(({ icon: Icon, key, label, min, max, step, note, disabled = false }) => (
                    <Card key={key} className={cn("p-5", disabled && "opacity-60")}>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="flex items-center gap-2 font-semibold">
                            <Icon className="w-4 h-4 text-primary" />
                            {label}
                          </Label>
                          <Badge variant="secondary" className="font-bold text-sm px-3">
                            {(customPlan[key] as number).toLocaleString()}
                          </Badge>
                        </div>
                        <Slider
                          value={[customPlan[key] as number]}
                          onValueChange={([v]) => !disabled && handleCustomPlanChange(key, v as any)}
                          min={min} max={max} step={step} className="w-full"
                          disabled={disabled}
                        />
                        <p className="text-xs text-muted-foreground">{note}</p>
                      </div>
                    </Card>
                  ))}

                  {/* WhatsApp messages sub-slider */}
                  {customPlan.whatsappEnabled && (
                    <Card className="p-5 border-green-200 bg-green-50/50">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="flex items-center gap-2 font-semibold">
                            <Phone className="w-4 h-4 text-green-600" />
                            WhatsApp Messages / Day
                          </Label>
                          <Badge className="bg-green-100 text-green-700 font-bold">
                            {customPlan.whatsappMessagesPerDay}
                          </Badge>
                        </div>
                        <Slider
                          value={[customPlan.whatsappMessagesPerDay]}
                          onValueChange={([v]) => handleCustomPlanChange("whatsappMessagesPerDay", v)}
                          min={10} max={1000} step={10} className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          R {FEATURE_PRICING.whatsappMessagesPerDay} per WhatsApp message
                        </p>
                      </div>
                    </Card>
                  )}
                </TabsContent>

                {/* ── Features tab ── */}
                <TabsContent value="features" className="space-y-3">
                  {[
                    {
                      key: "whatsappEnabled" as keyof CustomPlanConfig,
                      icon: Phone, iconBg: "bg-green-100", iconColor: "text-green-600",
                      label: "WhatsApp Integration",
                      desc: "Confirmations, reminders & inbox",
                      price: FEATURE_PRICING.whatsappEnabled,
                    },
                    {
                      key: "analyticsEnabled" as keyof CustomPlanConfig,
                      icon: BarChart3, iconBg: "bg-blue-100", iconColor: "text-blue-600",
                      label: "Analytics Dashboard",
                      desc: "Advanced analytics and insights",
                      price: FEATURE_PRICING.analyticsEnabled,
                    },
                    {
                      key: "aiAssistantEnabled" as keyof CustomPlanConfig,
                      icon: Bot, iconBg: "bg-purple-100", iconColor: "text-purple-600",
                      label: "AI Assistant",
                      desc: "Intelligent business insights",
                      price: FEATURE_PRICING.aiAssistantEnabled,
                    },
                    {
                      key: "reviewRequestsEnabled" as keyof CustomPlanConfig,
                      icon: Star, iconBg: "bg-amber-100", iconColor: "text-amber-600",
                      label: "Review Requests",
                      desc: "Automated review collection",
                      price: FEATURE_PRICING.reviewRequestsEnabled,
                      disabled: true,
                      disabledReason: "Coming Soon",
                    },
                    {
                      key: "automatedCampaignsEnabled" as keyof CustomPlanConfig,
                      icon: MessageSquare, iconBg: "bg-pink-100", iconColor: "text-pink-600",
                      label: "Automated Campaigns",
                      desc: "Win-back and VIP campaigns",
                      price: FEATURE_PRICING.automatedCampaignsEnabled,
                      disabled: true,
                      disabledReason: "Coming Soon",
                    },
                  ].map(({ key, icon: Icon, iconBg, iconColor, label, desc, price, disabled = false, disabledReason = "" }) => {
                    const enabled = customPlan[key] as boolean;
                    return (
                      <Card key={key} className={cn("p-5 transition-all", enabled && "border-primary/30 bg-primary/5", disabled && "opacity-60")}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-lg", enabled ? "bg-primary/10" : iconBg)}>
                              <Icon className={cn("w-4 h-4", enabled ? "text-primary" : iconColor)} />
                            </div>
                            <div>
                              <Label className="font-semibold">{label}</Label>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                              {disabled && disabledReason && (
                                <p className="text-xs text-amber-600 font-medium">{disabledReason}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-muted-foreground">+R {price}/mo</span>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => !disabled && handleCustomPlanChange(key, v as any)}
                              disabled={disabled}
                            />
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </TabsContent>

                {/* ── Branding tab ── */}
                <TabsContent value="branding" className="space-y-3">
                  {[
                    {
                      key: "whiteLabelEnabled" as keyof CustomPlanConfig,
                      icon: Building2, iconBg: "bg-slate-100", iconColor: "text-slate-600",
                      label: "White Label",
                      desc: "Remove Bookza branding",
                      price: FEATURE_PRICING.whiteLabelEnabled,
                      disabled: true,
                      disabledReason: "Coming Soon",
                    },
                    {
                      key: "customDomainEnabled" as keyof CustomPlanConfig,
                      icon: Globe, iconBg: "bg-indigo-100", iconColor: "text-indigo-600",
                      label: "Custom Domain",
                      desc: "Use your own domain",
                      price: FEATURE_PRICING.customDomainEnabled,
                      disabled: true,
                      disabledReason: "Coming Soon",
                    },
                    {
                      key: "prioritySupportEnabled" as keyof CustomPlanConfig,
                      icon: Crown, iconBg: "bg-rose-100", iconColor: "text-rose-600",
                      label: "Priority Support",
                      desc: "24/7 dedicated support",
                      price: FEATURE_PRICING.prioritySupportEnabled,
                      disabled: true,
                      disabledReason: "Coming Soon",
                    },
                  ].map(({ key, icon: Icon, iconBg, iconColor, label, desc, price, disabled = false, disabledReason = "" }) => {
                    const enabled = customPlan[key] as boolean;
                    return (
                      <Card key={key} className={cn("p-5 transition-all", enabled && "border-primary/30 bg-primary/5", disabled && "opacity-60")}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-lg", enabled ? "bg-primary/10" : iconBg)}>
                              <Icon className={cn("w-4 h-4", enabled ? "text-primary" : iconColor)} />
                            </div>
                            <div>
                              <Label className="font-semibold">{label}</Label>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                              {disabled && disabledReason && (
                                <p className="text-xs text-amber-600 font-medium">{disabledReason}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-muted-foreground">+R {price}/mo</span>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => !disabled && handleCustomPlanChange(key, v as any)}
                              disabled={disabled}
                            />
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </TabsContent>
              </Tabs>
            </ScrollArea>

            {/* Pricing summary sidebar */}
            <div className="w-full lg:w-[45%] bg-gradient-to-b from-muted/30 to-muted/10 border-l p-4 sm:p-6 flex flex-col gap-4 sm:gap-6">
              <Card className="p-0 bg-white dark:bg-card border border-border/70 shadow-lg shadow-primary/10 rounded-2xl flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 px-4 py-4 sm:px-6 sm:py-6">
                  <div className="space-y-5">
                    {/* Core Resources */}
                    <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/25 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Building2 className="w-4 h-4 text-primary" />
                          Core Resources
                        </div>
                        <Badge className="bg-yellow-50 text-yellow-700 border-yellow-100 text-[11px] font-semibold">50% off core for 6 months</Badge>
                      </div>
                      <div className="space-y-2">
                        {
                          // Core items with 50% discount for first 6 months
                          (() => {
                            const coreItems = [
                              { icon: MapPin, label: `Locations`, value: customPlan.locations, unit: "", price: customPlan.locations * FEATURE_PRICING.locations },
                              { icon: Users, label: `Staff Members`, value: customPlan.staff, unit: "", price: customPlan.staff * FEATURE_PRICING.staff },
                              { icon: Calendar, label: `Bookings`, value: customPlan.bookingsPerMonth, unit: "/mo", price: Math.round(customPlan.bookingsPerMonth * FEATURE_PRICING.bookingsPerMonth) },
                              { icon: Mail, label: `Marketing Messages`, value: customPlan.marketingMessagesPerDay, unit: "/day", price: Math.round(customPlan.marketingMessagesPerDay * 31 * FEATURE_PRICING.marketingMessagesPerDay) },
                            ];

                            // Compute core totals for display
                            const coreOriginalTotal = coreItems.reduce((s, it) => s + it.price, 0);
                            const coreDiscountedTotal = Math.round(coreOriginalTotal * 0.5);

                            // Attach discounted price per item
                            return (
                              <>
                                {coreItems.map((item) => {
                                  const discounted = Math.round(item.price * 0.5);
                                  return (
                                    <div key={item.label} className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-background/70 hover:bg-background transition-colors">
                                      <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="w-8 h-8 rounded-lg bg-background border border-border/60 flex items-center justify-center shrink-0">
                                          <item.icon className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="text-sm font-semibold text-foreground">{item.label}</div>
                                          <div className="text-xs text-muted-foreground">{item.value}{item.unit}</div>
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0 w-20">
                                        <div className="text-xs text-muted-foreground line-through">R {item.price}</div>
                                        <div className="text-sm font-bold text-yellow-700">R {discounted}</div>
                                      </div>
                                    </div>
                                  );
                                })}

                                <div className="pt-3 mt-1 border-t border-border/40 flex items-center justify-between">
                                  <span className="text-sm font-semibold text-foreground pl-11">Core subtotal</span>
                                  <span className="text-sm font-bold text-yellow-700">R {coreDiscountedTotal}</span>
                                </div>
                              </>
                            );
                          })()
                        }
                      </div>
                    </div>

                    {/* Add-ons */}
                    {(customPlan.whatsappEnabled || customPlan.analyticsEnabled || customPlan.aiAssistantEnabled || 
                      customPlan.whiteLabelEnabled || customPlan.customDomainEnabled || customPlan.reviewRequestsEnabled ||
                      customPlan.automatedCampaignsEnabled || customPlan.prioritySupportEnabled) && (
                      <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/25 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Sparkles className="w-4 h-4 text-primary" />
                          Add-ons
                        </div>
                        <div className="space-y-2">
                          {[
                            { icon: Phone, label: "WhatsApp", enabled: customPlan.whatsappEnabled, price: FEATURE_PRICING.whatsappEnabled },
                            { icon: BarChart3, label: "Analytics", enabled: customPlan.analyticsEnabled, price: FEATURE_PRICING.analyticsEnabled },
                            { icon: Bot, label: "AI Assistant", enabled: customPlan.aiAssistantEnabled, price: FEATURE_PRICING.aiAssistantEnabled },
                            { icon: Building2, label: "White Label", enabled: customPlan.whiteLabelEnabled, price: FEATURE_PRICING.whiteLabelEnabled },
                            { icon: Globe, label: "Custom Domain", enabled: customPlan.customDomainEnabled, price: FEATURE_PRICING.customDomainEnabled },
                            { icon: Star, label: "Review Requests", enabled: customPlan.reviewRequestsEnabled, price: FEATURE_PRICING.reviewRequestsEnabled },
                            { icon: MessageSquare, label: "Campaigns", enabled: customPlan.automatedCampaignsEnabled, price: FEATURE_PRICING.automatedCampaignsEnabled },
                            { icon: Crown, label: "Priority Support", enabled: customPlan.prioritySupportEnabled, price: FEATURE_PRICING.prioritySupportEnabled },
                          ].filter(a => a.enabled).map((item) => (
                            <div key={item.label} className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-background/70 hover:bg-background transition-colors">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-background border border-border/60 flex items-center justify-center shrink-0">
                                  <item.icon className="w-4 h-4 text-primary" />
                                </div>
                                <span className="text-sm font-semibold text-foreground">{item.label}</span>
                              </div>
                              <span className="text-sm font-bold text-foreground shrink-0">R {item.price}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Base Price */}
                    <div className="flex items-center justify-between py-3 px-4 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/8 to-transparent">
                      <span className="text-sm font-semibold text-foreground pl-11">Base Platform Fee</span>
                      <span className="text-sm font-bold text-foreground pr-1">R {FEATURE_PRICING.basePrice}</span>
                    </div>

                    {/* Total Section */}
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-semibold text-muted-foreground pl-11">Subtotal</span>
                        <span className="text-sm font-bold text-foreground pr-1">R {customPlanPricing.basePrice}</span>
                      </div>
                      {customPlanPricing.discount > 0 && (
                        <div className="flex justify-between items-center bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 pl-8">
                            <Percent className="w-3.5 h-3.5" /> Volume Discount
                          </span>
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 pr-1">−{customPlanPricing.discount}%</span>
                        </div>
                      )}
                      <div className="pt-2 space-y-3 border-t border-border/50">
                        <div className="flex justify-between items-center gap-3">
                          <div className="pl-11">
                            <div className="text-sm font-semibold text-foreground">Total (first 6 months)</div>
                            <div className="text-xs text-muted-foreground">/month</div>
                          </div>
                          <span className="text-lg font-bold text-yellow-700 pr-1">R {totalFirstSixMonths}</span>
                        </div>

                        <div className="flex justify-between items-center gap-3">
                          <div className="pl-11">
                            <div className="text-sm font-semibold text-muted-foreground">Total (after 6 months)</div>
                            <div className="text-xs text-muted-foreground">/month</div>
                          </div>
                          <span className="text-lg font-bold text-foreground pr-1">R {totalAfterSixMonths}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </Card>

              <div className="space-y-3">
                <Button className="w-full font-black" size="lg" onClick={() => void handleCustomPlanSubmit()} disabled={updatePlanMutation.isPending || createMutation.isPending}>
                  {(() => {
                    const isEnterpriseLevel = customPlanPricing.finalPrice > 10000;
                    if (subscription && isActiveOrTrialing) {
                      return updatePlanMutation.isPending ? "Updating..." : `Update Plan — R ${customPlanPricing.finalPrice}/mo`;
                    }
                    if (isEnterpriseLevel) {
                      return "Enterprise — Request Contact";
                    }
                    return createMutation.isPending ? "Activating..." : `Activate — R ${totalFirstSixMonths}/mo (50% off core for 6 months)`;
                  })()}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tab exploration warning dialog */}
      <Dialog open={tabWarningOpen} onOpenChange={setTabWarningOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" /> Explore All Options
            </DialogTitle>
            <DialogDescription>
              You haven't explored all the available options yet. Make sure you've seen everything we offer before activating your plan.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", visitedTabs.has("core") ? "bg-emerald-100" : "bg-muted")}>
                <Building2 className={cn("w-4 h-4", visitedTabs.has("core") ? "text-emerald-600" : "text-muted-foreground")} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm">Core Resources</div>
                <div className="text-xs text-muted-foreground">Locations, staff, bookings, messages</div>
              </div>
              {visitedTabs.has("core") && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", visitedTabs.has("features") ? "bg-emerald-100" : "bg-muted")}>
                <Sparkles className={cn("w-4 h-4", visitedTabs.has("features") ? "text-emerald-600" : "text-muted-foreground")} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm">Features</div>
                <div className="text-xs text-muted-foreground">WhatsApp, Analytics, AI Assistant</div>
              </div>
              {visitedTabs.has("features") && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", visitedTabs.has("branding") ? "bg-emerald-100" : "bg-muted")}>
                <Globe className={cn("w-4 h-4", visitedTabs.has("branding") ? "text-emerald-600" : "text-muted-foreground")} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm">Branding</div>
                <div className="text-xs text-muted-foreground">White label, custom domain</div>
              </div>
              {visitedTabs.has("branding") && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => {
              setTabWarningOpen(false);
              handleCustomPlanSubmit(true);
            }}>
              Continue Anyway
            </Button>
            <Button onClick={() => {
              setTabWarningOpen(false);
            }}>
              I'll Explore More
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enterprise contact dialog for high-value custom plans */}
      <Dialog open={enterpriseDialogOpen} onOpenChange={setEnterpriseDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-600" /> Enterprise plan request
            </DialogTitle>
            <DialogDescription>
              Your custom plan total exceeds our enterprise threshold. A member of our sales team will contact you to finalise pricing and onboarding.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3">
            <p className="text-sm text-muted-foreground">Total: <span className="font-bold">R {customPlanPricing.finalPrice}</span></p>
            <p className="text-sm mt-2">Would you like us to contact you to arrange an enterprise plan?</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEnterpriseDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                // Minimal action: record request client-side and close dialogs.
                console.log("Enterprise contact requested", { customPlan, price: customPlanPricing.finalPrice });
                setEnterpriseRequested(true);
                setEnterpriseDialogOpen(false);
                setCustomPlanOpen(false);
                try {
                  await fetch("/api/support/enterprise-request", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ customPlan, price: customPlanPricing.finalPrice }),
                  });
                } catch (err) {
                  // ignore network errors; server endpoint may not exist
                }
                alert("Thanks — our team will contact you shortly about enterprise plans.");
              }}
            >
              Request Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                "All plan allowances (locations, staff, bookings)",
                "Marketing message quota",
                ...(currentTier?.features.filter((f) => f.included && f.highlight).map((f) => f.label) ?? []),
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

          <DialogFooter className="border-t px-6 py-4">
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
    </div>
  );
}
