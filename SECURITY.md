# Security Policy

Trust-Link Backend handles escrow funds, Stellar wallet authentication, and sensitive vendor data. This document defines our security standards and the process for reporting vulnerabilities.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
| < 1.0   | No        |

Security fixes are released as patch versions (e.g. `1.0.1`) following [Semantic Versioning](https://semver.org/).

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately using one of these channels:

| Channel | Contact |
|---------|---------|
| Email (preferred) | security@trust-link.io |
| GitHub (private) | Use [GitHub Security Advisories](https://github.com/truestlink/trust-link-backend/security/advisories/new) on this repository |

Include as much detail as possible:

1. Description of the vulnerability and potential impact
2. Steps to reproduce (proof-of-concept if available)
3. Affected endpoints, versions, or components
4. Your contact information for follow-up

### Response Timeline

| Stage | Target |
|-------|--------|
| Initial acknowledgement | Within **48 hours** |
| Severity assessment | Within **5 business days** |
| Fix or mitigation plan | Within **15 business days** for High/Critical |
| Coordinated disclosure | After a patch is available |

We follow coordinated disclosure: please allow reasonable time for a fix before public disclosure. We will credit reporters who wish to be acknowledged (unless you prefer anonymity).

### Safe Harbor

Good-faith security research conducted in accordance with this policy will not be pursued legally. Do not:

- Access data belonging to other users
- Perform denial-of-service attacks
- Modify or destroy production data
- Use social engineering against Trust-Link staff or users

## Scope

In scope:

- Trust-Link Backend API (`/escrow`, `/vendor`, `/auth/sep10`, `/webhooks`, `/admin`)
- Authentication and authorization flaws (SEP-10 JWT, admin guards)
- Injection, IDOR, and business-logic vulnerabilities in escrow flows
- Secrets exposure, misconfiguration, or insecure defaults in this repository

Out of scope:

- Third-party services (Stellar Horizon, SendGrid, Twilio) — report to those vendors directly
- Social engineering, physical security, or client-side-only issues in frontend apps
- Issues in dependencies with no available fix (we track and patch promptly when fixes exist)

## Security Controls

### Buyer Contact Encryption (PII at rest)

`buyerContactEmail` and `buyerContactPhone` are classified as Personal Identifiable Information (PII) and **must never be written to the database in plaintext**.

#### Encryption scheme

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key size | 256 bits (32 bytes) |
| IV size | 96 bits (12 bytes), randomly generated per call |
| Auth tag | 128 bits (16 bytes) |
| Storage format | `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>` (colon-separated hex) |
| Key source | `CONTACT_ENCRYPTION_KEY` env variable (64 hex chars = 32 bytes) |

Encrypting the same plaintext twice produces different ciphertext — each call generates a fresh IV, preventing correlation attacks.

#### Code path

```
EscrowController → EscrowService.updateBuyerContact()
  → encryptContact()           [contact-encryption.util.ts]
  → EscrowRepository.saveBuyerContact()
  → PrismaService.escrow.update()  [validates ciphertext format before write]
```

#### Defence-in-depth guard

`PrismaService.escrow.create` and `escrow.update` both call `assertEncryptedContact()` before any write. If either field is provided without matching the expected `iv:tag:ciphertext` hex format, an exception is thrown and the write is aborted. This makes plaintext storage impossible by construction even if a new code path bypasses `encryptContact()`.

#### Key rotation

1. Generate a new 32-byte key: `openssl rand -hex 32`
2. Re-encrypt all non-null `buyerContactEmail`/`buyerContactPhone` rows using the new key.
3. Update `CONTACT_ENCRYPTION_KEY` in the secret store and restart the service.
4. Verify no plaintext remains by checking that all stored values match the `iv:tag:ciphertext` format.

#### Regulatory context

This control supports compliance with NDPR (Nigeria Data Protection Regulation), GDPR (Article 32 — appropriate technical measures), and similar frameworks requiring encryption of personal data at rest.

### Environment Variables

| Variable | Requirement |
|----------|-------------|
| `SEP10_JWT_SECRET` | Minimum 32 characters; cryptographically random in production |
| `ADMIN_ADDRESS` | Valid Stellar public key (G...) |
| `DATABASE_URL` | TLS/SSL required in production |
| `STELLAR_WEBHOOK_SECRET` | Required in production for webhook HMAC verification |
| `CONTACT_ENCRYPTION_KEY` | Exactly 64 hex characters (32 bytes); rotate annually or on suspected compromise |
| `AUTO_RELEASE_SOURCE_ADDRESS` | Stellar public key of the auto-release signing account |

Never commit `.env` files. Use environment-specific secret management (Vault, AWS Secrets Manager, etc.).

### API Security

- All API access (except public webhooks and SEP-10 challenge generation) requires a valid JWT.
- JWTs are short-lived (1 hour) and signed using HMAC (HS256) with a secret rotation policy.
- **Refresh Token Rotation**: Refresh tokens are issued alongside access tokens. Upon refresh, the old token is revoked and a new pair is issued. Reuse of a revoked refresh token immediately invalidates the entire token family to prevent hijacking.
- **Replay Attack Prevention**: SEP-10 challenge transactions generate a cryptographically secure nonce stored in the database. Challenges are strictly single-use and expire within 15 minutes. Replay attempts with a previously used challenge transaction are rejected.
- **Rate Limiting (Throttler)**: Public endpoints are protected against abuse and DDoS attacks. The SEP-10 challenge endpoint is limited to 10 requests per minute per IP. The Escrow query endpoints are limited to 60 requests per minute per IP.
- **Input validation** via `class-validator` and Stellar SDK address checks
- **Security headers** via middleware: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`

### Operational Security

- Structured JSON logging for audit trails (see `src/common/logger/`)
- Distributed tracing for incident investigation (see `docs/TRACING.md`)
- Docker images run as non-root user (`nestjs`, UID 1001)
- Health checks at `GET /health` for orchestrator readiness

## Security Updates

Subscribe to repository releases and review `CHANGELOG.md` for security-related entries under the **Security** category.

For urgent advisories, affected parties will be notified via GitHub Security Advisories and the contact email above.
