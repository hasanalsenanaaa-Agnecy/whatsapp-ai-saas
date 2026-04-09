// ============================================================
// CLINIC FLOW
// Uses the standard question → appointment flow with clinic-specific messages.
// Industry-specific templates are driven by messages.ts (getDefaultMessages).
// ============================================================

export {
  handleWelcome,
  handleQuestions,
  handleAppointmentDate,
  handleAppointmentTime,
  handleChat,
  handleAIConversation,
  completeLead
} from './common.js';
