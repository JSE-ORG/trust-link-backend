import './tracing/tracing.bootstrap';
import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { JsonLoggerService } from './common/logger/json-logger.service';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { SanitizationPipe } from './common/pipes/sanitization.pipe';
import { SentryInterceptor } from './common/interceptors/sentry.interceptor';
import { buildCspConnectSrc } from './common/security/csp.config';

const bootstrapLogger = new JsonLoggerService('Bootstrap');

async function bootstrap(): Promise<void> {
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      release: process.env.GIT_SHA,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    });
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const jsonLogger = app.get(JsonLoggerService);
  app.useLogger(jsonLogger);

  const configService = app.get(ConfigService);
  const connectSrc = buildCspConnectSrc({
    stellarNetwork: configService.get('STELLAR_NETWORK'),
    stellarHorizonUrl: configService.get<string | undefined>(
      'STELLAR_HORIZON_URL',
    ),
    sentryDsn,
    otelExporterOtlpEndpoint: configService.get<string | undefined>(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ),
    logisticsApiBaseUrl: configService.get<string | undefined>(
      'LOGISTICS_API_BASE_URL',
    ),
    extraConnectSrc: configService.get<string | undefined>('CSP_CONNECT_SRC'),
  });

  // ── Body parsing ──────────────────────────────────────────────────────────
  // Webhook HMAC verification must hash the exact bytes received on the wire.
  // Capture those bytes before JSON parsing mutates whitespace or key order.
  app.use(
    '/webhooks/stellar',
    express.raw({ type: 'application/json' }),
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const request = req as express.Request & { rawBody?: Buffer };
      if (Buffer.isBuffer(request.body)) {
        request.rawBody = Buffer.from(request.body);
        try {
          request.body = JSON.parse(
            request.rawBody.toString('utf8'),
          ) as unknown;
        } catch {
          request.body = undefined;
        }
      }
      next();
    },
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── HTTP security headers (issue #84) ─────────────────────────────────────
  // Helmet injects a hardened set of response headers (CSP, HSTS, frame and
  // cross-origin policies, etc.) to protect browser clients against injection
  // vulnerabilities. The CSP connect-src is widened to the Stellar network so
  // the app can still reach the required blockchain API systems (Horizon and
  // Soroban RPC, on both mainnet and testnet).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          connectSrc,
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  const allowedOrigins = configService.getAllowedOrigins();

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
      ],
      credentials: true,
      maxAge: 86400,
    });
  } else {
    if (configService.isProduction()) {
      app.enableCors({ origin: false });
    } else {
      app.enableCors({ origin: true });
    }
  }

  app.use(compression({ threshold: 1024 }));

  if (sentryDsn) {
    app.useGlobalInterceptors(new SentryInterceptor());
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
    new SanitizationPipe(),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TrustLink API')
    .setDescription(
      'REST API for the TrustLink escrow backend. Auto-generated from DTO decorators.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    extraModels: [ErrorResponseDto],
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
  SwaggerModule.setup('api/docs', app, document);

  app.enableShutdownHooks();

  const port = configService.get('PORT');
  await app.listen(port);

  jsonLogger.log(
    JSON.stringify({
      msg: 'server.started',
      port,
      env: configService.get('NODE_ENV'),
      network: configService.get('STELLAR_NETWORK'),
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : 'all',
      cspConnectSrc: connectSrc,
    }),
    'Bootstrap',
  );
}

bootstrap().catch((err: unknown) => {
  bootstrapLogger.error(
    JSON.stringify({
      msg: 'server.bootstrap.failed',
      error: err instanceof Error ? err.message : String(err),
    }),
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});

process.on('SIGTERM', () => {
  bootstrapLogger.log(
    JSON.stringify({ msg: 'server.shutdown', signal: 'SIGTERM' }),
  );
  process.exit(0);
});

process.on('SIGINT', () => {
  bootstrapLogger.log(
    JSON.stringify({ msg: 'server.shutdown', signal: 'SIGINT' }),
  );
  process.exit(0);
});
