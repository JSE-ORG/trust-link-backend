import type { PrismaService } from '../prisma/prisma.service';
import type { TracingService } from './tracing.service';

const TRACED_MODELS = [
  'escrow',
  'dispute',
  'notification',
  'vendorProfile',
  'processedWebhookEvent',
] as const;

type TracedModel = (typeof TRACED_MODELS)[number];

function isTracedModel(key: string): key is TracedModel {
  return (TRACED_MODELS as readonly string[]).includes(key);
}

/**
 * Wraps PrismaService model delegates so every DB operation emits a child span
 * with accurate duration timings (issue #79).
 */
export function wrapPrismaWithTracing(
  prisma: PrismaService,
  tracing: TracingService,
): PrismaService {
  const handler: ProxyHandler<PrismaService> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop === 'string' && isTracedModel(prop) && value) {
        return wrapModelDelegate(
          value as Record<string, unknown>,
          prop,
          tracing,
        );
      }

      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }

      return value;
    },
  };

  return new Proxy(prisma, handler);
}

function wrapModelDelegate(
  model: Record<string, unknown>,
  modelName: string,
  tracing: TracingService,
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};

  for (const [method, fn] of Object.entries(model)) {
    if (typeof fn !== 'function') {
      wrapped[method] = fn;
      continue;
    }

    wrapped[method] = (...args: unknown[]) =>
      tracing.withDbSpan(modelName, method, () =>
        (fn as (...a: unknown[]) => unknown).apply(model, args),
      );
  }

  return wrapped;
}
