import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { getClientByAPIKey } from './api-key.js';
import { logAudit } from './audit.js';

/**
 * Authenticate using JWT token
 * Header: Authorization: Bearer <token>
 */
export async function authenticateJWT(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({
      error: 'Unauthorized',
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired JWT token'
    });
  }
}

/**
 * Authenticate using API key
 * Header: x-api-key: <key>
 */
export async function authenticateAPIKey(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const apiKey = request.headers['x-api-key'] as string;

  if (!apiKey) {
    return reply.code(401).send({
      error: 'Unauthorized',
      code: 'MISSING_API_KEY',
      message: 'x-api-key header required'
    });
  }

  try {
    // Hash the provided key and look it up
    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');

    const client = await getClientByAPIKey(keyHash);

    if (!client) {
      return reply.code(401).send({
        error: 'Unauthorized',
        code: 'INVALID_API_KEY',
        message: 'Invalid API key'
      });
    }

    // Attach client info to request
    (request as any).clientId = client.id;
    (request as any).client = client;
  } catch (error) {
    reply.code(401).send({
      error: 'Unauthorized',
      code: 'AUTH_ERROR',
      message: 'Authentication failed'
    });
  }
}

/**
 * Allow either JWT or API key authentication
 */
export async function authenticateEither(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const token = request.headers.authorization?.split(' ')[1];
  const apiKey = request.headers['x-api-key'];

  if (!token && !apiKey) {
    return reply.code(401).send({
      error: 'Unauthorized',
      code: 'MISSING_CREDENTIALS',
      message: 'JWT token or API key required'
    });
  }

  if (token) {
    return authenticateJWT(request, reply);
  }

  if (apiKey) {
    return authenticateAPIKey(request, reply);
  }
}
