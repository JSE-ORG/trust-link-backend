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

  it('strips query strings', () => {
    expect(resolveWorkflow('GET', '/escrow?page=1')).toBe('escrow.get');
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

    it('prefers req.route.path for the http.route attribute', () => {
      const { req, res, next } = buildReqRes(
        '/escrow/list',
        {},
        '/escrow/list',
      );

      middleware.use(req, res, next);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'http.route',
        '/escrow/list',
      );
    });

    it('falls back to originalUrl when req.route.path is absent', () => {
      const { req, res, next } = buildReqRes('/vendor/escrows');

      middleware.use(req, res, next);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'http.route',
        '/vendor/escrows',
      );
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
});
