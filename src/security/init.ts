import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { registerHelmet } from './helmet-config.js';
import { registerCORS } from './cors-config.js';
import { registerJWT } from './auth.config.js';
import { registerErrorHandler, AppError, ErrorCode } from './error-handler.js';
import { initSecurityTables } from '../services/database-security.js';
import { validateSecurityConfig } from './config.js';

export async function initializeSecurity(fastify: FastifyInstance): Promise<void> {
  console.log('🔐 Initializing security...');

  // 1. Validate configuration
  validateSecurityConfig();
  console.log('✅ Configuration validated');

  // 2. Initialize database tables
  const tablesInitialized = await initSecurityTables();
  if (!tablesInitialized) {
    console.warn('⚠️  Security tables not initialized (database may not be available)');
  }

  // 3. Register security headers (Helmet)
  await registerHelmet(fastify);
  console.log('✅ Security headers configured');

  // 4. Register CORS
  await registerCORS(fastify);
  console.log('✅ CORS configured');

  // 5. Register JWT
  await registerJWT(fastify);
  console.log('✅ JWT configured');

  // 6. Register error handler
  await registerErrorHandler(fastify);
  console.log('✅ Error handler registered');

  // 7. Register authenticate decorator
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        throw new AppError(
          401,
          ErrorCode.INVALID_TOKEN,
          'Invalid or expired token'
        );
      }
    }
  );

  console.log('✅ Security initialized successfully');
}
