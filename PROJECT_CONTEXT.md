# WhatsApp+ — Project Context

> Last updated: April 2026  
> Status: ✅ Live on Render

---

## What Is This?

**WhatsApp+** is a WhatsApp AI SaaS platform targeting Saudi Arabian businesses. It automates customer inquiries through structured conversation flows and AI responses in Gulf Arabic dialect.

**First customer:** A real estate agent in the Eastern Province (Dammam) who receives too many daily WhatsApp messages to respond to manually.

**Goal:** Capture leads automatically, notify the agent, and log everything — without the agent lifting a finger.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (TypeScript) |
| Framework | Express |
| Database | PostgreSQL via **Neon** (free tier) |
| Cache / State | Redis via **Upstash** (free tier) |
| Hosting | **Render** (free tier — 750 hrs/month) |
| WhatsApp API | Meta WhatsApp Business Cloud API |
| AI Responses | Anthropic Claude API (Gulf Arabic) |
| Voice Transcription | OpenAI Whisper |
| Sheets Integration | Google Sheets API |
| Reminders | Upstash QStash |
| Version Control | GitHub |

---

## Project Structure

```
whatsapp-ai-saas/
├── src/
│   ├── index.ts              # Entry point, webhook handler
│   ├── conversation.ts       # State machine — conversation flow logic
│   ├── messages.ts           # Arabic message templates (Gulf dialect)
│   ├── database.ts           # PostgreSQL queries (Neon)
│   ├── knowledge.ts          # AI knowledge base for fallback responses
│   ├── appointments.ts       # Appointment booking logic
│   ├── reminders.ts          # QStash reminder scheduling
│   ├── features-cli.ts       # CLI tool for managing feature flags
│   └── services/
│       ├── whatsapp.ts       # WhatsApp API calls
│       ├── sheets.ts         # Google Sheets integration
│       └── qstash-reminders.ts # Upstash QStash service
├── PROJECT_CONTEXT.md
├── package.json
└── tsconfig.json
```

---

## Database Tables (Neon PostgreSQL)

### `clients`
Multi-tenant table. Each business is a client.
```sql
id          TEXT PRIMARY KEY   -- e.g. 'anonymous' for testing
name        TEXT               -- Business display name (shown in bot messages)
industry    TEXT               -- 'real_estate' | 'clinic' | 'car_dealership'
settings    JSONB              -- googleSheetId, agentPhone, etc.
features    JSONB              -- Feature flags (see below)
```

### `conversations`
Tracks conversation state per WhatsApp user.
```sql
id              SERIAL
client_id       TEXT
phone_number    TEXT
step            INT            -- Current step in the flow
data            JSONB          -- Collected answers so far
lead_captured   BOOLEAN
handover_mode   BOOLEAN
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### `leads`
Every captured lead is stored here.
```sql
id          SERIAL
client_id   TEXT
name        TEXT
phone       TEXT
email       TEXT
data        JSONB              -- Property type, budget, bedrooms, etc.
score       TEXT               -- 'hot' | 'warm' | 'cold'
status      TEXT               -- 'new' | 'contacted' | 'closed'
created_at  TIMESTAMP
```

### `appointments`
For businesses using the appointment_setting feature.
```sql
id              SERIAL
client_id       TEXT
lead_id         INT
scheduled_at    TIMESTAMP
reminder_sent   BOOLEAN
notes           TEXT
```

---

## Conversation Flow

```
User sends "Hi"
     ↓
Welcome message + 4 options (WhatsApp list)
     ↓
Industry-specific questions (budget, property type, etc.)
     ↓
Contact info collection (name + phone)
     ↓
Lead saved to DB + Google Sheets
     ↓
Agent WhatsApp notification sent
     ↓
Bot goes silent (or switches to AI conversational mode if ai_fallback enabled)
```

Conversations auto-reset after **24 hours** of inactivity.

---

## Feature Flags (Tiered Pricing)

Features are stored as JSONB in the `clients.features` column. All default to `false` (Basic tier).

| Flag | Description | Tier |
|---|---|---|
| `ai_fallback` | Claude AI answers off-script questions in Gulf Arabic | Pro |
| `lead_scoring` | Auto-scores leads as hot/warm/cold | Pro |
| `handover_detection` | Detects when customer wants a human agent | Pro |
| `appointment_setting` | Books appointments + sends reminders via QStash | Business |

### Managing Features via CLI
```bash
# Set a client to Pro tier (enables ai_fallback, lead_scoring, handover_detection)
npm run features set-tier anonymous pro

# Set to Business tier (all features)
npm run features set-tier anonymous business

# Set to Basic tier (no features)
npm run features set-tier anonymous basic

# Enable a single feature
npm run features enable anonymous ai_fallback
```

---

## Pricing Tiers

| Tier | Price (SAR/month) | Features |
|---|---|---|
| Basic | 499 | Structured flow, lead capture, Google Sheets, agent notification |
| Pro | 899 | + AI fallback, lead scoring, handover detection |
| Business | 1,499 | + Appointment setting, automated reminders |

---

## Environment Variables (Render)

```env
# WhatsApp
WHATSAPP_TOKEN=           # Meta API access token
WHATSAPP_PHONE_ID=        # WhatsApp phone number ID
VERIFY_TOKEN=             # Webhook verification token (you set this)

# Database
DATABASE_URL=             # Neon PostgreSQL connection string

# Redis
UPSTASH_REDIS_REST_URL=   # Upstash Redis URL
UPSTASH_REDIS_REST_TOKEN= # Upstash Redis token

# AI
ANTHROPIC_API_KEY=        # Claude API key

# Google Sheets
GOOGLE_SHEET_ID=          # Target spreadsheet ID
GOOGLE_CREDENTIALS=       # Full service account JSON (stringified)

# Agent
AGENT_PHONE_NUMBER=       # Agent's WhatsApp number (e.g. 966501234567)

# QStash (appointment reminders)
QSTASH_TOKEN=             # Upstash QStash token
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# App
PORT=3000
NODE_ENV=production
```

---

## How to Test

### 1. Reset conversation state
```sql
DELETE FROM conversations WHERE client_id = 'anonymous';
```

### 2. Send a WhatsApp message
From a **different phone** than the agent number, send **"Hi"** to the bot.

### 3. Go through the full flow
- Select an option (1–4)
- Answer the questions
- Submit name and phone number

### 4. Verify
- ✅ Agent receives WhatsApp notification
- ✅ Lead appears in Google Sheets
- ✅ Lead saved in Neon `leads` table
- ✅ Bot goes silent after lead is captured

### 5. Test AI fallback (Pro feature)
```bash
npm run features set-tier anonymous pro
```
Then after lead capture, send a question like **"كم أسعار الفلل؟"** — the bot should respond in Gulf Arabic.

---

## Deployment

- **Hosting:** Render (free tier — resets 750 hrs on 1st of each month)
- **Deploy trigger:** Push to `main` branch on GitHub → Render auto-deploys
- **Webhook URL:** `https://YOUR-RENDER-URL.onrender.com/webhook`
- **Meta webhook:** Must be updated in Meta Business Suite if Render URL changes

### ⚠️ Render Free Tier Gotcha
Render suspends free services if you hit 750 instance hours in a month. Hours reset on the 1st. If suspended mid-month, migrate to **Railway** (railway.app) — free $5 credits/month, no sleeping.

---

## Current Status (April 2026)

### ✅ Working
- Full lead capture conversation flow (real estate)
- WhatsApp interactive buttons and lists
- Multi-tenant architecture
- Conversation state persistence (Redis + PostgreSQL)
- Google Sheets lead logging
- Agent WhatsApp notifications
- 24-hour conversation auto-reset
- Feature flags system (4 flags)
- AI fallback responses in Gulf Arabic (Claude API)
- Lead scoring (hot/warm/cold)
- Handover detection
- Appointment setting + QStash reminders
- Tiered pricing model (Basic/Pro/Business)
- CLI for managing feature flags

### 🔲 Pending / Next Steps
- Knowledge base content population (real estate FAQs)
- Full appointment reminder flow testing
- Onboarding second client
- Client acquisition outreach (clinics, driving schools, medical labs)

---

## Business Context

**Target market:** Saudi Arabian small businesses (Eastern Province focus)  
**Current clients:** 1 (real estate agent, Eastern Province)  
**Expansion verticals:** Medical clinics, car dealerships, driving schools, home services, construction

### Potential pivot opportunities explored
- ZATCA compliance automation
- Arabic medical transcription
- Construction documentation AI
- Enterprise/agency model (higher value, fewer clients)

---

## Key Contacts & Resources

- **Meta Business Suite:** manage.whatsapp.com
- **Neon Dashboard:** console.neon.tech
- **Upstash Dashboard:** console.upstash.com
- **Render Dashboard:** dashboard.render.com
- **GitHub Repo:** github.com/YOUR_USERNAME/whatsapp-ai-saas
