import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLead, deleteLead, getLeads, getClientStats, getLeadAnalytics, getAdvancedAnalytics, updateLead, createAnalyticsUpload, updateAnalyticsUpload, listAnalyticsUploads, getAnalyticsUpload } from '../services/database.js';
import { CreateLeadSchema, UpdateLeadSchema } from '../schemas/validation.js';
import { AppError, ErrorCode } from '../security/error-handler.js';
import { parsePagination, calculatePagination } from '../api/pagination.js';
import { buildFilterQuery, validateFilters, sanitizeSearch } from '../api/filters.js';
import { paginatedResponse, successResponse } from '../api/response.js';
import { setCacheValue, getCacheValue } from '../api/cache.js';
import { parseUpload, storeUploadFile } from '../services/analyticsUploads.js';
import { generateSimpleResponse, isAIAvailable } from '../services/ai.js';
import { logAudit, extractAuditInfo } from '../security/audit.js';

export async function registerClientRoutes(fastify: FastifyInstance) {
  const allowedUploadTypes = new Set([
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/json',
    'text/plain'
  ]);

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

  fastify.post<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/analytics/uploads',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const parts = (request as any).parts();
      let filePart: any = null;
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === 'file' && !filePart) {
          filePart = part;
        }
        if (part.type === 'field') {
          fields[part.fieldname] = part.value;
        }
      }

      if (!filePart) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'File is required');
      }

      const buffer = await filePart.toBuffer();
      const filename = filePart.filename || 'upload';
      const mimeType = filePart.mimetype || 'application/octet-stream';
      const dataType = fields.dataType?.toString() || null;
      const notes = fields.notes?.toString() || null;

      if (!allowedUploadTypes.has(mimeType)) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'Unsupported file type');
      }

      if (!buffer.length) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'File is empty');
      }

      let uploadId: string | null = null;

      try {
        const storageKey = await storeUploadFile(buffer, filename);
        const parsed = parseUpload(buffer, mimeType);

        uploadId = await createAnalyticsUpload({
          clientId,
          filename,
          mimeType,
          sizeBytes: buffer.length,
          status: 'ready',
          rowCount: parsed.rowCount,
          columns: parsed.columns,
          sampleRows: parsed.sampleRows,
          summary: parsed.summary,
          storageKey,
          dataType,
          notes
        });

        if (!uploadId) {
          throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to save upload');
        }

        await logAudit({
          clientId,
          action: 'analytics_upload_created',
          resourceType: 'analytics_upload',
          resourceId: uploadId,
          status: 'success',
          metadata: { filename, mimeType, sizeBytes: buffer.length, dataType, notes },
          ...extractAuditInfo(request)
        });

        reply.code(201);
        return successResponse({
          id: uploadId,
          filename,
          mimeType,
          rowCount: parsed.rowCount,
          columns: parsed.columns
        }, { requestId: request.id });
      } catch (error: any) {
        if (uploadId) {
          await updateAnalyticsUpload(uploadId, {
            status: 'failed',
            error: error?.message || 'Upload failed'
          });
        }

        throw new AppError(400, ErrorCode.INVALID_INPUT, error?.message || 'Upload failed');
      }
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/analytics/uploads',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const uploads = await listAnalyticsUploads(clientId);
      return successResponse(uploads, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string; uploadId: string } }>(
    '/api/clients/:clientId/analytics/uploads/:uploadId',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest) => {
      const { clientId, uploadId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const upload = await getAnalyticsUpload(clientId, uploadId);
      if (!upload) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Upload not found');
      }

      return successResponse(upload, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/analytics/suggestions',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest) => {
      const { clientId } = request.params;
      const user = (request as any).user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const uploadId = (request.body as any)?.uploadId as string | undefined;
      const upload = uploadId ? await getAnalyticsUpload(clientId, uploadId) : null;
      const analytics = await getAdvancedAnalytics(clientId);

      if (!upload && !analytics) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'No analytics data available');
      }

      if (!isAIAvailable()) {
        return successResponse({
          recommendations: [
            'قم بتتبع مصادر العملاء الأكثر تحويلًا وركّز الميزانية عليها.',
            'أنشئ حملات متابعة آلية للعملاء الجدد خلال أول 24 ساعة.',
            'حسّن الرسائل الترحيبية بناءً على الأسئلة المتكررة من العملاء.'
          ]
        }, { requestId: request.id });
      }

      const prompt = `You are an analytics advisor. Return ONLY JSON with schema {"recommendations":["string",...]}.\n\nIn-app analytics:\n${JSON.stringify(analytics, null, 2)}\n\nUploaded data summary:\n${JSON.stringify(upload?.summary || {}, null, 2)}\n\nUploaded metadata:\n${JSON.stringify({ dataType: upload?.dataType, notes: upload?.notes }, null, 2)}`;
      const aiResponse = await generateSimpleResponse(prompt, 'Return concise, actionable recommendations in Arabic.');

      let parsed: { recommendations: string[] } | null = null;
      try {
        const start = aiResponse.indexOf('{');
        const end = aiResponse.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          parsed = JSON.parse(aiResponse.slice(start, end + 1));
        }
      } catch {
        parsed = null;
      }

      const recommendations = parsed?.recommendations?.length
        ? parsed.recommendations
        : [aiResponse];

      if (uploadId) {
        await updateAnalyticsUpload(uploadId, { suggestions: recommendations });
      }

      await logAudit({
        clientId,
        action: 'analytics_ai_suggestions_generated',
        resourceType: 'analytics_upload',
        resourceId: uploadId || undefined,
        status: 'success',
        ...extractAuditInfo(request)
      });

      return successResponse({ recommendations }, { requestId: request.id });
    }
  );
}
