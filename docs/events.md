# Event Schema Reference

This document is the indexer-facing event contract for TrustLink escrow events.
Event schemas are defined in `contracts/escrow/src/events.rs`, with one legacy
inline event in `set_fee_collector`.

## Encoding Rules

- Events are Soroban contract events emitted with `env.events().publish(topic, data)`.
- Canonical event topics use a one-element topic tuple: `(Symbol("<event_name>"),)`.
- Event data is the XDR encoding of the listed `#[contracttype]` payload struct.
- Unless explicitly listed otherwise, there are no additional indexed topic
  parameters. Indexers should filter by `contract_id` and topic element `0`.
- Address fields are Soroban `Address` values. Integer fields use the exact Rust
  width shown below. Timestamps are ledger timestamps in seconds.

## Event Index

| Topic | Payload | Indexed topic params | Emitted by |
|---|---|---|---|
| `contract_initialized` | `ContractInitialized` | `topic[0] = "contract_initialized"` | `initialize` |
| `contract_paused` | `ContractPausedEvent` | `topic[0] = "contract_paused"` | `pause_contract` |
| `contract_unpaused` | `ContractUnpausedEvent` | `topic[0] = "contract_unpaused"` | `unpause_contract` |
| `admin_rotated` | `AdminRotated` | `topic[0] = "admin_rotated"` | `set_admin` |
| `fee_updated` | `FeeUpdated` | `topic[0] = "fee_updated"` | `set_fee` |
| `protocol_fee_updated` | `ProtocolFeeUpdated` | `topic[0] = "protocol_fee_updated"` | `set_protocol_fee` |
| `arbitration_fee_updated` | `ArbitrationFeeUpdated` | `topic[0] = "arbitration_fee_updated"` | `set_arbitration_fee` |
| `fees_withdrawn` | `FeesWithdrawn` | `topic[0] = "fees_withdrawn"` | `withdraw_fees` |
| `escrow_created` | `EscrowCreated` | `topic[0] = "escrow_created"` | `create_escrow` |
| `escrow_funded` | `EscrowFunded` | `topic[0] = "escrow_funded"` | funding flow |
| `escrow_shipped` | `EscrowShipped` | `topic[0] = "escrow_shipped"` | `mark_shipped` |
| `delivery_recorded` | `DeliveryRecorded` | `topic[0] = "delivery_recorded"` | `record_delivery` |
| `escrow_completed` | `EscrowCompleted` | `topic[0] = "escrow_completed"` | `confirm_delivery` |
| `dispute_raised` | `DisputeRaised` | `topic[0] = "dispute_raised"` | dispute flow |
| `dispute_resolved` | `DisputeResolved` | `topic[0] = "dispute_resolved"` | `resolve_dispute` |
| `auto_released` | `AutoReleased` | `topic[0] = "auto_released"` | `auto_release` |
| `escrow_cancelled` | `EscrowCancelled` | `topic[0] = "escrow_cancelled"` | `cancel_escrow` |
| `resolver_rotated` | `ResolverRotated` | `topic[0] = "resolver_rotated"` | `rotate_resolver` |
| `FeeCollectorUpdated` | tuple | `topic[0] = "FeeCollectorUpdated"` | `set_fee_collector` |

## Payload Schemas

### `contract_initialized`

```rust
pub struct ContractInitialized {
    pub admin: Address,
    pub fee_collector: Address,
    pub arbitration_fee_bps: u32,
    pub timestamp: u64,
}
```

### `contract_paused`

```rust
pub struct ContractPausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}
```

### `contract_unpaused`

```rust
pub struct ContractUnpausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}
```

### `admin_rotated`

```rust
pub struct AdminRotated {
    pub old_admin: Address,
    pub new_admin: Address,
    pub timestamp: u64,
}
```

### `fee_updated`

```rust
pub struct FeeUpdated {
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `protocol_fee_updated`

```rust
pub struct ProtocolFeeUpdated {
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `arbitration_fee_updated`

```rust
pub struct ArbitrationFeeUpdated {
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `fees_withdrawn`

```rust
pub struct FeesWithdrawn {
    pub token: Address,
    pub to: Address,
    pub amount: i128,
    pub timestamp: u64,
}
```

### `escrow_created`

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

### `escrow_funded`

```rust
pub struct EscrowFunded {
    pub escrow_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub funded_at: u64,
}
```

### `escrow_shipped`

```rust
pub struct EscrowShipped {
    pub escrow_id: u64,
    pub seller: Address,
    pub tracking_id: String,
    pub shipped_at: u64,
}
```

### `delivery_recorded`

```rust
pub struct DeliveryRecorded {
    pub escrow_id: u64,
    pub delivered_at: u64,
}
```

### `escrow_completed`

```rust
pub struct EscrowCompleted {
    pub escrow_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub completed_at: u64,
}
```

### `dispute_raised`

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

### `dispute_resolved`

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

### `auto_released`

```rust
pub struct AutoReleased {
    pub escrow_id: u64,
    pub seller: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub released_at: u64,
}
```

### `escrow_cancelled`

```rust
pub struct EscrowCancelled {
    pub escrow_id: u64,
    pub seller: Address,
    pub cancelled_at: u64,
}
```

### `resolver_rotated`

```rust
pub struct ResolverRotated {
    pub escrow_id: u64,
    pub old_resolver: Address,
    pub new_resolver: Address,
    pub rotated_at: u64,
}
```

### `FeeCollectorUpdated`

This legacy event is emitted inline rather than through a named `#[contracttype]`
struct.

```rust
topic = ("FeeCollectorUpdated",)
data = (old_collector: Address, new_collector: Address)
```

## Indexer Guidance

- Treat `escrow_id` as the primary business key for escrow lifecycle events.
- Treat `token` as the asset key for fee accounting events.
- Use `funded_at`, `shipped_at`, `delivered_at`, `completed_at`,
  `disputed_at`, `resolved_at`, `released_at`, `cancelled_at`, and `timestamp`
  as event-time fields sourced from `env.ledger().timestamp()`.
- Store raw `i128` token amounts. Token decimal handling belongs to the token
  metadata layer, not this event stream.
- `FeeCollectorUpdated` uses PascalCase while all other canonical topics use
  snake_case. Indexers should preserve this exact topic string.

