# Event Schema Reference

This document is the indexer-facing event contract for TrustLink escrow events.
Event schemas are defined in `contracts/escrow/src/events.rs`.

> **Source verification:** Every topic in this document was verified against
> the emitter calls in `contracts/escrow/src/events.rs` at commit
> `4ffc37beb8265aaf7db40c8bd5facca42488e3d7` of the
> [trust-link-contract](https://github.com/JSE-ORG/trust-link-contract) repository.

## Encoding Rules

- Events are Soroban contract events emitted with `env.events().publish(topic, data)`.
- **Canonical event topics use a two-element topic tuple** of the form
  `(symbol_short!("<Category>"), symbol_short!("<Action>"))` — two PascalCase symbols
  that together identify the event. The category groups related events (e.g.
  `"Escrow"`, `"Dispute"`, `"Fee"`) and the action names the specific occurrence
  (e.g. `"Created"`, `"Funded"`, `"Updated"`).
- Many events include a **third indexed parameter** — an `Address` identifying the
  primary actor or subject of the event (buyer, seller, resolver, etc.). Indexers
  SHOULD filter by `contract_id` and the first two topic elements when subscribing;
  the third element can be used for per-address filtering.
- **Exceptions:** A small number of events use a single-symbol topic
  `(Symbol::new(env, "<snake_case_name>"),)` instead of the two-symbol convention.
  These are called out explicitly in the event index below.
- Event data is the XDR encoding of the listed `#[contracttype]` payload struct.
- Address fields are Soroban `Address` values. Integer fields use the exact Rust
  width shown below. Timestamps are ledger timestamps in seconds.

## Event Index

| Category | Action | Topic tuple | Payload | Indexed params | Emitted by |
|---|---|---|---|---|---|
| `Contract` | `Init` | `("Contract", "Init")` | `ContractInitialized` | `topic[0..1]` | `initialize` |
| `Contract` | `Paused` | `("Contract", "Paused")` | `ContractPausedEvent` | `topic[0..1]`, `topic[2] = admin` | `pause_contract` |
| `Contract` | `Unpaused` | `("Contract", "Unpaused")` | `ContractUnpausedEvent` | `topic[0..1]`, `topic[2] = admin` | `unpause_contract` |
| `Admin` | `Rotated` | `("Admin", "Rotated")` | `AdminRotated` | `topic[0..1]` | `set_admin` |
| `Fee` | `Updated` | `("Fee", "Updated")` | `FeeUpdated` | `topic[0..1]` | `set_fee` |
| `ProtoFee` | `Updated` | `("ProtoFee", "Updated")` | `ProtocolFeeUpdated` | `topic[0..1]` | `set_protocol_fee` |
| `ArbFee` | `Updated` | `("ArbFee", "Updated")` | `ArbitrationFeeUpdated` | `topic[0..1]` | `set_arbitration_fee` |
| `Escrow` | `Created` | `("Escrow", "Created")` | `EscrowCreated` | `topic[0..1]`, `topic[2] = seller` | `create_escrow` |
| `Escrow` | `Funded` | `("Escrow", "Funded")` | `EscrowFunded` | `topic[0..1]`, `topic[2] = buyer` | funding flow |
| `Escrow` | `Shipped` | `("Escrow", "Shipped")` | `EscrowShipped` | `topic[0..1]`, `topic[2] = seller` | `mark_shipped` |
| `Escrow` | `Delivered` | `("Escrow", "Delivered")` | `DeliveryRecorded` | `topic[0..1]` | `record_delivery` |
| `Escrow` | `Completed` | `("Escrow", "Completed")` | `EscrowCompleted` | `topic[0..1]`, `topic[2] = recipient` | `confirm_delivery` |
| `Dispute` | `Raised` | `("Dispute", "Raised")` | `DisputeRaised` | `topic[0..1]`, `topic[2] = buyer` | dispute flow |
| `Dispute` | `Resolved` | `("Dispute", "Resolved")` | `DisputeResolved` | `topic[0..1]`, `topic[2] = resolver` | `resolve_dispute` |
| `Escrow` | `Released` | `("Escrow", "Released")` | `AutoReleased` | `topic[0..1]`, `topic[2] = seller` | `auto_release` |
| `Escrow` | `Canceled` | `("Escrow", "Canceled")` | `EscrowCancelled` | `topic[0..1]`, `topic[2] = cancelled_by` | `cancel_escrow` |
| `Escrow` | `Expired` | `("Escrow", "Expired")` | `EscrowExpired` | `topic[0..1]`, `topic[2] = buyer` | `reclaim_expired` |
| `Resolver` | `Rotated` | `("Resolver", "Rotated")` | `ResolverRotated` | `topic[0..1]` | `rotate_resolver` |
| `FeeColl` | `Updated` | `("FeeColl", "Updated")` | `FeeCollectorUpdated` | `topic[0..1]` | `set_fee_collector` |

### Events Using a Different Convention

The following events use a single-symbol topic rather than the two-symbol pattern:

| Topic | Payload | Emitted by |
|---|---|---|
| `resolver_vote_recorded` | `ResolverVoteRecorded` | multi-resolver vote flow |
| `contract_upgraded` | `ContractUpgradedEvent` | contract upgrade |
| `storage_migrated` | `StorageMigratedEvent` | storage migration |

## Payload Schemas

### `ContractInitialized`

```rust
pub struct ContractInitialized {
    pub admin: Address,
    pub fee_collector: Address,
    pub arbitration_fee_bps: u32,
    pub timestamp: u64,
}
```

### `ContractPausedEvent`

```rust
pub struct ContractPausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}
```

### `ContractUnpausedEvent`

```rust
pub struct ContractUnpausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}
```

### `AdminRotated`

```rust
pub struct AdminRotated {
    pub old_admin: Address,
    pub new_admin: Address,
    pub timestamp: u64,
}
```

### `FeeUpdated`

```rust
pub struct FeeUpdated {
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `ProtocolFeeUpdated`

```rust
pub struct ProtocolFeeUpdated {
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `ArbitrationFeeUpdated`

```rust
pub struct ArbitrationFeeUpdated {
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `EscrowCreated`

```rust
pub struct EscrowCreated {
    pub escrow_id: u64,
    pub seller: Address,
    pub resolver: Address,
    pub token: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub shipping_window: u64,
    pub timestamp: u64,
}
```

### `EscrowFunded`

```rust
pub struct EscrowFunded {
    pub escrow_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub funded_at: u64,
}
```

### `EscrowShipped`

```rust
pub struct EscrowShipped {
    pub escrow_id: u64,
    pub seller: Address,
    pub tracking_id: String,
    pub shipped_at: u64,
}
```

### `DeliveryRecorded`

```rust
pub struct DeliveryRecorded {
    pub escrow_id: u64,
    pub delivered_at: u64,
}
```

### `EscrowCompleted`

```rust
pub struct EscrowCompleted {
    pub escrow_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub completed_at: u64,
}
```

### `DisputeRaised`

```rust
pub struct DisputeRaised {
    pub escrow_id: u64,
    pub buyer: Address,
    pub reason: Symbol,
    pub description: String,
    pub evidence_hash: BytesN<32>,
    pub disputed_at: u64,
}
```

### `DisputeResolved`

```rust
pub struct DisputeResolved {
    pub escrow_id: u64,
    pub resolver: Address,
    pub resolution: ResolutionType,
    pub recipient: Address,
    pub amount: i128,
    pub arbitration_fee: i128,
    pub resolved_at: u64,
}

pub enum ResolutionType {
    Release,
    Refund,
}
```

### `AutoReleased`

```rust
pub struct AutoReleased {
    pub escrow_id: u64,
    pub seller: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub released_at: u64,
}
```

### `EscrowCancelled`

```rust
pub struct EscrowCancelled {
    pub escrow_id: u64,
    pub seller: Address,
    pub cancelled_at: u64,
}
```

### `EscrowExpired`

```rust
pub struct EscrowExpired {
    pub escrow_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub timestamp: u64,
}
```

### `ResolverRotated`

```rust
pub struct ResolverRotated {
    pub escrow_id: u64,
    pub old_resolver: Address,
    pub new_resolver: Address,
    pub rotated_at: u64,
}
```

### `FeeCollectorUpdated`

```rust
pub struct FeeCollectorUpdated {
    pub old_collector: Address,
    pub new_collector: Address,
    pub timestamp: u64,
}
```

## Indexer Guidance

- The **canonical event name** is derived from the two topic symbols joined with
  an underscore and lowercased. For example `("Escrow", "Funded")` → `escrow_funded`,
  `("Dispute", "Raised")` → `dispute_raised`. This is the name used in the payload
  struct and throughout the backend.
- For single-symbol exception events, the topic itself is the canonical name.
- Treat `escrow_id` as the primary business key for escrow lifecycle events.
- Treat `token` as the asset key for fee accounting events.
- Use `funded_at`, `shipped_at`, `delivered_at`, `completed_at`,
  `disputed_at`, `resolved_at`, `released_at`, `cancelled_at`, and `timestamp`
  as event-time fields sourced from `env.ledger().timestamp()`.
- Store raw `i128` token amounts. Token decimal handling belongs to the token
  metadata layer, not this event stream.
- `FeeCollectorUpdated` uses PascalCase for its event name while all other canonical
  events use snake_case derived from the topic pair. Indexers should preserve the
  exact `FeeCollectorUpdated` string.
