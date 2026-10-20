import { Request, Response } from 'express';
import * as api from '@opentelemetry/api';
import {
  TracingMiddleware,
  resolveWorkflow,
} from '../../src/tracing/tracing.middleware';
import { isTracingEnabled } from '../../src/tracing/tracing.bootstrap';

// Mock the bootstrap guard so each test can independently toggle the
// "tracing enabled" branch without depending on cached module-load state.
jest.mock('../../src/tracing/tracing.bootstrap', () => ({
  isTracingEnabled: jest.fn(),
}));

const mockedIsTracingEnabled = isTracingEnabled as jest.MockedFunction<
  typeof isTracingEnabled
>;

interface MockReqRes {
  req: Request;
  res: Response & {
    on: jest.Mock;
    statusCode: number;
  };
  next: jest.Mock;
}

function buildReqRes(
  url: string,
  headers: Record<string, string> = {},
  routePath?: string,
  method = 'GET',
): MockReqRes {
  const req = {
    method,
    originalUrl: url,
    route: routePath ? { path: routePath } : undefined,
    headers,
  } as unknown as Request;

  const res = {
    statusCode: 200,
    on: jest.fn(),
  } as unknown as Response & { on: jest.Mock; statusCode: number };

  const next = jest.fn();
  return { req, res, next };
}

function getFinishListener(res: MockReqRes['res']): () => void {
  const call = res.on.mock.calls.find(([event]) => event === 'finish');
  if (!call) {
    throw new Error('res.on("finish") listener was not registered');
  }
  return call[1] as () => void;
}

describe('resolveWorkflow (issue #79)', () => {
  it('maps escrow routes', () => {
    expect(resolveWorkflow('POST', '/escrow')).toBe('escrow.post');
    expect(resolveWorkflow('GET', '/escrow/abc-123')).toBe('escrow.get');
  });

  it('maps vendor routes', () => {
    expect(resolveWorkflow('GET', '/vendor/escrows')).toBe('vendor.get');
  });

  it('maps sep10 auth routes', () => {
    expect(resolveWorkflow('GET', '/auth/sep10/challenge')).toBe('sep10.get');
  });

  it('maps stellar webhook', () => {
    expect(resolveWorkflow('POST', '/webhooks/stellar')).toBe(
      'webhook.stellar',
    );
  });

  it('maps admin routes', () => {
    expect(resolveWorkflow('GET', '/admin/stats')).toBe('admin.stats');
    expect(resolveWorkflow('GET', '/admin/queues')).toBe('admin.queues');
    expect(resolveWorkflow('GET', '/admin/disputes')).toBe('admin.disputes');
    expect(resolveWorkflow('GET', '/admin/api-keys')).toBe('admin.api_keys');
  });

  it('maps health and version', () => {
    expect(resolveWorkflow('GET', '/health')).toBe('health.check');
    expect(resolveWorkflow('GET', '/version')).toBe('version.check');
  });

  it('maps the liveness and readiness probes separately (#972)', () => {
    expect(resolveWorkflow('GET', '/health/live')).toBe('health.live');
    expect(resolveWorkflow('GET', '/health/ready')).toBe('health.ready');
  });

  it('maps the admin DLQ, audit log and credentials routes (#972)', () => {
    expect(resolveWorkflow('GET', '/admin/dlq')).toBe('admin.dlq');
    expect(resolveWorkflow('GET', '/admin/audit-log')).toBe('admin.audit_log');
    expect(resolveWorkflow('POST', '/admin/credentials')).toBe(
      'admin.api_keys',
    );
  });

  it('maps the stress-test route (#972)', () => {
    expect(resolveWorkflow('POST', '/stress-test')).toBe('stress_test.post');
  });

  /**
   * #972 — one case per controller prefix, so a renamed or added controller
   * that is missing from the map shows up as a failing case here.
   */
  it.each([
    ['GET', '/auth', 'sep10.get'],
    ['POST', '/auth/challenge', 'sep10.post'],
    ['POST', '/auth/refresh', 'sep10.post'],
    ['GET', '/escrow', 'escrow.get'],
    ['GET', '/vendor/escrows', 'vendor.get'],
    ['POST', '/webhooks/stellar', 'webhook.stellar'],
    ['GET', '/admin/queues', 'admin.queues'],
    ['GET', '/admin/disputes', 'admin.disputes'],
    ['GET', '/admin/stats', 'admin.stats'],
    ['GET', '/admin/audit-log', 'admin.audit_log'],
    ['GET', '/admin/dlq', 'admin.dlq'],
    ['GET', '/admin/credentials', 'admin.api_keys'],
    ['POST', '/stress-test', 'stress_test.post'],
    ['GET', '/health', 'health.check'],
    ['GET', '/health/live', 'health.live'],
    ['GET', '/health/ready', 'health.ready'],
    ['GET', '/version', 'version.check'],
  ])('maps %s %s to %s', (method, url, workflow) => {
    expect(resolveWorkflow(method, url)).toBe(workflow);
  });

  it('no longer maps the removed /admin/api-keys prefix (#972)', () => {
    expect(resolveWorkflow('GET', '/admin/api-keys')).toBe('http.get');
  });

  it('strips query strings', () => {
    expect(resolveWorkflow('GET', '/escrow?page=1')).toBe('escrow.get');
    expect(resolveWorkflow('GET', '/health/ready?verbose=1')).toBe(
      'health.ready',
    );
  });

  it('returns http.method for unknown routes', () => {
    expect(resolveWorkflow('POST', '/unknown')).toBe('http.post');
    expect(resolveWorkflow('PUT', '/foo/bar')).toBe('http.put');
  });

  it('handles DELETE method', () => {
    expect(resolveWorkflow('DELETE', '/escrow/123')).toBe('escrow.delete');
  });

  it('handles PATCH method', () => {
    expect(resolveWorkflow('PATCH', '/vendor/profile')).toBe('vendor.patch');
  });
});

describe('TracingMiddleware.use (issue #79, issue #463)', () => {
  let middleware: TracingMiddleware;

  beforeEach(() => {
    middleware = new TracingMiddleware();
    mockedIsTracingEnabled.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when tracing is disabled', () => {
    it('does not extract context or set span attributes', () => {
      mockedIsTracingEnabled.mockReturnValue(false);
      const extractSpy = jest.spyOn(api.propagation, 'extract');
      const withSpy = jest.spyOn(api.context, 'with');

      const { req, res, next } = buildReqRes('/escrow', {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(extractSpy).not.toHaveBeenCalled();
      expect(withSpy).not.toHaveBeenCalled();
      expect(res.on).not.toHaveBeenCalled();
    });

    it('does not throw when headers, route, or status code are missing', () => {
      mockedIsTracingEnabled.mockReturnValue(false);

      const { req, res, next } = buildReqRes('/health');

      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('when tracing is enabled', () => {
    let mockSpan: { setAttribute: jest.Mock };

    beforeEach(() => {
      mockedIsTracingEnabled.mockReturnValue(true);
      mockSpan = { setAttribute: jest.fn() };
      jest
        .spyOn(api.trace, 'getActiveSpan')
        .mockReturnValue(mockSpan as unknown as api.Span);
      // Run context.with synchronously so we can assert on the side effects
      // of the inner block without depending on an active OpenTelemetry SDK.
      jest
        .spyOn(api.context, 'with')
        .mockImplementation(((_ctx: api.Context, fn: () => unknown) =>
          fn()) as typeof api.context.with);
      jest.spyOn(api.propagation, 'extract').mockReturnValue({} as api.Context);
    });

    it('continues the incoming trace context when a traceparent header is present', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };
      const { req, res, next } = buildReqRes('/escrow/abc-123', headers);

      middleware.use(req, res, next);

      expect(api.propagation.extract).toHaveBeenCalledTimes(1);
      const [activeCtx, carrier] = (api.propagation.extract as jest.Mock).mock
        .calls[0] as [api.Context, Record<string, string>];
      expect(activeCtx).toBeDefined();
      expect(carrier).toBe(headers);
      expect(api.context.with).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('extracts an empty context when no traceparent header is supplied', () => {
      const { req, res, next } = buildReqRes('/health', {});

      middleware.use(req, res, next);

      expect(api.propagation.extract).toHaveBeenCalledWith(
        expect.anything(),
        {},
      );
      expect(api.context.with).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('stamps trustlink.workflow on the active span', () => {
      const { req, res, next } = buildReqRes('/escrow/list');

      middleware.use(req, res, next);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'trustlink.workflow',
        'escrow.get',
      );
    });

    /**
     * #972 — the middleware runs before routing, so it must never set
     * http.route. Setting it from originalUrl overwrote the route template
     * with raw ids and query strings.
     */
    it('does not set http.route, so the instrumentation template is kept', () => {
      const { req, res, next } = buildReqRes(
        '/escrow/abc-123?page=2',
        {},
        '/escrow/:id',
      );

      middleware.use(req, res, next);

      const attributeNames = mockSpan.setAttribute.mock.calls.map(
        ([name]) => name,
      );
      expect(attributeNames).not.toContain('http.route');
    });

    it('does not set http.route when no route descriptor is present', () => {
      const { req, res, next } = buildReqRes('/vendor/escrows');

      middleware.use(req, res, next);

      const attributeNames = mockSpan.setAttribute.mock.calls.map(
        ([name]) => name,
      );
      expect(attributeNames).not.toContain('http.route');
    });

    it('records trustlink.request_id when x-request-id is provided', () => {
      const { req, res, next } = buildReqRes('/escrow', {
        'x-request-id': 'req-42',
      });

      middleware.use(req, res, next);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'trustlink.request_id',
        'req-42',
      );
    });

    it('sets http.response.status_code on res.finish without mutating listener behavior', () => {
      const { req, res, next } = buildReqRes('/escrow');
      middleware.use(req, res, next);

      const finishListener = getFinishListener(res);
      res.statusCode = 201;
      finishListener();

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'http.response.status_code',
        201,
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('stamps the workflow attribute and wires the finish handler for matched routes without a route descriptor', () => {
      const { req, res, next } = buildReqRes(
        '/webhooks/stellar',
        {},
        undefined,
        'POST',
      );

      middleware.use(req, res, next);

      // The middleware must still wire up the response listener so that the
      // finish handler eventually stamps the status code, even when no route
      // descriptor is attached.
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'trustlink.workflow',
        'webhook.stellar',
      );
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('when tracing is enabled but no span is active', () => {
    beforeEach(() => {
      mockedIsTracingEnabled.mockReturnValue(true);
      jest.spyOn(api.trace, 'getActiveSpan').mockReturnValue(undefined);
      jest
        .spyOn(api.context, 'with')
        .mockImplementation(((_ctx: api.Context, fn: () => unknown) =>
          fn()) as typeof api.context.with);
      jest.spyOn(api.propagation, 'extract').mockReturnValue({} as api.Context);
    });

    it('still calls next() when getActiveSpan returns undefined', () => {
      const { req, res, next } = buildReqRes('/escrow', {
        'x-request-id': 'req-1',
      });
      middleware.use(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('still registers the finish listener and the listener does not throw when no span is active', () => {
      const { req, res, next } = buildReqRes('/vendor/profile');
      middleware.use(req, res, next);

      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
      const finishListener = getFinishListener(res);
      res.statusCode = 404;
      expect(() => finishListener()).not.toThrow();
    });
  });
});
