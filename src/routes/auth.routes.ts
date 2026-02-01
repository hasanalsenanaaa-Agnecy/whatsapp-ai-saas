import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { ClientLoginSchema, RegisterClientSchema } from '../schemas/validation.js';
import { generateToken } from '../security/auth.config.js';
import { createAPIKey, verifyClientAPIKey } from '../security/api-key.js';
import { generateResetToken, hashPassword, verifyPassword } from '../security/password.js';
import { logAudit, extractAuditInfo } from '../security/audit.js';
import { createClient, createPasswordResetToken, getClientByEmail, setClientPassword, consumePasswordResetToken } from '../services/database.js';
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
          email: input.email,
          phoneNumberId: null,
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
   * Login with client ID + API key
   * POST /auth/login
   */
  fastify.post<{ Body: any }>(
    '/auth/login',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const input = ClientLoginSchema.parse(request.body);

        const isValid = await verifyClientAPIKey(input.clientId, input.apiKey);
        if (!isValid) {
          await logAudit({
            clientId: input.clientId,
            action: 'client_login_failed',
            status: 'denied',
            ...extractAuditInfo(request)
          });
          throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid credentials');
        }

        const token = generateToken(fastify, input.clientId, 'admin');

        await logAudit({
          clientId: input.clientId,
          action: 'client_login_success',
          status: 'success',
          ...extractAuditInfo(request)
        });

        reply.send({
          success: true,
          token,
          clientId: input.clientId,
          role: 'admin'
        });
      } catch (error) {
        await logAudit({
          action: 'client_login_failed',
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          ...extractAuditInfo(request)
        });
        throw error;
      }
    }
  );

  /**
   * Login with email + password
   * POST /auth/login/password
   */
  fastify.post<{ Body: { email: string; password: string } }>(
    '/auth/login/password',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { email, password } = request.body;
        if (!email || !password) {
          throw new AppError(400, ErrorCode.INVALID_INPUT, 'Email and password are required');
        }

        const client = await getClientByEmail(email);
        if (!client || !client.password_hash) {
          throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid credentials');
        }

        const valid = verifyPassword(password, client.password_hash);
        if (!valid) {
          throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid credentials');
        }

        const token = generateToken(fastify, client.id, 'admin');

        await logAudit({
          clientId: client.id,
          action: 'client_login_password_success',
          status: 'success',
          ...extractAuditInfo(request)
        });

        reply.send({
          success: true,
          token,
          clientId: client.id,
          role: 'admin'
        });
      } catch (error) {
        await logAudit({
          action: 'client_login_password_failed',
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          ...extractAuditInfo(request)
        });
        throw error;
      }
    }
  );

  /**
   * Request password reset
   * POST /auth/password-reset/request
   */
  fastify.post<{ Body: { email: string } }>(
    '/auth/password-reset/request',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email } = request.body;
      if (!email) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'Email required');
      }

      const client = await getClientByEmail(email);
      if (!client) {
        return reply.send({ success: true, message: 'If the email exists, a reset link was sent.' });
      }

      const { token, hash } = generateResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await createPasswordResetToken(client.id, hash, expiresAt);

      await logAudit({
        clientId: client.id,
        action: 'password_reset_requested',
        status: 'success',
        ...extractAuditInfo(request)
      });

      const response: any = { success: true, message: 'Password reset token generated.' };
      if (process.env.NODE_ENV !== 'production') {
        response.resetToken = token;
      }

      reply.send(response);
    }
  );

  /**
   * Confirm password reset
   * POST /auth/password-reset/confirm
   */
  fastify.post<{ Body: { token: string; newPassword: string } }>(
    '/auth/password-reset/confirm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token, newPassword } = request.body;
      if (!token || !newPassword) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'Token and password required');
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const record = await consumePasswordResetToken(tokenHash);
      if (!record) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'Invalid or expired token');
      }

      const passwordHash = hashPassword(newPassword);
      const updated = await setClientPassword(record.clientId, passwordHash);
      if (!updated) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to update password');
      }

      await logAudit({
        clientId: record.clientId,
        action: 'password_reset_completed',
        status: 'success',
        ...extractAuditInfo(request)
      });

      reply.send({ success: true, message: 'Password updated successfully.' });
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
