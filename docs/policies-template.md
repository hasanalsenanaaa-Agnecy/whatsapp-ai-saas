# Store Policies — Template

This file is loaded verbatim into the AI's system prompt so Claude can answer
customer questions about shipping, returns, hours, and location without
escalating every question to the owner.

## How to use

1. Copy this file (e.g. to `docs/clients/arab-policies.md`) and fill it in.
2. Push it to a client's DB:
   ```
   npm run set-policies -- <clientId> docs/clients/arab-policies.md
   ```
3. The AI picks it up on the next message — no restart needed.

Run the command again any time you need to update the policies.

---

## Write policies below in plain prose (Arabic or English).

Keep each section short and factual. The AI reads these, doesn't paraphrase
beyond what's written. Examples below — delete and replace with real values.

### Shipping / الشحن
- المناطق المشمولة: الرياض، جدة، الدمام، ومدن المملكة الرئيسية.
- مدة التوصيل: 1–3 أيام عمل.
- رسوم الشحن: مجاناً للطلبات فوق 200 ريال، خلاف ذلك 20 ريال.

### Returns / الإرجاع
- يحق للعميل طلب استرجاع خلال 7 أيام من تاريخ الاستلام.
- المنتج يجب أن يكون غير مستخدم وبنفس حالته الأصلية.
- للاسترجاع: تواصل معنا عبر واتساب ونرتب الاستلام.

### Hours / ساعات العمل
- الأحد إلى الخميس: 9 صباحاً – 9 مساءً.
- الجمعة والسبت: 2 ظهراً – 10 مساءً.

### Location / الموقع
- المستودع الرئيسي: الرياض، حي الملقا.
- جميع الطلبات تُشحن من الرياض لكافة مدن المملكة.

### Payment / الدفع
- نقبل: Mada, Visa, Mastercard, Apple Pay, STC Pay.
- كل المعاملات آمنة ومشفّرة عبر Shopify Payments.
