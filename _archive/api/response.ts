/**
 * Standardized API Response Format
 * All endpoints return this format for consistency
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    timestamp: string;
    requestId: string;
    version: string;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Create success response
 */
export function successResponse<T>(
  data: T,
  meta?: { requestId: string }
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: meta?.requestId || 'unknown',
      version: '4.0.0'
    }
  };
}

/**
 * Create paginated response
 */
export function paginatedResponse<T>(
  data: T[],
  pagination: { page: number; limit: number; total: number },
  meta?: { requestId: string }
): ApiResponse<T[]> {
  const pages = Math.ceil(pagination.total / pagination.limit);
  const page = pagination.page;

  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: meta?.requestId || 'unknown',
      version: '4.0.0'
    },
    pagination: {
      page,
      limit: pagination.limit,
      total: pagination.total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1
    }
  };
}

/**
 * Create error response
 */
export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, any>,
  meta?: { requestId: string }
): ApiResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: meta?.requestId || 'unknown',
      version: '4.0.0'
    }
  };
}
