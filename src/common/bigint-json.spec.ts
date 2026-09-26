/**
 * The BigInt JSON polyfill is imported for its side effect from `main.ts` and
 * from the jest setup file, so `BigInt.prototype.toJSON` is already installed
 * by the time any spec runs. Both branches of the install guard are exercised
 * here by loading the module in isolated registries: once with the method
 * removed (installs it) and once with it present (leaves it alone).
 */
describe('bigint-json polyfill guard', () => {
  const original = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON');

  afterEach(() => {
    if (original) {
      Object.defineProperty(BigInt.prototype, 'toJSON', original);
    } else {
      delete (BigInt.prototype as { toJSON?: unknown }).toJSON;
    }
  });

  it('installs toJSON when it is absent and serialises a bigint as a decimal string', async () => {
    delete (BigInt.prototype as { toJSON?: unknown }).toJSON;
    expect(typeof BigInt.prototype.toJSON).not.toBe('function');

    await jest.isolateModulesAsync(async () => {
      await import('./bigint-json');
    });

    expect(typeof BigInt.prototype.toJSON).toBe('function');
    expect(JSON.stringify({ id: 18446744073709551615n })).toBe(
      '{"id":"18446744073709551615"}',
    );
  });

  it('does not reinstall toJSON when a serialiser is already present', async () => {
    const existing = function (this: bigint): string {
      return `existing:${this.toString()}`;
    };
    Object.defineProperty(BigInt.prototype, 'toJSON', {
      value: existing,
      writable: true,
      configurable: true,
    });

    await jest.isolateModulesAsync(async () => {
      await import('./bigint-json');
    });

    expect(BigInt.prototype.toJSON).toBe(existing);
    expect(JSON.stringify(7n)).toBe('"existing:7"');
  });
});
