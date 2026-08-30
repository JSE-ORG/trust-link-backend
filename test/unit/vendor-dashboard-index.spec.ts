import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '../..');

function readRepoFile(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), 'utf8');
}

describe('vendor dashboard composite index (#309)', () => {
  it('declares the vendorAddress/state index on the Escrow model', () => {
    const schema = readRepoFile('prisma', 'schema.prisma');
    expect(schema).toContain('@@index([vendorAddress, state])');
  });

  it('ships an idempotent migration for the dashboard index', () => {
    const migration = readRepoFile(
      'prisma',
      'migrations',
      '20260701000000_vendor_dashboard_vendor_state_index',
      'migration.sql',
    );

    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "Escrow_vendorAddress_state_idx"',
    );
    expect(migration).toContain('ON "Escrow"("vendorAddress", "state")');
  });

  it('keeps EXPLAIN ANALYZE probes and benchmark notes for the dashboard path', () => {
    const script = readRepoFile('scripts', 'query-performance.sql');
    const docs = readRepoFile('docs', 'QUERY_PERFORMANCE.md');

    expect(script).toContain('vendor_escrows_by_state_recent');
    expect(script).toContain('Escrow_vendorAddress_state_idx');
    expect(script).toContain('EXPLAIN (ANALYZE, BUFFERS, VERBOSE)');

    expect(docs).toContain('Vendor Dashboard Index Verification');
    expect(docs).toContain('GET /vendor/escrows');
    expect(docs).toContain('before/after benchmark');
  });
});
