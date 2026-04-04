# Quick Reference

## Start Development

```bash
npm run dev
```

## Add New Client

```bash
npm run client add
```

## Manage Features

```bash
npm run features enable <client_id> ai_fallback
npm run features set-tier <client_id> pro
```

## Test

```bash
npm run test
npm run ai:smoke
```

## Deploy

```bash
npm run build
npm start
```

## Documentation

See `docs/` folder:

- ARCHITECTURE.md - Tech stack overview
- CLINIC_SETUP.md - Clinic onboarding
- CURRENT_STATE.md - What's built vs archived
- MULTI_TENANCY.md - Multi-client architecture
- FEATURES_STATUS.md - Feature completion status

## Environment Variables

Copy `config/.env.example` to `.env` and fill in:

- WhatsApp credentials (WHATSAPP_TOKEN, etc)
- Database (DATABASE_URL)
- Redis (UPSTASH_REDIS_REST_URL)
- Optional: AI (ANTHROPIC_API_KEY), Sheets, Reminders

## Folder Structure

```
src/
  ├── services/  - Business logic (WhatsApp, DB, AI)
  ├── scripts/   - CLI tools
  ├── cron/      - Scheduled tasks
  ├── schemas/   - Validation
  └── __tests__/ - Tests

docs/
  └── [comprehensive guides]

config/
  └── [config templates]
```

## Common Issues

| Issue                 | Solution                                       |
| --------------------- | ---------------------------------------------- |
| Messages not arriving | Check WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID |
| Database error        | Check DATABASE_URL in .env                     |
| AI not responding     | Set ANTHROPIC_API_KEY                          |
| Tests fail            | Run `npm install` and check env vars           |

## Support

- Render logs: `Render Dashboard → Services → Logs`
- Database: Neon Console (console.neon.tech)
- WhatsApp: Meta Business Suite
