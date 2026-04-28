# Project Architecture

## What this project is

Multi-tenant WhatsApp automation platform. One codebase serves all clients. Clients are isolated by `phoneNumberId` and `clientId` at every database query. No client ever sees another client's data.

## Request flow

```
WhatsApp user sends message
  → Meta webhook POST /webhook/whatsapp
  → src/index.ts (validates signature, deduplicates, rate-limits)
  → src/conversation.ts (routes by client industry + conversation state)
  → src/flows/{common,ecommerce}.ts (executes the right step)
  → src/services/whatsapp.ts (sends reply via Meta API)
```

## Key files and their jobs

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Fastify server. Webhooks: WhatsApp, Shopify, cron endpoints, analytics API. |
| `src/conversation.ts` | State machine router. Reads DB state, picks the right flow handler, calls it. |
| `src/messages.ts` | All WhatsApp message templates. Gulf Arabic. Button labels, list items, body text. |
| `src/flows/ecommerce.ts` | Shopify e-commerce entry point (delegates to shopify agent). |
| `src/flows/common.ts` | Shared flow logic: welcome, questions, appointments, AI fallback, chat, handover, lead completion. |
| `src/types/client.ts` | `ClientConfig` type contract — typed interface for all tenant configuration. |
| `src/services/database.ts` | All PostgreSQL queries. Every query scoped by clientId. Returns typed `ClientConfig`. |
| `src/services/whatsapp.ts` | Meta WhatsApp API calls (messages, buttons, lists, images). |
| `src/services/shopify.ts` | Shopify Storefront API (product fetching, checkout creation). |
| `src/services/shopify-webhook.ts` | Shopify orders/paid webhook handler (payment verification). |
| `src/services/shopify/` | Shopify agent modules: handlers.ts, display.ts, ai.ts, helpers.ts, types.ts. |
| `src/services/shopify-agent.ts` | Barrel re-export of `handleShopifyAgent` from `shopify/handlers.ts`. |
| `src/services/knowledge.ts` | AI knowledge base, lead scoring, handover detection. |
| `src/services/ai-conversation.ts` | Claude API for free-form AI conversations. |
| `src/services/events.ts` | Fire-and-forget event logging (analytics foundation). |
| `src/services/analytics.ts` | Revenue attribution, conversion funnel, usage summary, AI cost, top products. |
| `src/services/usage-limits.ts` | Monthly per-client caps (conversations, AI messages, outbound) + 80% warnings. |
| `src/services/appointments.ts` | Appointment booking, date generation, reminder scheduling. |
| `src/services/bookingWebhook.ts` | Pushes confirmed bookings to external clinic API. |
| `src/services/clinicData.ts` | Clinic info / service / offer type definitions. |
| `src/services/ai-client.ts` | Centralized Anthropic client manager. Per-tenant concurrency control (max 5). |
| `src/services/rateLimiter.ts` | Per-phone (10 msg/min) + per-tenant (200 msg/min) rate limiting. |
| `src/utils/crypto.ts` | AES-256-GCM encryption/decryption for Shopify tokens in DB. |
| `src/utils/buttons.ts` | Button helpers + `maskPhone()` PII redaction. |
| `src/scripts/encrypt-tokens.ts` | One-time migration to encrypt existing plaintext tokens. |
| `src/services/googleSheets.ts` | Google Sheets lead/order sync. |
| `src/services/alerts.ts` | Owner notifications via WhatsApp (errors, daily summary, per-client). |
| `src/scripts/` | CLI tools: client-cli, features-cli, set-policies, setup-arab, revenue, export-client, generate-dashboard-keys, sim. |
| `src/cron/reminders.ts` | Appointment reminder cron job. |
| `src/cron/abandoned-cart.ts` | Abandoned cart recovery cron job (active in production via QStash). |
| `src/cron/data-retention.ts` | PDPL data retention — anonymize old events/conversations, delete old leads/appointments. |

## State machine pattern

Conversation state lives in **Neon PostgreSQL** in the `conversations` table, keyed by `(client_id, phone)`.

State object shape:
```typescript
{
  clientId: string;       // which client owns this conversation
  phone: string;          // customer WhatsApp number
  state: string;          // current state (welcome, questions, shopify_agent, etc.)
  step: number;           // sub-step within current state
  data: Record<string, any>; // accumulated lead/booking/cart data
  messages: { role: string; content: string }[]; // conversation history
  createdAt: string;
  updatedAt: string;
}
```

Flows transition state by modifying `conv.state` and `conv.data`. `conversation.ts` persists the updated state to the DB after each message.

## Industry flows

- **Ecommerce (Shopify)**: Welcome → browse (images/list) → product detail → variant select → quantity → cart → checkout → payment verification → completion
- **Common (all industries)**: Welcome → screening questions → appointment booking → AI fallback → chat → handover

## Pricing tiers (enforced in code)

| Tier | SAR/mo | Features |
|------|--------|----------|
| Basic | 500 | Lead capture, agent notifications, Google Sheets sync |
| Pro | 899 | + AI fallback, lead scoring, smart handover |
| Business | 1,499 | + Appointment booking, analytics dashboard |

Feature gates are checked in `conversation.ts` and individual flow files using `client.features`.

## Database schema (key tables)

- `clients` — client configuration, tier, industry, feature flags, settings (JSONB), dashboard_key
- `conversations` — conversation state + history (upserted per client_id + phone), `consent_given` + `consent_at` for PDPL
- `leads` — captured lead data with scoring
- `appointments` — booked appointments with reminders
- `events` — analytics event log (message_in/out, checkout, payment, AI calls, escalations, conversation_start)

Migrations live in `migrations/`: `001_unique_constraints`, `002_events_table`, `003_pdpl_compliance`, `004_dashboard_key`.

## Multi-tenancy enforcement

Every database query includes `WHERE client_id = $X`. No exceptions. The `clientId` is resolved from the incoming webhook's `phoneNumberId` at the start of every request. Client configuration is typed via the `ClientConfig` interface in `src/types/client.ts`.

## Security layers

- **Webhook signatures:** WhatsApp (HMAC-SHA256) and Shopify (HMAC-SHA256) verified before processing.
- **Token encryption:** Shopify tokens encrypted at rest with AES-256-GCM (`src/utils/crypto.ts`). Backward compatible — reads both `enc:` prefixed and plaintext values.
- **Rate limiting:** Per-phone (10 msg/min) and per-tenant (200 msg/min) in `src/services/rateLimiter.ts`.
- **AI concurrency:** Per-tenant limit (max 5 concurrent) in `src/services/ai-client.ts`.
- **PII masking:** `maskPhone()` applied to all log output.
- **Analytics API:** Protected by `ANALYTICS_KEY` env var.
- **Cron endpoints:** Protected by `CRON_SECRET` bearer token.
- **PDPL compliance:** Consent tracking in `conversations` table; `cron/data-retention.ts` anonymizes records older than 24 months and processes deletion requests.
