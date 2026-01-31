# Client Activation Checklist

## Before Activation

### Get From Client:
- [ ] Business name
- [ ] Agent phone number (for notifications)
- [ ] Property types they sell
- [ ] Cities they serve
- [ ] Budget ranges
- [ ] Bedroom options
- [ ] WhatsApp Phone Number ID
- [ ] WhatsApp Access Token

### Your Setup:
- [ ] Create Google Sheet for their leads
- [ ] Share Sheet with your service account
- [ ] Copy Sheet ID

---

## Activation Steps

### 1. Update Render Environment Variables
```
AGENCY_NAME=Client Business Name
AGENT_PHONE_NUMBER=966501234567
PROPERTY_TYPES=Villa,Apartment,Land,Commercial
CITIES=Dammam,Khobar,Dhahran,Jubail
BUDGETS=Under 300K,300K-600K,600K-1M,Above 1M
BEDROOMS=1-2,3-4,5-6,7+
WHATSAPP_PHONE_NUMBER_ID=their_phone_id
WHATSAPP_ACCESS_TOKEN=their_access_token
GOOGLE_SHEET_ID=their_sheet_id
```

### 2. Redeploy on Render
- Go to Render → Manual Deploy → Deploy latest commit

### 3. Verify Webhook
- Meta Developer Console → WhatsApp → Configuration
- Callback URL: `https://your-app.onrender.com/webhook/whatsapp/client1`
- Verify Token: (same as WHATSAPP_VERIFY_TOKEN)
- Subscribe to: messages

### 4. Test
- Send "hi" to client's WhatsApp number
- Complete full flow
- Check Google Sheet for lead
- Check agent received notification

### 5. Clear Test Data
```sql
DELETE FROM user_states WHERE phone = 'YOUR_TEST_PHONE';
DELETE FROM leads WHERE phone = 'YOUR_TEST_PHONE';
```

### 6. Go Live
- Confirm with client
- Monitor first real leads

---

## Client Handover

Send client:
- [ ] Dashboard link: `https://your-app.onrender.com/dashboard?key=THEIR_KEY`
- [ ] Google Sheet link
- [ ] Support WhatsApp number

---

## Monitoring

Check daily for first week:
- [ ] Leads coming in?
- [ ] Follow-ups sending?
- [ ] Agent receiving notifications?
- [ ] Any errors in Render logs?
