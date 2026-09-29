/**
 * Installs this repository's Git hooks by pointing `core.hooksPath` at
 * `.githooks/`, which is where `pre-commit` lives.
 *
 * Wired to the `prepare` lifecycle script, which npm runs after `npm ci` and
 * `npm install`, so a fresh clone gets the hooks with no extra setup step and
 * nothing to remember.
 *
 * Skipped in CI. CI never commits, so the hooks would never fire, and a
 * `git config` write against a throwaway Actions checkout is pure noise.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join('.githooks');

if (process.env.CI) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
} catch {
  // Not a Git checkout — e.g. installing from a published tarball, or a
  // sandbox with no `git` on PATH. Nothing to install, and `npm ci` must
  // still succeed, so warn and move on.
  console.warn(
    'trustlink-backend: could not set core.hooksPath — pre-commit hooks are not active.',
  );
}
