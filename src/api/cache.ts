/**
 * Simple in-memory caching with TTL
 * For production, use Redis
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

/**
 * Set cache value with TTL
 */
export function setCacheValue<T>(
  key: string,
  value: T,
  ttlSeconds: number = 300
): void {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  cache.set(key, { data: value, expiresAt });
}

/**
 * Get cache value if not expired
 */
export function getCacheValue<T>(key: string): T | null {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

/**
 * Delete cache entry
 */
export function deleteCacheValue(key: string): void {
  cache.delete(key);
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Clear cache entries matching pattern
 */
export function clearCachePattern(pattern: string): void {
  const regex = new RegExp(pattern);
  for (const key of cache.keys()) {
    if (regex.test(key)) {
      cache.delete(key);
    }
  }
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  let totalEntries = 0;
  let expiredEntries = 0;

  for (const entry of cache.values()) {
    totalEntries++;
    if (Date.now() > entry.expiresAt) {
      expiredEntries++;
    }
  }

  return {
    totalEntries,
    expiredEntries,
    validEntries: totalEntries - expiredEntries
  };
}

/**
 * Clean up expired entries
 */
export function cleanupExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredCache, 5 * 60 * 1000);
