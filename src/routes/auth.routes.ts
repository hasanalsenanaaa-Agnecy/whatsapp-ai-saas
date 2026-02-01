import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RegisterClientSchema } from '../schemas/validation.js';
import { generateToken } from '../security/auth.config.js';
import { createAPIKey } from '../security/api-key.js';
import { logAudit, extractAuditInfo } from '../security/audit.js';
import { createClient } from '../services/database.js';
import { AppError, ErrorCode } from '../security/error-handler.js';

export async function registerAuthRoutes(fastify: FastifyInstance) {
  /**
   * Register new client
   * POST /auth/register
   */
  fastify.post<{ Body: any }>(
    '/auth/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const input = RegisterClientSchema.parse(request.body);

        const clientId = `client_${Date.now()}`;
        const success = await createClient({
          id: clientId,
          name: input.name,
          industry: input.industry,
          phoneNumberId: '',
          accessToken: '',
          verifyToken: '',
          agentPhones: input.agentPhones
        });

        if (!success) {
          throw new AppError(
            500,
            ErrorCode.INTERNAL_ERROR,
            'Failed to create client'
          );
        }

        const apiKeyResult = await createAPIKey(clientId, 'Initial Key');
        if (!apiKeyResult) {
          throw new AppError(
            500,
            ErrorCode.INTERNAL_ERROR,
            'Failed to generate API key'
          );
        }

        const token = generateToken(fastify, clientId, 'admin');

        await logAudit({
          clientId,
          action: 'client_registered',
          resourceType: 'client',
          resourceId: clientId,
          status: 'success',
          ...extractAuditInfo(request)
        });

        reply.code(201).send({
          success: true,
          clientId,
          token,
          apiKey: apiKeyResult.key,
          message: 'Client registered successfully. Save your API key!'
        });
      } catch (error) {
        await logAudit({
          action: 'client_registration_failed',
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          ...extractAuditInfo(request)
        });

        throw error;
      }
    }
  );

  /**
   * Refresh token
   * POST /auth/refresh
   */
  fastify.post<{ Headers: any }>(
    '/auth/refresh',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const newToken = generateToken(fastify, user.clientId, user.role);

      reply.send({
        success: true,
        token: newToken,
        expiresIn: '7d'
      });
    }
  );
}
