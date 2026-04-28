// Single source of truth for conversation state names.
// Adding a new state? Add it here and TypeScript will list every
// place that needs updating.

export type ConvStateName =
  | 'welcome'
  | 'questions'
  | 'appointment_date'
  | 'appointment_time'
  | 'shopify_agent'
  | 'ai_conversation'
  | 'completed'
  | 'chat';
