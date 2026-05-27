# Security Guidelines

## Environment Variables

### Required Security Configuration

1. **SEP10_JWT_SECRET**: Must be at least 32 characters long and cryptographically secure
2. **ADMIN_ADDRESS**: Must be a valid Stellar public key for admin operations
3. **DATABASE_URL**: Should use SSL in production environments

### Best Practices

- Never commit `.env` files to version control
- Use different secrets for different environments
- Rotate secrets regularly
- Use environment-specific configuration management

## API Security

### Rate Limiting

The application implements rate limiting on API endpoints:
- Escrow creation: 10 requests per minute
- Escrow retrieval: 100 requests per minute  
- Shipment updates: 20 requests per minute

### Input Validation

- All inputs are validated using class-validator
- Stellar addresses are validated using the Stellar SDK
- Tracking IDs are sanitized and validated
- Amount limits are enforced

### Authentication

- SEP-10 compliant Stellar authentication
- JWT tokens with 1-hour expiration
- Replay attack protection for challenges

## Security Headers

The application automatically sets security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

## Reporting Security Issues

Please report security vulnerabilities to the maintainers privately.