# WhatsApp AI SaaS

Multi-tenant WhatsApp automation platform for Saudi SMBs. One codebase serves all clients — clinics, e-commerce (Shopify), services, and more.

---

## Quick Start

```bash
npm install
cp config/.env.example .env   # fill in credentials
npm run build
npm run dev
```

---

## Project Structure

```
src/
  ├── index.ts              # Fastify server + webhook handlers
  ├── conversation.ts       # State machine router
  ├── messages.ts           # WhatsApp message templates (Gulf Arabic)
  ├── flows/                # Industry conversation flows (common, ecommerce)
  ├── services/             # WhatsApp, AI, database, Shopify, analytics
  │   └── shopify/          # Shopify agent modules (handlers, display, ai, helpers)
  ├── types/                # TypeScript interfaces (ClientConfig)
  ├── cron/                 # Scheduled tasks (reminders, abandoned cart recovery)
  ├── scripts/              # CLI tools (add clients, set tiers, revenue reports)
  └── __tests__/            # Unit tests (Vitest)

docs/                       # Onboarding guides
Workspace/_config/          # Architecture reference
portal/                     # Next.js client dashboard (WIP)
```

---

## Features

- Lead capture with industry-specific question flows
- WhatsApp automation (buttons, lists, images, messages)
- Multi-tenant — unlimited clients, fully isolated by client_id
- Shopify e-commerce (product browse, cart, checkout, payment verification)
- Abandoned cart recovery (automated WhatsApp nudges via cron)
- AI conversations (Claude) with per-client system prompts
- Appointment booking + reminders
- Google Sheets lead sync
- Lead scoring + smart handover detection
- Revenue attribution + conversion funnel analytics
- Agent notifications via WhatsApp

---

## CLI Commands

```bash
npm run client add                              # Add new client
npm run features enable <client_id> ai_fallback # Enable a feature
npm run features set-tier <client_id> pro       # Set pricing tier
npm run test                                    # Run all tests
npm run test:unit                               # Unit tests only
npm run build && npm start                      # Deploy
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Fastify |
| Database | PostgreSQL (Neon) |
| AI | Claude (Anthropic) |
| WhatsApp | Meta Business API |
| E-commerce | Shopify Storefront API |
| Cron | QStash (Upstash) |
| Hosting | Render |

---

## Environment Variables

Required:
- `DATABASE_URL` — PostgreSQL (Neon)
- `WHATSAPP_ACCESS_TOKEN` — Meta API token
- `WHATSAPP_PHONE_NUMBER_ID` — Meta phone ID
- `WHATSAPP_VERIFY_TOKEN` — Webhook verification token
- `WHATSAPP_APP_SECRET` — Webhook signature verification

Optional:
- `ANTHROPIC_API_KEY` — Claude AI
- `GOOGLE_CREDENTIALS` — Google service account JSON
- `GOOGLE_SHEET_ID` — Lead sync spreadsheet
- `CRON_SECRET` — Protects cron endpoints
- `ANALYTICS_KEY` — Protects analytics API
- `OWNER_PHONE` — Owner WhatsApp for alerts

See `config/.env.example` for full template.

---

## Deployment

Hosted on **Render** — auto-deploys on push to main.

```bash
git push origin main
```

Webhook URL: `https://whatsapp-ai-saas.onrender.com/webhook/whatsapp`

---

## Pricing (Per Client)

| Tier | Monthly | Features |
|------|---------|----------|
| Basic | 500 SAR | Leads, notifications, Sheets |
| Pro | 899 SAR | + AI, scoring, handover |
| Business | 1,499 SAR | + Appointments, analytics |

---

## Documentation

- [Workspace/_config/architecture.md](Workspace/_config/architecture.md) — System architecture
- [docs/CLINIC_SETUP.md](docs/CLINIC_SETUP.md) — Clinic onboarding guide
- [docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) — Multi-client isolation
- [docs/ONBOARDING_GUIDE.md](docs/ONBOARDING_GUIDE.md) — General onboarding
