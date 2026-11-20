# Event Schema Reference

This document is the indexer-facing event contract for TrustLink escrow events emitted by the Soroban escrow contract.

> **Source of truth:** `contracts/escrow/src/events.rs` in [JSE-ORG/trust-link-contract](https://github.com/JSE-ORG/trust-link-contract) at commit [`9270a1b61378a58201e1f126c5c0f107687bcd89`](https://github.com/JSE-ORG/trust-link-contract/commit/9270a1b61378a58201e1f126c5c0f107687bcd89) (`main`).  
> Every topic tuple and payload struct below was verified against that source. Payload structs include `schema_version: u32` (`EVENT_SCHEMA_VERSION = 4` at this commit).

## Encoding and indexing rules

- Events are Soroban contract events emitted with `env.events().publish(topic, data)`.
- Most events use a **two-symbol topic tuple** `(symbol_short!("<Category>"), symbol_short!("<Action>"), ...)` with zero or more indexed parameters (addresses, ids, or operation codes). A few events use a single-symbol topic such as `(Symbol::new(env, "resolver_vote_recorded"),)` or `(Symbol::new(env, "PendingExpiry"), symbol_short!("Cleared"))` (see index).
- **All documented payloads carry `schema_version: u32`** (currently `4`). Consumers should gate decoding/migrations on `schema_version`.
- Event data is the XDR encoding of the listed `#[contracttype]` payload struct. `Address` fields are Soroban addresses; integer widths and `bool` match the Rust definitions; timestamps are ledger timestamps in seconds unless otherwise implied by the field name.
- **Backend handling:** the Soroban poller derives an internal event type by concatenating the first two topic symbols when present (e.g. `Escrow` + `Funded` → `EscrowFunded`) and applies overrides for `EscrowReleased` → `AutoReleased`, `EscrowCanceled`/`EscrowCancelled` → `EscrowCancelled`, and `EscrowAutoCncl` → `EscrowAutoCancelled`. `EscrowService.syncStateFromChain` mutates backend escrow/dispute state only for events marked **Handled = Yes** below; all other contract events are observable/indexable but not mapped to backend state transitions by that sync path.
- **Amount semantics:** `EscrowCompleted.amount` is gross before protocol fee (net payout is `amount - floor(amount * fee_bps / 10_000)`). `DisputeResolved.amount` is gross after arbitration/resolver fees but before platform/protocol fees as documented in the payload.

## Event index (complete)

| # | Topic tuple | Payload struct | Indexed topic params | Backend handled | Backend state mapping / effect | Notes |
|---:|---|---|---|:---:|---|---|
| 1 | `(symbol_short!("Fee"), symbol_short!("Updated"),)` | `FeeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `FeeUpdated`). |
| 2 | `(symbol_short!("ProtoFee"), symbol_short!("Updated"),)` | `ProtocolFeeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ProtoFeeUpdated`). |
| 3 | `(symbol_short!("ArbFee"), symbol_short!("Updated"),)` | `ArbitrationFeeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ArbFeeUpdated`). |
| 4 | `(symbol_short!("Admin"), symbol_short!("Rotated"),)` | `AdminRotated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `AdminRotated`). |
| 5 | `(symbol_short!("Contract"), symbol_short!("Paused"), admin.clone(),)` | `ContractPausedEvent` | `topic[0..1]`, `topic[2] = admin` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ContractPaused`). |
| 6 | `(symbol_short!("Contract"), symbol_short!("Unpaused"), admin.clone(),)` | `ContractUnpausedEvent` | `topic[0..1]`, `topic[2] = admin` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ContractUnpaused`). |
| 7 | `(symbol_short!("Escrow"), symbol_short!("Created"), seller.clone(), resolver.clone())` | `EscrowCreated` | `topic[0..1]`, `topic[2] = seller`, `topic[3] = resolver` | No | — | Escrow lifecycle origin event; not consumed by `syncStateFromChain` state transitions (backend escrow records are created off-chain/API side). |
| 8 | `(symbol_short!("Escrow"), symbol_short!("Funded"), escrow_id, buyer.clone())` | `EscrowFunded` | `topic[0..1]`, `topic[2] = escrow_id`, `topic[3] = buyer` | Yes | `FUNDED` (from `CREATED`) | Idempotent; skipped if already funded or terminal. |
| 9 | `(symbol_short!("Escrow"), symbol_short!("Shipped"), seller.clone(),)` | `EscrowShipped` | `topic[0..1]`, `topic[2] = seller` | Yes | `SHIPPED` | Idempotent; accepted from `CREATED` or `FUNDED` (forward-jump tolerated when funding event was missed). Uses `tracking_id` when provided. |
| 10 | `(symbol_short!("Escrow"), symbol_short!("Delivered"),)` | `DeliveryRecorded` | `topic[0..1]` | No | — | Delivery recorded on-chain; not mapped to a backend escrow state transition in `syncStateFromChain`. |
| 11 | `(symbol_short!("Escrow"), symbol_short!("Completed"), recipient.clone(),)` | `EscrowCompleted` | `topic[0..1]`, `topic[2] = recipient` | Yes | `COMPLETED` | Idempotent; skipped if already completed or terminal. |
| 12 | `(symbol_short!("Dispute"), symbol_short!("Raised"), buyer.clone(),)` | `DisputeRaised` | `topic[0..1]`, `topic[2] = buyer` | Yes | `DISPUTED` | Moves escrow to `DISPUTED` and creates a dispute record when Prisma is wired; skipped if already disputed/terminal. |
| 13 | `(symbol_short!("Dispute"), symbol_short!("Resolved"), resolver.clone(),)` | `DisputeResolved` | `topic[0..1]`, `topic[2] = resolver` | Yes | `REFUNDED` or `COMPLETED` | `Refund` resolution → `REFUNDED`; `Release` resolution → `COMPLETED`. Marks related dispute resolved when present. |
| 14 | `(\"resolver_vote_recorded\",)` | `ResolverVoteRecorded` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `resolver_vote_recorded`). |
| 15 | `(symbol_short!("Escrow"), symbol_short!("Released"), seller.clone(),)` | `AutoReleased` | `topic[0..1]`, `topic[2] = seller` | Yes | `RELEASED` | Derived from `("Escrow","Released")` via poller override. Poller uses the RPC event id as tx-hash fallback for this event. |
| 16 | `(symbol_short!("Escrow"), symbol_short!("Canceled"), cancelled_by.clone(),)` | `EscrowCanceled` | `topic[0..1]`, `topic[2] = cancelled_by` | Yes | `CANCELLED` | Idempotent; skipped if already cancelled or terminal. Handles both `EscrowCanceled` and `EscrowCancelled` topic spellings via poller normalization. |
| 17 | `(symbol_short!("Escrow"), symbol_short!("Expired"), buyer.clone(),)` | `EscrowExpired` | `topic[0..1]`, `topic[2] = buyer` | Yes | `REFUNDED` | Reclaimed/expired escrow transitions to refunded state in backend sync. |
| 18 | `(symbol_short!("Escrow"), symbol_short!("AutoCncl"),)` | `EscrowAutoCanceled` | `topic[0..1]` | Yes | `CANCELLED` | Derived from `("Escrow","AutoCncl")` via poller override. Permissionless keeper auto-cancel. |
| 19 | `(symbol_short!("Contract"), symbol_short!("Init"),)` | `ContractInitialized` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ContractInit`). |
| 20 | `(symbol_short!("Resolver"), symbol_short!("Rotated"),)` | `ResolverRotated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ResolverRotated`). |
| 21 | `(symbol_short!("Token"), symbol_short!("Allowlist"), token.clone(),)` | `TokenAllowlistUpdated` | `topic[0..1]`, `topic[2] = token` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TokenAllowlist`). |
| 22 | `(symbol_short!("Allowlist"), symbol_short!("Toggled"),)` | `AllowlistToggled` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `AllowlistToggled`). |
| 23 | `(symbol_short!("Dispute"), symbol_short!("Pending"), resolver.clone(),)` | `DisputePendingFinalization` | `topic[0..1]`, `topic[2] = resolver` | No | — | Dispute moved to pending finalization/appeal window; not mapped in `syncStateFromChain`. |
| 24 | `(symbol_short!("Dispute"), symbol_short!("Appealed"), appellant.clone(),)` | `DisputeAppealed` | `topic[0..1]`, `topic[2] = appellant` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `DisputeAppealed`). |
| 25 | `(symbol_short!("PlatFee"), symbol_short!("Updated"),)` | `PlatformFeeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `PlatFeeUpdated`). |
| 26 | `(symbol_short!("Treasury"), symbol_short!("Updated"),)` | `TreasuryUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TreasuryUpdated`). |
| 27 | `(symbol_short!("Basket"), symbol_short!("Created"), seller.clone(),)` | `BasketEscrowCreated` | `topic[0..1]`, `topic[2] = seller` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `BasketCreated`). |
| 28 | `(symbol_short!("Message"), symbol_short!("Posted"), sender.clone(),)` | `MessagePosted` | `topic[0..1]`, `topic[2] = sender` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `MessagePosted`). |
| 29 | `(symbol_short!("Refund"), symbol_short!("Requested"), buyer.clone(),)` | `RefundRequestedEvent` | `topic[0..1]`, `topic[2] = buyer` | No | — | Buyer requested refund; not mapped in `syncStateFromChain`. |
| 30 | `(symbol_short!("Refund"), symbol_short!("Approved"), seller.clone(),)` | `RefundApprovedEvent` | `topic[0..1]`, `topic[2] = seller` | Yes | `REFUNDED` | Seller-approved refund finalized on-chain. |
| 31 | `("contract_upgraded",)` | `ContractUpgradedEvent` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `contract_upgraded`). |
| 32 | `("storage_migrated",)` | `StorageMigratedEvent` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `storage_migrated`). |
| 33 | `(symbol_short!("TtlExt"), symbol_short!("Updated"),)` | `TtlExtensionUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TtlExtUpdated`). |
| 34 | `(symbol_short!("AmtLimit"), symbol_short!("Updated"),)` | `AmountLimitsUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `AmtLimitUpdated`). |
| 35 | `(symbol_short!("Action"), symbol_short!("Paused"), action.clone(),)` | `ActionPausedEvent` | `topic[0..1]`, `topic[2] = action` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ActionPaused`). |
| 36 | `(symbol_short!("Action"), symbol_short!("Unpaused"), action.clone(),)` | `ActionUnpausedEvent` | `topic[0..1]`, `topic[2] = action` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ActionUnpaused`). |
| 37 | `(symbol_short!("Resolver"), symbol_short!("Approved"), resolver.clone(),)` | `ResolverApproved` | `topic[0..1]`, `topic[2] = resolver` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ResolverApproved`). |
| 38 | `(symbol_short!("Resolver"), symbol_short!("Removed"), resolver.clone(),)` | `ResolverRemoved` | `topic[0..1]`, `topic[2] = resolver` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ResolverRemoved`). |
| 39 | `(symbol_short!("ResStrct"), symbol_short!("Updated"),)` | `ResolverStrictUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `ResStrctUpdated`). |
| 40 | `(symbol_short!("FeeColl"), symbol_short!("Pending"),)` | `FeeCollectorPending` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `FeeCollPending`). |
| 41 | `(symbol_short!("FeeColl"), symbol_short!("Accepted"),)` | `FeeCollectorAccepted` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `FeeCollAccepted`). |
| 42 | `(symbol_short!("FeeColl"), symbol_short!("Updated"), new_collector.clone(),)` | `FeeCollectorUpdated` | `topic[0..1]`, `topic[2] = new_collector` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `FeeCollUpdated`). |
| 43 | `(symbol_short!("Treasury"), symbol_short!("Pending"),)` | `TreasuryPending` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TreasuryPending`). |
| 44 | `(symbol_short!("Treasury"), symbol_short!("Accepted"),)` | `TreasuryAccepted` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TreasuryAccepted`). |
| 45 | `(symbol_short!("Emergency"), symbol_short!("Drain"),)` | `EmergencyDrain` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `EmergencyDrain`). |
| 46 | `(symbol_short!("Delivery"), symbol_short!("Proposed"),)` | `DeliveryProposed` | `topic[0..1]` | No | — | Delivery proposal lifecycle event; not mapped in `syncStateFromChain`. |
| 47 | `(symbol_short!("Delivery"), symbol_short!("Cancelled"),)` | `DeliveryProposalCancelled` | `topic[0..1]` | No | — | Delivery proposal cancelled; not mapped in `syncStateFromChain`. |
| 48 | `(Symbol::new(env, "PendingExpiry"), symbol_short!("Cleared"),)` | `PendingExpiryClear` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `PendingExpiryCleared`). |
| 49 | `(symbol_short!("Timelock"), symbol_short!("Queued"), operation as u32,)` | `TimelockQueued` | `topic[0..1]`, `topic[2] = operation (u32)` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TimelockQueued`). |
| 50 | `(symbol_short!("Timelock"), symbol_short!("Executed"), operation as u32,)` | `TimelockExecuted` | `topic[0..1]`, `topic[2] = operation (u32)` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TimelockExecuted`). |
| 51 | `(symbol_short!("Timelock"), symbol_short!("Cancelled"), operation as u32,)` | `TimelockCancelled` | `topic[0..1]`, `topic[2] = operation (u32)` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `TimelockCancelled`). |
| 52 | `(symbol_short!("MaxAppeal"), symbol_short!("Updated"),)` | `MaxAppealsUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `MaxAppealUpdated`). |
| 53 | `(symbol_short!("MaxBasket"), symbol_short!("Updated"),)` | `MaxBasketSizeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `MaxBasketUpdated`). |
| 54 | `(symbol_short!("Recovery"), symbol_short!("Withdraw"),)` | `RecoveryWithdraw` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `RecoveryWithdraw`). |
| 55 | `(symbol_short!("Admin"), symbol_short!("DelayUpd"),)` | `TimelockDelayUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `AdminDelayUpd`). |
| 56 | `(symbol_short!("AppealFee"), symbol_short!("Updated"),)` | `AppealFeeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `AppealFeeUpdated`). |
| 57 | `(symbol_short!("Recovery"), symbol_short!("ModeUpd"),)` | `RecoveryModeUpdated` | `topic[0..1]` | No | — | Indexed/observable contract event; not mapped by `EscrowService.syncStateFromChain` (derived event type `RecoveryModeUpd`). |

## Payload schemas

Fields are shown in struct declaration order. All payloads include `pub schema_version: u32`.

### `FeeUpdated`

```rust
pub struct FeeUpdated {

    pub schema_version: u32,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `ProtocolFeeUpdated`

```rust
pub struct ProtocolFeeUpdated {

    pub schema_version: u32,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `ArbitrationFeeUpdated`

```rust
pub struct ArbitrationFeeUpdated {

    pub schema_version: u32,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `AdminRotated`

```rust
pub struct AdminRotated {

    pub schema_version: u32,
    pub old_admin: Address,
    pub new_admin: Address,
    pub timestamp: u64,
}
```

### `ContractPausedEvent`

```rust
pub struct ContractPausedEvent {

    pub schema_version: u32,
    pub admin: Address,
    pub timestamp: u64,
}
```

### `ContractUnpausedEvent`

```rust
pub struct ContractUnpausedEvent {

    pub schema_version: u32,
    pub admin: Address,
    pub timestamp: u64,
}
```

### `EscrowCreated`

```rust
pub struct EscrowCreated {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub seller: Address,
    pub resolver: Address,
    pub token: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub resolver_fee_bps: u32,
    pub shipping_window: u64,
    pub expires_at: Option<u64>,
    pub timestamp: u64,
    pub new_state: crate::EscrowState,
}
```

### `EscrowFunded`

```rust
pub struct EscrowFunded {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
    /// Basket token addresses and amounts (optional, for basket escrows).
    /// Field added in `schema_version` 3 for issue #668.
    pub basket_tokens: Option<soroban_sdk::Vec<(Address, i128)>>,
}
```

### `EscrowShipped`

```rust
pub struct EscrowShipped {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub seller: Address,
    pub tracking_id: String,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `DeliveryRecorded`

```rust
pub struct DeliveryRecorded {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub delivered_at: u64,
}
```

### `EscrowCompleted`

```rust
pub struct EscrowCompleted {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub recipient: Address,
    /// Gross escrowed amount **before** the protocol fee. This is not the
    /// amount transferred to `recipient`: the net payout is
    /// `amount - floor(amount * fee_bps / 10_000)`.
    pub amount: i128,
    /// Protocol fee rate, in basis points, that was applied to `amount`.
    pub fee_bps: u32,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `DisputeRaised`

```rust
pub struct DisputeRaised {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub buyer: Address,
    pub reason: Symbol,
    pub description: Bytes,
    pub evidence_hash: BytesN<32>,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `DisputeResolved`

```rust
pub struct DisputeResolved {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub resolver: Address,
    pub resolution: ResolutionType,
    pub recipient: Address,
    /// Gross amount still held for the escrow after the arbitration and
    /// resolver fees were paid, but **before** the platform and protocol fees.
    /// This is not the amount transferred to `recipient`. The net payout is
    /// `amount - platform_fee - protocol_fee`, where `protocol_fee` is
    /// `floor((amount + arbitration_fee + resolver_fee) * fee_bps / 10_000)`
    /// and `fee_bps` is the escrow's snapshotted protocol fee rate.
    pub amount: i128,
    pub arbitration_fee: i128,
    pub resolver_fee: i128,
    pub platform_fee: i128,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

Related enum (`ResolutionType`):

```rust
pub enum ResolutionType {
    Release,
    Refund,
}
```

### `ResolverVoteRecorded`

```rust
pub struct ResolverVoteRecorded {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub resolver: Address,
    pub resolution: ResolutionType,
    pub vote_count: u32,
    pub threshold: u32,
    pub voted_at: u64,
}
```

### `AutoReleased`

```rust
pub struct AutoReleased {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub seller: Address,
    pub amount: i128,
    pub fee_bps: u32,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `EscrowCanceled`

```rust
pub struct EscrowCanceled {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub seller: Address,
    /// Address that actually initiated the cancellation (buyer or a payee/seller).
    /// `seller` always reflects the escrow's seller; `cancelled_by` reflects the caller.
    pub cancelled_by: Address,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `EscrowExpired`

```rust
pub struct EscrowExpired {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `EscrowAutoCanceled`

```rust
pub struct EscrowAutoCanceled {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub timestamp: u64,
}
```

### `ContractInitialized`

```rust
pub struct ContractInitialized {

    pub schema_version: u32,
    pub admin: Address,
    pub fee_collector: Address,
    pub arbitration_fee_bps: u32,
    pub timestamp: u64,
}
```

### `ResolverRotated`

```rust
pub struct ResolverRotated {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub old_resolver: Address,
    pub new_resolver: Address,
    pub rotated_at: u64,
}
```

### `TokenAllowlistUpdated`

```rust
pub struct TokenAllowlistUpdated {

    pub schema_version: u32,
    pub added: bool,
    pub timestamp: u64,
}
```

### `AllowlistToggled`

```rust
pub struct AllowlistToggled {

    pub schema_version: u32,
    pub enabled: bool,
    pub timestamp: u64,
}
```

### `DisputePendingFinalization`

```rust
pub struct DisputePendingFinalization {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub resolver: Address,
    pub resolution: crate::ResolutionType,
    pub amount: i128,
    pub appeal_deadline: u64,
    pub pending_at: u64,
}
```

_`resolution` uses `crate::ResolutionType` (`Release` | `Refund`)._

### `DisputeAppealed`

```rust
pub struct DisputeAppealed {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub appellant: Address,
    pub timestamp: u64,
}
```

### `PlatformFeeUpdated`

```rust
pub struct PlatformFeeUpdated {

    pub schema_version: u32,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `TreasuryUpdated`

```rust
pub struct TreasuryUpdated {

    pub schema_version: u32,
    pub old_treasury: Address,
    pub new_treasury: Address,
    pub timestamp: u64,
}
```

### `BasketEscrowCreated`

```rust
pub struct BasketEscrowCreated {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub seller: Address,
    pub token_count: u32,
    pub timestamp: u64,
}
```

### `MessagePosted`

```rust
pub struct MessagePosted {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub sender: Address,
    pub timestamp: u64,
}
```

### `RefundRequestedEvent`

```rust
pub struct RefundRequestedEvent {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub buyer: Address,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
    /// Basket token addresses and amounts (optional, for basket escrows).
    /// Field added in `schema_version` 3 for issue #669.
    pub basket_tokens: Option<soroban_sdk::Vec<(Address, i128)>>,
}
```

### `RefundApprovedEvent`

```rust
pub struct RefundApprovedEvent {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub seller: Address,
    pub timestamp: u64,
    pub prev_state: crate::EscrowState,
    pub new_state: crate::EscrowState,
}
```

### `ContractUpgradedEvent`

```rust
pub struct ContractUpgradedEvent {

    pub schema_version: u32,
    pub admin: Address,
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
    pub timestamp: u64,
}
```

### `StorageMigratedEvent`

```rust
pub struct StorageMigratedEvent {

    pub schema_version: u32,
    pub admin: Address,
    pub from_version: u32,
    pub to_version: u32,
    pub timestamp: u64,
}
```

### `TtlExtensionUpdated`

```rust
pub struct TtlExtensionUpdated {

    pub schema_version: u32,
    pub old_ledgers: u32,
    pub new_ledgers: u32,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `AmountLimitsUpdated`

```rust
pub struct AmountLimitsUpdated {

    pub schema_version: u32,
    pub old_min_amount: i128,
    pub new_min_amount: i128,
    pub old_max_amount: i128,
    pub new_max_amount: i128,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `ActionPausedEvent`

```rust
pub struct ActionPausedEvent {

    pub schema_version: u32,
    pub action: Symbol,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `ActionUnpausedEvent`

```rust
pub struct ActionUnpausedEvent {

    pub schema_version: u32,
    pub action: Symbol,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `ResolverApproved`

```rust
pub struct ResolverApproved {

    pub schema_version: u32,
    pub resolver: Address,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `ResolverRemoved`

```rust
pub struct ResolverRemoved {

    pub schema_version: u32,
    pub resolver: Address,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `ResolverStrictUpdated`

```rust
pub struct ResolverStrictUpdated {

    pub schema_version: u32,
    pub old_strict: bool,
    pub new_strict: bool,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `FeeCollectorPending`

```rust
pub struct FeeCollectorPending {

    pub schema_version: u32,
    pub old_collector: Address,
    pub pending_collector: Address,
    pub timestamp: u64,
}
```

### `FeeCollectorAccepted`

```rust
pub struct FeeCollectorAccepted {

    pub schema_version: u32,
    pub old_collector: Address,
    pub new_collector: Address,
    pub timestamp: u64,
}
```

### `FeeCollectorUpdated`

```rust
pub struct FeeCollectorUpdated {

    pub schema_version: u32,
    pub old_collector: Address,
    pub timestamp: u64,
}
```

### `TreasuryPending`

```rust
pub struct TreasuryPending {

    pub schema_version: u32,
    pub old_treasury: Address,
    pub pending_treasury: Address,
    pub timestamp: u64,
}
```

### `TreasuryAccepted`

```rust
pub struct TreasuryAccepted {

    pub schema_version: u32,
    pub old_treasury: Address,
    pub new_treasury: Address,
    pub timestamp: u64,
}
```

### `EmergencyDrain`

```rust
pub struct EmergencyDrain {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
}
```

### `DeliveryProposed`

```rust
pub struct DeliveryProposed {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub proposed_at: u64,
    pub unlock_at: u64,
}
```

### `DeliveryProposalCancelled`

```rust
pub struct DeliveryProposalCancelled {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub timestamp: u64,
}
```

### `PendingExpiryClear`

```rust
pub struct PendingExpiryClear {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub timestamp: u64,
}
```

### `TimelockQueued`

```rust
pub struct TimelockQueued {

    pub schema_version: u32,
    pub operation: u32,
    pub proposer: Address,
    pub queued_at: u64,
    pub ready_at: u64,
}
```

### `TimelockExecuted`

```rust
pub struct TimelockExecuted {

    pub schema_version: u32,
    pub operation: u32,
    pub proposer: Address,
    pub executor: Address,
    pub params: soroban_sdk::Vec<soroban_sdk::Val>,
    pub executed_at: u64,
}
```

### `TimelockCancelled`

```rust
pub struct TimelockCancelled {

    pub schema_version: u32,
    pub operation: u32,
    pub proposer: Address,
    pub canceller: Address,
    pub cancelled_at: u64,
}
```

### `MaxAppealsUpdated`

```rust
pub struct MaxAppealsUpdated {

    pub schema_version: u32,
    pub old_max: u32,
    pub new_max: u32,
    pub timestamp: u64,
}
```

### `MaxBasketSizeUpdated`

```rust
pub struct MaxBasketSizeUpdated {

    pub schema_version: u32,
    pub old_max: u32,
    pub new_max: u32,
    pub timestamp: u64,
}
```

### `RecoveryWithdraw`

```rust
pub struct RecoveryWithdraw {

    pub schema_version: u32,
    pub escrow_id: u64,
    pub buyer: Address,
    pub amount: i128,
    pub timestamp: u64,
}
```

### `TimelockDelayUpdated`

```rust
pub struct TimelockDelayUpdated {

    pub schema_version: u32,
    pub old_delay: u64,
    pub new_delay: u64,
    pub caller: Address,
    pub timestamp: u64,
}
```

### `AppealFeeUpdated`

```rust
pub struct AppealFeeUpdated {

    pub schema_version: u32,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
    pub timestamp: u64,
}
```

### `RecoveryModeUpdated`

```rust
pub struct RecoveryModeUpdated {

    pub schema_version: u32,
    pub enabled: bool,
    pub caller: Address,
    pub timestamp: u64,
}
```

## Coverage summary

- Contract events documented: **57** (all `emit_*` topic/data pairs in `events.rs` at the referenced commit).
- Events with backend state-sync handling (`EscrowService.syncStateFromChain`): **10**.
- Lifecycle/state-changing events present in the contract and covered here include: escrow created/funded/shipped/delivered/completed/released/canceled/expired/auto-canceled, dispute raised/pending/appealed/resolved, refund requested/approved, and delivery proposal events, alongside admin, fee, resolver, treasury, timelock, recovery, and configuration events.
