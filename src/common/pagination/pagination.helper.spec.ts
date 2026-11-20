import { buildPaginatedEnvelope } from './pagination.helper';

describe('buildPaginatedEnvelope (issue #1157)', () => {
  it('handles an empty list correctly', () => {
    const result = buildPaginatedEnvelope([], 0, 1, 20);
    expect(result).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
    });
  });

  it('handles the first page of multi-page results', () => {
    const items = ['a', 'b'];
    const result = buildPaginatedEnvelope(items, 50, 1, 20);
    expect(result).toEqual({
      data: items,
      total: 50,
      page: 1,
      limit: 20,
      totalPages: 3,
      hasNextPage: true,
    });
  });

  it('handles an intermediate page', () => {
    const items = ['c', 'd'];
    const result = buildPaginatedEnvelope(items, 50, 2, 20);
    expect(result).toEqual({
      data: items,
      total: 50,
      page: 2,
      limit: 20,
      totalPages: 3,
      hasNextPage: true,
    });
  });

  it('handles the last page correctly', () => {
    const items = ['e'];
    const result = buildPaginatedEnvelope(items, 50, 3, 20);
    expect(result).toEqual({
      data: items,
      total: 50,
      page: 3,
      limit: 20,
      totalPages: 3,
      hasNextPage: false,
    });
  });

  it('handles pages past the last page', () => {
    const result = buildPaginatedEnvelope([], 50, 4, 20);
    expect(result).toEqual({
      data: [],
      total: 50,
      page: 4,
      limit: 20,
      totalPages: 3,
      hasNextPage: false,
    });
  });

  it('handles exact division of total by limit', () => {
    const result = buildPaginatedEnvelope(['x'], 20, 1, 20);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
  });
});
