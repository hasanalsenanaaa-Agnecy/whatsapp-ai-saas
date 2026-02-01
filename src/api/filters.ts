/**
 * Advanced filtering and search
 */

export interface FilterOptions {
  search?: string;
  status?: string;
  score?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [key: string]: any;
}

export interface FilterQuery {
  where: Record<string, any>;
  orderBy: Record<string, 'asc' | 'desc'>;
  search?: string;
}

/**
 * Build filter query for database
 */
export function buildFilterQuery(filters: FilterOptions): FilterQuery {
  const where: Record<string, any> = {};
  const orderBy: Record<string, 'asc' | 'desc'> = {};

  // Status filter
  if (filters.status) {
    where.status = filters.status;
  }

  // Score filter (hot, warm, cold)
  if (filters.score) {
    where.score = filters.score;
  }

  // Date range filter
  if (filters.dateFrom || filters.dateTo) {
    where.created_at = {};
    if (filters.dateFrom) {
      where.created_at.$gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.created_at.$lte = new Date(filters.dateTo);
    }
  }

  // Sorting
  const sortBy = filters.sortBy || 'created_at';
  const sortOrder = filters.sortOrder || 'desc';
  orderBy[sortBy] = sortOrder;

  return {
    where,
    orderBy,
    search: filters.search
  };
}

/**
 * Validate filter values
 */
export function validateFilters(filters: FilterOptions): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate status
  if (filters.status && !['new', 'contacted', 'converted', 'lost'].includes(filters.status)) {
    errors.push('Invalid status value');
  }

  // Validate score
  if (filters.score && !['hot', 'warm', 'cold'].includes(filters.score)) {
    errors.push('Invalid score value');
  }

  // Validate dates
  if (filters.dateFrom && isNaN(Date.parse(filters.dateFrom))) {
    errors.push('Invalid dateFrom format');
  }
  if (filters.dateTo && isNaN(Date.parse(filters.dateTo))) {
    errors.push('Invalid dateTo format');
  }

  // Validate sort order
  if (filters.sortOrder && !['asc', 'desc'].includes(filters.sortOrder)) {
    errors.push('Invalid sortOrder value (must be asc or desc)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize search query
 */
export function sanitizeSearch(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  return query
    .trim()
    .substring(0, 100)
    .replace(/[%_\\]/g, '\\$&') // Escape SQL wildcards
    .replace(/[^\w\s\-@.]/g, ''); // Remove special characters
}
