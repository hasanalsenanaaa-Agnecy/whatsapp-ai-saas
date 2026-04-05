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
