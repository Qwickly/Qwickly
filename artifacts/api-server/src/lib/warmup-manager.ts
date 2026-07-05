import { getSupabaseAdmin } from "./supabase";
import { sendTenantMessageByPhone, ensureTenantClient, getLiveWhatsappSession, ensureTenantForUser } from "./whatsapp";
import { simulateTyping, humanPause } from "./whatsapp-anti-fingerprint";
import { waitForSafeOutboundSend } from "./whatsapp-send-safety";

export interface WarmUpConfig {
  day1: number;
  day2: number;
  day3: number;
  day4: number;
  day5: number;
  day6: number;
}

const DEFAULT_WARMUP_CONFIG: WarmUpConfig = {
  day1: 5,
  day2: 10,
  day3: 20,
  day4: 40,
  day5: 80,
  day6: 100,
};

/**
 * Warm-Up Manager - Handles WhatsApp number warm-up to avoid flagging
 * Gradually increases message volume over 6 days
 */
export class WarmUpManager {
  /**
   * Start warm-up for a tenant
   */
  async startWarmUp(businessId: string, tenantId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    // Check if warm-up already exists
    const { data: existing } = await supabase
      .from("warmup_config")
      .select("*")
      .eq("business_id", businessId)
      .eq("tenant_id", tenantId)
      .single();

    if (existing && existing.is_enabled) {
      console.log(`[Warm-Up Manager] Warm-up already in progress for tenant ${tenantId}`);
      return;
    }

    // Create warm-up config
    await supabase
      .from("warmup_config")
      .upsert({
        business_id: businessId,
        tenant_id: tenantId,
        is_enabled: true,
        current_day: 0,
        warm_up_started_at: new Date().toISOString(),
        daily_targets: DEFAULT_WARMUP_CONFIG as any,
      }, {
        onConflict: "business_id,tenant_id",
      });

    console.log(`[Warm-Up Manager] Started warm-up for tenant ${tenantId}`);
  }

  /**
   * Get warm-up status for a tenant
   */
  async getWarmUpStatus(businessId: string, tenantId: string): Promise<any> {
    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from("warmup_config")
      .select("*")
      .eq("business_id", businessId)
      .eq("tenant_id", tenantId)
      .single();

    return data;
  }

  /**
   * Process warm-up for the current day
   */
  async processWarmUp(businessId: string, tenantId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    const config = await this.getWarmUpStatus(businessId, tenantId);
    
    if (!config || !config.is_enabled || config.current_day >= 6) {
      console.log(`[Warm-Up Manager] No active warm-up for tenant ${tenantId}`);
      return;
    }

    const currentDay = config.current_day + 1; // Days are 1-indexed
    const dailyTargets = config.daily_targets as WarmUpConfig;
    const targetMessages = dailyTargets[`day${currentDay}` as keyof WarmUpConfig];

    console.log(`[Warm-Up Manager] Processing day ${currentDay} for tenant ${tenantId} (target: ${targetMessages} messages)`);

    // Get business owner
    const { data: business } = await supabase
      .from("businesses")
      .select("user_id")
      .eq("id", businessId)
      .single();

    if (!business) {
      throw new Error('Business not found');
    }

    // Get tenant
    const tenant = await ensureTenantForUser(business.user_id as string, businessId);
    const session = await getLiveWhatsappSession(tenant.id);

    if (!session || session.status !== "connected") {
      console.log(`[Warm-Up Manager] WhatsApp not connected for tenant ${tenantId}`);
      return;
    }

    // Get some clients to send warm-up messages to
    // Use clients that haven't been contacted recently
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, phone")
      .eq("business_id", businessId)
      .limit(targetMessages);

    if (!clients || clients.length === 0) {
      console.log(`[Warm-Up Manager] No clients found for warm-up`);
      return;
    }

    // Create warm-up day record
    const { data: warmupDay } = await supabase
      .from("number_warmup")
      .insert({
        business_id: businessId,
        tenant_id: tenantId,
        day_number: currentDay,
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!warmupDay) {
      throw new Error('Failed to create warm-up day record');
    }

    let sent = 0;
    let failed = 0;

    // Send warm-up messages
    for (const client of clients) {
      try {
        // Simulate typing
        await simulateTyping(50);
        await humanPause();

        // Send a simple warm-up message
        const warmUpMessage = `Hi ${client.name || 'there'}, just testing our WhatsApp connection. Thanks!`;
        
        await waitForSafeOutboundSend(tenant.id);
        await sendTenantMessageByPhone(tenant.id, client.phone, warmUpMessage);
        
        sent++;
        console.log(`[Warm-Up Manager] Sent warm-up message to ${client.phone}`);

        // Delay between messages
        await new Promise(resolve => setTimeout(resolve, 30000 + Math.random() * 60000)); // 30-90 seconds
      } catch (error) {
        failed++;
        console.error(`[Warm-Up Manager] Failed to send to ${client.phone}:`, error);
      }
    }

    // Update warm-up day record
    await supabase
      .from("number_warmup")
      .update({
        messages_sent: sent,
        messages_successful: sent,
        messages_failed: failed,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", warmupDay.id);

    // Update config to next day
    await supabase
      .from("warmup_config")
      .update({
        current_day: currentDay,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (currentDay >= 6) {
      // Warm-up complete
      await supabase
        .from("warmup_config")
        .update({
          is_enabled: false,
          warm_up_completed_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      console.log(`[Warm-Up Manager] Warm-up completed for tenant ${tenantId}`);
    } else {
      console.log(`[Warm-Up Manager] Day ${currentDay} completed for tenant ${tenantId}. ${sent} sent, ${failed} failed`);
    }
  }

  /**
   * Check if warm-up is complete for a tenant
   */
  async isWarmUpComplete(businessId: string, tenantId: string): Promise<boolean> {
    const config = await this.getWarmUpStatus(businessId, tenantId);
    return config ? !config.is_enabled || config.current_day >= 6 : false;
  }

  /**
   * Cancel warm-up for a tenant
   */
  async cancelWarmUp(businessId: string, tenantId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    await supabase
      .from("warmup_config")
      .update({
        is_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .eq("tenant_id", tenantId);

    console.log(`[Warm-Up Manager] Cancelled warm-up for tenant ${tenantId}`);
  }

  /**
   * Get warm-up progress for a tenant
   */
  async getWarmUpProgress(businessId: string, tenantId: string): Promise<{
    currentDay: number;
    totalDays: number;
    isComplete: boolean;
    dailyProgress: Array<{ day: number; sent: number; target: number; status: string }>;
  }> {
    const supabase = getSupabaseAdmin();

    const config = await this.getWarmUpStatus(businessId, tenantId);
    const dailyTargets = config?.daily_targets as WarmUpConfig || DEFAULT_WARMUP_CONFIG;

    const { data: warmupDays } = await supabase
      .from("number_warmup")
      .select("*")
      .eq("business_id", businessId)
      .eq("tenant_id", tenantId)
      .order("day_number", { ascending: true });

    const dailyProgress = Array.from({ length: 6 }, (_, i) => {
      const dayData = warmupDays?.find(d => d.day_number === i + 1);
      return {
        day: i + 1,
        sent: dayData?.messages_sent || 0,
        target: dailyTargets[`day${i + 1}` as keyof WarmUpConfig],
        status: dayData?.status || 'pending',
      };
    });

    return {
      currentDay: config?.current_day || 0,
      totalDays: 6,
      isComplete: await this.isWarmUpComplete(businessId, tenantId),
      dailyProgress,
    };
  }
}
