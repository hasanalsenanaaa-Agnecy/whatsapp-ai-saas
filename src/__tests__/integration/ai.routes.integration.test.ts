import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../services/database.js', () => ({
  getClientById: vi.fn().mockResolvedValue({
    name: 'Demo Client',
    knowledge_base: JSON.stringify([
      { category: 'pricing', question: 'What is your price?', answer: 'Starts at 100' }
    ])
  }),
  updateClient: vi.fn().mockResolvedValue(true),
  updateLead: vi.fn().mockResolvedValue(true),
  createAIFeedback: vi.fn().mockResolvedValue('fb-123'),
  listAIFeedback: vi.fn().mockResolvedValue([])
}));

vi.mock('../../services/knowledge.js', () => ({
  generateKnowledgeResponse: vi.fn().mockResolvedValue({
    answer: 'Mock answer',
    confident: true,
    suggestHandover: false
  }),
  scoreLead: vi.fn().mockReturnValue('warm')
}));

vi.mock('../../services/ai.js', () => ({
  isAIAvailable: vi.fn().mockReturnValue(true)
}));

vi.mock('../../config.js', () => ({
  config: {
    anthropic: {
      model: 'claude-test-model'
    }
  }
}));

vi.mock('../../security/audit.js', () => ({
  logAudit: vi.fn().mockResolvedValue(true),
  extractAuditInfo: vi.fn().mockReturnValue({})
}));

vi.mock('../../security/rate-limiter.js', () => ({
  createRateLimitMiddleware: () => async () => true
}));

describe('AI Routes Integration', () => {
  let fastify: any;
  let registerAIRoutes: any;

  beforeAll(async () => {
    ({ registerAIRoutes } = await import('../../routes/ai.routes.js'));
    fastify = Fastify();

    fastify.decorate('authenticate', async (request: any) => {
      request.user = { clientId: 'client_1' };
    });

    await registerAIRoutes(fastify);
    await fastify.listen({ port: 0 });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return knowledge base', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/clients/client_1/knowledge'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.knowledgeBase.length).toBe(1);
  });

  it('should return AI status', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/clients/client_1/ai/status'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.available).toBe(true);
    expect(body.data.model).toBe('claude-test-model');
  });

  it('should update knowledge base', async () => {
    const response = await fastify.inject({
      method: 'PUT',
      url: '/api/clients/client_1/knowledge',
      headers: { 'content-type': 'application/json' },
      payload: {
        knowledgeBase: [
          { category: 'pricing', question: 'Q', answer: 'A' }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.updated).toBe(true);
  });

  it('should run AI chat', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/clients/client_1/ai/chat',
      headers: { 'content-type': 'application/json' },
      payload: {
        message: 'Hello',
        customerContext: { name: 'Fahad' },
        conversationHistory: []
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.answer).toBe('Mock answer');
  });

  it('should score lead', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/clients/client_1/ai/score-lead',
      headers: { 'content-type': 'application/json' },
      payload: {
        leadData: { budget: '200k' }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.score).toBe('warm');
  });

  it('should record AI feedback', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/clients/client_1/ai/feedback',
      headers: { 'content-type': 'application/json' },
      payload: {
        aiResponse: 'Test response',
        rating: 5,
        comment: 'Great'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('fb-123');
  });

  it('should list AI feedback', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/clients/client_1/ai/feedback?limit=10'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);
  });
});
