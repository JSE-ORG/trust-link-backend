import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PackageIdentity {
  name: string;
  version: string;
}

/** Used only when package.json cannot be read at runtime. */
const FALLBACK_IDENTITY: PackageIdentity = {
  name: 'trustlink-backend',
  version: '1.0.0',
};

let cachedIdentity: PackageIdentity | undefined;

/** Reads name and semver from package.json (used by /health, /version). */
function getPackageIdentity(): PackageIdentity {
  if (cachedIdentity) return cachedIdentity;

  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageIdentity;
    cachedIdentity = { name: pkg.name, version: pkg.version };
    return cachedIdentity;
  } catch {
    return FALLBACK_IDENTITY;
  }
}

/** Semver from package.json (used by /health and /version). */
export function getAppVersion(): string {
  return getPackageIdentity().version;
}

/** Package name from package.json (used by /version). */
export function getAppName(): string {
  return getPackageIdentity().name;
}
