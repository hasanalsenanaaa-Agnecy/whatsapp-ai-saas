export interface QueryLogEntry {
  sql: string;
  durationMs: number;
  paramsCount: number;
  timestamp: string;
}

interface QueryMetrics {
  totalQueries: number;
  slowQueries: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastSlowQueries: QueryLogEntry[];
}

const queryMetrics: QueryMetrics = {
  totalQueries: 0,
  slowQueries: 0,
  totalDurationMs: 0,
  avgDurationMs: 0,
  lastSlowQueries: []
};

let slowQueryThresholdMs = 1000;
let maxSlowQueryEntries = 50;

export function setSlowQueryThreshold(ms: number) {
  slowQueryThresholdMs = ms;
}

export function setMaxSlowQueryEntries(limit: number) {
  maxSlowQueryEntries = limit;
}

export function recordQuery(entry: QueryLogEntry) {
  queryMetrics.totalQueries += 1;
  queryMetrics.totalDurationMs += entry.durationMs;
  queryMetrics.avgDurationMs = Math.round(queryMetrics.totalDurationMs / queryMetrics.totalQueries);

  if (entry.durationMs >= slowQueryThresholdMs) {
    queryMetrics.slowQueries += 1;
    queryMetrics.lastSlowQueries.unshift(entry);
    if (queryMetrics.lastSlowQueries.length > maxSlowQueryEntries) {
      queryMetrics.lastSlowQueries.pop();
    }
    console.warn('🐢 Slow query', {
      durationMs: entry.durationMs,
      paramsCount: entry.paramsCount,
      sql: entry.sql.slice(0, 200)
    });
  }
}

export function getQueryMetrics() {
  return {
    ...queryMetrics,
    slowQueryThresholdMs,
    maxSlowQueryEntries,
    timestamp: new Date().toISOString()
  };
}

export function resetQueryMetrics() {
  queryMetrics.totalQueries = 0;
  queryMetrics.slowQueries = 0;
  queryMetrics.totalDurationMs = 0;
  queryMetrics.avgDurationMs = 0;
  queryMetrics.lastSlowQueries = [];
}
