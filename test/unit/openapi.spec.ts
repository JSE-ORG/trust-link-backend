import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { setupOpenApiUi } from '../../src/openapi';

jest.mock('@nestjs/swagger', () => {
  const actual = jest.requireActual('@nestjs/swagger');
  return {
    ...actual,
    SwaggerModule: { ...actual.SwaggerModule, setup: jest.fn() },
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
