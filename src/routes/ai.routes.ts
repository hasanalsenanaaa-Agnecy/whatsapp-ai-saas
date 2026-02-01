import { FastifyInstance } from 'fastify';
import { successResponse } from '../api/response.js';
import { AppError, ErrorCode } from '../security/error-handler.js';
import { logAudit, extractAuditInfo } from '../security/audit.js';
import { getClientById, updateClient, updateLead, createAIFeedback, listAIFeedback } from '../services/database.js';
import { generateKnowledgeResponse, scoreLead } from '../services/knowledge.js';
import { generateLeadScore, isAIAvailable } from '../services/ai.js';
import { config } from '../config.js';
import {
  AIChatSchema,
  AIFeedbackSchema,
  AIScoreLeadSchema,
  KnowledgeBaseUpdateSchema
} from '../schemas/validation.js';

export async function registerAIRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/knowledge',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const client = await getClientById(clientId);
      if (!client) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Client not found');
      }

      const knowledgeBase = typeof client.knowledge_base === 'string'
        ? JSON.parse(client.knowledge_base)
        : (client.knowledge_base || []);

      return successResponse({ knowledgeBase }, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/ai/status',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      return successResponse({
        available: isAIAvailable(),
        model: config.anthropic.model
      }, { requestId: request.id });
    }
  );

  fastify.put<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/knowledge',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = KnowledgeBaseUpdateSchema.parse(request.body);
      const success = await updateClient(clientId, { knowledgeBase: input.knowledgeBase });

      if (!success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to update knowledge base');
      }

      await logAudit({
        clientId,
        action: 'knowledge_base_updated',
        resourceType: 'knowledge_base',
        status: 'success',
        changes: { count: input.knowledgeBase.length },
        ...extractAuditInfo(request)
      });

      return successResponse({ updated: true }, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/ai/chat',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = AIChatSchema.parse(request.body);
      const client = await getClientById(clientId);

      if (!client) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Client not found');
      }

      const knowledgeBase = typeof client.knowledge_base === 'string'
        ? JSON.parse(client.knowledge_base)
        : (client.knowledge_base || []);

      const result = await generateKnowledgeResponse(
        client.name,
        knowledgeBase,
        input.customerContext || {},
        input.conversationHistory || [],
        input.message
      );

      return successResponse(result, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/ai/score-lead',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = AIScoreLeadSchema.parse(request.body);
      const data = input.leadData || {};

      let scoreResult: { score: 'hot' | 'warm' | 'cold'; rationale?: string };

      if (isAIAvailable()) {
        try {
          scoreResult = await generateLeadScore(data);
        } catch (error) {
          scoreResult = { score: scoreLead(data), rationale: 'fallback_rule_based' };
        }
      } else {
        scoreResult = { score: scoreLead(data), rationale: 'rule_based' };
      }

      if (input.leadId) {
        await updateLead(input.leadId, { score: scoreResult.score });
      }

      return successResponse({
        score: scoreResult.score,
        rationale: scoreResult.rationale || '',
        leadId: input.leadId || null
      }, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/ai/feedback',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any, reply: any) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = AIFeedbackSchema.parse(request.body);
      const id = await createAIFeedback({
        clientId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        userMessage: input.userMessage,
        aiResponse: input.aiResponse,
        rating: input.rating,
        comment: input.comment
      });

      if (!id) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to store feedback');
      }

      await logAudit({
        clientId,
        action: 'ai_feedback_recorded',
        resourceType: 'ai_feedback',
        resourceId: id,
        status: 'success',
        ...extractAuditInfo(request)
      });

      reply.code(201);
      return successResponse({ id }, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string }; Querystring: { limit?: string } }>(
    '/api/clients/:clientId/ai/feedback',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const limit = request.query?.limit ? parseInt(request.query.limit, 10) : 50;
      const feedback = await listAIFeedback(clientId, Number.isNaN(limit) ? 50 : limit);

      return successResponse({ items: feedback }, { requestId: request.id });
    }
  );
}
