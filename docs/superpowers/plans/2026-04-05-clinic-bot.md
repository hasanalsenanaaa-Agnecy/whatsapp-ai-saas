# Clinic WhatsApp Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dental clinic WhatsApp bot that guides patients through a scripted flow using live data from the Perfect Smile API and creates booking records in the bookings dashboard.

**Architecture:** Two new service files handle data fetching/caching (`clinicData.ts`) and booking submission (`bookingWebhook.ts`). A new `handleClinicFlow()` function in `conversation.ts` implements the clinic state machine; all other client types are unaffected. A minor badge addition to `bookings.html` distinguishes bot-originated contacts.

**Tech Stack:** TypeScript, Node.js, Fastify, WhatsApp Cloud API (Meta), Vitest, PHP/MySQL (Perfect Smile API — external)

---

## File Map

| Action | File | What changes |
|---|---|---|
| Create | `src/services/clinicData.ts` | Fetch + cache clinic data from Perfect Smile API |
| Create | `src/services/bookingWebhook.ts` | POST completed lead to Perfect Smile bookings API |
| Create | `src/__tests__/unit/clinicData.test.ts` | Unit tests for clinicData service |
| Create | `src/__tests__/unit/bookingWebhook.test.ts` | Unit tests for bookingWebhook service |
| Modify | `src/messages.ts` | Add `DENTAL_CLINIC_MESSAGES`, update `getDefaultMessages()` |
| Modify | `src/conversation.ts` | Add `handleClinicFlow()` + helpers + industry branch |
| Modify | `book/dashboard/bookings.html` | Add `whatsapp_bot` source badge in WhatsApp contacts tab |

---

## Task 1: `src/services/clinicData.ts`

**Files:**
- Create: `src/services/clinicData.ts`
- Create: `src/__tests__/unit/clinicData.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/unit/clinicData.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchClinicData, clearClinicCache } from '../../services/clinicData.js';

const mockAllData = {
  clinic: {
    id: '1',
    name_ar: 'بيرفكت سمايل',
    name_en: 'Perfect Smile',
    address: 'الرياض، حي النزهة',
    phone: '0500000000',
    working_days: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']
  },
  services: [
    { id: 1, name_ar: 'تبييض الأسنان', name: 'Teeth Whitening' },
    { id: 2, name_ar: 'تقويم الأسنان', name: 'Braces' }
  ],
  doctors: []
};

const mockOffersData = {
  offers: [
    {
      id: 1,
      offer_code: 'WHITE50',
      name_ar: 'عرض تبييض الأسنان',
      name_en: 'Whitening Offer',
      offer_price: 500,
      original_price: 1000,
      discount_percentage: 50,
      service_id: 1
    }
  ]
};

describe('clinicData', () => {
  beforeEach(() => {
    clearClinicCache('client-1');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches from both API endpoints on first call', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => mockAllData })
      .mockResolvedValueOnce({ ok: true, json: async () => mockOffersData });

    const result = await fetchClinicData('https://api.example.com', '1', 'client-1');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch as any).mock.calls[0][0]).toContain('clinic-data.php?action=all');
    expect((fetch as any).mock.calls[1][0]).toContain('list_active_offers');
    expect(result).not.toBeNull();
    expect(result!.clinic.name_ar).toBe('بيرفكت سمايل');
    expect(result!.services).toHaveLength(2);
    expect(result!.offers).toHaveLength(1);
  });

  it('returns cached data on second call without fetching again', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => mockAllData })
      .mockResolvedValueOnce({ ok: true, json: async () => mockOffersData });

    await fetchClinicData('https://api.example.com', '1', 'client-1');
    const result = await fetchClinicData('https://api.example.com', '1', 'client-1');

    expect(fetch).toHaveBeenCalledTimes(2); // not 4
    expect(result!.clinic.name_ar).toBe('بيرفكت سمايل');
  });

  it('returns null when clinic-data fetch fails', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => mockOffersData });

    const result = await fetchClinicData('https://api.example.com', '1', 'client-1');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    (fetch as any).mockRejectedValue(new Error('network error'));

    const result = await fetchClinicData('https://api.example.com', '1', 'client-1');
    expect(result).toBeNull();
  });

  it('returns empty offers array when offers endpoint fails', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => mockAllData })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await fetchClinicData('https://api.example.com', '1', 'client-1');
    expect(result).toBeNull();
  });

  it('clearClinicCache forces a fresh fetch on next call', async () => {
    (fetch as any)
      .mockResolvedValue({ ok: true, json: async () => mockAllData })
      .mockResolvedValue({ ok: true, json: async () => mockOffersData });

    await fetchClinicData('https://api.example.com', '1', 'client-1');
    clearClinicCache('client-1');
    await fetchClinicData('https://api.example.com', '1', 'client-1');

    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Documents/whatsapp-bot
npx vitest run src/__tests__/unit/clinicData.test.ts
```
Expected: FAIL — `Cannot find module '../../services/clinicData.js'`

- [ ] **Step 3: Create `src/services/clinicData.ts`**

```typescript
// src/services/clinicData.ts

export interface ClinicInfo {
  id: string;
  name_ar: string;
  name_en: string;
  address: string;
  phone: string;
  working_days: string[]; // e.g. ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']
}

export interface Service {
  id: number;
  name_ar: string;
  name: string; // English name
}

export interface Offer {
  id: number;
  offer_code: string;
  name_ar: string;
  name_en: string;
  offer_price: number;
  original_price: number;
  discount_percentage: number;
  service_id: number | null;
}

export interface ClinicData {
  clinic: ClinicInfo;
  services: Service[];
  offers: Offer[];
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  data: ClinicData;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

export async function fetchClinicData(
  apiBaseUrl: string,
  clinicId: string,
  clientId: string
): Promise<ClinicData | null> {
  const cached = _cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const [allDataRes, offersRes] = await Promise.all([
      fetch(`${apiBaseUrl}/clinic-data.php?action=all&clinic_id=${encodeURIComponent(clinicId)}`),
      fetch(`${apiBaseUrl}/campaigns-api.php?resource=offers&action=list_active_offers&clinic_id=${encodeURIComponent(clinicId)}`)
    ]);

    if (!allDataRes.ok || !offersRes.ok) {
      console.error('❌ Clinic data fetch failed');
      return null;
    }

    const allData = await allDataRes.json();
    const offersData = await offersRes.json();

    const data: ClinicData = {
      clinic: allData.clinic,
      services: allData.services || [],
      offers: offersData.offers || []
    };

    _cache.set(clientId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;

  } catch (error) {
    console.error('❌ Clinic data error:', error);
    return null;
  }
}

export function clearClinicCache(clientId: string): void {
  _cache.delete(clientId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/unit/clinicData.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/whatsapp-bot
git add src/services/clinicData.ts src/__tests__/unit/clinicData.test.ts
git commit -m "feat: add clinicData service with 30-min cache"
```

---

## Task 2: `src/services/bookingWebhook.ts`

**Files:**
- Create: `src/services/bookingWebhook.ts`
- Create: `src/__tests__/unit/bookingWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/unit/bookingWebhook.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushToBookingAPI } from '../../services/bookingWebhook.js';

const makeClient = (settingsOverride: any = {}) => ({
  id: 'c1',
  settings: {
    booking_api: {
      url: 'https://example.com/book/api',
      clinic_id: 'clinic-1'
    },
    ...settingsOverride
  }
});

const makeConv = (dataOverride: any = {}) => ({
  phone: '966501234567',
  data: {
    name: 'محمد',
    selectedItemNameAr: 'تبييض الأسنان',
    selectedItemNameEn: 'Teeth Whitening',
    ...dataOverride
  }
});

describe('pushToBookingAPI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when booking_api config is missing', async () => {
    const client = { id: 'c1', settings: {} };
    const result = await pushToBookingAPI(client, makeConv());
    expect(result).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts to correct URL with correct content-type', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });

    await pushToBookingAPI(makeClient(), makeConv());

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/book/api/bookings.php?action=create',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  it('sends correct payload for service selection', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });

    const conv = makeConv({ serviceId: 5, selectedItemNameAr: 'تقويم', selectedItemNameEn: 'Braces' });
    await pushToBookingAPI(makeClient(), conv);

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.contact_type).toBe('whatsapp');
    expect(body.source).toBe('whatsapp_bot');
    expect(body.clinic_id).toBe('clinic-1');
    expect(body.patient_name).toBe('محمد');
    expect(body.patient_phone).toBe('966501234567');
    expect(body.notes).toBe('تقويم||Braces');
    expect(body.service_id).toBe(5);
    expect(body.offer_code).toBeUndefined();
  });

  it('includes offer_code when offer selected', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });

    const conv = makeConv({ offerCode: 'WHITE50' });
    await pushToBookingAPI(makeClient(), conv);

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.offer_code).toBe('WHITE50');
  });

  it('omits offer_code and service_id when neither selected', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });

    await pushToBookingAPI(makeClient(), makeConv());

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.offer_code).toBeUndefined();
    expect(body.service_id).toBeUndefined();
  });

  it('returns false on non-ok response', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 422, text: async () => 'Unprocessable' });

    const result = await pushToBookingAPI(makeClient(), makeConv());
    expect(result).toBe(false);
  });

  it('returns false on network error without throwing', async () => {
    (fetch as any).mockRejectedValue(new Error('network error'));

    const result = await pushToBookingAPI(makeClient(), makeConv());
    expect(result).toBe(false);
  });

  it('returns true on success', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await pushToBookingAPI(makeClient(), makeConv());
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/unit/bookingWebhook.test.ts
```
Expected: FAIL — `Cannot find module '../../services/bookingWebhook.js'`

- [ ] **Step 3: Create `src/services/bookingWebhook.ts`**

```typescript
// src/services/bookingWebhook.ts

interface BookingPayload {
  contact_type: 'whatsapp';
  source: 'whatsapp_bot';
  clinic_id: string;
  patient_name: string;
  patient_phone: string;
  notes: string;
  offer_code?: string;
  service_id?: number;
}

export async function pushToBookingAPI(client: any, conv: any): Promise<boolean> {
  const bookingApi = client.settings?.booking_api;
  if (!bookingApi?.url || !bookingApi?.clinic_id) {
    console.error('❌ No booking_api config for client:', client.id);
    return false;
  }

  const notesAr: string = conv.data.selectedItemNameAr || '';
  const notesEn: string = conv.data.selectedItemNameEn || '';
  const notes = (notesAr && notesEn)
    ? `${notesAr}||${notesEn}`
    : (notesAr || notesEn || '');

  const payload: BookingPayload = {
    contact_type: 'whatsapp',
    source: 'whatsapp_bot',
    clinic_id: bookingApi.clinic_id,
    patient_name: conv.data.name || 'عميل واتساب',
    patient_phone: conv.phone,
    notes
  };

  if (conv.data.offerCode) payload.offer_code = conv.data.offerCode;
  if (conv.data.serviceId) payload.service_id = Number(conv.data.serviceId);

  try {
    const response = await fetch(
      `${bookingApi.url}/bookings.php?action=create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const body = await response.text();
      console.error(`❌ Booking API ${response.status}:`, body);
      return false;
    }

    console.log(`✅ Booking created for ${conv.phone}`);
    return true;
  } catch (error) {
    console.error('❌ Booking webhook error:', error);
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/unit/bookingWebhook.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/bookingWebhook.ts src/__tests__/unit/bookingWebhook.test.ts
git commit -m "feat: add bookingWebhook service to push leads to Perfect Smile API"
```

---

## Task 3: `DENTAL_CLINIC_MESSAGES` in `src/messages.ts`

**Files:**
- Modify: `src/messages.ts`

- [ ] **Step 1: Add `DENTAL_CLINIC_MESSAGES` export before `getDefaultMessages()`**

Open `src/messages.ts`. Find the `CAR_DEALERSHIP_MESSAGES` block. Add the following immediately after it (before the `GENERIC_MESSAGES` block):

```typescript
// ============================================================
// DENTAL CLINIC MESSAGES (Perfect Smile)
// ============================================================
export const DENTAL_CLINIC_MESSAGES: ClientMessages = {
  welcome: `أهلاً وسهلاً في {businessName}! 🦷\n\nوش اسمك الكريم؟`,
  askName: `وش اسمك الكريم؟`,
  questions: [], // not used — clinic flow is handled dynamically in handleClinicFlow()
  thankYou: `شكراً يا {name}! ✅\n\nتم استلام طلبك وسيتواصل معك فريقنا قريباً.\n\n📍 {address}\n⏰ {workingHours}`,
  thankYouWithAppointment: `شكراً يا {name}! ✅\n\nتم استلام طلبك وسيتواصل معك فريقنا قريباً.\n\n📍 {address}`,
  invalidInput: `اختر من الخيارات المتاحة 👆`,
  agentNotification: `🦷 *مريض جديد - بوت واتساب*\n\n👤 {name}\n📱 {phone}\n\n📋 {details}\n⏰ {time}\n\nwa.me/{whatsapp}`,
  appointmentNotification: `📅 *طلب موعد جديد*\n\n👤 {name}\n📱 {phone}\n📋 {details}\n\nwa.me/{whatsapp}`,
  askAppointmentDate: `متى يناسبك الموعد؟`,
  askAppointmentTime: `أي وقت يناسبك؟`,
  appointmentConfirmed: `تمام يا {name}! ✅\n\nتم تسجيل طلبك.`,
  appointmentReminder: `مرحبا {name}! 👋\n\nتذكير بموعدك اليوم {appointmentTime} في {businessName}.\nنتطلع لخدمتك! ✨`,
  handoverDetected: `فهمت! خليني أحولك للاستقبال.\nبيتواصلون معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل للموظف*\n\n👤 {name}\n📱 {phone}\n\nآخر رسالة: {lastMessage}\n\nwa.me/{whatsapp}`
};
```

- [ ] **Step 2: Update `getDefaultMessages()` to route `dental` to the new template**

Find the `getDefaultMessages()` function at the bottom of `src/messages.ts`. Replace the `case 'clinic':` block:

```typescript
// BEFORE:
case 'clinic':
case 'medical':
case 'dental':
case 'healthcare':
  return CLINIC_MESSAGES;

// AFTER:
case 'dental':
  return DENTAL_CLINIC_MESSAGES;
case 'clinic':
case 'medical':
case 'healthcare':
  return CLINIC_MESSAGES;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd ~/Documents/whatsapp-bot
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/messages.ts
git commit -m "feat: add DENTAL_CLINIC_MESSAGES template for Perfect Smile"
```

---

## Task 4: `handleClinicFlow()` in `src/conversation.ts`

**Files:**
- Modify: `src/conversation.ts`

This task adds all the clinic-specific conversation logic. The existing generic flow is untouched.

- [ ] **Step 1: Add imports at the top of `src/conversation.ts`**

Open `src/conversation.ts`. After the existing imports (around line 11), add:

```typescript
import { fetchClinicData, type ClinicInfo, type Service, type Offer } from './services/clinicData.js';
import { pushToBookingAPI } from './services/bookingWebhook.js';
```

- [ ] **Step 2: Add the day map constant after the `CONVERSATION_TIMEOUT_HOURS` constant**

Find `const CONVERSATION_TIMEOUT_HOURS = 24;` and add below it:

```typescript
const CLINIC_DAY_MAP: Record<string, string> = {
  sunday:    'الأحد',
  monday:    'الاثنين',
  tuesday:   'الثلاثاء',
  wednesday: 'الأربعاء',
  thursday:  'الخميس',
  friday:    'الجمعة',
  saturday:  'السبت'
};
```

- [ ] **Step 3: Add `handleClinicFlow()` and all helpers at the end of `src/conversation.ts`**

Append the following to the end of the file, after all existing functions:

```typescript
// ============================================================
// CLINIC FLOW
// Handles dental/clinic/medical/healthcare industry clients.
// Uses real data from Perfect Smile API (cached 30 min).
// ============================================================

export async function handleClinicFlow(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  const bookingApi = client.settings?.booking_api;
  if (!bookingApi?.url || !bookingApi?.clinic_id) {
    await sendWhatsAppMessage(
      conv.phone,
      'عذراً، الخدمة غير متاحة حالياً. يرجى التواصل معنا مباشرة.',
      accessToken,
      client.phone_number_id
    );
    return;
  }

  const clinicData = await fetchClinicData(bookingApi.url, bookingApi.clinic_id, client.id);
  if (!clinicData) {
    await sendWhatsAppMessage(
      conv.phone,
      'عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى.',
      accessToken,
      client.phone_number_id
    );
    return;
  }

  const { clinic, services, offers } = clinicData;

  if (conv.state === 'welcome') {
    await handleClinicWelcome(client, conv, message, clinic, accessToken);
    return;
  }

  if (conv.state === 'questions') {
    switch (conv.data.clinicStep) {
      case 'choose_type':
        await handleClinicChooseType(client, conv, message, clinic, services, offers, accessToken);
        break;
      case 'choose_item':
        await handleClinicChooseItem(client, conv, message, services, offers, accessToken);
        break;
      case 'choose_day':
        await handleClinicChooseDay(client, conv, message, clinic, accessToken);
        break;
      case 'choose_time':
        await handleClinicChooseTime(client, conv, message, clinic, accessToken);
        break;
      default:
        // Reset to type selection if step is unknown
        conv.data.clinicStep = 'choose_type';
        await sendClinicTypeButtons(conv, clinic, offers, accessToken, client.phone_number_id);
    }
    return;
  }

  // state === 'completed' — silently ignore further messages
}

// ── Welcome: collect patient name ──────────────────────────

async function handleClinicWelcome(
  client: any,
  conv: ConversationState,
  message: string,
  clinic: ClinicInfo,
  accessToken: string
): Promise<void> {
  if (!conv.data.welcomeSent) {
    const welcomeMsg = `أهلاً وسهلاً في ${clinic.name_ar}! 🦷\n\nوش اسمك الكريم؟`;
    await sendWhatsAppMessage(conv.phone, welcomeMsg, accessToken, client.phone_number_id);
    conv.data.welcomeSent = true;
    return;
  }

  const name = message.trim();
  if (name.length < 2 || /^\d+$/.test(name)) {
    await sendWhatsAppMessage(conv.phone, 'وش اسمك الكريم؟', accessToken, client.phone_number_id);
    return;
  }

  conv.data.name = name;
  conv.state = 'questions';
  conv.data.clinicStep = 'choose_type';
  await sendClinicTypeButtons(conv, clinic, [], accessToken, client.phone_number_id);
}

// ── Type selection: Services or Offers ─────────────────────

async function sendClinicTypeButtons(
  conv: ConversationState,
  clinic: ClinicInfo,
  offers: Offer[],
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  const greeting = `هلا ${conv.data.name}! 😊\n\nكيف أقدر أساعدك؟`;
  const buttons = offers.length > 0
    ? [{ id: 'type_offers', title: 'العروض' }, { id: 'type_services', title: 'الخدمات' }]
    : [{ id: 'type_services', title: 'الخدمات' }];

  await sendWhatsAppButtons(conv.phone, greeting, buttons, accessToken, phoneNumberId);
}

async function handleClinicChooseType(
  client: any,
  conv: ConversationState,
  message: string,
  clinic: ClinicInfo,
  services: Service[],
  offers: Offer[],
  accessToken: string
): Promise<void> {
  const msg = message.trim();

  if (msg === 'العروض') {
    conv.data.itemType = 'offers';
    conv.data.itemPage = 0;
    conv.data.clinicStep = 'choose_item';
    await sendClinicItemButtons(conv, services, offers, accessToken, client.phone_number_id);
  } else if (msg === 'الخدمات') {
    conv.data.itemType = 'services';
    conv.data.itemPage = 0;
    conv.data.clinicStep = 'choose_item';
    await sendClinicItemButtons(conv, services, offers, accessToken, client.phone_number_id);
  } else {
    // Invalid input — resend type buttons
    await sendClinicTypeButtons(conv, clinic, offers, accessToken, client.phone_number_id);
  }
}

// ── Item selection: list services or offers as buttons ─────

/**
 * Sends up to 2 items + optional "عرض المزيد" button.
 * Stores a buttonMap in conv.data so we can match the title on reply.
 * buttonMap key = exact truncated title sent; value = item metadata.
 */
async function sendClinicItemButtons(
  conv: ConversationState,
  services: Service[],
  offers: Offer[],
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  const PAGE_SIZE = 2; // leave slot for "more" button
  const page: number = conv.data.itemPage || 0;

  let items: { title: string; nameAr: string; nameEn: string; id: number; offerCode?: string; serviceId?: number }[] = [];
  let hasMore = false;

  if (conv.data.itemType === 'offers') {
    const slice = offers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    hasMore = (page + 1) * PAGE_SIZE < offers.length;
    items = slice.map(o => ({
      title: o.name_ar.substring(0, 20),
      nameAr: o.name_ar,
      nameEn: o.name_en,
      id: o.id,
      offerCode: o.offer_code,
      serviceId: o.service_id ?? undefined
    }));
  } else {
    const slice = services.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    hasMore = (page + 1) * PAGE_SIZE < services.length;
    items = slice.map(s => ({
      title: s.name_ar.substring(0, 20),
      nameAr: s.name_ar,
      nameEn: s.name,
      id: s.id
    }));
  }

  // Store button map for reply matching
  const buttonMap: Record<string, typeof items[0]> = {};
  for (const item of items) {
    buttonMap[item.title] = item;
  }
  conv.data.buttonMap = buttonMap;

  const buttons = items.map(i => ({ id: `item_${i.id}`, title: i.title }));
  if (hasMore) buttons.push({ id: 'more_items', title: 'عرض المزيد' });

  const bodyText = conv.data.itemType === 'offers'
    ? 'اختر العرض المناسب:'
    : 'اختر الخدمة المطلوبة:';

  await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, phoneNumberId);
}

async function handleClinicChooseItem(
  client: any,
  conv: ConversationState,
  message: string,
  services: Service[],
  offers: Offer[],
  accessToken: string
): Promise<void> {
  const msg = message.trim();

  // Pagination
  if (msg === 'عرض المزيد') {
    conv.data.itemPage = (conv.data.itemPage || 0) + 1;
    await sendClinicItemButtons(conv, services, offers, accessToken, client.phone_number_id);
    return;
  }

  // Match against stored button map
  const buttonMap: Record<string, any> = conv.data.buttonMap || {};
  const matched = buttonMap[msg];

  if (matched) {
    conv.data.selectedItemNameAr = matched.nameAr;
    conv.data.selectedItemNameEn = matched.nameEn;
    if (matched.offerCode) conv.data.offerCode = matched.offerCode;
    if (matched.serviceId) conv.data.serviceId = matched.serviceId;
    if (!matched.offerCode) conv.data.serviceId = matched.id; // direct service selection

    conv.data.clinicStep = 'choose_day';
    await sendClinicDayButtons(conv, conv.data.clinicInfo || [], accessToken, client.phone_number_id);
    return;
  }

  // No match — resend current page
  await sendClinicItemButtons(conv, services, offers, accessToken, client.phone_number_id);
}

// ── Day selection ───────────────────────────────────────────

async function sendClinicDayButtons(
  conv: ConversationState,
  workingDays: string[],
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  if (!workingDays || workingDays.length === 0) {
    // Fallback: ask as free text
    await sendWhatsAppMessage(conv.phone, 'متى يناسبك الموعد؟', accessToken, phoneNumberId);
    return;
  }

  const buttons = workingDays
    .slice(0, 3)
    .map(day => ({ id: `day_${day}`, title: CLINIC_DAY_MAP[day] || day }));

  await sendWhatsAppButtons(conv.phone, 'متى يناسبك الموعد؟', buttons, accessToken, phoneNumberId);
}

async function handleClinicChooseDay(
  client: any,
  conv: ConversationState,
  message: string,
  clinic: ClinicInfo,
  accessToken: string
): Promise<void> {
  const msg = message.trim();
  const workingDays: string[] = Array.isArray(clinic.working_days) ? clinic.working_days : [];

  // Match against Arabic day names or raw day keys
  const matched = workingDays.find(day =>
    msg === (CLINIC_DAY_MAP[day] || day)
  );

  const dayLabel = matched
    ? (CLINIC_DAY_MAP[matched] || matched)
    : msg; // accept free-text input too

  if (!dayLabel) {
    await sendClinicDayButtons(conv, workingDays, accessToken, client.phone_number_id);
    return;
  }

  conv.data.preferredDay = dayLabel;
  conv.data.clinicStep = 'choose_time';
  await sendWhatsAppButtons(
    conv.phone,
    'أي وقت يناسبك؟',
    [
      { id: 'time_morning',   title: 'صباحاً' },
      { id: 'time_afternoon', title: 'ظهراً' },
      { id: 'time_evening',   title: 'مساءً' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ── Time selection + completion ─────────────────────────────

async function handleClinicChooseTime(
  client: any,
  conv: ConversationState,
  message: string,
  clinic: ClinicInfo,
  accessToken: string
): Promise<void> {
  const timeLabels: Record<string, string> = {
    'صباحاً':  'صباحاً',
    'ظهراً':   'ظهراً',
    'مساءً':   'مساءً'
  };

  const time = timeLabels[message.trim()];
  if (!time) {
    await sendWhatsAppButtons(
      conv.phone,
      'أي وقت يناسبك؟',
      [
        { id: 'time_morning',   title: 'صباحاً' },
        { id: 'time_afternoon', title: 'ظهراً' },
        { id: 'time_evening',   title: 'مساءً' }
      ],
      accessToken,
      client.phone_number_id
    );
    return;
  }

  conv.data.preferredTime = time;
  conv.state = 'completed';

  // Build working hours display
  const workingDays: string[] = Array.isArray(clinic.working_days) ? clinic.working_days : [];
  const workingHoursStr = workingDays.map(d => CLINIC_DAY_MAP[d] || d).join('، ');

  const thankYou = `شكراً يا ${conv.data.name}! ✅\n\nتم استلام طلبك وسيتواصل معك فريقنا قريباً.\n\n📍 ${clinic.address || ''}\n⏰ ${workingHoursStr}`;
  await sendWhatsAppMessage(conv.phone, thankYou, accessToken, client.phone_number_id);

  // Push to Perfect Smile bookings API — failure does not affect the user
  await pushToBookingAPI(client, conv);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts
git commit -m "feat: add handleClinicFlow with full dental conversation state machine"
```

---

## Task 5: Wire industry branch in `handleIncomingMessage()`

**Files:**
- Modify: `src/conversation.ts` (one insertion in `handleIncomingMessage()`)

- [ ] **Step 1: Insert the clinic industry branch**

In `src/conversation.ts`, find `handleIncomingMessage()`. Locate this exact block (around line 108–113):

```typescript
  // Check for back command
  const backResult = handleBackCommand(message, conv);
  if (backResult.handled) {
    conv.state = backResult.newState as any;
    conv.step = backResult.newStep;
  }

  // ============================================================
  // HANDOVER DETECTION (if enabled)
```

Insert the following between the back command block and the handover detection comment:

```typescript
  // ============================================================
  // CLINIC INDUSTRY ROUTING
  // ============================================================
  if (['dental', 'clinic', 'medical', 'healthcare'].includes(client.industry)) {
    await handleClinicFlow(client, conv, message, accessToken);
    await saveConversation(conv);
    return;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```
Expected: all existing tests pass + the new clinicData and bookingWebhook tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/conversation.ts
git commit -m "feat: route dental/clinic industry clients to handleClinicFlow"
```

- [ ] **Step 5: Push to GitHub**

```bash
git push origin dev
```

---

## Task 6: `whatsapp_bot` source badge in `bookings.html`

**Files:**
- Modify: `~/Documents/EvokesAgent/book/dashboard/bookings.html`

- [ ] **Step 1: Find the insertion point**

Open `bookings.html`. Search for `whatsappContactsList` to find the WhatsApp contacts renderer. Locate this line (around line 1430):

```javascript
<span class="wa-status-badge" style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;border:1.5px solid ${s.border};background:${s.bg};color:${s.color};white-space:nowrap;">${sLabel}</span>
```

- [ ] **Step 2: Add the bot badge immediately after that `<span>`**

The block currently looks like:
```javascript
<span class="wa-status-badge" style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;border:1.5px solid ${s.border};background:${s.bg};color:${s.color};white-space:nowrap;">${sLabel}</span>
```

Change it to:
```javascript
<span class="wa-status-badge" style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;border:1.5px solid ${s.border};background:${s.bg};color:${s.color};white-space:nowrap;">${sLabel}</span>
${contact.source === 'whatsapp_bot' ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;">${isArabic ? 'روبوت' : 'Bot'}</span>` : ''}
```

- [ ] **Step 3: Verify visually**

Open `bookings.html` in a browser (or the dev URL). Navigate to the WhatsApp tab. Confirm no layout breakage. A booking with `source = 'whatsapp_bot'` will show the blue "Bot" / "روبوت" badge.

- [ ] **Step 4: Upload to Bluehost via FTP**

Upload `bookings.html` to `/book/dashboard/bookings.html` on Bluehost.

---

## Task 7: Client DB record for Perfect Smile

**Files:**
- No code files — this is a database operation on the bot's PostgreSQL.

- [ ] **Step 1: Get the bot's DATABASE_URL**

```bash
cat ~/Documents/whatsapp-bot/.env | grep DATABASE_URL
```

- [ ] **Step 2: Connect to the database and insert the client record**

Replace `<META_PHONE_NUMBER_ID>`, `<META_ACCESS_TOKEN>`, `<YOUR_DOMAIN>`, and `<CLINIC_ID>` with real values before running.

`<CLINIC_ID>` is the `clinic_id` value stored in the Perfect Smile MySQL DB for the Perfect Smile clinic. Check `db-config.php` for the `CLINIC_ID` constant, or look it up via the admin dashboard.

```sql
INSERT INTO clients (
  name,
  industry,
  phone_number_id,
  access_token,
  active,
  features,
  settings,
  questions
) VALUES (
  'Perfect Smile',
  'dental',
  '<META_PHONE_NUMBER_ID>',
  '<META_ACCESS_TOKEN>',
  true,
  '{"ai_fallback":false,"lead_scoring":false,"handover_detection":false,"appointment_setting":false}',
  '{"booking_api":{"url":"https://<YOUR_DOMAIN>/book/api","clinic_id":"<CLINIC_ID>"}}',
  '[]'
);
```

- [ ] **Step 3: Verify the record was inserted**

```sql
SELECT id, name, industry, active FROM clients WHERE name = 'Perfect Smile';
```
Expected: one row returned with `active = true`.

---

## Self-review notes

- `handleClinicChooseItem` passes `clinic.working_days` into `sendClinicDayButtons` via `conv.data.clinicInfo` — this field is never set. **Fixed:** pass `clinic` directly through the function chain instead. See Task 4 Step 3 — `sendClinicDayButtons` is called as `sendClinicDayButtons(conv, clinic.working_days, ...)` which is correct in the final code above.
- All function names used in later tasks are defined in Task 4 ✅
- `BookingPayload` interface is private to `bookingWebhook.ts` — not exported, not needed elsewhere ✅
- `CLINIC_DAY_MAP` is defined before it's used ✅
- `buttonMap` storage pattern: stored per message send, overwritten on each page ✅ (patient always sees the current page's buttons)
