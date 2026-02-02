# Phase 6: Billing, Plans & Usage

## Objective

Introduce monetization with subscription plans, usage limits, and billing workflows.

## Goals

- Add Stripe billing for subscriptions.
- Enforce plan limits (messages, AI calls, seats).
- Provide billing UX in the portal.

## Deliverables

### 1. Billing Core

- Stripe customer + subscription lifecycle.
- Webhook handling for subscription changes.
- Local billing state stored per client.

### 2. Plan Limits

- Usage counters for:
  - WhatsApp messages
  - AI requests
  - Active automation sequences
- Graceful limit handling (soft warnings + hard blocks).

### 3. Portal Billing UI

- Plan overview and current usage.
- Upgrade/downgrade and payment method management.
- Invoices list.

## Data Model

- `billing_customers` (client_id, stripe_customer_id)
- `billing_subscriptions` (client_id, stripe_subscription_id, plan, status, current_period_end)
- `usage_counters` (client_id, date, messages, ai_calls, automations)

## API Endpoints (Proposed)

- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/billing/webhook`
- `GET /api/clients/:clientId/billing`

## Portal Pages

- `/billing` for plan + usage + invoices

## Tests

- Integration tests for billing webhooks and plan enforcement.

## Risks

- Webhook signature validation.
- Accurate usage tracking and reset by period.
