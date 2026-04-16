# Skill: Arabic Voice

Conventions for writing WhatsApp messages in this platform. All client-facing messages are Gulf Arabic (Saudi dialect).

## Tone

Warm and direct. Conversational, not formal. Feels like a helpful person at a business, not a robot.

- Use `يا {name}` when addressing the user by name (not `السيد/السيدة`)
- End confirmations with `شكراً لتواصلك! 🙏` or `شكراً! 🙏`
- Use `أهلاً وسهلاً` or `أهلاً فيك` for greetings — not `مرحباً` (too formal)
- `وش` not `ماذا` — Gulf dialect, not MSA
- `أبي` not `أريد`
- `بيتواصل` not `سيتواصل`

## Emoji usage

Light and purposeful. Each emoji serves a function, not decoration.

| Emoji | When to use |
|-------|------------|
| 👋 | Greeting only |
| ✅ | Confirmation of completed action |
| 📅 | Appointment date |
| 🕐 | Appointment time |
| 📱 | Phone number |
| 👤 | Customer name |
| 📋 | Details/summary |
| ⏰ | Time reference |
| 🙏 | Thank you (closing) |
| 🏠 | Real estate notifications |
| ❌ | Error states (internal/agent notifications only, not customer-facing) |

Do not use emoji mid-sentence. Use them at the start of a line or after a line break.

## Message structure

**Customer-facing messages**: Short. One idea per message. Lead with the action or confirmation, follow with details.

```
تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.
شكراً لتواصلك! 🙏
```

**Agent notifications**: Start with a bold header, then structured data. Always include `wa.me/{whatsapp}` at the end so agent can tap to respond.

```
🏠 *عميل جديد!*

👤 {name}
📱 {phone}

📋 التفاصيل:
{details}

⏰ {time}

wa.me/{whatsapp}
```

## Button labels

Max 20 characters including spaces. Keep them short and action-oriented.

Good: `أبي أشتري عقار`, `شقة`, `الدمام`, `تأكيد`
Bad: `أريد الاستفسار عن خدمات الشركة` (too long, gets truncated)

## Question flow labels

Options in `questions[]` become button titles or list items. They must be distinct and unambiguous. If options share a prefix, users get confused when they're truncated.

Bad: `أقل من 500 ألف`, `500 ألف - مليون` → both start with a number, easy to mix up as buttons
Better as a **list** (sendWhatsAppList) when 4+ options — avoids the 20-char button limit.

## Invalid input message

`اختر من الخيارات المتاحة 👆`

Use this verbatim for any step where the user sends free text when a button/list reply was expected.
