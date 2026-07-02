import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import QRCode from "qrcode";
import { Client, LocalAuth, type Message, MessageMedia } from "whatsapp-web.js";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase";
import { recordActivity } from "./activity";
import {
  buildBookingAiContext,
  executeAssistantAction,
  fetchBotSettingsForBusiness,
  findClientByPhoneForBusiness,
  currentBusinessTime,
  getConfirmationReply,
  getDecisionAndReply,
  getGroqChatHistory,
  clearOutOfHoursReply,
  hasRecentlyReceivedClosedReply,
  isWithinWorkingHours,
  nextOpeningTime,
  normalizePhoneLikeValue,
  recordOutOfHoursReply,
  saveWhatsappAiDraft,
  shouldReplyToPhone,
} from "./whatsapp-ai";

export type WhatsappSessionStatus = "qrcode" | "connected" | "disconnected";

export type TenantRow = {
  id: string;
  owner_user_id: string;
  name: string;
};

export type WhatsappSessionRow = {
  id: string;
  tenant_id: string;
  instance_id: string;
  instance_token: string;
  status: WhatsappSessionStatus;
  qr_code: string | null;
  connected_phone: string | null;
  updated_at: string;
};

export type WhatsappConversationSummary = {
  id: number;
  remoteJid: string;
  clientName: string;
  clientPhone: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  isBot: boolean;
  avatarUrl: string | null;
};

export type WhatsappConversationMessage = {
  id: number;
  messageId: string | null;
  conversationId: number;
  remoteJid: string;
  content: string;
  direction: "inbound" | "outbound";
  timestamp: string;
  status: "sent" | "delivered" | "read" | "failed";
  isBot: boolean;
};

type StoredInboundMessageRow = {
  id: string;
  message_id: string | null;
  remote_jid: string;
  text_body: string;
  received_at: string;
};

type SessionRuntime = {
  client: Client | null;
  startingPromise: Promise<WhatsappSessionRow> | null;
  qrCode: string | null;
  status: WhatsappSessionStatus;
  connectedPhone: string | null;
};

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectDir = path.resolve(currentDir, "..", "..");
const execFileAsync = promisify(execFile);
const sessionsRoot = process.env["WHATSAPP_SESSION_DIR"]?.trim()
  ? path.resolve(process.env["WHATSAPP_SESSION_DIR"]!)
  : path.resolve(projectDir, ".sessions", "whatsapp");

const runtimeByTenantId = new Map<string, SessionRuntime>();
const qrWaiters = new Map<string, Array<(session: WhatsappSessionRow) => void>>();

function resolveBrowserExecutablePath(): string | undefined {
  const configuredPath = process.env["WHATSAPP_BROWSER_PATH"]?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function cleanupStaleWhatsappBrowserSession(tenantId: string): Promise<void> {
  const sessionDir = path.resolve(sessionsRoot, `session-${tenantId}`);

  if (process.platform !== "win32") {
    return;
  }

  const escapedSessionDir = escapePowerShellSingleQuoted(sessionDir);
  const command = [
    `$sessionDir = '${escapedSessionDir}'`,
    "$browserProcesses = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.CommandLine -and",
    "  $_.CommandLine -like '*--user-data-dir*' -and",
    "  $_.CommandLine -like \"*$sessionDir*\"",
    "}",
    "foreach ($process in $browserProcesses) {",
    "  try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop } catch {}",
    "}",
  ].join("; ");

  try {
    await execFileAsync("powershell", ["-NoProfile", "-Command", command]);
  } catch {
    // Best effort cleanup only. If nothing is found or PowerShell errors, continue.
  }
}

function getRuntime(tenantId: string): SessionRuntime {
  const existing = runtimeByTenantId.get(tenantId);
  if (existing) return existing;

  const created: SessionRuntime = {
    client: null,
    startingPromise: null,
    qrCode: null,
    status: "disconnected",
    connectedPhone: null,
  };
  runtimeByTenantId.set(tenantId, created);
  return created;
}

function notifyQrWaiters(tenantId: string, session: WhatsappSessionRow) {
  const waiters = qrWaiters.get(tenantId);
  if (!waiters?.length) return;
  qrWaiters.delete(tenantId);
  waiters.forEach((resolve) => resolve(session));
}

async function ensureSessionsRoot(): Promise<void> {
  await mkdir(sessionsRoot, { recursive: true });
}

function getSessionDir(tenantId: string): string {
  return path.resolve(sessionsRoot, `session-${tenantId}`);
}

async function persistSessionState(
  sessionId: string,
  patch: Partial<{
    status: WhatsappSessionStatus;
    qr_code: string | null;
    connected_phone: string | null;
    last_seen_at: string;
  }>,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .update(patch)
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function ensureTenantForUser(userId: string, fallbackName: string): Promise<TenantRow> {
  const { data: existing, error: existingError } = await getSupabaseAdmin()
    .from("tenants")
    .select("*")
    .eq("owner_user_id", userId)
    .maybeSingle<TenantRow>();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing;

  const { data: inserted, error: insertError } = await getSupabaseAdmin()
    .from("tenants")
    .insert({
      owner_user_id: userId,
      name: fallbackName,
    })
    .select("*")
    .single<TenantRow>();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? "Could not create tenant");
  }

  return inserted;
}

export async function getWhatsappSessionByTenantId(tenantId: string): Promise<WhatsappSessionRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle<WhatsappSessionRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function createOrLoadWhatsappSession(tenantId: string): Promise<WhatsappSessionRow> {
  const existing = await getWhatsappSessionByTenantId(tenantId);
  if (existing) return existing;

  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .insert({
      tenant_id: tenantId,
      instance_id: `tenant-${tenantId}`,
      instance_token: randomUUID(),
      status: "disconnected",
    })
    .select("*")
    .single<WhatsappSessionRow>();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create WhatsApp session");
  }

  return data;
}

export async function resetWhatsappSession(tenantId: string): Promise<void> {
  const runtime = getRuntime(tenantId);
  const session = await getWhatsappSessionByTenantId(tenantId);

  if (runtime.client) {
    try {
      await runtime.client.destroy();
    } catch {
      // Best effort only. We still clear persisted auth state below.
    }
  }

  runtime.client = null;
  runtime.startingPromise = null;
  runtime.qrCode = null;
  runtime.status = "disconnected";
  runtime.connectedPhone = null;
  qrWaiters.delete(tenantId);

  await cleanupStaleWhatsappBrowserSession(tenantId);
  await rm(getSessionDir(tenantId), { recursive: true, force: true });

  if (session) {
    await persistSessionState(session.id, {
      status: "disconnected",
      qr_code: null,
      connected_phone: null,
      last_seen_at: new Date().toISOString(),
    });
  }
}

export function formatWhatsappStatusResponse(session: Partial<WhatsappSessionRow> | null | undefined) {
  return {
    status: session?.status ?? "disconnected",
    instanceId: session?.instance_id ?? null,
    qrCode: session?.qr_code ?? null,
    connectedPhone: session?.connected_phone ?? null,
    updatedAt: session?.updated_at ?? null,
  };
}

async function storeInboundMessage(session: WhatsappSessionRow, message: Message): Promise<void> {
  const textBody = message.body ?? "";

  const { error } = await getSupabaseAdmin().from("inbound_messages").insert({
    tenant_id: session.tenant_id,
    whatsapp_session_id: session.id,
    instance_id: session.instance_id,
    message_id: message.id.id ?? null,
    remote_jid: message.from,
    sender_name: (message as { _data?: { notifyName?: string } })._data?.notifyName ?? null,
    message_type: "text",
    text_body: textBody,
    payload: message.rawData ?? message,
  });

  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }
}

function getConnectedPhone(client: Client | null): string | null {
  const info = client?.info as { wid?: { user?: string } } | undefined;
  return info?.wid?.user ?? null;
}

function normalizeRemoteJid(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

const currentlyProcessing = new Set<string>();

async function getBusinessIdForTenant(tenantId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("tenants")
    .select("owner_user_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data?.owner_user_id) {
    console.error("[WhatsApp Business Lookup] Failed to get tenant owner:", error);
    return null;
  }

  const { data: bizData, error: bizError } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", data.owner_user_id)
    .maybeSingle();

  if (bizError || !bizData?.id) {
    console.error("[WhatsApp Business Lookup] Failed to get business for owner:", bizError);
    return null;
  }

  return bizData.id;
}

/**
 * Resolve the real phone number (digits only, international form) behind an inbound
 * message.
 *
 * On LID-based WhatsApp accounts `message.from` is "<lid>@lid" and `contact.number`
 * is ALSO the LID — neither is a phone number. whatsapp-web.js rewrites `contact.id`
 * to the real "<phone>@c.us" WID whenever the phone is known, so `contact.id` is the
 * only reliable source. Returns "" when the phone cannot be recovered (e.g. a
 * privacy-hidden unknown contact); callers must NOT fall back to storing the LID.
 */
async function resolveInboundPhoneNumber(message: Message): Promise<string> {
  try {
    const contact = await message.getContact();
    const id = (contact as { id?: { user?: string; _serialized?: string } }).id;
    const serialized = normalizeRemoteJid(id?._serialized);
    if (serialized.endsWith("@c.us")) {
      const digits = normalizePhoneLikeValue(id?.user ?? "");
      if (digits) return digits;
    }
  } catch (err) {
    console.warn("[WhatsApp resolveInboundPhoneNumber] getContact failed:", err);
  }
  return "";
}

/** Extract the bare LID from a "<lid>@lid" JID, or null for non-LID JIDs. */
function extractLidFromJid(jid: string | null | undefined): string | null {
  const normalized = normalizeRemoteJid(jid);
  if (!normalized.endsWith("@lid")) return null;
  const user = normalized.split("@")[0] ?? "";
  return user || null;
}

async function createClientFromWhatsApp(
  businessId: string,
  phone: string,
  name: string,
  lid: string | null = null,
): Promise<void> {
  const normalizedPhone = normalizePhoneLikeValue(phone);
  const cleanLid = lid?.trim() || null;
  if (!normalizedPhone || !isSupabaseAdminConfigured()) return;

  const existingClient = await findClientByPhoneForBusiness(businessId, normalizedPhone);
  if (existingClient) {
    // Backfill the LID on an existing client when we now know it but it's not set.
    if (cleanLid) {
      await getSupabaseAdmin()
        .from("clients")
        .update({ lid: cleanLid })
        .eq("id", existingClient.id)
        .is("lid", null);
    }
    return;
  }

  const { error: insertError } = await getSupabaseAdmin()
    .from("clients")
    .insert({
      business_id: businessId,
      name: name?.trim() || "Unknown",
      phone: normalizedPhone,
      lid: cleanLid,
      email: null,
      client_type: "new",
      no_show_count: 0,
      avatar_url: null,
      notes: null,
    });

  // 23505 = unique violation: a concurrent inbound created the same client first.
  // The unique index did its job; the existing row stands, so this is benign.
  if (insertError && insertError.code !== "23505") {
    console.log("[WhatsApp Auto-Add] Failed to create client:", insertError.message);
  } else if (!insertError) {
    console.log("[WhatsApp Auto-Add] Client created:", name, normalizedPhone);
  }
}

function shouldIncludeConversationRemoteJid(remoteJid: string): boolean {
  const normalized = normalizeRemoteJid(remoteJid);
  if (!normalized) return false;
  if (normalized === "status@broadcast") return false;
  if (normalized.endsWith("@broadcast")) return false;
  return true;
}

export function getConversationIdFromRemoteJid(remoteJid: string): number {
  const digits = normalizePhoneLikeValue(remoteJid);
  if (digits) {
    return Number(digits.slice(-12));
  }

  let hash = 0;
  for (const char of remoteJid) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash || 1;
}

function getChatRemoteJid(chat: unknown): string {
  const id = (chat as { id?: { _serialized?: string } })?.id?._serialized;
  return normalizeRemoteJid(id);
}

function getMessageRemoteJid(message: unknown): string {
  const typed = message as { fromMe?: boolean; from?: string; to?: string };
  return normalizeRemoteJid(typed.fromMe ? typed.to : typed.from);
}

function getMessageText(message: unknown): string {
  const typed = message as { body?: string; type?: string };
  const body = typed.body?.trim();
  if (body) return body;

  const type = typed.type?.trim();
  if (type) {
    return `${type.charAt(0).toUpperCase()}${type.slice(1)} message`;
  }

  return "Media message";
}

function getIsoTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return new Date().toISOString();
}

function getMessageTimestamp(message: unknown): string {
  const typed = message as { timestamp?: number | string | Date; rawData?: { t?: number | string } };
  return getIsoTimestamp(typed.timestamp ?? typed.rawData?.t);
}

function getWhatsappMessageStatus(message: unknown): "sent" | "delivered" | "read" | "failed" {
  const typed = message as { fromMe?: boolean; ack?: number };
  if (!typed.fromMe) return "delivered";

  switch (typed.ack) {
    case 3:
    case 4:
      return "read";
    case 2:
      return "delivered";
    case 0:
    case 1:
      return "sent";
    default:
      return "sent";
  }
}

function getChatDisplayName(chat: unknown): string {
  const typed = chat as {
    name?: string;
    formattedTitle?: string;
    contact?: { pushname?: string; name?: string; number?: string };
  };

  return (
    typed.name?.trim() ||
    typed.formattedTitle?.trim() ||
    typed.contact?.pushname?.trim() ||
    typed.contact?.name?.trim() ||
    typed.contact?.number?.trim() ||
    normalizePhoneLikeValue(getChatRemoteJid(chat)) ||
    "Unknown"
  );
}

function getChatPhone(chat: unknown): string {
  const typed = chat as { contact?: { number?: string } };
  return typed.contact?.number?.trim() || normalizePhoneLikeValue(getChatRemoteJid(chat));
}

function mapMessageToConversationMessage(
  message: unknown,
  index: number,
  conversationId: number,
  remoteJid: string,
): WhatsappConversationMessage {
  const typedMessage = message as { id?: { id?: string } };
  return {
    id: index + 1,
    messageId: typedMessage.id?.id ?? null,
    conversationId,
    remoteJid,
    content: getMessageText(message),
    direction: (message as { fromMe?: boolean }).fromMe ? "outbound" : "inbound",
    timestamp: getMessageTimestamp(message),
    status: getWhatsappMessageStatus(message),
    isBot: false,
  };
}

async function listStoredInboundMessages(
  tenantId: string,
  conversationId: number,
  remoteJid: string,
  limit: number,
): Promise<WhatsappConversationMessage[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inbound_messages")
    .select("id, message_id, remote_jid, text_body, received_at")
    .eq("tenant_id", tenantId)
    .eq("remote_jid", remoteJid)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as StoredInboundMessageRow[])
    .reverse()
    .map((row, index) => ({
      id: index + 1,
      messageId: row.message_id ?? row.id,
      conversationId,
      remoteJid,
      content: row.text_body?.trim() || "Media message",
      direction: "inbound",
      timestamp: row.received_at,
      status: "delivered",
      isBot: false,
    }));
}

async function ensureTenantClient(tenantId: string): Promise<Client | null> {
  const runtime = getRuntime(tenantId);
  if (runtime.client) return runtime.client;

  const session = await getWhatsappSessionByTenantId(tenantId);
  if (session?.status !== "connected") {
    return null;
  }

  await startTenantSocket(tenantId);
  return getRuntime(tenantId).client;
}

async function resolveConversationChat(tenantId: string, conversationId: number): Promise<unknown | null> {
  const client = await ensureTenantClient(tenantId);
  if (!client) return null;

  const chats = await client.getChats();
  return (
    chats.find((chat) => {
      const remoteJid = getChatRemoteJid(chat);
      return (
        shouldIncludeConversationRemoteJid(remoteJid) &&
        getConversationIdFromRemoteJid(remoteJid) === conversationId
      );
    }) ?? null
  );
}

export async function listTenantChats(tenantId: string): Promise<WhatsappConversationSummary[]> {
  const client = await ensureTenantClient(tenantId);
  if (!client) return [];

  const chats = await client.getChats();
  const summaries = await Promise.all(
    chats
      .filter((chat) => shouldIncludeConversationRemoteJid(getChatRemoteJid(chat)))
      .map(async (chat) => {
        const remoteJid = getChatRemoteJid(chat);
        const typedChat = chat as {
          unreadCount?: number;
          isGroup?: boolean;
          lastMessage?: unknown;
          timestamp?: number | string | Date;
          fetchMessages?: (options?: { limit?: number }) => Promise<unknown[]>;
        };

        let latestMessage = typedChat.lastMessage ?? null;
        if (!latestMessage && typedChat.fetchMessages) {
          const fetched = await typedChat.fetchMessages({ limit: 1 });
          latestMessage = fetched.at(-1) ?? null;
        }

        const clientName = getChatDisplayName(chat);
        const clientPhone = getChatPhone(chat);

        // NOTE: listing conversations must NOT create client records. Auto-create
        // is owned solely by the inbound "message" handler, which resolves the real
        // phone from contact.id. Creating here used the LID-based chat phone and ran
        // on every list load, which is what flooded the CRM with duplicate clients.

        return {
          id: getConversationIdFromRemoteJid(remoteJid),
          remoteJid,
          clientName,
          clientPhone,
          lastMessage: latestMessage ? getMessageText(latestMessage) : "No messages yet",
          lastMessageAt: latestMessage ? getMessageTimestamp(latestMessage) : getIsoTimestamp(typedChat.timestamp),
          unreadCount: Number(typedChat.unreadCount ?? 0),
          isBot: false,
          avatarUrl: null,
        } satisfies WhatsappConversationSummary;
      }),
  );

  return summaries.sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );
}

export async function listTenantMessages(
  tenantId: string,
  conversationId: number,
  limit = 500,
): Promise<WhatsappConversationMessage[]> {
  const chat = await resolveConversationChat(tenantId, conversationId);
  if (!chat) return [];

  const typedChat = chat as { fetchMessages?: (options?: { limit?: number }) => Promise<unknown[]> };
  const fetched = typedChat.fetchMessages ? await typedChat.fetchMessages({ limit }) : [];
  const remoteJid = getChatRemoteJid(chat);
  const liveMessages = fetched
    .sort(
      (a, b) =>
        new Date(getMessageTimestamp(a)).getTime() - new Date(getMessageTimestamp(b)).getTime(),
    )
    .map((message, index) => mapMessageToConversationMessage(message, index, conversationId, remoteJid));

  if (liveMessages.length > 0) {
    return liveMessages;
  }

  const storedMessages = await listStoredInboundMessages(tenantId, conversationId, remoteJid, limit);
  if (storedMessages.length > 0) {
    return storedMessages;
  }

  const latestMessage = (chat as { lastMessage?: unknown }).lastMessage;
  return latestMessage ? [mapMessageToConversationMessage(latestMessage, 0, conversationId, remoteJid)] : [];
}

/**
 * Convert a stored phone number into a WhatsApp MSISDN (digits only, international
 * form, no leading "+"). Handles the common South African local format where a
 * number is stored as 0XXXXXXXXX (10 digits) and must become 27XXXXXXXXX.
 */
export function toWhatsAppMsisdn(phone: string): string {
  let digits = normalizePhoneLikeValue(phone);
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `27${digits.slice(1)}`;
  }
  return digits;
}

export function resolveRemoteJidFromPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return normalizeRemoteJid(trimmed);
  const digits = toWhatsAppMsisdn(trimmed);
  return digits ? `${digits}@c.us` : "";
}

/**
 * Resolve the canonical WhatsApp chat id for a phone number via WhatsApp itself.
 *
 * Building "<digits>@c.us" by hand is unreliable: for some numbers the canonical
 * chat id differs from the naive form, and sending to the naive id silently sits
 * at a single tick (sent, never delivered). client.getNumberId() asks WhatsApp
 * for the real id and returns null when the number is not registered on WhatsApp.
 */
async function resolveWhatsAppJid(client: Client, phone: string): Promise<string> {
  const msisdn = toWhatsAppMsisdn(phone);
  if (!msisdn) {
    throw new Error(`Invalid phone number provided: "${phone}"`);
  }

  let numberId: { _serialized?: string } | null = null;
  try {
    numberId = await client.getNumberId(msisdn);
  } catch (err) {
    console.error("[WhatsApp resolveWhatsAppJid] getNumberId threw", {
      phone,
      msisdn,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!numberId?._serialized) {
    console.error("[WhatsApp resolveWhatsAppJid] number is not on WhatsApp", { phone, msisdn });
    throw new Error(`${phone} is not a registered WhatsApp number`);
  }

  console.log("[WhatsApp resolveWhatsAppJid] resolved", {
    phone,
    msisdn,
    remoteJid: numberId._serialized,
    naiveJid: `${msisdn}@c.us`,
    differs: numberId._serialized !== `${msisdn}@c.us`,
  });

  return numberId._serialized;
}

async function loadMessageMedia(urlOrDataUri: string): Promise<MessageMedia> {
  const trimmed = urlOrDataUri.trim();
  if (!trimmed) {
    throw new Error("Media URL is required.");
  }

  if (trimmed.startsWith("data:")) {
    const parts = /^data:(.+?);base64,(.*)$/s.exec(trimmed);
    if (!parts) {
      throw new Error("Invalid data URI for media.");
    }

    return new MessageMedia(parts[1], parts[2]);
  }

  const response = await fetch(trimmed);
  if (!response.ok) {
    throw new Error(`Unable to load media from URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64Data = buffer.toString("base64");

  const filename = (() => {
    try {
      const url = new URL(trimmed);
      const candidate = url.pathname.split("/").filter(Boolean).pop();
      return candidate || "media";
    } catch {
      return "media";
    }
  })();

  return new MessageMedia(contentType, base64Data, filename);
}

export async function sendTenantMessageByPhone(
  tenantId: string,
  phone: string,
  content: string,
  imageUrl?: string,
): Promise<WhatsappConversationMessage> {
  const client = await ensureTenantClient(tenantId);
  if (!client) {
    throw new Error("WhatsApp client is not connected");
  }

  const remoteJid = await resolveWhatsAppJid(client, phone);

  try {
    let sent: Message;
    if (imageUrl?.trim()) {
      const media = await loadMessageMedia(imageUrl);
      sent = await client.sendMessage(remoteJid, media, {
        caption: content || undefined,
      });
    } else if (!content.trim()) {
      throw new Error("Message or image is required.");
    } else {
      sent = await client.sendMessage(remoteJid, content);
    }

    const typedSent = sent as { id?: { id?: string } };
    const messageContent = content.trim() || (imageUrl ? "[Image]" : getMessageText(sent));

    return {
      id: Date.now(),
      messageId: typedSent.id?.id ?? null,
      conversationId: getConversationIdFromRemoteJid(remoteJid),
      remoteJid,
      content: messageContent,
      direction: "outbound",
      timestamp: getMessageTimestamp(sent),
      status: getWhatsappMessageStatus(sent),
      isBot: false,
    };
  } catch (err) {
    console.error("[WhatsApp sendTenantMessageByPhone] failed", {
      tenantId,
      phone,
      remoteJid,
      imageUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function sendTenantMessageByRemoteJid(
  tenantId: string,
  remoteJidInput: string,
  content: string,
  imageUrl?: string,
): Promise<WhatsappConversationMessage> {
  const remoteJid = normalizeRemoteJid(remoteJidInput);
  if (!shouldIncludeConversationRemoteJid(remoteJid) || remoteJid.endsWith("@g.us")) {
    throw new Error("Invalid WhatsApp chat id.");
  }

  const client = await ensureTenantClient(tenantId);
  if (!client) {
    throw new Error("WhatsApp client is not connected");
  }

  try {
    let sent: Message;
    if (imageUrl?.trim()) {
      const media = await loadMessageMedia(imageUrl);
      sent = await client.sendMessage(remoteJid, media, {
        caption: content || undefined,
      });
    } else if (!content.trim()) {
      throw new Error("Message or image is required.");
    } else {
      sent = await client.sendMessage(remoteJid, content);
    }

    const typedSent = sent as { id?: { id?: string } };
    const messageContent = content.trim() || (imageUrl ? "[Image]" : getMessageText(sent));

    return {
      id: Date.now(),
      messageId: typedSent.id?.id ?? null,
      conversationId: getConversationIdFromRemoteJid(remoteJid),
      remoteJid,
      content: messageContent,
      direction: "outbound",
      timestamp: getMessageTimestamp(sent),
      status: getWhatsappMessageStatus(sent),
      isBot: false,
    };
  } catch (err) {
    console.error("[WhatsApp sendTenantMessageByRemoteJid] failed", {
      tenantId,
      remoteJid,
      imageUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function sendTenantMessage(
  tenantId: string,
  conversationId: number,
  content: string,
  imageUrl?: string,
): Promise<WhatsappConversationMessage> {
  const chat = await resolveConversationChat(tenantId, conversationId);
  if (!chat) {
    throw new Error("Conversation not found");
  }

  const client = await ensureTenantClient(tenantId);
  if (!client) {
    throw new Error("WhatsApp client is not connected");
  }

  const remoteJid = getChatRemoteJid(chat);
  let sent: Message;
  if (imageUrl?.trim()) {
    const media = await loadMessageMedia(imageUrl);
    sent = await client.sendMessage(remoteJid, media, {
      caption: content || undefined,
    });
  } else if (!content.trim()) {
    throw new Error("Message or image is required.");
  } else {
    sent = await client.sendMessage(remoteJid, content);
  }

  const typedSent = sent as { id?: { id?: string } };
  const messageContent = content.trim() || (imageUrl ? "[Image]" : getMessageText(sent));

  return {
    id: Date.now(),
    messageId: typedSent.id?.id ?? null,
    conversationId,
    remoteJid,
    content: messageContent,
    direction: "outbound",
    timestamp: getMessageTimestamp(sent),
    status: getWhatsappMessageStatus(sent),
    isBot: false,
  };
}

export async function markTenantConversationRead(tenantId: string, conversationId: number): Promise<void> {
  const chat = await resolveConversationChat(tenantId, conversationId);
  const typedChat = chat as { sendSeen?: () => Promise<unknown> } | null;
  if (!typedChat?.sendSeen) {
    throw new Error("Conversation not found");
  }

  await typedChat.sendSeen();
}

export async function startTenantSocket(tenantId: string): Promise<WhatsappSessionRow> {
  const runtime = getRuntime(tenantId);
  if (runtime.startingPromise) {
    return runtime.startingPromise;
  }

  runtime.startingPromise = (async () => {
    await ensureSessionsRoot();
    await cleanupStaleWhatsappBrowserSession(tenantId);
    const session = await createOrLoadWhatsappSession(tenantId);
    const businessId = await getBusinessIdForTenant(tenantId);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: tenantId,
        dataPath: sessionsRoot,
      }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: resolveBrowserExecutablePath(),
      },
    });

    runtime.client = client;
    runtime.status = session.status;
    runtime.qrCode = session.qr_code;
    runtime.connectedPhone = session.connected_phone;

    client.on("qr", (qr: string) => {
      void (async () => {
        runtime.status = "qrcode";
        runtime.qrCode = await QRCode.toDataURL(qr);
        await persistSessionState(session.id, {
          status: "qrcode",
          qr_code: runtime.qrCode,
          last_seen_at: new Date().toISOString(),
        });

        const refreshed = await getWhatsappSessionByTenantId(tenantId);
        if (refreshed) notifyQrWaiters(tenantId, refreshed);
      })().catch((error) => {
        console.error("Failed to process WhatsApp QR event:", error);
      });
    });

    client.on("ready", () => {
      void (async () => {
        runtime.status = "connected";
        runtime.qrCode = null;
        runtime.connectedPhone = getConnectedPhone(client);
        console.log('[WhatsApp] Client is ready and connected. Phone:', runtime.connectedPhone);
        await persistSessionState(session.id, {
          status: "connected",
          qr_code: null,
          connected_phone: runtime.connectedPhone,
          last_seen_at: new Date().toISOString(),
        });
      })().catch((error) => {
        console.error("Failed to process WhatsApp ready event:", error);
      });
    });

    client.on("authenticated", () => {
      runtime.status = runtime.status === "connected" ? "connected" : runtime.status;
    });

    client.on("auth_failure", () => {
      void persistSessionState(session.id, {
        status: "disconnected",
        qr_code: null,
        connected_phone: null,
        last_seen_at: new Date().toISOString(),
      }).catch((error) => {
        console.error("Failed to process WhatsApp auth failure:", error);
      });
    });

    client.on("disconnected", () => {
      void (async () => {
        runtime.status = "disconnected";
        runtime.connectedPhone = null;
        runtime.client = null;
        await persistSessionState(session.id, {
          status: "disconnected",
          qr_code: null,
          connected_phone: null,
          last_seen_at: new Date().toISOString(),
        });
      })().catch((error) => {
        console.error("Failed to process WhatsApp disconnect:", error);
      });
    });

    // AI auto-reply for incoming private messages (when bot is enabled).
    client.on("message_create", async (message: Message) => {
      if (message.fromMe) return;

      const fromJidRaw = message.from ?? "";
      if (fromJidRaw.endsWith("@g.us")) return;

      const jidUser = fromJidRaw.split("@")[0] ?? "";
      const relevantJid = fromJidRaw;
      const textBody = message.body?.trim() ?? "";
      if (!textBody) return;

      const businessId = await getBusinessIdForTenant(tenantId);
      if (!businessId) return;

      const botConfig = await fetchBotSettingsForBusiness(businessId);
      const settings = botConfig.settings;
      if (!settings?.bot_enabled) return;

      if (!shouldReplyToPhone(jidUser)) return;

      if (currentlyProcessing.has(relevantJid)) return;

      const withinHours = isWithinWorkingHours(botConfig.workingHours, settings.always_on);

      if (!withinHours) {
        // Outside bot working hours — send one courtesy reply per 24h window then
        // stay silent. Avoids spamming "we're closed" on every customer message.
        if (!hasRecentlyReceivedClosedReply(relevantJid)) {
          const next = nextOpeningTime(botConfig.workingHours);
          const closedReply = next
            ? `Thanks for your message! Our booking assistant is currently offline. We'll be back ${next} — feel free to message us then and we'll get you sorted! 😊`
            : `Thanks for your message! Our booking assistant is currently offline. Please try again during business hours.`;
          try {
            await client.sendMessage(relevantJid, closedReply);
            recordOutOfHoursReply(relevantJid);
          } catch (err) {
            console.error("[WhatsApp AI] Failed to send out-of-hours reply:", err);
          }
        }
        return;
      }

      // Within hours — reset the closed-reply dedup so the customer gets a fresh
      // greeting if they message again after hours again later.
      clearOutOfHoursReply(relevantJid);

      currentlyProcessing.add(relevantJid);
      try {
        const senderName =
          (message as { _data?: { notifyName?: string } })._data?.notifyName?.trim() || "";

        // Resolve the real phone from contact.id — message.from is a LID, not a phone.
        // Used for client lookup and any booking/cancel/reschedule the AI performs.
        const senderPhone = await resolveInboundPhoneNumber(message);

        const [chat, clientProfile] = await Promise.all([
          message.getChat(),
          findClientByPhoneForBusiness(businessId, senderPhone),
        ]);

        // NOTE: client auto-create is owned solely by the "message" handler (which
        // also resolves the real phone). Creating here raced with it and produced
        // duplicate client records, so we intentionally do not create here.

        const clientName =
          clientProfile?.name || senderName || "there";

        const [{ history, isFirstMessage }, { businessContext, aiData, workingHoursText }] = await Promise.all([
          getGroqChatHistory(chat, message),
          buildBookingAiContext(
            businessId,
            clientProfile,
            senderName,
          ),
        ]);

        // Check monthly booking limit BEFORE AI processing to save tokens
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        const { data: monthlyBookings } = await getSupabaseAdmin()
          .from("bookings")
          .select("id")
          .eq("business_id", businessId)
          .gte("start_time", startOfMonth.toISOString())
          .lte("start_time", endOfMonth.toISOString());
        
        const bookingsThisMonth = monthlyBookings?.length || 0;
        
        // Get subscription to find monthly limit
        const { data: subscription } = await getSupabaseAdmin()
          .from("subscriptions")
          .select("*, plans(*)")
          .eq("business_id", businessId)
          .eq("status", "active")
          .maybeSingle();
        
        console.log("[WhatsApp AI] Subscription data:", JSON.stringify(subscription, null, 2));
        
        let monthlyLimit = 100; // Default limit
        if (subscription?.metadata) {
          // metadata might be a JSON string or object
          const metadata = typeof subscription.metadata === 'string' 
            ? JSON.parse(subscription.metadata) 
            : subscription.metadata;
          console.log("[WhatsApp AI] Parsed metadata:", JSON.stringify(metadata, null, 2));
          
          if (metadata?.custom_config?.bookingsPerMonth) {
            monthlyLimit = metadata.custom_config.bookingsPerMonth;
          }
        } else if (subscription?.plans?.metadata) {
          const planMetadata = typeof subscription.plans.metadata === 'string'
            ? JSON.parse(subscription.plans.metadata)
            : subscription.plans.metadata;
          if (planMetadata?.bookingsPerMonth) {
            monthlyLimit = planMetadata.bookingsPerMonth;
          }
        }
        
        console.log("[WhatsApp AI] bookingsThisMonth:", bookingsThisMonth, "monthlyLimit:", monthlyLimit);
        
        if (bookingsThisMonth >= monthlyLimit) {
          console.log("[WhatsApp AI] BLOCKED: Monthly booking limit reached, skipping AI processing");
          // Send limit reached message to user
          const limitMessage = `⚠️ Booking limit reached: You've created ${bookingsThisMonth} bookings this month. Your plan limit is ${monthlyLimit}. Please contact the business directly.`;
          await client.sendMessage(relevantJid, limitMessage);
          return;
        }

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
          is_first_message: isFirstMessage,
          within_business_hours: withinHours,
          current_time: currentBusinessTime(),
          action_summary: undefined,
        } as const;

        const { decision, reply: initialReply } = await getDecisionAndReply(
          history,
          businessContext,
          promptSettings,
          aiData,
          jidUser,
        );

        const reviewMode = settings.review_mode ?? "auto";
        if (reviewMode !== "auto") {
          const draftId = await saveWhatsappAiDraft({
            businessId,
            tenantId,
            remoteJid: relevantJid,
            clientId: clientProfile?.id ?? null,
            clientName,
            clientPhone: senderPhone,
            inboundMessageText: textBody,
            suggestedReply: initialReply,
            decision,
          });

          console.log("[WhatsApp AI] Draft saved instead of sending", {
            draftId,
            phone: jidUser,
            reviewMode,
          });
          return;
        }

        const actionResult = await executeAssistantAction({
          businessId,
          phone: senderPhone,
          fallbackClientName: clientName,
          settings: promptSettings,
          aiData,
          decision,
        });

        let aiResponse = initialReply;
        if (actionResult.outcome !== "none") {
          aiResponse = await getConfirmationReply(
            history,
            businessContext,
            promptSettings,
            aiData,
            jidUser,
            actionResult.summary,
          );
        }

        if (aiResponse) {
          await client.sendMessage(relevantJid, aiResponse);
          await recordActivity({
            businessId,
            actorType: "ai",
            actorId: settings.bot_name,
            entityType: "whatsapp",
            entityId: relevantJid,
            eventType: "ai_reply_sent",
            title: "AI replied on WhatsApp",
            description: aiResponse,
            metadata: {
              phone: senderPhone || jidUser,
              clientId: clientProfile?.id ?? null,
              clientName,
              actionOutcome: actionResult.outcome,
            },
          });
          console.log("[WhatsApp AI] Response sent to", jidUser);
        }
      } catch (error) {
        console.error("[WhatsApp AI] Processing failed:", error);
        try {
          await client.sendMessage(
            relevantJid,
            settings?.fallback_message ??
              "Sorry, I'm having trouble right now. A team member will help you shortly.",
          );
        } catch {
          // Best effort fallback only.
        }
      } finally {
        currentlyProcessing.delete(relevantJid);
      }
    });

    console.log("[WhatsApp] Registering inbound message handler");
    client.on("message", async (message: Message) => {
      if (message.fromMe) return;

      void storeInboundMessage(session, message).catch((error) => {
        console.error("Failed to store inbound WhatsApp message:", error);
      });

      const fromJid = message.from ?? "";
      if (fromJid.endsWith("@g.us")) return;

      const senderName = (message as { _data?: { notifyName?: string } })._data?.notifyName || "";

      // Resolve the REAL phone from contact.id. message.from and contact.number are
      // the opaque LID on LID-based accounts, NOT a phone number — storing those is
      // what created duplicate "client with the jid" records. When the phone can't
      // be recovered we skip auto-add rather than persist a LID.
      const phone = await resolveInboundPhoneNumber(message);
      const lid = extractLidFromJid(fromJid);

      console.log('[WhatsApp Message] ⬇ INBOUND:', {
        from: fromJid,
        resolvedPhone: phone || "(unresolved — skipping auto-add)",
        lid,
        senderName,
        body: message.body?.slice(0, 120),
      });

      if (phone && businessId) {
        void createClientFromWhatsApp(businessId, phone, senderName, lid);
      }
    });

    await client.initialize();
    return session;
  })();

  try {
    return await runtime.startingPromise;
  } finally {
    runtime.startingPromise = null;
  }
}

export async function waitForQrOrConnection(tenantId: string, timeoutMs = 15000): Promise<WhatsappSessionRow> {
  const existing = await getWhatsappSessionByTenantId(tenantId);
  if (existing?.status === "qrcode" || existing?.status === "connected") {
    return existing;
  }

  return new Promise<WhatsappSessionRow>((resolve, reject) => {
    const wrappedResolve = (session: WhatsappSessionRow) => {
      clearTimeout(timeout);
      resolve(session);
    };

    const timeout = setTimeout(() => {
      const waiters = qrWaiters.get(tenantId) ?? [];
      qrWaiters.set(
        tenantId,
        waiters.filter((entry) => entry !== wrappedResolve),
      );
      reject(new Error("Timed out waiting for WhatsApp QR code"));
    }, timeoutMs);

    const current = qrWaiters.get(tenantId) ?? [];
    current.push(wrappedResolve);
    qrWaiters.set(tenantId, current);
  });
}

export async function getLiveWhatsappSession(tenantId: string): Promise<WhatsappSessionRow | null> {
  const session = await getWhatsappSessionByTenantId(tenantId);
  if (!session) return null;

  const runtime = getRuntime(tenantId);
  if (runtime.client) {
    return {
      ...session,
      status: runtime.status,
      qr_code: runtime.qrCode,
      connected_phone: runtime.connectedPhone,
    };
  }

  return session;
}

/**
 * Called once at server startup.
 * Finds every WhatsApp session that was previously in "connected" state and
 * restarts the socket so the bot keeps listening in the background without
 * the user needing to open the UI.
 */
export async function autoBootWhatsappSessions(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    console.log("[WhatsApp AutoBoot] Supabase not configured – skipping auto-boot.");
    return;
  }

  const { data: sessions, error } = await getSupabaseAdmin()
    .from("whatsapp_sessions")
    .select("*")
    .eq("status", "connected");

  if (error) {
    console.error("[WhatsApp AutoBoot] Failed to query sessions:", error.message);
    return;
  }

  const rows = (sessions ?? []) as WhatsappSessionRow[];
  if (rows.length === 0) {
    console.log("[WhatsApp AutoBoot] No previously connected sessions found.");
    return;
  }

  console.log(`[WhatsApp AutoBoot] Restarting ${rows.length} session(s) in the background...`);
  for (const row of rows) {
    const tenantId = row.tenant_id;
    console.log(`[WhatsApp AutoBoot] Booting session for tenant ${tenantId}`);
    void startTenantSocket(tenantId).catch((err) => {
      console.error(`[WhatsApp AutoBoot] Failed to boot session for tenant ${tenantId}:`, err);
    });
  }
}
