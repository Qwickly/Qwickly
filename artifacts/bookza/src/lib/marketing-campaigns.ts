import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";

/**
 * Everything the campaigns list and the campaign composer both need.
 *
 * These lived inside pages/marketing.tsx, which was fine while creating a
 * campaign happened in a dialog on that page. Composing moved to its own page,
 * so the shared half moved here rather than being copied into it.
 */

export type CampaignChannel = "WhatsApp" | "Email" | "SMS";
export type CampaignStatus = "draft" | "active" | "completed";

export type Campaign = {
  id: string;
  name: string;
  type: CampaignChannel;
  status: CampaignStatus;
  sent: number;
  opened: number;
  conversions: number;
  createdAt: string;
  message: string;
  imageUrl?: string;
  recipientCount: number;
};

export type MarketingClient = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
};

export const CLIENT_FETCH_BATCH_SIZE = 100;
export const CLIENT_LIST_PAGE_SIZE = 80;
export const CAMPAIGN_PAGE_SIZE = 10;
export const EMAIL_DAILY_BATCH_SIZE = 100;
export const WHATSAPP_SEND_CONCURRENCY = 1;
export const WHATSAPP_SEND_PAUSE_MS = 30_000;
export const WHATSAPP_STOP_ERROR_PATTERNS = [
  /spam/i,
  /restricted/i,
  /temporary restriction/i,
  /rate.?limit/i,
  /too many/i,
  /blocked/i,
];

export type CampaignSendProgress = {
  total: number;
  sent: number;
  failed: number;
  processed: number;
  currentClientName: string | null;
};

export type CampaignSendResult = {
  ok: boolean;
  client: MarketingClient;
  error?: string;
};

export const wait = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

export const shouldStopCampaignForError = (message: string) =>
  WHATSAPP_STOP_ERROR_PATTERNS.some((pattern) => pattern.test(message));

export async function fetchAllMarketingClients(): Promise<MarketingClient[]> {
  const businessId = await ensureBusiness();
  const clients: MarketingClient[] = [];
  let from = 0;

  while (true) {
    const to = from + CLIENT_FETCH_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, phone, email")
      .eq("business_id", businessId)
      // Only clients with an active WhatsApp conversation can receive a campaign
      // (they're messaged from the business's own number). Cold/new contacts would
      // need the Meta route, which is disabled — so they'd be silently skipped at
      // send time. Filter them out here so the selected count matches what's sent.
      .eq("status", "active")
      .order("name", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    clients.push(
      ...rows.map((row) => ({
        id: row.id as string,
        name: (row.name as string) ?? "Unnamed client",
        phone: (row.phone as string) ?? "",
        email: (row.email as string | null) ?? null,
      })),
    );

    if (rows.length < CLIENT_FETCH_BATCH_SIZE) break;
    from += CLIENT_FETCH_BATCH_SIZE;
  }

  return clients;
}

export function makeId(): string {
  const cryptoObj = globalThis.crypto as
    | undefined
    | { randomUUID?: () => string };
  return cryptoObj?.randomUUID?.() ?? String(Date.now());
}

export function detectEmailDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  const candidates = [",", ";", "|"] as const;
  const counts = candidates.map((delimiter) => ({ delimiter, count: line.split(delimiter).length }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.delimiter ?? ",";
}

export function parseEmailCells(line: string): string[] {
  const delimiter = detectEmailDelimiter(line);
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function extractEmailAddresses(text: string): string[] {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const seen = new Set<string>();

  const addCandidate = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (emailRegex.test(normalized)) {
      seen.add(normalized);
    }
  };

  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const cell of parseEmailCells(trimmed)) {
      addCandidate(cell);
    }

    addCandidate(trimmed);
  }

  return Array.from(seen);
}
