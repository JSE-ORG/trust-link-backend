/**
 * Shared envelope for paginated responses (issue #1157).
 */
export interface PaginatedEnvelope<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}

/**
 * Builds a standardized paginated envelope including totalPages and hasNextPage.
 *
 * @param data - Array of records for the current page
 * @param total - Total count of records matching query filters
 * @param page - 1-based page number
 * @param limit - Page size limit
 */
export function buildPaginatedEnvelope<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedEnvelope<T> {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.ceil(Math.max(0, total) / safeLimit);
  const hasNextPage = page < totalPages;

  return {
    data,
    total,
    page,
    limit,
    totalPages,
    hasNextPage,
  };
}
