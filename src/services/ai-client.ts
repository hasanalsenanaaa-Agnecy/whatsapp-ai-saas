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
export async function withTenantAI<T>(
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
