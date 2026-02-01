import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLead, deleteLead, getLeads, getClientStats, getLeadAnalytics, getAdvancedAnalytics, updateLead } from '../services/database.js';
import { CreateLeadSchema, UpdateLeadSchema } from '../schemas/validation.js';
import { AppError, ErrorCode } from '../security/error-handler.js';
import { parsePagination, calculatePagination } from '../api/pagination.js';
import { buildFilterQuery, validateFilters, sanitizeSearch } from '../api/filters.js';
import { paginatedResponse, successResponse } from '../api/response.js';
import { setCacheValue, getCacheValue } from '../api/cache.js';

export async function registerClientRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { clientId: string }; Querystring: any }>(
    '/api/clients/:clientId/leads',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const { page, limit, offset } = parsePagination(request.query);
      const filterValidation = validateFilters(request.query);
      
      if (!filterValidation.valid) {
        throw new AppError(
          400,
          ErrorCode.INVALID_INPUT,
          'Invalid filter parameters',
          { errors: filterValidation.errors }
        );
      }

      const leads = await getLeads(clientId, limit);
      let filtered = leads;

      if (request.query.status) {
        filtered = filtered.filter(l => l.status === request.query.status);
      }
      if (request.query.score) {
        filtered = filtered.filter(l => l.score === request.query.score);
      }
      if (request.query.search) {
        const search = sanitizeSearch(request.query.search).toLowerCase();
        filtered = filtered.filter(
          l =>
            l.name.toLowerCase().includes(search) ||
            l.phone.includes(search)
        );
      }

      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);
      const pagination = calculatePagination(page, limit, total);

      return paginatedResponse(paginated, pagination, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/leads',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = CreateLeadSchema.parse(request.body);
      const id = await createLead({
        clientId,
        phone: input.phone,
        name: input.name,
        email: input.email,
        data: input.data || {},
        score: 'warm'
      });

      if (!id) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to create lead');
      }

      reply.code(201);
      return successResponse({ id, ...input, status: 'new', score: 'warm' }, { requestId: request.id });
    }
  );

  fastify.put<{ Params: { clientId: string; id: string }; Body: any }>(
    '/api/clients/:clientId/leads/:id',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId, id } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = UpdateLeadSchema.parse(request.body);
      const success = await updateLead(parseInt(id), {
        name: input.name,
        phone: input.phone,
        email: input.email,
        status: input.status,
        score: input.score,
        notes: input.notes,
        data: input.data
      });

      if (!success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to update lead');
      }

      return successResponse({ id: parseInt(id), ...input }, { requestId: request.id });
    }
  );

  fastify.delete<{ Params: { clientId: string; id: string } }>(
    '/api/clients/:clientId/leads/:id',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId, id } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const success = await deleteLead(parseInt(id));
      if (!success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to delete lead');
      }

      return successResponse({ id: parseInt(id) }, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string; id: string } }>(
    '/api/clients/:clientId/leads/:id',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId, id } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const leads = await getLeads(clientId);
      const lead = leads.find(l => l.id === parseInt(id));

      if (!lead) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Lead not found');
      }

      return successResponse(lead, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/dashboard',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const stats = await getClientStats(clientId);
      return successResponse(stats, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/summary',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const stats = await getClientStats(clientId);
      const summary = {
        totalLeads: stats.totalLeads,
        todayLeads: stats.todayLeads,
        conversionRate: stats.conversionRate,
        hotLeads: stats.hotLeads
      };

      return successResponse(summary, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/analytics',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const analytics = await getLeadAnalytics(clientId);
      return successResponse(analytics, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/analytics/advanced',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const analytics = await getAdvancedAnalytics(clientId);
      return successResponse(analytics, { requestId: request.id });
    }
  );
}
