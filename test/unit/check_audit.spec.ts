import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scriptPath = path.resolve(__dirname, '../../scripts/check_audit.js');

interface Advisory {
  id: string;
  name: string;
  severity: string;
}

interface Exception {
  id?: string;
  package?: string;
  reason?: string;
  contact?: string;
}

interface GuardResult {
  status: number | undefined;
  output: string;
}

/** Builds a minimal `npm audit --json` report containing the given advisories. */
function auditReport(advisories: Advisory[]) {
  const vulnerabilities: Record<string, { via: (object | string)[] }> = {};
  for (const a of advisories) {
    vulnerabilities[a.name] ??= { via: [] };
    vulnerabilities[a.name].via.push({
      name: a.name,
      severity: a.severity,
      title: `${a.name} advisory`,
      url: `https://github.com/advisories/${a.id}`,
    });
  }
  // A dependent package lists the vulnerable one by name, not as an advisory.
  vulnerabilities['parent'] = { via: advisories.map((a) => a.name) };
  return { vulnerabilities };
}

function runGuard(
  advisories: Advisory[],
  exceptions: Exception[],
): GuardResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-audit-'));
  const reportPath = path.join(dir, 'audit.json');
  const exceptionsPath = path.join(dir, 'exceptions.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditReport(advisories)));
  fs.writeFileSync(exceptionsPath, JSON.stringify({ exceptions }));

  try {
    const stdout = execFileSync(
      'node',
      [scriptPath, reportPath, exceptionsPath],
      {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, GITHUB_STEP_SUMMARY: '', AUDIT_LEVEL: '' },
      },
    );
    return { status: 0, output: stdout };
  } catch (err) {
    const error = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: error.status,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MYSQL2: Advisory = {
  id: 'GHSA-3f6p-5ww8-9rcr',
  name: 'mysql2',
  severity: 'high',
};
const MYSQL2_EXCEPTION: Exception = {
  id: MYSQL2.id,
  package: 'mysql2',
  reason: 'No MySQL connection is ever opened.',
  contact: '@maintainer',
};

describe('check_audit', () => {
  it('passes when every advisory has a justified exception', () => {
    const result = runGuard([MYSQL2], [MYSQL2_EXCEPTION]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('No MySQL connection is ever opened.');
  });

  it('fails on an advisory that is not in the exceptions list', () => {
    const result = runGuard(
      [MYSQL2, { id: 'GHSA-new0-0000-0000', name: 'qs', severity: 'moderate' }],
      [MYSQL2_EXCEPTION],
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('GHSA-new0-0000-0000');
  });

  it('ignores advisories below the audit level', () => {
    const result = runGuard(
      [{ id: 'GHSA-low0-0000-0000', name: 'joi', severity: 'low' }],
      [],
    );
    expect(result.status).toBe(0);
  });

  it('fails on a stale exception whose advisory no longer appears', () => {
    const result = runGuard([], [MYSQL2_EXCEPTION]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Stale exception');
    expect(result.output).toContain(MYSQL2.id);
  });

  it('fails on an exception with no reason or contact', () => {
    const result = runGuard(
      [MYSQL2],
      [{ id: MYSQL2.id, package: 'mysql2', reason: ' ' }],
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('missing: reason, contact');
  });
});
