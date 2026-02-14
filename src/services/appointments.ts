import { sendWhatsAppMessage } from './whatsapp.js';

// ============================================================
// APPOINTMENT SERVICE
// Booking, date generation, reminders
// ============================================================

export interface TimeSlot {
  id: string;
  label: string;
  start?: string;
  end?: string;
}

export interface AppointmentSettings {
  timeSlots: TimeSlot[];
  daysAhead: number;
  workDays: number[];  // 0 = Sunday, 6 = Saturday
  reminderMinutesBefore: number;
}

export interface AppointmentData {
  clientId: string;
  leadId?: number;
  phone: string;
  name: string;
  date: string;  // YYYY-MM-DD
  timeSlot: string;
  timeLabel: string;
  appointmentType?: string;
  notes?: string;
}

// Default appointment settings (Saudi work week)
export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  timeSlots: [
    { id: 'morning', label: 'الصباح 9-12' },
    { id: 'afternoon', label: 'الظهر 12-3' },
    { id: 'evening', label: 'العصر 3-6' }
  ],
  daysAhead: 3,
  workDays: [0, 1, 2, 3, 4],  // Sunday to Thursday
  reminderMinutesBefore: 60
};

// Arabic day names
const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/**
 * Get available appointment dates based on settings
 */
export function getAvailableDates(settings: AppointmentSettings = DEFAULT_APPOINTMENT_SETTINGS): { id: string; label: string; date: string }[] {
  const dates: { id: string; label: string; date: string }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get timezone offset for Saudi Arabia (UTC+3)
  const saudiOffset = 3 * 60 * 60 * 1000;
  
  let daysChecked = 0;
  let daysAdded = 0;

  while (daysAdded < settings.daysAhead && daysChecked < 14) {
    const checkDate = new Date(today.getTime() + (daysChecked * 24 * 60 * 60 * 1000));
    const dayOfWeek = checkDate.getDay();

    // Check if it's a work day
    if (settings.workDays.includes(dayOfWeek)) {
      const dateStr = checkDate.toISOString().split('T')[0];
      const dayName = ARABIC_DAYS[dayOfWeek];
      const dayNum = checkDate.getDate();
      const monthName = ARABIC_MONTHS[checkDate.getMonth()];

      let label: string;
      if (daysChecked === 0) {
        label = `اليوم - ${dayName} ${dayNum} ${monthName}`;
      } else if (daysChecked === 1) {
        label = `بكرة - ${dayName} ${dayNum} ${monthName}`;
      } else {
        label = `${dayName} ${dayNum} ${monthName}`;
      }

      dates.push({
        id: `date_${daysAdded}`,
        label,
        date: dateStr
      });
      daysAdded++;
    }
    daysChecked++;
  }

  return dates;
}

/**
 * Get time slots from settings
 */
export function getTimeSlots(settings: AppointmentSettings = DEFAULT_APPOINTMENT_SETTINGS): { id: string; label: string }[] {
  return settings.timeSlots.map((slot, index) => ({
    id: `time_${index}`,
    label: slot.label
  }));
}

/**
 * Format date in Arabic for display
 */
export function formatDateArabic(dateStr: string): string {
  const date = new Date(dateStr);
  const dayName = ARABIC_DAYS[date.getDay()];
  const dayNum = date.getDate();
  const monthName = ARABIC_MONTHS[date.getMonth()];
  return `${dayName} ${dayNum} ${monthName}`;
}

/**
 * Calculate reminder time
 */
export function calculateReminderTime(
  appointmentDate: string,
  timeSlot: string,
  settings: AppointmentSettings = DEFAULT_APPOINTMENT_SETTINGS
): Date {
  const date = new Date(appointmentDate);
  
  // Find the time slot to get start time
  const slot = settings.timeSlots.find(s => s.id === timeSlot || s.label === timeSlot);
  
  // Default start times based on slot id
  let startHour = 9;
  if (timeSlot.includes('afternoon') || timeSlot.includes('الظهر')) {
    startHour = 12;
  } else if (timeSlot.includes('evening') || timeSlot.includes('العصر')) {
    startHour = 15;
  }
  
  // If slot has explicit start time, parse it
  if (slot?.start) {
    const [hours] = slot.start.split(':').map(Number);
    startHour = hours;
  }
  
  // Set appointment time
  date.setHours(startHour, 0, 0, 0);
  
  // Subtract reminder minutes
  const reminderTime = new Date(date.getTime() - (settings.reminderMinutesBefore * 60 * 1000));
  
  return reminderTime;
}

/**
 * Format appointment confirmation message
 */
export function formatAppointmentConfirmation(
  name: string,
  dateStr: string,
  timeLabel: string
): string {
  const formattedDate = formatDateArabic(dateStr);
  return `تمام يا ${name}! ✅

تم حجز موعدك:
📅 ${formattedDate}
🕐 ${timeLabel}

بنرسل لك تذكير قبل الموعد.
شكراً لتواصلك! 🙏`;
}

/**
 * Format appointment notification for agent
 */
export function formatAppointmentNotification(
  name: string,
  phone: string,
  dateStr: string,
  timeLabel: string,
  leadData?: Record<string, any>
): string {
  const formattedDate = formatDateArabic(dateStr);
  
  let details = '';
  if (leadData) {
    const relevantKeys = Object.entries(leadData)
      .filter(([k]) => !['name', 'phone', 'whatsappPhone', 'nameAsked', 'leadId', 'appointment', 'appointmentDate', 'appointmentTime'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    if (relevantKeys) {
      details = `\n\nالتفاصيل:\n${relevantKeys}`;
    }
  }

  return `📅 موعد جديد!

الاسم: ${name}
الجوال: ${phone}
التاريخ: ${formattedDate}
الوقت: ${timeLabel}${details}

wa.me/${phone.replace('+', '')}`;
}

/**
 * Format reminder message
 */
export function formatReminderMessage(name: string, timeLabel: string): string {
  return `مرحبا ${name}! 👋

تذكير بموعدك اليوم ${timeLabel}.
نتطلع لخدمتك! ✨`;
}

/**
 * Send appointment reminder
 */
export async function sendAppointmentReminder(
  phone: string,
  name: string,
  timeLabel: string,
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  try {
    const message = formatReminderMessage(name, timeLabel);
    const sent = await sendWhatsAppMessage(phone, message, accessToken, phoneNumberId);
    return sent;
  } catch (error) {
    console.error('❌ Failed to send reminder:', error);
    return false;
  }
}

/**
 * Parse selected date from button/list response
 */
export function parseDateSelection(
  selection: string,
  availableDates: { id: string; label: string; date: string }[]
): { date: string; label: string } | null {
  // Try exact match on id
  const byId = availableDates.find(d => d.id === selection);
  if (byId) return { date: byId.date, label: byId.label };

  // Try match on label
  const byLabel = availableDates.find(d => d.label === selection);
  if (byLabel) return { date: byLabel.date, label: byLabel.label };

  // Try partial match
  const lowerSelection = selection.toLowerCase();
  const byPartial = availableDates.find(d => 
    d.label.includes(selection) || 
    lowerSelection.includes('اليوم') && d.label.includes('اليوم') ||
    lowerSelection.includes('بكرة') && d.label.includes('بكرة')
  );
  if (byPartial) return { date: byPartial.date, label: byPartial.label };

  return null;
}

/**
 * Parse selected time from button/list response
 */
export function parseTimeSelection(
  selection: string,
  availableSlots: { id: string; label: string }[]
): { id: string; label: string } | null {
  // Try exact match
  const byId = availableSlots.find(s => s.id === selection);
  if (byId) return byId;

  const byLabel = availableSlots.find(s => s.label === selection);
  if (byLabel) return byLabel;

  // Try partial match
  const lowerSelection = selection.toLowerCase();
  const byPartial = availableSlots.find(s =>
    s.label.includes(selection) ||
    lowerSelection.includes('صباح') && s.label.includes('صباح') ||
    lowerSelection.includes('ظهر') && s.label.includes('ظهر') ||
    lowerSelection.includes('عصر') && s.label.includes('عصر')
  );
  if (byPartial) return byPartial;

  return null;
}
