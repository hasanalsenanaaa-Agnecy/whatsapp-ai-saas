import crypto from 'crypto';

/**
 * Verify WhatsApp webhook signature
 * WhatsApp signs payloads with HMAC-SHA256
 */
export function verifyWhatsAppWebhook(
  payload: string,
  signature: string,
  verifyToken: string
): boolean {
  try {
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', verifyToken)
      .update(payload)
      .digest('hex')}`;

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('❌ Webhook verification error:', error);
    return false;
  }
}

/**
 * Create a webhook signature (for testing)
 */
export function createWhatsAppSignature(
  payload: string,
  verifyToken: string
): string {
  return `sha256=${crypto
    .createHmac('sha256', verifyToken)
    .update(payload)
    .digest('hex')}`;
}

/**
 * Generic HMAC verification
 */
export function verifyHMACSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: string = 'sha256'
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac(algorithm, secret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('❌ HMAC verification error:', error);
    return false;
  }
}
