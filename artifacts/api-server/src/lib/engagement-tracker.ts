import { getSupabaseAdmin } from "./supabase";

export interface EngagementData {
  businessId: string;
  campaignId?: string;
  scheduledCampaignId?: string;
  recipientPhone: string;
  recipientName?: string;
  messageId?: string;
  timezone?: string;
}

export interface ResponseData {
  respondedAt: Date;
  responseTimeSeconds: number;
  responseText?: string;
}

export interface ConversionData {
  convertedAt: Date;
  conversionValue?: number;
}

/**
 * Engagement Tracker - Tracks message opens, responses, and conversions
 */
export class EngagementTracker {
  /**
   * Record that a message was sent
   */
  async recordSent(data: EngagementData): Promise<void> {
    const supabase = getSupabaseAdmin();
    
    await supabase.from("message_engagement").insert({
      business_id: data.businessId,
      campaign_id: data.campaignId,
      scheduled_campaign_id: data.scheduledCampaignId,
      recipient_phone: data.recipientPhone,
      recipient_name: data.recipientName,
      message_id: data.messageId,
      sent_at: new Date().toISOString(),
      timezone: data.timezone,
    });

    console.log(`[Engagement Tracker] Recorded sent to ${data.recipientPhone}`);
  }

  /**
   * Record that a message was opened
   */
  async recordOpened(engagementId: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    
    await supabase
      .from("message_engagement")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", engagementId);

    console.log(`[Engagement Tracker] Recorded opened for ${engagementId}`);
  }

  /**
   * Record that a recipient responded
   */
  async recordResponse(engagementId: string, data: ResponseData): Promise<void> {
    const supabase = getSupabaseAdmin();
    
    await supabase
      .from("message_engagement")
      .update({
        responded_at: data.respondedAt.toISOString(),
        response_time_seconds: data.responseTimeSeconds,
        response_text: data.responseText,
      })
      .eq("id", engagementId);

    console.log(`[Engagement Tracker] Recorded response for ${engagementId}`);
  }

  /**
   * Record a conversion
   */
  async recordConversion(engagementId: string, data: ConversionData): Promise<void> {
    const supabase = getSupabaseAdmin();
    
    await supabase
      .from("message_engagement")
      .update({
        converted: true,
        converted_at: data.convertedAt.toISOString(),
        conversion_value: data.conversionValue,
      })
      .eq("id", engagementId);

    console.log(`[Engagement Tracker] Recorded conversion for ${engagementId}`);
  }

  /**
   * Update recipient insights with new engagement data
   */
  async updateInsights(businessId: string, recipientPhone: string, recipientName?: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    // Get all engagement data for this recipient
    const { data: engagements } = await supabase
      .from("message_engagement")
      .select("*")
      .eq("business_id", businessId)
      .eq("recipient_phone", recipientPhone);

    if (!engagements || engagements.length === 0) return;

    // Calculate metrics
    const totalSent = engagements.length;
    const totalOpened = engagements.filter(e => e.opened_at).length;
    const totalResponses = engagements.filter(e => e.responded_at).length;
    const totalConversions = engagements.filter(e => e.converted).length;
    const totalValue = engagements.reduce((sum, e) => sum + (e.conversion_value || 0), 0);

    // Calculate average response time
    const responseTimes = engagements
      .filter(e => e.response_time_seconds)
      .map(e => e.response_time_seconds);
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length)
      : null;

    // Calculate best send hour
    const sentHours = engagements.map(e => new Date(e.sent_at).getHours());
    const hourCounts = sentHours.reduce((acc, hour) => {
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const bestSendHour = bestHour ? parseInt(bestHour) : null;

    // Calculate best send day
    const sentDays = engagements.map(e => new Date(e.sent_at).toLocaleDateString('en-US', { weekday: 'long' }));
    const dayCounts = sentDays.reduce((acc, day) => {
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const bestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Calculate engagement score (0-1)
    const openRate = totalSent > 0 ? totalOpened / totalSent : 0;
    const responseRate = totalSent > 0 ? totalResponses / totalSent : 0;
    const conversionRate = totalSent > 0 ? totalConversions / totalSent : 0;
    const engagementScore = (openRate * 0.3) + (responseRate * 0.4) + (conversionRate * 0.3);

    // Get last contacted and responded
    const lastContacted = engagements
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];
    const lastResponded = engagements
      .filter(e => e.responded_at)
      .sort((a, b) => new Date(b.responded_at!).getTime() - new Date(a.responded_at!).getTime())[0];

    // Get timezone from most recent engagement
    const timezone = lastContacted?.timezone || null;

    // Upsert insights
    await supabase
      .from("recipient_insights")
      .upsert({
        business_id: businessId,
        recipient_phone: recipientPhone,
        recipient_name: recipientName,
        total_messages_sent: totalSent,
        total_messages_opened: totalOpened,
        total_responses: totalResponses,
        total_conversions: totalConversions,
        total_conversion_value: totalValue,
        avg_response_time_seconds: avgResponseTime,
        best_send_hour: bestSendHour,
        best_send_day: bestDay,
        engagement_score: engagementScore,
        last_contacted_at: lastContacted?.sent_at,
        last_responded_at: lastResponded?.responded_at,
        timezone,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "business_id,recipient_phone",
      });

    console.log(`[Engagement Tracker] Updated insights for ${recipientPhone}`);
  }

  /**
   * Get insights for a recipient
   */
  async getInsights(businessId: string, recipientPhone: string): Promise<any> {
    const supabase = getSupabaseAdmin();
    
    const { data } = await supabase
      .from("recipient_insights")
      .select("*")
      .eq("business_id", businessId)
      .eq("recipient_phone", recipientPhone)
      .single();

    return data;
  }

  /**
   * Get best send time for a recipient
   */
  async getBestSendTime(businessId: string, recipientPhone: string): Promise<Date | null> {
    const insights = await this.getInsights(businessId, recipientPhone);
    
    if (!insights || !insights.best_send_hour) return null;

    const now = new Date();
    const bestTime = new Date(now);
    bestTime.setHours(insights.best_send_hour, 0, 0, 0);
    
    // If best time has passed today, schedule for tomorrow
    if (bestTime < now) {
      bestTime.setDate(bestTime.getDate() + 1);
    }

    return bestTime;
  }

  /**
   * Get engagement score for a recipient
   */
  async getEngagementScore(businessId: string, recipientPhone: string): Promise<number> {
    const insights = await this.getInsights(businessId, recipientPhone);
    return insights?.engagement_score || 0;
  }
}
