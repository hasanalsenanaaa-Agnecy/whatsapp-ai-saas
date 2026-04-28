// ============================================================
// AI CLIENT MANAGER
// Centralized Anthropic client with per-tenant rate limiting.
// Replaces 3 separate global instances with one managed pool.
//
// Each tenant gets its own concurrency bucket so one tenant's
// traffic spike can't starve others. If a client has their own
// API key in settings.anthropic_api_key, it's used instead of
// the global key (future: per-tenant billing).
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { ZodSchema } from 'zod';

// ── Per-tenant concurrency tracking ─────────────────────────

const MAX_CONCURRENT_PER_TENANT = 5;
const tenantConcurrency = new Map<string, number>();

function acquireSlot(clientId: string): boolean {
  const current = tenantConcurrency.get(clientId) || 0;
  if (current >= MAX_CONCURRENT_PER_TENANT) return false;
  tenantConcurrency.set(clientId, current + 1);
  return true;
}

function releaseSlot(clientId: string): void {
  const current = tenantConcurrency.get(clientId) || 0;
  if (current > 0) tenantConcurrency.set(clientId, current - 1);
}

// ── Client cache (keyed by API key) ─────────────────────────

const clientCache = new Map<string, Anthropic>();

function getOrCreateClient(apiKey: string): Anthropic {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}

// ── Public API ──────────────────────────────────────────────

const globalApiKey = process.env.ANTHROPIC_API_KEY || '';

/**
 * Get an Anthropic client for a tenant. Uses the tenant's own key
 * if configured, otherwise falls back to the global key.
 */
export function getAIClient(tenantApiKey?: string): Anthropic | null {
  const key = tenantApiKey || globalApiKey;
  if (!key) return null;
  return getOrCreateClient(key);
}

/**
 * Check if AI is available (global key exists).
 */
export function isAIAvailable(): boolean {
  return !!globalApiKey;
}

/**
 * Run an AI call with per-tenant concurrency control.
 * Returns null if the tenant's concurrent limit is hit.
 */
async function withTenantAI<T>(
  clientId: string,
  tenantApiKey: string | undefined,
  fn: (anthropic: Anthropic) => Promise<T>
): Promise<T | null> {
  const ai = getAIClient(tenantApiKey);
  if (!ai) return null;

  if (!acquireSlot(clientId)) {
    console.warn(`AI concurrency limit hit for tenant ${clientId}`);
    return null;
  }

  try {
    return await fn(ai);
  } finally {
    releaseSlot(clientId);
  }
}

/**
 * Default model to use for AI calls.
 */
export const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/**
 * Classify a free-text user message into a typed object validated by a Zod schema.
 *
 * Returns the parsed result on success, or null when:
 *   - AI is unavailable (no key) or tenant concurrency limit hit
 *   - Model output isn't valid JSON or fails schema validation
 *
 * Callers MUST fall back gracefully on null (e.g. keyword matching). This keeps
 * the system functional during AI outages and avoids hard failures on edge
 * phrasings the model can't handle.
 *
 * Uses AI_MODEL (Haiku by default) — cheap and fast enough for short messages.
 */
export async function classifyIntent<T>(
  ctx: { clientId: string; tenantApiKey?: string },
  message: string,
  schema: ZodSchema<T>,
  instruction: string
): Promise<T | null> {
  return withTenantAI(ctx.clientId, ctx.tenantApiKey, async (anthropic) => {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 200,
      system: `${instruction}\n\nRespond with ONLY a JSON object. No preamble, no markdown fences, no explanation.`,
      messages: [{ role: 'user', content: message }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    try {
      const parsed = JSON.parse(text);
      const result = schema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  });
}
