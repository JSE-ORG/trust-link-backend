import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
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
  | 'FUNDED' | 'SHIPPED' | 'DELIVERED' | 'DISPUTED' | 'COMPLETED' | 'REFUNDED';
export type DisputeState =
  | 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CANCELLED' | 'ABANDONED';

export interface EscrowRecord {
  id: string;
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

type DisputeCreateInput = Omit<
  DisputeRecord,
  | 'id'
  | 'status'
  | 'resolvedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'evidenceUrls'
  | 'description'
> & {
  id?: string;
  status?: DisputeState;
  resolvedAt?: Date | null;
  evidenceUrls?: string[];
  description?: string;
};

type EscrowUpdateInput = Partial<
  Pick<
    EscrowRecord,
    | 'state'
    | 'trackingId'
    | 'shippedAt'
    | 'deliveredAt'
    | 'deliveryRecordedAt'
    | 'autoReleaseSubmittedAt'
    | 'autoReleaseTxHash'
    | 'disputeId'
    | 'cancelledAt'
    | 'buyerContactEmail'
    | 'buyerContactPhone'
  >
>;

type VendorProfileCreateInput = Omit<
  VendorProfileRecord,
  'createdAt' | 'updatedAt'
>;

type VendorProfileUpdateInput = Partial<
  Omit<VendorProfileRecord, 'address' | 'createdAt' | 'updatedAt'>
>;

type DisputeUpdateInput = Partial<
  Pick<
    DisputeRecord,
    'status' | 'resolvedAt' | 'reason' | 'escrowId' | 'evidenceUrls'
  >
>;

type NotificationCreateInput = Pick<
  NotificationRecord,
  'escrowId' | 'type' | 'channel' | 'recipientAddress' | 'message'
> &
  Partial<
    Pick<
      NotificationRecord,
      | 'id'
      | 'status'
      | 'retryCount'
      | 'sentAt'
      | 'failedAt'
      | 'lastError'
      | 'providerMessageId'
      | 'attemptCount'
      | 'lastResponseCode'
    >
  >;

type NotificationUpdateInput = Partial<
  Omit<NotificationRecord, 'id' | 'createdAt' | 'updatedAt'>
>;

type VendorTrackingSettingsCreateInput = Partial<
  Omit<VendorTrackingSettingsRecord, 'createdAt' | 'updatedAt'>
>;

type VendorTrackingSettingsUpdateInput = Partial<
  Omit<
    VendorTrackingSettingsRecord,
    'id' | 'vendorAddress' | 'createdAt' | 'updatedAt'
  >
>;

@Injectable()
export class PrismaService extends PrismaClient {
  readonly effectiveDatabaseUrl?: string;
  private readonly logger = new Logger('PrismaService');

  constructor(@Optional() readonly databaseUrl?: string) {
    const baseUrl = databaseUrl || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/trustlink_test';

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
    super({ adapter });
    this.effectiveDatabaseUrl = effectiveUrl;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const slowQueryThresholdMs = parseInt(
      process.env.SLOW_QUERY_THRESHOLD_MS ?? '500',
      10,
    );
    this.$on('query' as any, (event: any) => {
      if (event.duration >= slowQueryThresholdMs) {
        this.logger.warn(
          `Slow query (${event.duration}ms): ${event.query}`,
        );
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
    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await this.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
      }
    }
  }
}
