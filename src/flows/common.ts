// ============================================================
// FLOWS BARREL
// Re-exports the split flow modules so callers (conversation.ts,
// tests) can import from a single entry point. The actual logic
// lives in handlers.ts, ai.ts, lifecycle.ts, intent.ts.
// ============================================================

export type { ConversationState } from './types.js';
export type { ClientFeatures } from '../types/client.js';

// Re-exports sourced from services that the router still imports
// via this barrel — keeps conversation.ts unchanged.
export { detectHandoverIntent } from '../services/knowledge.js';
export { isAIConversationAvailable } from '../services/ai-conversation.js';

export {
  handleWelcome,
  handleQuestions,
  handleAppointmentDate,
  handleAppointmentTime,
  handleChat,
} from './handlers.js';

export {
  handleAIConversation,
  handleAIFallback,
} from './ai.js';

export {
  handleHandoverRequest,
} from './lifecycle.js';

export {
  detectPostCompletionIntent,
  classifyPostCompletionIntent,
} from './intent.js';
