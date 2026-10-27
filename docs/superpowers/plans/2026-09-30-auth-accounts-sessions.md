# Auth: Accounts, Sessions and Two-Factor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can register, verify their email, sign in with a password and TOTP, manage their sessions and password, and read `GET /api/v1/me`; every later route can depend on `current_session`.

**Architecture:** The auth module is a package, `idraft.api.auth`, inside the FastAPI app (ADR-022). Pure pieces (password policy, token hashing, TOTP maths, the permission matrix) have no I/O and are unit-tested alone. A repository holds every SQL statement against the `auth` tables through SQLAlchemy Core table metadata; a session store adds the 60 s Redis read-through cache; a service composes them into use cases, each in one transaction that also writes the audit row. Routes are thin: parse, call the service, set or clear the cookie.

**Tech Stack:** FastAPI, SQLAlchemy 2 Core (asyncpg), Redis 8, `argon2-cffi`, `pyotp`, `cryptography` (AES-256-GCM), `httpx` (breached-password range API, email provider), pytest with Testcontainers.

**Source documents:** `docs/24-security.md` sections 2, 2.1, 3, 8, 11, 12; `docs/19-api-specification.md` sections 1.1, 1.3, 2.1, 2.7, 2.9, 2.13, 3.1; `docs/04-data-model.md` sections 4 and 13.1; `docs/26-testing-quality.md` SEC-AUTH-01 to 03 and DB-MIG-01; `docs/review-log.md` carried items F3, F4, F7.

**Out of scope (plan 3b, "Workspaces, members, projects"):** workspace, member, invitation and project routes; `require_permission` and the route permission coverage test; 2FA enforcement on workspace routes (`two_factor_enrollment_required`); the general request rate limit (600 per minute per user); `GET /api/v1/roles`; quotas and audit log routes. API keys and Google sign-in stay deferred (ADR-022).

**Shell note for this machine:** `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"` before Docker and test commands. Run the gates with `backend/check.sh -q -p no:cacheprovider` and never pipe them in a way that hides the exit code.

**Execution notes (2026-09-30), where the build differs from the text below:**

- **Re-authentication moved from Task 6 to Task 7**, because it shares its code path with the second factor. A user with two-factor on must re-authenticate with a code (not in the original plan; found in review).
- **Task 5 order.** The invitation is checked before the password policy, so in `invited` mode nothing about a password is said to a caller without a valid token. The invitation is checked again inside the insert transaction.
- **`totp_encryption_key`** is required for the api process only; the worker and the CLI do not need it. Two keys are derived from it with HKDF: one encrypts TOTP secrets, one authenticates cached sessions.
- **`build_email_sender`** takes plain values, not `Settings`, so `idraft.providers` stays free of `idraft.config` (which imports SQLAlchemy).
- **Sessions are not named in logs**, only the user.
- **Session cache.** Entries are authenticated and a revocation leaves a 120 s tombstone. Neither was in the plan; both came from review.
- **Findings, fixes and carried items:** `docs/review-log.md`, "Auth: accounts, sessions and two-factor".

**Every task ends the same way:** gates green, commit, then an independent review with the Fable model (`model: "fable"`) given the task's diff range and the spec sections above; fix what it finds before the next task.

---

## Decisions this plan makes

The specs leave these open or contradict each other. Each is written back to the docs in Task 9.

| # | Decision | Why |
|---|---|---|
| D1 | **Registration is closed by default.** Setting `REGISTRATION` is `invited` (default) or `open`. In `invited` mode `POST /auth/register` needs an `invitation_token` for a pending, unexpired invitation to that email, else `403 registration_closed`. The first account is created by the operator CLI (Task 8) | The first users are the agency and its clients. With open registration anyone could create a workspace and spend the DataForSEO budget |
| D2 | A registration that presents a valid invitation token marks the email verified at once | The token was sent to that address; holding it proves control of the mailbox |
| D3 | Session revocation sets `revoked_at`; rows are never deleted by the API | Doc 24 says "deletes the row", doc 04 has `revoked_at`, and `app_api` has no `DELETE` on `auth.sessions` (04 section 13.1). Purging old rows belongs to worker maintenance |
| D4 | Rotating a session (after TOTP, on re-authentication) inserts a new row and revokes the old one | `token_hash` and `user_id` are not writable by `app_api` |
| D5 | Breached-password check uses the Pwned Passwords range API (k-anonymity: only the first 5 hex characters of the SHA-1 leave the server), 2 s timeout, fails open with a warning log | Doc 24 allows the range API or a local list; the API needs no bundled file and stays current |
| D6 | Recovery codes are 80-bit random values stored as `sha256` hex, not argon2id | They are high-entropy random strings, like session tokens. Ten argon2 verifications per attempt would be a cheap way to exhaust the API's CPU and memory. Doc 04's column comment changes |
| D7 | Auth events are written to `ops.audit_logs` through a new `SECURITY DEFINER` function, `ops.record_auth_event` | They have no workspace, and the row-level policy rejects a `NULL` workspace written by `app_api` |
| D8 | Email goes through a port, `EmailSender`, with three senders: `console` (local and test), `resend` (Resend's HTTP API) and a recording sender for tests. Production refuses to start on `console`. Messages are sent after the response, from a background task | Doc 22 names only `EMAIL_API_KEY`. Resend is one POST and can be swapped behind the port. The worker outbox arrives with plan 4 |
| D9 | Email links carry the token in the URL fragment (`/verify-email#token=...`, `/reset-password#token=...`) | A fragment is never sent to a server, so the token stays out of Caddy and Next.js access logs. The web page reads it and posts it |
| D10 | `POST /auth/register` answers `409 duplicate` for a known email, as doc 19 says | In `invited` mode the caller already holds a token for that address, so nothing is disclosed. In `open` mode it is an accepted trade for a clearer form |
| D11 | The Origin check applies to every state-changing request under `/api`, including the public auth routes | It also stops login CSRF. Next.js server code that mutates on the user's behalf must send `Origin: <APP_ORIGIN>` |
| D12 | Sentry's Redis integration is disabled | It records commands and keys as breadcrumbs and spans. Cache keys are hashes, not tokens, but nothing about sessions belongs in a third-party service (carried item F4) |

## File structure

```
backend/
  pyproject.toml                                   add argon2-cffi, pyotp, cryptography, httpx (runtime)
  src/idraft/
    config/settings.py                             new settings (Task 1)
    config/sentry.py                               Redis integration off (Task 4)
    providers/email.py                             EmailSender port, EmailMessage, ConsoleEmailSender, ResendEmailSender
    db/tables.py                                   SQLAlchemy Core metadata for the seven auth tables
    db/migrations/versions/0005_auth_events.py     ops.record_auth_event
    api/
      permissions.py                               Permission StrEnum, Role, ROLE_PERMISSIONS
      csrf.py                                      OriginCheckMiddleware
      schemas/__init__.py, schemas/auth.py         request and response models
      auth/
        __init__.py
        passwords.py                               hash, verify, needs_rehash, policy, BreachedPasswords
        tokens.py                                  new_token, hash_token
        totp.py                                    TotpCipher, new_secret, verify_code, recovery codes
        throttle.py                                LoginThrottle (Redis)
        repository.py                              every SQL statement for auth
        sessions.py                                SessionStore (database plus Redis cache), SessionContext
        mail.py                                    the three messages (verification, reset, password changed)
        service.py                                 AuthService: the use cases
        dependencies.py                            current_session, pending_or_active_session, fresh_session, cookie helpers
        routes.py                                  /api/v1/auth/*, /api/v1/me
    cli.py                                         `python -m idraft.cli create-operator`
  tests/
    auth/test_passwords.py, test_tokens.py, test_totp.py, test_throttle.py, test_permissions.py
    providers/test_email.py
    db/test_tables.py, db/test_auth_events.py
    api/auth/conftest.py, test_csrf.py, test_sessions.py, test_register.py, test_sign_in.py,
             test_password.py, test_totp_routes.py, test_me.py, test_session_routes.py
    test_cli.py
```

Import rules stay as they are: `providers` does not import `db` or `api`; `db` does not import `api`.

## Constants

| Name | Value | Source |
|---|---|---|
| `SESSION_COOKIE` | `__Host-session` | 24 section 2.1 |
| `SESSION_IDLE` | 7 days, sliding | 24 section 2 |
| `SESSION_ABSOLUTE` | 30 days | 24 section 2 |
| `PENDING_TOTP_LIFETIME` | 10 minutes | this plan |
| `FRESH_FOR` | 10 minutes | 24 section 2 |
| `TOUCH_INTERVAL` | 60 seconds (`last_seen_at` written at most once a minute) | 04 section 4 |
| `SESSION_CACHE_TTL` | 60 seconds | 24 section 2 |
| `VERIFY_TOKEN_LIFETIME` | 24 hours | 24 section 2 |
| `RESET_TOKEN_LIFETIME` | 1 hour | 24 section 2 |
| `PASSWORD_MIN`, `PASSWORD_MAX` | 12, 128 characters | 24 section 2; upper bound limits hashing cost |
| argon2id | memory 19,456 KiB, iterations 2, parallelism 1 | 24 section 2 |
| Throttle | 5 failures per 15 minutes per account, 20 per 15 minutes per IP; lockout 15 minutes, doubling per repeat within 24 hours, capped at 24 hours | 24 section 2 |
| TOTP | 30 s step, one step of drift either way, a step can be used once | 24 section 2 |
| Recovery codes | 10 codes, 16 base32 characters shown as `XXXX-XXXX-XXXX-XXXX` | 24 section 2, D6 |

---

### Task 1: Settings and the pure pieces

**Files:** `pyproject.toml`; `config/settings.py`; `api/auth/passwords.py`, `tokens.py`, `totp.py`; `api/permissions.py`; tests `tests/auth/test_passwords.py`, `test_tokens.py`, `test_totp.py`, `test_permissions.py`, additions to `tests/config/test_settings.py`.

Settings added to `Settings` (all read from the environment, names upper-cased):

| Field | Type | Default | Rule |
|---|---|---|---|
| `registration` | `Literal["invited", "open"]` | `invited` | D1 |
| `totp_encryption_key` | `SecretStr` | required | base64 of exactly 32 bytes, else "must be 32 random bytes, base64 encoded" |
| `email_provider` | `Literal["console", "resend"]` | `console` | `console` is rejected when `app_env` is `production` |
| `email_api_key` | `SecretStr \| None` | `None` | required when `email_provider` is `resend` |
| `email_from` | `str` | `idraft.ai <no-reply@localhost>` | must contain an address |
| `breached_password_check` | `bool` | `True` | tests turn it off except where it is the subject |

Interfaces:

```python
# passwords.py
class WeakPasswordError(Exception):
    reason: Literal["too_short", "too_long", "contains_email", "breached"]

def hash_password(password: str) -> str: ...            # argon2id, parameters above
def verify_password(encoded: str, password: str) -> bool: ...   # False on mismatch or a malformed hash, never raises
def needs_rehash(encoded: str) -> bool: ...
def dummy_verify() -> None: ...                         # same cost as a real verify, for unknown emails
def check_policy(password: str, *, email: str) -> None: ...    # raises WeakPasswordError (length, contains the email local part)

class BreachedPasswords:                                # D5
    def __init__(self, client: httpx.AsyncClient) -> None: ...
    async def is_breached(self, password: str) -> bool: ...     # False on timeout or non-200, with a warning log

# tokens.py
def new_token() -> str: ...                             # 32 random bytes, base64url without padding (43 characters)
def hash_token(token: str) -> bytes: ...                # sha256 digest, 32 bytes

# totp.py
class TotpCipher:
    def __init__(self, key: bytes) -> None: ...         # AES-256-GCM
    def encrypt(self, secret: str, *, user_id: UUID) -> bytes: ...   # b"\x01" + nonce(12) + ciphertext; user id is the associated data
    def decrypt(self, blob: bytes, *, user_id: UUID) -> str: ...     # raises TotpSecretError on any failure

def new_secret() -> str: ...                            # pyotp.random_base32(), 160 bits
def provisioning_uri(secret: str, *, email: str) -> str: ...     # issuer "idraft.ai"
def matching_step(secret: str, code: str, *, at: datetime) -> int | None: ...   # the step (t-1, t, t+1) whose code matches, else None
def new_recovery_codes() -> list[str]: ...              # 10 codes
def hash_recovery_code(code: str) -> str: ...           # sha256 hex of the code with dashes and case removed

# permissions.py
class Role(StrEnum): OWNER, ADMIN, EDITOR, ANALYST, VIEWER, BILLING
class Permission(StrEnum): ...                          # the 26 keys of 19 section 2.13, values such as "workspace:delete"
ROLE_PERMISSIONS: Mapping[Role, frozenset[Permission]]  # the matrix of 24 section 3.2
TOTP_REQUIRED_ROLES = frozenset({Role.OWNER, Role.ADMIN})
```

Tests (each written first and seen to fail):

- passwords: a hash starts with `$argon2id$v=19$m=19456,t=2,p=1$`; verify accepts the right password and rejects a wrong one; a malformed hash returns `False`; `needs_rehash` is true for a hash made with weaker parameters; policy rejects 11 characters, 129 characters and a password containing the email local part (case-insensitive, local part of 4 or more characters); `BreachedPasswords` sends only the 5-character prefix (asserted on the recorded request URL and that the full hash never appears), sends `Add-Padding: true`, matches a suffix case-insensitively, ignores a padded entry with count 0, and returns `False` on a timeout and on a 503.
- tokens: 43 url-safe characters; two calls differ; the hash is 32 bytes and equals `hashlib.sha256(token.encode()).digest()`.
- totp: round trip; decrypting with another user id, a flipped byte, a short blob or an unknown version byte raises `TotpSecretError`; two encryptions of one secret differ; `matching_step` accepts the current, previous and next step and nothing else; a non-numeric or wrong-length code returns `None`; 10 recovery codes, distinct, in the display format; the hash ignores dashes and case.
- permissions: `ROLE_PERMISSIONS` equals a table typed out in the test from doc 24 section 3.2 row by row; every `Permission` appears in the test table; `fp:logs:write` and no other key is granted to no role.
- settings: each rule in the table above, and that no error message contains a rejected value.

- [ ] Write the tests, watch them fail, implement, gates green
- [ ] Commit `Add password, token, TOTP and permission primitives with their settings`
- [ ] Fable review, fixes, commit

### Task 2: Auth audit function, table metadata and the drift check

**Files:** `db/migrations/versions/0005_auth_events.py`; `db/tables.py`; tests `tests/db/test_auth_events.py`, `tests/db/test_tables.py`; `tests/db/test_grants.py` (`FUNCTIONS`); `tests/db/test_migrations.py` (head is `0005`).

```sql
-- Auth events have no workspace, and the policy on ops.audit_logs rejects a NULL workspace written by
-- app_api. This writes exactly one such row and fixes what the caller cannot choose.
CREATE FUNCTION ops.record_auth_event(
    p_action text, p_user_id uuid, p_target_type text, p_target_id text,
    p_ip inet, p_user_agent text, p_request_id text, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF p_action !~ '^auth\.[a-z_.]{1,60}$' THEN
        RAISE EXCEPTION 'auth event action must start with auth.' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO ops.audit_logs
        (workspace_id, actor_type, actor_id, action, target_type, target_id, after, ip, user_agent, request_id)
    VALUES
        (NULL, CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'user' END,
         coalesce(p_user_id::text, 'anonymous'), p_action, p_target_type, p_target_id,
         p_details, p_ip, left(p_user_agent, 512), p_request_id);
END $$;

REVOKE ALL ON FUNCTION ops.record_auth_event(text, uuid, text, text, inet, text, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ops.record_auth_event(text, uuid, text, text, inet, text, text, jsonb) TO app_api;
```

`db/tables.py` declares `metadata = MetaData()` and Core `Table` objects for `auth.users`, `auth.sessions`, `auth.verification_tokens`, `auth.totp_secrets`, `auth.workspaces`, `auth.memberships`, `auth.invitations`: columns, types, nullability, primary keys, foreign keys and unique constraints exactly as revision `0003`. Server defaults are declared with `server_default=FetchedValue()` so inserts never send them. Indexes and CHECK constraints are not declared (Alembic does not compare CHECKs, and partial-index expressions compare unreliably).

Tests:

- auth events: as `app_api`, a call writes one row with `workspace_id IS NULL`, `actor_type = 'user'`, the given action and details, and `id` and `occurred_at` set by the database; a `NULL` user writes `actor_type = 'system'`, `actor_id = 'anonymous'`; an action not starting with `auth.` raises a check violation; `app_worker` cannot call it; a user agent of 2,000 characters is stored as 512; the row is invisible to `app_api` with any workspace set (it has no workspace).
- tables (DB-MIG-01): `alembic.autogenerate.compare_metadata` against the migrated database, run as `migrator`, limited to the declared tables and ignoring indexes, returns no differences; a second test alters a copy of the metadata (one column type) and asserts the comparison reports it, so the check is known to be able to fail.
- grants: `FUNCTIONS` gains the new function with caller `app_api`; the down-and-up walk still ends with identical privileges.

- [ ] Tests first, implement, gates green
- [ ] Commit `Add the auth audit function and table metadata with a drift check`
- [ ] Fable review, fixes, commit

### Task 3: Email port and senders

**Files:** `providers/email.py`; `api/auth/mail.py`; tests `tests/providers/test_email.py`, `tests/auth/test_mail.py`.

```python
@dataclass(frozen=True, slots=True)
class EmailMessage:
    to: str
    subject: str
    text: str

class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> None: ...

class EmailSendError(Exception): ...

class ConsoleEmailSender:      # writes the message to stderr; local and test only
class ResendEmailSender:       # POST https://api.resend.com/emails, Bearer key, {"from", "to": [..], "subject", "text"}
    def __init__(self, client: httpx.AsyncClient, *, api_key: str, sender: str) -> None: ...
class RecordingEmailSender:    # keeps messages in a list; in tests/support, not in src

def build_email_sender(settings: Settings, client: httpx.AsyncClient) -> EmailSender: ...
```

`mail.py` builds three plain-text messages from `app_origin`: verification (`{origin}/verify-email#token=...`, valid 24 hours), password reset (`{origin}/reset-password#token=...`, valid 1 hour, "ignore this if you did not ask"), and password changed (no link; "if this was not you, reset your password and contact your workspace owner"). Plain text only: no HTML to sanitise, and nothing from user input except the recipient's name, which is stripped of control characters and line breaks.

Tests: the Resend request (URL, method, `Authorization` header, JSON body) against `httpx.MockTransport`; a 4xx or 5xx raises `EmailSendError` whose message has the status and not the API key or the body; a timeout raises `EmailSendError`; the console sender writes recipient, subject and text to stderr; `build_email_sender` picks by setting; each message contains its link with the token in the fragment and nothing after `#token=` but the token; a name containing `\r\nBcc: x` cannot add a line to the subject.

- [ ] Tests first, implement, gates green
- [ ] Commit `Add the email port with console and Resend senders`
- [ ] Fable review, fixes, commit

### Task 4: Sessions, the cookie, the Origin check

**Files:** `api/auth/repository.py` (session and user statements), `api/auth/sessions.py`, `api/auth/dependencies.py`, `api/csrf.py`, `api/resources.py`, `api/main.py`, `api/problems.py`, `api/access_log.py`, `config/sentry.py`; tests `tests/api/auth/conftest.py`, `test_sessions.py`, `test_csrf.py`, additions to `tests/config/test_sentry.py` and `tests/api/test_problems.py`.

```python
@dataclass(frozen=True, slots=True)
class SessionContext:
    session_id: UUID
    user_id: UUID
    state: Literal["pending_totp", "active"]
    fresh_until: datetime | None
    idle_expires_at: datetime
    absolute_expires_at: datetime
    last_seen_at: datetime
    def is_fresh(self, now: datetime) -> bool: ...

class SessionStore:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], redis: Redis) -> None: ...
    async def create(self, db: AsyncSession, *, user_id, state, fresh: bool, ip, user_agent, now) -> tuple[str, SessionContext]
    async def load(self, token: str, *, now: datetime) -> SessionContext | None
    async def revoke(self, db: AsyncSession, *, session_id: UUID, user_id: UUID, now) -> bool
    async def revoke_all(self, db: AsyncSession, *, user_id: UUID, except_session_id: UUID | None, now) -> int
    async def forget(self, token_hashes: Sequence[bytes]) -> None      # delete cache keys; called after commit
```

`load`: hash the token; read `session:<hex hash>` from Redis; on a miss read the row joined to `auth.users` (not revoked, user not disabled) and cache it for 60 s. Then, from the cached or fresh value: reject if `now >= idle_expires_at` or `now >= absolute_expires_at`; if `now - last_seen_at >= 60 s`, write `last_seen_at = now` and `idle_expires_at = least(now + 7 days, absolute_expires_at)` and refresh the cache. A Redis error on read falls back to the database; the session check never fails open and never fails because the cache is down. Cache keys are deleted only after the revoking transaction has committed.

Dependencies:

| Dependency | Accepts | Rejects with |
|---|---|---|
| `current_session` | an `active` session | `401 unauthenticated` (no cookie, unknown, revoked), `401 session_expired` (known but past a lifetime) |
| `pending_or_active_session` | `pending_totp` or `active` | the same |
| `fresh_session` | `active` and `is_fresh(now)` | `403 fresh_session_required` with `reauth_url: "/api/v1/me/reauthenticate"` |

Each binds `user_id` and `session_id` into the structlog context and onto `request.state`. The catch-all 500 handler and the access log line read `request.state.user_id` (carried item F3), and the access log gains `user_id`.

Cookie helpers: `set_session_cookie(response, token, max_age)` writes `__Host-session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=...` with no `Domain`; `clear_session_cookie` writes the same attributes with `Max-Age=0`.

`OriginCheckMiddleware` (pure ASGI, added so it runs after the request id is bound): for `POST`, `PUT`, `PATCH`, `DELETE` on a path under `/api/`, the `Origin` header must equal `settings.app_origin` exactly, else `403 origin_not_allowed` as a problem response. `OPTIONS` to `/api/` answers `403` (no CORS). `GET` and `HEAD` pass.

Sentry: `disabled_integrations=[RedisIntegration()]` (D12).

New problem classes: `SessionExpiredError` (401 `session_expired`), `FreshSessionRequiredError`, `OriginNotAllowedError`.

Tests (through a test-only router mounted in the fixture app with one route per dependency):

- no cookie, a malformed cookie, an unknown token, a revoked session and a session of a disabled user: `401 unauthenticated`; past idle or absolute expiry: `401 session_expired`.
- an active session passes; a `pending_totp` session is refused by `current_session` and accepted by `pending_or_active_session`.
- the database stores `sha256(token)` and the token itself appears nowhere in `auth.sessions` or in any Redis key or value (scan of all keys).
- second request within 60 s does not touch the database row (row `last_seen_at` unchanged); after `last_seen_at` is moved back 61 s, the next request advances both `last_seen_at` and `idle_expires_at`, and `idle_expires_at` never passes `absolute_expires_at`.
- revoking deletes the cache key, so the very next request is `401` with no 60 s grace; `revoke_all` with `except_session_id` leaves that one working.
- with Redis stopped (a client pointed at the `black_hole` fixture), a valid session still authenticates from the database.
- `fresh_session`: passes inside the window, `403 fresh_session_required` with `reauth_url` outside it.
- the 500 log line and the access log line carry `user_id` for an authenticated request and no `user_id` key for an anonymous one.
- Origin: state-changing request with the right `Origin` passes; missing, `null`, another origin, the right host on another scheme or port, and a suffix match (`https://app.example.com.evil.test`) are `403 origin_not_allowed`; `GET` without `Origin` passes; `OPTIONS` is `403`; the health routes are unaffected.
- cookie: attributes exactly as above, asserted on the raw `Set-Cookie` header.
- Sentry: after `init_sentry`, a Redis `GET` of a `session:` key records no breadcrumb and no span.

- [ ] Tests first, implement, gates green
- [ ] Commit `Add sessions with a Redis read-through cache, the session cookie and the Origin check`
- [ ] Fable review, fixes, commit

### Task 5: Register, verify, sign in, sign out, and `/me`

**Files:** `api/schemas/auth.py`; `api/auth/throttle.py`, `repository.py`, `service.py`, `routes.py`; `api/main.py`; tests `tests/auth/test_throttle.py`, `tests/api/auth/test_register.py`, `test_sign_in.py`, `test_me.py`.

Routes (doc 19 section 3.1): `POST /api/v1/auth/register`, `/auth/verify-email/request`, `/auth/verify-email`, `/auth/sign-in`, `/auth/sign-out`, `GET /api/v1/me`.

Rules beyond the catalog:

- Emails are trimmed and compared through `citext`; the stored value keeps the case the user typed. Names are 1 to 120 characters after trimming, with no control characters.
- Register: policy check, then the breached check, then (in `invited` mode) the invitation lookup through `auth.invitation_by_token`: the token must exist, be `pending`, be unexpired and be for this email, else `403 registration_closed` (one answer for all four, so a token cannot be probed). Insert the user; on a unique violation answer `409 duplicate`. With a valid invitation set `email_verified_at` (D2); otherwise create a verification token and send the email. `201 { user_id, email_verified }`. Audit `auth.register`.
- Verification request: `202` always. For a known, unverified, enabled user: consume older unconsumed tokens of that purpose, create one, send it. At most 3 sends per address per hour (Redis counter), silently.
- Verify: look up by `sha256(token)`; must be the right purpose, unconsumed and unexpired. Consuming is one `UPDATE ... WHERE consumed_at IS NULL RETURNING`, so two concurrent uses cannot both succeed. `400 invalid_token` otherwise, one answer for every reason. Audit `auth.email_verified`.
- Sign-in, in this order: (1) if the account or the IP is locked, `429 rate_limited` with `Retry-After`, without looking at the password; (2) load the user; if there is none or it is disabled, `dummy_verify()` and count a failure; (3) verify the password; (4) on failure count it for the account and the IP, audit `auth.sign_in_failed` (details carry the reason, never the password), and when the fifth failure in the window locks the account audit `auth.lockout`; answer `401 invalid_credentials` in every failure case; (5) on success clear the account counter, rehash if `needs_rehash`, create the session: `active` and fresh when the user has no confirmed TOTP, else `pending_totp` with a 10 minute lifetime; set the cookie; audit `auth.sign_in`. Body `{ "status": "signed_in" | "totp_required" }`.
- If Redis cannot be reached, sign-in answers `503 service_unavailable` (auth fails closed, doc 19 section 2.9).
- **Audit rows of a failure must survive the failure.** An audit row written in a transaction that then rolls back is lost. Every failure path (wrong password, lockout, wrong code) commits its audit row first and raises afterwards; it never raises inside the transaction that wrote the row. A test reads the row from a second connection after the 401.
- Sign-out: accepts a pending or active session, revokes it, clears the cookie, `204`. With no valid session it still clears the cookie and answers `204`.
- `GET /me`: the `Me` shape of doc 19 (`auth_method` is always `session`; no `api_key` member). Memberships are read in a `user_transaction`, which row-level security limits to the caller's own rows, each with the permissions of its role from `ROLE_PERMISSIONS`. `two_factor_enabled` is true only for a confirmed secret.

`LoginThrottle` (Redis, keys under `throttle:`; the account key is `sha256` of the lower-cased email so no address is stored in Redis):

```python
class LoginThrottle:
    async def check(self, *, email: str, ip: str) -> int | None       # seconds to wait, or None
    async def failure(self, *, email: str, ip: str) -> bool           # True when this failure started a lockout
    async def success(self, *, email: str) -> None
```

Counting and locking are one Lua script per call, so concurrent failures cannot skip the limit.

Tests:

- throttle unit: the fifth failure locks for 900 s; a second lockout inside 24 hours lasts 1,800 s; the cap is 86,400 s; the IP limit trips at 20 across different accounts; success clears the account counter and not the IP counter; 50 concurrent failures produce exactly one lockout start; a Redis error propagates.
- register: `invited` mode without a token, with an unknown token, an expired one, a cancelled one and one for another address are all `403 registration_closed` and create no user; with a valid token the user exists, is verified, and no email is sent; `open` mode creates an unverified user and sends one verification email whose token works once; weak passwords give `422 weak_password` with `reason`; a breached password (mocked range API) is refused; a duplicate email is `409 duplicate` in any letter case; the stored password is an argon2id hash and the stored token is `sha256` of the emailed one (SEC-AUTH-02); the response and the logs contain neither the password nor the token.
- verification: request is `202` for unknown, verified and disabled addresses and sends nothing; a used, expired, wrong-purpose or made-up token is `400 invalid_token` with identical bodies; two concurrent posts of one token give one `200` and one `400`; the fourth request in an hour sends nothing.
- sign-in: success sets the cookie and a following `GET /me` works; wrong password, unknown email and disabled user give the same `401 invalid_credentials` body; the unknown-email path performs an argon2 verification (asserted by patching `dummy_verify` and counting); six failures in a row: the sixth is `429` with `Retry-After`, the right password is also refused while locked, and `ops.audit_logs` has `auth.sign_in_failed` rows and one `auth.lockout` (SEC-AUTH-01); a hash made with old parameters is replaced on success; a user with confirmed TOTP gets `totp_required` and that session is refused by `GET /me`; with Redis down the answer is 503; every state-changing auth route refuses a request without `Origin`.
- sign-out: the cookie is cleared, the session is revoked in the database and gone from Redis, a replay of the old cookie is `401`; sign-out without a cookie is `204`.
- `/me`: shape, `email_verified`, `two_factor_enabled`, `fresh_until`; memberships of two workspaces with their roles and permissions, and none of another user's.

- [ ] Tests first, implement, gates green
- [ ] Commit `Add registration, email verification, sign-in with throttling, sign-out and /me`
- [ ] Fable review, fixes, commit

### Task 6: Passwords, re-authentication, profile and the session list

**Files:** `api/auth/service.py`, `routes.py`, `repository.py`, `schemas/auth.py`; tests `tests/api/auth/test_password.py`, `test_session_routes.py`, additions to `test_me.py`.

Routes: `POST /auth/password-reset/request`, `/auth/password-reset/confirm`, `/auth/password/change` (fresh), `GET /auth/sessions`, `DELETE /auth/sessions/{session_id}`, `POST /auth/sessions/revoke-others`, `PATCH /me`, `POST /me/reauthenticate`.

- Reset request: `202` always; same sending rules and hourly cap as verification. Reset confirm: token rules as verification; policy and breached checks; set the new hash; consume the token; revoke every session of the user; audit `auth.password.reset`; send the "password changed" message. It does not sign the user in. A successful reset also marks the email verified (the token proves the mailbox).
- Change: verifies `current_password` (failures count toward the account throttle and answer `401 invalid_credentials`); the new password must differ; revoke every other session; audit `auth.password.changed`; send the message.
- Re-authenticate: `{ password }` or `{ totp_code }`, exactly one (else `422`). A password is always accepted; a TOTP code needs a confirmed secret and follows the replay rule of Task 7. Failures count toward the throttle. On success the session is rotated (D4): new token, new row with `fresh_until = now + 10 min` and the old row's `absolute_expires_at` (rotation never extends the absolute lifetime), old row revoked, new cookie. Body `{ fresh_until }`.
- Sessions: the list shows the caller's unrevoked, unexpired sessions with `is_current`. Deleting a session that is not the caller's is `404 not_found`. Deleting the current one also clears the cookie. Each revocation is audited `auth.session.revoked`.
- `PATCH /me`: `name` and `image` (an `https://` URL of at most 2,048 characters, or `null`).

Tests: reset request is `202` for unknown addresses and sends nothing; a reset token works once, expires after an hour, and a verification token cannot be used as a reset token; after a reset every old session is `401` and the old password fails; weak and breached new passwords are refused and leave the old password working; change requires a fresh session (`403 fresh_session_required` otherwise), refuses a wrong current password, keeps the current session and kills the others, including their Redis keys (SEC-AUTH-03); re-authenticate with the right password returns a new cookie, the old cookie is `401`, the new session is fresh and its absolute expiry equals the old one; both or neither of `password` and `totp_code` is `422`; the session list contains only the caller's sessions; deleting another user's session id is `404` and leaves it working; revoke-others leaves one; `PATCH /me` rejects an `http://` image and a 121-character name.

- [ ] Tests first, implement, gates green
- [ ] Commit `Add password reset and change, re-authentication, profile update and session management`
- [ ] Fable review, fixes, commit

### Task 7: Two-factor

**Files:** `api/auth/service.py`, `routes.py`, `repository.py`, `schemas/auth.py`; tests `tests/api/auth/test_totp_routes.py`.

Routes: `POST /auth/totp/setup` (fresh), `/auth/totp/setup/confirm`, `/auth/totp/verify` (pending or active), `/auth/totp/recovery-codes` (fresh), `/auth/totp/disable` (fresh).

- Setup: `409 totp_already_enabled` when a confirmed secret exists. Otherwise a new secret replaces any unconfirmed one; stored encrypted (Task 1); body `{ otpauth_uri, secret }`.
- Confirm: the code must match the unconfirmed secret; set `confirmed_at` and `last_used_step`; generate 10 recovery codes, store their hashes, return the codes once; revoke the user's other sessions; audit `auth.totp.enabled`. `401 invalid_code` otherwise; `409` when there is nothing to confirm.
- Verify: with `{ code }`, find the matching step and claim it with `UPDATE auth.totp_secrets SET last_used_step = :step WHERE user_id = :u AND (last_used_step IS NULL OR last_used_step < :step)`; zero rows means the code was already used, which is `401 invalid_code`. With `{ recovery_code }`, remove its hash with `array_remove` in one `UPDATE ... WHERE :hash = ANY(recovery_code_hashes)`; zero rows is `401`. Failures count toward the account throttle; a locked account answers `429`. On success a `pending_totp` session is rotated into an `active`, fresh one; an `active` session is rotated and made fresh. Audit `auth.totp.verified` with the method (`code` or `recovery_code`), and how many recovery codes remain.
- Recovery codes: replaces all ten. Disable: refused with `403 two_factor_required_for_role` when the caller is `owner` or `admin` of any workspace (memberships read in a `user_transaction`); otherwise deletes the secret, revokes other sessions, audits `auth.totp.disabled`.

Tests: the full path (setup, confirm, sign out, sign in gives `totp_required`, verify, `/me` works and is fresh); the code of the previous and the next step is accepted and the one two steps back is not; a code cannot be used twice, including two concurrent posts (one `200`, one `401`) (SEC-AUTH-03); a recovery code works once and the count drops to nine; a pending session can call only `totp/verify` and sign-out; a pending session expires after 10 minutes; five wrong codes lock the account; setup on an enabled account is `409`; a second setup before confirming invalidates the first secret; confirm revokes other sessions; disable is refused for an owner and an admin and allowed for a viewer; regenerated recovery codes invalidate the old ones; the secret in the database is not the plain secret and decrypts only with the user's id; no code, secret or recovery code appears in the logs.

- [ ] Tests first, implement, gates green
- [ ] Commit `Add TOTP enrolment, verification, recovery codes and disable`
- [ ] Fable review, fixes, commit

### Task 8: Operator CLI, the OpenAPI route and the development stack

**Files:** `src/idraft/cli.py`; `api/routes` for `GET /api/v1/openapi.json`; `backend/openapi/v1.json`; `infra/compose/docker-compose.dev.yml`; `backend/.env.example`; `backend/smoke.sh`; `backend/README.md`; tests `tests/test_cli.py`, `tests/api/test_openapi.py`.

- `python -m idraft.cli create-operator --email E --name N`: connects with `DATABASE_URL` as `migrator` (it refuses to run as any other role, by checking `current_user`), reads the password from a prompt without echo, or from stdin when not a terminal, applies the policy, inserts the user with `is_platform_operator = true` and `email_verified_at = now()`, and records `auth.operator_created` in the audit log. A second run for the same email changes nothing and exits 1 with a clear message.
- `GET /api/v1/openapi.json` needs an active session; the committed document is regenerated and the existing test keeps it equal to the generated one. Every auth route documents its error responses as `application/problem+json`.
- The development stack and the smoke test pass `TOTP_ENCRYPTION_KEY`; `.env.example` shows how to generate one (`python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"`); the README gains "Signing in locally" (create an operator, where the console sender prints emails).

Tests: the CLI creates an operator who can then sign in through the API; it refuses a weak password, a duplicate email and a non-migrator connection, each with exit code 1 and a message naming the reason and no secret; `openapi.json` is `401` without a session and equals `app.openapi()` with one.

- [ ] Tests first, implement, gates green, smoke test passes
- [ ] Commit `Add the operator CLI, serve the OpenAPI document behind a session, update the dev stack`
- [ ] Fable review, fixes, commit

### Task 9: Write the decisions back into the docs

- [ ] Doc 24 section 2: D1 to D6, D8, D9, D11; "revocation sets `revoked_at` and deletes the cache key"; the throttle as built. Section 11: what auth logs never contain. Section 12: the auth audit actions.
- [ ] Doc 19 section 3.1: `registration_closed`, `invitation_token` on register, `503` when Redis is down, the re-authentication rules, the sign-out behaviour without a session. Section 2.1: the Origin rule for server-side callers.
- [ ] Doc 04 section 4 (`recovery_code_hashes` comment), section 13 (the third definer function) and 13.1 (function row).
- [ ] Doc 22: `TOTP_ENCRYPTION_KEY`, `REGISTRATION`, `EMAIL_PROVIDER`, `EMAIL_FROM` in the api environment; Doc 26: SEC-AUTH rows name the tests.
- [ ] Review log: decisions, F3 and F4 closed, F7 restated, what plan 3b must do (2FA enforcement on workspace routes, workspace creation limited to operators while registration is `invited`, invitation emails).
- [ ] Note for the web session: fragment tokens (D9), `Origin` on server-side mutations (D11), the `totp_required` state, `reauth_url`.
- [ ] Commit `Record the auth decisions in the docs`
- [ ] Final Fable review of the whole branch, fixes, commit

---

## Self-review

| Requirement | Task |
|---|---|
| argon2id with the OWASP parameters, rehash on login, minimum 12, breached check (24 section 2) | 1, 5 |
| Opaque 256-bit session id, stored as sha256, Redis cache 60 s, revocation clears the cache (24 section 2) | 4 |
| Cookie `__Host-session`, `HttpOnly; Secure; SameSite=Lax; Path=/` (24 section 2.1) | 4 |
| Origin check, no CORS (24 section 2.1, 19 section 2.1 rules 7 and 8) | 4 |
| Email verification 24 h, reset 1 h, single use, hashed, no enumeration (24 section 2) | 5, 6 |
| Reset revokes every session; password change and TOTP change revoke the others (24 section 2) | 6, 7 |
| TOTP: 30 s, one step of drift, no replay, encrypted secret, 10 hashed backup codes (24 section 2) | 1, 7 |
| Login throttling: 5 per account, 20 per IP, exponential lockout (24 section 2, SEC-AUTH-01) | 5 |
| 7 days sliding, 30 days absolute, fresh within 10 minutes (24 section 2) | 4, 6 |
| The 16 auth routes and 3 `/me` routes of doc 19 section 3.1 | 5, 6, 7 |
| Audit of every sign-in, failed sign-in, TOTP change and session revocation, in the same transaction (19 section 3.1) | 2, 5, 6, 7 |
| Permission enum and role matrix (19 section 2.13, 24 section 3.2) | 1 |
| SQLAlchemy metadata checked against the schema (26 DB-MIG-01) | 2 |
| Carried F3 (ids on the 500 log line) and F4 (Sentry and Redis) | 4 |
| OpenAPI behind a session (19 section 1.1) | 8 |
| A way to create the first account | 8 |

Not covered here, by design: invitations as a route (the register path reads them, plan 3b writes them), `two_factor_enrollment_required`, the general rate limit, `GET /roles`.
