# Next.js WhatsApp SaaS reference

This folder contains a drop-in App Router reference for the QR-based WhatsApp tenant flow.

## Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EVOLUTION_API_URL=
EVOLUTION_API_TOKEN=
EVOLUTION_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=
```

## Required packages

```bash
pnpm add @supabase/ssr @supabase/supabase-js qrcode
```

## Routes included

- `src/app/api/whatsapp/connect/route.ts`
- `src/app/api/whatsapp/status/route.ts`
- `src/app/api/webhooks/whatsapp/route.ts`

## Frontend included

- `src/components/settings/whatsapp-connection-manager.tsx`

The route handlers assume the Supabase migration `supabase/migrations/011_whatsapp_multi_tenant_sessions.sql` has been applied first.
