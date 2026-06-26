import { Injectable, Logger } from '@nestjs/common';
import { scValToNative, xdr } from '@stellar/stellar-sdk';

/**
 * Issue #49 – Parsing of raw Soroban contract events emitted by the network.
 *
 * Soroban events arrive as XDR-encoded structures: a list of `topics` (each an
 * `ScVal`) plus a `value` (`ScVal`) payload. The RPC/Horizon JSON representation
 * delivers these as base64-encoded XDR strings. This service converts those raw
 * extractions into native JavaScript values so the rest of the pipeline can work
 * with plain objects instead of XDR.
 *
 * Robustness is a first-class requirement: a single malformed or unknown event
 * must never throw and break the ingestion loop — such events are logged and
 * skipped (parse returns `null`).
 */

/** Shape of a single raw event as delivered by Soroban RPC (`getEvents`). */
export interface RawSorobanEvent {
  /** The emitting contract address (StrKey `C...`). */
  contractId?: string;
  /** Event type, e.g. `contract` / `system` / `diagnostic`. */
  type?: string;
  /** Ledger sequence the event was emitted in. */
  ledger?: number;
  /** Base64-encoded XDR `ScVal` topics, or already-decoded `xdr.ScVal`s. */
  topics?: Array<string | xdr.ScVal>;
  /** Base64-encoded XDR `ScVal` value, or an already-decoded `xdr.ScVal`. */
  value?: string | xdr.ScVal;
}

/** A parsed event with topics and data converted to native JS values. */
export interface ParsedSorobanEvent {
  contractId?: string;
  type?: string;
  ledger?: number;
  /** The first topic, by convention the event name (e.g. `transfer`). */
  name: string | null;
  /** All topics converted to native values. */
  topics: unknown[];
  /** The event payload converted to a native value. */
  data: unknown;
}

@Injectable()
export class BlockchainListenerService {
  private readonly logger = new Logger(BlockchainListenerService.name);

  /**
   * Decode one `ScVal` (supplied as base64 XDR or an `xdr.ScVal`) to a native
   * JS value. Returns `null` when the buffer cannot be decoded.
   */
  decodeScVal(input: string | xdr.ScVal): unknown {
    const scVal =
      typeof input === 'string'
        ? xdr.ScVal.fromXDR(input, 'base64')
        : input;
    return scValToNative(scVal);
  }

  /**
   * Parse a single raw Soroban event into native values.
   *
   * @returns the parsed event, or `null` if the event is unknown/corrupted.
   *          Never throws — callers can safely map over a batch.
   */
  parseEvent(raw: RawSorobanEvent | null | undefined): ParsedSorobanEvent | null {
    if (!raw || typeof raw !== 'object') {
      this.logger.warn(
        JSON.stringify({ msg: 'blockchain.event.skipped', reason: 'empty' }),
      );
      return null;
    }

    try {
      const rawTopics = Array.isArray(raw.topics) ? raw.topics : [];
      const topics = rawTopics.map((t) => this.decodeScVal(t));
      const data = raw.value !== undefined ? this.decodeScVal(raw.value) : null;

      // The first topic is, by Soroban convention, the event name symbol.
      const name =
        typeof topics[0] === 'string' || typeof topics[0] === 'number'
          ? String(topics[0])
          : null;

      return {
        contractId: raw.contractId,
        type: raw.type,
        ledger: raw.ledger,
        name,
        topics,
        data,
      };
    } catch (err) {
      // Corrupt / unknown buffer: log and skip without breaking the pipeline.
      this.logger.warn(
        JSON.stringify({
          msg: 'blockchain.event.parse_failed',
          contractId: raw.contractId,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    }
  }

  /**
   * Parse a batch of raw events, dropping any that fail to parse. The returned
   * array contains only the events that decoded cleanly — corrupt entries are
   * silently filtered so a bad event cannot abort processing of the good ones.
   */
  parseEvents(rawEvents: Array<RawSorobanEvent | null | undefined>): ParsedSorobanEvent[] {
    if (!Array.isArray(rawEvents)) return [];
    const parsed: ParsedSorobanEvent[] = [];
    for (const raw of rawEvents) {
      const event = this.parseEvent(raw);
      if (event) parsed.push(event);
    }
    return parsed;
  }
}
