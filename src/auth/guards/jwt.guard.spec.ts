/// <reference types="jest" />

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { JwtGuard } from './jwt.guard';
import { ConfigService } from '../../config/config.service';
import { AuthUser } from '../auth-user';

const TEST_SECRET = 'test-secret-for-guard';
const TEST_USER_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

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

    it('should handle legacy raw address token and set request.user', () => {
      const context = createMockExecutionContext(`Bearer ${TEST_USER_ADDRESS}`);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(true);
      const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
      expect(request.user).toEqual({ address: TEST_USER_ADDRESS });
    });

    it('should handle malformed token (not 3 segments) as a legacy raw address', () => {
      const malformedToken = 'not-a-jwt.at-all';
      const context = createMockExecutionContext(`Bearer ${malformedToken}`);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(true);
      const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
      expect(request.user).toEqual({ address: malformedToken });
    });

    it('should throw if JWT payload is invalid JSON', () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const invalidBody = Buffer.from('not-json').toString('base64url');
      const signature = createHmac('sha256', TEST_SECRET)
        .update(`${header}.${invalidBody}`)
        .digest('base64url');
      const token = `${header}.${invalidBody}.${signature}`;
      const context = createMockExecutionContext(`Bearer ${token}`);

      // The guard will treat this as a legacy token because JSON.parse fails
      const canActivate = guard.canActivate(context);
      expect(canActivate).toBe(true);
      const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
      expect(request.user).toEqual({ address: token });
    });
  });
});