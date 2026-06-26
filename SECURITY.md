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

### Environment Variables

| Variable | Requirement |
|----------|-------------|
| `SEP10_JWT_SECRET` | Minimum 32 characters; cryptographically random in production |
| `ADMIN_ADDRESS` | Valid Stellar public key (G...) |
| `DATABASE_URL` | TLS/SSL required in production |
| `STELLAR_WEBHOOK_SECRET` | Required in production for webhook HMAC verification |

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
