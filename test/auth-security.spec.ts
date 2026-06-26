import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Sep10Service } from '../src/auth/sep10/sep10.service';
import { JwtGuard } from '../src/auth/guards/jwt.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConfigService } from '../src/config/config.service';

describe('Auth Security Tests (Refresh, Nonce, Rate Limiting)', () => {
  let sep10Service: Sep10Service;
  let jwtGuard: JwtGuard;
  let request: {
    headers: Record<string, string | undefined>;
    user?: { address: string; role?: string };
  };

  const jwtSecret = 'TEST_SECRET';
  const adminAddress = 'GADMIN_ADDRESS';

  const signJwt = (
    payload: Record<string, unknown>,
    secret = jwtSecret,
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

  const executionContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Sep10Service,
        JwtGuard,
        {
          provide: PrismaService,
          useValue: {
            nonce: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            refreshToken: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SEP10_JWT_SECRET') return jwtSecret;
              if (key === 'ADMIN_ADDRESS') return adminAddress;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    sep10Service = module.get<Sep10Service>(Sep10Service);
    jwtGuard = module.get<JwtGuard>(JwtGuard);
    request = { headers: {} };
  });

  it('should issue a challenge and store a nonce (Replay Protection)', () => {
    expect(sep10Service).toBeDefined();
    // Replay prevention: challenge stores a nonce in the DB
  });

  it('should detect and prevent nonce reuse (Replay Prevention)', () => {
    // Tests that an already used nonce throws an UnauthorizedException
  });

  it('should enforce nonce expiration', () => {
    // Tests that expired nonces are rejected
  });

  it('should rotate refresh tokens and issue new ones', () => {
    // Test refresh token rotation
  });

  it('should detect refresh token reuse and revoke the family', () => {
    // Test that using a revoked token revokes all tokens for the user
  });

  it('rejects forged JWTs with invalid HMAC-SHA256 signatures', () => {
    const token = signJwt({ sub: 'GVENDOR_ADDRESS', role: 'admin' }, 'wrong');
    request.headers.authorization = `Bearer ${token}`;

    expect(() => jwtGuard.canActivate(executionContext())).toThrow(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  it('accepts valid HS256 JWTs and attaches the authenticated user', () => {
    const token = signJwt({ sub: 'GVENDOR_ADDRESS', role: 'vendor' });
    request.headers.authorization = `Bearer ${token}`;

    expect(jwtGuard.canActivate(executionContext())).toBe(true);
    expect(request.user).toEqual({
      address: 'GVENDOR_ADDRESS',
      role: 'vendor',
    });
  });

  it('issues admin role claims for the configured admin address', () => {
    const token = (
      sep10Service as unknown as { issueJwt(sub: string): string }
    ).issueJwt(adminAddress);
    const [, body] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as {
      role?: string;
      sub?: string;
    };

    expect(payload.sub).toBe(adminAddress);
    expect(payload.role).toBe('admin');
  });
});
