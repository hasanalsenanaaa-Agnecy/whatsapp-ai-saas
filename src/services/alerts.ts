import { maskPhone } from '../utils/buttons.js';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

let lastAlertTime = 0;
let alertCount = 0;

export async function sendAlert(
  type: 'error' | 'warning' | 'info',
  message: string,
  details?: string
): Promise<boolean> {
  const ownerPhone = process.env.OWNER_PHONE;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!ownerPhone || !phoneNumberId || !accessToken) {
    console.log('Alert not sent — OWNER_PHONE not configured');
    return false;
  }

  const now = Date.now();
  if (now - lastAlertTime < 5 * 60 * 1000) {
    alertCount++;
    console.log('Alert suppressed — cooldown active');
    return false;
  }

  const emoji = type === 'error' ? '[ERROR]' : type === 'warning' ? '[WARNING]' : '[INFO]';
  const timestamp = new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' });

  let body = `${emoji} WhatsApp Bot Alert\n\nType: ${type.toUpperCase()}\nTime: ${timestamp}\nMessage: ${message}`;
  if (details) body += `\n\nDetails:\n${details.substring(0, 500)}`;
  if (alertCount > 0) body += `\n\n${alertCount} alerts suppressed since last notification`;

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: ownerPhone,
        type: 'text',
        text: { body }
      })
    });

    if (!response.ok) {
      console.error('Alert send failed:', await response.text());
      return false;
    }

    console.log(`Alert sent to ${maskPhone(ownerPhone)}`);
    lastAlertTime = now;
    alertCount = 0;
    return true;
  } catch (error) {
    console.error('Failed to send alert:', error);
    return false;
  }
}

export async function alertError(error: Error | string, context?: string): Promise<void> {
  const message = context || 'An error occurred';
  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await sendAlert('error', message, details);
}
