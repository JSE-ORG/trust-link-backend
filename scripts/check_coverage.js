/**
 * Coverage gate. Enforces R-TST-04 from SPECIFICATION.md: line coverage of
 * application source must not drop below 70%.
 *
 * This previously sat at 38%, which looked like the suite was far weaker than
 * the specification demanded. It was not. `collectCoverageFrom` was set to
 * `**\/*.(t|j)s`, so spec files, scripts, config and the Prisma seed were all
 * counted as uncovered application source and dragged the figure down. Scoped
 * to `src/**\/*.ts` the real figure is above 70%.
 *
 * Keep the scope and this threshold in step. Widening `collectCoverageFrom`
 * back out to non-source files will make this gate meaningless again.
 *
 * Override for a one-off run:
 *   COVERAGE_MIN_LINES=75 node scripts/check_coverage.js
 *
 * If you raise DEFAULT_MIN_PERCENT, update CONTRIBUTING.md and
 * SPECIFICATION.md (R-TST-04) in the same commit.
 */
const fs = require('fs');
const path = require('path');

const COVERAGE_SUMMARY = path.resolve(
  __dirname,
  '../coverage/coverage-summary.json',
);

const DEFAULT_MIN_LINES = 70;
const DEFAULT_MIN_BRANCHES = 64;
const DEFAULT_MIN_FUNCTIONS = 65;

const MIN_LINES = Number(
  process.env.COVERAGE_MIN_LINES ?? DEFAULT_MIN_LINES,
);
const MIN_BRANCHES = Number(
  process.env.COVERAGE_MIN_BRANCHES ?? DEFAULT_MIN_BRANCHES,
);
const MIN_FUNCTIONS = Number(
  process.env.COVERAGE_MIN_FUNCTIONS ?? DEFAULT_MIN_FUNCTIONS,
);

const envChecks = [
  { name: 'COVERAGE_MIN_LINES', value: MIN_LINES },
  { name: 'COVERAGE_MIN_BRANCHES', value: MIN_BRANCHES },
  { name: 'COVERAGE_MIN_FUNCTIONS', value: MIN_FUNCTIONS },
];

for (const check of envChecks) {
  if (!Number.isFinite(check.value)) {
    console.error(
      `${check.name} must be a number, received "${check.value}"`,
    );
    process.exit(2);
  }
}

if (!fs.existsSync(COVERAGE_SUMMARY)) {
  console.error('Coverage summary not found at', COVERAGE_SUMMARY);
  console.error('Run `npm run test:cov` first.');
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY, 'utf8'));
const total = summary.total || summary[''] || {};

const metrics = [
  { key: 'lines', label: 'Lines', min: MIN_LINES, env: 'COVERAGE_MIN_LINES' },
  { key: 'branches', label: 'Branches', min: MIN_BRANCHES, env: 'COVERAGE_MIN_BRANCHES' },
  { key: 'functions', label: 'Functions', min: MIN_FUNCTIONS, env: 'COVERAGE_MIN_FUNCTIONS' },
];

let hasFailure = false;

for (const m of metrics) {
  const pct = total[m.key] && typeof total[m.key].pct === 'number' ? total[m.key].pct : 0;
  console.log(`${m.label} coverage: ${pct}% (required ${m.min}%)`);

  if (pct < m.min) {
    const diff = (m.min - pct).toFixed(2);
    console.error(
      `Coverage threshold not met for ${m.label}. Measured ${pct}% which fell ${diff} points below the required floor of ${m.min}%. Override with ${m.env}.`,
    );
    hasFailure = true;
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log('All coverage thresholds met');
process.exit(0);
