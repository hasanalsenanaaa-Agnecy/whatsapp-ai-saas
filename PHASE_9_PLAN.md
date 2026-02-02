# Phase 9 Plan — Production Readiness + Analytics Upload + AI Suggestions

## Objectives

- Launch a business‑ready, compliant, and reliable multi‑tenant platform.
- Add analytics data upload for customers (CSV/JSON) with secure storage and parsing.
- Generate AI suggestions using uploaded + in‑app data.

## Scope

- **Production readiness:** security hardening, observability, backups, billing readiness, SLA/ops runbooks.
- **Analytics upload:** API, storage, parsing, DB schema, portal UI.
- **AI suggestions:** aggregation + prompt engineering + audit logging.

## Launch Readiness Checklist

### Security & Compliance

- Input validation, multipart limits, and file type validation.
- PII minimization: strip sensitive fields from AI prompts.
- Encryption at rest for uploaded data (S3 SSE or local disk encryption).
- Audit log entries for upload + suggestion generation.
- Rate limiting for upload endpoints.
- Token + API key policies (rotation, TTL, revocation).

### Reliability & Observability

- Upload processing status tracking + retry mechanisms.
- Structured logs for upload/parse/AI errors.
- Monitoring: request latency + error rates per client.
- Backups for analytics upload metadata tables.

### Product & Ops

- Billing plan gates for upload + AI suggestions.
- Support & incident runbook.
- Data retention policy (e.g., 30–180 days).

## API Changes

- `POST /api/clients/:clientId/analytics/uploads` (multipart)
- `GET /api/clients/:clientId/analytics/uploads`
- `GET /api/clients/:clientId/analytics/uploads/:id`
- `POST /api/clients/:clientId/analytics/suggestions` (optional `uploadId`)

## Database Changes

- `analytics_uploads` table with:
  - `id`, `client_id`, `filename`, `mime_type`, `size_bytes`, `status`, `row_count`,
    `columns`, `sample_rows`, `summary`, `storage_key`, `error`, `suggestions`, `created_at`, `updated_at`.

## Backend Implementation Plan

- Add multipart plugin + upload limits.
- Store raw file in local disk or S3 (configurable).
- Parse CSV/JSON into normalized sample and summary stats.
- Persist metadata + summary into `analytics_uploads`.
- AI suggestion endpoint uses summary + in‑app analytics.

## Portal (HTML/CSS/TS) Modifications

- **HTML (JSX)**: Upload form + dataset type selector + notes/description.
- **CSS (Tailwind)**: Dropzone, progress state, file pills, error badges, and empty‑state cards.
- **TypeScript**: API client for uploads/suggestions, types for upload metadata, optimistic UI + validation.

## AI Suggestions (Logic)

- Construct prompt containing:
  - In‑app analytics (conversion, funnel, attribution).
  - Uploaded dataset summary (row count, columns, top values).
- Return 3–7 prioritized recommendations + quick wins.

## Acceptance Criteria

- Upload works for CSV/JSON, with size/type limits.
- Metadata + summary visible in portal.
- AI suggestions generated for latest upload.
- Full audit log traceability and error handling.
