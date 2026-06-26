import { resolveWorkflow } from '../../src/tracing/tracing.middleware';

describe('resolveWorkflow (issue #79)', () => {
  it('maps escrow routes', () => {
    expect(resolveWorkflow('POST', '/escrow')).toBe('escrow.post');
    expect(resolveWorkflow('GET', '/escrow/abc-123')).toBe('escrow.get');
  });

  it('maps vendor routes', () => {
    expect(resolveWorkflow('GET', '/vendor/escrows')).toBe('vendor.get');
  });

  it('maps sep10 auth routes', () => {
    expect(resolveWorkflow('GET', '/auth/sep10/challenge')).toBe('sep10.get');
  });

  it('maps stellar webhook', () => {
    expect(resolveWorkflow('POST', '/webhooks/stellar')).toBe(
      'webhook.stellar',
    );
  });

  it('maps admin routes', () => {
    expect(resolveWorkflow('GET', '/admin/stats')).toBe('admin.stats');
    expect(resolveWorkflow('GET', '/admin/queues')).toBe('admin.queues');
  });

  it('maps health and version', () => {
    expect(resolveWorkflow('GET', '/health')).toBe('health.check');
    expect(resolveWorkflow('GET', '/version')).toBe('version.check');
  });

  it('strips query strings', () => {
    expect(resolveWorkflow('GET', '/escrow?page=1')).toBe('escrow.get');
  });
});
