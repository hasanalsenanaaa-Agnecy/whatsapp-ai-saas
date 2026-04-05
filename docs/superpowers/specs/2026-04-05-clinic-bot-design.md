# Clinic WhatsApp Bot — Design Spec
**Date:** 2026-04-05
**Branch:** `dev` on `github.com/alsenana89/whatsapp-bot`

---

## Overview

Adapt the existing WhatsApp AI SaaS bot into a dental clinic receptionist bot for Perfect Smile. The bot handles all inbound WhatsApp messages on the clinic's number, guides patients through a scripted flow using real data from the Perfect Smile API, and submits completed leads to the Perfect Smile bookings system where they appear in the WhatsApp contacts tab of `bookings.html`.

---

## Architecture

### Data Flow

```
Patient messages clinic WhatsApp number
  → Meta webhook → bot (Fastify, Node.js on Render)
  → Fetch live clinic data from Perfect Smile API (cached 30 min)
  → Scripted button flow with real service/offer names
  → On completion → POST to bookings.php
  → Card appears in bookings.html WhatsApp tab
```

### Repos & Locations

| Item | Location |
|---|---|
| Bot repo | `~/Documents/whatsapp-bot` (fork: `github.com/alsenana89/whatsapp-bot`) |
| Active branch | `dev` |
| Perfect Smile API base | `https://megaproduction.co/book/api` |
| Bookings dashboard | `https://megaproduction.co/book/dashboard/bookings.html` |

---

## Section 1 — Perfect Smile API Endpoints Used

### Clinic data (one call, cached)
```
GET /clinic-data.php?action=all&clinic_id={clinicId}
```
Returns: `{ clinic: { name_ar, name_en, address, phone, working_days, ... }, services: [...], doctors: [...] }`

### Active offers (one call, cached)
```
GET /campaigns-api.php?resource=offers&action=list_active_offers&clinic_id={clinicId}
```
Returns: `{ offers: [{ id, offer_code, name_ar, name_en, offer_price, original_price, discount_percentage, service_id, ... }] }`
Only returns offers where `status != 'expired'` and within valid date range.

### Submit booking (on conversation completion)
```
POST /bookings.php?action=create
Content-Type: application/json

{
  "contact_type": "whatsapp",
  "source": "whatsapp_bot",
  "clinic_id": "{clinicId}",
  "patient_name": "{name}",
  "patient_phone": "{phone}",
  "notes": "{selectedItemNameAr}||{selectedItemNameEn}",
  "offer_code": "{offerCode}",   // if offer selected, else omit
  "service_id": "{serviceId}"    // if service selected, else omit
}
```

---

## Section 2 — Conversation Flow

States: `welcome → questions (dynamic) → completed`

The existing generic state machine in `conversation.ts` is preserved. A new `handleClinicFlow()` function handles the clinic-specific path, activated when `client.industry === 'dental'`.

### Step-by-step

| Step | Bot sends | Patient picks |
|---|---|---|
| 1. Welcome | "أهلاً في {clinicName}! وش اسمك الكريم؟" | Free text (name) |
| 2. Choose type | "هلا {name}! كيف أقدر أساعدك؟" + buttons | العروض / الخدمات |
| 3a. Offers | List active offer names as buttons (≤3 per message, paginate with "المزيد" if more) | Pick one offer |
| 3b. Services | List service names as buttons (≤3 per message, paginate if more) | Pick one service |
| 4. Preferred day | Working days from clinic DB as buttons | Pick a day |
| 5. Preferred time | "أي وقت يناسبك؟" | صباحاً / ظهراً / مساءً |
| 6. Thank you | "شكراً {name}! سيتواصل معك فريقنا قريباً. عنواننا: {address}" | — |

### Notes
- Step 2 "Offers" button only shown if at least one active offer exists
- WhatsApp button limit is 3 per message; if more items exist, add "عرض المزيد" button and send next batch
- Working days are fetched from `clinic.working_days` (JSON array in DB), mapped to Arabic day names
- If patient sends unexpected input, re-send current step

---

## Section 3 — New Files

### `src/services/clinicData.ts`

Responsibilities:
- `fetchClinicData(apiBaseUrl: string, clinicId: string): Promise<ClinicData>` — fetches both endpoints
- In-memory cache: `Map<clientId, { data: ClinicData; expiresAt: number }>` with 30-minute TTL
- `ClinicData` type: `{ clinic: ClinicInfo; services: Service[]; offers: Offer[] }`
- Cache is per `clientId`, not per `clinicId`, so different bot clients can have different clinics

### `src/services/bookingWebhook.ts`

Responsibilities:
- `pushToBookingAPI(client: any, conv: ConversationState): Promise<boolean>`
- Reads `client.settings.booking_api.url` and `client.settings.booking_api.clinic_id`
- Builds and POSTs the booking payload (see Section 1)
- Returns `true` on success, `false` on failure (failure does not block the thank-you message)
- Logs success/failure with patient phone (no sensitive data in logs)

### Modified: `src/conversation.ts`

- Add `import { fetchClinicData } from './services/clinicData.js'`
- Add `import { pushToBookingAPI } from './services/bookingWebhook.js'`
- Add `handleClinicFlow()` — the full state machine for clinic industry
- In `handleIncomingMessage()`, branch on `client.industry`:
  - `dental | clinic | medical | healthcare` → `handleClinicFlow()`
  - everything else → existing `handleQuestions()` path

### Modified: `src/messages.ts`

Add `DENTAL_CLINIC_MESSAGES` — Arabic-first message strings with placeholders:
- `{clinicName}`, `{patientName}`, `{clinicAddress}`, `{workingHours}`
- Separate from the existing generic `CLINIC_MESSAGES` to allow dental-specific wording

---

## Section 4 — Client DB Record

One row in the bot's `clients` table for Perfect Smile. No schema changes needed — uses existing JSONB fields.

```json
{
  "name": "Perfect Smile",
  "industry": "dental",
  "phone_number_id": "<META_PHONE_NUMBER_ID>",
  "access_token": "<META_ACCESS_TOKEN>",
  "active": true,
  "features": {
    "ai_fallback": false,
    "lead_scoring": false,
    "handover_detection": false,
    "appointment_setting": false
  },
  "settings": {
    "booking_api": {
      "url": "https://megaproduction.co/book/api",
      "clinic_id": "<PERFECT_SMILE_CLINIC_ID>"
    }
  },
  "questions": []
}
```

`phone_number_id` and `access_token` come from Meta Business Manager when the WhatsApp Business API is set up.

---

## Section 5 — Bookings Page Change (`bookings.html`)

In the WhatsApp contacts tab renderer (`#whatsappContactsList`), add a source badge for `source === 'whatsapp_bot'`:

- Style: `background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd`
- Label: `روبوت` (AR) / `Bot` (EN)
- Placed next to the patient name in the card header, same pattern as existing source badges

This lets staff distinguish bot-originated contacts from widget button-click contacts.

---

## Out of Scope (for now)

- AI-driven free-form chat (Claude knowledge base) — future phase
- Multi-language support in bot messages (Arabic only for now)
- Doctor selection in the bot flow
- Render deployment setup (handled by brother)
- Meta WhatsApp Business API account setup

---

## Implementation Order

1. Create `src/services/clinicData.ts`
2. Create `src/services/bookingWebhook.ts`
3. Add `DENTAL_CLINIC_MESSAGES` to `src/messages.ts`
4. Add `handleClinicFlow()` to `src/conversation.ts`
5. Wire `handleIncomingMessage()` to branch on industry
6. Add `whatsapp_bot` badge to `bookings.html`
7. Insert client DB record for Perfect Smile
8. Test end-to-end locally with ngrok
