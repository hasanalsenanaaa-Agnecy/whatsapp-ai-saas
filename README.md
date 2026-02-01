# WhatsApp AI SaaS

Production-ready WhatsApp AI SaaS platform with a hardened database layer, backups, encryption, and migrations.

## Quick Start

```bash
npm install
npm run dev
```

## Database Maintenance

```bash
npm run db:backup
npm run db:list
npm run db:restore -- backup-<timestamp>.sql.enc
npm run db:pitr -- 2026-02-01T12:00:00.000Z
npm run db:migrate
npm run db:rollback -- 2026-02-01-constraints
npm run db:rotate-key -- <newKeyHex>
```

## Environment Variables

- `DATABASE_URL` (required)
- `ENCRYPTION_KEY` (required in production)
- `BACKUP_DIR` (default: `./backups`)
- `BACKUP_PG_DUMP_CMD` (optional, override `pg_dump` command)
- `BACKUP_S3_BUCKET` (optional)
- `BACKUP_S3_REGION` (optional, default: `us-east-1`)
- `BACKUP_S3_PREFIX` (optional)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (required for S3)

## Portal

```bash
cd portal
npm install
npm run dev
```
