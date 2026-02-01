import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

export async function registerCORS(fastify: FastifyInstance) {
  // Check if CORS is already registered
  if (fastify.hasDecorator('corsPreflightEnabled')) {
    console.log('⚠️  CORS already registered, skipping');
    return;
  }

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

  await fastify.register(cors, {
    origin: allowedOrigins.map(origin => origin.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
  });
}
