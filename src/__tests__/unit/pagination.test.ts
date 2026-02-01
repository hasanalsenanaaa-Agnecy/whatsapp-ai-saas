import { describe, it, expect } from 'vitest';
import {
  parsePagination,
  calculatePagination,
  validatePagination
} from '../../api/pagination';

describe('Pagination Utilities', () => {
  it('should parse default pagination', () => {
    const result = parsePagination({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('should parse custom pagination', () => {
    const result = parsePagination({ page: 3, limit: 50 });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(100);
  });

  it('should cap limit at 500', () => {
    const result = parsePagination({ limit: 1000 });

    expect(result.limit).toBe(500);
  });

  it('should enforce minimum page of 1', () => {
    const result = parsePagination({ page: -5 });

    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('should calculate pagination metadata', () => {
    const result = calculatePagination(2, 20, 50);

    expect(result.page).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(50);
    expect(result.pages).toBe(3);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrev).toBe(true);
  });

  it('should validate pagination params', () => {
    expect(validatePagination(1, 20)).toBe(true);
    expect(validatePagination(0, 20)).toBe(false);
    expect(validatePagination(1, 0)).toBe(false);
    expect(validatePagination(1, 501)).toBe(false);
  });
});
