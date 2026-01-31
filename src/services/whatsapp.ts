// ============================================================
// WHATSAPP SERVICE (Multi-tenant)
// ============================================================

interface SendMessageOptions {
  maxRetries?: number;
  retryDelay?: number;
}

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  accessToken: string,
  phoneNumberId: string,
  options: SendMessageOptions = {}
): Promise<boolean> {
  const { maxRetries = 2, retryDelay = 1000 } = options;
  
  if (!to || !message || !accessToken || !phoneNumberId) {
    console.error('❌ Missing required parameters for WhatsApp message');
    return false;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  // Truncate if too long
  const truncatedMessage = message.length > 4000 
    ? message.substring(0, 3997) + '...' 
    : message;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: { 
            preview_url: false,
            body: truncatedMessage 
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const errorCode = data.error?.code || response.status;
        
        // Don't retry certain errors
        if (errorCode === 131030 || errorCode === 131051) {
          console.error(`❌ WhatsApp error ${errorCode}: ${data.error?.message}`);
          return false;
        }

        throw new Error(`WhatsApp API Error (${errorCode}): ${data.error?.message}`);
      }

      console.log(`✅ Message sent to ${to}`);
      return true;

    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        console.warn(`⚠️ Retry ${attempt + 1}/${maxRetries}: ${lastError.message}`);
        await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
      }
    }
  }

  console.error(`❌ Failed to send to ${to}: ${lastError?.message}`);
  return false;
}

export async function markMessageAsRead(
  messageId: string,
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      })
    });

    return response.ok;
  } catch {
    return false;
  }
}
