import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument, setupOpenApiUi } from '../../src/openapi';

jest.mock('@nestjs/swagger', () => {
  const actual = jest.requireActual('@nestjs/swagger');
  return {
    ...actual,
    SwaggerModule: {
      ...actual.SwaggerModule,
      setup: jest.fn(),
      createDocument: jest.fn(),
    },
  };
});

describe('setupOpenApiUi', () => {
  const app = {} as INestApplication;
  const document = {
    openapi: '3.0.0',
    paths: {},
    info: { title: '', version: '' },
  } as Parameters<typeof setupOpenApiUi>[1];

  beforeEach(() => jest.clearAllMocks());

  it('serves /api/docs outside production', () => {
    setupOpenApiUi(app, document, false);
    expect(SwaggerModule.setup).toHaveBeenCalledWith('api/docs', app, document);
  });

  it('does not register /api/docs in production', () => {
    setupOpenApiUi(app, document, true);
    expect(SwaggerModule.setup).not.toHaveBeenCalled();
  });
});

describe('createOpenApiDocument', () => {
  const app = {} as INestApplication;

  beforeEach(() => jest.clearAllMocks());

  it('builds the shared contract and adds the standard error response', () => {
    const document = { openapi: '3.0.0', paths: {} };
    (SwaggerModule.createDocument as jest.Mock).mockReturnValue(document);

    const result = createOpenApiDocument(app);

    expect(result).toBe(document);
    expect(SwaggerModule.createDocument).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        info: expect.objectContaining({
          title: 'TrustLink API',
          version: '1.0',
        }),
      }),
      expect.objectContaining({
        extraModels: expect.arrayContaining([expect.any(Function)]),
      }),
    );
    expect(result.components?.responses?.StandardError).toEqual({
      description: 'Standard error response',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponseDto' },
        },
      },
    });
  });

  it('preserves existing response definitions while adding StandardError', () => {
    const document = {
      openapi: '3.0.0',
      paths: {},
      components: { responses: { Existing: { description: 'existing' } } },
    };
    (SwaggerModule.createDocument as jest.Mock).mockReturnValue(document);

    const result = createOpenApiDocument(app);

    expect(result.components?.responses?.Existing).toEqual({
      description: 'existing',
    });
    expect(result.components?.responses?.StandardError).toBeDefined();
  });
});
