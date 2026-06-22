interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_PREFIX = 'whatsapp_';
const CONVERSATIONS_CACHE_KEY = `${CACHE_PREFIX}conversations`;
const MESSAGES_CACHE_KEY_PREFIX = `${CACHE_PREFIX}messages_`;
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function getCachedConversations<T>(): T | undefined {
  try {
    const cached = localStorage.getItem(CONVERSATIONS_CACHE_KEY);
    if (!cached) return undefined;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const isExpired = Date.now() - entry.timestamp > CACHE_EXPIRY_MS;

    if (isExpired) {
      localStorage.removeItem(CONVERSATIONS_CACHE_KEY);
      return undefined;
    }

    return entry.data;
  } catch {
    return undefined;
  }
}

export function setCachedConversations<T>(data: T): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(CONVERSATIONS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

export function getCachedMessages<T>(conversationId: number): T | undefined {
  try {
    const key = `${MESSAGES_CACHE_KEY_PREFIX}${conversationId}`;
    const cached = localStorage.getItem(key);
    if (!cached) return undefined;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const isExpired = Date.now() - entry.timestamp > CACHE_EXPIRY_MS;

    if (isExpired) {
      localStorage.removeItem(key);
      return undefined;
    }

    return entry.data;
  } catch {
    return undefined;
  }
}

export function setCachedMessages<T>(conversationId: number, data: T): void {
  try {
    const key = `${MESSAGES_CACHE_KEY_PREFIX}${conversationId}`;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

export function clearWhatsAppCache(): void {
  try {
    localStorage.removeItem(CONVERSATIONS_CACHE_KEY);
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(MESSAGES_CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch {
    // Ignore storage errors
  }
}
