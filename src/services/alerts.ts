import axios from 'axios';

let lastAlertTime: number = 0;
let alertCount: number = 0;

export async function sendAlert(
  type: 'error' | 'warning' | 'info',
  message: string,
  details?: string
): Promise<boolean> {
  const ownerPhone = process.env.OWNER_PHONE;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!ownerPhone || !phoneNumberId || !accessToken) {
    console.log('Alert not sent - OWNER_PHONE not configured');
    return false;
  }
  
  const now = Date.now();
  const cooldownMs = 5 * 60 * 1000;
  
  if (now - lastAlertTime < cooldownMs) {
    console.log('Alert suppressed - cooldown active');
    alertCount++;
    return false;
  }
  
  const emoji = type === 'error' ? '[ERROR]' : type === 'warning' ? '[WARNING]' : '[INFO]';
  const timestamp = new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' });
  
  let alertText = emoji + ' WhatsApp Bot Alert\n\n';
  alertText += 'Type: ' + type.toUpperCase() + '\n';
  alertText += 'Time: ' + timestamp + '\n';
  alertText += 'Message: ' + message + '\n';
  
  if (details) {
    const truncated = details.length > 500 ? details.substring(0, 500) + '...' : details;
    alertText += '\nDetails:\n' + truncated;
  }
  
  if (alertCount > 0) {
    alertText += '\n\n' + alertCount + ' alerts suppressed since last notification';
  }
  
  try {
    await axios.post(
      'https://graph.facebook.com/v17.0/' + phoneNumberId + '/messages',
      {
        messaging_product: 'whatsapp',
        to: ownerPhone,
        type: 'text',
        text: { body: alertText }
      },
      {
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Alert sent to ' + ownerPhone);
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
  const details = error instanceof Error 
    ? error.name + ': ' + error.message 
    : String(error);
  
  await sendAlert('error', message, details);
}
