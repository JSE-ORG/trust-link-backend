import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  BlockchainListenerService,
  RawSorobanEvent,
} from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { EscrowService } from '../escrow/escrow.service';
import { DlqService } from '../dlq/dlq.service';

/**
 * Issue #4 — Polls Soroban RPC for contract events and drives EscrowService.syncStateFromChain.
 *
 * The contract emits two-symbol topic tuples, e.g.:
 *   (Symbol("Escrow"), Symbol("Funded"))
 *   (Symbol("Dispute"), Symbol("Raised"))
 *
 * The event name sent to syncStateFromChain is derived by concatenating both
 * topic symbols, matching the names the switch-statement in EscrowService expects:
 *   "Escrow" + "Funded"  → "EscrowFunded"
 *   "Dispute" + "Raised" → "DisputeRaised"
 *   "Auto"   + "Released"→ "AutoReleased"
 */

/**
 * Public testnet RPC endpoint, used only outside production when
 * SOROBAN_RPC_URL is unset. Production deployments must configure the URL
 * explicitly — config validation enforces this at startup.
 */
const DEFAULT_TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';

/**
 * How many ledgers behind the current one a fresh deployment starts polling
 * from. Soroban RPC nodes retain only a short window of events (~24h), so
 * asking for the genesis ledger is rejected outright; starting just behind
 * "now" keeps the first request inside the retention window.
 */
const START_LEDGER_MARGIN = 10;

/**
 * Prefix marking a persisted cursor that holds a start ledger rather than an
 * RPC paging token. getEvents takes the two as different parameters, and the
 * chosen start ledger must be persisted immediately so a restart resumes from
 * the same point instead of skipping forward to a new "now".
 */
const LEDGER_CURSOR_PREFIX = 'ledger:';

/** Minimal shape of a Soroban RPC getEvents response entry. */
interface SorobanRpcEvent {
  id: string;
  contractId: string;
  type: string;
  ledger: number;
  pagingToken: string;
  topic: string[];
  value: string;
}

/** Minimal shape of the Soroban RPC getEvents response. */
interface GetEventsResponse {
  events: SorobanRpcEvent[];
  latestLedger: number;
}

/**
 * Issue #554: how many times `syncStateFromChain` is allowed to throw for the
 * *same* event (tracked by its Soroban event id, which is stable across
 * re-fetches of the same paging window) before it's dead-lettered instead of
 * continuing to block the cursor forever. Chosen to comfortably outlast a
 * transient blip (a DB reconnect, a momentary lock contention) — which
 * resolves in a poll cycle or two — while still catching a genuinely
 * malformed/unprocessable event within a few minutes at the default 5s poll
 * interval, rather than blocking every escrow behind it indefinitely.
 */
/**
 * Topic pairs whose naive concatenation does not match a `syncStateFromChain`
 * case. The contract emits auto-release under ("Escrow", "Released"), which
 * concatenates to "EscrowReleased"; the handler's case is "AutoReleased".
 */
const EVENT_TYPE_OVERRIDES: Readonly<Record<string, string>> = {
  EscrowReleased: 'AutoReleased',
};

/**
 * Normalises a contract `u64` escrow id to bigint.
 *
 * A u64 exceeds Number.MAX_SAFE_INTEGER at the top of its range, so decoders
 * hand it back as a number for small values, a bigint or decimal string for
 * large ones. Anything that is not a non-negative integer is rejected rather
 * than coerced: a wrong id would address someone else's escrow.
 */
function toContractEscrowId(value: unknown): bigint | null {
  try {
    if (typeof value === 'bigint') {
      return value >= 0n ? value : null;
    }
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return BigInt(value);
    }
  } catch {
    return null;
  }
  return null;
}

const MAX_SYNC_RETRIES = 5;

@Injectable()
export class SorobanPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SorobanPollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** Poll interval in ms. Validated and defaulted (5000) by the config schema. */
  /**
   * Issue #554: per-event-id retry counter for syncStateFromChain failures.
   * In-memory and per-process by design — a restart resetting this just
   * means a permanently-broken event gets a few bonus retries before
   * tripping MAX_SYNC_RETRIES again, which is harmless; it does not affect
   * correctness of *which* events get applied or in what order.
   */
  private readonly syncRetryCounts = new Map<string, number>();

  /** Default poll interval in milliseconds (5 s). Configurable via SOROBAN_POLL_INTERVAL_MS. */
  private readonly pollIntervalMs: number;
  /** Per-request RPC timeout in ms. Validated and defaulted (4000) by the config schema. */
  private readonly rpcTimeoutMs: number;
  /** Whether the polling interval should start on module init. */
  private readonly enabled: boolean;
  private readonly rpcUrl: string;
  private readonly contractId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly blockchainListener: BlockchainListenerService,
    private readonly cursorService: CursorService,
    private readonly escrowService: EscrowService,
    private readonly dlqService: DlqService,
  ) {
    this.rpcUrl = this.resolveRpcUrl();
    this.contractId = this.config.get('CONTRACT_ID') ?? '';
    this.pollIntervalMs = this.config.get('SOROBAN_POLL_INTERVAL_MS');
    this.rpcTimeoutMs = this.config.get('SOROBAN_RPC_TIMEOUT_MS');
    this.enabled = this.config.get('SOROBAN_POLLER_ENABLED') !== false;
  }

  onModuleInit(): void {
    // An explicit switch, not an environment sniff: a background interval that
    // issues real RPC requests is unwanted in any process that only boots the
    // module to serve requests or run a spec, and leaving it running holds the
    // process open after the work is done.
    if (!this.enabled) {
      this.logger.log(
        'SorobanPollerService: disabled via SOROBAN_POLLER_ENABLED',
      );
      return;
    }
    if (!this.contractId) {
      this.logger.warn(
        'SorobanPollerService: CONTRACT_ID not set — poller disabled',
      );
      return;
    }
    this.logger.log(
      `SorobanPollerService: starting poll every ${this.pollIntervalMs}ms on ${this.rpcUrl}`,
    );
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    // Kick off immediately without waiting for the first interval tick.
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Single poll cycle: fetch new contract events from Soroban RPC, parse them,
   * derive event names from the two-symbol topic tuple, and drive the escrow
   * state machine. Advances the cursor only past events that were actually
   * applied (or legitimately dead-lettered as unprocessable) — see
   * `processEvent`'s doc comment for the stop-at-first-failure rationale.
   */
  async poll(): Promise<void> {
    if (this.polling) return; // skip if previous tick is still running
    this.polling = true;

    try {
      let cursor = await this.cursorService.get();
      if (!cursor) {
        const startLedger = await this.resolveStartLedger();
        cursor = `${LEDGER_CURSOR_PREFIX}${startLedger}`;
        // Persist before the first fetch so a restart resumes from this
        // ledger instead of computing a new starting point and skipping the
        // gap.
        await this.cursorService.set(cursor);
        this.logger.log(
          `SorobanPollerService: no cursor stored — starting from ledger ${startLedger}`,
        );
      }
      const rawEvents = await this.fetchEvents(cursor);

      if (rawEvents.length === 0) {
        return;
      }

      this.logger.debug(
        `SorobanPollerService: received ${rawEvents.length} event(s)`,
      );

      let lastPagingToken: string | undefined;

      for (const raw of rawEvents) {
        try {
          await this.processEvent(raw);
        } catch (err) {
          // Issue #554: stop advancing the cursor at the first event that
          // couldn't be applied. The batch is fetched in ledger order and
          // syncStateFromChain's own switch cases assume prior transitions
          // already landed (e.g. EscrowShipped assumes EscrowFunded already
          // happened) — continuing past a failure and applying later events
          // out of order risks a worse, harder-to-detect state-machine bug
          // than the at-least-once redelivery this trades for. The next
          // poll cycle re-fetches from the same (unmoved) cursor and
          // retries this exact event first.
          this.logger.error(
            `SorobanPollerService: stopping batch at event "${raw.id}" — will retry next poll cycle`,
            err instanceof Error ? err.stack : String(err),
          );
          break;
        }
        lastPagingToken = raw.pagingToken;
      }

      if (lastPagingToken) {
        await this.cursorService.set(lastPagingToken);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('timed out')) {
        // Logged distinctly from other failures: the request was aborted by
        // our own timeout, and the next tick will retry normally.
        this.logger.warn(`SorobanPollerService: ${message}`);
      } else {
        this.logger.error(
          'SorobanPollerService: poll cycle failed',
          err instanceof Error ? err.stack : String(err),
        );
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Fetch contract events from the Soroban RPC `getEvents` endpoint.
   * A `ledger:`-prefixed cursor (written on first run) is sent as
   * `startLedger`; anything else is an RPC paging token and is sent as
   * `cursor`.
   */
  private async fetchEvents(cursor: string): Promise<SorobanRpcEvent[]> {
    const result = await this.rpcRequest<GetEventsResponse>('getEvents', {
      filters: [
        {
          type: 'contract',
          contractIds: [this.contractId],
        },
      ],
      ...(cursor.startsWith(LEDGER_CURSOR_PREFIX)
        ? { startLedger: Number(cursor.slice(LEDGER_CURSOR_PREFIX.length)) }
        : { cursor }),
      limit: 100,
    });

    return result?.events ?? [];
  }

  /**
   * Choose the first ledger to poll from when no cursor is stored.
   *
   * Starting from "now" (minus a small safety margin) is a documented
   * decision: events emitted before the backend was first deployed are
   * intentionally never read. Operators can override the starting point with
   * SOROBAN_START_LEDGER to replay from a known ledger after an outage, as
   * long as it is still inside the node's retention window.
   */
  private async resolveStartLedger(): Promise<number> {
    const configured = this.config.get('SOROBAN_START_LEDGER');
    if (configured) {
      this.logger.log(
        `SorobanPollerService: using configured SOROBAN_START_LEDGER ${configured}`,
      );
      return Number(configured);
    }

    const latest = await this.getLatestLedger();
    return Math.max(1, latest - START_LEDGER_MARGIN);
  }

  /** Current ledger sequence from the Soroban RPC `getLatestLedger` endpoint. */
  private async getLatestLedger(): Promise<number> {
    const result = await this.rpcRequest<{ sequence: number }>(
      'getLatestLedger',
      {},
    );
    if (!result || typeof result.sequence !== 'number') {
      throw new Error(
        'Soroban RPC getLatestLedger returned no ledger sequence',
      );
    }
    return result.sequence;
  }

  /**
   * Issue a JSON-RPC request bounded by SOROBAN_RPC_TIMEOUT_MS, following the
   * AbortController pattern used by checkHorizon in app.controller.ts.
   * Without the abort, a request that never settles would leave the `polling`
   * guard set forever and silently stop event ingestion while the process
   * still reports healthy.
   */
  private async rpcRequest<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.rpcTimeoutMs);

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Soroban RPC responded with HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const json = (await response.json()) as {
        result?: T;
        error?: { message: string };
      };

      if (json.error) {
        // A start ledger outside the node's short retention window is a
        // configuration/replay problem, not a transient network failure —
        // keep the two distinguishable in the logs.
        if (/start.?ledger|ledger range|retention/i.test(json.error.message)) {
          throw new Error(
            `Soroban RPC retention error — requested ledger is outside the node's retention window: ${json.error.message}`,
          );
        }
        throw new Error(`Soroban RPC error: ${json.error.message}`);
      }

      return json.result;
    } catch (err) {
      // Node's fetch rejects with a DOMException (which is not an Error
      // subclass) when aborted, so match on the name rather than the class.
      const isAbort =
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: unknown }).name === 'AbortError';
      if (isAbort) {
        throw new Error(
          `Soroban RPC request "${method}" timed out after ${this.rpcTimeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse and dispatch a single raw event. The event name is derived from both
   * topic symbols to match the switch cases in EscrowService.syncStateFromChain.
   *
   * Contract topic layout (base64-encoded XDR ScVals), verified against
   * `contracts/escrow/src/events.rs` in trust-link-contract:
   *   topics[0] = Symbol("Escrow" | "Dispute")
   *   topics[1] = Symbol("Funded" | "Shipped" | "Completed" | "Delivered" |
   *                      "Released" | "Canceled" | "Raised" | "Resolved")
   *   topics[2] = Address (an actor, e.g. the seller) — unused here
   *
   * Mapping:
   *   ("Escrow",  "Funded")   → EscrowFunded
   *   ("Escrow",  "Shipped")  → EscrowShipped
   *   ("Escrow",  "Completed")→ EscrowCompleted
   *   ("Dispute", "Raised")   → DisputeRaised
   *   ("Dispute", "Resolved") → DisputeResolved
   *   ("Escrow",  "Released") → AutoReleased   (see EVENT_TYPE_OVERRIDES)
   *
   * Note the last one. This previously documented `("Auto", "Released")`, a
   * topic pair the contract never emits: `emit_auto_released` publishes
   * `(symbol_short!("Escrow"), symbol_short!("Released"), seller)`. Naive
   * concatenation yields "EscrowReleased", which `syncStateFromChain` has no
   * case for, so a confirmed auto-release would have been dropped.
   *
   * Issue #554 — two distinct failure classes, handled differently:
   *
   *   1. The event is *legitimately not applicable* (unparseable payload,
   *      non-string topics, missing escrowId). This is not a condition a
   *      retry can ever fix — the bytes on-chain don't change — so it's
   *      dead-lettered via DlqService.enqueue for admin review and this
   *      method returns normally. The caller (poll()) advances the cursor
   *      past it: retrying forever would permanently wedge the poller
   *      behind one bad event.
   *
   *   2. syncStateFromChain itself throws (DB error, unexpected exception).
   *      This might well be transient, so by default this method rethrows,
   *      which tells poll() to stop the batch and retry this exact event
   *      next cycle (see poll()'s doc comment for why "stop", not
   *      "continue past it"). To avoid retrying a permanently-broken event
   *      forever, a per-event-id counter trips MAX_SYNC_RETRIES: once
   *      exceeded, this is *also* dead-lettered and treated as handled
   *      (returns normally) so the cursor can move on.
   */
  private async processEvent(raw: SorobanRpcEvent): Promise<void> {
    const rpcEvent: RawSorobanEvent = {
      contractId: raw.contractId,
      type: raw.type,
      ledger: raw.ledger,
      topics: raw.topic,
      value: raw.value,
    };

    const parsed = this.blockchainListener.parseEvent(rpcEvent);
    if (!parsed) {
      await this.deadLetter(raw, null, 'event payload could not be parsed');
      return;
    }

    // Derive the event name from both topic symbols.
    const topic0 =
      typeof parsed.topics[0] === 'string' ? parsed.topics[0] : null;
    const topic1 =
      typeof parsed.topics[1] === 'string' ? parsed.topics[1] : null;

    if (!topic0 || !topic1) {
      await this.deadLetter(
        raw,
        null,
        `non-string topics [${String(parsed.topics[0])}, ${String(parsed.topics[1])}]`,
      );
      return;
    }

    const rawEventType = `${topic0}${topic1}`;
    const eventType = EVENT_TYPE_OVERRIDES[rawEventType] ?? rawEventType;

    // The contract payload is a #[contracttype] struct whose id field is
    // `escrow_id: u64`, not `escrowId: string`. Across the XDR boundary a u64
    // arrives as a number, a bigint, or a decimal string depending on
    // magnitude and decoder, so accept all three and normalise to bigint.
    const data = parsed.data as Record<string, unknown> | null;
    const contractEscrowId = toContractEscrowId(data?.escrow_id);

    if (contractEscrowId === null) {
      await this.deadLetter(
        raw,
        null,
        `event "${eventType}" payload is missing a usable escrow_id ` +
          `(got ${JSON.stringify(data?.escrow_id ?? null)})`,
      );
      return;
    }

    // The contract mints its own u64; the backend mints a UUID. Escrow.
    // contractEscrowId is the join. An unmapped id is not retryable, so it is
    // dead-lettered rather than left to spin.
    const escrowId =
      await this.escrowService.findIdByContractEscrowId(contractEscrowId);

    if (!escrowId) {
      await this.deadLetter(
        raw,
        null,
        `event "${eventType}" references contract escrow ` +
          `${contractEscrowId.toString()}, which maps to no backend escrow`,
      );
      return;
    }

    try {
      await this.escrowService.syncStateFromChain({
        eventType,
        escrowId,
        trackingId:
          typeof data?.trackingId === 'string' ? data.trackingId : undefined,
        txHash: typeof data?.txHash === 'string' ? data.txHash : undefined,
        reason: typeof data?.reason === 'string' ? data.reason : undefined,
      });
      this.syncRetryCounts.delete(raw.id);
    } catch (err) {
      const attempts = (this.syncRetryCounts.get(raw.id) ?? 0) + 1;
      this.syncRetryCounts.set(raw.id, attempts);

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `SorobanPollerService: syncStateFromChain failed for event "${eventType}" escrow "${escrowId}" (attempt ${attempts}/${MAX_SYNC_RETRIES})`,
        err instanceof Error ? err.stack : message,
      );

      if (attempts >= MAX_SYNC_RETRIES) {
        this.syncRetryCounts.delete(raw.id);
        await this.deadLetter(
          raw,
          escrowId,
          `syncStateFromChain failed ${attempts} times for event "${eventType}": ${message}`,
        );
        return;
      }

      // Under threshold — rethrow so poll() stops the batch here and
      // retries this same event on the next cycle.
      throw err;
    }
  }

  /**
   * Records an event this poller could not apply — either because it will
   * never be applicable (malformed payload) or because it exhausted its
   * sync retries — in the existing DLQ surface (issue #303) rather than a
   * second, bespoke mechanism, per #554's own guidance.
   */
  private async deadLetter(
    raw: SorobanRpcEvent,
    escrowId: string | null,
    reason: string,
  ): Promise<void> {
    try {
      await this.dlqService.enqueue({
        operation: 'soroban_event_sync',
        escrowId,
        errorMessage: reason,
        ledgerFeedback: {
          eventId: raw.id,
          contractId: raw.contractId,
          type: raw.type,
          ledger: raw.ledger,
          pagingToken: raw.pagingToken,
          topic: raw.topic,
        },
      });
    } catch (err) {
      // DLQ persistence itself failed — this is the one case worth not
      // swallowing quietly, since it means the event is about to be
      // silently lost (cursor still advances past it after this returns).
      this.logger.error(
        `SorobanPollerService: failed to dead-letter event "${raw.id}" — it will be skipped without a DLQ record`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Resolve the Soroban RPC URL. An explicitly configured SOROBAN_RPC_URL
   * always wins. Without one, production refuses to start rather than guess
   * an endpoint, and every other environment falls back to the public
   * testnet RPC with a clear log line saying so.
   */
  private resolveRpcUrl(): string {
    const configured = this.config.get<string>('SOROBAN_RPC_URL');
    if (configured) return configured;

    const nodeEnv = this.config.get<string>('NODE_ENV');
    const stellarNetwork = this.config.get<'TESTNET' | 'MAINNET'>(
      'STELLAR_NETWORK',
    );
    const isProduction =
      nodeEnv === 'production' || this.config.isProduction?.() === true;

    if (isProduction) {
      // Backstop only: config validation already rejects this at startup.
      throw new Error(
        'SOROBAN_RPC_URL is required in production — refusing to fall back to a default RPC endpoint',
      );
    }

    if (stellarNetwork === 'MAINNET') {
      return 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc';
    }

    this.logger.warn(
      `SorobanPollerService: SOROBAN_RPC_URL not set — defaulting to public testnet RPC ${DEFAULT_TESTNET_RPC_URL}`,
    );
    return DEFAULT_TESTNET_RPC_URL;
  }
}
