import { FastifyInstance } from 'fastify';
import { successResponse } from '../api/response.js';
import { AppError, ErrorCode } from '../security/error-handler.js';
import { logAudit, extractAuditInfo } from '../security/audit.js';
import { sendWhatsAppMessage } from '../services/whatsapp.js';
import {
  createAutomationSequence,
  listAutomationSequences,
  updateAutomationSequence,
  deleteAutomationSequence,
  enrollLeadInSequence,
  listAutomationEnrollments,
  listDueEnrollments,
  updateEnrollmentProgress,
  getClientById,
  getLeadById
} from '../services/database.js';
import {
  AutomationSequenceSchema,
  AutomationEnrollmentSchema
} from '../schemas/validation.js';

export async function registerAutomationRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/automation/sequences',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const sequences = await listAutomationSequences(clientId);
      return successResponse({ items: sequences }, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/automation/sequences',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any, reply: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = AutomationSequenceSchema.parse(request.body);
      const id = await createAutomationSequence({
        clientId,
        name: input.name,
        steps: input.steps,
        isActive: input.isActive
      });

      if (!id) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to create sequence');
      }

      await logAudit({
        clientId,
        action: 'automation_sequence_created',
        resourceType: 'automation_sequence',
        resourceId: id,
        status: 'success',
        ...extractAuditInfo(request)
      });

      reply.code(201);
      return successResponse({ id }, { requestId: request.id });
    }
  );

  fastify.put<{ Params: { clientId: string; sequenceId: string }; Body: any }>(
    '/api/clients/:clientId/automation/sequences/:sequenceId',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId, sequenceId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = AutomationSequenceSchema.partial().parse(request.body);
      const success = await updateAutomationSequence(sequenceId, {
        name: input.name,
        steps: input.steps,
        isActive: input.isActive
      });

      if (!success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to update sequence');
      }

      await logAudit({
        clientId,
        action: 'automation_sequence_updated',
        resourceType: 'automation_sequence',
        resourceId: sequenceId,
        status: 'success',
        ...extractAuditInfo(request)
      });

      return successResponse({ updated: true }, { requestId: request.id });
    }
  );

  fastify.delete<{ Params: { clientId: string; sequenceId: string } }>(
    '/api/clients/:clientId/automation/sequences/:sequenceId',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId, sequenceId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const success = await deleteAutomationSequence(sequenceId);
      if (!success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to delete sequence');
      }

      await logAudit({
        clientId,
        action: 'automation_sequence_deleted',
        resourceType: 'automation_sequence',
        resourceId: sequenceId,
        status: 'success',
        ...extractAuditInfo(request)
      });

      return successResponse({ deleted: true }, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string }; Body: any }>(
    '/api/clients/:clientId/automation/enroll',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any, reply: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const input = AutomationEnrollmentSchema.parse(request.body);
      const sequences = await listAutomationSequences(clientId);
      const sequence = sequences.find(item => item.id === input.sequenceId);

      if (!sequence) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Sequence not found');
      }

      const firstDelay = sequence.steps?.[0]?.delayMinutes ?? 0;
      const nextRunAt = new Date(Date.now() + firstDelay * 60 * 1000);

      const id = await enrollLeadInSequence({
        clientId,
        leadId: input.leadId,
        sequenceId: input.sequenceId,
        nextRunAt
      });

      if (!id) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to enroll lead');
      }

      await logAudit({
        clientId,
        action: 'automation_lead_enrolled',
        resourceType: 'automation_enrollment',
        resourceId: id,
        status: 'success',
        ...extractAuditInfo(request)
      });

      reply.code(201);
      return successResponse({ id }, { requestId: request.id });
    }
  );

  fastify.get<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/automation/enrollments',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const items = await listAutomationEnrollments(clientId);
      return successResponse({ items }, { requestId: request.id });
    }
  );

  fastify.post<{ Params: { clientId: string } }>(
    '/api/clients/:clientId/automation/run',
    { onRequest: [(fastify as any).authenticate] },
    async (request: any) => {
      const { clientId } = request.params;
      const user = request.user;

      if (user.clientId !== clientId) {
        throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
      }

      const due = await listDueEnrollments(clientId, 50);
      const sequences = await listAutomationSequences(clientId);
      const client = await getClientById(clientId);

      if (!client) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Client not found');
      }

      let processed = 0;

      for (const enrollment of due) {
        const sequence = sequences.find(item => item.id === enrollment.sequence_id);
        if (!sequence || !sequence.isActive) {
          await updateEnrollmentProgress({
            enrollmentId: enrollment.id,
            currentStep: enrollment.current_step,
            status: 'paused',
            nextRunAt: null
          });
          continue;
        }

        const steps = sequence.steps || [];
        const nextStepIndex = enrollment.current_step;
        const step = steps[nextStepIndex];

        if (!step) {
          await updateEnrollmentProgress({
            enrollmentId: enrollment.id,
            currentStep: enrollment.current_step,
            status: 'completed',
            nextRunAt: null
          });
          continue;
        }

        const lead = await getLeadById(clientId, enrollment.lead_id);
        if (!lead) {
          await updateEnrollmentProgress({
            enrollmentId: enrollment.id,
            currentStep: enrollment.current_step,
            status: 'failed',
            nextRunAt: null
          });
          continue;
        }

        const message = step.message.replace('{name}', lead.name || 'عميلنا');
        const sent = await sendWhatsAppMessage(
          lead.phone,
          message,
          client.access_token,
          client.phone_number_id
        );

        if (sent) {
          const nextIndex = nextStepIndex + 1;
          const nextStep = steps[nextIndex];
          await updateEnrollmentProgress({
            enrollmentId: enrollment.id,
            currentStep: nextIndex,
            status: nextStep ? 'active' : 'completed',
            nextRunAt: nextStep
              ? new Date(Date.now() + (nextStep.delayMinutes || 0) * 60 * 1000)
              : null
          });
          processed += 1;
        }
      }

      return successResponse({ processed }, { requestId: request.id });
    }
  );
}
