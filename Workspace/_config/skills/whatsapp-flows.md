# Skill: WhatsApp Flows

How to write, extend, or debug conversation flows in this codebase.

## State machine structure

Conversation state lives in Redis. Shape:

```typescript
interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];  // conversation history for AI context
  state: string;    // current routing state — drives the switch in conversation.ts
  step: number;     // index for sequential question flows
  data: Record<string, any>;  // accumulated lead/booking/cart data
  createdAt: string;
  updatedAt: string;
}
```

`conv.state` is the primary routing key. `conversation.ts` reads it and dispatches to the right handler. A handler advances the flow by mutating `conv.state` to the next state.

## Known states

| State | Handler | Notes |
|-------|---------|-------|
| `welcome` | `handleWelcome` | Entry point. Sends greeting + asks name. |
| `questions` | `handleQuestions` | Loops through `clientMessages.questions` using `conv.step`. |
| `appointment_date` | `handleAppointmentDate` | Date picker for booking flows. |
| `appointment_time` | `handleAppointmentTime` | Time slot selector. |
| `completed` | → `chat` | Lead captured. Transitions to `chat` on next message. |
| `chat` | handled inline | Post-completion free-form replies. |
| `shopify_agent` | `handleShopifyAgent` | Full Shopify e-commerce flow. |
| `ai_conversation` | `handleAIConversation` | AI-only mode, skips rigid flow. |

## Send functions

All live in `src/services/whatsapp.ts`. All require `(to, ..., accessToken, phoneNumberId)`.

| Function | Use when |
|----------|----------|
| `sendWhatsAppMessage` | Plain text. No limit on body. |
| `sendWhatsAppButtons` | Up to **3 buttons**. Title max **20 chars**. Silently truncated. Falls back to text if API error. |
| `sendWhatsAppList` | More than 3 options. Use for question steps with 4+ choices. |
| `sendWhatsAppImage` | Send image with caption. Falls back to text + URL on error. |
| `sendWhatsAppButtonsWithImage` | Product cards. Image + body + up to 3 buttons. |

**Button IDs** must be unique within a message. Use short, stable slugs (`confirm`, `cancel`, `back`).

## Adding a new state

1. Add the state string to the `switch` in `conversation.ts`
2. Write the handler function in the appropriate `src/flows/` file (or `common.ts` if shared)
3. The previous state's handler sets `conv.state = 'your_new_state'` to advance
4. The new handler reads `conv.data` for accumulated context, mutates `conv.state` when done

## Message templates

Defined in `src/messages.ts`. Use `formatMessage(template, data)` for `{placeholder}` substitution.

Available placeholders: `{name}`, `{businessName}`, `{phone}`, `{appointmentDate}`, `{appointmentTime}`, `{details}`, `{whatsapp}`, `{time}`.

## Routing priority in conversation.ts

```
1. Ecommerce (shopify_domain set + state is welcome/shopify_agent)
2. AI conversation mode (feature flag + state is welcome/ai_conversation)
3. Standard flow (switch on conv.state)
```

Do not reorder these without understanding what client configurations would break.
