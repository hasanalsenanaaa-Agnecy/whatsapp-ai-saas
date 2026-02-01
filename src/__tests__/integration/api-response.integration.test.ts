import { describe, it, expect } from 'vitest';
import { successResponse, paginatedResponse } from '../../api/response';

describe('API Response Integration', () => {
  it('should handle complex nested objects', () => {
    const complexData = {
      user: {
        id: 1,
        profile: {
          name: 'John',
          contacts: [
            { type: 'email', value: 'john@example.com' },
            { type: 'phone', value: '+1234567890' }
          ]
        }
      }
    };

    const response = successResponse(complexData, { requestId: 'req-123' });

    expect(response.data).toEqual(complexData);
    expect(response.data.user.profile.contacts).toHaveLength(2);
  });

  it('should handle large datasets in pagination', () => {
    const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`
    }));

    const response = paginatedResponse(
      largeDataset.slice(0, 20),
      { page: 1, limit: 20, total: 1000 },
      { requestId: 'req-123' }
    );

    expect(response.pagination?.pages).toBe(50);
    expect(response.data).toHaveLength(20);
  });

  it('should preserve data types through response serialization', () => {
    const data = {
      string: 'value',
      number: 123,
      boolean: true,
      date: new Date('2026-02-01'),
      null: null,
      array: [1, 2, 3]
    };

    const response = successResponse(data, { requestId: 'req-123' });

    expect(typeof response.data.string).toBe('string');
    expect(typeof response.data.number).toBe('number');
    expect(typeof response.data.boolean).toBe('boolean');
    expect(Array.isArray(response.data.array)).toBe(true);
  });
});
