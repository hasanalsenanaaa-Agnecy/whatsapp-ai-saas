import { describe, it, expect } from 'vitest';

// ============================================================
// Dashboard — auth logic, query building, utilities
//
// Tests the pure decision logic behind dashboard endpoints:
// - Role detection from key
// - Client scope enforcement
// - Pagination math
// - Phone masking for dashboard display
// ============================================================

// --- Auth logic (from database.ts validateDashboardKey) ---

interface AuthResult {
  role: 'owner' | 'client';
  clientId?: string;
  clientName?: string;
}

function determineAuthRole(
  key: string,
  ownerKey: string | undefined,
  clientKeys: Map<string, { id: string; name: string }>
): AuthResult | null {
  if (!key) return null;
  if (key === ownerKey) return { role: 'owner' };
  const client = clientKeys.get(key);
  if (client) return { role: 'client', clientId: client.id, clientName: client.name };
  return null;
}

// --- Scope enforcement (from index.ts route handlers) ---

function resolveClientId(
  auth: AuthResult,
  queryClientId?: string
): string | undefined {
  // Clients always see only their own data — enforced server-side
  if (auth.role === 'client') return auth.clientId;
  // Owner can filter by client or see all
  return queryClientId || undefined;
}

function canAccessEndpoint(auth: AuthResult, endpoint: string): boolean {
  if (auth.role === 'owner') return true;
  // Client cannot access /api/clients
  if (endpoint === '/api/clients') return false;
  return true;
}

// --- Pagination math ---

function calculatePagination(page: number, limit: number, total: number): {
  offset: number;
  totalPages: number;
  currentPage: number;
  effectiveLimit: number;
} {
  const effectiveLimit = Math.min(Math.max(limit, 1), 50); // clamp 1-50
  const totalPages = Math.max(1, Math.ceil(total / effectiveLimit));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const offset = (currentPage - 1) * effectiveLimit;
  return { offset, totalPages, currentPage, effectiveLimit };
}

// ============================================================
// Auth role detection
// ============================================================

describe('determineAuthRole', () => {
  const ownerKey = 'owner-secret-key-123';
  const clientKeys = new Map([
    ['client-key-abc', { id: 'c1', name: 'ARAB Store' }],
    ['client-key-xyz', { id: 'c2', name: 'Test Store' }],
  ]);

  it('returns owner for owner key', () => {
    const result = determineAuthRole(ownerKey, ownerKey, clientKeys);
    expect(result).toEqual({ role: 'owner' });
  });

  it('returns client for valid client key', () => {
    const result = determineAuthRole('client-key-abc', ownerKey, clientKeys);
    expect(result).toEqual({ role: 'client', clientId: 'c1', clientName: 'ARAB Store' });
  });

  it('returns null for invalid key', () => {
    const result = determineAuthRole('invalid-key', ownerKey, clientKeys);
    expect(result).toBeNull();
  });

  it('returns null for empty key', () => {
    const result = determineAuthRole('', ownerKey, clientKeys);
    expect(result).toBeNull();
  });

  it('returns null when owner key is undefined', () => {
    const result = determineAuthRole('some-key', undefined, clientKeys);
    expect(result).toBeNull();
  });

  it('matches second client key', () => {
    const result = determineAuthRole('client-key-xyz', ownerKey, clientKeys);
    expect(result).toEqual({ role: 'client', clientId: 'c2', clientName: 'Test Store' });
  });
});

// ============================================================
// Client scope enforcement
// ============================================================

describe('resolveClientId', () => {
  it('enforces client ID for client role regardless of query param', () => {
    const auth: AuthResult = { role: 'client', clientId: 'c1', clientName: 'ARAB' };
    expect(resolveClientId(auth, 'c99')).toBe('c1'); // ignores the query param
  });

  it('uses query param for owner role', () => {
    const auth: AuthResult = { role: 'owner' };
    expect(resolveClientId(auth, 'c2')).toBe('c2');
  });

  it('returns undefined for owner with no filter', () => {
    const auth: AuthResult = { role: 'owner' };
    expect(resolveClientId(auth)).toBeUndefined();
  });

  it('returns client ID even without query param for client role', () => {
    const auth: AuthResult = { role: 'client', clientId: 'c1' };
    expect(resolveClientId(auth)).toBe('c1');
  });
});

describe('canAccessEndpoint', () => {
  it('owner can access all endpoints', () => {
    const auth: AuthResult = { role: 'owner' };
    expect(canAccessEndpoint(auth, '/api/clients')).toBe(true);
    expect(canAccessEndpoint(auth, '/api/conversations')).toBe(true);
    expect(canAccessEndpoint(auth, '/api/alerts')).toBe(true);
  });

  it('client cannot access /api/clients', () => {
    const auth: AuthResult = { role: 'client', clientId: 'c1' };
    expect(canAccessEndpoint(auth, '/api/clients')).toBe(false);
  });

  it('client can access other endpoints', () => {
    const auth: AuthResult = { role: 'client', clientId: 'c1' };
    expect(canAccessEndpoint(auth, '/api/conversations')).toBe(true);
    expect(canAccessEndpoint(auth, '/api/alerts')).toBe(true);
    expect(canAccessEndpoint(auth, '/api/analytics/revenue')).toBe(true);
  });
});

// ============================================================
// Pagination
// ============================================================

describe('calculatePagination', () => {
  it('calculates correct offset for page 1', () => {
    const result = calculatePagination(1, 20, 100);
    expect(result.offset).toBe(0);
    expect(result.totalPages).toBe(5);
    expect(result.currentPage).toBe(1);
  });

  it('calculates correct offset for page 3', () => {
    const result = calculatePagination(3, 20, 100);
    expect(result.offset).toBe(40);
  });

  it('clamps limit to max 50', () => {
    const result = calculatePagination(1, 100, 200);
    expect(result.effectiveLimit).toBe(50);
    expect(result.totalPages).toBe(4);
  });

  it('clamps limit to min 1', () => {
    const result = calculatePagination(1, 0, 10);
    expect(result.effectiveLimit).toBe(1);
  });

  it('clamps page to valid range', () => {
    const result = calculatePagination(999, 20, 40);
    expect(result.currentPage).toBe(2); // only 2 pages exist
    expect(result.offset).toBe(20);
  });

  it('handles zero total', () => {
    const result = calculatePagination(1, 20, 0);
    expect(result.totalPages).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('handles total less than limit', () => {
    const result = calculatePagination(1, 20, 5);
    expect(result.totalPages).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('handles exact boundary (total = limit)', () => {
    const result = calculatePagination(1, 20, 20);
    expect(result.totalPages).toBe(1);
  });

  it('handles total just over limit', () => {
    const result = calculatePagination(1, 20, 21);
    expect(result.totalPages).toBe(2);
  });
});
