import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  Escrow as PrismaEscrow,
  Dispute as PrismaDispute,
  FailedTransaction as PrismaFailedTransaction,
  VendorAccountDetails as PrismaVendorAccountDetails,
  VendorTrackingSettings as PrismaVendorTrackingSettings,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export type EscrowState =
  | 'CREATED'
  | 'FUNDED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'RELEASED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'CANCELLED';
export type NotificationChannel = 'EMAIL' | 'SMS';
export type NotificationType =
  'FUNDED' | 'SHIPPED' | 'DELIVERED' | 'DISPUTED' | 'COMPLETED' | 'REFUNDED';
export type DisputeState =
  'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CANCELLED' | 'ABANDONED';

export interface EscrowRecord {
  id: string;
  /**
   * The escrow's id in the Soroban contract (`u64`), or null while the
   * on-chain escrow has not been matched to this row. Every contract call and
   * every inbound chain event resolves through it; see the schema comment on
   * `Escrow.contractEscrowId`.
   */
  contractEscrowId: bigint | null;
  itemName: string;
  itemRef: string;
  amount: number;
  currency: string;
  buyerAddress: string;
  vendorAddress: string;
  state: EscrowState;
  trackingId: string | null;
  shippedAt?: Date | null;
  deliveredAt: Date | null;
  deliveryRecordedAt: Date | null;
  autoReleaseSubmittedAt: Date | null;
  autoReleaseTxHash: string | null;
  disputeId: string | null;
  cancelledAt?: Date | null;
  buyerContactEmail?: string | null;
  buyerContactPhone?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorProfileRecord {
  address: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisputeRecord {
  id: string;
  escrowId: string;
  reason: string;
  description: string;
  evidenceUrls: string[];
  status: DisputeState;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface NotificationRecord {
  id: string;
  escrowId: string;
  type: NotificationType;
  channel: NotificationChannel;
  recipientAddress: string;
  message: string;
  status: NotificationStatus;
  retryCount: number;
  sentAt: Date | null;
  failedAt: Date | null;
  lastError: string | null;
  providerMessageId?: string | null;
  attemptCount?: number;
  lastResponseCode?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorTrackingSettingsRecord {
  id: string;
  vendorAddress: string;
  enableTracking: boolean;
  trackingProvider: string | null;
  trackingApiKey: string | null;
  autoUpdateTracking: boolean;
  trackingUpdateInterval: number;
  notifyOnDelivery: boolean;
  notifyOnDelay: boolean;
  notifyOnException: boolean;
  delayThresholdHours: number;
  deliveryConfirmation: boolean;
  requireSignature: boolean;
  insuranceRequired: boolean;
  insuranceValue: number | null;
  customTrackingRules: Record<string, unknown> | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  notificationChannels: string[];
  trackingHistoryRetentionDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessedWebhookEventRecord {
  operationId: string;
  processedAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  parentTokenId: string | null;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
}

export interface NonceRecord {
  id: string;
  nonce: string;
  walletAddress: string;
  challenge: string;
  used: boolean;
  expiresAt: Date;
  createdAt: Date;
}

export interface EscrowEventRecord {
  id: string;
  escrowId: string;
  fromState: EscrowState | null;
  toState: EscrowState;
  createdAt: Date;
}

export interface VendorAccountDetailsRecord {
  id: string;
  vendorAddress: string;
  businessLicense: string | null;
  taxId: string | null;
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  paymentMethods: string[];
  preferredCurrency: string;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingCountry: string | null;
  billingPostalCode: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingCountry: string | null;
  shippingPostalCode: string | null;
  websiteUrl: string | null;
  socialMediaLinks: string[];
  businessHours: string | null;
  timezone: string;
  language: string;
  verificationStatus: string;
  verifiedAt: Date | null;
  kycStatus: string;
  kycCompletedAt: Date | null;
  riskScore: number;
  complianceNotes: string | null;
  customFields: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CursorRecord {
  id: string;
  cursorValue: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderCredentialRecord {
  provider: string;
  encryptedKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export type FailedTransactionStatus =
  'PENDING_REVIEW' | 'REPLAYED' | 'ABANDONED';

export interface FailedTransactionRecord {
  id: string;
  operation: string;
  escrowId: string | null;
  errorMessage: string;
  ledgerFeedback: Record<string, unknown> | null;
  attempts: number;
  status: FailedTransactionStatus;
  lastReplayTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  replayedAt: Date | null;
}

export type EscrowCreateInput = Omit<
  EscrowRecord,
  | 'id'
  | 'itemRef'
  | 'state'
  | 'trackingId'
  | 'shippedAt'
  | 'deliveredAt'
  | 'deliveryRecordedAt'
  | 'autoReleaseSubmittedAt'
  | 'autoReleaseTxHash'
  | 'disputeId'
  | 'cancelledAt'
  | 'createdAt'
  | 'updatedAt'
> & {
  id?: string;
  itemRef?: string;
  state?: EscrowState;
  trackingId?: string | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  deliveryRecordedAt?: Date | null;
  autoReleaseSubmittedAt?: Date | null;
  autoReleaseTxHash?: string | null;
  disputeId?: string | null;
  cancelledAt?: Date | null;
  createdAt?: Date;
};

/**
 * Boundary mappers: a real PrismaClient returns Prisma's generated row types
 * (e.g. `amount` as a Decimal, `ledgerFeedback` as JsonValue). The rest of the
 * codebase consumes the hand-written `*Record` shapes above (numeric amount,
 * plain objects). Repositories convert generated rows through these mappers so
 * the public contract — and every existing consumer/test — keeps working.
 */
export function toEscrowRecord(row: PrismaEscrow): EscrowRecord {
  return { ...row, amount: Number(row.amount) };
}

/**
 * Narrows a Dispute row's `status` to the DisputeState union.
 *
 * The column is text in the database (see the note on the model), so Prisma
 * types it as `string`. The values written are always DisputeState members.
 */
export function toDisputeRecord(row: PrismaDispute): DisputeRecord {
  return { ...row, status: row.status as DisputeState };
}

export function toFailedTransactionRecord(
  row: PrismaFailedTransaction,
): FailedTransactionRecord {
  return {
    ...row,
    status: row.status as FailedTransactionStatus,
    ledgerFeedback:
      (row.ledgerFeedback as Record<string, unknown> | null) ?? null,
  };
}

export function toVendorAccountDetailsRecord(
  row: PrismaVendorAccountDetails,
): VendorAccountDetailsRecord {
  return {
    ...row,
    customFields: (row.customFields as Record<string, unknown> | null) ?? null,
  };
}

export function toVendorTrackingSettingsRecord(
  row: PrismaVendorTrackingSettings,
): VendorTrackingSettingsRecord {
  return {
    ...row,
    customTrackingRules:
      (row.customTrackingRules as Record<string, unknown> | null) ?? null,
  };
}

@Injectable()
export class PrismaService extends PrismaClient {
  readonly effectiveDatabaseUrl?: string;
  private readonly logger = new Logger('PrismaService');

  constructor(@Optional() readonly databaseUrl?: string) {
    const baseUrl =
      databaseUrl ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/trustlink_test';

    let effectiveUrl: string;
    try {
      const url = new URL(baseUrl);
      url.searchParams.set(
        'statement_timeout',
        process.env.QUERY_TIMEOUT_MS ?? '30000',
      );
      url.searchParams.set('connect_timeout', '10');
      effectiveUrl = url.toString();
    } catch {
      effectiveUrl = baseUrl;
    }

    const adapter = new PrismaPg({ connectionString: effectiveUrl });
    super({ adapter, log: [{ emit: 'event', level: 'query' }] });
    this.effectiveDatabaseUrl = effectiveUrl;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const slowQueryThresholdMs = parseInt(
      process.env.SLOW_QUERY_THRESHOLD_MS ?? '500',
      10,
    );
    // The base PrismaClient type does not carry the query-event log config
    // through the subclass, so narrow $on to the query-event signature here.
    // Prisma v7 exposes the client through a Proxy whose get trap returns
    // methods unbound, so bind `this` explicitly before invoking.
    const onQuery = this.$on.bind(this) as unknown as (
      event: 'query',
      callback: (event: Prisma.QueryEvent) => void,
    ) => void;
    onQuery('query', (event: Prisma.QueryEvent) => {
      if (event.duration >= slowQueryThresholdMs) {
        this.logger.warn(`Slow query (${event.duration}ms): ${event.query}`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async reset(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'PrismaService.reset() is a test-only helper and refuses to run ' +
          `outside NODE_ENV=test (current: ${process.env.NODE_ENV ?? 'undefined'}).`,
      );
    }
    const tablenames = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `;
    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((tablename) => tablename !== '_prisma_migrations')
      .map((tablename) => `"${tablename}"`)
      .join(', ');
    if (tables) {
      // Single TRUNCATE statement avoids the deadlocks caused by truncating
      // tables one-by-one, and the advisory lock serializes reset() across
      // parallel Jest workers sharing the same test database.
      await this.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(42);`);
          await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
        },
        { timeout: 30000 },
      );
    }
  }
}
