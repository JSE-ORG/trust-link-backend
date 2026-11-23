import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_DOCS_PATH } from './app.service';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { LivenessResponseDto } from './common/dto/liveness-response.dto';
import {
  ReadinessResponseDto,
  ReadinessComponentHealthDto,
} from './common/dto/readiness-response.dto';
import { getAppVersion } from './common/version';

export function setupOpenApiUi(
  app: INestApplication,
  document: ReturnType<typeof createOpenApiDocument>,
  isProduction: boolean,
): void {
  if (!isProduction) {
    SwaggerModule.setup(API_DOCS_PATH.slice(1), app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        filter: true,
        displayRequestDuration: true,
      },
    });
  }
}

/** Builds the API contract shared by the Swagger UI and CI export. */
export function createOpenApiDocument(app: INestApplication) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('TrustLink API')
    .setDescription(
      'REST API for the TrustLink escrow backend. Auto-generated from DTO decorators.',
    )
    .setVersion(getAppVersion())
    .addTag('Admin', 'Administrative and operational management endpoints.')
    .addTag(
      'Auth',
      'Authentication and SEP-10 challenge verification endpoints.',
    )
    .addTag(
      'Buyer',
      'Buyer operations and escrow purchase management endpoints.',
    )
    .addTag(
      'Escrow',
      'Escrow lifecycle, funding, shipping, and settlement endpoints.',
    )
    .addTag('Health', 'Service health and liveness checks.')
    .addTag(
      'Stress Test',
      'Load generation and system performance evaluation endpoints.',
    )
    .addTag(
      'Vendor',
      'Vendor management, escrow orders, and analytics endpoints.',
    )
    .addTag('Webhooks', 'Webhook event notifications and management.')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    extraModels: [
      ErrorResponseDto,
      LivenessResponseDto,
      ReadinessResponseDto,
      ReadinessComponentHealthDto,
    ],
  });
  document.components ??= {};
  document.components.responses ??= {};
  document.components.responses.StandardError = {
    description: 'Standard error response',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponseDto' },
      },
    },
  };

  return document;
}
