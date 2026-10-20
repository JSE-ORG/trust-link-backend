# Escrow Contract Events Reference

Complete reference for all 57 events emitted by the escrow contract
(`contracts/escrow/src/events.rs`).

> **Sync note:** This document must stay in sync with the contract's
> `events.rs`. When adding events, update both files.

## Payload Fields

Most events include these common fields:

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | `u32` | Payload schema version for forward compatibility |
| `prev_state` | `Option<EscrowState>` | State before the event (if applicable) |
| `new_state` | `Option<EscrowState>` | State after the event (if applicable) |
| `escrow_id` | `String` | Unique escrow identifier |

---

## Escrow Lifecycle Events

### EscrowCreated

Emitted when a new escrow is created.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "buyer": "G...",
  "vendor": "G...",
  "amount": "string",
  "asset": "string",
  "tracking_id": "string | null",
  "created_at": "ISO 8601",
  "prev_state": null,
  "new_state": "CREATED"
}
```

### EscrowFunded

Emitted when the buyer deposits funds into escrow.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "funder": "G...",
  "amount": "string",
  "funded_at": "ISO 8601",
  "prev_state": "CREATED",
  "new_state": "FUNDED"
}
```

### EscrowShipped

Emitted when the vendor marks the item as shipped.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "tracking_id": "string",
  "shipped_at": "ISO 8601",
  "prev_state": "FUNDED",
  "new_state": "SHIPPED"
}
```

### EscrowDelivered / DeliveryRecorded

Emitted when delivery is recorded on-chain.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "delivered_at": "ISO 8601",
  "prev_state": "SHIPPED",
  "new_state": "DELIVERED"
}
```

### EscrowReleased

Emitted when funds are released to the vendor.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "released_at": "ISO 8601",
  "prev_state": "DELIVERED",
  "new_state": "RELEASED"
}
```

### EscrowCancelled / EscrowCanceled

Emitted when an escrow is cancelled.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "cancelled_by": "G...",
  "reason": "string | null",
  "cancelled_at": "ISO 8601",
  "prev_state": "any",
  "new_state": "CANCELLED"
}
```

### EscrowRefunded

Emitted when funds are refunded to the buyer.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "refunded_at": "ISO 8601",
  "prev_state": "any",
  "new_state": "REFUNDED"
}
```

### Expired

Emitted when an escrow expires past its deadline.

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "expired_at": "ISO 8601",
  "prev_state": "any",
  "new_state": "EXPIRED"
}
```

### AutoCancel

Emitted when an escrow is automatically cancelled (e.g., timeout).

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "reason": "string",
  "cancelled_at": "ISO 8601",
  "prev_state": "any",
  "new_state": "CANCELLED"
}
```

---

## Dispute Events

### DisputeOpened

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "opened_by": "G...",
  "reason": "string",
  "opened_at": "ISO 8601",
  "prev_state": "any",
  "new_state": "DISPUTED"
}
```

### DisputePending

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "pending_at": "ISO 8601",
  "prev_state": "DISPUTED",
  "new_state": "DISPUTE_PENDING"
}
```

### DisputeAppealed

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "appealed_by": "G...",
  "appealed_at": "ISO 8601",
  "prev_state": "DISPUTE_PENDING",
  "new_state": "DISPUTED"
}
```

### DisputeResolved

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "resolution": "string",
  "resolved_at": "ISO 8601",
  "prev_state": "DISPUTED | DISPUTE_PENDING",
  "new_state": "RELEASED | REFUNDED"
}
```

---

## Refund Events

### RefundRequested

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "requested_by": "G...",
  "reason": "string",
  "requested_at": "ISO 8601",
  "prev_state": "any",
  "new_state": "REFUND_REQUESTED"
}
```

### RefundApproved

```json
{
  "schema_version": 1,
  "escrow_id": "string",
  "approved_by": "G...",
  "approved_at": "ISO 8601",
  "prev_state": "REFUND_REQUESTED",
  "new_state": "REFUNDED"
}
```

---

## Contract Admin Events (not handled by backend)

These events are emitted by the contract but do **not** carry `escrow_id`.
The backend poller skips them without dead-lettering.

| Event | Description |
|-------|-------------|
| `FeeUpdated` | Protocol fee changed |
| `TreasuryUpdated` | Treasury address changed |
| `TimelockUpdated` | Timelock duration changed |
| `Paused` | Contract paused |
| `Unpaused` | Contract unpaused |
| `AllowlistUpdated` | Allowlist entry added/removed |
| `contract_upgraded` | Contract WASM upgraded |
| `OwnershipTransferred` | Contract ownership changed |

---

## Events Emitted (57 total)

<details>
<summary>Full event list</summary>

1. EscrowCreated
2. EscrowFunded
3. EscrowShipped
4. EscrowDelivered
5. DeliveryRecorded
6. EscrowReleased
7. EscrowCancelled
8. EscrowCanceled
9. EscrowRefunded
10. Expired
11. AutoCancel
12. DisputeOpened
13. DisputePending
14. DisputeAppealed
15. DisputeResolved
16. RefundRequested
17. RefundApproved
18. FeeUpdated
19. TreasuryUpdated
20. TimelockUpdated
21. Paused
22. Unpaused
23. AllowlistUpdated
24. contract_upgraded
25. OwnershipTransferred
26-57. (Additional events — see `contracts/escrow/src/events.rs` for the complete source)

</details>
