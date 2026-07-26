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

const DEFAULT_MIN_PERCENT = 70;
const MIN_PERCENT = Number(
  process.env.COVERAGE_MIN_LINES ?? DEFAULT_MIN_PERCENT,
);

if (!Number.isFinite(MIN_PERCENT)) {
  console.error(
    `COVERAGE_MIN_LINES must be a number, received "${process.env.COVERAGE_MIN_LINES}"`,
  );
  process.exit(2);
}

if (!fs.existsSync(COVERAGE_SUMMARY)) {
  console.error('Coverage summary not found at', COVERAGE_SUMMARY);
  console.error('Run `npm run test:cov` first.');
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY, 'utf8'));
const total = summary.total || summary[''] || {};
const linesPct = total.lines && total.lines.pct ? total.lines.pct : 0;

console.log(`Lines coverage: ${linesPct}% (required ${MIN_PERCENT}%)`);

if (linesPct < MIN_PERCENT) {
  console.error(
    `Coverage threshold not met. Lines coverage dropped by ${(
      MIN_PERCENT - linesPct
    ).toFixed(2)} points below the floor.`,
  );
  process.exit(1);
}

console.log('Coverage threshold met');
process.exit(0);
