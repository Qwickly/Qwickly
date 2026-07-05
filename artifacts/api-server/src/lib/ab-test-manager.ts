import { getSupabaseAdmin } from "./supabase";
import { EngagementTracker } from "./engagement-tracker";
import { sendTenantMessageByPhone, ensureTenantClient, getLiveWhatsappSession, ensureTenantForUser } from "./whatsapp";
import { simulateTyping, humanPause } from "./whatsapp-anti-fingerprint";

export interface ABTestConfig {
  businessId: string;
  campaignId?: string;
  name: string;
  messageA: string;
  messageB: string;
  imageUrlA?: string;
  imageUrlB?: string;
  splitPercentage: number; // Percentage for message A
}

export interface ABTestResult {
  winner: 'A' | 'B' | 'tie' | 'inconclusive';
  statisticalSignificance: number;
  conversionRateA: number;
  conversionRateB: number;
  openRateA: number;
  openRateB: number;
  responseRateA: number;
  responseRateB: number;
}

/**
 * A/B Test Manager - Handles A/B testing for campaigns
 */
export class ABTestManager {
  private engagementTracker: EngagementTracker;

  constructor() {
    this.engagementTracker = new EngagementTracker();
  }

  /**
   * Create a new A/B test
   */
  async createABTest(config: ABTestConfig): Promise<string> {
    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from("ab_tests")
      .insert({
        business_id: config.businessId,
        campaign_id: config.campaignId,
        name: config.name,
        message_a: config.messageA,
        message_b: config.messageB,
        image_url_a: config.imageUrlA,
        image_url_b: config.imageUrlB,
        split_percentage: config.splitPercentage,
        status: "pending",
      })
      .select("id")
      .single();

    if (!data) {
      throw new Error('Failed to create A/B test');
    }

    console.log(`[AB Test Manager] Created A/B test ${data.id}`);
    return data.id;
  }

  /**
   * Start an A/B test
   */
  async startABTest(
    abTestId: string,
    recipientIds: string[]
  ): Promise<void> {
    const supabase = getSupabaseAdmin;

    // Get A/B test details
    const { data: abTest } = await supabase()
      .from("ab_tests")
      .select("*")
      .eq("id", abTestId)
      .single();

    if (!abTest) {
      throw new Error('A/B test not found');
    }

    // Update status to running
    await supabase()
      .from("ab_tests")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", abTestId);

    // Split recipients based on split percentage
    const splitIndex = Math.floor(recipientIds.length * (abTest.split_percentage / 100));
    const groupA = recipientIds.slice(0, splitIndex);
    const groupB = recipientIds.slice(splitIndex);

    console.log(`[AB Test Manager] Split: ${groupA.length} in group A, ${groupB.length} in group B`);

    // Get business owner
    const { data: business } = await supabase()
      .from("businesses")
      .select("user_id")
      .eq("id", abTest.business_id)
      .single();

    if (!business) {
      throw new Error('Business not found');
    }

    // Get tenant
    const tenant = await ensureTenantForUser(business.user_id as string, abTest.business_id);
    const session = await getLiveWhatsappSession(tenant.id);

    if (!session || session.status !== "connected") {
      throw new Error('WhatsApp not connected');
    }

    // Get client data
    const { data: clients } = await supabase()
      .from("clients")
      .select("id, name, phone")
      .in("id", recipientIds)
      .eq("business_id", abTest.business_id);

    if (!clients) {
      throw new Error('No clients found');
    }

    // Send to group A
    for (const clientId of groupA) {
      const client = clients.find(c => c.id === clientId);
      if (!client) continue;

      try {
        await simulateTyping(abTest.message_a.length);
        await humanPause();

        const result = await sendTenantMessageByPhone(
          tenant.id,
          client.phone,
          abTest.message_a,
          abTest.image_url_a
        );

        // Record assignment
        await supabase()
          .from("ab_test_assignments")
          .insert({
            ab_test_id: abTestId,
            recipient_phone: client.phone,
            variant: "A",
            sent_at: new Date().toISOString(),
          });

        // Record engagement
        await this.engagementTracker.recordSent({
          businessId: abTest.business_id,
          campaignId: abTest.campaign_id,
          recipientPhone: client.phone,
          recipientName: client.name,
          messageId: result.messageId || undefined,
        });

        console.log(`[AB Test Manager] Sent variant A to ${client.phone}`);

        // Delay
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10000));
      } catch (error) {
        console.error(`[AB Test Manager] Failed to send A to ${client.phone}:`, error);
      }
    }

    // Send to group B
    for (const clientId of groupB) {
      const client = clients.find(c => c.id === clientId);
      if (!client) continue;

      try {
        await simulateTyping(abTest.message_b.length);
        await humanPause();

        const result = await sendTenantMessageByPhone(
          tenant.id,
          client.phone,
          abTest.message_b,
          abTest.image_url_b
        );

        // Record assignment
        await supabase()
          .from("ab_test_assignments")
          .insert({
            ab_test_id: abTestId,
            recipient_phone: client.phone,
            variant: "B",
            sent_at: new Date().toISOString(),
          });

        // Record engagement
        await this.engagementTracker.recordSent({
          businessId: abTest.business_id,
          campaignId: abTest.campaign_id,
          recipientPhone: client.phone,
          recipientName: client.name,
          messageId: result.messageId || undefined,
        });

        console.log(`[AB Test Manager] Sent variant B to ${client.phone}`);

        // Delay
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10000));
      } catch (error) {
        console.error(`[AB Test Manager] Failed to send B to ${client.phone}:`, error);
      }
    }

    console.log(`[AB Test Manager] A/B test ${abTestId} started`);
  }

  /**
   * Calculate A/B test results
   */
  async calculateResults(abTestId: string): Promise<ABTestResult> {
    const supabase = getSupabaseAdmin;

    const { data: abTest } = await supabase()
      .from("ab_tests")
      .select("*")
      .eq("id", abTestId)
      .single();

    if (!abTest) {
      throw new Error('A/B test not found');
    }

    // Get assignments
    const { data: assignments } = await supabase()
      .from("ab_test_assignments")
      .select("*")
      .eq("ab_test_id", abTestId);

    if (!assignments) {
      throw new Error('No assignments found');
    }

    // Calculate metrics for each variant
    const groupA = assignments.filter(a => a.variant === "A");
    const groupB = assignments.filter(a => a.variant === "B");

    const sampleSizeA = groupA.length;
    const sampleSizeB = groupB.length;

    const opensA = groupA.filter(a => a.opened_at).length;
    const opensB = groupB.filter(a => a.opened_at).length;

    const responsesA = groupA.filter(a => a.responded_at).length;
    const responsesB = groupB.filter(a => a.responded_at).length;

    const conversionsA = groupA.filter(a => a.converted_at).length;
    const conversionsB = groupB.filter(a => a.converted_at).length;

    const openRateA = sampleSizeA > 0 ? opensA / sampleSizeA : 0;
    const openRateB = sampleSizeB > 0 ? opensB / sampleSizeB : 0;

    const responseRateA = sampleSizeA > 0 ? responsesA / sampleSizeA : 0;
    const responseRateB = sampleSizeB > 0 ? responsesB / sampleSizeB : 0;

    const conversionRateA = sampleSizeA > 0 ? conversionsA / sampleSizeA : 0;
    const conversionRateB = sampleSizeB > 0 ? conversionsB / sampleSizeB : 0;

    // Determine winner based on conversion rate
    let winner: 'A' | 'B' | 'tie' | 'inconclusive' = 'inconclusive';
    
    if (conversionRateA > conversionRateB && conversionRateA - conversionRateB > 0.05) {
      winner = 'A';
    } else if (conversionRateB > conversionRateA && conversionRateB - conversionRateA > 0.05) {
      winner = 'B';
    } else if (Math.abs(conversionRateA - conversionRateB) < 0.05) {
      winner = 'tie';
    }

    // Calculate statistical significance (simplified)
    const statisticalSignificance = this.calculateStatisticalSignificance(
      conversionsA,
      sampleSizeA,
      conversionsB,
      sampleSizeB
    );

    // Update A/B test with results
    await supabase()
      .from("ab_tests")
      .update({
        sample_size_a: sampleSizeA,
        sample_size_b: sampleSizeB,
        conversions_a: conversionsA,
        conversions_b: conversionsB,
        opens_a: opensA,
        opens_b: opensB,
        responses_a: responsesA,
        responses_b: responsesB,
        conversion_rate_a: conversionRateA,
        conversion_rate_b: conversionRateB,
        open_rate_a: openRateA,
        open_rate_b: openRateB,
        response_rate_a: responseRateA,
        response_rate_b: responseRateB,
        winner,
        statistical_significance: statisticalSignificance,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", abTestId);

    console.log(`[AB Test Manager] A/B test ${abTestId} completed. Winner: ${winner}`);

    return {
      winner,
      statisticalSignificance,
      conversionRateA,
      conversionRateB,
      openRateA,
      openRateB,
      responseRateA,
      responseRateB,
    };
  }

  /**
   * Calculate statistical significance using z-test
   */
  private calculateStatisticalSignificance(
    conversionsA: number,
    sampleSizeA: number,
    conversionsB: number,
    sampleSizeB: number
  ): number {
    if (sampleSizeA === 0 || sampleSizeB === 0) return 0;

    const p1 = conversionsA / sampleSizeA;
    const p2 = conversionsB / sampleSizeB;
    const p = (conversionsA + conversionsB) / (sampleSizeA + sampleSizeB);
    const se = Math.sqrt(p * (1 - p) * (1 / sampleSizeA + 1 / sampleSizeB));
    
    if (se === 0) return 0;

    const z = Math.abs(p1 - p2) / se;
    
    // Convert z-score to p-value (simplified)
    const pValue = 2 * (1 - this.normalCDF(z));
    
    return 1 - pValue; // Statistical significance
  }

  /**
   * Normal cumulative distribution function
   */
  private normalCDF(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  /**
   * Get A/B test status
   */
  async getABTestStatus(abTestId: string): Promise<any> {
    const supabase = getSupabaseAdmin;

    const { data } = await supabase()
      .from("ab_tests")
      .select("*")
      .eq("id", abTestId)
      .single();

    return data;
  }

  /**
   * Get all A/B tests for a business
   */
  async getABTests(businessId: string): Promise<any[]> {
    const supabase = getSupabaseAdmin;

    const { data } = await supabase()
      .from("ab_tests")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    return data || [];
  }
}
