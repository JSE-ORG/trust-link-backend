/**
 * Test match checker.
 *
 * Verifies that every spec file under `src/` or `test/` is matched by at least
 * one of the three Jest configuration testRegex patterns:
 *
 * 1. Unit suite (package.json):          (src|test)/.*\.spec\.ts$
 * 2. Integration (jest-integration.json): test/integration/.*\.integration-spec\.ts$
 * 3. E2E (jest-e2e.json):                 .e2e-spec.ts$
 *
 * Fails CI if a test file is created with an unmatched naming pattern (e.g.,
 * -spec.ts or arbitrary locations), preventing silent skip of test suites.
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const REGEX_UNIT = /(src|test)\/.*\.spec\.ts$/;
const REGEX_INTEGRATION = /test\/integration\/.*\.integration-spec\.ts$/;
const REGEX_E2E = /.*\.e2e-spec\.ts$/;

function findSpecFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findSpecFiles(filePath));
    } else if (file.endsWith('spec.ts')) {
      results.push(path.relative(ROOT_DIR, filePath).replace(/\\/g, '/'));
    }
  }
  return results;
}

const searchDirs = ['src', 'test'].map((d) => path.join(ROOT_DIR, d));
const specFiles = searchDirs.reduce((acc, dir) => {
  if (fs.existsSync(dir)) {
    return acc.concat(findSpecFiles(dir));
  }
  return acc;
}, []);

const unmatched = [];

for (const file of specFiles) {
  const matchesUnit = REGEX_UNIT.test(file);
  const matchesIntegration = REGEX_INTEGRATION.test(file);
  const matchesE2E = REGEX_E2E.test(file);

  if (!matchesUnit && !matchesIntegration && !matchesE2E) {
    unmatched.push(file);
  }
}

if (unmatched.length > 0) {
  console.error('The following test files match none of the three Jest testRegex configurations:');
  unmatched.forEach((f) => console.error(`  - ${f}`));
  console.error(
    '\nEvery spec file must match unit (*.spec.ts), integration (*.integration-spec.ts), or E2E (*.e2e-spec.ts).',
  );
  process.exit(1);
}

console.log(`All ${specFiles.length} test files match a Jest configuration.`);
process.exit(0);
