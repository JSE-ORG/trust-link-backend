/**
 * Pre-commit hook helper.
 *
 * Runs `eslint --fix` over the staged `.ts` files only, then re-stages whatever
 * ESLint rewrote so the commit records the formatted result instead of the
 * unformatted blob that was originally added.
 *
 * Invoked by `.githooks/pre-commit`, which is installed by
 * `scripts/install-hooks.js` through the `prepare` lifecycle script.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ESLINT_BIN = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'eslint.cmd' : 'eslint',
);

/**
 * Names of the staged files that ESLint is allowed to look at.
 *
 * `--diff-filter=ACMR` keeps Added, Copied, Modified and Renamed entries:
 * a Deleted file has nothing left on disk to lint. `-z` separates with NUL so
 * paths containing spaces or quotes survive intact.
 */
function stagedTypeScriptFiles() {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  return output.split('\0').filter((file) => file.endsWith('.ts'));
}

/** Staged `.ts` files that ESLint rewrote in the working tree. */
function changedAfterFix(files) {
  const output = execFileSync('git', ['diff', '--name-only', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .filter((file) => file !== '' && files.includes(file));
}

function main() {
  if (!fs.existsSync(ESLINT_BIN)) {
    console.error(
      'eslint is not installed, so staged files cannot be formatted. Run `npm ci` first.',
    );
    process.exit(1);
  }

  const files = stagedTypeScriptFiles();
  if (files.length === 0) {
    return;
  }

  // Mirrors the ESLint invocation used in .github/workflows/lint.yml.
  execFileSync(ESLINT_BIN, ['--fix', ...files], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'true' },
  });

  // `--fix` edits files in place, so the index still holds the pre-format
  // copy. Re-stage only the files that actually changed, leaving every other
  // staged file untouched.
  const reformatted = changedAfterFix(files);
  if (reformatted.length > 0) {
    execFileSync('git', ['add', '--', ...reformatted], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    console.log(
      `pre-commit: formatted ${reformatted.length} staged file(s) with eslint --fix.`,
    );
  }
}

main();
