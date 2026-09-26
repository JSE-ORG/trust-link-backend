#!/usr/bin/env node
/**
 * Licence compliance gate for the weekly security audit (#779).
 *
 * Why this is a script rather than an inline workflow step:
 *
 * The `Check licence compliance` step in `.github/workflows/security-audit.yml`
 * had no `if:` condition, so it was skipped whenever the preceding `npm audit`
 * step failed. `npm audit` has failed every week since at least 2026-09-07, so
 * the licence gate silently stopped running and a banned licence entering the
 * tree would not have been noticed.
 *
 * The workflow now runs this script with `if: always()`, so the gate executes
 * regardless of the audit result. Keeping the logic here (rather than inline)
 * means the gate can be run and tested locally with `npm run check-licences`,
 * and the workflow only has to decide *when* to run it, not *what* it does.
 *
 * Exit codes:
 *   0 — no banned licence found in the production dependency tree.
 *   1 — at least one production dependency uses a banned licence.
 *   2 — the check could not be completed (e.g. license-checker missing).
 *
 * The banned list and the `elkjs` exclusion are intentionally unchanged; see
 * the issue's "Out of scope" note.
 */
'use strict';

const { spawnSync } = require('child_process');

/**
 * Licences that must not appear in the production dependency tree.
 * Kept in step with the `--failOn` list previously inlined in the workflow.
 */
const BANNED_LICENCES = [
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'SSPL-1.0',
  'EUPL-1.1',
  'OSL-3.0',
  'CPAL-1.0',
  'CPL-1.0',
  'EPL-1.0',
  'EPL-2.0',
  'CDDL-1.0',
  'CDDL-1.1',
  'MPL-2.0',
];

/**
 * Packages excluded from the licence gate. `elkjs` is a transitive dependency
 * of the charting stack and is deliberately allowed; see the issue's
 * "Out of scope" note.
 */
const EXCLUDED_PACKAGES = ['elkjs@0.11.1'];

const FAIL_ON = BANNED_LICENCES.join(';');

/**
 * Builds the `license-checker` argument list. Exported so the banned list and
 * the `elkjs` exclusion can be asserted in tests without shelling out.
 */
function buildArgs() {
  return [
    'license-checker',
    '--production',
    '--excludePackages',
    EXCLUDED_PACKAGES.join(','),
    '--failOn',
    FAIL_ON,
    '--summary',
  ];
}

/**
 * Maps a `license-checker` process result to this script's exit code.
 *   0 — passed
 *   1 — banned licence found
 *   2 — check could not run
 */
function exitCodeFor(result) {
  if (result.error) {
    return 2;
  }
  return result.status === 0 ? 0 : 1;
}

function main() {
  const result = spawnSync('npx', buildArgs(), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const code = exitCodeFor(result);

  if (code === 2) {
    console.error(
      `Licence compliance check could not run: ${result.error.message}`,
    );
  } else if (code === 0) {
    console.log('Licence compliance check passed.');
  } else {
    console.error(
      'Licence compliance check FAILED: a production dependency uses a banned ' +
        `licence (${FAIL_ON}).`,
    );
    console.error(
      'Triage by replacing the dependency, or by adding a justified exclusion ' +
        'to EXCLUDED_PACKAGES in scripts/check-licences.js.',
    );
  }

  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = {
  BANNED_LICENCES,
  EXCLUDED_PACKAGES,
  FAIL_ON,
  buildArgs,
  exitCodeFor,
};
