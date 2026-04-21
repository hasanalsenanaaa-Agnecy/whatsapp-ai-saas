# Shopify Flow — Full Customer Journey Audit

**Purpose:** Map every state, every button, every free-text scenario. Called out at the end: where the AI integration is weak and what to fix.

---

## 0. Global mechanics (applies to all states)

### 0.1 AI budget
- Constant: `AI_QUESTION_BUDGET = 2` (see [types.ts:46](src/services/shopify/types.ts#L46)).
- This is **2 AI answers per conversation, total** — not per state. Once they've asked 2 questions anywhere, the bot will not call Claude again for the rest of the session.
- Counter: `conv.data._aiQuestionCount` — persisted to DB, survives restarts. Only reset by `/reset`, `وقف`, `cancel`, `restart`, or `new_order`.

### 0.2 What `tryAIAnswer()` actually does (see [ai.ts](src/services/shopify/ai.ts))
1. Checks `isQuestionMessage(msg)` — if not a question starter, returns `false` (doesn't count against budget).
2. If budget exhausted → sends exhausted CTA with buttons `[pick_direct, contact_us_global, go_home]` and returns `true`.
3. Else calls Claude Haiku with the full product catalog + custom system prompt ("لهجة خليجية قصيرة — جملة أو جملتين كحد أقصى").
4. Sends the AI reply as a plain text message.
5. **Increments the counter.**
6. If counter == 1 after this answer → sends a soft CTA: *"تبي تتصفح المنتجات؟"* + buttons `[pick_direct, show_images, go_home]`.
7. If counter == 2 → sends the exhausted CTA with buttons `[pick_direct, contact_us_global, go_home]`.

### 0.3 `isQuestionMessage()` detector — what counts as a "question"
Arabic: وش، شو، ايش، كيف، متى، وين، ليش، هل، ممكن، فيه، عندكم، تقدر، اقدر، كم، بكم، مبيعا، افضل، ارخص، استفسار
English: what, which, how, when, where, why, can you, do you, is there, are there, tell me, about, best, cheapest
**Plus: anything ending in `?` or `؟`.**

If the message has none of these markers, the AI is **never invoked**, even if the customer is clearly asking something. Example: *"المنتج هذا حلو؟"* triggers AI (has `؟`). *"المنتج هذا حلو"* (same thing, no mark) does not.

### 0.4 Pattern-based shortcuts (cheaper than AI)
- `tryAnswerProductQuestion(msg)` — pattern matches on "best seller / الأكثر مبيعاً", "cheapest / أرخص", "gift / هدية", "sale / تخفيض", "new / جديد". Returns a single matching product. Tried BEFORE AI.
- `getTopProductsByQuery(msg)` — same patterns, but returns top 3 products as cards. Used in browse states.
- These do NOT consume AI budget.

### 0.5 Reprompt-once silence
- First unrecognized message in a state → re-send the state's menu.
- Second unrecognized message in the same state → **complete silence** (no reply at all).
- Reset by successful action (tapping any valid button).

### 0.6 Global commands (from any non-welcome state)
| Input | Effect |
|-------|--------|
| `وقف`, `cancel`, `restart` | Full reset: clears cart, language, consent, intent, AI count. Restarts at welcome. |
| `go_home`, `رئيسية`, `home`, `menu` | Soft reset: clears intent, goes back to the 3-option intent menu (keeps cart, lang, consent). |
| `view_cart` (as tap) | Jumps to cart state. |
| `pick_direct` (as tap) | Jumps to product list. |
| `show_images` (as tap) | Jumps to image browse. |
| `contact_us_global` (as tap) | Notifies owner, puts bot in silence mode. |

---

## 1. STATE: WELCOME (entry point)

[handlers.ts:190](src/services/shopify/handlers.ts#L190)

### Sub-step 1a: Language selection
**Bot shows:** *"أهلاً بك في {store}! Welcome! Choose your language"*
**Buttons:** `[lang_ar العربية]` `[lang_en English]`

| Action | Result |
|--------|--------|
| Tap `lang_ar` | `_lang=ar`, moves to consent |
| Tap `lang_en` | `_lang=en`, moves to consent |
| Type "عربي" / "arabic" / "ar" | Same as tap AR |
| Type "english" / "en" / "انجليزي" | Same as tap EN |
| Type anything else | Re-show the language buttons |
| **Free-text AI** | ❌ AI is NOT called here. Message goes to the "anything else" branch → re-ask language. |

### Sub-step 1b: PDPL consent
**Bot shows:** *"نحفظ بيانات محادثتك لمعالجة طلبك..."*
**Buttons:** `[consent_yes موافق ✅]` `[consent_no لا أوافق ❌]`

| Action | Result |
|--------|--------|
| Tap `consent_yes` / type "موافق" / "yes" / "agree" / "ok" | Consent given, moves to intent menu |
| Tap `consent_no` / type "decline" / "رفض" | Bot says *"نحترم خصوصيتك..."* then GOES SILENT. Any new message restarts from this same consent screen. |
| Type anything else | Re-show consent buttons |
| **Free-text AI** | ❌ Not called. Bot just re-asks. |

### Sub-step 1c: Intent menu
**Bot shows:** *"كيف نقدر نساعدك؟"*
**Buttons:** `[intent_order القائمة 🌴]` `[intent_status حالة الطلب 📦]` `[intent_cs خدمة العملاء 💬]`

| Action | Result |
|--------|--------|
| Tap `intent_order` | Moves to NEW ORDER FLOW (below) |
| Tap `intent_status` | Goes to ORDER_STATUS state |
| Tap `intent_cs` | Goes to CUSTOMER_SERVICE state |
| Type "القائمة" (the label text) | ❌ Does NOT match — re-shows the same menu. WhatsApp sends the button ID on tap, not the label. This is the loop you hit in your test. |
| Type anything else | Re-show intent buttons |
| **Free-text AI** | ❌ Not called at this step. |

**⚠️ AI weakness #1:** Customer cannot ask "what do you sell?" / "وش عندكم؟" here. The message is just ignored with a menu re-prompt.

### Sub-step 1d: New order — cart resume check
If the customer has items in cart from a prior session:
**Bot shows:** *"Welcome back! Your cart: [items]. Continue?"*
**Buttons:** `[continue_cart أكمل الطلب]` `[clear_cart لا، من جديد]`

| Action | Result |
|--------|--------|
| Tap `continue_cart` / type "اكمل" | Jumps to cart state |
| Tap `clear_cart` / type "لا" / "من جديد" / shortcut `show_images`, `pick_direct` | Clears cart, continues to browse choice |
| Anything else | Re-show the continue/clear buttons |

### Sub-step 1e: Browse choice
**Bot shows:** *"How would you like to browse?"*
**Buttons:** `[show_images شوف الصور]` `[pick_direct قائمة المنتجات]` `[go_home الرئيسية 🏠]`
Moves state to `browse_choice`.

---

## 2. STATE: BROWSE_CHOICE

[handlers.ts:473](src/services/shopify/handlers.ts#L473)

**Bot already showed:** Browse-mode buttons.

| Action | Result |
|--------|--------|
| Tap `show_images` / type "صور" / "شوف" | Goes to IMAGE_BROWSE — shows product cards with images |
| Tap `pick_direct` / type "قائمة" / "مباشرة" | Goes to CATALOG — shows product list |
| Tap `go_home` | Back to intent menu |
| Type "best seller" / "الأكثر مبيعاً" / "أرخص" / "هدية" / "new" | `getTopProductsByQuery` returns top 3 → shows 3 product cards (stays in catalog mode). **No AI used.** |
| Type a product name substring | `matchProduct` finds it via `tryAnswerProductQuestion` → goes straight to product view. **No AI used.** |
| Type a question (`isQuestionMessage`) | ✅ **AI is called** with full catalog. Claude answers in 1-2 sentences. Budget consumed. |
| Type anything else (non-question, no match) | ✅ **AI is called as fallback** (see [handlers.ts:522](src/services/shopify/handlers.ts#L522)). If AI doesn't reply (budget gate or not a question), reprompt once then silence. |

**This is the MOST AI-friendly state.** Customer can ask anything.

---

## 3. STATE: IMAGE_BROWSE

[handlers.ts:547](src/services/shopify/handlers.ts#L547)

**Bot already showed:** 2-10 product cards, each with image + `[pick_N Select ✅]` + `[go_home]` (or weight buttons for grouped items).

| Action | Result |
|--------|--------|
| Tap `pick_N` (any N) | Selects that product → goes to variant/quantity |
| Tap `pick_group_X_Y_Z` | Shows weight buttons for that group |
| Tap `go_home` | Back to intent menu |
| Type a number 1-10 | `matchProduct` maps to `pick_N` → selects that product |
| Type a product name | `matchProduct` by title substring → selects it |
| Type "best"/"cheapest"/"gift"/"sale" | `getTopProductsByQuery` → shows top 3 cards |
| Type a question | `isQuestionMessage` is NOT checked first here — instead `matchProduct`, then `getTopProductsByQuery`, then `tryAnswerProductQuestion` run. Only if all fail does `tryAIAnswer` run. |
| Type gibberish | AI tried last; if AI declines (not a question) → reprompt with product names again, then silence. |

**⚠️ AI weakness #2:** Here, pattern-matching runs BEFORE AI. So "أيهم ألذ؟" (which one tastes better?) — the `أيه` contains `أي` and could coincidentally hit "أفضل" via the matcher, showing top products as cards instead of letting AI actually answer. This is subtle and inconsistent with BROWSE_CHOICE behavior.

---

## 4. STATE: CATALOG (list mode)

[handlers.ts:588](src/services/shopify/handlers.ts#L588)

**Bot already showed:** WhatsApp list with one row per product (or product group). Plus a cart summary header if items are in cart.

| Action | Result |
|--------|--------|
| Tap `pick_N` (from list row) | Selects product → variant/quantity view |
| Tap `pick_group_X_Y_Z` | Shows weight buttons for that group (3-button WhatsApp message) |
| Tap `view_cart` | Jumps to cart state |
| Tap `checkout_now` | Runs checkout (cart must have items) |
| Type number 1-N / product name | `matchProduct` → product view |
| Type "best seller" / "أرخص" / "هدية" / "sale" / "new" | Top 3 product cards |
| Type a question | `matchProduct` → `getTopProductsByQuery` → `tryAnswerProductQuestion` → **then AI fallback** |
| Type anything else | AI fallback; if AI doesn't fire → reprompt with list, then silence |

Same AI pattern as IMAGE_BROWSE — pattern-first, AI-last.

---

## 5. STATE: PRODUCT_VIEW

[handlers.ts:664](src/services/shopify/handlers.ts#L664)

**Bot already showed:** Single product card with image, title, price range, low-stock warning (if ≤5 left), short description, and buttons `[add_to_cart أضف للسلة]` `[back_to_list رجوع]` `[view_cart السلة]` OR `[go_home الرئيسية 🏠]` (depending on whether product is already in cart).

| Action | Result |
|--------|--------|
| Tap `add_to_cart` | Uses already-selected variant → goes to QUANTITY_SELECT |
| Tap `back_to_list` | Goes back to CATALOG or IMAGE_BROWSE (based on `_browseMode`) |
| Tap `view_cart` | Jumps to cart state |
| Tap `go_home` | Back to intent menu |
| Type a question (`isQuestionMessage`) | ✅ **AI is called.** After AI replies, the product card is re-shown so the customer can continue. |
| Type non-question | ❌ **AI is NOT called** in this state. Just reprompts with the product view once, then silence. |

**⚠️ AI weakness #3:** Customer on a product page says *"هذي المنتج له مدة صلاحية طويلة"* (a statement, not a question) — bot silences. A better pattern would be to always try AI here since the customer clearly has something to say about THIS product.

---

## 6. STATE: VARIANT_SELECT

[handlers.ts:730](src/services/shopify/handlers.ts#L730)

**Bot already showed:** Weight buttons (≤3) or a weights list (4+), like `[500g — 25 KWD]` `[1kg — 45 KWD]`.

| Action | Result |
|--------|--------|
| Tap `var_N` | Selects variant → straight to QUANTITY_SELECT |
| Type weight like "500g" or "1kg" | `matchVariant` resolves it → quantity |
| Type anything else | *"اختر من الخيارات المتاحة"* — does not silence, does not retry with AI. |
| **Free-text AI** | ❌ Not called. This state is strictly variant selection. |

---

## 7. STATE: QUANTITY_SELECT

[handlers.ts:761](src/services/shopify/handlers.ts#L761)

**Bot already showed:** `[qty_1 1]` `[qty_2 2]` `[qty_3 3]` — customer can also type any number.

| Action | Result |
|--------|--------|
| Tap `qty_1/2/3` | Adds to cart with that qty, shows cart confirmation + `[add_more]` `[view_cart]` `[checkout_now]` |
| Type a number 1-20 (incl Arabic numerals ١٢٣) | Same — adds to cart |
| Type 0 or >20 | Error message, stays in state |
| Type non-number | *"اكتب رقم الكمية"* — stays in state |
| **Free-text AI** | ❌ Not called. Quantity-only state. |

---

## 8. STATE: CART

[handlers.ts:843](src/services/shopify/handlers.ts#L843)

**Bot already showed:** Numbered cart summary with total, plus `[checkout_now اتمام الطلب ✅]` `[add_more أضف منتج]` `[remove_item حذف منتج]`.

| Action | Result |
|--------|--------|
| Tap `checkout_now` / type "اتمام الطلب" / "ادفع" / "اطلب" | Runs checkout — creates Shopify checkout URL, sends it, moves to AWAITING_PAYMENT |
| Tap `add_more` / type "تسوق" | Back to CATALOG (list mode) |
| Tap `remove_item` / type "حذف" / "شيل" | Goes to CART_REMOVE state |
| Tap `view_cart` | Re-show cart |
| Type a question | ✅ **AI is called.** After AI replies, bot does NOT re-show cart — customer has to tap/type their next action. |
| Type non-question | AI fallback tried first; if not triggered → reprompt cart once, then silence. |

---

## 9. STATE: CART_REMOVE

[handlers.ts:897](src/services/shopify/handlers.ts#L897)

**Bot already showed:** `[remove_0]` `[remove_1]` ... `[view_cart رجوع للسلة]` (or list for 3+ items).

| Action | Result |
|--------|--------|
| Tap `remove_N` / type "1", "2", "3" | Removes item N. If cart empty → goes back to product list. Else → re-show cart. |
| Type "لا" / "رجوع" / "كنسل" | Back to cart view |
| Anything else | Re-show removal menu |
| **Free-text AI** | ❌ Not called. Strictly removal state. |

---

## 10. STATE: AWAITING_PAYMENT

[handlers.ts:949](src/services/shopify/handlers.ts#L949)

**Bot already showed:** Order summary + Shopify payment link. No buttons in the checkout message itself.

| Action | Result |
|--------|--------|
| Type "وقف" / "cancel" / "الغ" / "إلغاء" / "مو عارف" / "بكره" | Resets order, goes to welcome |
| Tap `new_order` / type "طلب جديد" | Archives current, starts fresh |
| Tap `paid_help` / type "مساعدة" / "موظف" / "help" | *"سيتواصل معك فريقنا قريباً."* + notifies owner (once per session) |
| Anything else (first time) | Notifies owner silently, shows `[paid_help أحتاج مساعدة]` `[go_home الرئيسية 🏠]` |
| Anything else (after first) | Shows the same help/home buttons. Owner NOT re-notified. |
| **Free-text AI** | ❌ Not called. This is a payment-waiting state. |

**Note:** The real payment confirmation comes from the Shopify webhook, not the customer. Customer doesn't need to say anything.

---

## 11. STATE: ORDER_COMPLETE

[handlers.ts:1014](src/services/shopify/handlers.ts#L1014)

**Bot already showed:** Payment confirmation (from webhook). Any incoming messages:

| Action | Result |
|--------|--------|
| Tap `new_order` / type "طلب جديد" | Archives, resets, welcomes again |
| Tap `track_order` / type "تتبع" / "وين طلبي" | *"سيتواصل معك فريقنا..."* + notify owner, then silence |
| Tap `contact_us` / type "تواصل" / "مشكلة" / "تأخر" / "ما وصل" / "استرجاع" / "الغ" | Same — scripted reply + notify owner + silence |
| Type "شكراً" / "thanks" (first time) | *"العفو! 😊"* — one warm ack |
| Anything else | Silence. |
| **Free-text AI** | ❌ Not called. Post-order is intentionally quiet. |

---

## 12. STATE: DONE

[handlers.ts:1064](src/services/shopify/handlers.ts#L1064)

**Pure silence.** Only `new_order` / "طلب جديد" escapes. AI is not called.

---

## 13. STATE: ORDER_STATUS

[handlers.ts:1085](src/services/shopify/handlers.ts#L1085)

**Bot asks:** *"أرسل لنا رقم طلبك 📦 (مثال: #1042)"*

| Action | Result |
|--------|--------|
| Type `#1042` or `1042` (Arabic numerals OK) | Looks up via Shopify Admin API. If found → shows status + `[go_home]` button then silences. If not found → "couldn't find order" + `[go_home]`, silences. If no admin token → "team will review" + notify owner + silence. |
| Type anything non-numeric | *"ما قدرت أقرأ رقم الطلب..."* — stays in state |
| **Free-text AI** | ❌ Not called. Strictly order-number intake. |

---

## 14. STATE: CUSTOMER_SERVICE

[handlers.ts:1184](src/services/shopify/handlers.ts#L1184)

**Bot on first message:** *"وصل طلبك ✅ فريقنا راح يتواصل معك خلال 30 دقيقة."* + notifies owner.

All subsequent messages: **silently forwarded to owner, no reply to customer.** This is full human-takeover mode.

**⚠️ AI weakness #4:** Once a customer picks "خدمة العملاء", AI never sees them again, even for trivial questions that could be auto-answered. That's by design, but it's aggressive.

---

## AI integration — summary of weaknesses

| # | Issue | Location |
|---|-------|----------|
| 1 | AI not called at the intent menu (welcome step 1c). Customer asking "وش عندكم؟" just sees menu re-prompt. | [handlers.ts:334](src/services/shopify/handlers.ts#L334) |
| 2 | Pattern-match runs BEFORE AI in IMAGE_BROWSE and CATALOG. Questions that happen to contain trigger words ("أفضل", "أرخص") get routed to the cheap matcher instead of the AI, producing product cards when the customer wanted an answer. | [handlers.ts:512](src/services/shopify/handlers.ts#L512), [handlers.ts:642](src/services/shopify/handlers.ts#L642) |
| 3 | In PRODUCT_VIEW, non-question free-text is ignored (reprompt+silence) instead of letting AI handle statements like "ما أحبه كتير حلو" or concerns. | [handlers.ts:720](src/services/shopify/handlers.ts#L720) |
| 4 | `isQuestionMessage()` requires specific starter words OR `?`/`؟`. Natural phrasing without these ("المنتج حلو" as a complaint) never reaches AI. | [helpers.ts](src/services/shopify/helpers.ts) |
| 5 | Budget of 2 is very tight — 2 questions across the ENTIRE conversation (including future sessions until reset). A browsing customer who asks 2 early questions is mute for the rest of the session. | [types.ts:46](src/services/shopify/types.ts#L46) |
| 6 | AI budget is persisted to DB. A returning customer who used their 2 questions yesterday has 0 budget today. Not reset per-session, only on `new_order` / `/reset`. | [types.ts:46](src/services/shopify/types.ts#L46) |
| 7 | VARIANT_SELECT, QUANTITY_SELECT, CART_REMOVE, ORDER_STATUS, AWAITING_PAYMENT never call AI. A customer confused on "how many should I order?" during quantity gets no help. | Multiple |
| 8 | After AI replies in CART, the cart menu is not re-shown — customer has to remember what to do next. | [handlers.ts:884](src/services/shopify/handlers.ts#L884) |
| 9 | Pattern matcher and AI both use the product catalog, but they don't share state — the matcher can "steal" a message from the AI even when the AI would have given a better answer. | [handlers.ts](src/services/shopify/handlers.ts) |

---

## Recommendations (if you want to fix these later)

1. **Raise budget to 4-5** and reset it per-session (when a new conversation starts after 4h idle).
2. **Let AI run at the intent menu** — at least attempt `tryAIAnswer`; fall back to menu reprompt.
3. **Try AI before pattern matcher** in BROWSE_CHOICE / IMAGE_BROWSE / CATALOG — pattern matcher becomes a fallback instead of an override.
4. **Loosen `isQuestionMessage`** — any message with >3 words and not matching a button ID/product name is probably a question or a concern.
5. **In PRODUCT_VIEW, always try AI** before silencing, since the customer is focused on a specific product.
6. **Re-show cart menu after AI reply in CART state** so the conversation continues cleanly.
