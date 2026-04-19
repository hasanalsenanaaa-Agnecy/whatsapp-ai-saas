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
npm run test           # All tests
npm run test:unit      # Unit tests only
```

## Deploy

```bash
npm run build
npm start
```

## Revenue Reports

```bash
npx tsx src/scripts/revenue.ts [clientId]
```

## Environment Variables

Copy `config/.env.example` to `.env` and fill in:

- `DATABASE_URL` — PostgreSQL (Neon)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`
- Optional: `ANTHROPIC_API_KEY`, `GOOGLE_CREDENTIALS`, `CRON_SECRET`, `ANALYTICS_KEY`

## Key Files

```
src/index.ts           — Server + webhooks
src/conversation.ts    — State machine router
src/messages.ts        — WhatsApp templates (Gulf Arabic)
src/flows/             — Conversation flows
src/services/          — Business logic
src/services/shopify/  — Shopify agent modules
src/types/client.ts    — Client config contract
src/cron/              — Reminders + abandoned cart recovery
```

## Common Issues

| Issue                 | Solution                                        |
| --------------------- | ----------------------------------------------- |
| Messages not arriving | Check WHATSAPP_ACCESS_TOKEN, phone number ID    |
| Database error        | Check DATABASE_URL in .env                      |
| AI not responding     | Set ANTHROPIC_API_KEY                           |
| Cron not firing       | Check CRON_SECRET matches QStash header         |

## Monitoring

- Render logs: `Render Dashboard > Services > Logs`
- Database: Neon Console (console.neon.tech)
- Cron: QStash dashboard (console.upstash.com)
- WhatsApp: Meta Business Suite
