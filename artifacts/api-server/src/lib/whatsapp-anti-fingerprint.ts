/**
 * WhatsApp Anti-Fingerprinting Library
 * 
 * This library provides human-like messaging patterns to avoid WhatsApp's
 * anti-fraud telemetry and spam detection systems.
 * 
 * Features:
 * - Randomized delays between messages (15-45 seconds)
 * - Cool-down/rest breaks after batches (35-50 messages, 10-15 minute pause)
 * - Spintax template parsing for message randomization
 * - Rotational scheduling across multiple session tokens
 */

import { randomInt } from 'node:crypto';

// ============================================================================
// HUMANIZED DELAY SYSTEM
// ============================================================================

/**
 * Generate a random delay between min and max seconds
 * @param minSeconds Minimum delay in seconds (default: 15)
 * @param maxSeconds Maximum delay in seconds (default: 45)
 * @returns Delay in milliseconds
 */
export function getRandomDelay(minSeconds = 15, maxSeconds = 45): number {
  const seconds = randomInt(minSeconds, maxSeconds + 1);
  return seconds * 1000;
}

/**
 * Wait for a randomized delay
 * @param minSeconds Minimum delay in seconds (default: 15)
 * @param maxSeconds Maximum delay in seconds (default: 45)
 */
export async function humanizedDelay(minSeconds = 15, maxSeconds = 45): Promise<void> {
  const delay = getRandomDelay(minSeconds, maxSeconds);
  await new Promise(resolve => setTimeout(resolve, delay));
}

// ============================================================================
// COOL-DOWN / REST BREAK SYSTEM
// ============================================================================

export interface CoolDownConfig {
  minBatchSize: number;
  maxBatchSize: number;
  minCooldownMinutes: number;
  maxCooldownMinutes: number;
}

export const DEFAULT_COOLDOWN_CONFIG: CoolDownConfig = {
  minBatchSize: 20,
  maxBatchSize: 30,
  minCooldownMinutes: 5,
  maxCooldownMinutes: 8,
};

export class CoolDownManager {
  private messagesSentInBatch = 0;
  private currentBatchSize: number;
  private config: CoolDownConfig;

  constructor(config: CoolDownConfig = DEFAULT_COOLDOWN_CONFIG) {
    this.config = config;
    this.currentBatchSize = randomInt(config.minBatchSize, config.maxBatchSize + 1);
  }

  /**
   * Check if a cool-down is needed and wait if necessary
   * @returns Promise that resolves when cool-down is complete (or immediately if not needed)
   */
  async checkAndWaitIfNeeded(): Promise<void> {
    this.messagesSentInBatch++;

    if (this.messagesSentInBatch >= this.currentBatchSize) {
      const cooldownMinutes = randomInt(
        this.config.minCooldownMinutes,
        this.config.maxCooldownMinutes + 1
      );
      const cooldownMs = cooldownMinutes * 60 * 1000;

      console.log(
        `[WhatsApp Anti-Fingerprint] Cool-down triggered: pausing for ${cooldownMinutes} minutes ` +
        `after ${this.messagesSentInBatch} messages`
      );

      await new Promise(resolve => setTimeout(resolve, cooldownMs));

      // Reset for next batch
      this.messagesSentInBatch = 0;
      this.currentBatchSize = randomInt(
        this.config.minBatchSize,
        this.config.maxBatchSize + 1
      );

      console.log(
        `[WhatsApp Anti-Fingerprint] Cool-down complete. Next batch size: ${this.currentBatchSize}`
      );
    }
  }

  /**
   * Reset the cool-down manager (useful for restarting campaigns)
   */
  reset(): void {
    this.messagesSentInBatch = 0;
    this.currentBatchSize = randomInt(
      this.config.minBatchSize,
      this.config.maxBatchSize + 1
    );
  }

  /**
   * Get current batch progress
   */
  getProgress(): { sent: number; total: number } {
    return {
      sent: this.messagesSentInBatch,
      total: this.currentBatchSize,
    };
  }
}

// ============================================================================
// SPINTAX TEMPLATE PARSER
// ============================================================================

/**
 * Parse spintax format and return a random variation
 * Spintax format: {option1|option2|option3}
 * Example: "{Hello|Hi|Hey} [Name], {here is your update|just following up}."
 * 
 * @param template String with spintax format
 * @param variables Object with variable replacements (e.g., { Name: "John" })
 * @returns Randomized message with variables replaced
 */
export function parseSpintax(template: string, variables: Record<string, string> = {}): string {
  let result = template;

  // First, replace variables [variable_name] with actual values
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\[${key}\\]`, 'gi');
    result = result.replace(regex, value);
  });

  // Then, parse spintax {option1|option2|option3}
  // Process nested spintax by repeatedly parsing until no more { } found
  let maxIterations = 100; // Prevent infinite loops
  let iterations = 0;

  while (result.includes('{') && result.includes('}') && iterations < maxIterations) {
    iterations++;

    // Find the innermost spintax group
    const regex = /\{([^{}]+)\}/;
    const match = result.match(regex);

    if (!match) break;

    const options = match[1].split('|');
    const selectedOption = options[randomInt(0, options.length)];
    result = result.replace(match[0], selectedOption);
  }

  return result;
}

/**
 * Parse spintax and return all possible variations
 * Useful for testing or previewing message variations
 * 
 * @param template String with spintax format
 * @returns Array of all possible message variations
 */
export function getAllSpintaxVariations(template: string): string[] {
  const variations: string[] = [];

  function generateVariations(current: string): void {
    const match = current.match(/\{([^{}]+)\}/);
    if (!match) {
      variations.push(current);
      return;
    }

    const options = match[1].split('|');
    options.forEach(option => {
      const newString = current.replace(match[0], option);
      generateVariations(newString);
    });
  }

  generateVariations(template);
  return variations;
}

// ============================================================================
// ROTATIONAL SCHEDULING
// ============================================================================

export interface SessionToken {
  id: string;
  token: string;
  dataDirectory: string;
  lastUsed: Date;
  messagesSentToday: number;
  isAvailable: boolean;
}

export class RotationalScheduler {
  private sessions: Map<string, SessionToken> = new Map();
  private currentIndex = 0;
  private dailyLimitPerSession = 1000; // WhatsApp's typical daily limit

  /**
   * Add a session token to the rotation pool
   */
  addSession(session: Omit<SessionToken, 'lastUsed' | 'messagesSentToday' | 'isAvailable'>): void {
    const fullSession: SessionToken = {
      ...session,
      lastUsed: new Date(),
      messagesSentToday: 0,
      isAvailable: true,
    };
    this.sessions.set(session.id, fullSession);
  }

  /**
   * Get the next available session token
   * Rotates through available sessions, skipping those that have hit daily limits
   */
  getNextSession(): SessionToken | null {
    const sessionIds = Array.from(this.sessions.keys());
    if (sessionIds.length === 0) return null;

    // Try to find an available session starting from current index
    for (let i = 0; i < sessionIds.length; i++) {
      const index = (this.currentIndex + i) % sessionIds.length;
      const session = this.sessions.get(sessionIds[index]);

      if (session && session.isAvailable && session.messagesSentToday < this.dailyLimitPerSession) {
        this.currentIndex = (index + 1) % sessionIds.length;
        session.lastUsed = new Date();
        session.messagesSentToday++;
        return session;
      }
    }

    // No available sessions
    return null;
  }

  /**
   * Mark a session as unavailable (e.g., if it got banned)
   */
  markSessionUnavailable(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isAvailable = false;
      console.log(`[WhatsApp Anti-Fingerprint] Session ${sessionId} marked as unavailable`);
    }
  }

  /**
   * Reset daily message counts (call this at start of each day)
   */
  resetDailyCounts(): void {
    this.sessions.forEach(session => {
      session.messagesSentToday = 0;
      // Re-enable sessions that were previously unavailable
      // (they might have been temporarily banned)
      if (!session.isAvailable) {
        session.isAvailable = true;
        console.log(`[WhatsApp Anti-Fingerprint] Session ${session.id} re-enabled after daily reset`);
      }
    });
  }

  /**
   * Get statistics about current session pool
   */
  getStats(): {
    totalSessions: number;
    availableSessions: number;
    unavailableSessions: number;
    totalMessagesSent: number;
  } {
    let available = 0;
    let unavailable = 0;
    let totalMessages = 0;

    this.sessions.forEach(session => {
      if (session.isAvailable) available++;
      else unavailable++;
      totalMessages += session.messagesSentToday;
    });

    return {
      totalSessions: this.sessions.size,
      availableSessions: available,
      unavailableSessions: unavailable,
      totalMessagesSent: totalMessages,
    };
  }

  /**
   * Remove a session from the rotation pool
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

// ============================================================================
// COMBINED MESSAGE SENDER
// ============================================================================

export interface SendMessageOptions {
  tenantId: string;
  recipientPhone: string;
  messageTemplate: string;
  variables?: Record<string, string>;
  imageUrl?: string;
  onProgress?: (progress: { sent: number; total: number; currentRecipient: string }) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface AntiFingerprintConfig {
  cooldownConfig?: CoolDownConfig;
  enableSpintax?: boolean;
  enableRotationalScheduling?: boolean;
}

export class WhatsAppAntiFingerprintSender {
  private coolDownManager: CoolDownManager;
  private spintaxEnabled: boolean;
  private rotationalScheduler: RotationalScheduler | null;

  constructor(config: AntiFingerprintConfig = {}) {
    this.coolDownManager = new CoolDownManager(config.cooldownConfig);
    this.spintaxEnabled = config.enableSpintax ?? true;
    this.rotationalScheduler = config.enableRotationalScheduling 
      ? new RotationalScheduler() 
      : null;
  }

  /**
   * Send a single message with anti-fingerprinting measures
   */
  async sendMessage(
    sendFn: (recipientPhone: string, message: string, imageUrl?: string) => Promise<void>,
    recipientPhone: string,
    messageTemplate: string,
    variables: Record<string, string> = {},
    imageUrl?: string
  ): Promise<void> {
    // Apply spintax if enabled
    const message = this.spintaxEnabled 
      ? parseSpintax(messageTemplate, variables)
      : messageTemplate;

    // Send the message
    await sendFn(recipientPhone, message, imageUrl);

    // Apply humanized delay
    await humanizedDelay();

    // Check and apply cool-down if needed
    await this.coolDownManager.checkAndWaitIfNeeded();
  }

  /**
   * Send messages to multiple recipients with anti-fingerprinting
   */
  async sendBulkMessages(
    sendFn: (recipientPhone: string, message: string, imageUrl?: string) => Promise<void>,
    recipients: Array<{ phone: string; variables?: Record<string, string> }>,
    messageTemplate: string,
    imageUrl?: string,
    onProgress?: (progress: { sent: number; total: number; currentRecipient: string }) => void
  ): Promise<{ sent: number; failed: number; errors: Error[] }> {
    const errors: Error[] = [];
    let sent = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      
      try {
        await this.sendMessage(
          sendFn,
          recipient.phone,
          messageTemplate,
          recipient.variables || {},
          imageUrl
        );
        sent++;

        if (onProgress) {
          onProgress({
            sent: i + 1,
            total: recipients.length,
            currentRecipient: recipient.phone,
          });
        }
      } catch (error) {
        errors.push(error as Error);
        console.error(`[WhatsApp Anti-Fingerprint] Failed to send to ${recipient.phone}:`, error);
      }
    }

    return { sent, failed: recipients.length - sent, errors };
  }

  /**
   * Get the cool-down manager (for external monitoring)
   */
  getCoolDownManager(): CoolDownManager {
    return this.coolDownManager;
  }

  /**
   * Get the rotational scheduler (for external monitoring)
   */
  getRotationalScheduler(): RotationalScheduler | null {
    return this.rotationalScheduler;
  }

  /**
   * Reset the sender state
   */
  reset(): void {
    this.coolDownManager.reset();
  }
}
