import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchSubscription, updateSubscription, cancelSubscription, createSubscriptionWithPayFast, fetchPlans, checkPayFastPaymentStatus } from "@/lib/catalog-subscriptions";
import { catalogKeys } from "@/lib/catalog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Check, CreditCard, Download, Receipt, Zap, Building2, Sparkles } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function getPlanDescription(name: string): string {
  switch (name) {
    case "Starter":
      return "For small businesses that need bookings, payments, and basic marketing.";
    case "Growth":
      return "For active teams that want automation, retention, and stronger reporting.";
    case "Business":
      return "For high-volume teams, multi-location operators, and serious automation.";
    default:
      return "";
  }
}

function getPlanFeatures(name: string): string[] {
  switch (name) {
    case "Starter":
      return [
        "1 location",
        "Up to 2 staff members",
        "Up to 150 bookings/month",
        "Public booking page with Bookza branding",
        "Calendar, bookings, clients, services",
        "PayFast payments and deposits",
        "Payment tracking",
        "Marketing campaigns included",
        "10,000 total marketing messages/month",
        "Basic review requests and promotions",
      ];
    case "Growth":
      return [
        "1 location",
        "Up to 8 staff members",
        "Up to 1,000 bookings/month",
        "Everything in Starter",
        "Remove Bookza branding",
        "WhatsApp confirmations and reminders",
        "Staff WhatsApp notifications",
        "WhatsApp inbox",
        "Advanced client CRM filters",
        "Analytics dashboard",
        "50,000 total marketing messages/month",
        "Segmented campaigns, referrals, reviews",
        "Priority support",
      ];
    case "Business":
      return [
        "Up to 5 locations",
        "Up to 30 staff members",
        "Up to 5,000 bookings/month",
        "Everything in Growth",
        "Multi-location reporting",
        "Full WhatsApp automation suite",
        "AI assistant",
        "Advanced analytics and insights",
        "White-label booking page and custom domain",
        "Advanced team permissions",
        "200,000 total marketing messages/month",
        "Automated win-back and VIP campaigns",
        "Setup assistance and monthly review",
      ];
    default:
      return [];
  }
}

function getPlanLimits(name: string): string[] {
  switch (name) {
    case "Starter":
      return [
        "No WhatsApp automation or inbox",
        "Bookza branding remains on booking page",
        "No advanced analytics or AI assistant",
      ];
    case "Growth":
      return [
        "Single location only",
        "AI assistant is limited",
        "No custom domain or white-label booking page",
      ];
    case "Business":
      return [
        "Extra locations billed separately after 5",
        "Extra staff billed separately after 30",
        "Custom integrations quoted separately",
      ];
    default:
      return [];
  }
}

type BillingPlan = {
  id: string;
  name: string;
  price: number;
  desc: string;
  features: string[];
  limits: string[];
  icon: any;
  color: string;
  usageLimits: {
    locations: number;
    staff: number;
    bookings: number;
    marketingMessages: number;
  };
};

type BillingSubscription = {
  planName: string;
  price: number;
  currentPeriodEnd: string;
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  pendingPlanName: string | null;
};
type BillingUsage = {
  label: string;
  used: number;
  total: number | null;
};
type BillingPaymentMethod = {
  brand: string;
  last4: string;
  expiresAt: string;
};
type BillingInvoice = {
  id: string;
  date: string;
  plan: string;
  amount: number;
  status: string;
};

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [usage, setUsage] = useState<BillingUsage[]>([]);
  const [paymentMethod] = useState<BillingPaymentMethod | null>(null);
  const [invoices] = useState<BillingInvoice[]>([]);

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: catalogKeys.subscription,
    queryFn: fetchSubscription,
  });

  const { data: plansData, isLoading: loadingPlans } = useQuery({
    queryKey: ["plans"],
    queryFn: fetchPlans,
  });

  // Convert database plans to billing plan format
  const plans: BillingPlan[] = plansData ? plansData.map((plan, index) => ({
    id: plan.id,
    name: plan.name,
    price: plan.price,
    desc: getPlanDescription(plan.name),
    features: getPlanFeatures(plan.name),
    limits: getPlanLimits(plan.name),
    icon: index === 0 ? Zap : index === 1 ? Sparkles : Building2,
    color: index === 1 ? "border-primary/60" : "border-border/50",
    usageLimits: plan.metadata,
  })) : [];

  // Fetch usage data when subscription changes
  useEffect(() => {
    if (!subscription) {
      setUsage([]);
      return;
    }

    const currentPlan = plans.find(p => p.name === subscription.planName);
    if (!currentPlan) {
      setUsage([]);
      return;
    }

    // Simulate usage data - in production, fetch from API
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Mock usage data based on plan limits
    const mockUsage: BillingUsage[] = [
      {
        label: "Locations",
        used: 1,
        total: currentPlan.usageLimits.locations,
      },
      {
        label: "Staff Members",
        used: 3,
        total: currentPlan.usageLimits.staff,
      },
      {
        label: "Bookings This Month",
        used: 87,
        total: currentPlan.usageLimits.bookings,
      },
      {
        label: "Marketing Messages",
        used: 2340,
        total: currentPlan.usageLimits.marketingMessages,
      },
    ];

    setUsage(mockUsage);
  }, [subscription]);

  // Handle PayFast return URLs
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payfastStatus = params.get("payfast");
    const subscriptionId = params.get("subscription_id");

    if (payfastStatus === "success" && subscriptionId) {
      console.log("[Billing] Payment successful, checking status for", subscriptionId);
      
      // Check payment status via Edge Function
      checkPayFastPaymentStatus(subscriptionId)
        .then((updatedSubscription) => {
          console.log("[Billing] Subscription activated:", updatedSubscription);
          // Refresh subscription data after payment
          queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
          queryClient.invalidateQueries({ queryKey: catalogKeys.plans });
        })
        .catch((err) => {
          console.error("[Billing] Failed to check payment status:", err);
          // Still refresh in case webhook worked
          queryClient.invalidateQueries({ queryKey: catalogKeys.subscription });
          queryClient.invalidateQueries({ queryKey: catalogKeys.plans });
        })
        .finally(() => {
          // Clean up URL
          window.history.replaceState(null, "", window.location.pathname);
        });
    } else if (payfastStatus === "cancelled" && subscriptionId) {
      console.log("[Billing] Payment cancelled");
      // Clean up URL on cancellation
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [location, queryClient]);

  const currentPlan = subscription
    ? plans.find((plan) => plan.name === subscription.planName) ?? null
    : null;

  const formatRenewalDate = (value: string) =>
    new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(value));

  const createMutation = useMutation({
    mutationFn: createSubscriptionWithPayFast,
    onSuccess: (data) => {
      // Submit form to PayFast
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.action;
      form.style.display = "none";

      Object.entries(data.fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ planName, immediate }: { planName: string; immediate?: boolean }) => updateSubscription(planName, immediate),
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

  const getPlanButtonText = (plan: BillingPlan): string => {
    if (!subscription) {
      return `Choose ${plan.name}`;
    }
    if (currentPlan?.name === plan.name) {
      return "Current Plan";
    }
    if (plan.price > subscription.price) {
      return `Upgrade to ${plan.name}`;
    }
    if (plan.price < subscription.price) {
      return `Downgrade to ${plan.name}`;
    }
    return `Switch to ${plan.name}`;
  };

  const handlePlanAction = (plan: BillingPlan) => {
    if (!subscription) {
      // New subscription - use PayFast payment
      createMutation.mutate(plan.name);
    } else {
      // Existing subscription - direct update (no payment for now)
      const isUpgrade = plan.price > subscription.price;
      updateMutation.mutate({ planName: plan.name, immediate: isUpgrade });
    }
  };

  const handleCancelSubscription = () => {
    cancelMutation.mutate();
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Billing & Subscription</h1>
        <p className="text-muted-foreground text-sm">Manage your plan, payment methods, and invoices.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 shadow-sm border-border/50">
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>Your live subscription details will appear here.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 p-6 border rounded-xl bg-gradient-to-r from-primary/5 to-transparent">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-2xl font-bold text-foreground">
                    {loadingSubscription ? "Loading..." : subscription ? `${subscription.planName} Plan` : "No active plan"}
                  </h3>
                  {subscription && (
                    <Badge className="bg-primary hover:bg-primary">
                      {subscription.status.replace("_", " ")}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground font-medium">
                  {subscription ? `R ${subscription.price.toLocaleString()} / month` : "Choose a plan to activate billing."}
                </p>
                {subscription?.currentPeriodEnd && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Renews on {formatRenewalDate(subscription.currentPeriodEnd)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 w-full sm:w-auto">
                <Button variant="outline" className="bg-background" onClick={() => setPlanDialogOpen(true)}>
                  {subscription ? "Change Plan" : "Choose Plan"}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={!subscription || cancelMutation.isPending}
                >
                  {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
                </Button>
              </div>
            </div>

            <div className="mt-8 space-y-5">
              <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Plan Usage</h4>

              {!subscription ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm font-medium">No active subscription</p>
                  <p className="text-sm text-muted-foreground mt-1">Choose a plan to see your usage metrics.</p>
                </div>
              ) : usage.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm font-medium">Loading usage data...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {usage.map(u => {
                    const pct = u.total ? Math.round((u.used / u.total) * 100) : null;
                    const isWarn = pct !== null && pct >= 80;
                    const isDanger = pct !== null && pct >= 95;
                    const isGood = pct !== null && pct < 50;
                    
                    return (
                      <div key={u.label} className="p-4 rounded-lg border bg-card space-y-3">
                        <div className="flex justify-between items-start">
                          <span className="font-medium text-sm">{u.label}</span>
                          <span className={cn(
                            "text-xs font-semibold px-2 py-1 rounded-full",
                            isDanger ? "bg-red-100 text-red-700" :
                            isWarn ? "bg-amber-100 text-amber-700" :
                            isGood ? "bg-emerald-100 text-emerald-700" :
                            "bg-blue-100 text-blue-700"
                          )}>
                            {pct !== null ? `${pct}%` : "Unlimited"}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground font-semibold">{u.used.toLocaleString()}</span>
                          <span className="text-muted-foreground">
                                of {u.total ? u.total.toLocaleString() : "∞"}
                          </span>
                        </div>
                        {u.total && pct !== null && (
                          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                isDanger ? "bg-red-500" :
                                isWarn ? "bg-amber-500" :
                                isGood ? "bg-emerald-500" :
                                "bg-primary"
                              )}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Payment Method</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentMethod ? (
                <div className="flex items-center gap-4 p-4 border rounded-lg">
                  <div className="w-12 h-8 bg-muted rounded flex items-center justify-center border">
                    <CreditCard className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">**** **** **** {paymentMethod.last4}</p>
                    <p className="text-xs text-muted-foreground">{paymentMethod.brand} - Expires {paymentMethod.expiresAt}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">Default</Badge>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-5 text-center">
                  <CreditCard className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium">No payment method on file</p>
                  <p className="text-xs text-muted-foreground mt-1">Connect real billing before storing card details.</p>
                </div>
              )}
              <Button variant="outline" className="w-full mt-4">
                {paymentMethod ? "Update Method" : "Add Payment Method"}
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/50 bg-primary text-primary-foreground border-none">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-lg">{currentPlan ? "Need more power?" : "Choose a plan"}</h3>
              <p className="text-primary-foreground/80 text-sm">
                {currentPlan
                  ? "Review available plans and upgrade when your team, bookings, or message volume grows."
                  : "Select the plan that matches your team size, booking volume, and marketing needs."}
              </p>
              <Button className="w-full bg-background text-primary hover:bg-background/90 font-semibold" onClick={() => setPlanDialogOpen(true)}>
                View Plans
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
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
                  <TableCell colSpan={6} className="h-40 text-center">
                    <Receipt className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm font-medium">No invoices yet</p>
                    <p className="text-sm text-muted-foreground">Billing history will appear after the first real invoice is created.</p>
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
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{inv.status}</Badge>
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

      {/* Change Plan Dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Your Plan</DialogTitle>
            <DialogDescription>All plans include marketing campaigns. Upgrade as your team, bookings, and message volume grow.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
            {plans.map(plan => (
              <div
                key={plan.name}
                className={cn(
                  "relative border-2 rounded-xl p-5 flex flex-col",
                  currentPlan?.name === plan.name ? "border-primary" : plan.color,
                )}
              >
                {currentPlan?.name === plan.name && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-0.5 rounded-full">
                    Current
                  </div>
                )}
                <div className={cn("p-2 rounded-lg w-fit mb-3", currentPlan?.name === plan.name ? "bg-primary/10" : "bg-muted")}>
                  <plan.icon className={cn("w-5 h-5", currentPlan?.name === plan.name ? "text-primary" : "text-muted-foreground")} />
                </div>
                <h3 className="font-bold text-lg">{plan.name}</h3>
                <p className="text-muted-foreground text-sm mb-3">{plan.desc}</p>
                <p className="text-3xl font-bold mb-4">R {plan.price.toLocaleString()}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mb-5 rounded-lg bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Limits</p>
                  <ul className="space-y-1.5">
                    {plan.limits.map(limit => (
                      <li key={limit} className="text-xs text-muted-foreground">
                        {limit}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  className={cn("w-full", currentPlan?.name === plan.name ? "bg-muted text-muted-foreground cursor-default" : "bg-primary hover:bg-primary/90")}
                  disabled={currentPlan?.name === plan.name || createMutation.isPending || updateMutation.isPending}
                  onClick={() => handlePlanAction(plan)}
                >
                  {(createMutation.isPending || updateMutation.isPending) ? "Processing..." : getPlanButtonText(plan)}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Subscription Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Subscription?</DialogTitle>
            <DialogDescription>
              Cancelling will stop future renewals for your active subscription once real billing is connected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">You will lose access to:</p>
            <ul className="space-y-1">
              {["Plan allowances", "Billing usage limits", "Paid automation features"].map(f => (
                <li key={f} className="text-sm flex items-center gap-2 text-destructive">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Keep My Plan</Button>
            <Button variant="destructive" onClick={handleCancelSubscription} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
