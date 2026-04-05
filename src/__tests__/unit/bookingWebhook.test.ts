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
