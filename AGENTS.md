# Repository Guide

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, development commands, coding standards, and contribution workflow.

## Useful Commands

- `npm run build` — compile the NestJS application.
- `npm run lint:check` — check lint rules without applying fixes.
- `npm test -- --runInBand` — run unit tests.
- `npm run test:integration` — run integration tests (requires PostgreSQL; see CONTRIBUTING.md).
- `npm run test:e2e` — run end-to-end tests.

Unit tests live beside source files as `*.spec.ts`; integration and end-to-end tests live under `test/`.
