import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../services/database.js', () => ({
  createLead: vi.fn(),
  deleteLead: vi.fn(),
  getLeads: vi.fn().mockResolvedValue([]),
  getClientStats: vi.fn().mockResolvedValue({}),
  getLeadAnalytics: vi.fn().mockResolvedValue({}),
  getAdvancedAnalytics: vi.fn().mockResolvedValue({
    attribution: [{ source: 'whatsapp', count: 10 }],
    funnel: { total: 10, new: 5, contacted: 3, converted: 1, lost: 1 },
    aiImpact: {
      feedbackCount: 2,
      avgRating: 4.5,
      positiveRate: 100,
      positive: 2,
      neutral: 0,
      negative: 0,
      leadsWithFeedback: 1
    }
  }),
  updateLead: vi.fn().mockResolvedValue(true)
}));

describe('Advanced Analytics Integration', () => {
  let fastify: any;
  let registerClientRoutes: any;

  beforeAll(async () => {
    ({ registerClientRoutes } = await import('../../routes/clients.routes.js'));
    fastify = Fastify();

    fastify.decorate('authenticate', async (request: any) => {
      request.user = { clientId: 'client_1' };
    });

    await registerClientRoutes(fastify);
    await fastify.listen({ port: 0 });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return advanced analytics', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/clients/client_1/analytics/advanced'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.funnel.total).toBe(10);
    expect(body.data.attribution[0].source).toBe('whatsapp');
  });
});
