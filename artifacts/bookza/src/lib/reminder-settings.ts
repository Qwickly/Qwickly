import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";

export type WhatsappReminderSettings = {
  business_id: string;
  reminders_enabled: boolean;
  confirmation_enabled: boolean;
  confirmation_template: string;
  reminder_24h_enabled: boolean;
  reminder_24h_template: string;
  reminder_2h_enabled: boolean;
  reminder_2h_template: string;
  follow_up_enabled: boolean;
  follow_up_hours: number;
  follow_up_template: string;
};

export const DEFAULT_REMINDER_SETTINGS: Omit<WhatsappReminderSettings, "business_id"> = {
  reminders_enabled: true,
  confirmation_enabled: true,
  confirmation_template: "Hi {client_name}, your booking for {service_name} on {booking_date} at {booking_time} has been confirmed. Thank you!",
  reminder_24h_enabled: true,
  reminder_24h_template: "Hi {client_name}, this is a reminder for your upcoming appointment for {service_name} with {staff_name} on {booking_date} at {booking_time}. See you soon!",
  reminder_2h_enabled: false,
  reminder_2h_template: "Hi {client_name}, your appointment for {service_name} with {staff_name} starts in 2 hours (at {booking_time}). See you soon!",
  follow_up_enabled: false,
  follow_up_hours: 2,
  follow_up_template: "Hi {client_name}, thanks for visiting us today! How was your appointment for {service_name}? We would love to hear your feedback!",
};

export async function fetchWhatsappReminderSettings(): Promise<WhatsappReminderSettings> {
  const businessId = await ensureBusiness();

  const { data, error } = await supabase
    .from("whatsapp_settings")
    .select(`
      business_id,
      reminders_enabled,
      confirmation_enabled,
      confirmation_template,
      reminder_24h_enabled,
      reminder_24h_template,
      reminder_2h_enabled,
      reminder_2h_template,
      follow_up_enabled,
      follow_up_hours,
      follow_up_template
    `)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data) {
    // If whatsapp_settings doesn't exist, create it with default reminder settings
    const { data: inserted, error: insertError } = await supabase
      .from("whatsapp_settings")
      .upsert(
        { business_id: businessId, ...DEFAULT_REMINDER_SETTINGS },
        { onConflict: "business_id" }
      )
      .select()
      .single();

    if (insertError) throw new Error(insertError.message);
    return inserted as WhatsappReminderSettings;
  }

  // Handle missing columns or fallback to defaults in case the row existed prior to migrations
  return {
    business_id: data.business_id,
    reminders_enabled: data.reminders_enabled ?? DEFAULT_REMINDER_SETTINGS.reminders_enabled,
    confirmation_enabled: data.confirmation_enabled ?? DEFAULT_REMINDER_SETTINGS.confirmation_enabled,
    confirmation_template: data.confirmation_template ?? DEFAULT_REMINDER_SETTINGS.confirmation_template,
    reminder_24h_enabled: data.reminder_24h_enabled ?? DEFAULT_REMINDER_SETTINGS.reminder_24h_enabled,
    reminder_24h_template: data.reminder_24h_template ?? DEFAULT_REMINDER_SETTINGS.reminder_24h_template,
    reminder_2h_enabled: data.reminder_2h_enabled ?? DEFAULT_REMINDER_SETTINGS.reminder_2h_enabled,
    reminder_2h_template: data.reminder_2h_template ?? DEFAULT_REMINDER_SETTINGS.reminder_2h_template,
    follow_up_enabled: data.follow_up_enabled ?? DEFAULT_REMINDER_SETTINGS.follow_up_enabled,
    follow_up_hours: data.follow_up_hours ?? DEFAULT_REMINDER_SETTINGS.follow_up_hours,
    follow_up_template: data.follow_up_template ?? DEFAULT_REMINDER_SETTINGS.follow_up_template,
  } as WhatsappReminderSettings;
}

export async function saveWhatsappReminderSettings(settings: WhatsappReminderSettings): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_settings")
    .upsert(
      {
        business_id: settings.business_id,
        reminders_enabled: settings.reminders_enabled,
        confirmation_enabled: settings.confirmation_enabled,
        confirmation_template: settings.confirmation_template,
        reminder_24h_enabled: settings.reminder_24h_enabled,
        reminder_24h_template: settings.reminder_24h_template,
        reminder_2h_enabled: settings.reminder_2h_enabled,
        reminder_2h_template: settings.reminder_2h_template,
        follow_up_enabled: settings.follow_up_enabled,
        follow_up_hours: settings.follow_up_hours,
        follow_up_template: settings.follow_up_template,
      },
      { onConflict: "business_id" }
    );

  if (error) throw new Error(error.message);
}
