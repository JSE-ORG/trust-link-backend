/// <reference types="jest" />

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { JwtGuard } from './jwt.guard';
import { ConfigService } from '../../config/config.service';
import { AuthUser } from '../auth-user';

const TEST_SECRET = 'test-secret-for-guard';
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

describe('JwtGuard', () => {
  let guard: JwtGuard;

  // Helper to create a mock ExecutionContext
  const createMockExecutionContext = (
    authorizationHeader?: string,
  ): ExecutionContext => {
    const mockRequest = {
      headers: {
        authorization: authorizationHeader,
      },
      user: undefined,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'SEP10_JWT_SECRET') {
                return TEST_SECRET;
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<JwtGuard>(JwtGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true and set request.user for a valid JWT', () => {
      const payload = { sub: TEST_USER_ADDRESS };
      const token = createMockJwt(payload);
      const context = createMockExecutionContext(`Bearer ${token}`);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(true);
      const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
      expect(request.user).toEqual({ address: TEST_USER_ADDRESS });
    });

    it('should return true and set request.user with role for a valid JWT with role', () => {
      const payload = { sub: TEST_USER_ADDRESS, role: 'admin' };
      const token = createMockJwt(payload);
      const context = createMockExecutionContext(`Bearer ${token}`);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(true);
      const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
      expect(request.user).toEqual({
        address: TEST_USER_ADDRESS,
        role: 'admin',
      });
    });

    it('should throw UnauthorizedException if Authorization header is missing', () => {
      const context = createMockExecutionContext(undefined);
      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('should throw UnauthorizedException for malformed header (not Bearer)', () => {
      const context = createMockExecutionContext('Token some-token');
      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('should throw UnauthorizedException if Bearer token is empty', () => {
      const context = createMockExecutionContext('Bearer ');
      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('should throw UnauthorizedException for an invalid signature', () => {
      const payload = { sub: TEST_USER_ADDRESS };
      const token = createMockJwt(payload, 'wrong-secret');
      const context = createMockExecutionContext(`Bearer ${token}`);

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    // ── Privilege-escalation regression tests ────────────────────────────
    // The guard used to fall back to treating any unverifiable token as a raw
    // Stellar address. Because AdminGuard grants admin when the caller address
    // equals ADMIN_ADDRESS, and that address is public, sending it as a bearer
    // token granted full admin. These tests exist to keep that shut.

    it('rejects a bare Stellar address presented as a bearer token', () => {
      const context = createMockExecutionContext(`Bearer ${TEST_USER_ADDRESS}`);

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('rejects the admin address presented as a bearer token', () => {
      const adminAddress =
        'GDQTHTXOKWFZCT2T4U24YANOWEKGTTIPCBPAWL65YEIPCWCT3A2WNZEP';
      const context = createMockExecutionContext(`Bearer ${adminAddress}`);

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('rejects a token that is not three segments', () => {
      const context = createMockExecutionContext('Bearer not-a-jwt.at-all');

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('rejects a correctly signed token whose payload is not valid JSON', () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const invalidBody = Buffer.from('not-json').toString('base64url');
      const signature = createHmac('sha256', TEST_SECRET)
        .update(`${header}.${invalidBody}`)
        .digest('base64url');
      const context = createMockExecutionContext(
        `Bearer ${header}.${invalidBody}.${signature}`,
      );

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('rejects a signed token with no sub claim', () => {
      const token = createMockJwt({ iat: 1, exp: 9_999_999_999 });
      const context = createMockExecutionContext(`Bearer ${token}`);

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('rejects a correctly signed but expired token', () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const token = createMockJwt({
        sub: TEST_USER_ADDRESS,
        iat: nowSeconds - 7200,
        exp: nowSeconds - 3600,
      });
      const context = createMockExecutionContext(`Bearer ${token}`);

      expect(() => guard.canActivate(context)).toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('fails closed when no signing secret is configured anywhere', () => {
      const previous = process.env.SEP10_JWT_SECRET;
      delete process.env.SEP10_JWT_SECRET;

      try {
        // No ConfigService and no env var: the guard must reject rather than
        // fall back to a default secret.
        const unconfiguredGuard = new JwtGuard();
        const token = createMockJwt({ sub: TEST_USER_ADDRESS });
        const context = createMockExecutionContext(`Bearer ${token}`);

        expect(() => unconfiguredGuard.canActivate(context)).toThrow(
          new UnauthorizedException('Authentication required'),
        );
      } finally {
        if (previous === undefined) {
          delete process.env.SEP10_JWT_SECRET;
        } else {
          process.env.SEP10_JWT_SECRET = previous;
        }
      }
    });

    it('carries a signed role claim through unchanged', () => {
      const token = createMockJwt({
        sub: TEST_USER_ADDRESS,
        role: 'superuser',
      });
      const context = createMockExecutionContext(`Bearer ${token}`);

      expect(guard.canActivate(context)).toBe(true);
      const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
      // The guard authenticates; AdminGuard authorises. Only a token signed by
      // Sep10Service can claim a role at all, so passing it through is safe.
      expect(request.user).toEqual({
        address: TEST_USER_ADDRESS,
        role: 'superuser',
      });
    });
  });
});
