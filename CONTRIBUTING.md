# Contributing to TrustLink — Backend API

Thank you for contributing to the TrustLink backend! This service is the automation layer that bridges the physical world and the blockchain — watching for on-chain events, tracking shipments, triggering fund releases, and keeping buyers and vendors informed in real time.

Your contributions keep the oracle running cleanly and securely.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Stellar Wave Program](#stellar-wave-program)
- [Before You Start](#before-you-start)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Coding Standards](#coding-standards)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Database Migrations](#database-migrations)
- [Security Vulnerabilities](#security-vulnerabilities)
- [Getting Help](#getting-help)

---

## Code of Conduct

This is a welcoming project. Be constructive, be patient with newcomers, and assume good intent. We're building financial infrastructure for social commerce in underserved markets — the stakes are real and the community reflects that seriousness.

Harassment, dismissiveness, or toxic behaviour will not be tolerated.

---

## 🌊 Stellar Wave Program

This repository participates in the **[Stellar Wave Program](https://www.drips.network/wave/stellar)** — a sprint-based contribution program funded by the Stellar Development Foundation where developers earn real XLM rewards for resolving open issues.

### How It Works

1. Browse [`Stellar Wave`](../../issues?q=label%3A%22Stellar+Wave%22) and [`good first issue`](../../issues?q=label%3A%22good+first+issue%22) issues
2. Sign in at [drips.network/wave](https://www.drips.network/wave) with GitHub
3. Apply to the issue with a brief note on your approach
4. Get assigned → build → open a PR before the Wave cycle closes
5. Merged PR = Points = XLM rewards

### Point Values

| Label | Points | Scope |
|---|---|---|
| `complexity: trivial` | 100 pts | Swagger docs, missing validation, small bug |
| `complexity: medium` | 150 pts | New endpoint, new service method, integration test |
| `complexity: high` | 200 pts | New module, background worker, external API integration |

> ⚡ Apply before the Wave sprint is fully subscribed. Maintainers move quickly during active cycles.

---

## 📜 Specification Requirements Document

Before contributing, read **[SPECIFICATION.md](SPECIFICATION.md)** — it is the authoritative specification for this project. Every code change must conform to its requirements. PRs that violate the specification **will be rejected**.

Key requirements from the SRD:
- **No `any` types** — strict TypeScript required
- **Tests required** for all new code — coverage must not drop below 70%
- **Security first** — JWT signature verification, input sanitization, PII encryption
- **CI must pass** — lint, typecheck, test, build, audit all required
- **Conventional commits** — `type(scope): description`
- **Repository pattern** — services never call Prisma directly

---

## Before You Start

### Finding Work

- **New to NestJS or Node.js?** → Start with [`good first issue`](../../issues?q=label%3A%22good+first+issue%22). These have full context and don't require deep Stellar knowledge.
- **Backend-experienced?** → Look for [`complexity: medium`](../../issues?q=label%3A%22complexity%3A+medium%22) or [`complexity: high`](../../issues?q=label%3A%22complexity%3A+high%22) issues.
- **Have an idea?** → Open a [GitHub Discussion](../../discussions) before writing code. An upfront conversation prevents your PR from being closed due to design misalignment.

### Before Building

- Scan the issue thread for maintainer comments — the scope may have changed since it was filed.
- Check for an existing open PR on the issue — don't duplicate effort.
- For anything that touches the Stellar transaction signing flow, the auto-release worker, or the dispute resolution logic — leave a comment describing your proposed approach and wait for a maintainer thumbs-up before starting.

---

## Development Setup

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `20+` | Use [nvm](https://github.com/nvm-sh/nvm) |
| npm / pnpm | latest | |
| PostgreSQL | `15+` | Local install or Docker |
| Docker | optional | For spinning up Postgres quickly |

### First-Time Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/trustlink-backend
cd trustlink-backend

# 2. Add upstream
git remote add upstream https://github.com/your-org/trustlink-backend

# 3. Install dependencies
npm install

# 4. Set up environment
cp .env.example .env
# Edit .env — testnet values are pre-filled, you need your own DB URL

# 5. Start Postgres (Docker shortcut)
docker run --name trustlink-pg \
  -e POSTGRES_USER=trustlink \
  -e POSTGRES_PASSWORD=trustlink \
  -e POSTGRES_DB=trustlink_dev \
  -p 5432:5432 -d postgres:15

# 6. Run migrations
npx prisma migrate dev

# 7. Seed the database (optional — creates test escrow records)
npx prisma db seed

# 8. Start the dev server
npm run start:dev
```

The API will be available at `http://localhost:3001`.
Swagger docs: `http://localhost:3001/api/docs`

### Staying in Sync

```bash
git fetch upstream
git rebase upstream/main
```

---

## Project Structure

```
trustlink-backend/
├── src/
│   ├── app.module.ts                   # Root NestJS module — registers all modules
│   │
│   ├── escrow/                         # Escrow module
│   │   ├── escrow.module.ts
│   │   ├── escrow.controller.ts        # HTTP routes
│   │   ├── escrow.service.ts           # Business logic
│   │   ├── escrow.repository.ts        # DB queries (Prisma)
│   │   └── dto/
│   │       ├── create-escrow.dto.ts
│   │       └── update-shipment.dto.ts
│   │
│   ├── dispute/                        # Dispute module
│   │   ├── dispute.module.ts
│   │   ├── dispute.controller.ts
│   │   ├── dispute.service.ts
│   │   └── dto/
│   │
│   ├── auth/                           # SEP-10 authentication
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts          # /auth/challenge + /auth/verify
│   │   ├── auth.service.ts
│   │   └── guards/
│   │       ├── jwt.guard.ts
│   │       └── admin.guard.ts
│   │
│   ├── stellar/                        # Stellar SDK layer
│   │   ├── stellar.module.ts
│   │   ├── blockchain-listener.service.ts  # SSE stream from Horizon
│   │   ├── contract.service.ts             # Soroban contract interactions
│   │   └── horizon.service.ts              # Horizon API utilities
│   │
│   ├── notifications/                  # Email + SMS
│   │   ├── notifications.module.ts
│   │   ├── notifications.service.ts
│   │   └── templates/                  # Email/SMS message templates
│   │
│   ├── logistics/                      # Shipping carrier integrations
│   │   ├── logistics.module.ts
│   │   ├── logistics.service.ts        # Carrier-agnostic interface
│   │   └── providers/
│   │       ├── terminal-africa.provider.ts
│   │       └── gigl.provider.ts
│   │
│   ├── workers/                        # Background jobs
│   │   ├── auto-release.worker.ts      # Cron: checks 48h delivery window
│   │   └── tracking-poll.worker.ts     # Cron: polls carrier APIs
│   │
│   └── admin/                          # Admin-only module
│       ├── admin.module.ts
│       ├── admin.controller.ts
│       └── admin.service.ts
│
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
│
└── test/
    ├── unit/
    ├── integration/
    └── e2e/
```

**Key rules:**
- Business logic lives in `*.service.ts` — controllers handle HTTP only (parse input, call service, return response)
- Database access belongs in `*.repository.ts` — services should not call `prisma` directly
- Stellar SDK calls belong in `src/stellar/` — no `stellar-sdk` imports elsewhere
- All background jobs go in `src/workers/` — no `setInterval` or ad-hoc cron calls in services

---

## Making Changes

### Branching

```bash
git checkout main
git pull upstream main
git checkout -b feat/your-feature-name
```

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/description` | `feat/gigl-logistics-provider` |
| Bug fix | `fix/description` | `fix/auto-release-duplicate-sign` |
| Tests | `test/description` | `test/dispute-service-integration` |
| Docs | `docs/description` | `docs/add-swagger-to-dispute-dto` |
| Refactor | `refactor/description` | `refactor/extract-escrow-repository` |
| Chore | `chore/description` | `chore/upgrade-prisma-5.x` |

---

## Coding Standards

### General

- TypeScript strict mode is enabled — `any` types will be flagged in review
- Run `npm run lint` before committing — ESLint with NestJS rules must pass clean
- Run `npm run format` to apply Prettier — don't submit unformatted code
- Prefer `async/await` over raw `.then()` chains
- All thrown errors should be NestJS `HttpException` subclasses — never `throw new Error()` in a controller or service

### NestJS Conventions

```typescript
// ✅ Controller: thin — parse, delegate, return
@Post()
async createEscrow(
  @Body() dto: CreateEscrowDto,
  @CurrentUser() vendor: AuthUser,
): Promise<EscrowResponseDto> {
  return this.escrowService.createEscrow(dto, vendor.address);
}

// ✅ Service: logic lives here
async createEscrow(dto: CreateEscrowDto, vendorAddress: string): Promise<Escrow> {
  const existing = await this.escrowRepository.findByVendorAndItem(vendorAddress, dto.itemRef);
  if (existing) throw new ConflictException("Duplicate escrow for this item reference");
  // ... create and return
}

// ❌ Wrong — business logic leaking into controller
@Post()
async createEscrow(@Body() dto: CreateEscrowDto) {
  const existing = await this.prisma.escrow.findFirst({ where: { ... } }); // DB in controller
  if (existing) throw new ConflictException(...);
}
```

### DTOs and Validation

Every request body must have a DTO decorated with `class-validator` and `@ApiProperty` (Swagger):

```typescript
// dto/create-escrow.dto.ts
import { IsString, IsNumber, IsPositive, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateEscrowDto {
  @ApiProperty({ example: "Vintage Nike Jacket – Size M", description: "Item name shown to buyer" })
  @IsString()
  @MinLength(3)
  itemName: string;

  @ApiProperty({ example: 50, description: "Amount in USDC" })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 604800, description: "Shipping window in seconds (default: 7 days)" })
  @IsNumber()
  @IsPositive()
  shippingWindow: number;
}
```

### Stellar / Blockchain Code

- All Soroban contract interactions go through `ContractService` in `src/stellar/`
- Transaction submission must use retry logic — Stellar can temporarily reject due to sequence number contention
- The system signer key (`SYSTEM_SIGNER_SECRET`) must **never** be logged, even partially
- Always verify the transaction was included in a ledger after submission — don't trust a successful `submit` response alone
- Parse Soroban contract events by `topic` + `data` XDR, not by position

### Environment and Secrets

- Never commit `.env` files
- Never hardcode keys, secrets, or contract IDs in source files — always use `process.env` via the `ConfigService`
- The `.env.example` file must be kept up to date — if you add a new env var, add it there with a placeholder and a comment

---

## Commit Convention

This repo uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short imperative description>

[optional body]

[optional footer: Closes #123]
```

**Types:**

| Type | Use for |
|---|---|
| `feat` | New endpoint, service, module, or worker |
| `fix` | Bug fix |
| `test` | New or updated tests |
| `docs` | Swagger annotations, README, comments |
| `refactor` | Code restructuring with no behaviour change |
| `perf` | Performance improvement |
| `chore` | Dependencies, CI config, tooling changes |
| `security` | Vulnerability fix or hardening |

**Examples:**

```bash
git commit -m "feat(logistics): add Terminal Africa webhook handler"
git commit -m "fix(auto-release): prevent duplicate transaction submission on retry"
git commit -m "test(dispute): add integration test for admin resolve endpoint"
git commit -m "docs(escrow): add Swagger @ApiProperty to CreateEscrowDto"
git commit -m "security(auth): add replay protection to SEP-10 challenge verification"
```

---

## Pull Request Process

### Before Opening a PR

```bash
# Format
npm run format

# Lint — must be clean
npm run lint

# Type check
npm run type-check

# Tests
npm run test

# Build (catches compilation errors)
npm run build
```

### PR Checklist

- [ ] **What changed** — Plain description of the change
- [ ] **Why** — Link to the issue
- [ ] **Tests written** — Unit and/or integration tests for new code
- [ ] **Swagger updated** — All new/changed endpoints have `@ApiOperation`, `@ApiResponse`, and DTO `@ApiProperty` decorators
- [ ] **No secrets** — No API keys, contract IDs, or env values hardcoded
- [ ] **Migration included** — If schema changed, the Prisma migration file is committed
- [ ] `Closes #123`

### PR Template

```markdown
## Summary
<!-- What does this PR do? -->

## Motivation
<!-- Why is this change needed? Link to the issue. -->

## Changes
<!-- Bullet-point key changes -->
- 
- 

## Testing
<!-- What tests were added? How was this manually tested? -->

## Migration
<!-- If database schema changed, describe it here -->

## Notes for Reviewer
<!-- Anything reviewers should focus on? -->

Closes #
```

### Review Turnaround

- Active Wave cycle: **48 hours**
- Outside Wave: **5 business days**
- 1 approving review required
- Changes to Stellar transaction signing, auto-release logic, or dispute resolution require **2 approvals**

---

## Testing

```bash
# Unit tests
npm run test

# Watch mode (during development)
npm run test:watch

# Integration tests (requires a real DB — uses a separate test DB)
npm run test:integration

# E2E tests (requires full stack)
npm run test:e2e

# Coverage report
npm run test:cov
```

### Test Layers

**Unit tests** (`test/unit/`) — Test a single service or function in isolation. Mock all dependencies (Prisma, Stellar SDK, external APIs) using Jest mocks.

```typescript
// test/unit/escrow.service.spec.ts
describe("EscrowService", () => {
  let service: EscrowService;
  let mockRepo: jest.Mocked<EscrowRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: EscrowRepository, useValue: mockEscrowRepository() },
        { provide: ContractService, useValue: mockContractService() },
      ],
    }).compile();

    service = module.get(EscrowService);
    mockRepo = module.get(EscrowRepository);
  });

  it("throws ConflictException for duplicate escrow", async () => {
    mockRepo.findByVendorAndItem.mockResolvedValue(existingEscrow);
    await expect(service.createEscrow(dto, vendorAddress)).rejects.toThrow(ConflictException);
  });
});
```

**Integration tests** (`test/integration/`) — Test a full module with a real test database (in-memory or Docker). Use `@nestjs/testing` with a real Prisma client pointing to a test DB.

**E2E tests** (`test/e2e/`) — Test full HTTP request-response cycles using `supertest`. The full NestJS app is bootstrapped against a test DB.

### Coverage Expectations

New code must include tests. PRs that drop overall coverage by more than 2% will be asked to add tests before merging.

---

## Database Scripts

| Script | Command | Description |
|---|---|---|
| Apply pending migrations | `npm run db:migrate` | Runs `prisma migrate deploy` — applies all pending migrations; safe for CI and production |
| Create a new migration | `npx prisma migrate dev --name <name>` | Generates and applies a migration for local development |
| Reset local database | `npm run db:reset` | Drops, recreates, re-migrates, and re-seeds the local database (development only — requires confirmation) |
| Populate test data | `npm run db:seed` | Runs `scripts/db-seed.ts` to insert 3 vendor profiles, 10 escrows, 2 disputes, and 10 notifications idempotently |
| Open Prisma Studio | `npm run db:studio` | Launches the visual database browser |
| Regenerate Prisma client | `npm run db:generate` | Required after editing `prisma/schema.prisma` |

### Typical local development flow

```bash
# First-time setup
npm run db:migrate    # apply all migrations
npm run db:seed       # populate with test data

# After pulling schema changes
npm run db:generate   # regenerate client
npm run db:migrate    # apply new migrations

# Start fresh (drops all data)
npm run db:reset      # reset + seed in one step
```

## Database Migrations

If your change requires a schema update:

```bash
# 1. Edit prisma/schema.prisma

# 2. Generate and apply the migration
npx prisma migrate dev --name describe-your-change

# 3. Regenerate the Prisma client
npx prisma generate

# 4. Commit BOTH the migration files AND schema.prisma
```

**Migration rules:**
- Never edit existing migration files — create a new one
- Migration names must be descriptive: `add-dispute-resolution-timestamp`, not `update1`
- Destructive migrations (dropping columns or tables) must include a comment explaining data handling
- If you're adding a non-nullable column, it must either have a `@default` value or include a migration that backfills existing rows

## CI Caching Strategy

The CI pipeline uses two levels of caching to reduce run times:

| Cache | Key | What it stores |
|---|---|---|
| npm cache | `setup-node cache: 'npm'` | Downloaded npm packages (`~/.npm`) |
| TypeScript build cache | `ts-build-<os>-<hash of tsconfig + src>` | Compiled output in `dist/` and `tsconfig.build.tsbuildinfo` |

The TS build cache is invalidated whenever `tsconfig.build.json` or any `src/**/*.ts` file changes. On cache hit, `nest build` skips unchanged files and only recompiles what changed.

`npm ci` is used instead of `npm install` in all CI steps for faster, deterministic installs from the lockfile.

---

## Security Vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.**

This especially applies to:
- The system signer key handling
- The auto-release transaction submission flow
- SEP-10 authentication and JWT verification
- The admin dispute resolution endpoint

Report privately to:

📧 **security@trustlink.xyz** (or the address in [SECURITY.md](SECURITY.md))

Include:
- Description of the vulnerability
- Steps to reproduce or a proof-of-concept
- Your severity assessment

We aim to acknowledge within 48 hours and patch critical issues within 7 days.

---

## Getting Help

- 💬 **GitHub Discussions** → [Ask a question](../../discussions/categories/q-a)
- 🐛 **GitHub Issues** → Confirmed bugs only — include steps to reproduce and error logs
- 🌊 **Stellar Developers Discord** → [discord.gg/stellardev](https://discord.gg/stellardev) for real-time help

Helpful resources:
- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Docs](https://www.prisma.io/docs)
- [Stellar Horizon API Reference](https://developers.stellar.org/api/horizon)
- [Soroban RPC Reference](https://developers.stellar.org/docs/data/rpc)
- [Stellar SEP-10 Specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
- [Terminal Africa API Docs](https://docs.terminal.africa)

---

> The backend is the quiet engine that makes the promise of trustless commerce actually work. Thank you for helping keep it reliable.
