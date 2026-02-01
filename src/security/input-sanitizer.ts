/**
 * Input sanitization utilities
 */

export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>\"']/g, '') // Remove dangerous characters
    .substring(0, 1000); // Max 1000 chars
}

export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid email');
  }

  const sanitized = email.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(sanitized)) {
    throw new Error('Invalid email format');
  }

  return sanitized;
}

export function sanitizePhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Invalid phone');
  }

  const sanitized = phone.replace(/\D/g, '');

  if (sanitized.length < 10) {
    throw new Error('Phone number too short');
  }

  return '+' + sanitized.slice(-12);
}
