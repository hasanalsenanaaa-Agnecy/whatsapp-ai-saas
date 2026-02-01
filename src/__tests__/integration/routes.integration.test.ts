import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { successResponse } from '../../api/response';

describe('API Routes Integration', () => {
  let fastify: any;

  beforeAll(async () => {
    fastify = Fastify();

    fastify.get('/test', async (req: any) => {
      return successResponse({ message: 'test' }, { requestId: req.id });
    });

    await fastify.listen({ port: 0 });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return standardized response format', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/test'
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
    expect(body.meta.timestamp).toBeDefined();
    expect(body.meta.version).toBe('4.0.0');
  });
});
