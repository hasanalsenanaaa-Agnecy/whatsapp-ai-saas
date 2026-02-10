import { FastifyRequest, FastifyReply } from 'fastify';
import { sql } from '../services/database.js';
import { AppError, ErrorCode } from './error-handler.js';

interface RateLimitConfig {
  window: number; // milliseconds
  max: number;
}

const defaultConfig: RateLimitConfig = {
  window: 60 * 1000, // 1 minute
  max: 100
};

const endpointLimits: Record<string, RateLimitConfig> = {
  '/auth/register': { window: 60 * 60 * 1000, max: 3 }, // 3 per hour
  '/auth/login': { window: 5 * 60 * 1000, max: 5 }, // 5 per 5 minutes
  '/webhook/whatsapp': { window: 60 * 1000, max: 1000 }, // 1000 per minute
  '/api/clients/:clientId/ai/chat': { window: 60 * 1000, max: 30 },
  '/api/clients/:clientId/ai/score-lead': { window: 60 * 1000, max: 60 },
  '/api/clients/:clientId/ai/feedback': { window: 60 * 1000, max: 60 }
};

/**
 * Check rate limit for a client
 */
export async function checkRateLimit(
  clientId: string,
  endpoint: string,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (!sql) {
    return true; // Skip rate limiting if no database
  }

  try {
    const config = endpointLimits[endpoint] || defaultConfig;
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.window);

    // Get or create rate limit entry
    const existing = await sql`
      SELECT * FROM rate_limit_tracker
      WHERE client_id = ${clientId}
      AND endpoint = ${endpoint}
      AND window_start > ${windowStart}
      LIMIT 1
    `;

    if (existing.length > 0) {
      const entry = existing[0];
      if (entry.request_count >= config.max) {
        // Rate limit exceeded
        reply.code(429).send({
          error: ErrorCode.RATE_LIMITED,
          message: 'Too many requests',
          retryAfter: Math.ceil(
            (entry.window_start.getTime() + config.window - now.getTime()) / 1000
          )
        });
        return false;
      }

      // Increment counter
      await sql`
        UPDATE rate_limit_tracker
        SET request_count = request_count + 1
        WHERE id = ${entry.id}
      `;
    } else {
      // Create new entry
      await sql`
        INSERT INTO rate_limit_tracker (client_id, endpoint, request_count, window_start, window_end)
        VALUES (${clientId}, ${endpoint}, 1, ${now}, ${new Date(now.getTime() + config.window)})
      `;
    }

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', config.max);
    reply.header('X-RateLimit-Remaining', config.max - 1);
    reply.header('X-RateLimit-Reset', new Date(now.getTime() + config.window).toISOString());

    return true;
  } catch (error) {
    console.error('❌ Rate limit check error:', error);
    return true; // Allow on error
  }
}

/**
 * Create rate limit middleware
 */
export function createRateLimitMiddleware(endpoint: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const clientId = (request as any).clientId || 'anonymous';
    const allowed = await checkRateLimit(clientId, endpoint, request, reply);
    if (!allowed) {
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        'Too many requests. Please try again later.'
      );
    }
  };
}
