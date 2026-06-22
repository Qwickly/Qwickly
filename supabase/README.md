# Supabase migrations

## Apply migrations (in order)

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/kzfixfcatknkkqttnvvi/sql/new)
2. Run `migrations/001_settings_schema.sql`
3. Run `migrations/002_onboarding.sql`
4. Run `migrations/003_opt_in_defaults.sql`
5. Run `migrations/004_operational_schema.sql`
6. Run `migrations/005_payments_schema.sql`
7. Run `migrations/006_booking_page_settings.sql`
8. Run `migrations/007_booking_page_storage.sql`
9. Run `migrations/008_public_booking_rpc.sql`
10. Run `migrations/009_staff_working_days.sql`
11. Run `migrations/010_public_booking_staff_days.sql`

This creates all settings tables, operational tables (services, clients, bookings, payments), booking page customization, image storage, row-level security, and signup auto-provisioning.

## Tables

| Table | Purpose |
|-------|---------|
| `businesses` | Business profile (name, industry, contact, address) |
| `business_operating_hours` | Weekly open/close times |
| `notification_settings` | Client & staff notification toggles |
| `payment_provider_settings` | PayFast, Yoco, cash, EFT, etc. |
| `deposit_settings` | Deposit rules |
| `whatsapp_settings` | WhatsApp API & messaging preferences |
| `team_members` | Team roles and permissions |
| `services` | Services you offer (pricing, duration) |
| `clients` | Your client list |
| `staff_members` | Bookable staff |
| `bookings` | Appointments (calendar & bookings page) |
| `payments` | Payment transactions (deposits, full payments, refunds) |
| `booking_page_settings` | Public booking page customization (slug, design, preferences) |
| `booking-page-assets` (storage) | Cover images and logos for public booking pages |
