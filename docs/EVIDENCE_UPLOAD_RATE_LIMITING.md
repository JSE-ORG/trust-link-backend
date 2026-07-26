# Evidence Upload Rate Limiting

## Overview

Added rate limiting to the `POST /escrow/evidence-upload` endpoint to prevent abuse and protect the storage system from unlimited pre-signed URL generation.

## Changes Made

### 1. Configuration (`src/config/config.service.ts`)

Added new environment variables to the Config interface:
- `EVIDENCE_UPLOAD_LIMIT`: Maximum requests per user per window (default: 10)
- `EVIDENCE_UPLOAD_TTL`: Time window in milliseconds (default: 60000 = 1 minute)

### 2. Throttler Module Configuration (`src/app.module.ts`)

Added a new named throttler configuration for evidence uploads:
```typescript
{
  name: 'evidence-upload',
  ttl: config.get<number>('EVIDENCE_UPLOAD_TTL') || 60000,
  limit: config.get<number>('EVIDENCE_UPLOAD_LIMIT') || 10,
}
```

### 3. Controller Update (`src/escrow/escrow.controller.ts`)

Updated the evidence-upload endpoint to use the dedicated rate limiter:
```typescript
@Post('evidence-upload')
@HttpCode(HttpStatus.CREATED)
@UseGuards(JwtGuard)
@Throttle('evidence-upload')
evidenceUpload(
  @Query('fileName') fileName: string,
  @CurrentUser() user: AuthUser,
) {
  return this.escrowService.generateEvidenceUploadUrl(user.address, fileName);
}
```

**Previous configuration:** `@Throttle({ public: { limit: 30, ttl: 60000 } })`
**New configuration:** `@Throttle('evidence-upload')` with 10 requests per minute

### 4. Integration Tests (`src/escrow/escrow.evidence-upload.spec.ts`)

Created comprehensive integration tests covering:
- Requests within rate limit are allowed
- 429 response when limit is exceeded
- Retry-After header presence and validation
- Rate limit reset after TTL expiration
- Per-user rate limiting (independent limits)
- Legitimate upload patterns are not affected
- Environment variable configuration

## Acceptance Criteria

✅ **Add rate limit of 10 requests per minute per user**
- Default limit: 10 requests per 60-second window
- Configurable via `EVIDENCE_UPLOAD_LIMIT` environment variable
- Per-user rate limiting using JWT authentication

✅ **Return 429 with Retry-After header when limit exceeded**
- @nestjs/throttler automatically returns HTTP 429 (Too Many Requests)
- Includes `Retry-After` header indicating when to retry
- Response body contains rate limit information

✅ **Configure limit via env var**
- `EVIDENCE_UPLOAD_LIMIT`: Controls request limit (default: 10)
- `EVIDENCE_UPLOAD_TTL`: Controls time window in milliseconds (default: 60000)
- Falls back to defaults if not set

✅ **Add integration test for rate limit enforcement**
- Created comprehensive test suite in `escrow.evidence-upload.spec.ts`
- Tests rate limit enforcement, header validation, TTL reset, and per-user limits

✅ **Verify legitimate uploads are not affected**
- Test case simulates normal usage patterns
- Requests spread over时间 are allowed
- Only abusive rapid requests are blocked

## Environment Variables

```bash
# Rate limiting for evidence upload endpoint
EVIDENCE_UPLOAD_LIMIT=10          # Max requests per window (default: 10)
EVIDENCE_UPLOAD_TTL=60000         # Time window in milliseconds (default: 60000 = 1 minute)
```

## API Behavior

### Success Response (Within Limit)

```http
POST /escrow/evidence-upload?fileName=evidence.pdf
Authorization: Bearer <jwt-token>

HTTP/1.1 201 Created
Content-Type: application/json

{
  "uploadUrl": "https://storage.trustlink.io/...",
  "publicUrl": "https://storage.trustlink.io/...",
  "expiresAt": "2024-01-15T12:30:00Z",
  "expiresInSeconds": 3600,
  "fileName": "evidence.pdf",
  "storagePath": "evidence/0x123.../"
}
```

### Rate Limited Response (Limit Exceeded)

```http
POST /escrow/evidence-upload?fileName=evidence.pdf
Authorization: Bearer <jwt-token>

HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 45

{
  "message": "Too Many Requests",
  "statusCode": 429,
  "error": "Too Many Requests"
}
```

## Security Benefits

1. **Prevents Storage Abuse**: Limits the number of pre-signed URLs that can be generated
2. **Protects Resources**: Prevents overwhelming the S3 storage system
3. **Mitigates DoS**: Reduces impact of denial-of-service attacks
4. **Per-User Limits**: Each user has independent rate limits
5. **Configurable**: Limits can be adjusted based on operational needs

## Testing

Run the integration tests:
```bash
npm test -- escrow.evidence-upload.spec.ts
```

## Migration Notes

### Breaking Changes

None. The change is backward compatible:
- Existing API behavior unchanged for legitimate users
- Only abusive rapid requests are blocked
- Default limits are reasonable for normal usage

### Deployment

1. Set environment variables (optional, defaults provided):
   ```bash
   export EVIDENCE_UPLOAD_LIMIT=10
   export EVIDENCE_UPLOAD_TTL=60000
   ```

2. Deploy the updated application

3. Monitor logs for rate limit violations:
   - High rate of 429 responses may indicate abuse or need for limit adjustment

## Monitoring

Recommended metrics to monitor:
- Rate of 429 responses per user
- Overall rate of 429 responses
- Time to rate limit exhaustion for typical users
- User complaints about upload failures

## Troubleshooting

### Users Experiencing Rate Limits

If legitimate users are hitting rate limits:
1. Increase `EVIDENCE_UPLOAD_LIMIT` if usage patterns justify it
2. Decrease `EVIDENCE_UPLOAD_TTL` for faster reset
3. Investigate if users are making unnecessary repeated requests

### High Rate Limit Violations

If seeing many 429 responses:
1. Check for automated abuse or bot activity
2. Review logs for patterns indicating attacks
3. Consider implementing additional security measures

## Future Improvements

- Add rate limit bypass for trusted users
- Implement graduated rate limits based on user tier
- Add rate limit status in API responses
- Implement rate limit analytics dashboard
