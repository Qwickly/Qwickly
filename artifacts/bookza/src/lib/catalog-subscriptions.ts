import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

// ── Subscriptions ───────────────────────────────────────────────────────────────

export type CatalogSubscription = {
  id: string;
  businessId: string;
  userId: string;
  planId: string;
  planName: string;
  status: "active" | "past_due" | "canceled" | "incomplete" | "trialing";
  price: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: string | null;
  pendingPlanName: string | null;
  payfastToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogPlan = {
  id: string;
  name: string;
  price: number;
  billingInterval: string;
  intervalCount: number;
  metadata: {
    locations: number;
    staff: number;
    bookings: number;
    marketingMessages: number;
  };
};

export async function fetchSubscription(): Promise<CatalogSubscription | null> {
  console.log("[fetchSubscription] Called");
  
  const businessId = await ensureBusiness();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  console.log("[fetchSubscription] Fetching from /api/subscriptions");

  const response = await fetch("/api/subscriptions", {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  console.log("[fetchSubscription] Response status:", response.status);

  if (!response.ok) {
    console.error("[fetchSubscription] Error response");
    throw new Error("Could not fetch subscription");
  }

  const subscription = await response.json();
  console.log("[fetchSubscription] Subscription data:", subscription);
  
  if (!subscription) {
    console.log("[fetchSubscription] No subscription found");
    return null;
  }

  const plan = subscription.plans as { id: string; name: string; price_cents: number };
  console.log("[fetchSubscription] Plan data:", plan);
  
  const result = {
    id: subscription.id,
    businessId: subscription.business_id,
    userId: subscription.user_id,
    planId: subscription.plan_id,
    planName: plan.name,
    status: subscription.status,
    price: Number(plan.price_cents) / 100,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    pendingPlanId: subscription.pending_plan_id,
    pendingPlanName: null,
    payfastToken: subscription.payfast_token,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
  };
  
  console.log("[fetchSubscription] Returning:", result);
  return result;
}

export async function fetchPlans(): Promise<CatalogPlan[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("billing_interval", "month")
    .order("price_cents", { ascending: true });

  if (error) throw new Error(error.message);
  if (!data) return [];

  return data.map(plan => ({
    id: plan.id as string,
    name: plan.name as string,
    price: Number(plan.price_cents) / 100, // Convert cents to Rands
    billingInterval: plan.billing_interval as string,
    intervalCount: plan.interval_count as number,
    metadata: (plan.metadata as any) || {},
  }));
}

export async function createSubscriptionWithPayFast(planName: string): Promise<{ action: string; subscriptionId: string; fields: Record<string, string> }> {
  const businessId = await ensureBusiness();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch("/api/subscriptions/payfast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ planName, origin: window.location.origin }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not create PayFast subscription payment");
  }

  return await response.json();
}

export async function checkPayFastPaymentStatus(paymentReference: string): Promise<CatalogSubscription> {
  console.log("[checkPayFastPaymentStatus] Called with paymentReference:", paymentReference);
  
  const businessId = await ensureBusiness();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  console.log("[checkPayFastPaymentStatus] Fetching check-status endpoint");

  const response = await fetch("/api/subscriptions/payfast/check-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ paymentReference }),
  });

  console.log("[checkPayFastPaymentStatus] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    console.error("[checkPayFastPaymentStatus] Error response:", error);
    throw new Error(error.error || "Could not check payment status");
  }

  const subscription = await response.json();
  console.log("[checkPayFastPaymentStatus] Subscription response:", subscription);
  
  const plan = subscription.plans as { id: string; name: string; price_cents: number };
  
  const result = {
    id: subscription.id,
    businessId: subscription.business_id,
    userId: subscription.user_id,
    planId: subscription.plan_id,
    planName: plan.name,
    status: subscription.status,
    price: Number(plan.price_cents) / 100,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    pendingPlanId: subscription.pending_plan_id,
    pendingPlanName: null,
    payfastToken: subscription.payfast_token,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
  };
  
  console.log("[checkPayFastPaymentStatus] Returning:", result);
  return result;
}

export async function updateSubscription(planName: string, immediate?: boolean): Promise<CatalogSubscription> {
  const businessId = await ensureBusiness();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch("/api/subscriptions", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ planName, immediate }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not update subscription");
  }

  const subscription = await response.json();
  const plan = subscription.plans as { id: string; name: string; price_cents: number };
  
  return {
    id: subscription.id,
    businessId: subscription.business_id,
    userId: subscription.user_id,
    planId: subscription.plan_id,
    planName: plan.name,
    status: subscription.status,
    price: Number(plan.price_cents) / 100,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    pendingPlanId: subscription.pending_plan_id,
    pendingPlanName: null,
    payfastToken: subscription.payfast_token,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
  };
}

export async function cancelSubscription(): Promise<CatalogSubscription> {
  const businessId = await ensureBusiness();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch("/api/subscriptions", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not cancel subscription");
  }

  const subscription = await response.json();
  const plan = subscription.plans as { id: string; name: string; price_cents: number };
  
  return {
    id: subscription.id,
    businessId: subscription.business_id,
    userId: subscription.user_id,
    planId: subscription.plan_id,
    planName: plan.name,
    status: subscription.status,
    price: Number(plan.price_cents) / 100,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    pendingPlanId: subscription.pending_plan_id,
    pendingPlanName: null,
    payfastToken: subscription.payfast_token,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
  };
}
