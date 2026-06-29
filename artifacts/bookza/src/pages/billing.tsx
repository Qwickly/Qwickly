import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  fetchSubscription,
  updateSubscription,
  cancelSubscription,
  createSubscriptionWithPayFast,
  checkPayFastPaymentStatus,
  createCustomPlanWithPayFast,
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
  Check, CreditCard, Download, Receipt, Zap, Building2, Sparkles,
  Plus, Sliders, MessageSquare, Bot, BarChart3, Users, MapPin,
  Calendar, Phone, Mail, Crown, Percent, Info, Star, Globe,
  X, ArrowRight, TrendingUp, Shield, Rocket, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, RefreshCw, Lock,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";


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
    marketingMessages: number; // per month
  };
  features: PlanFeature[];
};

const PLAN_TIERS: PlanTier[] = [
  {
    name: "Starter",
    monthlyPrice: 400,
    color: "text-emerald-600",
    gradientFrom: "from-emerald-50",
    gradientTo: "to-teal-50",
    borderColor: "border-emerald-200",
    badgeColor: "bg-emerald-100 text-emerald-700",
    icon: Zap,
    tagline: "Everything you need to start taking bookings",
    limits: { locations: 1, staff: 2, bookingsPerMonth: 150, marketingMessages: 10000 },
    features: [
      { icon: MapPin, label: "1 location", included: true },
      { icon: Users, label: "Up to 2 staff members", included: true },
      { icon: Calendar, label: "Up to 150 bookings / month", included: true },
      { icon: Globe, label: "Public booking page", included: true },
      { icon: CreditCard, label: "PayFast payments & deposits", included: true },
      { icon: Mail, label: "10,000 marketing messages / month", included: true },
      { icon: Star, label: "Basic review requests", included: true },
      { icon: Phone, label: "WhatsApp automation & inbox", included: false },
      { icon: BarChart3, label: "Analytics dashboard", included: false },
      { icon: Bot, label: "AI assistant", included: false },
      { icon: Building2, label: "White-label booking page", included: false },
      { icon: Shield, label: "Priority support", included: false },
    ],
  },
  {
    name: "Growth",
    monthlyPrice: 1500,
    color: "text-primary",
    gradientFrom: "from-primary/5",
    gradientTo: "to-teal-50",
    borderColor: "border-primary/40",
    badgeColor: "bg-primary/10 text-primary",
    icon: Sparkles,
    tagline: "Automation, retention & stronger reporting",
    limits: { locations: 1, staff: 8, bookingsPerMonth: 1000, marketingMessages: 50000 },
    features: [
      { icon: MapPin, label: "1 location", included: true },
      { icon: Users, label: "Up to 8 staff members", included: true },
      { icon: Calendar, label: "Up to 1,000 bookings / month", included: true },
      { icon: Globe, label: "Booking page — no Bookza branding", included: true },
      { icon: CreditCard, label: "PayFast payments & deposits", included: true },
      { icon: Mail, label: "50,000 marketing messages / month", included: true },
      { icon: Star, label: "Segmented campaigns, referrals & reviews", included: true, highlight: true },
      { icon: Phone, label: "WhatsApp confirmations, reminders & inbox", included: true, highlight: true },
      { icon: BarChart3, label: "Analytics dashboard", included: true, highlight: true },
      { icon: Bot, label: "AI assistant (limited)", included: false },
      { icon: Building2, label: "White-label booking page", included: false },
      { icon: Shield, label: "Priority support", included: true },
    ],
  },
  {
    name: "Business",
    monthlyPrice: 5000,
    color: "text-violet-600",
    gradientFrom: "from-violet-50",
    gradientTo: "to-purple-50",
    borderColor: "border-violet-200",
    badgeColor: "bg-violet-100 text-violet-700",
    icon: Building2,
    tagline: "High-volume, multi-location & full automation",
    limits: { locations: 5, staff: 30, bookingsPerMonth: 5000, marketingMessages: 200000 },
    features: [
      { icon: MapPin, label: "Up to 5 locations", included: true },
      { icon: Users, label: "Up to 30 staff members", included: true },
      { icon: Calendar, label: "Up to 5,000 bookings / month", included: true },
      { icon: Globe, label: "White-label + custom domain", included: true, highlight: true },
      { icon: CreditCard, label: "PayFast payments & deposits", included: true },
      { icon: Mail, label: "200,000 marketing messages / month", included: true },
      { icon: Star, label: "Automated win-back & VIP campaigns", included: true, highlight: true },
      { icon: Phone, label: "Full WhatsApp automation suite", included: true, highlight: true },
      { icon: BarChart3, label: "Advanced multi-location analytics", included: true, highlight: true },
      { icon: Bot, label: "AI assistant (full access)", included: true, highlight: true },
      { icon: Building2, label: "Advanced team permissions", included: true },
      { icon: Shield, label: "Priority support + monthly review", included: true },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Custom plan builder
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_PRICING = {
  basePrice: 99,
  locations: 50,
  staff: 20,
  bookingsPerMonth: 0.02,
  marketingMessagesPerDay: 0.01,
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

/** Plan card for the "Choose Plan" dialog */
function PlanCard({
  tier, isCurrent, isLoading, onSelect,
}: {
  tier: PlanTier;
  isCurrent: boolean;
  isLoading: boolean;
  onSelect: () => void;
}) {
  const Icon = tier.icon;
  const isPopular = tier.name === "Growth";

  return (
    <div className={cn(
      "relative flex flex-col rounded-2xl border-2 p-6 transition-all hover:shadow-xl",
      isCurrent
        ? "border-primary shadow-lg shadow-primary/10"
        : `${tier.borderColor} hover:border-primary/40`,
      `bg-gradient-to-b ${tier.gradientFrom} ${tier.gradientTo}`,
    )}>
      {isPopular && !isCurrent && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-4 py-1 rounded-full shadow-md">
          Most Popular
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs font-bold px-4 py-1 rounded-full shadow-md">
          Current Plan
        </div>
      )}

      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", tier.badgeColor)}>
        <Icon className="w-5 h-5" />
      </div>

      <h3 className="text-xl font-bold mb-1">{tier.name}</h3>
      <p className="text-muted-foreground text-sm mb-5 leading-snug">{tier.tagline}</p>

      <div className="mb-6">
        <span className="text-4xl font-black">R {tier.monthlyPrice.toLocaleString()}</span>
        <span className="text-muted-foreground text-sm font-medium"> / month</span>
      </div>

      <ul className="space-y-2 flex-1 mb-6">
        {tier.features.map((f) => (
          <li key={f.label} className={cn(
            "flex items-center gap-2 text-sm",
            !f.included && "opacity-40",
          )}>
            {f.included
              ? <Check className={cn("w-4 h-4 shrink-0", f.highlight ? "text-primary" : "text-emerald-500")} />
              : <X className="w-4 h-4 shrink-0 text-muted-foreground" />
            }
            <span className={cn(f.highlight && f.included && "font-semibold")}>{f.label}</span>
          </li>
        ))}
      </ul>

      <Button
        className={cn(
          "w-full font-semibold",
          isCurrent ? "bg-muted text-muted-foreground cursor-default" : "",
        )}
        disabled={isCurrent || isLoading}
        onClick={onSelect}
      >
        {isLoading ? (
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        ) : isCurrent ? (
          "Current Plan"
        ) : (
          <>
            Get Started <ArrowRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [customPlanOpen, setCustomPlanOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const [invoices] = useState<BillingInvoice[]>([]);

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



  // ── Derived state ──────────────────────────────────────────────────────────

  // Check if subscription is a custom plan
  const isCustomPlan = subscription?.planId?.startsWith("custom_") || subscription?.planName === "Custom Plan";

  // For custom plans, extract limits from subscription metadata
  let currentTier = null;
  let limits = null;
  
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
        { icon: MapPin, label: `${customConfig.locations || 1} location(s)`, included: true },
        { icon: Users, label: `Up to ${customConfig.staff || 1} staff members`, included: true },
        { icon: Calendar, label: `Up to ${customConfig.bookingsPerMonth || 100} bookings / month`, included: true },
        { icon: Globe, label: "Public booking page", included: true },
        { icon: CreditCard, label: "PayFast payments & deposits", included: true },
        { icon: Mail, label: `${customConfig.marketingMessagesPerDay || 50} marketing messages / day`, included: true },
        { icon: Star, label: "Review requests", included: customConfig.reviewRequestsEnabled },
        { icon: Phone, label: "WhatsApp automation & inbox", included: customConfig.whatsappEnabled },
        { icon: BarChart3, label: "Analytics dashboard", included: customConfig.analyticsEnabled },
        { icon: Bot, label: "AI assistant", included: customConfig.aiAssistantEnabled },
        { icon: Building2, label: "White-label booking page", included: customConfig.whiteLabelEnabled },
        { icon: Globe, label: "Custom domain", included: customConfig.customDomainEnabled },
        { icon: Sparkles, label: "Automated campaigns", included: customConfig.automatedCampaignsEnabled },
        { icon: Shield, label: "Priority support", included: customConfig.prioritySupportEnabled },
      ],
    };
  } else {
    currentTier = PLAN_TIERS.find((t) => t.name === subscription?.planName) ?? null;
    limits = currentTier?.limits ?? null;
  }

  // Real usage limits from the current plan tier
  // For custom plans, use actual limits from metadata
  // For regular plans, use tier limits
  // Note: usageValues represents current usage (would come from API in production)
  // For now, showing 0 usage for new subscriptions
  const usageValues = limits
    ? {
        locations: 0,
        staff: 0,
        bookingsThisMonth: 0,
        marketingMessages: 0,
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
          queryClient.invalidateQueries({ queryKey: catalogKeys.plans });
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

  const updateMutation = useMutation({
    mutationFn: ({ planName, immediate }: { planName: string; immediate?: boolean }) =>
      updateSubscription(planName, immediate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
      setPlanDialogOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
      setCancelDialogOpen(false);
    },
  });

  const handlePlanSelect = (tier: PlanTier) => {
    if (!subscription) {
      createMutation.mutate(tier.name);
    } else {
      const isUpgrade = tier.monthlyPrice > subscription.price;
      updateMutation.mutate({ planName: tier.name, immediate: isUpgrade });
    }
    setPlanDialogOpen(false);
  };

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
    price += config.bookingsPerMonth * FEATURE_PRICING.bookingsPerMonth;
    price += config.marketingMessagesPerDay * FEATURE_PRICING.marketingMessagesPerDay;
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

  const handleCustomPlanSubmit = async () => {
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
  };

  const formatDate = (v: string) =>
    new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(v));

  const daysUntilRenewal = subscription?.currentPeriodEnd
    ? Math.max(0, Math.ceil(
        (new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / 86400000,
      ))
    : null;

  const isActionPending = createMutation.isPending || updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

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
        {!subscription && !loadingSubscription && (
          <Button size="lg" className="shrink-0 font-semibold" onClick={() => setPlanDialogOpen(true)}>
            <Rocket className="w-4 h-4 mr-2" />
            Choose a Plan
          </Button>
        )}
      </div>

      {/* ── Active subscription hero ── */}
      {loadingSubscription ? (
        <Card className="p-8 animate-pulse">
          <div className="h-6 bg-muted rounded w-48 mb-4" />
          <div className="h-10 bg-muted rounded w-32" />
        </Card>
      ) : subscription && currentTier ? (
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
                  subscription.status === "active"
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : "bg-amber-100 text-amber-700 border-amber-200",
                )}>
                  {subscription.status === "active"
                    ? <><CheckCircle2 className="w-3 h-3 mr-1" /> Active</>
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
              <Button onClick={() => setPlanDialogOpen(true)} variant="outline" className="gap-2">
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
        /* No subscription CTA */
        <div className="rounded-2xl border-2 border-dashed border-border/60 bg-gradient-to-br from-muted/30 to-muted/10 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Rocket className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">No Active Subscription</h2>
          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
            Choose a plan to start taking bookings, sending marketing messages, and growing your business with Bookza.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" className="font-semibold" onClick={() => setPlanDialogOpen(true)}>
              <Rocket className="w-4 h-4 mr-2" /> View Plans
            </Button>
            <Button size="lg" variant="outline" className="font-semibold" onClick={() => setCustomPlanOpen(true)}>
              <Sliders className="w-4 h-4 mr-2" /> Build Custom Plan
            </Button>
          </div>
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
                <RefreshCw className="w-3 h-3 mr-1" /> Resets monthly
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
                sublabel={`${limits.marketingMessages.toLocaleString()} / mo`}
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
              <Button variant="outline" size="sm" onClick={() => setPlanDialogOpen(true)}>
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

            {/* Upgrade nudge when on Starter/Growth */}
            {currentTier.name !== "Business" && (
              <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/5 to-violet-50 border border-primary/20 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-sm">
                    {currentTier.name === "Starter"
                      ? "Unlock WhatsApp, Analytics & more with Growth"
                      : "Unlock multi-location, AI & full automation with Business"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {currentTier.name === "Starter"
                      ? "From R 1,500/month — upgrade instantly, no downtime."
                      : "From R 5,000/month — scale across locations seamlessly."}
                  </p>
                </div>
                <Button size="sm" className="shrink-0" onClick={() => setPlanDialogOpen(true)}>
                  See Plans <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            )}
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
              {invoices.length === 0 ? (
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
                        {inv.id}
                      </div>
                    </TableCell>
                    <TableCell>{inv.date}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.plan}</TableCell>
                    <TableCell>R {inv.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon">
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
            onClick={() => setCustomPlanOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" /> Create Custom Plan
          </Button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Choose Plan Dialog
         ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">Choose Your Plan</DialogTitle>
            <DialogDescription>
              All plans include marketing campaigns, PayFast payments and bookings.
              Upgrade any time — changes take effect immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 py-4">
            {PLAN_TIERS.map((tier) => (
              <PlanCard
                key={tier.name}
                tier={tier}
                isCurrent={subscription?.planName === tier.name}
                isLoading={isActionPending}
                onSelect={() => handlePlanSelect(tier)}
              />
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground border-t">
            <Sliders className="w-4 h-4" />
            Need something different?{" "}
            <button
              className="font-semibold text-primary underline underline-offset-2"
              onClick={() => {
                setPlanDialogOpen(false);
                setCustomPlanOpen(true);
              }}
            >
              Build a custom plan
            </button>
          </div>
        </DialogContent>
      </Dialog>

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
            <ScrollArea className="flex-1 px-6 py-4">
              <Tabs defaultValue="core" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                  <TabsTrigger value="core">Core</TabsTrigger>
                  <TabsTrigger value="features">Features</TabsTrigger>
                  <TabsTrigger value="branding">Branding</TabsTrigger>
                </TabsList>

                {/* ── Core tab ── */}
                <TabsContent value="core" className="space-y-4">
                  {[
                    {
                      icon: Mail, key: "marketingMessagesPerDay" as keyof CustomPlanConfig,
                      label: "Marketing Messages / Day",
                      min: 10, max: MAX_MESSAGES_PER_DAY, step: 10,
                      note: `R ${FEATURE_PRICING.marketingMessagesPerDay} per message (max ${MAX_MESSAGES_PER_DAY}/day)`,
                    },
                    {
                      icon: MapPin, key: "locations" as keyof CustomPlanConfig,
                      label: "Locations", min: 1, max: 10, step: 1,
                      note: `R ${FEATURE_PRICING.locations} per location`,
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
                  ].map(({ icon: Icon, key, label, min, max, step, note }) => (
                    <Card key={key} className="p-5">
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
                          onValueChange={([v]) => handleCustomPlanChange(key, v as any)}
                          min={min} max={max} step={step} className="w-full"
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
                    },
                    {
                      key: "automatedCampaignsEnabled" as keyof CustomPlanConfig,
                      icon: MessageSquare, iconBg: "bg-pink-100", iconColor: "text-pink-600",
                      label: "Automated Campaigns",
                      desc: "Win-back and VIP campaigns",
                      price: FEATURE_PRICING.automatedCampaignsEnabled,
                    },
                  ].map(({ key, icon: Icon, iconBg, iconColor, label, desc, price }) => {
                    const enabled = customPlan[key] as boolean;
                    return (
                      <Card key={key} className={cn("p-5 transition-all", enabled && "border-primary/30 bg-primary/5")}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-lg", enabled ? "bg-primary/10" : iconBg)}>
                              <Icon className={cn("w-4 h-4", enabled ? "text-primary" : iconColor)} />
                            </div>
                            <div>
                              <Label className="font-semibold">{label}</Label>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-muted-foreground">+R {price}/mo</span>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => handleCustomPlanChange(key, v as any)}
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
                    },
                    {
                      key: "customDomainEnabled" as keyof CustomPlanConfig,
                      icon: Globe, iconBg: "bg-indigo-100", iconColor: "text-indigo-600",
                      label: "Custom Domain",
                      desc: "Use your own domain",
                      price: FEATURE_PRICING.customDomainEnabled,
                    },
                    {
                      key: "prioritySupportEnabled" as keyof CustomPlanConfig,
                      icon: Crown, iconBg: "bg-rose-100", iconColor: "text-rose-600",
                      label: "Priority Support",
                      desc: "24/7 dedicated support",
                      price: FEATURE_PRICING.prioritySupportEnabled,
                    },
                  ].map(({ key, icon: Icon, iconBg, iconColor, label, desc, price }) => {
                    const enabled = customPlan[key] as boolean;
                    return (
                      <Card key={key} className={cn("p-5 transition-all", enabled && "border-primary/30 bg-primary/5")}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-lg", enabled ? "bg-primary/10" : iconBg)}>
                              <Icon className={cn("w-4 h-4", enabled ? "text-primary" : iconColor)} />
                            </div>
                            <div>
                              <Label className="font-semibold">{label}</Label>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-muted-foreground">+R {price}/mo</span>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => handleCustomPlanChange(key, v as any)}
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
            <div className="w-full lg:w-[380px] bg-muted/20 border-l p-6 flex flex-col gap-4">
              <Card className="p-5 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 flex-1 flex flex-col overflow-hidden">
                <h3 className="font-bold text-lg mb-4">Plan Summary</h3>
                <ScrollArea className="flex-1">
                  <div className="space-y-2.5 pr-2">
                    {[
                      { label: "Base price", value: FEATURE_PRICING.basePrice },
                      { label: `Locations (${customPlan.locations})`, value: customPlan.locations * FEATURE_PRICING.locations },
                      { label: `Staff (${customPlan.staff})`, value: customPlan.staff * FEATURE_PRICING.staff },
                      {
                        label: `Bookings (${customPlan.bookingsPerMonth}/mo)`,
                        value: Math.round(customPlan.bookingsPerMonth * FEATURE_PRICING.bookingsPerMonth),
                      },
                      {
                        label: `Marketing (${customPlan.marketingMessagesPerDay}/day)`,
                        value: Math.round(customPlan.marketingMessagesPerDay * FEATURE_PRICING.marketingMessagesPerDay),
                      },
                      ...(customPlan.whatsappEnabled ? [{ label: "WhatsApp", value: FEATURE_PRICING.whatsappEnabled }] : []),
                      ...(customPlan.analyticsEnabled ? [{ label: "Analytics", value: FEATURE_PRICING.analyticsEnabled }] : []),
                      ...(customPlan.aiAssistantEnabled ? [{ label: "AI Assistant", value: FEATURE_PRICING.aiAssistantEnabled }] : []),
                      ...(customPlan.whiteLabelEnabled ? [{ label: "White Label", value: FEATURE_PRICING.whiteLabelEnabled }] : []),
                      ...(customPlan.customDomainEnabled ? [{ label: "Custom Domain", value: FEATURE_PRICING.customDomainEnabled }] : []),
                      ...(customPlan.reviewRequestsEnabled ? [{ label: "Review Requests", value: FEATURE_PRICING.reviewRequestsEnabled }] : []),
                      ...(customPlan.automatedCampaignsEnabled ? [{ label: "Campaigns", value: FEATURE_PRICING.automatedCampaignsEnabled }] : []),
                      ...(customPlan.prioritySupportEnabled ? [{ label: "Priority Support", value: FEATURE_PRICING.prioritySupportEnabled }] : []),
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-medium">R {row.value}</span>
                      </div>
                    ))}

                    <div className="border-t pt-3 mt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-semibold">R {customPlanPricing.basePrice}</span>
                      </div>
                      {customPlanPricing.discount > 0 && (
                        <div className="flex justify-between text-sm text-emerald-600">
                          <span className="font-medium flex items-center gap-1">
                            <Percent className="w-3 h-3" /> Volume Discount
                          </span>
                          <span className="font-bold">−{customPlanPricing.discount}%</span>
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-3 mt-1">
                      <div className="flex justify-between items-baseline">
                        <span className="font-bold text-base">Total</span>
                        <div className="text-right">
                          <span className="text-3xl font-black text-primary">
                            R {customPlanPricing.finalPrice}
                          </span>
                          <span className="text-muted-foreground text-sm font-medium">/mo</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </Card>

              <div className="space-y-3">
                {customPlanPricing.discount > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    <Percent className="w-4 h-4 text-emerald-600 shrink-0" />
                    <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                      You're saving {customPlanPricing.discount}% with volume discount!
                    </p>
                  </div>
                )}

                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                  <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Plans over R 1,000 get 10% off. Plans over R 5,000 get 20% off.
                  </p>
                </div>

                <Button className="w-full font-bold" size="lg" onClick={handleCustomPlanSubmit}>
                  Activate — R {customPlanPricing.finalPrice}/mo
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
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
