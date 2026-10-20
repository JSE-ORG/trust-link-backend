Backend Repository: `trustlink-backend`
* **Role in Architecture:** The Automated Oracle (The "Automator")
* **Key Language & Tech:** Node.js (ES Modules), Express, Prisma ORM, PostgreSQL, @stellar/stellar-sdk

### Deep Technical Overview
The backend is an event-driven system that acts as the secure off-chain bridge. It constantly polls the Stellar Horizon API for specific contract events and monitors physical shipping progress to enforce programmatic escrow terms without human intervention.

### Core Services & APIs
* **Horizon Event Listener:** Uses `@stellar/stellar-sdk` to watch the ledger for transaction hashes matches to TrustLink contracts. Instantly updates the database state upon a verified `EscrowFunded` event.
* **Logistics Webhook Receiver:** Integrates directly with shipping API payloads (Terminal Africa, DHL, or GIGL). It parses tracker Webhooks to transition internal transaction models to `Shipped` and `Delivered`.
* **Auto-Release Cron Workers:** A highly reliable scheduling queue that measures local package delivery timestamps against the on-chain ledger timestamp. If the 48-hour dispute window expires, it safely signs and fires the transaction to trigger the Soroban contract release.
* **Merchant API:** Secure endpoints that allow the frontend web app to generate metadata and validate signature payloads.