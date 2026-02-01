import { describe, it, expect } from 'vitest';
import {
  buildFilterQuery,
  validateFilters,
  sanitizeSearch
} from '../../api/filters';

describe('Filter Utilities', () => {
  it('should build filter query with status', () => {
    const result = buildFilterQuery({ status: 'new' });

    expect(result.where.status).toBe('new');
    expect(result.orderBy.created_at).toBe('desc');
  });

  it('should build filter query with score', () => {
    const result = buildFilterQuery({ score: 'hot' });

    expect(result.where.score).toBe('hot');
  });

  it('should build filter query with date range', () => {
    const result = buildFilterQuery({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31'
    });

    expect(result.where.created_at).toBeDefined();
    expect(result.where.created_at.$gte).toBeDefined();
    expect(result.where.created_at.$lte).toBeDefined();
  });

  it('should validate status filter', () => {
    const valid = validateFilters({ status: 'new' });
    expect(valid.valid).toBe(true);

    const invalid = validateFilters({ status: 'invalid' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('should validate score filter', () => {
    const valid = validateFilters({ score: 'hot' });
    expect(valid.valid).toBe(true);

    const invalid = validateFilters({ score: 'invalid' });
    expect(invalid.valid).toBe(false);
  });

  it('should validate sort order', () => {
    const valid = validateFilters({ sortOrder: 'asc' });
    expect(valid.valid).toBe(true);

    const invalid = validateFilters({ sortOrder: 'invalid' });
    expect(invalid.valid).toBe(false);
  });

  it('should sanitize search query', () => {
    expect(sanitizeSearch('john doe')).toBe('john doe');
    expect(sanitizeSearch('  spaces  ')).toBe('spaces');
    expect(sanitizeSearch('test@example.com')).toBe('test@example.com'); // @ is allowed
    expect(sanitizeSearch('very-long-query-' + 'x'.repeat(100))).toHaveLength(100);
  });
});
