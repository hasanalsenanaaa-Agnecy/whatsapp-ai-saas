# WhatsApp AI SaaS – Go-Live & Client Onboarding Checklist

## Is the code production-ready?

- Core backend, webhook, and portal are stable and tested.
- Health checks, error handling, and rate limits are in place.
- AI cost controls and context trimming are implemented.
- Multi-client support is live.
- No critical errors in logs; server starts and responds as expected.

---

## How to onboard a new client

### 1. Client WhatsApp Business Info

- Ask your client for:
  - Their WhatsApp Business phone number.
  - [Meta Business Manager access](https://business.facebook.com/) (invite you as developer if needed).
- Instruct them (or do it for them):
  - Go to [Meta for Developers – WhatsApp](https://developers.facebook.com/docs/whatsapp/overview/).
  - Create an App and generate a WhatsApp API access token.
  - (Optional) Set an App Secret for webhook signature verification.

### 2. Client Data for DB

- Collect from client:
  - Business name, industry, agent phone numbers, FAQs, and any qualifying questions.
- Add to your system:
  - Use your admin UI, CLI, or direct SQL insert to add a new row to the `clients` table with their info.
  - Example SQL (replace values as needed):
    ```sql
    INSERT INTO clients (id, name, industry, phone_number_id, access_token, agent_phones, knowledge_base, questions, verify_token)
    VALUES ('client_123', 'Client Name', 'real-estate', '1234567890', 'ACCESS_TOKEN', ARRAY['9665xxxxxxx'], '[{"question":"...","answer":"..."}]', '[{"text":"...","options":["..."]}]', 'your-verify-token');
    ```
- You can manage your database directly in [Neon Console](https://console.neon.tech/).

### 3. Webhook Setup

- If you deploy on [Render](https://render.com/), your server is already public. Use your Render HTTPS URL.
- Instruct client (or do it yourself):
  - Go to [Meta for Developers – WhatsApp Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples/).
  - Set the webhook URL to: `https://<your-render-domain>/webhook/whatsapp`
  - Set the verify token to match your `.env` (`WHATSAPP_VERIFY_TOKEN`).
  - (If using) Set the App Secret to match your `.env` (`WHATSAPP_APP_SECRET`).
- **ngrok is only needed if you want to test webhooks from Meta on your local machine.**
  - If you are using Render, you do NOT need ngrok.
  - Use ngrok only for local development/testing when your server is not public.

### 4. Environment Variables

- Add the client’s WhatsApp info to your [Render environment variables](https://render.com/docs/environment-variables):
  - `WHATSAPP_PHONE_NUMBER_ID=<client's phone_number_id>`
  - `WHATSAPP_ACCESS_TOKEN=<client's access token>`
  - `WHATSAPP_VERIFY_TOKEN=<your verify token>`
  - `WHATSAPP_APP_SECRET=<your app secret>` (if used)
  - `DATABASE_URL`, `ENCRYPTION_KEY`, etc.
- After updating, redeploy your service on Render.

### 5. Test

- Have the client send a WhatsApp message to their business number.
- Watch your Render logs for the incoming message.
- Confirm the message triggers the correct flow (welcome, qualifying, etc).

---

**Summary:**

- Code is ready for production use with new clients.
- You need client WhatsApp API credentials, webhook setup, and to add their info to your DB (Neon).
- Use your Render HTTPS URL for webhooks (no ngrok needed unless testing locally).
- Test with a real message before going live.
