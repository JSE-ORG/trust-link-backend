import { Global, Module } from '@nestjs/common';
import { JsonLoggerService } from './json-logger.service';

/**
 * Global logger module – makes JsonLoggerService available everywhere without
 * explicit imports.
 */
@Global()
@Module({
  providers: [JsonLoggerService],
  exports: [JsonLoggerService],
})
export class LoggerModule {}
