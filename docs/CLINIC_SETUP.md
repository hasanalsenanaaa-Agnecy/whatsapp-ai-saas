# Adding a New Clinic Client - Step-by-Step Guide

## Overview

Your system already has clinic message templates built in. Adding a clinic client is a straightforward 5-step process that takes about 30 minutes total.

---

## Step 1: Gather Client Information (5 min)

You need the following details from the clinic:

### Essential Info

- [ ] **Clinic Name** (in Arabic): e.g., عيادة الدكتور محمد
- [ ] **Clinic Name** (in English): e.g., Dr. Mohamed Clinic
- [ ] **WhatsApp Agent Phone** (Saudi format): e.g., 966501234567
- [ ] **Billing Plan**: SMB (500 SAR) or Enterprise (1,000 SAR)

### Optional Info

- [ ] **Business Hours** (for automated responses)
- [ ] **Departments** (Dentistry, Dermatology, etc.)
- [ ] **Specialties** (helps with qualification)
- [ ] **Preferred appointment timeframe** (mornings, evenings, weekends)

---

## Step 2: Set Up WhatsApp Business API (15 min)

The clinic needs to create a WhatsApp Business account. They can do this themselves or you can do it for them.

### For the Clinic (or you on their behalf):

1. **Create Meta Business Account** (if they don't have one)
   - Go to https://business.facebook.com
   - Click "Create Account"
   - Fill in business name, your name, email
   - Verify email

2. **Create Developer App**
   - Go to https://developers.facebook.com
   - Click "My Apps" → "Create App"
   - Select "Business" as app type
   - Enter app name (e.g., "Clinic WhatsApp Bot")
   - Select their Business Account
   - Click "Create App"

3. **Add WhatsApp to App**
   - In app dashboard, find "WhatsApp"
   - Click "Set Up"
   - Click "Start using the API"
   - Add phone number (must be different from regular WhatsApp phone)
   - Verify via SMS

4. **Generate Credentials**
   - Go to "WhatsApp" → "API Setup"
   - Copy **Phone Number ID**
   - Click "Generate Token" → Create token with "no expiry"
   - Copy **Access Token**
   - Note down **Verify Token** (we'll set this)

### Send Them This Template Email:

```
Hi [Clinic Name],

To connect your WhatsApp clinic bot, we need:

1. WhatsApp Phone Number ID: _______________
   (Find in: https://developers.facebook.com → Your App → WhatsApp → API Setup)

2. Access Token: _______________
   (Generate with no expiry, copy entire token)

3. Agent phone for notifications (Saudi format): 966XXXXXXXXX
   (Where you want to receive patient inquiries)

Once you send these, we'll have you live in 24 hours!
```

---

## Step 3: Add the Client to Your Database

Choose ONE of the two methods below:

### METHOD A: Using CLI (Easiest)

```bash
npm run client add
```

This will launch an interactive form:

```
┌────────────────────────────────┐
│      ADD NEW CLIENT            │
└────────────────────────────────┘

Business name (Arabic): عيادة الدكتور محمد
Business name (English, for ID): dr_mohamad_clinic
Industries: real_estate, clinic, car_dealership, generic
Industry: clinic
Phone Number ID: 1234567890123456
Access Token: [paste the long token]
Agent phone (966XXXXXXXXX): 966501234567
Use default questions for clinic? (yes/no): yes
```

**After entering info, you'll see:**

```
┌────────────────────────────────┐
│          REVIEW                │
└────────────────────────────────┘
ID:           client_dr_mohamad_clinic_abc123
Business:     عيادة الدكتور محمد
Industry:     clinic
Phone ID:     1234567890123456
Agent:        966501234567
Verify Token: verify_xyz789

Questions:
  1. وش نوع الخدمة؟ → [كشف عام, عيادة متخصصة, متابعة, استشارة]
  2. أي تخصص تبي؟ → [أسنان, جلدية, عيون, باطنية]
  3. هل عندك موعد سابق معنا؟ → [نعم, لا, أول مرة]
  4. كم فترة الانتظار المتاحة لك؟ → [بأقرب وقت, بعد أسبوع, بعد شهر]

✅ Save client? (yes/no): yes
```

### METHOD B: Direct SQL (If CLI fails)

Connect to Neon Console (https://console.neon.tech/) and run:

```sql
INSERT INTO clients (
  id,
  name,
  industry,
  phone_number_id,
  access_token,
  verify_token,
  agent_phones,
  features,
  settings,
  active,
  created_at
) VALUES (
  'client_clinic_dr_mohamad',
  'عيادة الدكتور محمد',
  'clinic',
  '1234567890123456',
  'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'verify_randomtoken123',
  ARRAY['966501234567'],
  '{"ai_fallback": false, "lead_scoring": false, "handover_detection": false, "appointment_setting": true}'::jsonb,
  '{
    "welcome_message": "أهلاً بك في عيادة الدكتور محمد 👋",
    "thank_you_message": "شكراً لك! تم استلام طلبك ✅"
  }'::jsonb,
  true,
  NOW()
);
```

**After either method**, you'll get:

```
✅ Client added successfully!

ID: client_dr_mohamad_clinic_abc123

Next steps:
1. Update Meta webhook:
   URL: https://your-render-url.onrender.com/webhook/whatsapp
   Verify Token: verify_xyz789

2. Set these as environment variables:
   WHATSAPP_PHONE_NUMBER_ID=1234567890123456
   WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   WHATSAPP_VERIFY_TOKEN=verify_xyz789
```

---

## Step 4: Configure WhatsApp Webhook (5 min)

Go to Meta Business Suite and set up the webhook:

1. **Navigate to App Settings**
   - https://developers.facebook.com → Your App → WhatsApp → Configuration

2. **Set Webhook URL**
   - URL: `https://your-render-domain.onrender.com/webhook/whatsapp`
   - (Find your Render URL in Render Dashboard)

3. **Set Verify Token**
   - Use the token from Step 3 (e.g., `verify_xyz789`)
   - This token must match `WHATSAPP_VERIFY_TOKEN` in your environment

4. **Subscribe to Messages**
   - In "Webhook fields", subscribe to: `messages`
   - This tells Meta to send you incoming messages

5. **Click "Verify"**
   - Meta will test the webhook
   - Should return a ✅ if successful

---

## Step 5: Test the Integration (10 min)

### Test 1: Send a WhatsApp Message

From your phone (not the agent phone):

1. Save clinic's WhatsApp business number as a contact
2. Send: **"مرحبا"** (Hello)
3. Should receive welcome message in clinic's industry-specific language

### Test 2: Go Through Full Flow

1. Send "مرحبا"
2. Receive questions with clinic-specific options (e.g., "أسنان", "جلدية")
3. Answer all questions
4. Enter name and phone
5. Get confirmation message

### Test 3: Verify Agent Notification

1. Agent should receive WhatsApp message with patient details
2. Should include collected data in message

### Test 4: Check Database

```bash
# SSH into Neon or use console to verify
SELECT * FROM conversations WHERE client_id = 'client_dr_mohamad_clinic_abc123';
SELECT * FROM leads WHERE client_id = 'client_dr_mohamad_clinic_abc123';
```

---

## Understanding Clinic-Specific Features

### Default Clinic Questions

```
1. What service type?
   Options: كشف عام (General Checkup), عيادة متخصصة (Specialist), متابعة (Follow-up), استشارة (Consultation)

2. Which specialty?
   Options: أسنان (Dentistry), جلدية (Dermatology), عيون (Ophthalmology), باطنية (Internal Medicine)

3. Previous visit?
   Options: نعم (Yes), لا (No), أول مرة (First time)

4. Preferred wait time?
   Options: بأقرب وقت (ASAP), بعد أسبوع (After 1 week), بعد شهر (After 1 month)
```

### Appointment Booking (if enabled)

- Patients can schedule appointments directly
- System books time slots
- Automated reminder sent 24 hours before
- Available in clinic's business hours

### AI Fallback (Pro tier)

- If patient asks off-script questions in Arabic
- Claude AI responds in Gulf Arabic dialect
- Example: "هل تقبلون بطاقة ائتمان؟" → AI responds about payment methods

---

## Available Clinic Message Templates

Your system comes with pre-built clinic messages:

### Welcome Message

```
أهلاً بك في [عيادة الدكتور محمد] 👋

وش اسمك الكريم؟
```

### Qualification Questions

Already configured (see above)

### Thank You Message

```
تمام يا [Name]! ✅

معلوماتك وصلت. سيتواصل معنا معك قريباً.
شكراً لتواصلك! 🙏
```

### Agent Notification

```
🏥 *مريض جديد!*

👤 Name: [Patient Name]
📱 Phone: [Patient Phone]

📋 Details:
Service: [Service Type]
Specialty: [Specialty]
First Visit: [Yes/No]
Preferred Time: [When]

⏰ Received: [Timestamp]

wa.me/[patient_phone]
```

---

## Customizing the Clinic (Optional)

### Change Welcome Message

Update in database:

```sql
UPDATE clients
SET settings = jsonb_set(
  settings,
  '{welcome_message}',
  '"أهلاً في عيادة الدكتور محمد المتخصصة 👋"'
)
WHERE id = 'client_dr_mohamad_clinic_abc123';
```

### Enable Advanced Features

```bash
# Enable AI fallback
npm run features enable client_dr_mohamad_clinic_abc123 ai_fallback

# Enable lead scoring
npm run features enable client_dr_mohamad_clinic_abc123 lead_scoring

# Set to Pro tier (all features)
npm run features set-tier client_dr_mohamad_clinic_abc123 pro
```

### Add Custom Questions

Edit in `src/messages.ts` and add clinic-specific variations:

```typescript
export const CLINIC_MESSAGES: ClientMessages = {
  // ... existing messages ...
  questions: [
    {
      text: "وش نوع الخدمة؟",
      options: ["كشف عام", "عيادة متخصصة", "متابعة", "استشارة"],
      field: "service_type",
    },
    // ... more questions ...
  ],
};
```

---

## Pricing & Billing

### SMB Plan (500 SAR/month)

- ✅ Lead capture & qualification
- ✅ WhatsApp messages & notifications
- ✅ Basic appointment booking
- ✅ Google Sheets sync
- ✅ Email support

### Pro Plan (899 SAR/month)

- Everything in SMB +
- ✅ AI responses in Arabic
- ✅ Lead scoring
- ✅ Handover detection
- ✅ Priority support

### Business Plan (1,499 SAR/month)

- Everything in Pro +
- ✅ Advanced analytics
- ✅ Multiple team members
- ✅ Custom automation sequences
- ✅ Phone support

---

## Troubleshooting

### Clinic not receiving messages

- ✅ Check Phone Number ID is correct
- ✅ Check Access Token hasn't expired
- ✅ Verify webhook URL matches Render domain
- ✅ Check Render logs: `Render Dashboard → Services → Logs`

### Messages aren't in Arabic

- This is a font issue on patient's phone (system displays it)
- Or they're not responding to interactive buttons
- Send a simple text like "مرحبا" to test

### Appointments not sending reminders

- ✅ Verify Upstash credentials in `.env`
- ✅ Check QSTASH_TOKEN is set
- ✅ Verify appointment_setting feature is enabled

### Patient leads not appearing

- ✅ Check database: `SELECT * FROM leads WHERE client_id = '...'`
- ✅ Verify Google Sheets credentials if syncing to Sheets

---

## Quick Reference: Commands

```bash
# Add new client (interactive)
npm run client add

# List all clients
npm run client list

# Get client details
npm run client get client_dr_mohamad_clinic_abc123

# Enable feature
npm run features enable client_dr_mohamad_clinic_abc123 ai_fallback

# Set tier
npm run features set-tier client_dr_mohamad_clinic_abc123 pro

# Check health
curl https://your-render-url.onrender.com/health

# View logs
# Render Dashboard → Services → [Your Service] → Logs tab
```

---

## Success Checklist

- [ ] Client info gathered
- [ ] WhatsApp Business account created
- [ ] Phone Number ID & Access Token obtained
- [ ] Client added to database (CLI or SQL)
- [ ] Webhook URL configured in Meta
- [ ] Verify token set in Meta
- [ ] Webhook tested with "مرحبا" message
- [ ] Full conversation flow tested
- [ ] Agent received notification
- [ ] Database shows conversation & leads
- [ ] Billing plan selected
- [ ] Client trained on system

---

## Support

- **Quick issues**: Check Render logs
- **Database issues**: Use Neon Console
- **WhatsApp issues**: Check Meta Business Suite
- **AI issues**: Verify ANTHROPIC_API_KEY in environment
- **Sheets issues**: Verify GOOGLE_CREDENTIALS in environment

You're ready to onboard your clinic client! 🏥
