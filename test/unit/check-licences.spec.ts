/**
 * Tests for the licence compliance gate (#779).
 *
 * The gate used to be an inline workflow step with no `if:` condition, so a
 * failing `npm audit` skipped it entirely. The logic now lives in
 * `scripts/check-licences.js` and the workflow runs it with `if: always()`.
 *
 * These tests pin the two things that make the gate meaningful:
 *   1. a banned licence produces a non-zero exit code (the job still fails),
 *   2. the banned list and the `elkjs` exclusion are unchanged.
 */

interface CheckLicences {
  BANNED_LICENCES: string[];
  EXCLUDED_PACKAGES: string[];
  FAIL_ON: string;
  buildArgs: () => string[];
  exitCodeFor: (result: { status?: number | null; error?: Error }) => number;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  BANNED_LICENCES,
  EXCLUDED_PACKAGES,
  FAIL_ON,
  buildArgs,
  exitCodeFor,
} = require('../../scripts/check-licences') as CheckLicences;

describe('check-licences (issue #779)', () => {
  describe('exitCodeFor', () => {
    it('returns 0 when license-checker passes', () => {
      expect(exitCodeFor({ status: 0 })).toBe(0);
    });

    it('returns 1 when a banned licence is found, so the job still fails', () => {
      expect(exitCodeFor({ status: 1 })).toBe(1);
    });

    it('returns 2 when the check could not run', () => {
      expect(exitCodeFor({ error: new Error('npx not found') })).toBe(2);
    });
  });

  describe('buildArgs', () => {
    it('checks production dependencies only', () => {
      expect(buildArgs()).toContain('--production');
    });

    it('fails on every banned licence', () => {
      const args = buildArgs();
      const failOnIndex = args.indexOf('--failOn');
      expect(failOnIndex).toBeGreaterThan(-1);
      expect(args[failOnIndex + 1]).toBe(FAIL_ON);
      for (const licence of BANNED_LICENCES) {
        expect(FAIL_ON.split(';')).toContain(licence);
      }
    });

    it('excludes elkjs, which is deliberately allowed', () => {
      const args = buildArgs();
      const excludeIndex = args.indexOf('--excludePackages');
      expect(excludeIndex).toBeGreaterThan(-1);
      expect(args[excludeIndex + 1]).toBe(EXCLUDED_PACKAGES.join(','));
      expect(EXCLUDED_PACKAGES).toContain('elkjs@0.11.1');
    });
  });
});
