const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scriptPath = path.resolve(__dirname, '../../scripts/check_test_match.js');

function createFixture(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-test-'));
  for (const relPath of files) {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, '// fixture');
  }
  return tmpDir;
}

function runGuard(rootDir) {
  try {
    const stdout = execFileSync('node', [scriptPath, rootDir], { encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (error) {
    return {
      status: error.status,
      stdout: (error.stdout && error.stdout.toString()) || '',
      stderr: (error.stderr && error.stderr.toString()) || '',
    };
  }
}

describe('check_test_match', () => {
  it('detects a test file that matches no Jest configuration', () => {
    const fixture = createFixture([
      'src/sample.spec.ts',
      'tests/orphan.test.ts',
    ]);
    try {
      const result = runGuard(fixture);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain('tests/orphan.test.ts');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('ignores node_modules, dist, and coverage', () => {
    const fixture = createFixture([
      'src/sample.spec.ts',
      'node_modules/ignored.test.ts',
      'dist/ignored.test.ts',
      'coverage/ignored.test.ts',
    ]);
    try {
      const result = runGuard(fixture);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('All 1 test files match');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('passes when all test files match a configuration', () => {
    const fixture = createFixture([
      'src/sample.spec.ts',
      'test/integration/sample.integration-spec.ts',
      'test/e2e/sample.e2e-spec.ts',
    ]);
    try {
      const result = runGuard(fixture);
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
