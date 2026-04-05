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

  it('returns null when offers endpoint fails', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => mockAllData })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await fetchClinicData('https://api.example.com', '1', 'client-1');
    expect(result).toBeNull();
  });

  it('clearClinicCache forces a fresh fetch on next call', async () => {
    (fetch as any)
      .mockResolvedValue({ ok: true, json: async () => mockAllData });

    // Seed cache
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => mockAllData })
      .mockResolvedValueOnce({ ok: true, json: async () => mockOffersData });
    await fetchClinicData('https://api.example.com', '1', 'client-1');

    clearClinicCache('client-1');

    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => mockAllData })
      .mockResolvedValueOnce({ ok: true, json: async () => mockOffersData });
    await fetchClinicData('https://api.example.com', '1', 'client-1');

    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
