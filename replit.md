# Bookza Dashboard

A full-featured South African SaaS booking platform for salons, barbers, tutors, mechanics, beauty businesses, consultants, and service providers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/bookza run dev` — run the Bookza frontend (port 23168)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, Recharts, Framer Motion
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (clients, staff, services, bookings, payments, whatsapp)
- `artifacts/api-server/src/routes/` — Express route handlers (dashboard, bookings, clients, services, staff, payments, analytics, whatsapp, calendar)
- `artifacts/bookza/src/pages/` — React page components for all 18 routes
- `artifacts/bookza/src/index.css` — emerald green theme tokens (light + dark mode)

## Product

**Bookza** is a complete booking platform dashboard featuring:
- **Dashboard** — KPI cards (today's appointments, monthly revenue, upcoming bookings, no-show rate) + revenue chart + popular services + activity feed
- **Calendar** — Day/week/month views with event positioning and staff/service filters
- **Bookings** — Full management table with status filters, confirm/cancel/reschedule actions
- **Clients** — CRM with VIP/new/returning/no-show-risk filters, AI insights
- **Services** — Service catalog with grid cards, create/edit/archive modals
- **Staff** — Team profiles with performance metrics and weekly schedule editor
- **Payments** — Stripe-style finance dashboard with PayFast/Yoco/cash/EFT filters
- **Analytics** — Line/bar/pie charts, heatmap, AI-generated business insights
- **WhatsApp** — Reminders, message templates, conversation inbox, AI bot stats
- **Marketing** — Campaigns, referral program, promotions, review requests
- **Booking Page** — Visual page builder with live preview
- **AI Assistant** — ChatGPT-style chat interface
- **Settings** — Business profile, payments, WhatsApp integration, subscription, security
- **Billing** — Starter/Pro/Business plan management with usage meters

## Architecture decisions

- Frontend is a pure React SPA at `/` — backend API at `/api`
- All API contracts defined in OpenAPI first, then codegen generates typed React Query hooks + Zod schemas
- Currency formatted as South African Rand (R) throughout
- Emerald green (#10b981) as primary accent, white/soft-gray card backgrounds
- WhatsApp reminders, bot stats, and conversation data seeded as mock data (real WhatsApp integration would require a provider like Twilio or Meta Business API)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change before touching the frontend
- `pnpm --filter @workspace/db run push` after schema changes
- Calendar event positioning uses px units (96px per hour, starts at 8am)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
