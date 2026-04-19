// ============================================================
// RATE LIMITER
// Two layers: per-phone (abuse protection) + per-tenant
// (WhatsApp API limits). In-memory — resets on restart,
// which is acceptable since limits are short-lived windows.
// ============================================================

const MAX_MESSAGES_PER_MINUTE = 10;
const DEFAULT_TENANT_LIMIT_PER_MINUTE = 200;

// ── Per-phone rate limiter ──────────────────────────────────

const userMessageCount = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const userData = userMessageCount.get(phone);

  if (!userData || now > userData.resetAt) {
    userMessageCount.set(phone, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (userData.count >= MAX_MESSAGES_PER_MINUTE) {
    return false;
  }

  userData.count++;
  return true;
}

// ── Per-tenant rate limiter ─────────────────────────────────
// Prevents one busy client from burning through WhatsApp API
// limits that affect all clients on the same WABA.

const tenantMessageCount = new Map<string, { count: number; resetAt: number }>();

export function checkTenantRateLimit(
  clientId: string,
  maxPerMinute: number = DEFAULT_TENANT_LIMIT_PER_MINUTE
): boolean {
  const now = Date.now();
  const data = tenantMessageCount.get(clientId);

  if (!data || now > data.resetAt) {
    tenantMessageCount.set(clientId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (data.count >= maxPerMinute) {
    return false;
  }

  data.count++;
  return true;
}

// ── Conversation expiry ─────────────────────────────────────

export function isConversationExpired(updatedAt: number, hoursLimit: number = 24): boolean {
  return Date.now() - updatedAt > hoursLimit * 60 * 60 * 1000;
}

// ── Cleanup (prune expired entries every 15 min) ────────────

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of userMessageCount) {
    if (now > data.resetAt) userMessageCount.delete(key);
  }
  for (const [key, data] of tenantMessageCount) {
    if (now > data.resetAt) tenantMessageCount.delete(key);
  }
}, 15 * 60 * 1000);
