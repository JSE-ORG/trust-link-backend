import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cachedVersion: string | undefined;

/** Reads semver from package.json (used by /health and /version). */
export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      version: string;
    };
    cachedVersion = pkg.version;
    return cachedVersion;
  } catch {
    return '1.0.0';
  }
}
