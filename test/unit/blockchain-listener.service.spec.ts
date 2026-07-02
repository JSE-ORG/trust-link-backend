import { Test } from '@nestjs/testing';
import {
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { BlockchainListenerService } from '../../src/stellar/blockchain-listener.service';

/**
 * Issue #49 — unit tests for Soroban contract-event parsing.
 *
 * The inputs are built from real XDR using the Stellar SDK so the tests
 * exercise genuine ScVal decoding (not hand-mocked shapes):
 *  - valid events convert topics/data into native JS values, and
 *  - unknown / corrupted buffers are skipped without throwing.
 */
describe('BlockchainListenerService — Soroban event parsing (issue #49)', () => {
  let service: BlockchainListenerService;

  // A valid (checksummed) Soroban contract address for topic fixtures.
  const CONTRACT = 'CDL2YMADSGGSAGLBYLDIGKJ6ASHAHMPK7MMFKTFMM2NM4TWNH42A446R';

  /** Encode a native value to a base64 XDR ScVal string (as RPC delivers it). */
  const toXdrBase64 = (val: xdr.ScVal): string => val.toXDR('base64');

  /** Symbol ScVal helper (event names are symbols by convention). */
  const sym = (s: string): xdr.ScVal => nativeToScVal(s, { type: 'symbol' });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [BlockchainListenerService],
    }).compile();
    service = moduleRef.get(BlockchainListenerService);
  });

  // ── Event arguments convert correctly to native structural variables ───────

  describe('valid event decoding', () => {
    it('decodes a transfer event: symbol topics + i128 amount data to native values', () => {
      const fromAddr = Address.fromString(CONTRACT);
      const topics = [
        sym('transfer'),
        nativeToScVal(fromAddr, { type: 'address' }),
      ];
      const value = nativeToScVal(1_000_000n, { type: 'i128' });

      const raw = {
        contractId: CONTRACT,
        type: 'contract',
        ledger: 42,
        topics: topics.map(toXdrBase64),
        value: toXdrBase64(value),
      };

      const parsed = service.parseEvent(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('transfer');
      expect(parsed!.topics[0]).toBe('transfer');
      // Address topic round-trips to its StrKey string.
      expect(parsed!.topics[1]).toBe(CONTRACT);
      // i128 decodes to a native bigint.
      expect(parsed!.data).toBe(1_000_000n);
      expect(parsed!.contractId).toBe(CONTRACT);
      expect(parsed!.ledger).toBe(42);
    });

    it('decodes a struct/map payload into a native object', () => {
      // nativeToScVal infers an ScMap from a plain object: bigint -> i128,
      // string -> string. The map round-trips back to a native object.
      const value = nativeToScVal({ amount: 250n, asset: 'USDC' });
      const raw = {
        topics: [toXdrBase64(sym('deposit'))],
        value: toXdrBase64(value),
      };

      const parsed = service.parseEvent(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('deposit');
      expect(parsed!.data).toEqual({ amount: 250n, asset: 'USDC' });
    });

    it('accepts already-decoded xdr.ScVal inputs (not only base64 strings)', () => {
      const raw = {
        topics: [sym('mint')],
        value: nativeToScVal(7n, { type: 'i128' }),
      };

      const parsed = service.parseEvent(raw);

      expect(parsed!.name).toBe('mint');
      expect(parsed!.data).toBe(7n);
    });

    it('handles an event with topics but no value (data = null)', () => {
      const raw = { topics: [toXdrBase64(sym('paused'))] };

      const parsed = service.parseEvent(raw);

      expect(parsed!.name).toBe('paused');
      expect(parsed!.data).toBeNull();
    });

    it('decodeScVal converts a single base64 ScVal to its native value', () => {
      const encoded = toXdrBase64(nativeToScVal('hello', { type: 'symbol' }));
      expect(service.decodeScVal(encoded)).toBe('hello');
    });

    it('exposes name as null when the first topic is not a symbol/scalar', () => {
      // First topic is a vector — not a symbol — so name cannot be derived.
      const vecTopic = nativeToScVal([1n, 2n], { type: 'i128' });
      const raw = { topics: [toXdrBase64(vecTopic)] };

      const parsed = service.parseEvent(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBeNull();
      expect(parsed!.topics[0]).toEqual([1n, 2n]);
    });
  });

  // ── Unknown / corrupted buffers ignored without breaking the pipeline ──────

  describe('corrupt / unknown event handling', () => {
    it('returns null for a corrupted base64 topic buffer (does not throw)', () => {
      const raw = {
        contractId: CONTRACT,
        topics: ['!!!not-valid-xdr!!!'],
        value: toXdrBase64(nativeToScVal(1n, { type: 'i128' })),
      };

      expect(() => service.parseEvent(raw)).not.toThrow();
      expect(service.parseEvent(raw)).toBeNull();
    });

    it('returns null for a corrupted value buffer', () => {
      const raw = {
        topics: [toXdrBase64(nativeToScVal('transfer', { type: 'symbol' }))],
        value: 'AAAA-garbage-not-xdr',
      };

      expect(service.parseEvent(raw)).toBeNull();
    });

    it('returns null for null / undefined / non-object input', () => {
      expect(service.parseEvent(null)).toBeNull();
      expect(service.parseEvent(undefined)).toBeNull();
      // @ts-expect-error — deliberately wrong type to prove runtime guard
      expect(service.parseEvent('not-an-object')).toBeNull();
    });

    it('treats a missing/non-array topics field as empty rather than crashing', () => {
      // @ts-expect-error — topics intentionally wrong type
      const parsed = service.parseEvent({ topics: 'oops', value: undefined });
      expect(parsed).not.toBeNull();
      expect(parsed!.topics).toEqual([]);
      expect(parsed!.name).toBeNull();
    });
  });

  // ── Batch parsing resilience ───────────────────────────────────────────────

  describe('parseEvents (batch)', () => {
    it('keeps the good events and drops corrupt ones in the same batch', () => {
      const good1 = {
        topics: [toXdrBase64(sym('transfer'))],
        value: toXdrBase64(nativeToScVal(1n, { type: 'i128' })),
      };
      const corrupt = { topics: ['totally-broken'], value: 'broken' };
      const good2 = {
        topics: [toXdrBase64(sym('approve'))],
        value: toXdrBase64(nativeToScVal(2n, { type: 'i128' })),
      };

      const parsed = service.parseEvents([good1, corrupt, good2]);

      // The corrupt event is dropped; the two good ones survive in order.
      expect(parsed).toHaveLength(2);
      expect(parsed.map((e) => e.name)).toEqual(['transfer', 'approve']);
    });

    it('returns an empty array for a non-array input', () => {
      // @ts-expect-error — deliberately wrong type
      expect(service.parseEvents(null)).toEqual([]);
    });

    it('returns an empty array when every event is corrupt (pipeline survives)', () => {
      const parsed = service.parseEvents([
        { topics: ['bad'] },
        null,
        { value: 'also-bad', topics: ['bad'] },
      ]);
      expect(parsed).toEqual([]);
    });

    it('catches unexpected handler failures and continues the batch', () => {
      const good = {
        topics: [toXdrBase64(sym('transfer'))],
        value: toXdrBase64(nativeToScVal(1n, { type: 'i128' })),
      };
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation();
      const originalParse = service.parseEvent.bind(service);
      jest
        .spyOn(service, 'parseEvent')
        .mockImplementationOnce(() => {
          throw new Error('unexpected parser failure');
        })
        .mockImplementationOnce((raw) => originalParse(raw));

      const parsed = service.parseEvents([{ type: 'contract' }, good]);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('transfer');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('blockchain.event.handler_failed'),
        expect.any(String),
      );
    });
  });

  // ── Sanity: our fixtures really are XDR the SDK round-trips ────────────────

  it('sanity check: SDK round-trips our fixture encoding', () => {
    const encoded = nativeToScVal(123n, { type: 'i128' }).toXDR('base64');
    const decoded = scValToNative(xdr.ScVal.fromXDR(encoded, 'base64'));
    expect(decoded).toBe(123n);
  });
});
