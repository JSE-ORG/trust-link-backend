/**
 * Teaches `JSON.stringify` how to serialise BigInt.
 *
 * `Escrow.contractEscrowId` is the Soroban contract's `u64`, so Prisma hands it
 * back as a BigInt and it travels on `EscrowRecord`. `JSON.stringify` throws
 * "Do not know how to serialize a BigInt" on any value it does not know, which
 * would turn every endpoint returning an escrow into a 500.
 *
 * Serialised as a decimal string rather than a number on purpose: a u64 runs to
 * 2^64-1, well past Number.MAX_SAFE_INTEGER, so a JSON number would silently
 * lose precision at the top of the range.
 *
 * Imported for its side effect. Keep the import in `main.ts` and in the jest
 * setup file so runtime and tests behave identically.
 */
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

if (typeof BigInt.prototype.toJSON !== 'function') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint): string {
      return this.toString();
    },
    writable: true,
    configurable: true,
  });
}

export {};
