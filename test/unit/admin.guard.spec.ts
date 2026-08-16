import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from '../../src/admin/guards/admin.guard';
import { ConfigService } from '../../src/config/config.service';

const ADMIN_ADDRESS =
  'GADMIN000000000000000000000000000000000000000000000000000';
const OTHER_ADDRESS =
  'GOTHER000000000000000000000000000000000000000000000000000';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function makeConfigService(
  adminAddress: string | undefined,
): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockReturnValue(adminAddress),
  } as unknown as jest.Mocked<ConfigService>;
}

describe('AdminGuard (issue #520)', () => {
  describe('when ADMIN_ADDRESS is configured', () => {
    let guard: AdminGuard;

    beforeEach(() => {
      guard = new AdminGuard(makeConfigService(ADMIN_ADDRESS));
    });

    it('returns true for a user whose address matches ADMIN_ADDRESS', () => {
      const ctx = makeContext({ address: ADMIN_ADDRESS, role: 'admin' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true for matching ADMIN_ADDRESS even without explicit role', () => {
      const ctx = makeContext({ address: ADMIN_ADDRESS });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('throws ForbiddenException when user has role=admin but address does not match ADMIN_ADDRESS', () => {
      const ctx = makeContext({ address: OTHER_ADDRESS, role: 'admin' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user has non-admin address', () => {
      const ctx = makeContext({ address: OTHER_ADDRESS, role: 'vendor' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when request.user is missing', () => {
      const ctx = makeContext(undefined);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when request.user is null', () => {
      const ctx = makeContext(null);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('uses single denial message "Admin access required" for all denials', () => {
      const cases = [
        undefined,
        null,
        { address: OTHER_ADDRESS },
        { address: OTHER_ADDRESS, role: 'admin' },
        { address: OTHER_ADDRESS, role: 'vendor' },
      ];

      for (const user of cases) {
        const ctx = makeContext(user);
        let caught: ForbiddenException | null = null;
        try {
          guard.canActivate(ctx);
        } catch (e) {
          caught = e as ForbiddenException;
        }
        expect(caught).toBeInstanceOf(ForbiddenException);
        expect((caught!.getResponse() as any).message).toBe(
          'Admin access required',
        );
      }
    });
  });

  describe('when ADMIN_ADDRESS is not configured', () => {
    let guard: AdminGuard;

    beforeEach(() => {
      guard = new AdminGuard(makeConfigService(undefined));
    });

    it('throws ForbiddenException even for a user claiming role=admin when ADMIN_ADDRESS is unconfigured', () => {
      const ctx = makeContext({ address: OTHER_ADDRESS, role: 'admin' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});
