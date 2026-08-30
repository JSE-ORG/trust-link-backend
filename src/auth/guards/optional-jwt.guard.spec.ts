/// <reference types="jest" />

import { ExecutionContext } from '@nestjs/common';
import { createHmac } from 'crypto';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { AuthUser } from '../auth-user';

const TEST_SECRET = 'test-secret-for-optional-jwt-guard';
const TEST_USER_ADDRESS =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/**
 * Helper to create a mock JWT for testing.
 */
const createMockJwt = (
  payload: object,
  secret: string = TEST_SECRET,
): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
};

describe('OptionalJwtGuard', () => {
  let guard: OptionalJwtGuard;
  let originalSecret: string | undefined;

  const createMockExecutionContext = (
    authorizationHeader?: string | string[],
    initialUser?: AuthUser,
  ): {
    context: ExecutionContext;
    mockRequest: { headers: Record<string, unknown>; user?: AuthUser };
  } => {
    const mockRequest = {
      headers: {
        authorization: authorizationHeader,
      },
      user: initialUser,
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    return { context, mockRequest };
  };

  beforeAll(() => {
    originalSecret = process.env.SEP10_JWT_SECRET;
    process.env.SEP10_JWT_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.SEP10_JWT_SECRET;
    } else {
      process.env.SEP10_JWT_SECRET = originalSecret;
    }
  });

  beforeEach(() => {
    guard = new OptionalJwtGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true and attach user when valid JWT is provided', () => {
      const payload = { sub: TEST_USER_ADDRESS };
      const token = createMockJwt(payload);
      const { context, mockRequest } = createMockExecutionContext(
        `Bearer ${token}`,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({ address: TEST_USER_ADDRESS });
    });

    it('should return true and attach user with role when valid JWT with role is provided', () => {
      const payload = { sub: TEST_USER_ADDRESS, role: 'vendor' };
      const token = createMockJwt(payload);
      const { context, mockRequest } = createMockExecutionContext(
        `Bearer ${token}`,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({
        address: TEST_USER_ADDRESS,
        role: 'vendor',
      });
    });

    it('should return true and set user to undefined when Authorization header is missing', () => {
      const initialUser: AuthUser = { address: 'STALE_ADDRESS' };
      const { context, mockRequest } = createMockExecutionContext(
        undefined,
        initialUser,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return true and set user to undefined when Authorization header is not Bearer', () => {
      const { context, mockRequest } =
        createMockExecutionContext('Basic dXNlcjpwYXNz');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return true and set user to undefined when Bearer token is empty', () => {
      const { context, mockRequest } = createMockExecutionContext('Bearer ');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return true and set user to undefined when JWT signature is invalid', () => {
      const payload = { sub: TEST_USER_ADDRESS };
      const token = createMockJwt(payload, 'wrong-secret');
      const { context, mockRequest } = createMockExecutionContext(
        `Bearer ${token}`,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return true and set user to undefined when JWT is expired', () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = {
        sub: TEST_USER_ADDRESS,
        exp: nowSeconds - 3600,
      };
      const token = createMockJwt(payload);
      const { context, mockRequest } = createMockExecutionContext(
        `Bearer ${token}`,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return true and set user to undefined when token is malformed', () => {
      const { context, mockRequest } = createMockExecutionContext(
        'Bearer not.a.valid.jwt.string',
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should return true and set user to undefined when JWT lacks sub claim', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = createMockJwt(payload);
      const { context, mockRequest } = createMockExecutionContext(
        `Bearer ${token}`,
      );

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeUndefined();
    });
  });
});
