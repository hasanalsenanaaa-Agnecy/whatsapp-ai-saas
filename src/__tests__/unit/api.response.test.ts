import { describe, it, expect } from 'vitest';
import { successResponse, paginatedResponse, errorResponse } from '../../api/response';

describe('API Response Utilities', () => {
  it('should create success response', () => {
    const data = { id: 1, name: 'Test' };
    const response = successResponse(data, { requestId: 'req-123' });

    expect(response.success).toBe(true);
    expect(response.data).toEqual(data);
    expect(response.meta?.requestId).toBe('req-123');
    expect(response.meta?.version).toBe('4.0.0');
    expect(response.meta?.timestamp).toBeDefined();
  });

  it('should create paginated response', () => {
    const data = [{ id: 1 }, { id: 2 }];
    const response = paginatedResponse(
      data,
      { page: 1, limit: 20, total: 100 },
      { requestId: 'req-123' }
    );

    expect(response.success).toBe(true);
    expect(response.data).toEqual(data);
    expect(response.pagination?.page).toBe(1);
    expect(response.pagination?.total).toBe(100);
    expect(response.pagination?.pages).toBe(5);
    expect(response.pagination?.hasNext).toBe(true);
    expect(response.pagination?.hasPrev).toBe(false);
  });

  it('should create error response', () => {
    const response = errorResponse(
      'INVALID_INPUT',
      'Invalid parameter',
      { field: 'email' },
      { requestId: 'req-123' }
    );

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('INVALID_INPUT');
    expect(response.error?.message).toBe('Invalid parameter');
    expect(response.error?.details?.field).toBe('email');
  });

  it('should calculate correct pagination for last page', () => {
    const response = paginatedResponse(
      [{ id: 1 }],
      { page: 5, limit: 20, total: 100 },
      { requestId: 'req-123' }
    );

    expect(response.pagination?.pages).toBe(5);
    expect(response.pagination?.hasNext).toBe(false);
    expect(response.pagination?.hasPrev).toBe(true);
  });
});
