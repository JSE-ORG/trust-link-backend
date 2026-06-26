import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

/**
 * Issue #81 – Structured JSON logging replacing plain console.log.
 *
 * Emits every log entry as a single-line JSON object so that log aggregators
 * (Datadog, CloudWatch, Loki, …) can parse fields without regex heuristics.
 *
 * Format:
 * {
 *   "level":   "info" | "warn" | "error" | "debug" | "verbose",
 *   "time":    "<ISO-8601>",
 *   "context": "<NestJS context label>",
 *   "msg":     "<human-readable message>",
 *   "pid":     <number>,
 *   "env":     "<NODE_ENV>"
 * }
 *
 * The minimum log level is controlled by the LOG_LEVEL environment variable
 * (trace | debug | info | warn | error | fatal).  Defaults to "info".
 */

const LEVEL_PRIORITY: Record<string, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  log: 2, // NestJS alias for info
  warn: 3,
  error: 4,
  fatal: 5,
};

function minLevel(): string {
  return (process.env.LOG_LEVEL ?? 'info').toLowerCase();
}

function shouldLog(level: string): boolean {
  const min = LEVEL_PRIORITY[minLevel()] ?? 2;
  const cur = LEVEL_PRIORITY[level.toLowerCase()] ?? 2;
  return cur >= min;
}

function emit(
  level: string,
  message: unknown,
  context?: string,
  stack?: string,
): void {
  if (!shouldLog(level)) return;

  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    pid: process.pid,
    env: process.env.NODE_ENV ?? 'development',
    context: context ?? 'App',
    msg: String(message),
  };

  if (stack) {
    entry['stack'] = stack;
  }

  // Use process.stdout directly to avoid any NestJS formatting on top
  process.stdout.write(JSON.stringify(entry) + '\n');
}

@Injectable()
export class JsonLoggerService extends ConsoleLogger {
  /** Emits an info-level structured log entry. */
  override log(message: unknown, context?: string): void {
    emit('info', message, context ?? this.context);
  }

  /** Emits an error-level structured log entry with optional stack. */
  override error(message: unknown, stack?: string, context?: string): void {
    emit('error', message, context ?? this.context, stack);
  }

  /** Emits a warn-level structured log entry. */
  override warn(message: unknown, context?: string): void {
    emit('warn', message, context ?? this.context);
  }

  /** Emits a debug-level structured log entry. */
  override debug(message: unknown, context?: string): void {
    emit('debug', message, context ?? this.context);
  }

  /** Emits a trace-level structured log entry for verbose messages. */
  override verbose(message: unknown, context?: string): void {
    emit('trace', message, context ?? this.context);
  }

  /**
   * Convenience helper so application code can log arbitrary structured data
   * without building the JSON string manually.
   *
   * @example
   *   this.logger.structured('info', 'escrow.created', { escrowId, amount });
   */
  structured(
    level: LogLevel | 'trace',
    msg: string,
    fields: Record<string, unknown>,
    context?: string,
  ): void {
    if (!shouldLog(level)) return;

    const entry: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      pid: process.pid,
      env: process.env.NODE_ENV ?? 'development',
      context: context ?? this.context ?? 'App',
      msg,
      ...fields,
    };

    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}
