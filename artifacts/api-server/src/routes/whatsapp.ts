import { Router, type Response } from "express";
import { store } from "../data/store";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import {
  ensureTenantForUser,
  ensureTenantClient,
  formatWhatsappStatusResponse,
  getLiveWhatsappSession,
  listTenantChats,
  listTenantMessages,
  getConversationIdFromRemoteJid,
  markTenantConversationRead,
  resetWhatsappSession,
  resolveRemoteJidFromPhone,
  sendTenantMessage,
  sendTenantMessageByPhone,
  sendTenantMessageByRemoteJid,
  startTenantSocket,
  waitForQrOrConnection,
} from "../lib/whatsapp";
import { waitForSafeOutboundSend } from "../lib/whatsapp-send-safety";
import {
  WhatsAppAntiFingerprintSender,
  parseSpintax,
  simulateTyping,
  humanPause,
  RecipientRateLimiter,
} from "../lib/whatsapp-anti-fingerprint";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { getGlobalScheduler } from "../lib/campaign-scheduler";
import { WarmUpManager } from "../lib/warmup-manager";
import { ABTestManager } from "../lib/ab-test-manager";
import { EngagementTracker } from "../lib/engagement-tracker";
import { getGlobalVerifier } from "../lib/whatsapp-verification";
import {
  buildBookingAiContext,
  executeAssistantAction,
  fetchBotSettingsForBusiness,
  findClientByPhoneForBusiness,
  currentBusinessTime,
  getConfirmationReply,
  getDecisionAndReply,
  isWithinWorkingHours,
  normalizePhoneLikeValue,
  type GroqMessage,
} from "../lib/whatsapp-ai";
import { recordActivity } from "../lib/activity";

const router = Router();

function setNoStoreHeaders(res: Response): void {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
}

function getFallbackTenantName(req: AuthenticatedRequest): string {
  const businessName = req.user.user_metadata?.["business_name"];
  const fullName = req.user.user_metadata?.["full_name"];
  return (
    (typeof businessName === "string" && businessName.trim()) ||
    (typeof fullName === "string" && fullName.trim()) ||
    req.user.email ||
    "Tenant"
  );
}

async function getConnectedTenantForRequest(req: AuthenticatedRequest) {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }

  const tenant = await ensureTenantForUser(req.user.id, getFallbackTenantName(req));
  const session = await getLiveWhatsappSession(tenant.id);

  if (session?.status !== "connected") {
    return null;
  }

  const client = await ensureTenantClient(tenant.id);
  if (!client) {
    return null;
  }

  return tenant;
}

async function getBusinessForUser(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

async function getMetaWhatsappConnection(businessId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("meta_whatsapp_connections")
    .select("phone_number_id, whatsapp_business_account_id, access_token")
    .eq("business_id", businessId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as { phone_number_id: string; whatsapp_business_account_id: string; access_token: string } | null;
}

type WhatsappAiDraftRow = {
  id: string;
  business_id: string;
  tenant_id: string | null;
  remote_jid: string;
  client_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  inbound_message_text: string;
  suggested_reply: string;
  decision_json: Record<string, unknown>;
  proposed_actions: Array<Record<string, unknown>>;
  status: string;
  created_at: string;
};

function mapWhatsappAiDraft(row: WhatsappAiDraftRow) {
  return {
    id: row.id,
    remoteJid: row.remote_jid,
    clientId: row.client_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    inboundMessageText: row.inbound_message_text,
    suggestedReply: row.suggested_reply,
    decision: row.decision_json,
    proposedActions: row.proposed_actions ?? [],
    status: row.status,
    createdAt: row.created_at,
  };
}

router.post("/whatsapp/connect", requireUser, async (req, res) => {
  try {
    setNoStoreHeaders(res);

    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "WhatsApp setup is incomplete. Add SUPABASE_SERVICE_ROLE_KEY to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const tenant = await ensureTenantForUser(user.id, getFallbackTenantName(req as AuthenticatedRequest));

    const currentSession = await getLiveWhatsappSession(tenant.id);
    if (currentSession?.status === "connected") {
      return res.json(formatWhatsappStatusResponse(currentSession));
    }

    if (currentSession?.status === "qrcode") {
      return res.json(formatWhatsappStatusResponse(currentSession));
    }

    void startTenantSocket(tenant.id).catch((error) => {
      req.log.error(error);
    });

    const session = await waitForQrOrConnection(tenant.id, 8000).catch(async () => {
      return getLiveWhatsappSession(tenant.id);
    });

    return res.json(formatWhatsappStatusResponse(session));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not create WhatsApp connection",
    });
  }
});

router.get("/whatsapp/status", requireUser, async (req, res) => {
  try {
    setNoStoreHeaders(res);

    if (!isSupabaseAdminConfigured()) {
      return res.json(formatWhatsappStatusResponse(null));
    }

    const user = (req as AuthenticatedRequest).user;
    const tenant = await ensureTenantForUser(user.id, getFallbackTenantName(req as AuthenticatedRequest));
    const session = await getLiveWhatsappSession(tenant.id);
    return res.json(formatWhatsappStatusResponse(session));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not fetch WhatsApp status",
    });
  }
});

router.post("/whatsapp/disconnect", requireUser, async (req, res) => {
  try {
    setNoStoreHeaders(res);

    if (!isSupabaseAdminConfigured()) {
      return res.json(formatWhatsappStatusResponse(null));
    }

    const user = (req as AuthenticatedRequest).user;
    const tenant = await ensureTenantForUser(user.id, getFallbackTenantName(req as AuthenticatedRequest));
    await resetWhatsappSession(tenant.id);
    const session = await getLiveWhatsappSession(tenant.id);
    return res.json(formatWhatsappStatusResponse(session));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not disconnect WhatsApp",
    });
  }
});

router.post("/webhooks/whatsapp", async (req, res) => {
  res.status(410).json({
    error: "Webhook endpoint is not used in the Baileys-based WhatsApp setup.",
  });
});

router.post("/whatsapp/ai-preview", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const senderName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const historyInput = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const normalizedPhone = normalizePhoneLikeValue(phone || "27000000000");
    const botConfig = await fetchBotSettingsForBusiness(business.id);
    const settings = botConfig.settings;
    if (!settings) {
      return res.status(404).json({ error: "WhatsApp AI bot settings not found" });
    }

    const clientProfile = phone
      ? await findClientByPhoneForBusiness(business.id, normalizedPhone)
      : null;
    const clientName = clientProfile?.name || senderName || "there";
    const withinHours = isWithinWorkingHours(botConfig.workingHours, settings.always_on);

    const { businessContext, aiData, workingHoursText } = await buildBookingAiContext(
      business.id,
      clientProfile,
      senderName,
    );

    const safeHistory: GroqMessage[] = historyInput
      .slice(-10)
      .map((entry: unknown) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const role = row["role"] === "assistant" ? "assistant" : "user";
        const content = typeof row["content"] === "string" ? row["content"].trim() : "";
        return content ? ({ role, content } as GroqMessage) : null;
      })
      .filter((entry: GroqMessage | null): entry is GroqMessage => Boolean(entry));

    const history: GroqMessage[] = [
      ...safeHistory,
      { role: "user", content: message.slice(0, 1000) },
    ];

    const promptSettings = {
      bot_name: settings.bot_name,
      tone: settings.tone,
      welcome_message: settings.welcome_message,
      fallback_message: settings.fallback_message,
      auto_confirm: settings.auto_confirm,
      accept_cancellations: settings.accept_cancellations,
      cancellation_min_notice_hours: settings.cancellation_min_notice_hours ?? 24,
      cancellation_decline_message: settings.cancellation_decline_message ?? "",
      accept_reschedules: settings.accept_reschedules ?? true,
      reschedule_min_notice_hours: settings.reschedule_min_notice_hours ?? 24,
      reschedule_decline_message: settings.reschedule_decline_message ?? "",
      send_payment_links: settings.send_payment_links,
      answer_faqs: settings.answer_faqs,
      working_hours: workingHoursText,
      always_on: settings.always_on,
      client_name: clientName,
      client_id: clientProfile?.id ?? null,
      is_first_message: safeHistory.length === 0,
      within_business_hours: withinHours,
      current_time: currentBusinessTime(),
      action_summary: undefined,
    };

    const { decision, reply } = await getDecisionAndReply(
      history,
      businessContext,
      promptSettings,
      aiData,
      `preview:${user.id}`,
    );

    return res.json({
      suggestedReply: reply,
      decision,
      proposedActions: decision.actions,
      missingFields: decision.missing_fields,
      needsHuman: decision.needs_human,
      confidence: decision.confidence,
      client: clientProfile
        ? {
            id: clientProfile.id,
            name: clientProfile.name,
            phone: clientProfile.phone,
            clientType: clientProfile.client_type,
          }
        : null,
      mode: settings.review_mode ?? "auto",
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not generate AI preview",
    });
  }
});

router.get("/whatsapp/ai-drafts", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.json({ drafts: [] });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!business) {
      return res.json({ drafts: [] });
    }

    const requestedLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
      : 25;

    const { data, error } = await getSupabaseAdmin()
      .from("whatsapp_ai_drafts")
      .select("*")
      .eq("business_id", business.id)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return res.json({
      drafts: ((data ?? []) as WhatsappAiDraftRow[]).map(mapWhatsappAiDraft),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not load AI drafts" });
  }
});

router.post("/whatsapp/ai-drafts/:id/dismiss", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("whatsapp_ai_drafts")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("business_id", business.id)
      .in("status", ["pending", "approved"])
      .select("*")
      .maybeSingle<WhatsappAiDraftRow>();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      return res.status(404).json({ error: "Draft not found" });
    }

    await recordActivity({
      businessId: business.id,
      actorType: "user",
      actorId: user.id,
      entityType: "whatsapp_ai_draft",
      entityId: data.id,
      eventType: "ai_reply_dismissed",
      title: "AI draft dismissed",
      description: data.suggested_reply,
      metadata: {
        phone: data.client_phone,
        clientName: data.client_name,
        remoteJid: data.remote_jid,
      },
    });

    return res.json({ draft: mapWhatsappAiDraft(data) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not dismiss draft" });
  }
});

router.post("/whatsapp/ai-drafts/:id/approve", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const tenant = await getConnectedTenantForRequest(req as AuthenticatedRequest);
    if (!tenant) {
      return res.status(409).json({ error: "WhatsApp is not connected" });
    }

    const { data: claimedDraft, error: claimError } = await getSupabaseAdmin()
      .from("whatsapp_ai_drafts")
      .select("*")
      .eq("id", req.params.id)
      .eq("business_id", business.id)
      .in("status", ["pending", "approved"])
      .maybeSingle<WhatsappAiDraftRow>();

    if (claimError) {
      throw new Error(claimError.message);
    }
    if (!claimedDraft) {
      return res.status(404).json({ error: "Draft not found" });
    }

    const phone = normalizePhoneLikeValue(claimedDraft.client_phone || claimedDraft.remote_jid);
    if (!phone) {
      throw new Error("Draft does not include a valid WhatsApp number");
    }

    const botConfig = await fetchBotSettingsForBusiness(business.id);
    const settings = botConfig.settings;
    if (!settings) {
      throw new Error("WhatsApp AI bot settings not found");
    }

    const clientProfile = claimedDraft.client_id
      ? null
      : await findClientByPhoneForBusiness(business.id, phone);
    const clientName =
      claimedDraft.client_name ||
      clientProfile?.name ||
      "there";
    const withinHours = isWithinWorkingHours(botConfig.workingHours, settings.always_on);

    const { businessContext, aiData, workingHoursText } = await buildBookingAiContext(
      business.id,
      clientProfile,
      clientName,
    );

    const promptSettings = {
      bot_name: settings.bot_name,
      tone: settings.tone,
      welcome_message: settings.welcome_message,
      fallback_message: settings.fallback_message,
      auto_confirm: settings.auto_confirm,
      accept_cancellations: settings.accept_cancellations,
      cancellation_min_notice_hours: settings.cancellation_min_notice_hours ?? 24,
      cancellation_decline_message: settings.cancellation_decline_message ?? "",
      accept_reschedules: settings.accept_reschedules ?? true,
      reschedule_min_notice_hours: settings.reschedule_min_notice_hours ?? 24,
      reschedule_decline_message: settings.reschedule_decline_message ?? "",
      send_payment_links: settings.send_payment_links,
      answer_faqs: settings.answer_faqs,
      working_hours: workingHoursText,
      always_on: settings.always_on,
      client_name: clientName,
      client_id: claimedDraft.client_id ?? clientProfile?.id ?? null,
      is_first_message: false,
      within_business_hours: withinHours,
      current_time: currentBusinessTime(),
      action_summary: undefined,
    };

    const decision = claimedDraft.decision_json as Parameters<typeof executeAssistantAction>[0]["decision"];
    const actionResult = await executeAssistantAction({
      businessId: business.id,
      phone,
      fallbackClientName: clientName,
      settings: promptSettings,
      aiData,
      decision,
    });

    let replyToSend = claimedDraft.suggested_reply;
    if (actionResult.outcome !== "none") {
      replyToSend = await getConfirmationReply(
        [{ role: "user", content: claimedDraft.inbound_message_text }],
        businessContext,
        promptSettings,
        aiData,
        `approval:${user.id}`,
        actionResult.summary,
      );
    }

    const message = await sendTenantMessageByRemoteJid(
      tenant.id,
      claimedDraft.remote_jid,
      replyToSend,
    );

    const { data: sentDraft, error: sentError } = await getSupabaseAdmin()
      .from("whatsapp_ai_drafts")
      .update({
        status: "sent",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimedDraft.id)
      .in("status", ["pending", "approved"])
      .select("*")
      .single<WhatsappAiDraftRow>();

    if (sentError) {
      throw new Error(sentError.message);
    }

    await recordActivity({
      businessId: business.id,
      actorType: "user",
      actorId: user.id,
      entityType: "whatsapp_ai_draft",
      entityId: claimedDraft.id,
      eventType: "ai_reply_approved",
      title: "AI draft approved and sent",
      description: replyToSend,
      metadata: {
        phone,
        clientName,
        actionOutcome: actionResult.outcome,
        messageId: message.messageId,
      },
    });

    return res.json({
      draft: mapWhatsappAiDraft(sentDraft),
      message,
      actionOutcome: actionResult.outcome,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not approve draft" });
  }
});

router.get("/whatsapp/reminders", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.json({
        reminders_enabled: true,
        reminder_24h_enabled: true,
        reminder_24h_template: 'Hi {client_name}, this is a reminder for your upcoming appointment for {service_name} with {staff_name} on {booking_date} at {booking_time}. See you soon!',
        reminder_2h_enabled: false,
        reminder_2h_template: 'Hi {client_name}, your appointment for {service_name} with {staff_name} starts in 2 hours (at {booking_time}). See you soon!',
        confirmation_enabled: true,
        confirmation_template: 'Hi {client_name}, your booking for {service_name} on {booking_date} at {booking_time} has been confirmed. Thank you!',
        follow_up_enabled: false,
        follow_up_hours: 2,
        follow_up_template: 'Hi {client_name}, thanks for visiting us today! How was your appointment for {service_name}? We would love to hear your feedback!',
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const tenant = await ensureTenantForUser(user.id, getFallbackTenantName(req as AuthenticatedRequest));

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!business) {
      return res.json({
        reminders_enabled: true,
        reminder_24h_enabled: true,
        reminder_24h_template: 'Hi {client_name}, this is a reminder for your upcoming appointment for {service_name} with {staff_name} on {booking_date} at {booking_time}. See you soon!',
        reminder_2h_enabled: false,
        reminder_2h_template: 'Hi {client_name}, your appointment for {service_name} with {staff_name} starts in 2 hours (at {booking_time}). See you soon!',
        confirmation_enabled: true,
        confirmation_template: 'Hi {client_name}, your booking for {service_name} on {booking_date} at {booking_time} has been confirmed. Thank you!',
        follow_up_enabled: false,
        follow_up_hours: 2,
        follow_up_template: 'Hi {client_name}, thanks for visiting us today! How was your appointment for {service_name}? We would love to hear your feedback!',
      });
    }

    const { data: settings } = await getSupabaseAdmin()
      .from("whatsapp_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();

    if (!settings) {
      return res.json({
        reminders_enabled: true,
        reminder_24h_enabled: true,
        reminder_24h_template: 'Hi {client_name}, this is a reminder for your upcoming appointment for {service_name} with {staff_name} on {booking_date} at {booking_time}. See you soon!',
        reminder_2h_enabled: false,
        reminder_2h_template: 'Hi {client_name}, your appointment for {service_name} with {staff_name} starts in 2 hours (at {booking_time}). See you soon!',
        confirmation_enabled: true,
        confirmation_template: 'Hi {client_name}, your booking for {service_name} on {booking_date} at {booking_time} has been confirmed. Thank you!',
        follow_up_enabled: false,
        follow_up_hours: 2,
        follow_up_template: 'Hi {client_name}, thanks for visiting us today! How was your appointment for {service_name}? We would love to hear your feedback!',
      });
    }

    res.json({
      reminders_enabled: settings.reminders_enabled,
      reminder_24h_enabled: settings.reminder_24h_enabled,
      reminder_24h_template: settings.reminder_24h_template,
      reminder_2h_enabled: settings.reminder_2h_enabled,
      reminder_2h_template: settings.reminder_2h_template,
      confirmation_enabled: settings.confirmation_enabled,
      confirmation_template: settings.confirmation_template,
      follow_up_enabled: settings.follow_up_enabled,
      follow_up_hours: settings.follow_up_hours,
      follow_up_template: settings.follow_up_template,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/whatsapp/reminders", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const {
      reminders_enabled,
      reminder_24h_enabled,
      reminder_24h_template,
      reminder_2h_enabled,
      reminder_2h_template,
      confirmation_enabled,
      confirmation_template,
      follow_up_enabled,
      follow_up_hours,
      follow_up_template,
    } = req.body;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const { data: existingSettings } = await getSupabaseAdmin()
      .from("whatsapp_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();

    if (existingSettings) {
      const { error } = await getSupabaseAdmin()
        .from("whatsapp_settings")
        .update({
          reminders_enabled,
          reminder_24h_enabled,
          reminder_24h_template,
          reminder_2h_enabled,
          reminder_2h_template,
          confirmation_enabled,
          confirmation_template,
          follow_up_enabled,
          follow_up_hours,
          follow_up_template,
        })
        .eq("business_id", business.id);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const { error } = await getSupabaseAdmin()
        .from("whatsapp_settings")
        .insert({
          business_id: business.id,
          reminders_enabled,
          reminder_24h_enabled,
          reminder_24h_template,
          reminder_2h_enabled,
          reminder_2h_template,
          confirmation_enabled,
          confirmation_template,
          follow_up_enabled,
          follow_up_hours,
          follow_up_template,
        });

      if (error) {
        throw new Error(error.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/templates", async (req, res) => {
  try {
    const templates = [...store.whatsappTemplates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    res.json(templates.map((t) => ({
      id: t.id, name: t.name, message: t.message, type: t.type, isActive: t.isActive,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/whatsapp/templates", async (req, res) => {
  try {
    const { name, message, type } = req.body;
    const t = {
      id: store.nextId.whatsappTemplate++,
      name,
      message,
      type,
      isActive: true,
      createdAt: new Date(),
    };
    store.whatsappTemplates.push(t);
    res.status(201).json({ id: t.id, name: t.name, message: t.message, type: t.type, isActive: t.isActive });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/whatsapp/templates/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = store.whatsappTemplates.find((x) => x.id === id);
    if (!t) return res.status(404).json({ error: "Not found" });

    if (req.body.name !== undefined) t.name = req.body.name;
    if (req.body.message !== undefined) t.message = req.body.message;
    if (req.body.isActive !== undefined) t.isActive = req.body.isActive;

    res.json({ id: t.id, name: t.name, message: t.message, type: t.type, isActive: t.isActive });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/whatsapp/conversations", requireUser, async (req, res) => {
  try {
    const tenant = await getConnectedTenantForRequest(req as AuthenticatedRequest);
    if (!tenant) {
      return res.json([]);
    }

    const chats = await listTenantChats(tenant.id).catch((err) => {
      req.log.error("[WhatsApp conversations] Failed to list chats:", err);
      return [];
    });
    
    res.json(chats);
  } catch (err) {
    req.log.error(err);
    res.json([]); // Return empty array instead of 500 error for better UX
  }
});

router.get("/whatsapp/conversations/:id/messages", requireUser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const requestedLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500)
      : 25;

    const tenant = await getConnectedTenantForRequest(req as AuthenticatedRequest);
    if (!tenant) {
      return res.json([]);
    }

    res.json(await listTenantMessages(tenant.id, id, limit));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/whatsapp/conversations/:id/messages", requireUser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const content = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const imageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : undefined;
    if (!content && !imageUrl) {
      return res.status(400).json({ error: "Message or image is required" });
    }

    const tenant = await getConnectedTenantForRequest(req as AuthenticatedRequest);
    if (!tenant) {
      return res.status(409).json({ error: "WhatsApp is not connected" });
    }

    res.status(201).json(await sendTenantMessage(tenant.id, id, content, imageUrl));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/contacts/messages", requireUser, async (req, res) => {
  try {
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const content = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const imageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : undefined;
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }
    if (!content && !imageUrl) {
      return res.status(400).json({ error: "Message or image is required" });
    }

    const tenant = await getConnectedTenantForRequest(req as AuthenticatedRequest);
    if (!tenant) {
      return res.status(409).json({ error: "WhatsApp is not connected" });
    }

    const message = await sendTenantMessageByPhone(tenant.id, phone, content, imageUrl);
    res.status(201).json({
      message,
      conversationId: getConversationIdFromRemoteJid(resolveRemoteJidFromPhone(phone)),
    });
  } catch (err) {
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "<unknown>";
    const errorMessage = err instanceof Error ? err.message : String(err);
    req.log.error("[WhatsApp][contacts/messages] send failed", {
      error: errorMessage,
      phone,
    });

    if (/No LID for user/i.test(errorMessage)) {
      return res.status(422).json({ error: `WhatsApp user not found for phone ${phone}` });
    }

    res.status(500).json({ error: errorMessage });
  }
});

router.post("/whatsapp/conversations/:id/read", requireUser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const tenant = await getConnectedTenantForRequest(req as AuthenticatedRequest);
    if (!tenant) {
      return res.status(409).json({ error: "WhatsApp is not connected" });
    }

    await markTenantConversationRead(tenant.id, id);
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/bot-stats", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.json({
        conversationsHandled: 0,
        bookingsCreated: 0,
        successRate: 0,
        savedStaffMinutes: 0,
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const tenant = await ensureTenantForUser(user.id, getFallbackTenantName(req as AuthenticatedRequest));

    const { data: inboundRows, error } = await getSupabaseAdmin()
      .from("inbound_messages")
      .select("remote_jid")
      .eq("tenant_id", tenant.id);

    if (error) {
      throw new Error(error.message);
    }

    const conversationIds = new Set(
      ((inboundRows ?? []) as Array<{ remote_jid: string | null }>)
        .map((row) => row.remote_jid?.trim().toLowerCase())
        .filter((remoteJid): remoteJid is string => Boolean(remoteJid)),
    );

    const conversationsHandled = conversationIds.size;
    const bookingsCreated = 0;

    res.json({
      conversationsHandled,
      bookingsCreated,
      successRate: conversationsHandled > 0 ? Math.round((bookingsCreated / conversationsHandled) * 1000) / 10 : 0,
      savedStaffMinutes: 0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/whatsapp/campaigns/:id", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const campaignId = req.params.id;
    const user = (req as AuthenticatedRequest).user;

    const { data: campaign, error } = await getSupabaseAdmin()
      .from("marketing_campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (error || !campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Verify user owns this campaign
    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .eq("id", campaign.business_id)
      .single();

    if (!business) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(campaign);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/campaigns/send", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { campaignId, recipientIds, message, imageUrl, enableAntiFingerprinting = true } = req.body;

    if (!campaignId || !recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ error: "Campaign ID and recipient IDs are required" });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const tenant = await ensureTenantForUser(user.id, getFallbackTenantName(req as AuthenticatedRequest));
    const session = await getLiveWhatsappSession(tenant.id);

    if (!session || session.status !== "connected") {
      return res.status(409).json({ error: "WhatsApp is not connected" });
    }

    // Get WhatsApp client for verification
    const whatsappClient = await ensureTenantClient(tenant.id);

    // Return immediately to allow background processing
    res.json({
      success: true,
      message: "Campaign sending started in background",
      campaignId,
      totalRecipients: recipientIds.length,
    });

    // Process in background without blocking response
    setImmediate(async () => {
      try {
        req.log.info(`[Campaign Send] Background process started for campaign ${campaignId}`);
        req.log.info(`[Campaign Send] Total recipient IDs: ${recipientIds.length}`);

        // Fetch business ID
        const { data: business } = await getSupabaseAdmin()
          .from("businesses")
          .select("id")
          .eq("user_id", user.id)
          .single();

        if (!business) {
          req.log.error("[Campaign Send] Failed to fetch business data");
          return;
        }

        req.log.info(`[Campaign Send] Business ID: ${business.id}`);

        // Split recipients into batches of 100 to avoid flagging
        const BATCH_SIZE = 100;
        const batches = [];
        for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
          batches.push(recipientIds.slice(i, i + BATCH_SIZE));
        }

        req.log.info(`[Campaign Send] Split into ${batches.length} batches of ${BATCH_SIZE} recipients each`);

        // Fetch all client data upfront
        const clients: Array<{ id: string; name: string; phone: string }> = [];
        const fetchBatchSize = 100;

        req.log.info(`[Campaign Send] Fetching client data in batches of ${fetchBatchSize}`);

        for (let i = 0; i < recipientIds.length; i += fetchBatchSize) {
          const batch = recipientIds.slice(i, i + fetchBatchSize);
          req.log.info(`[Campaign Send] Fetching batch ${Math.floor(i/fetchBatchSize) + 1}: ${batch.length} client IDs`);
          
          const { data: batchClients, error: clientsError } = await getSupabaseAdmin()
            .from("clients")
            .select("id, name, phone")
            .in("id", batch)
            .eq("business_id", business.id);

          if (clientsError) {
            req.log.error(`[Campaign Send] Failed to fetch client batch: ${clientsError.message}`);
            continue;
          }

          if (batchClients) {
            clients.push(...batchClients);
            req.log.info(`[Campaign Send] Batch ${Math.floor(i/fetchBatchSize) + 1} fetched: ${batchClients.length} clients`);
          }
        }

        req.log.info(`[Campaign Send] Total clients fetched: ${clients.length}`);

        if (clients.length === 0) {
          req.log.error("[Campaign Send] No clients found to send to");
          return;
        }

        // Split clients into batches for processing
        const clientBatches = [];
        for (let i = 0; i < clients.length; i += BATCH_SIZE) {
          clientBatches.push(clients.slice(i, i + BATCH_SIZE));
        }

        req.log.info(`[Campaign Send] Split ${clients.length} clients into ${clientBatches.length} batches`);

        // Initialize anti-fingerprint sender if enabled
        const antiFingerprintSender = enableAntiFingerprinting 
          ? new WhatsAppAntiFingerprintSender({
              enableSpintax: true,
              enableRotationalScheduling: false,
            })
          : null;

        // Initialize engagement tracker
        const engagementTracker = new EngagementTracker();

        // Initialize rate limiter (once per day per recipient)
        const rateLimiter = new RecipientRateLimiter(1);

        // Initialize number verifier
        const verifier = getGlobalVerifier();

        req.log.info(`[Campaign Send] Anti-fingerprinting enabled: ${enableAntiFingerprinting}`);

        let totalSent = 0;
        let totalFailed = 0;

        // Process each batch with delay between batches
        for (let batchIndex = 0; batchIndex < clientBatches.length; batchIndex++) {
          const batch = clientBatches[batchIndex];
          req.log.info(`[Campaign Send] Starting batch ${batchIndex + 1}/${clientBatches.length} with ${batch.length} recipients`);

          let batchSent = 0;
          let batchFailed = 0;

          // Send messages in this batch
          for (const client of batch) {
            try {
              // Check rate limit
              if (!rateLimiter.canSendTo(client.phone)) {
                req.log.info(`[Campaign Send] Rate limited: ${client.phone} - skipping`);
                batchFailed++;
                continue;
              }

              // Verify number before sending
              const verification = await verifier.verifyNumber(whatsappClient, client.phone, business.id);
              if (!verification.isValid || !verification.isOnWhatsApp) {
                req.log.info(`[Campaign Send] Number verification failed for ${client.phone}: ${verification.reason} - skipping`);
                batchFailed++;
                
                // Auto-blacklist if blocked
                if (verification.isBlocked) {
                  await verifier.blacklistNumber(client.phone, business.id, verification.reason || "Verification blocked");
                }
                continue;
              }

              const variables = {
                Name: client.name || "there",
                ClientName: client.name || "there",
              };

              const processedMessage = enableAntiFingerprinting && antiFingerprintSender
                ? parseSpintax(message, variables)
                : message.replace(/\[Name\]/g, client.name || "there").replace(/\[ClientName\]/g, client.name || "there");

              req.log.info(`[Campaign Send] Sending to ${client.phone} (${client.name}) - Message: ${processedMessage.substring(0, 50)}...`);

              // Anti-fingerprinting: simulate typing
              if (enableAntiFingerprinting) {
                await simulateTyping(processedMessage.length);
                await humanPause();
              }
              
              await waitForSafeOutboundSend(tenant.id);
              const result = await sendTenantMessageByPhone(tenant.id, client.phone, processedMessage, imageUrl);
              
              req.log.info(`[Campaign Send] Successfully sent to ${client.phone}. Message ID: ${result.messageId}`);
              batchSent++;

              // Record engagement
              await engagementTracker.recordSent({
                businessId: business.id,
                campaignId,
                recipientPhone: client.phone,
                recipientName: client.name,
                messageId: result.messageId || undefined,
              });

              // Update insights
              await engagementTracker.updateInsights(business.id, client.phone, client.name);

              // Record sent for rate limiting
              rateLimiter.recordSent(client.phone);

              // Apply anti-fingerprinting delays if enabled
              if (enableAntiFingerprinting && antiFingerprintSender) {
                const coolDownManager = antiFingerprintSender.getCoolDownManager();
                
                // Random delay between messages (5-15 seconds)
                await new Promise(resolve => setTimeout(resolve, Math.random() * 10000 + 5000));
                
                // Check for cool-down
                await coolDownManager.checkAndWaitIfNeeded();
              }
            } catch (error) {
              batchFailed++;
              const errorMsg = error instanceof Error ? error.message : String(error);
              req.log.error(`[Campaign Send] Failed to send to ${client.phone}: ${errorMsg}`);
              
              // Auto-blacklist on certain errors
              await verifier.handleSendFailure(client.phone, business.id, errorMsg);
            }
          }

          totalSent += batchSent;
          totalFailed += batchFailed;

          req.log.info(`[Campaign Send] Batch ${batchIndex + 1} completed: ${batchSent} sent, ${batchFailed} failed`);

          // Update campaign progress after each batch
          const { error: updateError } = await getSupabaseAdmin()
            .from("marketing_campaigns")
            .update({
              sent: totalSent,
              updated_at: new Date().toISOString(),
            })
            .eq("id", campaignId);

          if (updateError) {
            req.log.error(`[Campaign Send] Failed to update campaign progress: ${updateError.message}`);
          }

          // Add delay between batches (30-60 minutes) to avoid flagging
          if (batchIndex < clientBatches.length - 1) {
            const batchDelayMinutes = Math.floor(Math.random() * 30) + 30; // 30-60 minutes
            req.log.info(`[Campaign Send] Waiting ${batchDelayMinutes} minutes before next batch to avoid flagging`);
            await new Promise(resolve => setTimeout(resolve, batchDelayMinutes * 60 * 1000));
          }
        }

        req.log.info(`[Campaign Send] All batches completed. Total: ${clients.length}, Sent: ${totalSent}, Failed: ${totalFailed}`);
        req.log.info(`[Campaign Send] Campaign ${campaignId} marked as completed`);

        // Update campaign stats in database
        const { error: updateError } = await getSupabaseAdmin()
          .from("marketing_campaigns")
          .update({
            sent: totalSent,
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaignId);

        if (updateError) {
          req.log.error(`[Campaign Send] Failed to update campaign stats: ${updateError.message}`);
        }

        req.log.info(`[Campaign Send] Completed: ${totalSent} sent, ${totalFailed} failed out of ${clients.length}`);
      } catch (error) {
        req.log.error(`[Campaign Send] Background processing error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/campaigns/send-meta", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { campaignId, recipientIds, message, imageUrl } = req.body;

    if (!campaignId || !recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ error: "Campaign ID and recipient IDs are required" });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const business = await getBusinessForUser(user.id);
    if (!business) {
      return res.status(403).json({ error: "Business not found" });
    }

    const connection = await getMetaWhatsappConnection(business.id);
    if (!connection) {
      return res.status(409).json({ error: "Meta WhatsApp API not connected" });
    }

    const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME?.trim();
    const templateLang = process.env.META_WHATSAPP_TEMPLATE_LANG?.trim() || "en_US";
    if (!templateName) {
      return res.status(503).json({
        error: "Meta WhatsApp template settings are not configured. Set META_WHATSAPP_TEMPLATE_NAME in the API server environment.",
      });
    }

    const { data: clients, error: clientsError } = await getSupabaseAdmin()
      .from("clients")
      .select("id, name, phone")
      .in("id", recipientIds)
      .eq("business_id", business.id);

    if (clientsError) {
      req.log.error("[Meta Campaign Send] Failed to fetch clients", { error: clientsError.message });
      return res.status(500).json({ error: "Failed to fetch recipient clients" });
    }

    if (!clients || clients.length === 0) {
      return res.status(404).json({ error: "No recipients found" });
    }

    res.json({ success: true, message: "Meta campaign send started", totalRecipients: clients.length });

    setImmediate(async () => {
      try {
        const phoneNumberId = connection.phone_number_id;
        const token = connection.access_token;
        const apiVersion = process.env.WHATSAPP_CLOUD_API_VERSION || "v17.0";
        let totalSent = 0;
        let totalFailed = 0;

        for (const client of clients) {
          const to = String(client.phone || "").replace(/\D+/g, "");
          if (!to) {
            req.log.error("[Meta Campaign Send] Invalid phone number", { clientId: client.id, phone: client.phone });
            totalFailed += 1;
            continue;
          }

          const processedMessage = message.replace(/\[Name\]/gi, client.name || "there");
          const body = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLang },
              components: [
                {
                  type: "body",
                  parameters: [
                    {
                      type: "text",
                      text: processedMessage,
                    },
                  ],
                },
              ],
            },
          };

          try {
            const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            });

            const rawPayload = await response.text().catch(() => "");
            const parsedPayload = (() => {
              try {
                return JSON.parse(rawPayload);
              } catch {
                return null;
              }
            })();

            if (!response.ok) {
              req.log.error("[Meta Campaign Send] Failed to send message", {
                clientId: client.id,
                phone: client.phone,
                status: response.status,
                statusText: response.statusText,
                detail: parsedPayload ?? rawPayload,
              });
              totalFailed += 1;
              continue;
            }

            const providerMessageId = parsedPayload?.messages?.[0]?.id ?? null;
            totalSent += 1;
            req.log.info("[Meta Campaign Send] Message sent", {
              clientId: client.id,
              phone: client.phone,
              providerMessageId,
              metaResponse: parsedPayload,
            });
          } catch (sendError) {
            req.log.error("[Meta Campaign Send] Send error", { clientId: client.id, phone: client.phone, error: sendError });
            totalFailed += 1;
            continue;
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        req.log.info("[Meta Campaign Send] Completed", { campaignId, totalSent, totalFailed, totalRecipients: clients.length });

        await getSupabaseAdmin()
          .from("marketing_campaigns")
          .update({
            sent: totalSent,
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaignId);
      } catch (backgroundError) {
        req.log.error("[Meta Campaign Send] Background worker error", backgroundError);
      }
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ============================================================================
// SCHEDULED CAMPAIGNS
// ============================================================================

router.post("/whatsapp/campaigns/schedule", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const {
      recipientIds,
      message,
      imageUrl,
      scheduledFor,
      timezone = "Africa/Johannesburg",
      enableAntiFingerprinting = true,
      batchSize = 100,
      batchDelayMinutes = 45,
    } = req.body;

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ error: "Recipient IDs are required" });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!scheduledFor) {
      return res.status(400).json({ error: "Scheduled time is required" });
    }

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const scheduler = getGlobalScheduler();
    const scheduledCampaignId = await scheduler.scheduleCampaign({
      businessId: business.id,
      recipientIds,
      message,
      imageUrl,
      scheduledFor: new Date(scheduledFor),
      timezone,
      enableAntiFingerprinting,
      batchSize,
      batchDelayMinutes,
    });

    res.json({
      success: true,
      scheduledCampaignId,
      scheduledFor,
      recipientCount: recipientIds.length,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/campaigns/scheduled", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const scheduler = getGlobalScheduler();
    const scheduledCampaigns = await scheduler.getScheduledCampaigns(business.id);

    res.json({ scheduledCampaigns });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.delete("/whatsapp/campaigns/scheduled/:id", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const { id } = req.params;

    const scheduler = getGlobalScheduler();
    await scheduler.cancelCampaign(id);

    res.json({ success: true, message: "Campaign cancelled" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ============================================================================
// WARM-UP SYSTEM
// ============================================================================

router.post("/whatsapp/warmup/start", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const tenant = await ensureTenantForUser(user.id, business.id);
    const warmUpManager = new WarmUpManager();
    await warmUpManager.startWarmUp(business.id, tenant.id);

    res.json({ success: true, message: "Warm-up started" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/warmup/status", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const tenant = await ensureTenantForUser(user.id, business.id);
    const warmUpManager = new WarmUpManager();
    const status = await warmUpManager.getWarmUpStatus(business.id, tenant.id);
    const progress = await warmUpManager.getWarmUpProgress(business.id, tenant.id);

    res.json({ status, progress });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/warmup/cancel", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const tenant = await ensureTenantForUser(user.id, business.id);
    const warmUpManager = new WarmUpManager();
    await warmUpManager.cancelWarmUp(business.id, tenant.id);

    res.json({ success: true, message: "Warm-up cancelled" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ============================================================================
// A/B TESTING
// ============================================================================

router.post("/whatsapp/ab-tests", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const {
      name,
      messageA,
      messageB,
      imageUrlA,
      imageUrlB,
      splitPercentage = 50,
    } = req.body;

    if (!name || !messageA || !messageB) {
      return res.status(400).json({ error: "Name, message A, and message B are required" });
    }

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const abTestManager = new ABTestManager();
    const abTestId = await abTestManager.createABTest({
      businessId: business.id,
      name,
      messageA,
      messageB,
      imageUrlA,
      imageUrlB,
      splitPercentage,
    });

    res.json({ success: true, abTestId });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/ab-tests/:id/start", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const { id } = req.params;
    const { recipientIds } = req.body;

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ error: "Recipient IDs are required" });
    }

    const abTestManager = new ABTestManager();
    await abTestManager.startABTest(id, recipientIds);

    res.json({ success: true, message: "A/B test started" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/ab-tests/:id/results", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const { id } = req.params;

    const abTestManager = new ABTestManager();
    const results = await abTestManager.calculateResults(id);

    res.json({ results });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/ab-tests", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const abTestManager = new ABTestManager();
    const abTests = await abTestManager.getABTests(business.id);

    res.json({ abTests });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ============================================================================
// NUMBER VERIFICATION & BLACKLIST
// ============================================================================

router.post("/whatsapp/verify-number", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const tenant = await ensureTenantForUser(user.id, business.id);
    const whatsappClient = await ensureTenantClient(tenant.id);
    const verifier = getGlobalVerifier();

    const result = await verifier.verifyNumber(whatsappClient, phone, business.id);

    res.json({ result });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/verify-batch", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { phones } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: "Phone numbers array is required" });
    }

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const tenant = await ensureTenantForUser(user.id, business.id);
    const whatsappClient = await ensureTenantClient(tenant.id);
    const verifier = getGlobalVerifier();

    const results = await verifier.verifyBatch(whatsappClient, phones, business.id);

    res.json({ results: Object.fromEntries(results) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.get("/whatsapp/blacklist", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const verifier = getGlobalVerifier();
    const blacklisted = await verifier.getBlacklistedNumbers(business.id);

    res.json({ blacklisted });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/whatsapp/blacklist", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { phone, reason } = req.body;

    if (!phone || !reason) {
      return res.status(400).json({ error: "Phone and reason are required" });
    }

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const verifier = getGlobalVerifier();
    await verifier.blacklistNumber(phone, business.id, reason);

    res.json({ success: true, message: "Number blacklisted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.delete("/whatsapp/blacklist/:phone", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { phone } = req.params;

    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const verifier = getGlobalVerifier();
    await verifier.unblacklistNumber(phone, business.id);

    res.json({ success: true, message: "Number removed from blacklist" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export default router;
