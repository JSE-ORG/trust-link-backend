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

@Injectable()
export class SorobanPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SorobanPollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** Poll interval in ms. Validated and defaulted (5000) by the config schema. */
  private readonly pollIntervalMs: number;
  /** Per-request RPC timeout in ms. Validated and defaulted (4000) by the config schema. */
  private readonly rpcTimeoutMs: number;
  private readonly rpcUrl: string;
  private readonly contractId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly blockchainListener: BlockchainListenerService,
    private readonly cursorService: CursorService,
    private readonly escrowService: EscrowService,
  ) {
    this.rpcUrl = this.resolveRpcUrl();
    this.contractId = this.config.get('CONTRACT_ID') ?? '';
    this.pollIntervalMs = this.config.get('SOROBAN_POLL_INTERVAL_MS');
    this.rpcTimeoutMs = this.config.get('SOROBAN_RPC_TIMEOUT_MS');
  }

  onModuleInit(): void {
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
   * state machine. Advances the cursor after successful batch processing.
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
        await this.processEvent(raw);
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
   * Contract topic layout (base64-encoded XDR ScVals):
   *   topics[0] = Symbol("Escrow" | "Dispute" | "Auto")
   *   topics[1] = Symbol("Funded" | "Shipped" | "Completed" | "Raised" | "Resolved" | "Released")
   *
   * Mapping:
   *   ("Escrow",  "Funded")   → EscrowFunded
   *   ("Escrow",  "Shipped")  → EscrowShipped
   *   ("Escrow",  "Completed")→ EscrowCompleted
   *   ("Dispute", "Raised")   → DisputeRaised
   *   ("Dispute", "Resolved") → DisputeResolved
   *   ("Auto",    "Released") → AutoReleased
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
    if (!parsed) return;

    // Derive the event name from both topic symbols.
    const topic0 =
      typeof parsed.topics[0] === 'string' ? parsed.topics[0] : null;
    const topic1 =
      typeof parsed.topics[1] === 'string' ? parsed.topics[1] : null;

    if (!topic0 || !topic1) {
      this.logger.warn(
        `SorobanPollerService: skipping event with non-string topics [${String(parsed.topics[0])}, ${String(parsed.topics[1])}]`,
      );
      return;
    }

    const eventType = `${topic0}${topic1}`;

    // The contract value payload is expected to contain { escrowId, ...extras }.
    const data = parsed.data as Record<string, unknown> | null;
    const escrowId = typeof data?.escrowId === 'string' ? data.escrowId : null;

    if (!escrowId) {
      this.logger.warn(
        `SorobanPollerService: skipping event "${eventType}" — missing escrowId in payload`,
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
    } catch (err) {
      this.logger.error(
        `SorobanPollerService: syncStateFromChain failed for event "${eventType}" escrow "${escrowId}"`,
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
    const configured = this.config.get('SOROBAN_RPC_URL');
    if (configured) return configured;

    if (this.config.isProduction()) {
      // Backstop only: config validation already rejects this at startup.
      throw new Error(
        'SOROBAN_RPC_URL is required in production — refusing to fall back to a default RPC endpoint',
      );
    }

    this.logger.warn(
      `SorobanPollerService: SOROBAN_RPC_URL not set — defaulting to public testnet RPC ${DEFAULT_TESTNET_RPC_URL}`,
    );
    return DEFAULT_TESTNET_RPC_URL;
  }
}
