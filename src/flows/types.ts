// ============================================================
// SHARED FLOW TYPES
// ============================================================

import type { ConvStateName } from '../types/conversation.js';

export interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: ConvStateName;
  step: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
