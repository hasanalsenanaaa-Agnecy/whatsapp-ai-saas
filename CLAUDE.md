# WhatsApp AI SaaS

Multi-tenant WhatsApp automation platform for Saudi SMBs. Production codebase — live clients running.

## Folder layout

```
src/              Application source (TypeScript, Fastify)
Workspace/        AI workflow context and stage files
  stages/         Work stages: 01_debug, 02_feature
  _config/        Stable reference material
docs/             Operational docs (onboarding, client setup)
migrations/       PostgreSQL migration SQL files
portal/           Next.js client dashboard
```

## Routing table

| Task | Go to | Read |
|------|-------|------|
| Fix a bug or production issue | Workspace/stages/01_debug/ | CONTEXT.md |
| Build or extend a feature | Workspace/stages/02_feature/ | CONTEXT.md |
| Understand project structure | Workspace/_config/ | architecture.md |
| Review coding constraints | Workspace/_config/ | principles.md |

## Key source files

```
src/conversation.ts        — State machine router (all industry flows)
src/messages.ts            — WhatsApp message templates (Gulf Arabic)
src/index.ts               — Fastify server + webhook handlers + analytics API
src/services/ai-client.ts  — Centralized AI client (per-tenant concurrency)
src/services/analytics.ts  — Revenue, funnel, usage, AI cost, top products
src/services/shopify/      — Shopify agent (5 modules: handlers, display, ai, helpers, types)
src/services/              — Database, WhatsApp API, appointments, events, alerts
src/flows/                 — Industry-specific conversation flows
src/utils/crypto.ts        — AES-256-GCM token encryption
src/scripts/               — CLI tools (add clients, set tiers, encrypt tokens, revenue)
src/__tests__/             — 93 unit tests (Vitest)
src/cron/                  — Abandoned cart recovery, appointment reminders
```

## Tech stack

Node.js + TypeScript · Fastify · Neon PostgreSQL · Upstash QStash (cron)
Meta WhatsApp Business API · Claude API · Google Sheets · Shopify
