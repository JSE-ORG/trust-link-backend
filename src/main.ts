import './tracing/tracing.bootstrap';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import compression from 'compression';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { JsonLoggerService } from './common/logger/json-logger.service';
import { SanitizationPipe } from './common/pipes/sanitization.pipe';

async function bootstrap() {
  // Bootstrap with a temporary console logger so early errors are visible,
  // then swap to the structured JSON logger once the DI container is ready.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // ── Structured JSON logger (issue #81) ────────────────────────────────────
  const jsonLogger = app.get(JsonLoggerService);
  app.useLogger(jsonLogger);

  const configService = app.get(ConfigService);

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
