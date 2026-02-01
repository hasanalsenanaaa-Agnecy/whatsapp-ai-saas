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

// Type exports for use in route handlers
export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterClientInput = z.infer<typeof RegisterClientSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type UpdateClientSettingsInput = z.infer<typeof UpdateClientSettingsSchema>;
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;
export type CreateAPIKeyInput = z.infer<typeof CreateAPIKeySchema>;
