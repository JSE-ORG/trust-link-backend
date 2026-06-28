# Production Deployment and Security Enhancements

This PR implements comprehensive production deployment improvements and security enhancements for the Trust-Link backend, addressing container orchestration, health checks, Dockerfile security, and credential encryption.

## Changes

### #222 - Add Docker Compose profile for production deployment

- Added production profile (`--profile production`) to `docker-compose.yml`
- Configured `restart: always` for all production services
- Added resource limits (CPU and memory) for each service:
  - `app-prod`: 1 CPU, 1GB memory (reserve: 0.5 CPU, 512MB)
  - `db-prod`: 1 CPU, 1GB memory (reserve: 0.5 CPU, 512MB)
  - `redis-prod`: 0.5 CPU, 512MB memory (reserve: 0.25 CPU, 256MB)
- Configured JSON-file logging driver with rotation (10MB max, 3 files)
- Removed development-specific volume mounts from production profile
- Updated `DEPLOYMENT.md` with comprehensive Docker Compose production deployment instructions

### #221 - Add container health check with proper dependency ordering

- Added healthcheck to PostgreSQL service using `pg_isready`
- Added healthcheck to Redis service using `redis-cli ping`
- Added healthcheck to app service using `/health` endpoint
- Configured service dependency to wait for healthy state (`condition: service_healthy`)
- Applied health checks to both development and production profiles
- Prevents crash-loops by ensuring app starts only after DB and Redis are healthy

### #220 - Fix Dockerfile multi-stage build for production

- Verified multi-stage build produces minimal production image
- Confirmed `npm ci` is used instead of `npm install` for deterministic builds
- Confirmed `devDependencies` are not included in final image (`--omit=dev`)
- Verified app runs as non-root user (`nestjs` UID 1001)
- Added `dumb-init` for proper signal handling in containers
- Increased health check timeout from 3s to 10s for production reliability
- Added proper user group assignment for non-root user

### #219 - Implement API key encryption at rest for logistics credentials

- Created `credential-encryption.util.ts` with AES-256-GCM encryption utilities
- Implemented `encryptCredential()` for encrypting logistics API keys before storage
- Implemented `decryptCredential()` for decrypting keys at runtime for API calls
- Implemented `reencryptCredential()` for key rotation operations
- Updated `LogisticsService` to encrypt API keys in memory
- Updated `ApiKeysController` to handle encrypted credentials during rotation
- Added comprehensive unit tests in `credential-encryption.util.spec.ts`:
  - Encryption/decryption round-trip tests
  - Decryption failure handling tests
  - Key rotation tests
  - Edge case tests (empty strings, special characters, tampered data)
- Updated `DEPLOYMENT.md` to document `CREDENTIAL_ENCRYPTION_KEY` requirement

## Testing

- Unit tests for credential encryption cover all scenarios including failure cases
- Health checks can be verified with `docker-compose ps` to show service health status
- Production profile can be tested with `docker-compose --profile production up -d`

## Breaking Changes

- **New environment variable required**: `CREDENTIAL_ENCRYPTION_KEY` (64-character hex string) must be set for production deployments
- Logistics API keys are now encrypted at rest - existing keys will need to be re-encrypted via the rotation endpoint

## Documentation

- Updated `DEPLOYMENT.md` with Docker Compose production deployment guide
- Added instructions for generating `CREDENTIAL_ENCRYPTION_KEY`
- Documented resource limits and health check configurations

Closes #222, #221, #220, #219
