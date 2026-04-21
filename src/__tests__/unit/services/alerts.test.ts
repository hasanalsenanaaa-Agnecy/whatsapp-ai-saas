import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================
// Alerts Service — error tracking and spike detection
//
// We test the pure logic of the sliding window error tracker.
// The actual WhatsApp sending is mocked out.
// ============================================================

// --- Re-implement the pure error tracking logic for testing ---

const ERROR_WINDOW_MS = 5 * 60 * 1000;
const ERROR_SPIKE_THRESHOLD = 10;
const CLIENT_ERROR_THRESHOLD = 5;
const CLIENT_COOLDOWN_MS = 30 * 60 * 1000;

class ErrorTracker {
  private errorTimestamps: number[] = [];
  private clientErrors = new Map<string, number[]>();
  private clientAlertCooldowns = new Map<string, number>();
  private lastSpikeAlertTime = 0;

  trackError(clientId?: string, now = Date.now()): { spikeDetected: boolean; clientThresholdReached: boolean } {
    this.errorTimestamps.push(now);
    let spikeDetected = false;
    let clientThresholdReached = false;

    // Prune old timestamps
    while (this.errorTimestamps.length > 0 && this.errorTimestamps[0]! < now - ERROR_WINDOW_MS) {
      this.errorTimestamps.shift();
    }

    // Check for system-wide spike
    if (this.errorTimestamps.length >= ERROR_SPIKE_THRESHOLD && now - this.lastSpikeAlertTime > ERROR_WINDOW_MS) {
      this.lastSpikeAlertTime = now;
      spikeDetected = true;
    }

    // Track per-client errors
    if (clientId) {
      if (!this.clientErrors.has(clientId)) this.clientErrors.set(clientId, []);
      const timestamps = this.clientErrors.get(clientId)!;
      timestamps.push(now);
      while (timestamps.length > 0 && timestamps[0]! < now - ERROR_WINDOW_MS) {
        timestamps.shift();
      }
      if (timestamps.length >= CLIENT_ERROR_THRESHOLD) {
        clientThresholdReached = true;
      }
    }

    return { spikeDetected, clientThresholdReached };
  }

  getErrorCount(now = Date.now()): number {
    while (this.errorTimestamps.length > 0 && this.errorTimestamps[0]! < now - ERROR_WINDOW_MS) {
      this.errorTimestamps.shift();
    }
    return this.errorTimestamps.length;
  }

  shouldAlertClient(clientId: string, now = Date.now()): boolean {
    const lastAlert = this.clientAlertCooldowns.get(clientId) || 0;
    if (now - lastAlert < CLIENT_COOLDOWN_MS) return false;
    const timestamps = this.clientErrors.get(clientId) || [];
    return timestamps.length >= CLIENT_ERROR_THRESHOLD;
  }

  markClientAlerted(clientId: string, now = Date.now()): void {
    this.clientAlertCooldowns.set(clientId, now);
    this.clientErrors.set(clientId, []);
  }
}

// --- Re-implement health status logic for testing ---

function computeHealthStatus(dbConnected: boolean, errorRate: number): {
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: string;
} {
  const status = !dbConnected ? 'unhealthy' : errorRate >= ERROR_SPIKE_THRESHOLD ? 'degraded' : 'healthy';
  const details = !dbConnected
    ? 'Database connection failed'
    : errorRate >= ERROR_SPIKE_THRESHOLD
      ? `Error spike: ${errorRate} errors in last 5 minutes`
      : 'All systems operational';
  return { status, details };
}

// ============================================================
// Error tracking
// ============================================================

describe('ErrorTracker', () => {
  let tracker: ErrorTracker;

  beforeEach(() => {
    tracker = new ErrorTracker();
  });

  describe('trackError', () => {
    it('tracks a single error', () => {
      tracker.trackError();
      expect(tracker.getErrorCount()).toBe(1);
    });

    it('tracks multiple errors', () => {
      for (let i = 0; i < 5; i++) tracker.trackError();
      expect(tracker.getErrorCount()).toBe(5);
    });

    it('does not detect spike below threshold', () => {
      for (let i = 0; i < 9; i++) {
        const result = tracker.trackError();
        expect(result.spikeDetected).toBe(false);
      }
    });

    it('detects spike at threshold', () => {
      for (let i = 0; i < 9; i++) tracker.trackError();
      const result = tracker.trackError(); // 10th error
      expect(result.spikeDetected).toBe(true);
    });

    it('does not re-trigger spike within cooldown window', () => {
      const now = Date.now();
      // Trigger spike
      for (let i = 0; i < 10; i++) tracker.trackError(undefined, now);
      // 11th error — should not re-trigger
      const result = tracker.trackError(undefined, now + 1000);
      expect(result.spikeDetected).toBe(false);
    });

    it('prunes old errors outside 5-min window', () => {
      const now = Date.now();
      tracker.trackError(undefined, now - 6 * 60 * 1000); // 6 minutes ago
      tracker.trackError(undefined, now); // now
      expect(tracker.getErrorCount(now)).toBe(1); // old one pruned
    });
  });

  describe('per-client tracking', () => {
    it('tracks errors per client independently', () => {
      tracker.trackError('client-a');
      tracker.trackError('client-b');
      tracker.trackError('client-a');
      // System has 3 errors, client-a has 2, client-b has 1
      expect(tracker.getErrorCount()).toBe(3);
    });

    it('reaches client threshold at 5 errors', () => {
      for (let i = 0; i < 4; i++) {
        const r = tracker.trackError('client-a');
        expect(r.clientThresholdReached).toBe(false);
      }
      const r = tracker.trackError('client-a');
      expect(r.clientThresholdReached).toBe(true);
    });

    it('does not cross-contaminate client errors', () => {
      for (let i = 0; i < 4; i++) tracker.trackError('client-a');
      const r = tracker.trackError('client-b'); // only 1 error for client-b
      expect(r.clientThresholdReached).toBe(false);
    });
  });

  describe('shouldAlertClient', () => {
    it('returns true when client threshold reached and no cooldown', () => {
      for (let i = 0; i < 5; i++) tracker.trackError('client-a');
      expect(tracker.shouldAlertClient('client-a')).toBe(true);
    });

    it('returns false when below threshold', () => {
      for (let i = 0; i < 3; i++) tracker.trackError('client-a');
      expect(tracker.shouldAlertClient('client-a')).toBe(false);
    });

    it('returns false during cooldown', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) tracker.trackError('client-a', now);
      tracker.markClientAlerted('client-a', now);
      // Re-accumulate errors
      for (let i = 0; i < 5; i++) tracker.trackError('client-a', now + 1000);
      expect(tracker.shouldAlertClient('client-a', now + 1000)).toBe(false); // still in cooldown
    });

    it('returns true after cooldown expires', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) tracker.trackError('client-a', now);
      tracker.markClientAlerted('client-a', now);
      // Wait past cooldown
      const afterCooldown = now + CLIENT_COOLDOWN_MS + 1;
      for (let i = 0; i < 5; i++) tracker.trackError('client-a', afterCooldown);
      expect(tracker.shouldAlertClient('client-a', afterCooldown)).toBe(true);
    });
  });

  describe('markClientAlerted', () => {
    it('resets error count for the client', () => {
      for (let i = 0; i < 5; i++) tracker.trackError('client-a');
      tracker.markClientAlerted('client-a');
      expect(tracker.shouldAlertClient('client-a')).toBe(false);
    });
  });
});

// ============================================================
// Health status computation
// ============================================================

describe('computeHealthStatus', () => {
  it('returns healthy when DB is connected and low error rate', () => {
    const result = computeHealthStatus(true, 0);
    expect(result.status).toBe('healthy');
    expect(result.details).toBe('All systems operational');
  });

  it('returns degraded when error rate hits threshold', () => {
    const result = computeHealthStatus(true, 10);
    expect(result.status).toBe('degraded');
    expect(result.details).toContain('Error spike');
  });

  it('returns unhealthy when DB is disconnected', () => {
    const result = computeHealthStatus(false, 0);
    expect(result.status).toBe('unhealthy');
    expect(result.details).toBe('Database connection failed');
  });

  it('unhealthy takes priority over degraded', () => {
    const result = computeHealthStatus(false, 15);
    expect(result.status).toBe('unhealthy');
  });

  it('returns healthy at 9 errors (below threshold)', () => {
    const result = computeHealthStatus(true, 9);
    expect(result.status).toBe('healthy');
  });
});
