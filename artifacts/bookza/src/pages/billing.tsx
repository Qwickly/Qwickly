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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  CreditCard, Download, Receipt, Building2, Sparkles,
  Plus, Sliders, MessageSquare, Bot, BarChart3, Users, MapPin,
  Calendar, Phone, Mail, Crown, Percent, Info, Star, Globe,
  ArrowRight, TrendingUp, Shield, Rocket, AlertTriangle, CheckCircle2,
  Clock, RefreshCw, Lock, X,
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
// Launch plans (Starter / Team) — display data. Prices are enforced server-side
// (edge fn PLAN_PRICES + plans table); this is just what the cards render.
// The `name` MUST match the plan name the edge fn expects ("Starter" / "Team").
// ─────────────────────────────────────────────────────────────────────────────

type LaunchPlan = {
  name: "Starter" | "Team";
  price: number;
  icon: React.ElementType;
  tagline: string;
  highlight: boolean;
  features: string[];
};

const LAUNCH_PLANS: LaunchPlan[] = [
  {
    name: "Starter",
    price: 99,
    icon: Sparkles,
    highlight: false,
    tagline: "For solo businesses that need a simple online booking page.",
    features: [
      "1 staff calendar",
      "Unlimited bookings, clients & services",
      "Booking page + shareable link",
      "Email booking & confirmation notifications",
      "WhatsApp booking reminders (500 / mo)",
      "50 campaign tokens / mo",
      "50 marketing emails / mo",
    ],
  },
  {
    name: "Team",
    price: 199,
    icon: Users,
    highlight: true,
    tagline: "For small salons with a team.",
    features: [
      "Up to 3 staff calendars",
      "Staff scheduling + full dashboard",
      "Unlimited bookings, clients & services",
      "WhatsApp booking reminders (1,500 / mo)",
      "150 campaign tokens / mo",
      "150 marketing emails / mo",
      "Add extra staff for R49 / mo each",
    ],
  },
];

/** A single Starter/Team plan card with a "Start free trial" button. */
function PlanCard({
  plan, pending, disabled, onSelect,
}: {
  plan: LaunchPlan;
  pending: boolean;
  disabled: boolean;
  onSelect: (name: LaunchPlan["name"]) => void;
}) {
  const Icon = plan.icon;
  return (
    <div className={cn(
      "relative flex flex-col rounded-2xl border-2 p-6 transition-shadow hover:shadow-md",
      plan.highlight ? "border-primary shadow-lg shadow-primary/10" : "border-border/60",
    )}>
      {plan.highlight && (
        <Badge className="absolute -top-3 left-6 bg-primary text-primary-foreground border-primary">
          Most popular
        </Badge>
      )}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <h3 className="text-lg font-bold">{plan.name}</h3>
      </div>
      <p className="text-sm text-muted-foreground min-h-[2.5rem]">{plan.tagline}</p>
      <div className="mt-2 mb-1">
        <span className="text-4xl font-black">R {plan.price}</span>
        <span className="text-muted-foreground font-medium"> / month</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">14-day free trial · card required</p>
      <ul className="space-y-2 mb-6 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-primary mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button
        className="w-full font-semibold"
        variant={plan.highlight ? "default" : "outline"}
        disabled={disabled}
        onClick={() => onSelect(plan.name)}
      >
        {pending ? "Redirecting to PayFast…" : "Start 14-day free trial"}
        {!pending && <ArrowRight className="w-4 h-4 ml-2" />}
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
    } else if (payfastStatus === "cancelled") {
      window.history.replaceState(null, "", window.location.pathname);
    }
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
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

  const daysUntilRenewal = subscription?.currentPeriodEnd
    ? Math.max(0, Math.ceil(
        (new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / 86400000,
      ))
    : null;

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

      {/* ── Active subscription hero ── */}
      {subscription ? (
        (isCustomPlan && currentTier) ? (
        <div className={cn(
          "relative overflow-hidden rounded-2xl border-2 p-6 sm:p-8",
          `bg-gradient-to-br ${currentTier.gradientFrom} ${currentTier.gradientTo}`,
          currentTier.borderColor,
        )}>
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-64 h-64 opacity-5 pointer-events-none">
            <currentTier.icon className="w-full h-full" />
          </div>

          <div className="relative flex flex-col sm:flex-row sm:items-start gap-6">
            <div className="flex-1">
              {/* Plan badge */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold",
                  currentTier.badgeColor,
                )}>
                  <currentTier.icon className="w-4 h-4" />
                  {subscription.planName} Plan
                </div>
                <Badge className={cn(
                  "capitalize",
                  subscription.status === "active" || subscription.status === "trialing"
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : "bg-amber-100 text-amber-700 border-amber-200",
                )}>
                  {subscription.status === "active"
                    ? <><CheckCircle2 className="w-3 h-3 mr-1" /> Active</>
                    : subscription.status === "trialing"
                    ? <><Clock className="w-3 h-3 mr-1" /> Free trial</>
                    : subscription.status
                  }
                </Badge>
              </div>

              {/* Price */}
              <div className="mb-4">
                <span className="text-4xl font-black">
                  R {subscription.price.toLocaleString()}
                </span>
                <span className="text-muted-foreground font-medium"> / month</span>
              </div>

              {/* Renewal info */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {subscription.currentPeriodEnd && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    Renews {formatDate(subscription.currentPeriodEnd)}
                    {daysUntilRenewal !== null && (
                      <span className={cn(
                        "font-semibold ml-1",
                        daysUntilRenewal <= 5 ? "text-amber-600" : "text-foreground",
                      )}>
                        ({daysUntilRenewal} days)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 sm:items-end">
              <Button onClick={() => {
                setVisitedTabs(new Set());
                setCustomPlanOpen(true);
              }} variant="outline" className="gap-2">
                <TrendingUp className="w-4 h-4" /> Change Plan
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-sm"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* Fixed plan (Starter / Team) — minimal current-plan hero */
        <div className="relative overflow-hidden rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold bg-primary/10 text-primary">
                  <Sparkles className="w-4 h-4" />
                  {subscription.planName} Plan
                </div>
                <Badge className={cn(
                  "capitalize",
                  subscription.status === "active" || subscription.status === "trialing"
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : "bg-amber-100 text-amber-700 border-amber-200",
                )}>
                  {subscription.status === "active"
                    ? <><CheckCircle2 className="w-3 h-3 mr-1" /> Active</>
                    : subscription.status === "trialing"
                    ? <><Clock className="w-3 h-3 mr-1" /> Free trial</>
                    : subscription.status}
                </Badge>
              </div>
              <div className="mb-4">
                <span className="text-4xl font-black">R {subscription.price.toLocaleString()}</span>
                <span className="text-muted-foreground font-medium"> / month</span>
              </div>
              {subscription.currentPeriodEnd && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {subscription.status === "trialing" ? "First charge" : "Renews"} {formatDate(subscription.currentPeriodEnd)}
                  {daysUntilRenewal !== null && (
                    <span className="font-semibold ml-1 text-foreground">({daysUntilRenewal} days)</span>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 text-sm sm:self-start"
              onClick={() => setCancelDialogOpen(true)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
            </Button>
          </div>
        </div>
        )
      ) : (
        /* No subscription — choose a plan */
        <div>
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black tracking-tight">Choose your plan</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Start with a 14-day free trial. Card required — no charge until day 14, cancel anytime.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 max-w-3xl mx-auto items-stretch">
            {LAUNCH_PLANS.map((plan) => (
              <PlanCard
                key={plan.name}
                plan={plan}
                pending={createMutation.isPending && createMutation.variables === plan.name}
                disabled={createMutation.isPending}
                onSelect={(name) => createMutation.mutate(name)}
              />
            ))}
          </div>
          {createMutation.isError && (
            <p className="text-center text-sm text-destructive mt-4">
              {(createMutation.error as Error)?.message || "Could not start checkout. Please try again."}
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground mt-4">
            Need something custom?{" "}
            <button
              className="underline hover:text-foreground"
              onClick={() => { setVisitedTabs(new Set()); setCustomPlanOpen(true); }}
            >
              Build a custom plan
            </button>
          </p>
        </div>
      )}

      {/* ── Usage & Features grid (only when subscribed) ── */}
      {subscription && currentTier && usageValues && limits && (
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
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" /> Billing History
          </CardTitle>
          <CardDescription>View and download past invoices.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableRow key={`invoice-skeleton-${index}`}>
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
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Receipt className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm font-medium">No invoices yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Billing history will appear after your first payment.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow key={inv.id}>
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
        </CardContent>
      </Card>

      {/* ── Build Custom Plan CTA ── */}
      <div className="rounded-2xl border border-border/50 bg-gradient-to-br from-primary to-emerald-600 p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-10 pointer-events-none">
          <Sliders className="w-full h-full" />
        </div>
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Sliders className="w-4 h-4" />
              </div>
              <span className="font-bold text-lg">Build Your Custom Plan</span>
            </div>
            <p className="text-white/80 text-sm leading-relaxed">
              Configure exactly what you need — locations, staff, bookings, WhatsApp, AI and more.
              Volume discounts up to <strong className="text-white">25% off</strong> when you add more.
            </p>
          </div>
          <Button
            className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold shrink-0 border-2 border-yellow-500"
            size="lg"
            onClick={() => {
              setVisitedTabs(new Set());
              setCustomPlanOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" /> Create Custom Plan
          </Button>
        </div>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Cancel Subscription?
            </DialogTitle>
            <DialogDescription>
              This will stop future renewals at the end of your current billing period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground font-medium">You will lose access to:</p>
            <ul className="space-y-2">
              {[
                "All plan allowances (locations, staff, bookings)",
                "Marketing message quota",
                ...(currentTier?.features.filter((f) => f.included && f.highlight).map((f) => f.label) ?? []),
              ].map((f) => (
                <li key={f} className="text-sm flex items-center gap-2 text-destructive">
                  <X className="w-3.5 h-3.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Keep My Plan
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Cancelling...</>
              ) : (
                "Cancel Subscription"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
