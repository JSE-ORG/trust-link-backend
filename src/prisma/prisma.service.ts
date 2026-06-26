import { Injectable, OnModuleDestroy } from '@nestjs/common';

// ── Vendor profile types ──────────────────────────────────────────────────────

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  inApp: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  email: true,
  sms: false,
  inApp: true,
};

export interface VendorProfile {
  id: string;
  vendorAddress: string;
  businessName: string;
  contactEmail: string;
  contactPhone: string | null;
  notificationPreferences: NotificationPreferences;
  createdAt: Date;
  updatedAt: Date;
}

type VendorProfileCreateInput = Omit<VendorProfile, 'id' | 'notificationPreferences' | 'createdAt' | 'updatedAt'> & {
  notificationPreferences?: Partial<NotificationPreferences>;
};

type VendorProfileUpdateInput = Partial<
  Pick<VendorProfile, 'businessName' | 'contactEmail' | 'contactPhone'>
> & {
  notificationPreferences?: Partial<NotificationPreferences>;
};

// ── Escrow types ──────────────────────────────────────────────────────────────

export type EscrowState =
  | 'FUNDED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RELEASED'
  | 'COMPLETED'
  | 'REFUNDED';
export type NotificationChannel = 'EMAIL' | 'SMS';
export type NotificationType = 'FUNDED' | 'SHIPPED';

export interface EscrowRecord {
  id: string;
  itemName: string;
  amount: number;
  currency: string;
  buyerAddress: string;
  vendorAddress: string;
  state: EscrowState;
  trackingId: string | null;
  shippedAt: Date | null;
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
  'id' | 'state' | 'trackingId' | 'shippedAt' | 'createdAt' | 'updatedAt'
> & {
  state?: EscrowState;
  trackingId?: string | null;
  shippedAt?: Date | null;
};

type EscrowUpdateInput = Partial<
  Pick<EscrowRecord, 'state' | 'trackingId' | 'shippedAt'>
>;

interface EscrowWhereInput {
  state?: EscrowState;
  vendorAddress?: string;
  shippedAt?: { lte: Date };
}

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private escrows = new Map<string, EscrowRecord>();
  private notifications = new Map<string, NotificationRecord>();
  private vendorProfiles = new Map<string, VendorProfile>();
  private escrowId = 1;
  private notificationId = 1;
  private vendorProfileId = 1;

  escrow = {
    create: ({ data }: { data: EscrowCreateInput }): Promise<EscrowRecord> => {
      const now = new Date();
      const escrow: EscrowRecord = {
        ...data,
        id: String(this.escrowId++),
        state: data.state ?? 'FUNDED',
        trackingId: data.trackingId ?? null,
        shippedAt: data.shippedAt ?? null,
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
      where?: EscrowWhereInput;
    } = {}): Promise<EscrowRecord[]> => {
      let results = [...this.escrows.values()];
      if (where?.state) {
        results = results.filter((e) => e.state === where.state);
      }
      if (where?.vendorAddress) {
        results = results.filter((e) => e.vendorAddress === where.vendorAddress);
      }
      if (where?.shippedAt?.lte) {
        const lte = where.shippedAt.lte;
        results = results.filter(
          (e) => e.shippedAt !== null && e.shippedAt <= lte,
        );
      }
      return Promise.resolve(results.map((e) => ({ ...e })));
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

  vendorProfile = {
    create: ({ data }: { data: VendorProfileCreateInput }): Promise<VendorProfile> => {
      // Reject duplicate vendorAddress
      for (const v of this.vendorProfiles.values()) {
        if (v.vendorAddress === data.vendorAddress) {
          const err = new Error('Unique constraint failed: vendorAddress') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
      }
      const now = new Date();
      const profile: VendorProfile = {
        ...data,
        id: String(this.vendorProfileId++),
        notificationPreferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...(data.notificationPreferences ?? {}),
        },
        contactPhone: data.contactPhone ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.vendorProfiles.set(profile.id, profile);
      return Promise.resolve({ ...profile, notificationPreferences: { ...profile.notificationPreferences } });
    },

    findUnique: ({ where }: { where: { vendorAddress?: string; id?: string } }): Promise<VendorProfile | null> => {
      let found: VendorProfile | undefined;
      if (where.vendorAddress !== undefined) {
        found = [...this.vendorProfiles.values()].find(v => v.vendorAddress === where.vendorAddress);
      } else if (where.id !== undefined) {
        found = this.vendorProfiles.get(where.id);
      }
      return Promise.resolve(found ? { ...found, notificationPreferences: { ...found.notificationPreferences } } : null);
    },

    update: ({ where, data }: { where: { vendorAddress?: string; id?: string }; data: VendorProfileUpdateInput }): Promise<VendorProfile> => {
      let existing: VendorProfile | undefined;
      if (where.vendorAddress !== undefined) {
        existing = [...this.vendorProfiles.values()].find(v => v.vendorAddress === where.vendorAddress);
      } else if (where.id !== undefined) {
        existing = this.vendorProfiles.get(where.id);
      }
      if (!existing) throw new Error('VendorProfile not found');
      // Strip undefined values so optional DTO fields don't overwrite existing data
      const safeData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      ) as VendorProfileUpdateInput;
      const safePrefs = data.notificationPreferences
        ? Object.fromEntries(
            Object.entries(data.notificationPreferences).filter(([, v]) => v !== undefined),
          ) as Partial<NotificationPreferences>
        : undefined;
      const updated: VendorProfile = {
        ...existing,
        ...safeData,
        notificationPreferences: safePrefs
          ? { ...existing.notificationPreferences, ...safePrefs }
          : existing.notificationPreferences,
        updatedAt: new Date(),
      };
      this.vendorProfiles.set(existing.id, updated);
      return Promise.resolve({ ...updated, notificationPreferences: { ...updated.notificationPreferences } });
    },

    deleteMany: (): Promise<{ count: number }> => {
      const count = this.vendorProfiles.size;
      this.vendorProfiles.clear();
      return Promise.resolve({ count });
    },
  };

  async reset(): Promise<void> {
    await this.notification.deleteMany();
    await this.escrow.deleteMany();
    await this.vendorProfile.deleteMany();
    this.escrowId = 1;
    this.notificationId = 1;
    this.vendorProfileId = 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.reset();
  }
}
