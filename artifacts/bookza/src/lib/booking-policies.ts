import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";

/**
 * Core cancel/reschedule policy (migration 046). Lives in Settings now instead of
 * Bot Setup, because the booking page/calendar is a base feature. Read by the
 * public manage RPCs and the WhatsApp bot alike.
 */

export type BookingPolicy = {
  acceptCancellations: boolean;
  cancellationMinNoticeHours: number;
  cancellationDeclineMessage: string;
  acceptReschedules: boolean;
  rescheduleMinNoticeHours: number;
  rescheduleDeclineMessage: string;
};

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  acceptCancellations: true,
  cancellationMinNoticeHours: 24,
  cancellationDeclineMessage: "",
  acceptReschedules: true,
  rescheduleMinNoticeHours: 24,
  rescheduleDeclineMessage: "",
};

export async function fetchBookingPolicy(): Promise<BookingPolicy> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("booking_policies")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_BOOKING_POLICY;
  return {
    acceptCancellations: data.accept_cancellations as boolean,
    cancellationMinNoticeHours: data.cancellation_min_notice_hours as number,
    cancellationDeclineMessage: (data.cancellation_decline_message as string) ?? "",
    acceptReschedules: data.accept_reschedules as boolean,
    rescheduleMinNoticeHours: data.reschedule_min_notice_hours as number,
    rescheduleDeclineMessage: (data.reschedule_decline_message as string) ?? "",
  };
}

export async function saveBookingPolicy(policy: BookingPolicy): Promise<void> {
  const businessId = await ensureBusiness();
  const { error } = await supabase.from("booking_policies").upsert(
    {
      business_id: businessId,
      accept_cancellations: policy.acceptCancellations,
      cancellation_min_notice_hours: Math.max(0, Math.trunc(policy.cancellationMinNoticeHours) || 0),
      cancellation_decline_message: policy.cancellationDeclineMessage.trim(),
      accept_reschedules: policy.acceptReschedules,
      reschedule_min_notice_hours: Math.max(0, Math.trunc(policy.rescheduleMinNoticeHours) || 0),
      reschedule_decline_message: policy.rescheduleDeclineMessage.trim(),
    },
    { onConflict: "business_id" },
  );
  if (error) throw new Error(error.message);
}
