import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    const configService = app.get(ConfigService);
    
    // Enhanced validation pipe with better error messages
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        exceptionFactory: (errors) => {
          const messages = errors.map(error => {
            const constraints = error.constraints;
            return constraints ? Object.values(constraints).join(', ') : 'Validation failed';
          });
          return new Error(`Validation failed: ${messages.join('; ')}`);
        },
      }),
    );

    // Enable shutdown hooks
    app.enableShutdownHooks();

    const port = configService.get('PORT');
    await app.listen(port);
    
    logger.log(`🚀 Application is running on: http://localhost:${port}`);
    logger.log(`🌍 Environment: ${configService.get('NODE_ENV')}`);
    logger.log(`🌟 Stellar Network: ${configService.get('STELLAR_NETWORK')}`);
    
  } catch (error) {
    logger.error('❌ Error starting server', error);
    process.exit(1);
  }
}

void bootstrap();
