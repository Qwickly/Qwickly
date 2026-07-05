import { getSupabaseAdmin } from "./supabase";
import { EngagementTracker } from "./engagement-tracker";
import { 
  sendTenantMessageByPhone, 
  ensureTenantClient, 
  getLiveWhatsappSession,
  ensureTenantForUser 
} from "./whatsapp";
import { 
  simulateTyping, 
  humanPause, 
  RecipientRateLimiter,
  CoolDownManager,
  DEFAULT_COOLDOWN_CONFIG
} from "./whatsapp-anti-fingerprint";

export interface ScheduledCampaign {
  id: string;
  businessId: string;
  campaignId?: string;
  recipientIds: string[];
  message: string;
  imageUrl?: string;
  scheduledFor: Date;
  timezone: string;
  enableAntiFingerprinting: boolean;
  batchSize: number;
  batchDelayMinutes: number;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
}

/**
 * Campaign Scheduler - Handles scheduled WhatsApp campaigns
 */
export class CampaignScheduler {
  private engagementTracker: EngagementTracker;
  private rateLimiter: RecipientRateLimiter;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    this.engagementTracker = new EngagementTracker();
    this.rateLimiter = new RecipientRateLimiter(1); // Once per day per recipient
  }

  /**
   * Start the scheduler (runs every minute to check for due campaigns)
   */
  start(): void {
    if (this.isRunning) {
      console.log('[Campaign Scheduler] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[Campaign Scheduler] Started');

    // Check every minute
    this.checkInterval = setInterval(() => {
      this.checkAndRunDueCampaigns();
    }, 60 * 1000);

    // Check immediately on start
    this.checkAndRunDueCampaigns();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[Campaign Scheduler] Stopped');
  }

  /**
   * Check for campaigns that are due and run them
   */
  private async checkAndRunDueCampaigns(): Promise<void> {
    try {
      const supabase = getSupabaseAdmin();
      const now = new Date().toISOString();

      // Get pending campaigns that are due
      const { data: dueCampaigns } = await supabase
        .from("scheduled_campaigns")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_for", now);

      if (!dueCampaigns || dueCampaigns.length === 0) {
        return;
      }

      console.log(`[Campaign Scheduler] Found ${dueCampaigns.length} due campaigns`);

      // Process each due campaign
      for (const campaign of dueCampaigns) {
        await this.runScheduledCampaign(campaign);
      }
    } catch (error) {
      console.error('[Campaign Scheduler] Error checking due campaigns:', error);
    }
  }

  /**
   * Run a scheduled campaign
   */
  private async runScheduledCampaign(campaign: any): Promise<void> {
    const supabase = getSupabaseAdmin();

    try {
      console.log(`[Campaign Scheduler] Running campaign ${campaign.id}`);

      // Update status to running
      await supabase
        .from("scheduled_campaigns")
        .update({ status: "running" })
        .eq("id", campaign.id);

      // Get business owner to get tenant
      const { data: business } = await supabase
        .from("businesses")
        .select("user_id")
        .eq("id", campaign.business_id)
        .single();

      if (!business) {
        throw new Error('Business not found');
      }

      // Get tenant
      const tenant = await ensureTenantForUser(business.user_id as string, campaign.business_id);
      const session = await getLiveWhatsappSession(tenant.id);

      if (!session || session.status !== "connected") {
        throw new Error('WhatsApp not connected');
      }

      // Get client data for recipients
      const { data: clients } = await supabase
        .from("clients")
        .select("id, name, phone")
        .in("id", campaign.recipient_ids)
        .eq("business_id", campaign.business_id);

      if (!clients || clients.length === 0) {
        throw new Error('No clients found');
      }

      // Split into batches
      const batches = [];
      for (let i = 0; i < clients.length; i += campaign.batch_size) {
        batches.push(clients.slice(i, i + campaign.batch_size));
      }

      console.log(`[Campaign Scheduler] Split into ${batches.length} batches`);

      let totalSent = 0;
      let totalFailed = 0;

      // Process batches
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`[Campaign Scheduler] Processing batch ${batchIndex + 1}/${batches.length}`);

        const coolDownManager = new CoolDownManager(DEFAULT_COOLDOWN_CONFIG);

        for (const client of batch) {
          try {
            // Check rate limit
            if (!this.rateLimiter.canSendTo(client.phone)) {
              console.log(`[Campaign Scheduler] Rate limited: ${client.phone}`);
              totalFailed++;
              continue;
            }

            // Anti-fingerprinting: simulate typing
            if (campaign.enable_anti_fingerprinting) {
              await simulateTyping(campaign.message.length);
              await humanPause();
            }

            // Send message
            const result = await sendTenantMessageByPhone(
              tenant.id,
              client.phone,
              campaign.message,
              campaign.image_url
            );

            // Record engagement
            await this.engagementTracker.recordSent({
              businessId: campaign.business_id,
              campaignId: campaign.campaign_id,
              scheduledCampaignId: campaign.id,
              recipientPhone: client.phone,
              recipientName: client.name,
              messageId: result.messageId,
              timezone: campaign.timezone,
            });

            // Update insights
            await this.engagementTracker.updateInsights(
              campaign.business_id,
              client.phone,
              client.name
            );

            // Record sent
            this.rateLimiter.recordSent(client.phone);
            totalSent++;

            console.log(`[Campaign Scheduler] Sent to ${client.phone}`);

            // Anti-fingerprinting: delay between messages
            if (campaign.enable_anti_fingerprinting) {
              await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10000)); // 5-15 seconds
              await coolDownManager.checkAndWaitIfNeeded();
            }
          } catch (error) {
            console.error(`[Campaign Scheduler] Failed to send to ${client.phone}:`, error);
            totalFailed++;
          }
        }

        // Delay between batches
        if (batchIndex < batches.length - 1) {
          const delayMs = campaign.batch_delay_minutes * 60 * 1000;
          console.log(`[Campaign Scheduler] Waiting ${campaign.batch_delay_minutes} minutes before next batch`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      // Update campaign status
      await supabase
        .from("scheduled_campaigns")
        .update({
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);

      console.log(`[Campaign Scheduler] Campaign ${campaign.id} completed: ${totalSent} sent, ${totalFailed} failed`);

    } catch (error) {
      console.error(`[Campaign Scheduler] Error running campaign ${campaign.id}:`, error);

      // Update status to failed
      await supabase
        .from("scheduled_campaigns")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id);
    }
  }

  /**
   * Schedule a new campaign
   */
  async scheduleCampaign(data: {
    businessId: string;
    campaignId?: string;
    recipientIds: string[];
    message: string;
    imageUrl?: string;
    scheduledFor: Date;
    timezone: string;
    enableAntiFingerprinting?: boolean;
    batchSize?: number;
    batchDelayMinutes?: number;
  }): Promise<string> {
    const supabase = getSupabaseAdmin();

    const { data: campaign } = await supabase
      .from("scheduled_campaigns")
      .insert({
        business_id: data.businessId,
        campaign_id: data.campaignId,
        recipient_ids: data.recipientIds,
        message: data.message,
        image_url: data.imageUrl,
        scheduled_for: data.scheduledFor.toISOString(),
        timezone: data.timezone,
        enable_anti_fingerprinting: data.enableAntiFingerprinting ?? true,
        batch_size: data.batchSize ?? 100,
        batch_delay_minutes: data.batchDelayMinutes ?? 45,
        status: "pending",
      })
      .select("id")
      .single();

    if (!campaign) {
      throw new Error('Failed to schedule campaign');
    }

    console.log(`[Campaign Scheduler] Scheduled campaign ${campaign.id} for ${data.scheduledFor.toISOString()}`);
    return campaign.id;
  }

  /**
   * Cancel a scheduled campaign
   */
  async cancelCampaign(campaignId: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    await supabase
      .from("scheduled_campaigns")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`[Campaign Scheduler] Cancelled campaign ${campaignId}`);
  }

  /**
   * Get scheduled campaigns for a business
   */
  async getScheduledCampaigns(businessId: string): Promise<any[]> {
    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from("scheduled_campaigns")
      .select("*")
      .eq("business_id", businessId)
      .in("status", ["pending", "running"])
      .order("scheduled_for", { ascending: true });

    return data || [];
  }
}

// Global scheduler instance
let globalScheduler: CampaignScheduler | null = null;

/**
 * Get the global scheduler instance
 */
export function getGlobalScheduler(): CampaignScheduler {
  if (!globalScheduler) {
    globalScheduler = new CampaignScheduler();
  }
  return globalScheduler;
}
