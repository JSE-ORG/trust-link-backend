import type {
  EscrowRecord,
  DisputeRecord,
  VendorProfileRecord,
  EscrowState,
  DisputeState,
} from './prisma.service';

/**
 * Compile-time parity helpers between the in-memory `*Record` types in
 * `prisma.service.ts` and the canonical Prisma schema (`prisma/schema.prisma`).
 *
 * The in-memory store cannot import Prisma-generated types (the client is not
 * generated in the test harness), so this module mirrors the schema's column
 * shapes by hand and uses type-level assertions to fail compilation if an
 * in-memory record drifts from the schema (issue #236).
 *
 * A complementary runtime check lives in `prisma-schema-parity.spec.ts`, which
 * parses `schema.prisma` directly so the field lists cannot silently diverge.
 */

/** True when `A` is assignable to `B` (i.e. `A` satisfies every field of `B`). */
export type Extends<A, B> = A extends B ? true : false;

/** Forces a compile error unless `T` is exactly `true`. */
export type Expect<T extends true> = T;

/**
 * Schema shape of the `Escrow` model. `amount` is `Decimal @db.Decimal(18, 8)`
 * in the schema; the in-memory store represents it as `number`, so it is typed
 * as `number` here to document that intentional stand-in.
 */
export interface EscrowSchemaShape {
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
  buyerContactEmail?: string | null;
  buyerContactPhone?: string | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Schema shape of the `Dispute` model. */
export interface DisputeSchemaShape {
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

/** Schema shape of the `VendorProfile` model. */
export interface VendorProfileSchemaShape {
  address: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Compile-time assertions ──────────────────────────────────────────────────
// These produce a build error if an in-memory record stops satisfying its
// schema shape (e.g. a required column is made optional again).
type _AssertEscrow = Expect<Extends<EscrowRecord, EscrowSchemaShape>>;
type _AssertDispute = Expect<Extends<DisputeRecord, DisputeSchemaShape>>;
type _AssertVendorProfile = Expect<
  Extends<VendorProfileRecord, VendorProfileSchemaShape>
>;

// Reference the aliases so `noUnusedLocals`/eslint keep them without emitting.
export type SchemaParityAssertions = [
  _AssertEscrow,
  _AssertDispute,
  _AssertVendorProfile,
];
