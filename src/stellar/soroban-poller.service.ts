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
      const cursor = await this.cursorService.get();
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
   * Resumes from the persisted cursor when one is available.
   */
  private async fetchEvents(cursor?: string): Promise<SorobanRpcEvent[]> {
    const result = await this.rpcRequest<GetEventsResponse>('getEvents', {
      filters: [
        {
          type: 'contract',
          contractIds: [this.contractId],
        },
      ],
      ...(cursor ? { cursor } : { startLedger: 1 }),
      limit: 100,
    });

    return result?.events ?? [];
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
