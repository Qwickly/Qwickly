import { Client } from "@whiskeysockets/baileys";
import { toWhatsAppMsisdn } from "./whatsapp";
import { getSupabaseAdmin } from "./supabase";

export interface VerificationResult {
  isValid: boolean;
  isOnWhatsApp: boolean;
  isBlocked: boolean;
  isRestricted: boolean;
  phone: string;
  jid?: string;
  reason?: string;
}

export interface BlacklistedNumber {
  phone: string;
  reason: string;
  blacklistedAt: Date;
  businessId: string;
}

/**
 * WhatsApp Number Verification - Validates numbers before sending to avoid flagging
 */
export class WhatsAppNumberVerifier {
  private blacklistCache = new Map<string, BlacklistedNumber>();
  private cacheExpiry = 5 * 60 * 1000; // 5 minutes

  /**
   * Verify a phone number before sending
   */
  async verifyNumber(
    client: Client,
    phone: string,
    businessId: string
  ): Promise<VerificationResult> {
    const result: VerificationResult = {
      isValid: false,
      isOnWhatsApp: false,
      isBlocked: false,
      isRestricted: false,
      phone,
    };

    try {
      // Check blacklist first
      const blacklisted = await this.isBlacklisted(phone, businessId);
      if (blacklisted) {
        result.isBlocked = true;
        result.reason = blacklisted.reason;
        console.log(`[Number Verifier] Number ${phone} is blacklisted: ${blacklisted.reason}`);
        return result;
      }

      // Validate phone format
      const msisdn = toWhatsAppMsisdn(phone);
      if (!msisdn || msisdn.length < 10) {
        result.reason = "Invalid phone format";
        console.log(`[Number Verifier] Invalid phone format: ${phone}`);
        return result;
      }

      result.isValid = true;

      // Check if number is on WhatsApp
      const numberId = await client.getNumberId(msisdn);
      
      if (!numberId) {
        result.isOnWhatsApp = false;
        result.reason = "Number not on WhatsApp";
        console.log(`[Number Verifier] Number ${phone} not on WhatsApp`);
        return result;
      }

      result.isOnWhatsApp = true;
      result.jid = numberId._serialized;

      console.log(`[Number Verifier] Number ${phone} verified successfully`);
      return result;
    } catch (error) {
      result.reason = error instanceof Error ? error.message : "Verification failed";
      console.error(`[Number Verifier] Error verifying ${phone}:`, error);
      return result;
    }
  }

  /**
   * Batch verify multiple numbers
   */
  async verifyBatch(
    client: Client,
    phones: string[],
    businessId: string
  ): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>();

    // Add delay between verifications to avoid detection
    for (const phone of phones) {
      const result = await this.verifyNumber(client, phone, businessId);
      results.set(phone, result);
      
      // Small delay between checks
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    }

    return results;
  }

  /**
   * Blacklist a number that caused issues
   */
  async blacklistNumber(
    phone: string,
    businessId: string,
    reason: string
  ): Promise<void> {
    const supabase = getSupabaseAdmin();

    // Add to database
    await supabase.from("blacklisted_numbers").insert({
      business_id: businessId,
      phone,
      reason,
      blacklisted_at: new Date().toISOString(),
    });

    // Add to cache
    this.blacklistCache.set(phone, {
      phone,
      reason,
      blacklistedAt: new Date(),
      businessId,
    });

    console.log(`[Number Verifier] Blacklisted ${phone}: ${reason}`);
  }

  /**
   * Check if a number is blacklisted
   */
  async isBlacklisted(phone: string, businessId: string): Promise<BlacklistedNumber | null> {
    // Check cache first
    const cached = this.blacklistCache.get(phone);
    if (cached && Date.now() - cached.blacklistedAt.getTime() < this.cacheExpiry) {
      return cached;
    }

    // Check database
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("blacklisted_numbers")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .single();

    if (data) {
      const blacklisted: BlacklistedNumber = {
        phone: data.phone,
        reason: data.reason,
        blacklistedAt: new Date(data.blacklisted_at),
        businessId: data.business_id,
      };
      
      // Cache it
      this.blacklistCache.set(phone, blacklisted);
      return blacklisted;
    }

    return null;
  }

  /**
   * Remove a number from blacklist
   */
  async unblacklistNumber(phone: string, businessId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    await supabase
      .from("blacklisted_numbers")
      .delete()
      .eq("business_id", businessId)
      .eq("phone", phone);

    // Remove from cache
    this.blacklistCache.delete(phone);

    console.log(`[Number Verifier] Removed ${phone} from blacklist`);
  }

  /**
   * Get all blacklisted numbers for a business
   */
  async getBlacklistedNumbers(businessId: string): Promise<BlacklistedNumber[]> {
    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from("blacklisted_numbers")
      .select("*")
      .eq("business_id", businessId)
      .order("blacklisted_at", { ascending: false });

    return (data || []).map(d => ({
      phone: d.phone,
      reason: d.reason,
      blacklistedAt: new Date(d.blacklisted_at),
      businessId: d.business_id,
    }));
  }

  /**
   * Auto-blacklist a number if sending fails multiple times
   */
  async handleSendFailure(
    phone: string,
    businessId: string,
    error: string
  ): Promise<void> {
    const failureReasons = [
      "blocked",
      "restricted",
      "banned",
      "403",
      "401",
      "disconnected",
    ];

    const shouldBlacklist = failureReasons.some(reason => 
      error.toLowerCase().includes(reason)
    );

    if (shouldBlacklist) {
      await this.blacklistNumber(phone, businessId, `Auto-blacklisted: ${error}`);
      console.log(`[Number Verifier] Auto-blacklisted ${phone} due to: ${error}`);
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [phone, entry] of this.blacklistCache.entries()) {
      if (now - entry.blacklistedAt.getTime() > this.cacheExpiry) {
        this.blacklistCache.delete(phone);
      }
    }
  }
}

// Global verifier instance
let globalVerifier: WhatsAppNumberVerifier | null = null;

/**
 * Get the global verifier instance
 */
export function getGlobalVerifier(): WhatsAppNumberVerifier {
  if (!globalVerifier) {
    globalVerifier = new WhatsAppNumberVerifier();
  }
  return globalVerifier;
}
