# Security and scaling model

## Security layers

The v6 API includes:

- Helmet security headers
- CORS origin allowlisting
- `x-powered-by` disabled
- gzip/Brotli-friendly compression middleware
- JSON request-body size limit
- configurable API rate limiting
- stricter login rate limiting
- bcrypt password hashing
- JWT issuer + token-version validation
- backend role/house authorization
- house-scoped database queries for tenant isolation
- unique indexes for idempotent schedules, notifications and message jobs
- request IDs via `X-Request-Id`
- audit logs for important security-sensitive actions
- device-token ownership checks
- session revocation that invalidates existing tokens

No web application can honestly promise that nobody can ever hack it. These controls are designed to reduce common attack paths; production operations still require secret management, dependency updates, secure MongoDB access rules, backups, monitoring and incident response.

## Scaling

The included Render blueprint keeps the API at two web instances. Render load-balances incoming traffic across scaled instances. MongoDB Atlas is the shared source of truth, so the API servers do not keep authoritative house state in local files or memory.

The included `ops/load-test.mjs` smoke-tests 1,000 requests with configurable concurrency. It measures a deployment; it is not a guarantee of sustained capacity for 1,000 users. Real capacity depends on request mix, CPU/RAM, MongoDB query cost, network latency and external-service usage.

The default API limiter is intentionally set to 1,200 requests per minute per IP, while authentication is limited to 15 attempts per 15 minutes per IP. The current limiter is per application instance. For very large deployments, use a shared rate-limit store at the edge/Redis layer so limits are global across all instances.
