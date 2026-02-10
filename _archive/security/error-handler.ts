import { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { logAudit } from './audit.js';

export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  INVALID_API_KEY = 'INVALID_API_KEY',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: ErrorCode,
    public message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Format error response
 */
export function formatErrorResponse(
  error: unknown,
  requestId: string
): Record<string, any> {
  if (error instanceof AppError) {
    return {
      error: error.code,
      message: error.message,
      details: error.details,
      requestId,
      timestamp: new Date().toISOString()
    };
  }

  if (error instanceof ZodError) {
    return {
      error: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code
      })),
      requestId,
      timestamp: new Date().toISOString()
    };
  }

  return {
    error: ErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    requestId,
    timestamp: new Date().toISOString()
  };
}

/**
 * Fastify error handler plugin
 */
export async function registerErrorHandler(fastify: any) {
  fastify.setErrorHandler(
    async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;
      const clientId = (request as any).clientId;

      let statusCode = 500;
      let errorResponse: Record<string, any>;

      if (error instanceof AppError) {
        statusCode = error.statusCode;
        errorResponse = formatErrorResponse(error, requestId);

        if (error.statusCode === 401 || error.statusCode === 403) {
          await logAudit({
            clientId,
            action: 'security_error',
            status: 'denied',
            errorMessage: error.message,
            ipAddress: request.ip
          });
        }
      } else if (error instanceof ZodError) {
        statusCode = 400;
        errorResponse = formatErrorResponse(error, requestId);
      } else {
        statusCode = 500;
        errorResponse = formatErrorResponse(error, requestId);

        console.error('❌ Unexpected error:', {
          requestId,
          error: error.message,
          stack: error.stack
        });
      }

      reply.code(statusCode).send(errorResponse);
    }
  );
}
