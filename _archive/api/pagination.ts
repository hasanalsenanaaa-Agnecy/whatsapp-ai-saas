/**
 * Pagination utilities
 */

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Parse pagination parameters from query
 */
export function parsePagination(query: any): PaginationParams {
  let page = parseInt(query.page || '1', 10);
  let limit = parseInt(query.limit || '20', 10);

  // Validation
  if (page < 1) page = 1;
  if (limit < 1) limit = 20;
  if (limit > 500) limit = 500; // Max 500 per request

  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Calculate pagination metadata
 */
export function calculatePagination(
  page: number,
  limit: number,
  total: number
): PaginationMeta {
  const pages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1
  };
}

/**
 * Validate pagination params
 */
export function validatePagination(page: number, limit: number): boolean {
  return page >= 1 && limit >= 1 && limit <= 500;
}
