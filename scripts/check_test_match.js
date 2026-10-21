/**
 * Test match checker.
 *
 * Verifies that every Jest test file (ending in *.spec.ts or *.test.ts) in the
 * repository is matched by at least one of the three Jest configuration
 * testRegex patterns:
 *
 * 1. Unit suite (package.json):          (src|test)/.*\.spec\.ts$
 * 2. Integration (jest-integration.json): test/integration/.*\.integration-spec\.ts$
 * 3. E2E (jest-e2e.json):                 .e2e-spec.ts$
 *
 * Fails CI if a test file is created with an unmatched naming pattern or in an
 * arbitrary location, preventing silent skip of test suites.
 *
 * Accepts an optional root directory argument for testing.
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..');

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

const REGEX_UNIT = /(src|test)\/.*\.spec\.ts$/;
const REGEX_INTEGRATION = /test\/integration\/.*\.integration-spec\.ts$/;
const REGEX_E2E = /.*\.e2e-spec\.ts$/;

function isTestFile(fileName) {
  return fileName.endsWith('.test.ts') || fileName.endsWith('.spec.ts');
}

function findTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findTestFiles(fullPath));
    } else if (entry.isFile() && isTestFile(entry.name)) {
      results.push(path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

if (!fs.existsSync(ROOT_DIR)) {
  console.error(`Root directory does not exist: ${ROOT_DIR}`);
  process.exit(1);
}

const testFiles = findTestFiles(ROOT_DIR).sort();

const unmatched = testFiles.filter((file) => {
  const matchesUnit = REGEX_UNIT.test(file);
  const matchesIntegration = REGEX_INTEGRATION.test(file);
  const matchesE2E = REGEX_E2E.test(file);
  return !matchesUnit && !matchesIntegration && !matchesE2E;
});

if (unmatched.length > 0) {
  console.error('The following test files match none of the three Jest testRegex configurations:');
  unmatched.forEach((f) => console.error(`  - ${f}`));
  console.error(
    '\nEvery test file must match unit (*.spec.ts), integration (*.integration-spec.ts), or E2E (*.e2e-spec.ts).'
  );
  process.exit(1);
}

console.log(`All ${testFiles.length} test files match a Jest configuration.`);
process.exit(0);
