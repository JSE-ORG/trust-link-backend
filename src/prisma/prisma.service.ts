import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

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
  | 'FUNDED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'DISPUTED'
  | 'COMPLETED'
  | 'REFUNDED';
export type DisputeState = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED';

export interface EscrowRecord {
  id: string;
  itemName: string;
  // Required in the Prisma schema (`itemRef String`). Was previously optional
  // here, masking the schema constraint (issue #236).
  itemRef: string;
  // The Prisma schema types this as `Decimal @db.Decimal(18, 8)`. The in-memory
  // store uses `number` as a stand-in since the test harness has no Decimal
  // runtime; production code must treat it as Prisma `Decimal` (issue #236).
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
  // Required in the Prisma schema with a default (`description String @default("")`
  // and `evidenceUrls String[] @default([])`). Modelled as required here so the
  // in-memory store matches the schema's non-nullable columns (issue #236).
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
  customTrackingRules: any;
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

export interface CursorRecord {
  id: string;
  cursorValue: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FailedTransactionRecord {
  id: string;
  operation: string;
  escrowId: string | null;
  errorMessage: string;
  ledgerFeedback: Record<string, unknown> | null;
  attempts: number;
  status: string;
  lastReplayTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  replayedAt: Date | null;
}

type EscrowCreateInput = Omit<
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
};

type DisputeCreateInput = Omit<
  DisputeRecord,
  'status' | 'resolvedAt' | 'createdAt' | 'updatedAt' | 'evidenceUrls'
> & {
  id?: string;
  description?: string;
  status?: DisputeState;
  resolvedAt?: Date | null;
  evidenceUrls?: string[];
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

@Injectable()
export class PrismaService implements OnModuleDestroy {
  // databaseUrl is accepted so the module can pass the pool-tuned URL from
  // ConfigService. The in-memory store does not use it, but a real PrismaClient
  // replacement should forward it to `new PrismaClient({ datasources: { db: { url } } })`.
  constructor(readonly databaseUrl?: string) {
    // Issue #316: apply statement_timeout to prevent long-running queries
    if (databaseUrl) {
      try {
        const url = new URL(databaseUrl);
        url.searchParams.set('statement_timeout', process.env.QUERY_TIMEOUT_MS ?? '30000');
        url.searchParams.set('connect_timeout', '10');
        this.effectiveDatabaseUrl = url.toString();
      } catch {
        this.effectiveDatabaseUrl = databaseUrl;
      }
    }
  }

  readonly effectiveDatabaseUrl?: string;

  // Issue #315: slow query logging middleware
  private readonly slowQueryThresholdMs =
    parseInt(process.env.SLOW_QUERY_THRESHOLD_MS ?? '500', 10);

  private readonly logger = new Logger('PrismaService');

  async $use<T>(
    action: string,
    model: string | undefined,
    next: () => Promise<T>,
  ): Promise<T> {
    // Exclude health check queries from logging
    if (model === 'HealthCheck') return next();
    const start = Date.now();
    const result = await next();
    const duration = Date.now() - start;
    if (duration > this.slowQueryThresholdMs) {
      this.logger.warn(
        `Slow query: ${model ?? 'unknown'}.${action} took ${duration}ms ` +
        `(threshold: ${this.slowQueryThresholdMs}ms)`,
      );
    }
    return result;
  }

  private escrows = new Map<string, EscrowRecord>();
  private disputes = new Map<string, DisputeRecord>();
  private notifications = new Map<string, NotificationRecord>();
  private vendorProfiles = new Map<string, VendorProfileRecord>();
  private vendorTrackingSettingsStore = new Map<
    string,
    VendorTrackingSettingsRecord
  >();
  private webhookEvents = new Map<string, ProcessedWebhookEventRecord>();
  private refreshTokens = new Map<string, RefreshTokenRecord>();
  private nonces = new Map<string, NonceRecord>();
  private escrowEvents = new Map<string, EscrowEventRecord>();
  private escrowId = 1;
  private disputeId = 1;
  private notificationId = 1;
  private refreshTokenId = 1;
  private nonceId = 1;
  private escrowEventId = 1;

  // Single chokepoint for transition logging (#71/#72): every escrow state
  // change funnels through here so the EscrowEvent audit log is complete. With
  // a real Prisma client this is the equivalent of a query extension / DB
  // trigger; here it lives alongside the in-memory escrow mutations.
  private recordEscrowEvent(
    escrowId: string,
    fromState: EscrowState | null,
    toState: EscrowState,
  ): void {
    const event: EscrowEventRecord = {
      id: String(this.escrowEventId++),
      escrowId,
      fromState,
      toState,
      createdAt: new Date(),
    };
    this.escrowEvents.set(event.id, event);
  }

  escrow = {
    create: ({ data }: { data: EscrowCreateInput }): Promise<EscrowRecord> => {
      const now = new Date();
      const escrow: EscrowRecord = {
        ...data,
        id: data.id ?? String(this.escrowId++),
        itemRef: data.itemRef ?? '',
        state: data.state ?? 'FUNDED',
        trackingId: data.trackingId ?? null,
        shippedAt: data.shippedAt ?? null,
        deliveredAt: data.deliveredAt ?? null,
        deliveryRecordedAt: data.deliveryRecordedAt ?? null,
        autoReleaseSubmittedAt: data.autoReleaseSubmittedAt ?? null,
        autoReleaseTxHash: data.autoReleaseTxHash ?? null,
        disputeId: data.disputeId ?? null,
        cancelledAt: data.cancelledAt ?? null,
        buyerContactEmail: data.buyerContactEmail ?? null,
        buyerContactPhone: data.buyerContactPhone ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.escrows.set(escrow.id, escrow);
      this.recordEscrowEvent(escrow.id, null, escrow.state);
      return Promise.resolve({ ...escrow });
    },
    findUnique: ({
      where,
    }: {
      where: { id: string };
    }): Promise<EscrowRecord | null> => {
      const escrow = this.escrows.get(where.id);
      return Promise.resolve(escrow ? { ...escrow } : null);
    },
    findMany: ({
      where,
      select,
      orderBy,
      skip,
      take,
    }: {
      where?: Partial<
        Pick<
          EscrowRecord,
          | 'state'
          | 'trackingId'
          | 'vendorAddress'
          | 'buyerAddress'
          | 'disputeId'
          | 'itemRef'
          | 'autoReleaseTxHash'
          | 'autoReleaseSubmittedAt'
        >
      > & {
        shippedAt?: { lte: Date };
        deliveredAt?: { lte: Date } | null;
        createdAt?: { gte: Date; lte: Date };
      };
      select?: Partial<Record<keyof EscrowRecord, boolean>>;
      orderBy?: Partial<Record<keyof EscrowRecord, 'asc' | 'desc'>>;
      skip?: number;
      take?: number;
    } = {}): Promise<EscrowRecord[] | Partial<EscrowRecord>[]> => {
      let escrows = [...this.escrows.values()].filter((escrow) => {
        if (!where) {
          return true;
        }

        return Object.entries(where).every(([key, value]) => {
          if (value === undefined) {
            return true;
          }

          if (
            (key === 'shippedAt' || key === 'deliveredAt') &&
            typeof value === 'object' &&
            value !== null &&
            'lte' in value
          ) {
            const { lte } = value;
            const field =
              key === 'shippedAt' ? escrow.shippedAt : escrow.deliveredAt;
            return field !== null && field !== undefined && field <= lte;
          }

          if (
            key === 'createdAt' &&
            typeof value === 'object' &&
            value !== null &&
            'gte' in value &&
            'lte' in value
          ) {
            const { gte, lte } = value;
            return escrow.createdAt >= gte && escrow.createdAt <= lte;
          }

          return escrow[key as keyof EscrowRecord] === value;
        });
      });

      if (!where?.state) {
        escrows = escrows.filter((e) => e.state !== 'CANCELLED');
      }

      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as [
          keyof EscrowRecord,
          'asc' | 'desc',
        ];
        escrows = [...escrows].sort((a, b) => {
          const aVal = a[field];
          const bVal = b[field];
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return dir === 'asc' ? aVal - bVal : bVal - aVal;
          }
          if (aVal instanceof Date && bVal instanceof Date) {
            return dir === 'asc'
              ? aVal.getTime() - bVal.getTime()
              : bVal.getTime() - aVal.getTime();
          }
          return 0;
        });
      }

      if (skip !== undefined) escrows = escrows.slice(skip);
      if (take !== undefined) escrows = escrows.slice(0, take);

      if (select) {
        return Promise.resolve(
          escrows.map((escrow) => {
            const selected: Partial<EscrowRecord> = {};
            for (const key of Object.keys(select) as Array<
              keyof EscrowRecord
            >) {
              selected[key] = escrow[key];
            }
            return selected;
          }),
        );
      }

      return Promise.resolve(escrows.map((escrow) => ({ ...escrow })));
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: EscrowUpdateInput;
    }): Promise<EscrowRecord> => {
      const existing = this.escrows.get(where.id);
      if (!existing) {
        throw new Error(`Escrow ${where.id} not found`);
      }
      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.escrows.set(where.id, updated);
      if (data.state !== undefined && data.state !== existing.state) {
        this.recordEscrowEvent(where.id, existing.state, data.state);
      }
      return Promise.resolve({ ...updated });
    },
    findFirst: ({
      where,
    }: {
      where?: Partial<
        Pick<
          EscrowRecord,
          | 'vendorAddress'
          | 'buyerAddress'
          | 'state'
          | 'itemRef'
          | 'disputeId'
        >
      >;
    } = {}): Promise<EscrowRecord | null> => {
      return (
        this.escrow.findMany({ where }) as Promise<EscrowRecord[]>
      ).then((records) => records[0] ?? null);
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.escrows.size;
      this.escrows.clear();
      return Promise.resolve({ count });
    },
  };

  dispute = {
    create: ({
      data,
    }: {
      data: DisputeCreateInput;
    }): Promise<DisputeRecord> => {
      const now = new Date();
      const dispute: DisputeRecord = {
        ...data,
        id: data.id ?? String(this.disputeId++),
        description: data.description ?? '',
        status: data.status ?? 'OPEN',
        evidenceUrls: data.evidenceUrls ?? [],
        resolvedAt: data.resolvedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };

      this.disputes.set(dispute.id, dispute);

      const escrow = this.escrows.get(dispute.escrowId);
      if (escrow) {
        this.escrows.set(dispute.escrowId, {
          ...escrow,
          state: 'DISPUTED',
          disputeId: dispute.id,
          updatedAt: now,
        });
        if (escrow.state !== 'DISPUTED') {
          this.recordEscrowEvent(dispute.escrowId, escrow.state, 'DISPUTED');
        }
      }

      return Promise.resolve({ ...dispute });
    },
    findUnique: ({
      where,
    }: {
      where: { id: string };
    }): Promise<DisputeRecord | null> => {
      const dispute = this.disputes.get(where.id);
      return Promise.resolve(dispute ? { ...dispute } : null);
    },
    findMany: ({
      where,
    }: {
      where?: Partial<Pick<DisputeRecord, 'escrowId' | 'status'>>;
    } = {}): Promise<DisputeRecord[]> => {
      const disputes = [...this.disputes.values()].filter((dispute) => {
        if (!where) {
          return true;
        }

        return Object.entries(where).every(([key, value]) => {
          if (value === undefined) {
            return true;
          }

          return dispute[key as keyof DisputeRecord] === value;
        });
      });

      return Promise.resolve(disputes.map((dispute) => ({ ...dispute })));
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: DisputeUpdateInput;
    }): Promise<DisputeRecord> => {
      const existing = this.disputes.get(where.id);
      if (!existing) {
        throw new Error(`Dispute ${where.id} not found`);
      }

      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.disputes.set(where.id, updated);
      return Promise.resolve({ ...updated });
    },
    findFirst: ({
      where,
    }: {
      where?: Partial<Pick<DisputeRecord, 'escrowId' | 'status'>>;
    } = {}): Promise<DisputeRecord | null> => {
      return this.dispute.findMany({ where }).then((records) => records[0] ?? null);
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.disputes.size;
      this.disputes.clear();
      return Promise.resolve({ count });
    },
  };

  notification = {
    create: ({
      data,
    }: {
      data: any;
    }): Promise<NotificationRecord> => {
      const now = new Date();
      const notification: NotificationRecord = {
        status: data.status ?? 'PENDING',
        retryCount: data.retryCount ?? 0,
        sentAt: data.sentAt ?? null,
        failedAt: data.failedAt ?? null,
        lastError: data.lastError ?? null,
        providerMessageId: data.providerMessageId ?? null,
        attemptCount: data.attemptCount ?? 0,
        lastResponseCode: data.lastResponseCode ?? null,
        ...data,
        id: data.id ?? String(this.notificationId++),
        createdAt: now,
        updatedAt: now,
      };
      this.notifications.set(notification.id, notification);
      return Promise.resolve({ ...notification });
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: any;
    }): Promise<NotificationRecord> => {
      const existing = this.notifications.get(where.id);
      if (!existing) {
        return Promise.reject(new Error(`Notification with id ${where.id} not found`));
      }
      const updated: NotificationRecord = {
        ...existing,
        ...data,
        updatedAt: new Date(),
      };
      this.notifications.set(where.id, updated);
      return Promise.resolve({ ...updated });
    },
    findMany: (): Promise<NotificationRecord[]> =>
      Promise.resolve(
        [...this.notifications.values()].map((notification) => ({
          ...notification,
        })),
      ),
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.notifications.size;
      this.notifications.clear();
      return Promise.resolve({ count });
    },
  };


  processedWebhookEvent = {
    findUnique: ({
      where,
    }: {
      where: { operationId: string };
    }): Promise<ProcessedWebhookEventRecord | null> => {
      const event = this.webhookEvents.get(where.operationId);
      return Promise.resolve(event ? { ...event } : null);
    },
    create: ({
      data,
    }: {
      data: { operationId: string };
    }): Promise<ProcessedWebhookEventRecord> => {
      const event: ProcessedWebhookEventRecord = {
        operationId: data.operationId,
        processedAt: new Date(),
      };
      this.webhookEvents.set(data.operationId, event);
      return Promise.resolve({ ...event });
    },
    delete: ({
      where,
    }: {
      where: { operationId: string };
    }): Promise<ProcessedWebhookEventRecord | null> => {
      const event = this.webhookEvents.get(where.operationId) ?? null;
      this.webhookEvents.delete(where.operationId);
      return Promise.resolve(event ? { ...event } : null);
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.webhookEvents.size;
      this.webhookEvents.clear();
      return Promise.resolve({ count });
    },
  };

  escrowEvent = {
    create: ({
      data,
    }: {
      data: Omit<EscrowEventRecord, 'id' | 'createdAt'> & {
        fromState?: EscrowState | null;
      };
    }): Promise<EscrowEventRecord> => {
      const event: EscrowEventRecord = {
        ...data,
        id: String(this.escrowEventId++),
        fromState: data.fromState ?? null,
        createdAt: new Date(),
      };
      this.escrowEvents.set(event.id, event);
      return Promise.resolve({ ...event });
    },
    findMany: ({
      where,
    }: {
      where?: Partial<Pick<EscrowEventRecord, 'escrowId'>>;
    } = {}): Promise<EscrowEventRecord[]> => {
      const events = [...this.escrowEvents.values()]
        .filter(
          (event) => !where?.escrowId || event.escrowId === where.escrowId,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.resolve(events.map((event) => ({ ...event })));
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.escrowEvents.size;
      this.escrowEvents.clear();
      return Promise.resolve({ count });
    },
  };

  refreshToken = {
    create: ({
      data,
    }: {
      data: Omit<RefreshTokenRecord, 'id' | 'createdAt'>;
    }): Promise<RefreshTokenRecord> => {
      const token: RefreshTokenRecord = {
        ...data,
        id: String(this.refreshTokenId++),
        parentTokenId: data.parentTokenId ?? null,
        createdAt: new Date(),
      };
      this.refreshTokens.set(token.id, token);
      return Promise.resolve({ ...token });
    },
    findUnique: ({
      where,
    }: {
      where: { id?: string; tokenHash?: string };
    }): Promise<RefreshTokenRecord | null> => {
      const token = where.id
        ? this.refreshTokens.get(where.id)
        : [...this.refreshTokens.values()].find(
            (record) => record.tokenHash === where.tokenHash,
          );
      return Promise.resolve(token ? { ...token } : null);
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Pick<RefreshTokenRecord, 'revoked'>>;
    }): Promise<RefreshTokenRecord> => {
      const existing = this.refreshTokens.get(where.id);
      if (!existing) {
        throw new Error(`Refresh token ${where.id} not found`);
      }
      const updated = { ...existing, ...data };
      this.refreshTokens.set(where.id, updated);
      return Promise.resolve({ ...updated });
    },
    updateMany: ({
      where,
      data,
    }: {
      where: { userId?: string };
      data: Partial<Pick<RefreshTokenRecord, 'revoked'>>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const [id, token] of this.refreshTokens.entries()) {
        if (!where.userId || token.userId === where.userId) {
          this.refreshTokens.set(id, { ...token, ...data });
          count++;
        }
      }
      return Promise.resolve({ count });
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.refreshTokens.size;
      this.refreshTokens.clear();
      return Promise.resolve({ count });
    },
  };

  nonce = {
    create: ({
      data,
    }: {
      data: Omit<NonceRecord, 'id' | 'createdAt'>;
    }): Promise<NonceRecord> => {
      const nonce: NonceRecord = {
        ...data,
        id: String(this.nonceId++),
        createdAt: new Date(),
      };
      this.nonces.set(nonce.id, nonce);
      return Promise.resolve({ ...nonce });
    },
    findUnique: ({
      where,
    }: {
      where: { id?: string; nonce?: string };
    }): Promise<NonceRecord | null> => {
      const nonce = where.id
        ? this.nonces.get(where.id)
        : [...this.nonces.values()].find(
            (record) => record.nonce === where.nonce,
          );
      return Promise.resolve(nonce ? { ...nonce } : null);
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Pick<NonceRecord, 'used'>>;
    }): Promise<NonceRecord> => {
      const existing = this.nonces.get(where.id);
      if (!existing) {
        throw new Error(`Nonce ${where.id} not found`);
      }
      const updated = { ...existing, ...data };
      this.nonces.set(where.id, updated);
      return Promise.resolve({ ...updated });
    },
    deleteMany: ({
      where,
    }: {
      where?: {
        expiresAt?: { lt: Date };
      };
    } = {}): Promise<{ count: number }> => {
      if (!where?.expiresAt?.lt) {
        const count = this.nonces.size;
        this.nonces.clear();
        return Promise.resolve({ count });
      }

      const cutoff = where.expiresAt.lt;
      let count = 0;
      for (const [id, nonce] of this.nonces.entries()) {
        if (nonce.expiresAt < cutoff) {
          this.nonces.delete(id);
          count++;
        }
      }
      return Promise.resolve({ count });
    },
  };

  vendorProfile = {
    create: ({
      data,
    }: {
      data: VendorProfileCreateInput;
    }): Promise<VendorProfileRecord> => {
      if (this.vendorProfiles.has(data.address)) {
        throw new Error(`Vendor profile for ${data.address} already exists`);
      }
      const now = new Date();
      const profile: VendorProfileRecord = {
        ...data,
        email: data.email ?? null,
        phone: data.phone ?? null,
        description: data.description ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.vendorProfiles.set(data.address, profile);
      return Promise.resolve({ ...profile });
    },
    findUnique: ({
      where,
    }: {
      where: { address: string };
    }): Promise<VendorProfileRecord | null> => {
      const profile = this.vendorProfiles.get(where.address);
      return Promise.resolve(profile ? { ...profile } : null);
    },
    upsert: ({
      where,
      create,
      update,
    }: {
      where: { address: string };
      create: VendorProfileCreateInput;
      update: VendorProfileUpdateInput;
    }): Promise<VendorProfileRecord> => {
      const existing = this.vendorProfiles.get(where.address);
      if (existing) {
        const safeUpdate = Object.fromEntries(
          Object.entries(update).filter(([, v]) => v !== undefined),
        ) as VendorProfileUpdateInput;
        const updated = { ...existing, ...safeUpdate, updatedAt: new Date() };
        this.vendorProfiles.set(where.address, updated);
        return Promise.resolve({ ...updated });
      }
      const now = new Date();
      const profile: VendorProfileRecord = {
        ...create,
        email: create.email ?? null,
        phone: create.phone ?? null,
        description: create.description ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.vendorProfiles.set(where.address, profile);
      return Promise.resolve({ ...profile });
    },
    update: ({
      where,
      data,
    }: {
      where: { address: string };
      data: VendorProfileUpdateInput;
    }): Promise<VendorProfileRecord> => {
      const existing = this.vendorProfiles.get(where.address);
      if (!existing) {
        throw new Error(`Vendor profile for ${where.address} not found`);
      }
      // Strip undefined so optional DTO fields don't overwrite existing values
      const safeData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      ) as VendorProfileUpdateInput;
      const updated = { ...existing, ...safeData, updatedAt: new Date() };
      this.vendorProfiles.set(where.address, updated);
      return Promise.resolve({ ...updated });
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.vendorProfiles.size;
      this.vendorProfiles.clear();
      return Promise.resolve({ count });
    },
  };

  vendorTrackingSettings = {
    findUnique: ({
      where,
      select,
    }: {
      where: { vendorAddress: string };
      select?: { notificationChannels?: boolean };
    }): Promise<any | null> => {
      const settings = this.vendorTrackingSettingsStore.get(
        where.vendorAddress,
      );
      if (!settings) {
        return Promise.resolve(null);
      }

      if (select?.notificationChannels) {
        return Promise.resolve({
          notificationChannels: settings.notificationChannels || [],
        });
      }

      return Promise.resolve(settings ? { ...settings } : null);
    },
    upsert: ({
      where,
      create,
      update,
    }: {
      where: { vendorAddress: string };
      create: any;
      update: any;
    }): Promise<any> => {
      const existing = this.vendorTrackingSettingsStore.get(
        where.vendorAddress,
      );
      const now = new Date();
      if (existing) {
        const updated = {
          ...existing,
          ...update,
          updatedAt: now,
        };
        this.vendorTrackingSettingsStore.set(where.vendorAddress, updated);
        return Promise.resolve({ ...updated });
      }
      const created = {
        id: create.id ?? `settings-${where.vendorAddress}`,
        vendorAddress: where.vendorAddress,
        enableTracking: create.enableTracking ?? true,
        trackingProvider: create.trackingProvider ?? null,
        trackingApiKey: create.trackingApiKey ?? null,
        autoUpdateTracking: create.autoUpdateTracking ?? false,
        trackingUpdateInterval: create.trackingUpdateInterval ?? 3600,
        notifyOnDelivery: create.notifyOnDelivery ?? true,
        notifyOnDelay: create.notifyOnDelay ?? true,
        notifyOnException: create.notifyOnException ?? true,
        delayThresholdHours: create.delayThresholdHours ?? 24,
        deliveryConfirmation: create.deliveryConfirmation ?? true,
        requireSignature: create.requireSignature ?? false,
        insuranceRequired: create.insuranceRequired ?? false,
        insuranceValue: create.insuranceValue ?? null,
        customTrackingRules: create.customTrackingRules ?? null,
        webhookUrl: create.webhookUrl ?? null,
        webhookSecret: create.webhookSecret ?? null,
        notificationChannels: create.notificationChannels ?? ['EMAIL'],
        trackingHistoryRetentionDays: create.trackingHistoryRetentionDays ?? 90,
        createdAt: now,
        updatedAt: now,
        ...create,
      };
      this.vendorTrackingSettingsStore.set(where.vendorAddress, created);
      return Promise.resolve({ ...created });
    },
  };

  /**
   * Mock implementation of Prisma's $queryRaw for testing.
   * Supports basic aggregation queries for the analytics service.
   */
  async $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> {
    const queryString = query.join('?');

    // SQL template order: ${timezone}, ${vendorAddress}, ${startDate}, ${endDate}, ${timezone}
    const timezone = (values[0] as string) || 'UTC';
    const vendorAddress = values[1] as string;
    const startDate = values[2] as Date;
    const endDate = values[3] as Date;

    // Filter escrows by vendor and date range
    const filteredEscrows = [...this.escrows.values()].filter(
      (escrow) =>
        escrow.vendorAddress === vendorAddress &&
        escrow.createdAt >= startDate &&
        escrow.createdAt <= endDate,
    );

    // Group by date in the specified timezone
    const dailyMap = new Map<
      string,
      {
        date: string;
        totalVolume: number;
        transactionCount: number;
        completedCount: number;
        disputedCount: number;
      }
    >();

    for (const escrow of filteredEscrows) {
      const dateKey = this.formatDateInTimezone(escrow.createdAt, timezone);

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          totalVolume: 0,
          transactionCount: 0,
          completedCount: 0,
          disputedCount: 0,
        });
      }

      const daily = dailyMap.get(dateKey)!;
      daily.totalVolume += Number(escrow.amount);
      daily.transactionCount += 1;

      if (escrow.state === 'COMPLETED' || escrow.state === 'RELEASED') {
        daily.completedCount += 1;
      }

      if (escrow.state === 'DISPUTED') {
        daily.disputedCount += 1;
      }
    }

    // Sort by date ascending
    const result = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return result as T[];
  }

  /**
   * Formats a Date object to ISO date string (YYYY-MM-DD) in a specific timezone
   */
  private formatDateInTimezone(date: Date, timezone: string): string {
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
  }

  /** Clears all in-memory Prisma test data and resets generated IDs. */
  async reset(): Promise<void> {
    await this.refreshToken.deleteMany();
    await this.nonce.deleteMany();
    await this.vendorProfile.deleteMany();
    await this.notification.deleteMany();
    await this.escrowEvent.deleteMany();
    await this.dispute.deleteMany();
    await this.escrow.deleteMany();
    await this.processedWebhookEvent.deleteMany();
    this.vendorTrackingSettingsStore.clear();
    this.failedTransactionStore.clear();
    this.escrowId = 1;
    this.disputeId = 1;
    this.notificationId = 1;
    this.refreshTokenId = 1;
    this.nonceId = 1;
    this.escrowEventId = 1;
  }

  /** Clears in-memory data when the Nest module is destroyed. */
  async onModuleDestroy(): Promise<void> {
    await this.reset();
  }

  private cursorStore = new Map<string, CursorRecord>();
  private failedTransactionStore = new Map<string, FailedTransactionRecord>();

  cursor = {
    findFirst: ({
      where,
    }: {
      where: { id: string };
    }): Promise<CursorRecord | null> => {
      const record = this.cursorStore.get(where.id);
      return Promise.resolve(record ? { ...record } : null);
    },
    upsert: ({
      where,
      update,
      create,
    }: {
      where: { id: string };
      update: { cursorValue: string };
      create: { id: string; cursorValue: string };
    }): Promise<CursorRecord> => {
      const existing = this.cursorStore.get(where.id);
      if (existing) {
        const updated = {
          ...existing,
          cursorValue: update.cursorValue,
          updatedAt: new Date(),
        };
        this.cursorStore.set(where.id, updated);
        return Promise.resolve({ ...updated });
      }
      const now = new Date();
      const record: CursorRecord = {
        id: create.id,
        cursorValue: create.cursorValue,
        createdAt: now,
        updatedAt: now,
      };
      this.cursorStore.set(record.id, record);
      return Promise.resolve({ ...record });
    },
  };

  failedTransaction = {
    create: ({
      data,
    }: {
      data: Omit<
        FailedTransactionRecord,
        'id' | 'createdAt' | 'updatedAt' | 'reviewedAt' | 'replayedAt'
      >;
    }): Promise<FailedTransactionRecord> => {
      const now = new Date();
      const record: FailedTransactionRecord = {
        ...data,
        id: String(this.failedTransactionStore.size + 1),
        lastReplayTxHash: null,
        createdAt: now,
        updatedAt: now,
        reviewedAt: null,
        replayedAt: null,
      };
      this.failedTransactionStore.set(record.id, record);
      return Promise.resolve({ ...record });
    },
    findMany: ({
      where,
      orderBy,
    }: {
      where?: Record<string, unknown>;
      orderBy?: { createdAt?: string };
    }): Promise<FailedTransactionRecord[]> => {
      let records = [...this.failedTransactionStore.values()];
      if (where) {
        records = records.filter((r) =>
          Object.entries(where).every(([key, value]) => {
            if (value === undefined) return true;
            return (r as Record<string, unknown>)[key] === value;
          }),
        );
      }
      if (orderBy?.createdAt === 'desc') {
        records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return Promise.resolve(records.map((r) => ({ ...r })));
    },
    findUnique: ({
      where,
    }: {
      where: { id: string };
    }): Promise<FailedTransactionRecord | null> => {
      const record = this.failedTransactionStore.get(where.id);
      return Promise.resolve(record ? { ...record } : null);
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<FailedTransactionRecord> => {
      const existing = this.failedTransactionStore.get(where.id);
      if (!existing) {
        throw new Error(`FailedTransaction ${where.id} not found`);
      }
      const updated = {
        ...existing,
        ...data,
        updatedAt: new Date(),
      } as FailedTransactionRecord;
      this.failedTransactionStore.set(where.id, updated);
      return Promise.resolve({ ...updated });
    },
  };
}
