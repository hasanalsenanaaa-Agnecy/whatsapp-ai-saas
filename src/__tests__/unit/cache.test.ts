import { describe, it, expect, beforeEach } from 'vitest';
import {
  setCacheValue,
  getCacheValue,
  deleteCacheValue,
  clearCache,
  getCacheStats
} from '../../api/cache';

describe('Cache Utilities', () => {
  beforeEach(() => {
    clearCache();
  });

  it('should set and get cache value', () => {
    setCacheValue('key1', { data: 'value1' }, 300);
    const result = getCacheValue('key1');

    expect(result).toEqual({ data: 'value1' });
  });

  it('should return null for non-existent key', () => {
    const result = getCacheValue('nonexistent');
    expect(result).toBeNull();
  });

  it('should delete cache value', () => {
    setCacheValue('key1', { data: 'value1' }, 300);
    deleteCacheValue('key1');
    const result = getCacheValue('key1');

    expect(result).toBeNull();
  });

  it('should handle expired entries', async () => {
    setCacheValue('key1', { data: 'value1' }, 0.001); // 1ms TTL
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = getCacheValue('key1');
    expect(result).toBeNull();
  });

  it('should provide cache stats', () => {
    setCacheValue('key1', 'value1', 300);
    setCacheValue('key2', 'value2', 300);

    const stats = getCacheStats();
    expect(stats.validEntries).toBeGreaterThanOrEqual(2);
  });

  it('should clear all cache', () => {
    setCacheValue('key1', 'value1', 300);
    setCacheValue('key2', 'value2', 300);
    clearCache();

    const stats = getCacheStats();
    expect(stats.totalEntries).toBe(0);
  });
});
