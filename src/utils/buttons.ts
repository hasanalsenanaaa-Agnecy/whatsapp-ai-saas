// ============================================================
// BUTTON TEXT UTILITIES
// WhatsApp interactive buttons: max 20 chars for title
// WhatsApp list items: max 24 chars for title
// ============================================================

/** Truncate text to max length with ellipsis */
export function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max - 1) + '…' : text;
}

/**
 * Smart title compression for product names.
 * Prioritizes weight/size, qualifiers, and variety names
 * so they survive WhatsApp's character limits.
 * e.g. "Jumbo Premium Royal Khalas Dates, 2kg" → "2kg Jumbo Khalas"
 */
export function smartTitle(title: string, max: number): string {
  // Extract weight (e.g. 2kg, 1kg, 900g, 2 kg)
  const weightMatch = title.match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
  const weight = weightMatch ? weightMatch[0].replace(/\s+/g, '').toLowerCase() : null;

  // Key qualifiers (ordered by importance)
  const qualifiers = ['Jumbo', 'Premium'];
  const foundQualifier = qualifiers.find(q => title.toLowerCase().includes(q.toLowerCase()));

  // Date variety names
  const varieties = ['Khalas', 'Sagai', 'Sukkari', 'Ajwa', 'Medjool', 'Mabroom', 'Safawi'];
  const foundVariety = varieties.find(v => title.toLowerCase().includes(v.toLowerCase()));

  // Special extra descriptor after variety (e.g. "Ajwa Al-Madinah")
  let extra = '';
  if (foundVariety) {
    const afterVariety = title.substring(title.toLowerCase().indexOf(foundVariety.toLowerCase()) + foundVariety.length);
    const extraMatch = afterVariety.match(/^[\s-]+(Al-\w+|\w+)/i);
    if (extraMatch && extraMatch[1] && !['Dates', 'Date'].includes(extraMatch[1])) {
      extra = ' ' + extraMatch[1];
    }
  }

  if (!weight && !foundQualifier && !foundVariety) {
    return truncate(title, max);
  }

  // Build compact title: weight first, then qualifier, then variety
  const parts: string[] = [];
  if (weight) parts.push(weight);
  if (foundQualifier) parts.push(foundQualifier);
  if (foundVariety) parts.push(foundVariety + extra);
  const compact = parts.join(' ');
  return truncate(compact, max);
}

/** Mask a phone number for logging — keeps prefix + last 3, hides the rest */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return '***';
  return phone.slice(0, 4) + '*'.repeat(phone.length - 7) + phone.slice(-3);
}

/** Convert Arabic/Eastern Arabic numerals to Western digits */
export function normalizeArabicNumbers(text: string): string {
  const map: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  return text.split('').map(c => map[c] || c).join('');
}
