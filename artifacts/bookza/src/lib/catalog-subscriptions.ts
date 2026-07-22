import { ensureBusiness } from "@/lib/settings";
import { supabase, supabaseUrl } from "@/lib/supabase";

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
  metadata?: {
    whatsappEnabled?: boolean;
  };
  plans?: CatalogPlan;
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
    whatsappEnabled?: boolean;
  };
};

type RawPlan = { id: string; name: string; price_cents: number; metadata?: any };

function unwrapPlan(plans: RawPlan | RawPlan[]): RawPlan {
  return Array.isArray(plans) ? plans[0] : plans;
}

export async function fetchSubscription(): Promise<CatalogSubscription | null> {
  console.log("[fetchSubscription] Called - using Supabase Edge Function");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management`, {
    headers: {
      "Content-Type": "application/json",
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

  const plan = unwrapPlan(subscription.plans as RawPlan | RawPlan[]);
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
    plans: plan, // Include the full plan object with metadata
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
  console.log("[createSubscriptionWithPayFast] Called - using Supabase Edge Function");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management/payfast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ planName, origin: window.location.origin }),
  });

  console.log("[createSubscriptionWithPayFast] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not create PayFast subscription payment");
  }

  return await response.json();
}

export async function checkPayFastPaymentStatus(paymentReference: string): Promise<CatalogSubscription> {
  console.log("[checkPayFastPaymentStatus] Called with paymentReference:", paymentReference);
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  console.log("[checkPayFastPaymentStatus] Fetching Edge Function check-status endpoint");

  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management/payfast/check-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ paymentReference }),
  });

  console.log("[checkPayFastPaymentStatus] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    console.error("[checkPayFastPaymentStatus] Error response:", error);
    throw new Error(error?.error || "Could not check payment status");
  }

  const subscription = await response.json();
  console.log("[checkPayFastPaymentStatus] Subscription response:", subscription);

  if (subscription.paymentStatus === "pending" || subscription.status === "incomplete") {
    throw new Error("Payment is still pending confirmation");
  }
  
  const plan = unwrapPlan(subscription.plans as RawPlan | RawPlan[]);
  
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
  console.log("[updateSubscription] Called - using Supabase Edge Function");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ planName, immediate }),
  });

  console.log("[updateSubscription] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not update subscription");
  }

  const subscription = await response.json();
  const plan = unwrapPlan(subscription.plans as RawPlan | RawPlan[]);
  
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
  console.log("[cancelSubscription] Called - using Supabase Edge Function");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  console.log("[cancelSubscription] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not cancel subscription");
  }

  const subscription = await response.json();
  const plan = unwrapPlan(subscription.plans as RawPlan | RawPlan[]);
  
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

export async function createCustomPlanWithPayFast(config: {
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
  finalPrice: number;
}): Promise<{ action: string; subscriptionId: string; fields: Record<string, string> }> {
  console.log("[createCustomPlanWithPayFast] Called with config:", config);
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/subscription-management/payfast/custom`;

  const response = await fetch(edgeFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      customPlan: config,
      origin: window.location.origin,
    }),
  });

  console.log("[createCustomPlanWithPayFast] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Could not create custom plan subscription");
  }

  return await response.json();
}

export async function updateCustomPlanWithPayFast(config: {
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
  finalPrice: number;
}): Promise<{ success: boolean; payFastUpdated: boolean }> {
  console.log("[updateCustomPlanWithPayFast] Called with config:", config);
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/subscription-management/payfast/update-plan`;

  const response = await fetch(edgeFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      customPlan: config,
      origin: window.location.origin,
    }),
  });

  console.log("[updateCustomPlanWithPayFast] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || "Could not update custom plan subscription");
  }

  return await response.json();
}

export type Invoice = {
  id: string;
  businessId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: "paid" | "pending" | "failed" | "refunded";
  paymentMethod: string;
  paymentDate: string;
  dueDate: string | null;
  description: string | null;
  metadata: any;
  createdAt: string;
  updatedAt: string;
};

export async function fetchInvoices(): Promise<Invoice[]> {
  console.log("[fetchInvoices] Called");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management/invoices`, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  console.log("[fetchInvoices] Response status:", response.status);

  if (!response.ok) {
    console.error("[fetchInvoices] Error response");
    throw new Error("Could not fetch invoices");
  }

  const invoices = await response.json();
  console.log("[fetchInvoices] Invoices data:", invoices);
  
  return invoices.map((inv: any) => ({
    id: inv.id,
    businessId: inv.business_id,
    subscriptionId: inv.subscription_id,
    invoiceNumber: inv.invoice_number,
    amount: Number(inv.amount),
    currency: inv.currency,
    status: inv.status,
    paymentMethod: inv.payment_method,
    paymentDate: inv.payment_date,
    dueDate: inv.due_date,
    description: inv.description,
    metadata: inv.metadata,
    createdAt: inv.created_at,
    updatedAt: inv.updated_at,
  }));
}

export type UsageTracking = {
  id: string;
  businessId: string;
  subscriptionId: string | null;
  trackingDate: string;
  marketingMessagesSent: number;
  whatsappMessagesSent: number;
  whatsappCampaignsSent: number;
  bookingsCreated: number;
  bookingsCompleted: number;
  bookingsCancelled: number;
  clientsAdded: number;
  reviewRequestsSent: number;
  reviewsReceived: number;
  metadata: any;
  createdAt: string;
  updatedAt: string;
};

export async function fetchTodayUsage(): Promise<UsageTracking | null> {
  console.log("[fetchTodayUsage] Called");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const today = new Date().toISOString().split('T')[0];
  
  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management/usage/today`, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  console.log("[fetchTodayUsage] Response status:", response.status);

  if (!response.ok) {
    console.error("[fetchTodayUsage] Error response");
    throw new Error("Could not fetch today's usage");
  }

  const usage = await response.json();
  console.log("[fetchTodayUsage] Usage data:", usage);
  
  if (!usage) return null;
  
  return {
    id: usage.id,
    businessId: usage.business_id,
    subscriptionId: usage.subscription_id,
    trackingDate: usage.tracking_date,
    marketingMessagesSent: usage.marketing_messages_sent,
    whatsappMessagesSent: usage.whatsapp_messages_sent,
    whatsappCampaignsSent: usage.whatsapp_campaigns_sent,
    bookingsCreated: usage.bookings_created,
    bookingsCompleted: usage.bookings_completed,
    bookingsCancelled: usage.bookings_cancelled,
    clientsAdded: usage.clients_added,
    reviewRequestsSent: usage.review_requests_sent,
    reviewsReceived: usage.reviews_received,
    metadata: usage.metadata,
    createdAt: usage.created_at,
    updatedAt: usage.updated_at,
  };
}

export async function fetchMonthlyBookingCount(): Promise<number> {
  console.log("[fetchMonthlyBookingCount] Called");
  
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  
  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management/usage/monthly-bookings`, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  console.log("[fetchMonthlyBookingCount] Response status:", response.status);

  if (!response.ok) {
    console.error("[fetchMonthlyBookingCount] Error response");
    throw new Error("Could not fetch monthly booking count");
  }

  const result = await response.json();
  console.log("[fetchMonthlyBookingCount] Result:", result);
  
  return result.count || 0;
}

export async function fetchStaffCount(): Promise<number> {
  console.log("[fetchStaffCount] Called");
  
  const businessId = await ensureBusiness();
  
  const { count, error } = await supabase
    .from("staff_members")
    .select("*", { count: "exact", head: true })
    .eq("business_id", businessId);

  if (error) {
    console.error("[fetchStaffCount] Error counting staff:", error);
    throw new Error("Could not fetch staff count");
  }

  console.log("[fetchStaffCount] Result:", count);
  return count || 0;
}
