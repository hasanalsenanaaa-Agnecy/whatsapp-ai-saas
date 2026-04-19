// src/services/bookingWebhook.ts
import { maskPhone } from '../utils/buttons.js';
import type { ClientConfig } from '../types/client.js';

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

export async function pushToBookingAPI(client: ClientConfig, conv: any): Promise<boolean> {
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

    console.log(`✅ Booking created for ${maskPhone(conv.phone)}`);
    return true;
  } catch (error) {
    console.error('❌ Booking webhook error:', error);
    return false;
  }
}
