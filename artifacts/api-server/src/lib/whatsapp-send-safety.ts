const outboundSafetyByTenant = new Map<string, { windowStart: number; messagesInWindow: number; lastSentAt: number }>();

const MIN_GAP_BETWEEN_OUTBOUND_MESSAGES_MS = 45_000;
const MAX_OUTBOUND_MESSAGES_PER_WINDOW = 4;
const OUTBOUND_WINDOW_MS = 15 * 60 * 1000;

function getSafetyState(tenantId: string) {
  const existing = outboundSafetyByTenant.get(tenantId);
  if (existing) {
    return existing;
  }

  const fresh = { windowStart: Date.now(), messagesInWindow: 0, lastSentAt: 0 };
  outboundSafetyByTenant.set(tenantId, fresh);
  return fresh;
}

export async function waitForSafeOutboundSend(tenantId: string): Promise<void> {
  const state = getSafetyState(tenantId);
  const now = Date.now();

  if (now - state.windowStart >= OUTBOUND_WINDOW_MS) {
    state.windowStart = now;
    state.messagesInWindow = 0;
  }

  const gapMs = state.lastSentAt ? MIN_GAP_BETWEEN_OUTBOUND_MESSAGES_MS - (now - state.lastSentAt) : 0;
  const windowMs = state.messagesInWindow >= MAX_OUTBOUND_MESSAGES_PER_WINDOW
    ? OUTBOUND_WINDOW_MS - (now - state.windowStart)
    : 0;

  if (gapMs <= 0 && windowMs <= 0) {
    state.lastSentAt = now;
    state.messagesInWindow += 1;
    return;
  }

  const waitMs = Math.max(gapMs, windowMs, 0) + 250;
  console.warn("[WhatsApp safety] pacing outbound send", {
    tenantId,
    waitMs,
    messagesInWindow: state.messagesInWindow,
    lastSentAt: state.lastSentAt,
  });

  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return waitForSafeOutboundSend(tenantId);
}
