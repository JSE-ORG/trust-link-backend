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
import { SanitizationPipe } from './common/pipes/sanitization.pipe';
import { SentryInterceptor } from './common/interceptors/sentry.interceptor';

async function bootstrap() {
  // ── Sentry – must init before NestFactory so instrumentation wraps all modules
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      release: process.env.GIT_SHA,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    });
  }

  // Bootstrap with a temporary console logger so early errors are visible,
  // then swap to the structured JSON logger once the DI container is ready.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  // ── Structured JSON logger (issue #81) ────────────────────────────────────
  const jsonLogger = app.get(JsonLoggerService);
  app.useLogger(jsonLogger);

  const configService = app.get(ConfigService);

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
          connectSrc: ["'self'", 'https://*.stellar.org'],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      // This service is a JSON API consumed by separate frontend origins.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  // ── CORS – restrict to known frontend origins (issue #85) ─────────────────
  const allowedOrigins = configService.getAllowedOrigins();

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Allow requests with no origin (server-to-server, curl, Postman)
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
    // No origins configured – block all cross-origin requests in production,
    // allow all in development/test for convenience.
    if (configService.isProduction()) {
      app.enableCors({ origin: false });
    } else {
      app.enableCors({ origin: true });
    }
  }

  // ── Gzip compression (issue #106) ─────────────────────────────────────────
  // Applied before routing so every JSON response is compressed. The threshold
  // (1 KB) avoids the overhead for tiny payloads that wouldn't benefit.
  app.use(compression({ threshold: 1024 }));

  // ── Sentry global interceptor (issue #28) ─────────────────────────────────
  if (sentryDsn) {
    app.useGlobalInterceptors(new SentryInterceptor());
  }

  // ── Validation + sanitization pipes (issue #83) ───────────────────────────
  // ValidationPipe rejects malformed objects before they reach handlers, then
  // SanitizationPipe strips dangerous characters from every string field.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
    new SanitizationPipe(),
  );

  // ── Swagger / OpenAPI docs (issue #47) ────────────────────────────────────
  // DTOs are annotated with @ApiProperty so the generated schema shows
  // descriptions and realistic examples for every request/response body.
  // Served at GET /api/docs (JSON at /api/docs-json).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('TrustLink API')
    .setDescription(
      'REST API for the TrustLink escrow backend. Auto-generated from DTO decorators.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // ── Graceful shutdown ──────────────────────────────────────────────────────
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
    }),
    'Bootstrap',
  );
}

void bootstrap();
