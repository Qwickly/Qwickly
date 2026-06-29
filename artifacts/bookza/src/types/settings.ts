export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export const INDUSTRIES = [
  { value: "barbershop", label: "Barbershop" },
  { value: "salon", label: "Salon" },
  { value: "spa", label: "Spa & Beauty" },
  { value: "nails", label: "Nail Studio" },
  { value: "tutor", label: "Tutoring" },
  { value: "mechanic", label: "Auto Mechanic" },
  { value: "consultant", label: "Consultant" },
  { value: "beauty", label: "Beauty & Spa" },
  { value: "other", label: "Other" },
] as const;

export const PAYMENT_PROVIDERS = [
  { key: "payfast", name: "PayFast", desc: "South African payment gateway. Supports Visa, Mastercard, and EFT." },
  { key: "yoco", name: "Yoco", desc: "Local card machine integration for in-person payments." },
  { key: "cash", name: "Cash", desc: "Accept cash payments on the day of the appointment." },
  { key: "eft", name: "EFT / Bank Transfer", desc: "Manual EFT with reference tracking." },
  { key: "snapscan", name: "SnapScan", desc: "QR-code payments via the SnapScan app." },
  { key: "ozow", name: "Ozow", desc: "Instant EFT processing via Ozow." },
] as const;

export type PaymentProviderKey = (typeof PAYMENT_PROVIDERS)[number]["key"];

export type Business = {
  id: string;
  user_id: string;
  business_name: string;
  industry: string;
  phone: string;
  email: string;
  description: string;
  address: string;
  website_url: string;
  onboarding_completed: boolean;
  onboarding_tabs_visited: string[];
};

export type OperatingHour = {
  id: string;
  business_id: string;
  day_name: Weekday;
  is_open: boolean;
  open_time: string;
  close_time: string;
};

export type NotificationSettings = {
  business_id: string;
  booking_confirmations: boolean;
  reminder_24h: boolean;
  reminder_2h: boolean;
  review_requests: boolean;
  cancellation_notices: boolean;
  rescheduling_alerts: boolean;
  staff_new_booking: boolean;
  staff_reschedule: boolean;
  staff_cancellation: boolean;
  staff_daily_summary: boolean;
};

export type PaymentProviderSetting = {
  id: string;
  business_id: string;
  provider_key: PaymentProviderKey;
  enabled: boolean;
  connected: boolean;
};

export type DepositSettings = {
  business_id: string;
  require_deposit: boolean;
  deposit_type: "percentage" | "fixed";
  deposit_amount: number;
};

export type WhatsappSettings = {
  business_id: string;
  reminder_lead_hours: number;
  reply_hours_mode: "8-18" | "7-20" | "24";
  include_service_name: boolean;
  include_staff_name: boolean;
  send_confirmation_immediately: boolean;
  allow_cancel_via_whatsapp: boolean;
};

export type TeamMember = {
  id: string;
  business_id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: "owner" | "manager" | "staff";
  perm_bookings: boolean;
  perm_clients: boolean;
  perm_payments: boolean;
  perm_analytics: boolean;
  perm_settings: boolean;
};

export type BusinessSettings = {
  business: Business;
  operatingHours: OperatingHour[];
  notifications: NotificationSettings;
  paymentProviders: PaymentProviderSetting[];
  deposits: DepositSettings;
  whatsapp: WhatsappSettings;
  teamMembers: TeamMember[];
};

export type TeamMemberInput = {
  name: string;
  email: string;
  role: TeamMember["role"];
  perm_bookings: boolean;
  perm_clients: boolean;
  perm_payments: boolean;
  perm_analytics: boolean;
  perm_settings: boolean;
};
