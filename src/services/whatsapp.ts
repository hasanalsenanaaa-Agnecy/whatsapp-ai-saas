import { config } from '../config.js';
import type { SendMessageResponse, ApiError } from '../types.js';

// ============================================================
// WHATSAPP MESSAGE SERVICE
// ============================================================

const WHATSAPP_API_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

interface SendMessageOptions {
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Send a WhatsApp text message
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string,
  options: SendMessageOptions = {}
): Promise<boolean> {
  const { maxRetries = 2, retryDelay = 1000 } = options;
  
  // Validate inputs
  if (!to || !message) {
    console.error('❌ Invalid parameters: to and message are required');
    return false;
  }

  // Validate config
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    console.error('❌ WhatsApp API not configured');
    return false;
  }

  // Truncate message if too long (WhatsApp limit is 4096 characters)
  const truncatedMessage = message.length > 4000 
    ? message.substring(0, 3997) + '...' 
    : message;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(WHATSAPP_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.whatsapp.accessToken}`,
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
        const errorData = data as ApiError;
        const errorMessage = errorData.error?.message || 'Unknown error';
        const errorCode = errorData.error?.code || response.status;
        
        // Don't retry on certain errors
        if (errorCode === 131030) { // Invalid phone number
          console.error(`❌ Invalid phone number: ${to}`);
          return false;
        }
        
        if (errorCode === 131051) { // Recipient not on WhatsApp
          console.error(`❌ Recipient not on WhatsApp: ${to}`);
          return false;
        }

        throw new Error(`WhatsApp API Error (${errorCode}): ${errorMessage}`);
      }

      const successData = data as SendMessageResponse;
      console.log(`✅ Message sent to ${to} | ID: ${successData.messages?.[0]?.id}`);
      return true;

    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        console.warn(`⚠️ Retry ${attempt + 1}/${maxRetries} for ${to}: ${lastError.message}`);
        await sleep(retryDelay * (attempt + 1)); // Exponential backoff
      }
    }
  }

  console.error(`❌ Failed to send message to ${to} after ${maxRetries + 1} attempts:`, lastError?.message);
  return false;
}

/**
 * Send a WhatsApp template message (for initiating conversations)
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string = 'en'
): Promise<boolean> {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    console.error('❌ WhatsApp API not configured');
    return false;
  }

  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Template message error:', data);
      return false;
    }

    console.log(`✅ Template "${templateName}" sent to ${to}`);
    return true;

  } catch (error) {
    console.error('❌ Template message failed:', error);
    return false;
  }
}

/**
 * Mark a message as read
 */
export async function markMessageAsRead(messageId: string): Promise<boolean> {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    return false;
  }

  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.whatsapp.accessToken}`,
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

// Helper function
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
