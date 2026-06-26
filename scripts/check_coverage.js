const fs = require('fs');
const path = require('path');

const COVERAGE_SUMMARY = path.resolve(__dirname, '../coverage/coverage-summary.json');
const MIN_PERCENT = 70;

if (!fs.existsSync(COVERAGE_SUMMARY)) {
  console.error('Coverage summary not found at', COVERAGE_SUMMARY);
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY, 'utf8'));
const total = summary.total || summary[''] || {};
const linesPct = total.lines && total.lines.pct ? total.lines.pct : 0;

console.log(`Lines coverage: ${linesPct}% (required ${MIN_PERCENT}%)`);
if (linesPct < MIN_PERCENT) {
  console.error('Coverage threshold not met');
  process.exit(1);
}

console.log('Coverage threshold met');
process.exit(0);
