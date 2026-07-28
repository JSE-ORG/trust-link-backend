import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { LivenessResponseDto } from './common/dto/liveness-response.dto';
import {
  ReadinessResponseDto,
  ReadinessComponentHealthDto,
} from './common/dto/readiness-response.dto';

/** Builds the API contract shared by the Swagger UI and CI export. */
export function createOpenApiDocument(app: INestApplication) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('TrustLink API')
    .setDescription(
      'REST API for the TrustLink escrow backend. Auto-generated from DTO decorators.',
    )
    .setVersion('1.0')
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
