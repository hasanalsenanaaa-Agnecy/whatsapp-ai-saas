import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../services/database.js', () => ({
  listAutomationSequences: vi.fn().mockResolvedValue([
    {
      id: 'seq-1',
      name: 'Welcome',
      steps: [{ delayMinutes: 0, message: 'Hello {name}' }],
      isActive: true
    }
  ]),
  createAutomationSequence: vi.fn().mockResolvedValue('seq-1'),
  updateAutomationSequence: vi.fn().mockResolvedValue(true),
  deleteAutomationSequence: vi.fn().mockResolvedValue(true),
  enrollLeadInSequence: vi.fn().mockResolvedValue('enroll-1'),
  listAutomationEnrollments: vi.fn().mockResolvedValue([]),
  listDueEnrollments: vi.fn().mockResolvedValue([
    {
      id: 'enroll-1',
      sequence_id: 'seq-1',
      current_step: 0,
      lead_id: 1
    }
  ]),
  updateEnrollmentProgress: vi.fn().mockResolvedValue(true),
  getClientById: vi.fn().mockResolvedValue({
    access_token: 'token',
    phone_number_id: 'phone-id'
  }),
  getLeadById: vi.fn().mockResolvedValue({
    id: 1,
    phone: '+15555550124',
    name: 'Fahad'
  })
}));

vi.mock('../../services/whatsapp.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../security/audit.js', () => ({
  logAudit: vi.fn().mockResolvedValue(true),
  extractAuditInfo: vi.fn().mockReturnValue({})
}));

describe('Automation Routes Integration', () => {
  let fastify: any;
  let registerAutomationRoutes: any;

  beforeAll(async () => {
    ({ registerAutomationRoutes } = await import('../../routes/automation.routes.js'));
    fastify = Fastify();

    fastify.decorate('authenticate', async (request: any) => {
      request.user = { clientId: 'client_1' };
    });

    await registerAutomationRoutes(fastify);
    await fastify.listen({ port: 0 });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should list sequences', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/clients/client_1/automation/sequences'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBe(1);
  });

  it('should create sequence', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/clients/client_1/automation/sequences',
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'Welcome',
        steps: [{ delayMinutes: 0, message: 'Hello' }]
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.data.id).toBe('seq-1');
  });

  it('should enroll a lead', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/clients/client_1/automation/enroll',
      headers: { 'content-type': 'application/json' },
      payload: {
        leadId: 1,
        sequenceId: 'seq-1'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.data.id).toBe('enroll-1');
  });

  it('should run automation', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/clients/client_1/automation/run'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.processed).toBe(1);
  });
});
