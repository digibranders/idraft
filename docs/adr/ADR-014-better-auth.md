# ADR-014: Better Auth for authentication, organizations and API keys

Status: Superseded by ADR-022 (2026-09-30)
Date: 2026-09-29

## Superseded
Replaced by [ADR-022](ADR-022-python-backend-simplified-platform.md): authentication is our own FastAPI module (argon2id passwords, opaque sessions in `auth.sessions`, TOTP required for owner and admin) with a same-origin `__Host-session` cookie; Google OIDC and API keys are deferred. Better Auth cannot run inside a Python API, and spike S-07 was dropped with it.

## Context
We need sessions, email/password, social sign-in, 2FA, organizations with roles and invitations, and API keys, self-hosted on our PostgreSQL. Lucia was deprecated in 2025.

## Decision
Better Auth inside the Fastify API with the Kysely adapter, organization, two-factor and API key plugins; organization mapped to workspace; uuid ids; cookies on the parent domain shared by app and API subdomains. Validated by spike S-07.

## Alternatives considered
Auth.js (Next.js-centric, API on a different host), Clerk/Auth0 (external dependency and cost), custom implementation (security risk).

## Consequences
Fast delivery of auth features; dependency on a young library, mitigated by keeping domain tables independent of auth internals.

## Revisit trigger
S-07 fails, or the library's maintenance or security posture changes.
