# Functionalities & Capabilities Status

## 100% Active

- API health check (`/health`)
- Client registration (`/auth/register`)
- JWT auth + protected routes
- API key management
- Audit logs
- Leads CRUD + filtering + pagination
- Dashboard stats
- Analytics (basic + advanced)
- AI feedback capture + listing
- Automation sequences + enrollments + run-now processing
- Database migrations + backups (configured)
- Webhook verification (shared `/webhook/whatsapp` and legacy `/webhook/whatsapp/:clientId`)

## 70% Active (Degraded/Depends on External Config)

- AI chat responses (works with fallback when AI key invalid/missing)
- AI lead scoring (fallback rule-based when AI key invalid/missing)
- WhatsApp message handling (requires valid Meta credentials + phone_number_id mapping)
- Google Sheets sync (requires valid service account credentials)

## 50% Active (Requires Setup)

- Analytics file uploads (requires storage configuration: S3 or local uploads dir)
- AI suggestions from uploads (requires AI key + uploads configured)
