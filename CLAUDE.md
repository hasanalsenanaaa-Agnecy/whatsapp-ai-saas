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
src/conversation.ts   — State machine router (all industry flows)
src/messages.ts       — WhatsApp message templates (Gulf Arabic)
src/index.ts          — Fastify server + webhook handlers
src/services/         — Database, AI, WhatsApp API, appointments
src/flows/            — Industry-specific conversation flows
src/scripts/          — CLI tools (add clients, set tiers)
```

## Tech stack

Node.js + TypeScript · Fastify · Neon PostgreSQL · Upstash Redis
Meta WhatsApp Business API · Claude API · Google Sheets · Shopify
