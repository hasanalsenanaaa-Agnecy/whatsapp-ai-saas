# WhatsApp AI SaaS - Lead Capture & Automation Platform

**A production-ready WhatsApp business automation platform for Saudi Arabian SMBs (clinics, real estate, dealerships, services)**

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (Neon)
- Redis (Upstash)
- WhatsApp Business API account (Meta)

### Installation
```bash
git clone <repo>
cd whatsapp-ai-saas
npm install
npm run build
npm run dev
```

### Environment Setup
```bash
cp config/.env.example .env
# Edit .env with your credentials
```

### Deploy
```bash
npm run build
npm start
```

---

## 📁 Project Structure

```
whatsapp-ai-saas/
├── src/                    # Application code
│   ├── services/           # WhatsApp, AI, database, etc
│   ├── scripts/            # CLI tools (client, features)
│   ├── cron/               # Scheduled tasks (reminders)
│   ├── schemas/            # Validation
│   ├── __tests__/          # Tests (unit & integration)
│   └── index.ts            # Entry point
│
├── docs/                   # Documentation
│   ├── ARCHITECTURE.md     # Tech stack & database
│   ├── CURRENT_STATE.md    # What's built vs archived
│   ├── FEATURES_STATUS.md  # Feature status
│   ├── CLINIC_SETUP.md     # Clinic onboarding
│   ├── MULTI_TENANCY.md    # Multi-client architecture
│   └── ...
│
├── config/                 # Configuration
│   ├── .env.example        # Environment template
│   └── tsconfig.json       # TypeScript config
│
└── package.json            # Dependencies
```

---

## ✨ Core Features

### ✅ Active
- Lead capture with industry-specific flows
- WhatsApp automation (buttons, lists, messages)
- Multi-tenant (unlimited clients)
- Appointment booking + reminders
- AI fallback (Claude API)
- Google Sheets sync
- Lead scoring
- Agent notifications

### Supported Industries
- Real Estate
- Clinics
- Car Dealerships
- Generic/Customizable

---

## 🛠️ Quick Commands

```bash
# Add new client
npm run client add

# Enable features
npm run features enable <client_id> ai_fallback

# Set pricing tier
npm run features set-tier <client_id> pro

# Run tests
npm run test

# Test AI
npm run ai:smoke

# Deploy
npm run build && npm start
```

---

## 📚 Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Tech stack & database
- **[CURRENT_STATE.md](docs/CURRENT_STATE.md)** - Features built vs archived
- **[CLINIC_SETUP.md](docs/CLINIC_SETUP.md)** - Setup guide for clinics
- **[MULTI_TENANCY.md](docs/MULTI_TENANCY.md)** - How clients stay isolated
- **[FEATURES_STATUS.md](docs/FEATURES_STATUS.md)** - Feature completion

---

## 🚀 Deployment

Currently on **Render** (free tier)

```bash
# Deploy
git push origin main  # Auto-deploys to Render

# Environment variables
Render Dashboard → Services → Environment
```

Webhook URL: `https://<your-render-url>.onrender.com/webhook/whatsapp`

---

## 💰 Pricing (Per Client)

| Tier | Monthly | Features |
|------|---------|----------|
| **Basic** | 500 SAR | Leads, notifications, Sheets |
| **Pro** | 899 SAR | + AI, scoring, handover |
| **Business** | 1,499 SAR | + Appointments, analytics |

---

## 🔐 Environment Variables

Required:
- `WHATSAPP_TOKEN` - Meta API token
- `WHATSAPP_PHONE_NUMBER_ID` - Meta phone ID
- `WHATSAPP_VERIFY_TOKEN` - Webhook token
- `DATABASE_URL` - PostgreSQL (Neon)
- `UPSTASH_REDIS_REST_URL` - Redis
- `UPSTASH_REDIS_REST_TOKEN` - Redis token

Optional:
- `ANTHROPIC_API_KEY` - Claude AI
- `GOOGLE_SHEET_ID` - Google Sheets
- `GOOGLE_CREDENTIALS` - Service account JSON
- `QSTASH_TOKEN` - Appointment reminders

See `config/.env.example` for template.

---

## 🧪 Testing

```bash
npm run test           # All tests
npm run test:unit      # Unit tests
npm run test:integration  # Integration tests
npm run test:coverage  # Coverage report
npm run test:watch     # Watch mode
```

---

## 🐛 Troubleshooting

| Issue | Check |
|-------|-------|
| Messages not arriving | WhatsApp credentials, Render logs, webhook URL |
| DB connection error | `DATABASE_URL` format, Neon connection |
| AI not responding | `ANTHROPIC_API_KEY`, API credits |
| Reminders not sending | `QSTASH_TOKEN`, appointment `reminder_at` field |

Logs: `Render Dashboard → Services → Logs`

---

## 📊 Database

- **PostgreSQL** on Neon
- **Schema**: clients, conversations, leads, appointments
- **Complete isolation** by client_id (no data mixing)
- **Supports**: Unlimited clients

---

## 🔌 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Fastify |
| Database | PostgreSQL (Neon) |
| Cache | Redis (Upstash) |
| AI | Claude (Anthropic) |
| WhatsApp | Meta Business API |
| Hosting | Render |

---

## ✅ Status

- **Version**: 3.0.0
- **Status**: Production Ready
- **Last Updated**: April 2026
- **Active Clients**: 1
- **Scalable to**: 100+ clients

---

## 📖 For More Info

See the [docs/](docs/) folder for comprehensive guides on architecture, setup, and features.
