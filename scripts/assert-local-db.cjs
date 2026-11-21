'use strict';
require('dotenv').config({ quiet: true });
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', 'db', 'db-prod']);
function assertLocalDatabase(env = process.env) {
  if (env.ALLOW_DB_RESET === '1') return;
  if (env.NODE_ENV === 'production') throw new Error('Database reset/seed refused: NODE_ENV=production. ALLOW_DB_RESET=1 is required for an explicitly authorized operation.');
  if (!env.DATABASE_URL) throw new Error('Database reset/seed refused: DATABASE_URL is missing.');
  let hostname;
  try {
    const parsed = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    hostname = parsed.hostname.toLowerCase();
  } catch { throw new Error('Database reset/seed refused: invalid DATABASE_URL.'); }
  if (!ALLOWED_HOSTS.has(hostname)) throw new Error(`Database reset/seed refused: "${hostname}" is not an approved local/Compose host. ALLOW_DB_RESET=1 is required for an explicitly authorized operation.`);
}
if (require.main === module) {
  try { assertLocalDatabase(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assertLocalDatabase };
