import { Injectable, OnModuleDestroy } from '@nestjs/common';

export type EscrowState =
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
  itemRef?: string;
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
  description?: string;
  evidenceUrls?: string[];
  status: DisputeState;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRecord {
  id: string;
  escrowId: string;
  type: NotificationType;
  channel: NotificationChannel;
  recipientAddress: string;
  providerMessageId: string | null;
  attemptCount: number;
  lastResponseCode: number | null;
  createdAt: Date;
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
  constructor(readonly databaseUrl?: string) {}

  private escrows = new Map<string, EscrowRecord>();
  private disputes = new Map<string, DisputeRecord>();
  private notifications = new Map<string, NotificationRecord>();
  private vendorProfiles = new Map<string, VendorProfileRecord>();
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
        state: data.state ?? 'FUNDED',
        trackingId: data.trackingId ?? null,
        shippedAt: data.shippedAt ?? null,
        deliveredAt: data.deliveredAt ?? null,
        deliveryRecordedAt: data.deliveryRecordedAt ?? null,
        autoReleaseSubmittedAt: data.autoReleaseSubmittedAt ?? null,
        autoReleaseTxHash: data.autoReleaseTxHash ?? null,
        disputeId: data.disputeId ?? null,
        cancelledAt: data.cancelledAt ?? null,
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
      };
    } = {}): Promise<EscrowRecord[]> => {
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
            return field !== null && field <= lte;
          }

          return escrow[key as keyof EscrowRecord] === value;
        });
      });

      if (!where?.state) {
        escrows = escrows.filter((e) => e.state !== 'CANCELLED');
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
      data: Omit<NotificationRecord, 'id' | 'createdAt'>;
    }): Promise<NotificationRecord> => {
      const notification: NotificationRecord = {
        ...data,
        id: String(this.notificationId++),
        createdAt: new Date(),
      };
      this.notifications.set(notification.id, notification);
      return Promise.resolve({ ...notification });
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
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.nonces.size;
      this.nonces.clear();
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
      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.vendorProfiles.set(where.address, updated);
      return Promise.resolve({ ...updated });
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.vendorProfiles.size;
      this.vendorProfiles.clear();
      return Promise.resolve({ count });
    },
  };

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
}
