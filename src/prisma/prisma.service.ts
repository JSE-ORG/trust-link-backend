import { Injectable, OnModuleDestroy } from '@nestjs/common';

export type EscrowState =
  | 'FUNDED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'RELEASED'
  | 'DISPUTED'
  | 'REFUNDED';
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
  itemRef: string;
  amount: number;
  currency: string;
  buyerAddress: string;
  vendorAddress: string;
  state: EscrowState;
  trackingId: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  deliveryRecordedAt: Date | null;
  autoReleaseSubmittedAt: Date | null;
  autoReleaseTxHash: string | null;
  disputeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisputeRecord {
  id: string;
  escrowId: string;
  reason: string;
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
  createdAt: Date;
}

type EscrowCreateInput = Omit<
  EscrowRecord,
  | 'id'
  | 'state'
  | 'trackingId'
  | 'shippedAt'
  | 'deliveredAt'
  | 'deliveryRecordedAt'
  | 'autoReleaseSubmittedAt'
  | 'autoReleaseTxHash'
  | 'disputeId'
  | 'createdAt'
  | 'updatedAt'
> & {
  state?: EscrowState;
  trackingId?: string | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  deliveryRecordedAt?: Date | null;
  autoReleaseSubmittedAt?: Date | null;
  autoReleaseTxHash?: string | null;
  disputeId?: string | null;
};

type DisputeCreateInput = Omit<
  DisputeRecord,
  'id' | 'status' | 'resolvedAt' | 'createdAt' | 'updatedAt'
> & {
  status?: DisputeState;
  resolvedAt?: Date | null;
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
  >
>;

type DisputeUpdateInput = Partial<
  Pick<DisputeRecord, 'status' | 'resolvedAt' | 'reason' | 'escrowId'>
>;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private escrows = new Map<string, EscrowRecord>();
  private disputes = new Map<string, DisputeRecord>();
  private notifications = new Map<string, NotificationRecord>();
  private escrowId = 1;
  private disputeId = 1;
  private notificationId = 1;

  escrow = {
    create: ({ data }: { data: EscrowCreateInput }): Promise<EscrowRecord> => {
      const now = new Date();
      const escrow: EscrowRecord = {
        ...data,
        id: String(this.escrowId++),
        state: data.state ?? 'FUNDED',
        trackingId: data.trackingId ?? null,
        shippedAt: data.shippedAt ?? null,
        deliveredAt: data.deliveredAt ?? null,
        deliveryRecordedAt: data.deliveryRecordedAt ?? null,
        autoReleaseSubmittedAt: data.autoReleaseSubmittedAt ?? null,
        autoReleaseTxHash: data.autoReleaseTxHash ?? null,
        disputeId: data.disputeId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.escrows.set(escrow.id, escrow);
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
        >
      > & { shippedAt?: { lte: Date } };
    } = {}): Promise<EscrowRecord[]> => {
      const escrows = [...this.escrows.values()].filter((escrow) => {
        if (!where) {
          return true;
        }

        return Object.entries(where).every(([key, value]) => {
          if (value === undefined) {
            return true;
          }

          if (key === 'shippedAt' && typeof value === 'object' && 'lte' in value) {
            const lte = (value as any).lte as Date;
            return escrow.shippedAt !== null && escrow.shippedAt <= lte;
          }

          return escrow[key as keyof EscrowRecord] === value;
        });
      });

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
        id: String(this.disputeId++),
        status: data.status ?? 'OPEN',
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

  async reset(): Promise<void> {
    await this.notification.deleteMany();
    await this.dispute.deleteMany();
    await this.escrow.deleteMany();
    this.escrowId = 1;
    this.disputeId = 1;
    this.notificationId = 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.reset();
  }
}
