const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

interface ButtonOption { id: string; title: string; description?: string; }

export async function sendWhatsAppMessage(to: string, message: string, accessToken: string, phoneNumberId: string): Promise<boolean> {
  if (!to || !message || !accessToken || !phoneNumberId) {
    console.error('❌ Missing params');
    return false;
  }

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: message }
      })
    });

    if (!response.ok) {
      console.error('❌ WhatsApp error:', await response.text());
      return false;
    }
    console.log(`✅ Message sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Send failed:', error);
    return false;
  }
}

export async function sendWhatsAppButtons(to: string, bodyText: string, buttons: ButtonOption[], accessToken: string, phoneNumberId: string): Promise<boolean> {
  if (!to || !bodyText || !buttons?.length || !accessToken || !phoneNumberId) return false;

  const limitedButtons = buttons.slice(0, 3);

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: limitedButtons.map(btn => ({
              type: 'reply',
              reply: { id: btn.id, title: btn.title.substring(0, 20) }
            }))
          }
        }
      })
    });

    if (!response.ok) {
      console.error('❌ Buttons error:', await response.text());
      return sendWhatsAppMessage(to, bodyText, accessToken, phoneNumberId);
    }
    console.log(`✅ Buttons sent to ${to}`);
    return true;
  } catch (error) {
    return sendWhatsAppMessage(to, bodyText, accessToken, phoneNumberId);
  }
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption: string, accessToken: string, phoneNumberId: string): Promise<boolean> {
  if (!to || !imageUrl || !accessToken || !phoneNumberId) return false;

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: { link: imageUrl, caption: caption || '' }
      })
    });

    if (!response.ok) {
      console.error('❌ Image error:', await response.text());
      // Fallback to text with link
      return sendWhatsAppMessage(to, `${caption}\n\n🖼️ ${imageUrl}`, accessToken, phoneNumberId);
    }
    console.log(`✅ Image sent to ${to}`);
    return true;
  } catch (error) {
    return sendWhatsAppMessage(to, `${caption}\n\n🖼️ ${imageUrl}`, accessToken, phoneNumberId);
  }
}

export async function sendWhatsAppButtonsWithImage(to: string, imageUrl: string, bodyText: string, buttons: ButtonOption[], accessToken: string, phoneNumberId: string): Promise<boolean> {
  if (!to || !bodyText || !buttons?.length || !accessToken || !phoneNumberId) return false;

  const limitedButtons = buttons.slice(0, 3);

  try {
    const interactive: Record<string, any> = {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: limitedButtons.map(btn => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.substring(0, 20) }
        }))
      }
    };

    if (imageUrl) {
      interactive.header = { type: 'image', image: { link: imageUrl } };
    }

    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive
      })
    });

    if (!response.ok) {
      console.error('❌ Buttons+image error:', await response.text());
      return sendWhatsAppButtons(to, bodyText, buttons, accessToken, phoneNumberId);
    }
    console.log(`✅ Buttons+image sent to ${to}`);
    return true;
  } catch (error) {
    return sendWhatsAppButtons(to, bodyText, buttons, accessToken, phoneNumberId);
  }
}

export async function sendWhatsAppList(to: string, bodyText: string, buttonText: string, options: ButtonOption[], accessToken: string, phoneNumberId: string): Promise<boolean> {
  if (!to || !bodyText || !options?.length || !accessToken || !phoneNumberId) return false;

  const limitedOptions = options.slice(0, 10);

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: buttonText.substring(0, 20),
            sections: [{ title: 'الخيارات', rows: limitedOptions.map(opt => {
                  const row: Record<string, string> = { id: opt.id, title: opt.title.substring(0, 24) };
                  if (opt.description) row.description = opt.description.substring(0, 72);
                  return row;
                }) }]
          }
        }
      })
    });

    if (!response.ok) {
      const numberedText = bodyText + '\n\n' + options.map((opt, i) => `${i + 1}️⃣ ${opt.title}`).join('\n');
      return sendWhatsAppMessage(to, numberedText, accessToken, phoneNumberId);
    }
    console.log(`✅ List sent to ${to}`);
    return true;
  } catch (error) {
    const numberedText = bodyText + '\n\n' + options.map((opt, i) => `${i + 1}️⃣ ${opt.title}`).join('\n');
    return sendWhatsAppMessage(to, numberedText, accessToken, phoneNumberId);
  }
}
