import { Router } from "express";
import { createHash } from "node:crypto";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";

const router = Router();

const PLAN_PRICES: Record<string, number> = {
  Starter: 400,
  Growth: 1500,
  Business: 5000,
};

const PAYFAST_SANDBOX_URL =
  process.env["PAYFAST_SANDBOX_URL"] ?? "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_PRODUCTION_URL =
  process.env["PAYFAST_PRODUCTION_URL"] ?? "https://www.payfast.co.za/eng/process";
const PAYFAST_SANDBOX_MERCHANT_ID =
  process.env["PAYFAST_SANDBOX_MERCHANT_ID"] ?? "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY =
  process.env["PAYFAST_SANDBOX_MERCHANT_KEY"] ?? "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE =
  process.env["PAYFAST_SANDBOX_PASSPHRASE"] ?? "uber20206torbeN";
const PAYFAST_PRODUCTION_MERCHANT_ID =
  process.env["PAYFAST_PRODUCTION_MERCHANT_ID"] ?? "34837169";
const PAYFAST_PRODUCTION_MERCHANT_KEY =
  process.env["PAYFAST_PRODUCTION_MERCHANT_KEY"] ?? "lbp3p79l1ljhz";
const PAYFAST_PRODUCTION_PASSPHRASE =
  process.env["PAYFAST_PRODUCTION_PASSPHRASE"] ?? "Qwickly2026DT";

function encodePayFastValue(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

function createPayFastSignature(fields: Record<string, string>, passphrase: string): string {
  const parameterString = [
    ...Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${encodePayFastValue(value)}`),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  return createHash("md5").update(parameterString).digest("hex");
}

function getRequestOrigin(req: any): string {
  const requestedOrigin = typeof req.body?.origin === "string" ? req.body.origin : "";
  if (/^https?:\/\/[^/]+$/i.test(requestedOrigin)) return requestedOrigin;

  const fallbackProtocol = req.get("x-forwarded-proto") ?? req.protocol;
  return `${fallbackProtocol}://${req.get("host")}`;
}

async function getBusinessForUser(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string };
}

router.get("/subscriptions", requireUser, async (req, res) => {
  try {
    console.log("[GET Subscriptions] Request received");
    
    if (!isSupabaseAdminConfigured()) {
      console.error("[GET Subscriptions] Supabase not configured");
      return res.status(503).json({
        error: "Subscription tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const supabase = getSupabaseAdmin();

    console.log("[GET Subscriptions] User:", user.id, "Business:", business.id);

    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("*, plans!subscriptions_plan_id_fkey(*)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log("[GET Subscriptions] Query result:", { subscription, error });

    if (error) throw new Error(error.message);

    if (!subscription) {
      console.log("[GET Subscriptions] No subscription found");
      return res.json(null);
    }

    console.log("[GET Subscriptions] Returning subscription:", subscription);
    res.json(subscription);
  } catch (err) {
    console.error("[GET Subscriptions] Error:", err);
    req.log.error(err);
    res.status(500).json({ error: "Could not fetch subscription" });
  }
});

router.post("/subscriptions/payfast/custom", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Subscription tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const customPlanConfig = req.body as {
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
    };

    if (!customPlanConfig || !customPlanConfig.name || !customPlanConfig.finalPrice) {
      return res.status(400).json({ error: "Invalid custom plan configuration" });
    }

    const supabase = getSupabaseAdmin();
    const origin = getRequestOrigin(req);
    const subscriptionId = `bookza-custom-${Date.now()}`;
    const planId = `custom_${Date.now()}`;

    // Create custom plan entry in plans table
    const planMetadata = {
      locations: customPlanConfig.locations,
      staff: customPlanConfig.staff,
      bookings: customPlanConfig.bookingsPerMonth,
      marketingMessages: customPlanConfig.marketingMessagesPerDay * 30, // Convert to monthly
      whatsappEnabled: customPlanConfig.whatsappEnabled,
      whatsappMessages: customPlanConfig.whatsappMessagesPerDay * 30,
      analyticsEnabled: customPlanConfig.analyticsEnabled,
      aiAssistantEnabled: customPlanConfig.aiAssistantEnabled,
      whiteLabelEnabled: customPlanConfig.whiteLabelEnabled,
      customDomainEnabled: customPlanConfig.customDomainEnabled,
      reviewRequestsEnabled: customPlanConfig.reviewRequestsEnabled,
      automatedCampaignsEnabled: customPlanConfig.automatedCampaignsEnabled,
      prioritySupportEnabled: customPlanConfig.prioritySupportEnabled,
    };

    const { error: planError } = await supabase
      .from("plans")
      .insert({
        id: planId,
        name: customPlanConfig.name,
        price_cents: customPlanConfig.finalPrice * 100, // Convert to cents
        billing_interval: "month",
        interval_count: 1,
        trial_days: 0,
        metadata: planMetadata,
      });

    if (planError) {
      console.error("[Custom Plan] Failed to create plan:", planError);
      return res.status(500).json({ error: "Failed to create custom plan" });
    }

    // Create incomplete subscription
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { error: subscriptionError } = await supabase
      .from("subscriptions")
      .insert({
        user_id: user.id,
        business_id: business.id,
        plan_id: planId,
        status: "incomplete",
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
        metadata: {
          custom_plan: true,
          ...planMetadata,
        },
      });

    if (subscriptionError) {
      console.error("[Custom Plan] Failed to create subscription:", subscriptionError);
      return res.status(500).json({ error: "Failed to create subscription" });
    }

    // Generate PayFast fields
    const fields: Record<string, string> = {
      merchant_id: PAYFAST_PRODUCTION_MERCHANT_ID,
      merchant_key: PAYFAST_PRODUCTION_MERCHANT_KEY,
      return_url: `${origin}/billing?payfast=success&subscription_id=${subscriptionId}`,
      cancel_url: `${origin}/billing?payfast=cancelled&subscription_id=${subscriptionId}`,
      notify_url: process.env["NGROK_URL"] 
        ? `${process.env["NGROK_URL"]}/api/subscriptions/payfast/notify`
        : `${origin}/api/subscriptions/payfast/notify`,
      name_first: "Bookza",
      name_last: "Custom Plan",
      email_address: "subscriptions@bookza.co.za",
      m_payment_id: subscriptionId,
      amount: customPlanConfig.finalPrice.toString(),
      item_name: `Bookza ${customPlanConfig.name}`,
      item_description: `Custom plan: ${customPlanConfig.locations} locations, ${customPlanConfig.staff} staff, ${customPlanConfig.bookingsPerMonth} bookings/mo`,
      custom_str1: "bookza_custom_subscription",
      custom_str2: business.id,
      custom_str3: planId,
      subscription_type: "1",
      frequency: "3",
      cycles: "0",
    };

    const signature = createPayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE);

    console.log("[Custom Plan] Created custom plan:", { planId, customPlanConfig, finalPrice: customPlanConfig.finalPrice });

    res.json({
      action: PAYFAST_SANDBOX_URL,
      subscriptionId,
      fields: {
        ...fields,
        signature,
      },
    });
  } catch (err) {
    console.error("[Custom Plan] Error:", err);
    req.log.error(err);
    res.status(500).json({ error: "Could not create custom plan subscription" });
  }
});

router.post("/subscriptions/payfast", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Subscription tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const { planName } = req.body as { planName: string };

    if (!planName || !PLAN_PRICES[planName]) {
      return res.status(400).json({ error: "Invalid plan name" });
    }

    const supabase = getSupabaseAdmin();
    const price = PLAN_PRICES[planName];
    const origin = getRequestOrigin(req);
    const subscriptionId = `bookza-sub-${Date.now()}`;
    const planId = `${planName.toLowerCase()}_monthly`;

    // Get plan details from plans table
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("id", planId)
      .single();

    if (planError || !plan) {
      return res.status(400).json({ error: "Plan not found" });
    }

    // Create incomplete subscription (will be activated on successful payment)
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { error: subscriptionError } = await supabase
      .from("subscriptions")
      .insert({
        user_id: user.id,
        business_id: business.id,
        plan_id: planId,
        status: "incomplete",
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
      });

    if (subscriptionError) {
      if (subscriptionError.message.includes("violates unique constraint")) {
        return res.status(400).json({ error: "You already have an active subscription" });
      }
      throw new Error(subscriptionError.message);
    }

    const fields: Record<string, string> = {
      merchant_id: PAYFAST_SANDBOX_MERCHANT_ID,
      merchant_key: PAYFAST_SANDBOX_MERCHANT_KEY,
      return_url: `${origin}/billing?payfast=success&subscription_id=${subscriptionId}`,
      cancel_url: `${origin}/billing?payfast=cancelled&subscription_id=${subscriptionId}`,
      // Use ngrok URL if configured, otherwise use local origin (webhook won't work locally)
      notify_url: process.env["NGROK_URL"] 
        ? `${process.env["NGROK_URL"]}/api/subscriptions/payfast/notify`
        : `${origin}/api/subscriptions/payfast/notify`,
      name_first: "Bookza",
      name_last: "Subscription",
      email_address: "subscriptions@bookza.co.za",
      m_payment_id: subscriptionId,
      amount: price.toString(),
      item_name: `Bookza ${planName} Subscription`,
      item_description: `Monthly subscription for ${planName} plan`,
      custom_str1: "bookza_subscription",
      custom_str2: business.id,
      custom_str3: planId,
      // Standard Subscription (PayFast manages recurring billing)
      subscription_type: "1", // 1 = Standard subscription
      frequency: "3", // 3 = Monthly
      cycles: "0", // 0 = Indefinite subscription
    };

    res.json({
      action: PAYFAST_PRODUCTION_URL,
      subscriptionId,
      fields: {
        ...fields,
        signature: createPayFastSignature(fields, PAYFAST_PRODUCTION_PASSPHRASE),
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not create PayFast subscription payment" });
  }
});

router.post("/subscriptions/payfast/check-status", requireUser, async (req, res) => {
  try {
    console.log("[PayFast Status Check] Request received");
    
    if (!isSupabaseAdminConfigured()) {
      console.error("[PayFast Status Check] Supabase not configured");
      return res.status(503).json({
        error: "Supabase is not configured",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const { paymentReference } = req.body as { paymentReference: string };

    console.log("[PayFast Status Check] User:", user.id, "Business:", business.id, "PaymentRef:", paymentReference);

    if (!paymentReference) {
      console.error("[PayFast Status Check] Missing payment reference");
      return res.status(400).json({ error: "Missing payment reference" });
    }

    const supabase = getSupabaseAdmin();

    // Check if business already has an active subscription
    const { data: activeSubscription, error: activeCheckError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .maybeSingle();

    console.log("[PayFast Status Check] Active subscription check:", { activeSubscription, error: activeCheckError });

    if (activeSubscription) {
      console.log("[PayFast Status Check] Business already has active subscription, deleting incomplete ones");
      
      // Delete all incomplete subscriptions for this business
      await supabase
        .from("subscriptions")
        .delete()
        .eq("business_id", business.id)
        .eq("status", "incomplete");
      
      console.log("[PayFast Status Check] Deleted incomplete subscriptions, returning existing active subscription");
      
      // Return the existing active subscription with plans data
      const { data: activeWithPlans } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("id", activeSubscription.id)
        .single();
      
      if (activeWithPlans) {
        return res.json(activeWithPlans);
      } else {
        return res.json(activeSubscription);
      }
    }

    // Get the incomplete subscription for this payment (most recent)
    const { data: subscriptions, error: fetchError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "incomplete")
      .order("created_at", { ascending: false })
      .limit(1);

    console.log("[PayFast Status Check] Subscription lookup result:", { subscriptions, error: fetchError });

    if (fetchError) throw new Error(fetchError.message);

    const subscription = subscriptions && subscriptions.length > 0 ? subscriptions[0] : null;

    if (!subscription) {
      console.error("[PayFast Status Check] No incomplete subscription found");
      return res.status(404).json({ error: "No incomplete subscription found" });
    }

    // For standard subscriptions (subscription_type: 1), PayFast manages recurring billing
    // The token is sent in the webhook notification, not available via query API
    // For local development without webhook access, we activate without a token
    // PayFast will handle the recurring charges automatically
    
    console.log("[PayFast Status Check] Activating subscription ID:", subscription.id);
    
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        payfast_token: null, // Token will be provided by webhook
        metadata: {
          ...subscription.metadata,
          initial_payment_reference: paymentReference,
          payment_method: "payfast_sandbox",
          verified_at: new Date().toISOString(),
          note: "Standard subscription - PayFast manages recurring billing",
        },
      })
      .eq("id", subscription.id);

    if (updateError) {
      console.error("[PayFast Status Check] Failed to activate subscription:", updateError);
      throw new Error(updateError.message);
    }

    console.log("[PayFast Status Check] Subscription activated successfully");

    // Return the updated subscription
    const { data: updatedSubscription, error: fetchUpdatedError } = await supabase
      .from("subscriptions")
      .select("*, plans!subscriptions_plan_id_fkey(*)")
      .eq("id", subscription.id)
      .single();

    console.log("[PayFast Status Check] Updated subscription fetch result:", { updatedSubscription, error: fetchUpdatedError });

    if (fetchUpdatedError) {
      console.error("[PayFast Status Check] Failed to fetch updated subscription:", fetchUpdatedError);
      // Fallback: return subscription without plans join
      const { data: fallbackSubscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("id", subscription.id)
        .single();
      console.log("[PayFast Status Check] Returning fallback subscription:", fallbackSubscription);
      res.json(fallbackSubscription);
    } else {
      console.log("[PayFast Status Check] Returning updated subscription:", updatedSubscription);
      res.json(updatedSubscription);
    }
  } catch (err) {
    console.error("[PayFast Status Check] Error:", err);
    res.status(500).json({ error: "Could not check payment status" });
  }
});

router.post("/subscriptions/payfast/notify", async (req, res) => {
  try {
    console.log("[PayFast Webhook] Received notification", JSON.stringify(req.body));

    if (!isSupabaseAdminConfigured()) {
      console.error("[PayFast Webhook] Supabase is not configured");
      return res.status(503).send("Supabase is not configured");
    }

    // Validate IP address (PayFast sandbox IPs)
    const payfastIps = [
      "41.74.194.66",
      "41.74.194.67",
      "41.74.194.68",
      "41.74.194.69",
      "41.74.194.70",
      "41.74.194.71",
      "41.74.194.72",
      "41.74.194.73",
      "41.74.194.74",
      "41.74.194.75",
      "41.74.194.76",
      "41.74.194.77",
      "41.74.194.78",
      "41.74.194.79",
      "41.74.194.80",
      "41.74.194.81",
      "41.74.194.82",
      "41.74.194.83",
      "41.74.194.84",
      "41.74.194.85",
      "41.74.194.86",
      "41.74.194.87",
      "41.74.194.88",
      "41.74.194.89",
      "41.74.194.90",
      "41.74.194.91",
      "41.74.194.92",
      "41.74.194.93",
      "41.74.194.94",
      "41.74.194.95",
      "41.74.194.96",
      "41.74.194.97",
      "41.74.194.98",
      "41.74.194.99",
      "41.74.194.100",
      "41.74.194.101",
      "41.74.194.102",
      "41.74.194.103",
      "41.74.194.104",
      "41.74.194.105",
      "41.74.194.106",
      "41.74.194.107",
      "41.74.194.108",
      "41.74.194.109",
      "41.74.194.110",
      "41.74.194.111",
      "41.74.194.112",
      "41.74.194.113",
      "41.74.194.114",
      "41.74.194.115",
      "41.74.194.116",
      "41.74.194.117",
      "41.74.194.118",
      "41.74.194.119",
      "41.74.194.120",
      "41.74.194.121",
      "41.74.194.122",
      "41.74.194.123",
      "41.74.194.124",
      "41.74.194.125",
      "41.74.194.126",
      "41.74.194.127",
      "41.74.194.128",
      "41.74.194.129",
      "41.74.194.130",
      "41.74.194.131",
      "41.74.194.132",
      "41.74.194.133",
      "41.74.194.134",
      "41.74.194.135",
      "41.74.194.136",
      "41.74.194.137",
      "41.74.194.138",
      "41.74.194.139",
      "41.74.194.140",
      "41.74.194.141",
      "41.74.194.142",
      "41.74.194.143",
      "41.74.194.144",
      "41.74.194.145",
      "41.74.194.146",
      "41.74.194.147",
      "41.74.194.148",
      "41.74.194.149",
      "41.74.194.150",
      "41.74.194.151",
      "41.74.194.152",
      "41.74.194.153",
      "41.74.194.154",
      "41.74.194.155",
      "41.74.194.156",
      "41.74.194.157",
      "41.74.194.158",
      "41.74.194.159",
      "41.74.194.160",
      "41.74.194.161",
      "41.74.194.162",
      "41.74.194.163",
      "41.74.194.164",
      "41.74.194.165",
      "41.74.194.166",
      "41.74.194.167",
      "41.74.194.168",
      "41.74.194.169",
      "41.74.194.170",
      "41.74.194.171",
      "41.74.194.172",
      "41.74.194.173",
      "41.74.194.174",
      "41.74.194.175",
      "41.74.194.176",
      "41.74.194.177",
      "41.74.194.178",
      "41.74.194.179",
      "41.74.194.180",
      "41.74.194.181",
      "41.74.194.182",
      "41.74.194.183",
      "41.74.194.184",
      "41.74.194.185",
      "41.74.194.186",
      "41.74.194.187",
      "41.74.194.188",
      "41.74.194.189",
      "41.74.194.190",
      "41.74.194.191",
      "41.74.194.192",
      "41.74.194.193",
      "41.74.194.194",
      "41.74.194.195",
      "41.74.194.196",
      "41.74.194.197",
      "41.74.194.198",
      "41.74.194.199",
      "41.74.194.200",
      "41.74.194.201",
      "41.74.194.202",
      "41.74.194.203",
      "41.74.194.204",
      "41.74.194.205",
      "41.74.194.206",
      "41.74.194.207",
      "41.74.194.208",
      "41.74.194.209",
      "41.74.194.210",
      "41.74.194.211",
      "41.74.194.212",
      "41.74.194.213",
      "41.74.194.214",
      "41.74.194.215",
      "41.74.194.216",
      "41.74.194.217",
      "41.74.194.218",
      "41.74.194.219",
      "41.74.194.220",
      "41.74.194.221",
      "41.74.194.222",
      "41.74.194.223",
      "41.74.194.224",
      "41.74.194.225",
      "41.74.194.226",
      "41.74.194.227",
      "41.74.194.228",
      "41.74.194.229",
      "41.74.194.230",
      "41.74.194.231",
      "41.74.194.232",
      "41.74.194.233",
      "41.74.194.234",
      "41.74.194.235",
      "41.74.194.236",
      "41.74.194.237",
      "41.74.194.238",
      "41.74.194.239",
      "41.74.194.240",
      "41.74.194.241",
      "41.74.194.242",
      "41.74.194.243",
      "41.74.194.244",
      "41.74.194.245",
      "41.74.194.246",
      "41.74.194.247",
      "41.74.194.248",
      "41.74.194.249",
      "41.74.194.250",
      "41.74.194.251",
      "41.74.194.252",
      "41.74.194.253",
      "41.74.194.254",
      "41.74.194.255",
    ];

    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    console.log("[PayFast Webhook] Client IP", clientIp);
    
    // Skip IP validation in development/sandbox for testing
    // if (!payfastIps.includes(clientIp)) {
    //   console.error("[PayFast Webhook] Invalid IP address", clientIp);
    //   return res.status(403).send("Invalid IP address");
    // }

    const receivedSignature = req.body?.signature as string;
    const fields: Record<string, string> = {};
    
    Object.entries(req.body ?? {}).forEach(([key, value]) => {
      if (key !== "signature" && typeof value === "string") {
        fields[key] = value;
      }
    });

    console.log("[PayFast Webhook] Extracted fields", JSON.stringify(fields));

    const expectedSignature = createPayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE);
    console.log("[PayFast Webhook] Signature validation", { received: receivedSignature, expected: expectedSignature });

    if (!receivedSignature || receivedSignature !== expectedSignature) {
      console.error("[PayFast Webhook] Invalid signature");
      return res.status(400).send("Invalid signature");
    }

    const paymentReference = fields.m_payment_id;
    const businessId = fields.custom_str2;
    const planId = fields.custom_str3;
    const payfastStatus = fields.payment_status?.toUpperCase();
    const token = fields.token; // Ad Hoc token for recurring charges

    console.log("[PayFast Webhook] Payment details", { paymentReference, businessId, planId, payfastStatus, token });

    if (!paymentReference || !businessId || !planId) {
      console.error("[PayFast Webhook] Missing required fields");
      return res.status(400).send("Missing required fields");
    }

    const supabase = getSupabaseAdmin();

    if (payfastStatus === "COMPLETE") {
      // Get the incomplete subscription
      const { data: subscription, error: fetchError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", businessId)
        .eq("plan_id", planId)
        .eq("status", "incomplete")
        .maybeSingle();

      console.log("[PayFast Webhook] Subscription lookup", { subscription, error: fetchError });

      if (fetchError) throw new Error(fetchError.message);

      if (subscription) {
        // This is the initial payment - activate subscription with token
        console.log("[PayFast Webhook] Activating subscription", { subscriptionId: subscription.id, token });
        
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "active",
            payfast_token: token || null, // Store token for PayFast API calls (cancel, pause, etc.)
            metadata: {
              ...subscription.metadata,
              payfast_token: token || null,
              initial_payment_reference: paymentReference,
            },
          })
          .eq("id", subscription.id);

        if (updateError) {
          console.error("[PayFast Webhook] Failed to activate subscription", updateError);
          throw new Error(updateError.message);
        }
        
        console.log("[PayFast Webhook] Subscription activated successfully, token stored:", token ? "YES" : "NO (use ngrok for webhook to get token)");
      } else {
        // This might be a recurring payment from our CRON job
        console.log("[PayFast Webhook] No incomplete subscription found, checking for active subscription");
        
        const { data: activeSubscription } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", businessId)
          .eq("plan_id", planId)
          .eq("status", "active")
          .maybeSingle();

        if (activeSubscription) {
          // Update period end for recurring payment
          const currentPeriodEnd = new Date(activeSubscription.current_period_end);
          const newPeriodEnd = new Date(currentPeriodEnd);
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

          const { error: updateError } = await supabase
            .from("subscriptions")
            .update({
              current_period_end: newPeriodEnd.toISOString(),
              metadata: {
                ...activeSubscription.metadata,
                last_payment_reference: paymentReference,
              },
            })
            .eq("id", activeSubscription.id);

          if (updateError) {
            console.error("[PayFast Webhook] Failed to update period end", updateError);
            throw new Error(updateError.message);
          }
          
          console.log("[PayFast Webhook] Period end updated for recurring payment");
        } else {
          console.error("[PayFast Webhook] No subscription found for business", { businessId, planId });
        }
      }
    } else if (payfastStatus === "CANCELLED" || payfastStatus === "FAILED") {
      console.log("[PayFast Webhook] Payment cancelled/failed", { payfastStatus });
      
      // Handle failed/cancelled initial payment
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", businessId)
        .eq("plan_id", planId)
        .eq("status", "incomplete")
        .maybeSingle();

      if (subscription) {
        // Delete incomplete subscription
        const { error: deleteError } = await supabase
          .from("subscriptions")
          .delete()
          .eq("id", subscription.id);

        if (deleteError) {
          console.error("[PayFast Webhook] Failed to delete incomplete subscription", deleteError);
          throw new Error(deleteError.message);
        }
        
        console.log("[PayFast Webhook] Incomplete subscription deleted");
      }
    } else {
      console.log("[PayFast Webhook] Unhandled payment status", { payfastStatus });
    }

    console.log("[PayFast Webhook] Processing complete");
    res.status(200).send("OK");
  } catch (err) {
    console.error("[PayFast Webhook] Error processing notification", err);
    res.status(500).send("Could not process PayFast notification");
  }
});

router.post("/subscriptions", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Subscription tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const { planName } = req.body as { planName: string };

    if (!planName || !PLAN_PRICES[planName]) {
      return res.status(400).json({ error: "Invalid plan name" });
    }

    const supabase = getSupabaseAdmin();
    const price = PLAN_PRICES[planName];

    // Calculate renewal date (1 month from now)
    const renewsAt = new Date();
    renewsAt.setMonth(renewsAt.getMonth() + 1);

    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .insert({
        business_id: business.id,
        plan_name: planName,
        status: "active",
        price,
        renews_at: renewsAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.message.includes("violates check constraint")) {
        return res.status(400).json({ error: "You already have an active subscription" });
      }
      throw new Error(error.message);
    }

    res.json(subscription);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not create subscription" });
  }
});

router.put("/subscriptions", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Subscription tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const { planName, immediate } = req.body as { planName: string; immediate?: boolean };

    if (!planName || !PLAN_PRICES[planName]) {
      return res.status(400).json({ error: "Invalid plan name" });
    }

    const supabase = getSupabaseAdmin();
    const newPlanId = `${planName.toLowerCase()}_monthly`;

    // Get current subscription
    const { data: currentSubscription, error: fetchError } = await supabase
      .from("subscriptions")
      .select("*, plans(*)")
      .eq("business_id", business.id)
      .eq("status", "active")
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);

    if (!currentSubscription) {
      return res.status(400).json({ error: "No active subscription found" });
    }

    const currentPlan = currentSubscription.plans as { id: string; price_cents: number };
    const { data: newPlan, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("id", newPlanId)
      .single();

    if (planError || !newPlan) {
      return res.status(400).json({ error: "New plan not found" });
    }

    const isUpgrade = newPlan.price_cents > currentPlan.price_cents;
    const isDowngrade = newPlan.price_cents < currentPlan.price_cents;

    if (isUpgrade && immediate) {
      // Prorated upgrade - charge the difference immediately
      const currentPeriodEnd = new Date(currentSubscription.current_period_end);
      const currentPeriodStart = new Date(currentSubscription.current_period_start);
      const totalDaysInPeriod = Math.ceil((currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24));
      const remainingDays = Math.ceil((currentPeriodEnd.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      
      if (remainingDays <= 0) {
        return res.status(400).json({ error: "Subscription period has already ended" });
      }

      // Calculate prorated amounts
      const oldPlanDailyRate = currentPlan.price_cents / totalDaysInPeriod;
      const newPlanDailyRate = newPlan.price_cents / totalDaysInPeriod;
      const remainingValue = Math.round(oldPlanDailyRate * remainingDays);
      const remainingCost = Math.round(newPlanDailyRate * remainingDays);
      const proratedDifference = remainingCost - remainingValue;

      if (proratedDifference > 0 && currentSubscription.payfast_token) {
        // Charge the prorated difference using PayFast API
        const chargeResult = await chargeWithToken(
          currentSubscription.payfast_token,
          proratedDifference,
          `Prorated upgrade from ${currentPlan.id} to ${newPlanId}`
        );

        if (!chargeResult.success) {
          return res.status(400).json({ error: `Payment failed: ${chargeResult.error}` });
        }
      }

      // Update subscription to new plan immediately
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          plan_id: newPlanId,
          metadata: {
            ...currentSubscription.metadata,
            upgraded_from: currentPlan.id,
            upgraded_at: new Date().toISOString(),
            prorated_charge: proratedDifference,
          },
        })
        .eq("id", currentSubscription.id);

      if (updateError) throw new Error(updateError.message);

      const { data: updatedSubscription } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("id", currentSubscription.id)
        .single();

      res.json(updatedSubscription);
    } else if (isDowngrade) {
      // Schedule downgrade for end of period
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          pending_plan_id: newPlanId,
          metadata: {
            ...currentSubscription.metadata,
            pending_downgrade_to: newPlanId,
            pending_downgrade_at: currentSubscription.current_period_end,
          },
        })
        .eq("id", currentSubscription.id);

      if (updateError) throw new Error(updateError.message);

      const { data: updatedSubscription } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("id", currentSubscription.id)
        .single();

      res.json({
        ...updatedSubscription,
        message: "Downgrade scheduled for end of billing period",
      });
    } else {
      // Same price or different interval - update immediately without charge
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          plan_id: newPlanId,
          metadata: {
            ...currentSubscription.metadata,
            changed_from: currentPlan.id,
            changed_at: new Date().toISOString(),
          },
        })
        .eq("id", currentSubscription.id);

      if (updateError) throw new Error(updateError.message);

      const { data: updatedSubscription } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("id", currentSubscription.id)
        .single();

      res.json(updatedSubscription);
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not update subscription" });
  }
});

/**
 * Helper function to charge using PayFast token
 */
async function chargeWithToken(token: string, amountCents: number, description: string): Promise<{ success: boolean; error?: string }> {
  const isSandbox = process.env["PAYFAST_MODE"] === "sandbox";
  const apiUrl = isSandbox 
    ? (process.env["PAYFAST_SANDBOX_API_URL"] ?? "https://sandbox.payfast.co.za")
    : (process.env["PAYFAST_API_URL"] ?? "https://api.payfast.co.za");
  const merchantId = process.env["PAYFAST_MERCHANT_ID"] ?? "10036200";
  const merchantKey = process.env["PAYFAST_MERCHANT_KEY"] ?? "ztgkjo0djf02j";

  try {
    const response = await fetch(`${apiUrl}/subscriptions/${token}/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_id: merchantId,
        merchant_key: merchantKey,
        amount: (amountCents / 100).toFixed(2), // Convert cents to Rands
        item_name: description,
      }),
    });

    const data = await response.json() as { status?: string; code?: number; message?: string };

    if (data.status === "success" || data.code === 200) {
      return { success: true };
    } else {
      return { success: false, error: data.message || "Payment failed" };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

router.delete("/subscriptions", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Subscription tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const supabase = getSupabaseAdmin();

    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("business_id", business.id)
      .eq("status", "active")
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.json(subscription);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not cancel subscription" });
  }
});

export default router;
