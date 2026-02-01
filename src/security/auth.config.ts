import jwt from '@fastify/jwt';
import { FastifyInstance } from 'fastify';

export interface JWTPayload {
  clientId: string;
  role: 'admin' | 'user' | 'agent';
  exp?: number;
}

export async function registerJWT(fastify: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  await fastify.register(jwt, {
    secret,
    sign: {
      expiresIn: '7d'
    }
  });
}

export function generateToken(
  fastify: FastifyInstance,
  clientId: string,
  role: 'admin' | 'user' | 'agent' = 'user'
): string {
  return fastify.jwt.sign(
    { clientId, role } as JWTPayload,
    { expiresIn: '7d' }
  );
}
