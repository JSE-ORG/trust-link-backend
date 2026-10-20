# Soroban Compatibility Matrix

This matrix records the Soroban SDK and environment versions this repository is
known to build and test against. Update this file in the same PR as every
Soroban SDK bump.

## Current Compatibility

| Repo revision | Rust toolchain | WASM target | `soroban-sdk` requirement | Resolved `soroban-sdk` | Resolved env crates | Status |
|---|---|---|---|---|---|---|
| `main` / Unreleased | `stable` from `rust-toolchain.toml` | `wasm32v1-none` | `26` | `26.0.1` | `soroban-env-common` `26.1.3`, `soroban-env-guest` `26.1.3`, `soroban-env-host` `26.1.3` | Current lockfile baseline |

## Related Locked Packages

| Package | Version | Source of truth |
|---|---:|---|
| `soroban-sdk` | `26.0.1` | `Cargo.lock` |
| `soroban-sdk-macros` | `26.0.1` | `Cargo.lock` |
| `soroban-env-common` | `26.1.3` | `Cargo.lock` |
| `soroban-env-guest` | `26.1.3` | `Cargo.lock` |
| `soroban-env-host` | `26.1.3` | `Cargo.lock` |
| `soroban-ledger-snapshot` | `26.0.1` | `Cargo.lock` |
| `stellar-xdr` | `26.0.1` | `Cargo.lock` |

## Update Policy

Every PR that changes `soroban-sdk` or refreshes Soroban environment crates must:

1. Update the compatibility matrix above.
2. Commit the matching `Cargo.lock` changes.
3. Run `cargo test`.
4. Run `cargo build --target wasm32v1-none --release` when the target is
   installed locally or in CI.
5. Note any required Stellar CLI or network protocol constraints in this file.

If a version bump changes event XDR, storage encoding, authorization behavior, or
host budget behavior, document the migration impact in `CHANGELOG.md` and in the
affected reference document.

