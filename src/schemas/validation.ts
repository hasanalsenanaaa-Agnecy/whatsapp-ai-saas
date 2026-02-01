import { z } from 'zod';

// Phone number validation (international format)
const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format');

// ============================================================
// AUTH SCHEMAS
// ============================================================

export const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const ClientLoginSchema = z.object({
  clientId: z.string().min(3),
  apiKey: z.string().min(20)
});

export const RegisterClientSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  industry: z.enum(['real-estate', 'automotive', 'health', 'retail', 'other']),
  email: z.string().email(),
  phone: phoneSchema,
  agentPhones: z.array(phoneSchema).min(1, 'At least one agent phone required')
});

// ============================================================
// WHATSAPP SCHEMAS
// ============================================================

export const SendMessageSchema = z.object({
  to: phoneSchema,
  message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(4000, 'Message exceeds WhatsApp limit'),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'document', 'audio', 'video']).optional()
});

// ============================================================
// CLIENT CONFIG SCHEMAS
// ============================================================

export const UpdateClientSettingsSchema = z.object({
  name: z.string().max(100).optional(),
  agentPhones: z.array(phoneSchema).optional(),
  settings: z.record(z.any()).optional(),
  knowledgeBase: z.array(z.object({
    category: z.string(),
    content: z.string()
  })).optional(),
  questions: z.array(z.object({
    text: z.string(),
    options: z.array(z.string())
  })).optional(),
  messages: z.record(z.string()).optional()
});

// ============================================================
// LEAD SCHEMAS
// ============================================================

export const CreateLeadSchema = z.object({
  phone: phoneSchema,
  name: z.string().min(2),
  email: z.string().email().optional(),
  data: z.record(z.any()).optional()
});

export const UpdateLeadSchema = z.object({
  name: z.string().min(2).optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
  status: z.enum(['new', 'contacted', 'converted', 'lost']).optional(),
  score: z.enum(['hot', 'warm', 'cold']).optional(),
  notes: z.string().optional(),
  data: z.record(z.any()).optional()
});

// ============================================================
// APPOINTMENT SCHEMAS
// ============================================================

export const CreateAppointmentSchema = z.object({
  leadId: z.number(),
  date: z.string().datetime(),
  type: z.string(),
  notes: z.string().optional()
});

// ============================================================
// API KEY SCHEMAS
// ============================================================

export const CreateAPIKeySchema = z.object({
  name: z.string().min(3, 'Key name must be at least 3 characters').max(50)
});

// ============================================================
// AI SCHEMAS
// ============================================================

export const KnowledgeItemSchema = z.object({
  category: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1)
});

export const KnowledgeBaseUpdateSchema = z.object({
  knowledgeBase: z.array(KnowledgeItemSchema)
});

export const AIChatSchema = z.object({
  message: z.string().min(1).max(4000),
  customerContext: z.record(z.any()).optional(),
  conversationHistory: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1)
    })
  ).optional()
});

export const AIScoreLeadSchema = z.object({
  leadId: z.number().int().positive().optional(),
  leadData: z.record(z.any()).optional()
}).refine(value => value.leadId || value.leadData, {
  message: 'leadId or leadData required'
});

export const AIFeedbackSchema = z.object({
  leadId: z.number().int().positive().optional(),
  conversationId: z.string().min(1).optional(),
  userMessage: z.string().min(1).optional(),
  aiResponse: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional()
});

// Type exports for use in route handlers
export type LoginInput = z.infer<typeof LoginSchema>;
export type ClientLoginInput = z.infer<typeof ClientLoginSchema>;
export type RegisterClientInput = z.infer<typeof RegisterClientSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type UpdateClientSettingsInput = z.infer<typeof UpdateClientSettingsSchema>;
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;
export type CreateAPIKeyInput = z.infer<typeof CreateAPIKeySchema>;
export type KnowledgeItemInput = z.infer<typeof KnowledgeItemSchema>;
export type KnowledgeBaseUpdateInput = z.infer<typeof KnowledgeBaseUpdateSchema>;
export type AIChatInput = z.infer<typeof AIChatSchema>;
export type AIScoreLeadInput = z.infer<typeof AIScoreLeadSchema>;
export type AIFeedbackInput = z.infer<typeof AIFeedbackSchema>;
