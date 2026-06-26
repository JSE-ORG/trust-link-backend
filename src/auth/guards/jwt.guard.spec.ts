import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { ConfigService } from '../../config/config.service';
import { createHmac } from 'crypto';

describe('JwtGuard', () => {
  let guard: JwtGuard;
  let configService: Partial<ConfigService>;

  const JWT_SECRET = 'test-jwt-secret-key-12345';
  const VALID_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const ANOTHER_ADDRESS = 'GAK76GQPYH3OZZLNCVN3H2CO2QFH7N43YX5H5FVEHVXB2CPVFQ7A42T';

  // Helper to create a mock ExecutionContext
  const createMockExecutionContext = (headers: Record<string, string | string[] | undefined>) => {
    const mockRequest = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  // Helper to create a valid JWT token
  const createValidJwt = (address: string, role?: string): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: address,
        ...(role && { role }),
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url');

    const signature = createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  };

  // Helper to create an invalid JWT signature
  const createInvalidSignatureJwt = (address: string): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: address,
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url');

    // Use wrong secret for signature
    const signature = createHmac('sha256', 'wrong-secret')
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  };

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'SEP10_JWT_SECRET') {
          return JWT_SECRET;
        }
        return undefined;
      }),
    };

    guard = new JwtGuard(configService as ConfigService);
  });

  describe('canActivate', () => {
    it('should be defined', () => {
      expect(guard).toBeDefined();
    });

    describe('valid JWT scenarios', () => {
      it('should return true and set request.user for valid JWT token', () => {
        const token = createValidJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: VALID_ADDRESS,
          role: undefined,
        });
      });

      it('should parse role claim from JWT token', () => {
        const token = createValidJwt(VALID_ADDRESS, 'admin');
        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: VALID_ADDRESS,
          role: 'admin',
        });
      });

      it('should handle multiple Authorization header formats (array)', () => {
        const token = createValidJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: [`Bearer ${token}`, 'Bearer other-token'],
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: VALID_ADDRESS,
          role: undefined,
        });
      });
    });

    describe('error scenarios', () => {
      it('should throw UnauthorizedException when Authorization header is missing', () => {
        const context = createMockExecutionContext({});

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException when Authorization header does not start with Bearer', () => {
        const token = createValidJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: `Token ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for empty Bearer token', () => {
        const context = createMockExecutionContext({
          authorization: 'Bearer ',
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for token with only whitespace after Bearer', () => {
        const context = createMockExecutionContext({
          authorization: 'Bearer   ',
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for malformed JWT with invalid signature', () => {
        const token = createInvalidSignatureJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for JWT with missing sub claim', () => {
        // Create JWT without sub
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url');
        const signature = createHmac('sha256', JWT_SECRET)
          .update(`${header}.${payload}`)
          .digest('base64url');
        const token = `${header}.${payload}.${signature}`;

        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for JWT with empty sub claim', () => {
        // Create JWT with empty sub
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ sub: '', role: 'admin' })).toString('base64url');
        const signature = createHmac('sha256', JWT_SECRET)
          .update(`${header}.${payload}`)
          .digest('base64url');
        const token = `${header}.${payload}.${signature}`;

        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for malformed base64url in JWT payload', () => {
        const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.!!!invalid!!!.signature';
        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });

      it('should throw UnauthorizedException for JWT with non-JSON payload', () => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from('this-is-not-json').toString('base64url');
        const signature = createHmac('sha256', JWT_SECRET)
          .update(`${header}.${payload}`)
          .digest('base64url');
        const token = `${header}.${payload}.${signature}`;

        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        expect(() => guard.canActivate(context)).toThrow('Authentication required');
      });
    });

    describe('legacy raw address token handling', () => {
      it('should treat non-JWT token as raw address and set request.user', () => {
        const context = createMockExecutionContext({
          authorization: `Bearer ${VALID_ADDRESS}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: VALID_ADDRESS,
          role: undefined,
        });
      });

      it('should treat token with non-3-segment format as raw address', () => {
        const rawToken = 'some-random-token-value';
        const context = createMockExecutionContext({
          authorization: `Bearer ${rawToken}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: rawToken,
          role: undefined,
        });
      });

      it('should treat token with 2 segments as raw address', () => {
        const rawToken = 'segment1.segment2';
        const context = createMockExecutionContext({
          authorization: `Bearer ${rawToken}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: rawToken,
          role: undefined,
        });
      });

      it('should treat token with 4 segments as raw address', () => {
        const rawToken = 'seg1.seg2.seg3.seg4';
        const context = createMockExecutionContext({
          authorization: `Bearer ${rawToken}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user).toEqual({
          address: rawToken,
          role: undefined,
        });
      });
    });

    describe('ConfigService fallback scenarios', () => {
      it('should use environment variable when ConfigService returns undefined', () => {
        process.env.SEP10_JWT_SECRET = 'env-secret';
        configService.get = jest.fn().mockReturnValue(undefined);

        guard = new JwtGuard(configService as ConfigService);

        // Create token with env secret
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ sub: VALID_ADDRESS })).toString('base64url');
        const signature = createHmac('sha256', 'env-secret')
          .update(`${header}.${payload}`)
          .digest('base64url');
        const token = `${header}.${payload}.${signature}`;

        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user?.address).toBe(VALID_ADDRESS);

        delete process.env.SEP10_JWT_SECRET;
      });

      it('should use default secret when ConfigService is undefined', () => {
        guard = new JwtGuard(undefined);

        // Create token with default secret
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ sub: VALID_ADDRESS })).toString('base64url');
        const signature = createHmac('sha256', 'secret')
          .update(`${header}.${payload}`)
          .digest('base64url');
        const token = `${header}.${payload}.${signature}`;

        const context = createMockExecutionContext({
          authorization: `Bearer ${token}`,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        expect(request.user?.address).toBe(VALID_ADDRESS);
      });
    });

    describe('authorization header edge cases', () => {
      it('should handle Bearer prefix with different casing (should not match)', () => {
        const token = createValidJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: `bearer ${token}`,
        });

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      });

      it('should handle authorization header with leading/trailing spaces around token', () => {
        const token = createValidJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: `Bearer   ${token}   `,
        });
        const request = context.switchToHttp().getRequest();

        const result = guard.canActivate(context);

        expect(result).toBe(true);
        // Token should be trimmed
        expect(request.user?.address).toBe(VALID_ADDRESS);
      });

      it('should handle authorization as string array with empty first element', () => {
        const token = createValidJwt(VALID_ADDRESS);
        const context = createMockExecutionContext({
          authorization: ['', `Bearer ${token}`],
        });

        // First element is empty, so should throw
        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      });
    });

    describe('multiple address support', () => {
      it('should correctly validate different addresses with valid JWTs', () => {
        const token1 = createValidJwt(VALID_ADDRESS);
        const context1 = createMockExecutionContext({
          authorization: `Bearer ${token1}`,
        });
        const request1 = context1.switchToHttp().getRequest();

        const result1 = guard.canActivate(context1);

        expect(result1).toBe(true);
        expect(request1.user?.address).toBe(VALID_ADDRESS);

        const token2 = createValidJwt(ANOTHER_ADDRESS, 'user');
        const context2 = createMockExecutionContext({
          authorization: `Bearer ${token2}`,
        });
        const request2 = context2.switchToHttp().getRequest();

        const result2 = guard.canActivate(context2);

        expect(result2).toBe(true);
        expect(request2.user?.address).toBe(ANOTHER_ADDRESS);
        expect(request2.user?.role).toBe('user');
      });
    });
  });
});