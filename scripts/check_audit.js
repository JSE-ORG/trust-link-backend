/**
 * npm audit gate with documented exceptions.
 *
 * `npm audit` has no allowlist, so the weekly audit failed on advisories that
 * provably do not apply and a genuinely new one looked the same. This reads
 * the output of `npm audit --json` and:
 *
 * 1. Fails on any advisory at or above AUDIT_LEVEL (default `moderate`) that
 *    is not listed in the exceptions file.
 * 2. Fails on any exception whose advisory no longer appears in the audit, so
 *    an entry cannot outlive the package or version it was written for.
 * 3. Fails on any exception missing an id, package, reason or contact.
 *
 * Usage: node scripts/check_audit.js <audit-report.json> [exceptions.json]
 * The exceptions file defaults to .github/audit-exceptions.json.
 */
const fs = require('fs');
const path = require('path');

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const REQUIRED_FIELDS = ['id', 'package', 'reason', 'contact'];

const reportPath = process.argv[2];
const exceptionsPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(__dirname, '../.github/audit-exceptions.json');
const auditLevel = process.env.AUDIT_LEVEL || 'moderate';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!reportPath) {
  fail(
    'Usage: node scripts/check_audit.js <audit-report.json> [exceptions.json]',
  );
}
if (!(auditLevel in SEVERITY_RANK)) {
  fail(`Unknown AUDIT_LEVEL "${auditLevel}".`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (err) {
  fail(`Could not read npm audit report ${reportPath}: ${err.message}`);
}
if (report.error) {
  fail(`npm audit itself failed: ${JSON.stringify(report.error)}`);
}
if (!report.vulnerabilities) {
  fail(
    `${reportPath} has no "vulnerabilities" key; is it npm audit --json output?`,
  );
}

let exceptions;
try {
  exceptions = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8')).exceptions;
} catch (err) {
  fail(`Could not read exceptions file ${exceptionsPath}: ${err.message}`);
}
if (!Array.isArray(exceptions)) {
  fail(`${exceptionsPath} must contain an "exceptions" array.`);
}

// ── Validate the exceptions themselves ────────────────────────────────────
const problems = [];
const exceptionsById = new Map();
exceptions.forEach((entry, index) => {
  const missing = REQUIRED_FIELDS.filter(
    (field) => typeof entry[field] !== 'string' || entry[field].trim() === '',
  );
  if (missing.length > 0) {
    problems.push(
      `Exception #${index + 1} (${entry.id || 'no id'}) is missing: ${missing.join(', ')}.`,
    );
    return;
  }
  if (exceptionsById.has(entry.id)) {
    problems.push(`Exception ${entry.id} is listed more than once.`);
    return;
  }
  exceptionsById.set(entry.id, entry);
});

// ── Collect advisories from the report ────────────────────────────────────
// Each package's `via` holds advisory objects for its own vulnerabilities and
// plain strings for vulnerable dependencies; only the objects are advisories.
const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via !== 'object' || !via.url) continue;
    const id = via.url.split('/').pop();
    advisories.set(id, {
      id,
      package: via.name,
      severity: via.severity,
      title: via.title,
      url: via.url,
    });
  }
}

const threshold = SEVERITY_RANK[auditLevel];
const unexcepted = [];
const excepted = [];
for (const advisory of advisories.values()) {
  if (SEVERITY_RANK[advisory.severity] < threshold) continue;
  if (exceptionsById.has(advisory.id)) {
    excepted.push(advisory);
  } else {
    unexcepted.push(advisory);
  }
}

const stale = [...exceptionsById.values()].filter(
  (entry) => !advisories.has(entry.id),
);

// ── Report ────────────────────────────────────────────────────────────────
const lines = [];
if (excepted.length > 0) {
  lines.push(
    `Ignored ${excepted.length} advisory(ies) with a recorded exception:`,
  );
  for (const a of excepted) {
    const entry = exceptionsById.get(a.id);
    lines.push(
      `  - ${a.id} ${a.package} (${a.severity}): ${entry.reason} [ask ${entry.contact}]`,
    );
  }
}
if (unexcepted.length > 0) {
  lines.push(
    `\n${unexcepted.length} advisory(ies) at or above "${auditLevel}" with no exception:`,
  );
  for (const a of unexcepted) {
    lines.push(
      `  - ${a.id} ${a.package} (${a.severity}): ${a.title}\n    ${a.url}`,
    );
  }
  lines.push(
    'Upgrade the dependency, or add an entry with id, package, reason and ' +
      `contact to ${path.relative(process.cwd(), exceptionsPath)}.`,
  );
}
if (stale.length > 0) {
  lines.push(
    '\nStale exception(s): the advisory no longer appears in npm audit.',
  );
  for (const entry of stale) {
    lines.push(`  - ${entry.id} ${entry.package}: delete this entry.`);
  }
}
if (problems.length > 0) {
  lines.push('\nInvalid exception(s):');
  problems.forEach((p) => lines.push(`  - ${p}`));
}

const failed = unexcepted.length > 0 || stale.length > 0 || problems.length > 0;
const output = lines.join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### npm audit\n\n\`\`\`\n${output || 'No advisories.'}\n\`\`\`\n`,
  );
}

if (failed) {
  fail(output);
}
console.log(output || `No advisories at or above "${auditLevel}".`);
console.log('npm audit check passed.');
