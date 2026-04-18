# ARAB | عرب — Onboarding Checklist

## What You Need from the Client

---

### 1. WhatsApp Business API (Meta)

| Item | Notes |
|------|-------|
| **Phone Number ID** | Found in Meta Business Manager → WhatsApp → API Setup |
| **Permanent Access Token** | Must be permanent (not the temporary 24h token) |
| **WhatsApp Business Account ID** | Same page as above |

> **Action required:** Give client a webhook URL to register in Meta:
> `https://yourserver.com/webhook`
> Verify Token: *(agree on a secret string)*

---

### 2. Shopify

| Item | Where to Get It | Required? |
|------|-----------------|-----------|
| **Shopify Store Domain** | e.g. `arab-store.myshopify.com` | ✅ Yes |
| **Storefront Access Token** | Shopify Admin → Settings → Apps → Develop Apps → Storefront API | ✅ Yes |
| **Admin API Token** | Shopify Admin → Settings → Apps → Develop Apps → Admin API | ✅ For order status |
| **Webhook Secret** | Shopify Admin → Settings → Notifications → Webhooks | ✅ For payment verification |

> **Action required:** Register webhook in Shopify:
> - Topic: `orders/paid`
> - URL: `https://yourserver.com/shopify-webhook`
> - Format: JSON

---

### 3. Store Info

| Item | Example |
|------|---------|
| **Store Name** | ARAB \| عرب |
| **Owner WhatsApp Number** | +96512345678 (international format) |
| **Currency** | KWD |

---

### 4. Database Entry (Neon)

Once you have all the above, add the client record:

```json
{
  "name": "ARAB | عرب",
  "phone_number_id": "FROM_META",
  "access_token": "FROM_META",
  "agent_phones": ["+96512345678"],
  "settings": {
    "shopify_domain": "arab-store.myshopify.com",
    "shopify_token": "STOREFRONT_TOKEN",
    "shopify_admin_token": "ADMIN_TOKEN",
    "shopify_webhook_secret": "WEBHOOK_SECRET",
    "currency": "KWD"
  }
}
```

---

### 5. Go-Live Test (in order)

- [ ] Send a WhatsApp message → bot replies with language selection
- [ ] Select Arabic → intent menu appears
- [ ] Select "طلب جديد" → browse products loads with real Shopify data
- [ ] Add product to cart → checkout link generated
- [ ] Complete a real test payment → webhook fires → confirmation sent
- [ ] Check owner receives order notification
- [ ] Test "حالة الطلب" with a real order number

---

### System Capabilities

| Feature | Status |
|---------|--------|
| Arabic + English | ✅ |
| Product browsing with images | ✅ |
| Weight/variant selection | ✅ |
| Multi-item cart | ✅ |
| Real Shopify checkout link | ✅ |
| Payment verification via webhook | ✅ |
| Order status lookup | ✅ (requires Admin token) |
| AI product Q&A (2 per session) | ✅ |
| Owner notifications | ✅ |
| Auto reset every 4 hours | ✅ |

---

### What the Bot Does NOT Handle

- Modifying an order after payment
- Refunds or returns
- Shipping tracking (forwards to owner)
- Multiple product images
- Translating product names (shown as-is from Shopify)
