# Project Architecture

## What this project is

Multi-tenant WhatsApp automation platform. One codebase serves all clients. Clients are isolated by `phoneNumberId` and `clientId` at every database query. No client ever sees another client's data.

## Request flow

```
WhatsApp user sends message
  → Meta webhook POST /webhook
  → src/index.ts (validates, parses)
  → src/conversation.ts (routes by client industry + conversation state)
  → src/flows/{industry}.ts (executes the right step)
  → src/messages.ts (formats the response)
  → WhatsApp API (sends reply)
```

## Key files and their jobs

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Fastify server. Handles webhooks: WhatsApp, Shopify, appointment reminders. |
| `src/conversation.ts` | State machine router. Reads Redis state, picks the right flow handler, calls it. |
| `src/messages.ts` | All WhatsApp message templates. Gulf Arabic. Button labels, list items, body text. |
| `src/flows/clinic.ts` | Clinic booking flow (appointment, services, location). |
| `src/flows/real-estate.ts` | Real estate lead capture flow. |
| `src/flows/ecommerce.ts` | Shopify e-commerce flow (browse, cart, checkout). |
| `src/flows/common.ts` | Shared flow logic (lead handover, AI fallback, returning customers). |
| `src/services/database.ts` | All PostgreSQL queries. Every query is scoped by clientId. |
| `src/services/whatsapp.ts` | Meta WhatsApp API calls (send message, send template, upload media). |
| `src/services/ai.ts` | Claude API calls. Only called for fallback or Q&A. |
| `src/services/appointments.ts` | Appointment booking, availability, QStash reminder scheduling. |
| `src/services/shopify.ts` | Shopify product fetching and order creation. |
| `src/scripts/` | CLI tools for adding clients, setting tiers, enabling features. |
| `src/cron/` | Scheduled tasks (appointment reminders). |

## State machine pattern

Conversation state lives in Upstash Redis keyed by `{phoneNumberId}:{userPhone}`.

State object shape:
```typescript
{
  step: string          // current step in the flow (e.g., 'MENU', 'SERVICES', 'CONFIRM')
  industry: string      // 'clinic' | 'real-estate' | 'ecommerce'
  clientId: string      // which client owns this conversation
  data: object          // accumulated lead/booking data
  lastActivity: number  // Unix timestamp for expiry
}
```

Flows transition state by returning a new step. `conversation.ts` persists the new state to Redis and sends the reply.

## Industry flows

- **Clinic**: Lead capture → service selection → appointment booking → confirmation → reminder
- **Real estate**: Lead capture → property preferences → agent notification → handover
- **Ecommerce (Shopify)**: Product catalog → product detail → add to cart → checkout → order creation

## Pricing tiers (enforced in code)

| Tier | SAR/mo | Features |
|------|--------|----------|
| Basic | 500 | Lead capture, agent notifications, Google Sheets sync |
| Pro | 899 | + AI fallback, lead scoring, smart handover |
| Business | 1,499 | + Appointment booking, analytics dashboard |

Feature gates are checked in `conversation.ts` and individual flow files using `client.features`.

## Database schema (key tables)

- `clients` — client configuration, tier, industry, feature flags
- `conversations` — conversation history (used for AI context)
- `leads` — captured lead data
- `appointments` — booked appointments

## Multi-tenancy enforcement

Every database query includes `WHERE client_id = $X`. No exceptions. The `clientId` is resolved from the incoming webhook's `phoneNumberId` at the start of every request.
