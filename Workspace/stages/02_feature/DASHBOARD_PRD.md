# Dashboard PRD

## Overview

Client-facing analytics dashboard for the WhatsApp AI SaaS platform. Two roles: platform owner (sees everything) and client owners (see only their own data). Deployed as a separate Render service.

## Roles & Access

| Role | Auth | Sees |
|------|------|------|
| **Owner** | ANALYTICS_KEY | All clients, all data, system health, alerts |
| **Client** | dashboard_key (random 32-char, per client) | Only their own conversations, analytics, products |

Auth: API key passed as query param. No login page — direct URL with key.

- Owner URL: `/dashboard?key=ANALYTICS_KEY`
- Client URL: `/dashboard?key=CLIENT_DASHBOARD_KEY`

Client keys: new `dashboard_key` column on clients table (random 32-char string, generated on client creation). Backend validates key and returns role + client_id.

## Pages

### 1. Overview (landing page)

**Owner view:**
- KPI row: total revenue (this month), total orders, total messages, total active conversations
- Revenue chart: area chart, last 3 months, per-client breakdown
- Conversion funnel: messages -> checkouts -> payments (bar chart)
- Client list summary: cards showing each client's name, status, revenue, message count
- System health indicator (from /health endpoint)

**Client view:**
- KPI row: my revenue, my orders, my messages, my conversion rate
- Revenue chart: my revenue over last 3 months
- Conversion funnel: my funnel only

### 2. Conversations (chat viewer)

**Owner view:**
- Left sidebar: list of all conversations across all clients, searchable by phone
- Filter by: client, state (active/completed/abandoned), date range
- Right panel: selected conversation's full message history
- Shows: phone (masked), state, last message time, message count
- Messages displayed as chat bubbles (user left, bot right)
- "Send Message" button — reply to a customer directly from the dashboard

**Client view:**
- Same layout but only their conversations
- No client filter (only one client)
- "Send Message" button — reply to their own customers

### 3. Analytics (detailed)

**Owner view:**
- Top products: table with product name, checkout count, revenue (per client toggle)
- AI cost: tokens used, avg latency, cost estimate per client per month
- Usage: messages in/out, AI calls, escalations per client
- Abandoned cart: created vs recovered vs lost

**Client view:**
- Same metrics but only their data

### 4. Alerts (alert history)

**Owner view:**
- Chronological log of recent errors, spikes, and system alerts
- Filter by: severity (error/warning/info), client, date range
- Shows: timestamp, type, message, affected client

**Client view:**
- Only their own service alerts

### 5. Clients (owner only)

- Table: client name, industry, status, phone number ID, monthly revenue, monthly messages
- Click to see client detail: their analytics, their conversations
- Not visible to client role

## Data Sources

All data comes from existing backend API endpoints + new ones needed:

| Endpoint | Exists | Used by |
|----------|--------|---------|
| `GET /api/analytics/revenue` | Yes | Overview, Analytics |
| `GET /api/analytics/funnel` | Yes | Overview, Analytics |
| `GET /api/analytics/usage` | Yes | Analytics |
| `GET /api/analytics/products` | Yes | Analytics |
| `GET /api/analytics/ai-cost` | Yes | Analytics |
| `GET /api/conversations` | **New** | Conversations page |
| `GET /api/conversations/:phone` | **New** | Chat detail view |
| `POST /api/conversations/:phone/send` | **New** | Send message action |
| `GET /api/clients` | **New** | Clients page (owner only) |
| `GET /api/auth/validate` | **New** | Key validation + role detection |
| `GET /api/alerts` | **New** | Alert history page |
| `GET /health` | Yes | System status indicator |

### New API endpoints needed

**GET /api/auth/validate?key=X**
- Returns: `{ role: 'owner' | 'client', clientId?: string, clientName?: string }`
- Validates key against ANALYTICS_KEY (owner) or clients.dashboard_key (client)

**GET /api/conversations?key=X&client_id=Y&state=Z&page=1&limit=20**
- Returns: list of conversations (phone masked, state, last message time, message count, preview)
- Owner: all conversations (optional client_id filter)
- Client: only their conversations (client_id enforced)

**GET /api/conversations/:phone?key=X&client_id=Y**
- Returns: full message history for a conversation
- Owner: any conversation
- Client: only their conversations

**POST /api/conversations/:phone/send?key=X&client_id=Y**
- Body: `{ message: string }`
- Sends a WhatsApp message to the customer using the client's credentials
- Returns: `{ success: boolean }`

**GET /api/clients?key=X**
- Returns: list of all active clients with summary stats
- Owner only

**GET /api/alerts?key=X&client_id=Y&limit=50**
- Returns: recent events where event_type = 'error' + system alerts
- Owner: all errors
- Client: only their errors

### New database changes

**Migration 004:**
```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS dashboard_key VARCHAR(64) UNIQUE;
```

Generate keys for existing clients via CLI script.

## UI Components (Shadcn/ui)

- **Layout:** Sidebar navigation + main content area + dark mode toggle
- **Cards:** KPI display (Shadcn Card)
- **Charts:** Revenue area chart, funnel bar chart (Recharts)
- **Tables:** Products, clients, conversations list (Shadcn DataTable)
- **Chat view:** Custom component — scrollable message list with bubbles + send input
- **Filters:** Select dropdowns for client, state, date range (Shadcn Select, DatePicker)
- **Badge:** Status indicators (healthy/degraded, active/abandoned)
- **Theme toggle:** Dark/light mode switch

## Tech Stack

- Next.js 14 (App Router)
- Shadcn/ui + Tailwind CSS
- Recharts (charts)
- Desktop only — no mobile optimization
- Deployed as separate Render static site or web service

## Auto-refresh

- All pages auto-refresh data every 60 seconds
- "Last updated X seconds ago" indicator in the header
- No WebSocket — polling only

## Deployment

- **Separate Render web service** from the Fastify backend
- Environment variable: `API_URL` pointing to the Fastify backend
- Next.js builds to static where possible, SSR for data-fetching pages

## File Structure

```
portal/
  app/
    layout.tsx              — Root layout with sidebar + theme provider
    page.tsx                — Redirect to /dashboard
    dashboard/
      page.tsx              — Overview
      conversations/
        page.tsx            — Conversation list + chat viewer
      analytics/
        page.tsx            — Detailed analytics
      alerts/
        page.tsx            — Alert history
      clients/
        page.tsx            — Client list (owner only)
  components/
    sidebar.tsx             — Navigation sidebar
    kpi-card.tsx            — KPI display card
    revenue-chart.tsx       — Revenue area chart
    funnel-chart.tsx        — Conversion funnel
    chat-viewer.tsx         — Message history display
    conversation-list.tsx   — Conversation sidebar list
    send-message.tsx        — Message input + send button
    alert-log.tsx           — Alert history table
    theme-toggle.tsx        — Dark/light mode switch
    refresh-indicator.tsx   — "Last updated" display
  lib/
    api.ts                  — API client (fetches from backend)
    auth.ts                 — API key validation + role detection
    utils.ts                — Helpers (maskPhone, formatCurrency, etc.)
  public/
    favicon.ico
```

## Constraints

- English only
- API key auth — no JWT, no sessions, no login page
- Max 50 conversations per page (paginated)
- Phone numbers masked in UI (same maskPhone logic)
- Read-only except for "Send Message" in chat viewer

## Out of Scope

- Real-time WebSocket updates
- Mobile responsive
- Export/download data
- Client self-registration
- Editing client settings from dashboard
- Push notifications
