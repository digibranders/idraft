# API response compression

Decided 2026-11-12. Trigger: the prompts summary with `include=series` and `include=entities` is about 1.5 MB of JSON
at full capacity (150 prompts, 3 engines).

## Decision

The API compresses its own responses with gzip, using Starlette's `GZipMiddleware` (`backend/src/idraft/api/main.py`):
minimum size 1 KiB, level 5, outermost middleware. nginx stays as it is. Brotli is not used.

## Where things stand today

| Hop | Compression before this change |
|---|---|
| Browser to Cloudflare | Yes, already. Cloudflare compresses `application/json` itself (checked on 2026-11-12: `/api/readyz` answers `content-encoding: gzip` or `br` to a client that asks, from an uncompressed origin). |
| Cloudflare to nginx to uvicorn, on the VPS | None. nginx has no `gzip` directive in `infra/vps/nginx/app.idraft.ai.conf`; the API sent plain JSON. |
| Next.js (`/` on port 3010) | Next.js compresses its own responses (its `compress` option is on by default). |

So the full 1.5 MB crosses the VPS to Cloudflare leg uncompressed on every summary call, and the browser leg is
already small. That is the gap this change closes. It also covers the case of Cloudflare compression being switched
off or bypassed (a cache rule, a plan change).

## Why the API and not nginx

1. It reaches production through the normal release. The backend ships as `backend/` source through
   `infra/ship.sh`. The nginx site is installed only by `infra/vps/provision.sh`, which is run by hand on the server;
   `ship.sh` and `activate.sh` never touch it. An nginx change would need a hand step on the server (not allowed) or a
   new activation step that edits the nginx of a host shared with OyeChats and Social Auto.
2. The CPU argument for nginx does not hold here. The installed Starlette (1.7.0, `uv.lock`) compresses bodies of
   128 KiB and more in worker threads, so a large response does not block the event loop. Measured on a synthetic
   summary-shaped payload: level 5 about 9 to 1 at roughly 10 ms per 1.5 MB, level 9 about 10 to 1 at roughly 50 ms.
   Level 5 keeps most of the saving at a fifth of the cost. Real data may compress less well; check after the first
   release.
3. It is testable in the backend suite, with the real application (`backend/tests/api/test_compression.py`).
4. It is correct wherever the API runs (the dev stack, a later Compose deployment), not only behind this nginx.

Cost of the choice: gzip only. Starlette has no brotli, and nginx brotli needs a module that the shared nginx does not
have. Cloudflare still serves brotli to browsers by itself; gzip from the origin is the cheap leg.

## Checks against the list of risks

**Double compression.** None. `GZipMiddleware` skips a response that already has a `Content-Encoding`. nginx has no
`gzip` on, and in any case skips a response that is already encoded. The Next.js dev rewrite of `/api/*` exists in
development only (production routes `/api` in nginx). Cloudflare is expected to pass origin gzip through to a client
that accepts gzip and to decompress it for one that does not; confirm after the release.

**The proxy does not strip or break `Content-Encoding`.** nginx forwards upstream headers and body as they are:
`proxy_pass` with no `gzip`, `gunzip` or `sub_filter` in the `/api/` location, so the bytes and the header reach
Cloudflare together. `proxy_http_version 1.1` is already set. To be confirmed after the release (see Verifying).

**Streaming and already compressed bodies.** The API has no streaming response and no server-sent events. The
middleware leaves `text/event-stream`, archives, images, audio and video alone, and leaves partial (206) responses
alone, so a future SSE route is safe. The raw SERP snapshot download (`/serp-snapshots/{id}/raw`) is plain JSON bytes
with `Content-Disposition: attachment`; it is compressed in transit like other JSON and the browser saves the decoded
file. Nothing is compressed twice.

**`Vary: Accept-Encoding`.** The middleware adds it to every response it considers (any body of 1 KiB or more),
compressed or not, so a shared cache keeps the two variants apart. Responses under 1 KiB are identical for every client
and carry no `Vary` from it.

**ETag and `Cache-Control`.** The API sends no `ETag` and does not handle `If-None-Match`, so there is nothing to
weaken or to mismatch. `Cache-Control` (`no-store` on the OpenAPI document and on one-time secrets, `private, no-store`
on raw answers) is not touched by the middleware, and the tests assert it survives. Tenant pages are served by Next.js,
not by this layer.

**CPU.** See point 2 above. Small responses (under 1 KiB: health checks, most mutations, errors) cost nothing. The
API runs as one uvicorn process; large bodies go to worker threads, small ones compress inline in under a millisecond.

## BREACH

BREACH needs three things together: a compressed HTTPS response that contains a secret, attacker-chosen text reflected
in the same response, and an attacker who can make the victim's browser repeat the request and read the response size.

What the API reflects or carries in bodies:

| Item | In a response body? |
|---|---|
| Session token | No. Only in `Set-Cookie` (`__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`). Headers are not compressed. |
| CSRF token | There is none. Forgery is stopped by the Origin check (`api/csrf.py`) and `SameSite=Lax`. |
| TOTP enrolment secret and recovery codes | Yes, in the body of POST responses (`Cache-Control: no-store`). Reached only by a signed-in user with a fresh session, through POST routes that refuse any `Origin` but ours, so a foreign page cannot make the browser send them. |
| Verification and reset tokens, invitation tokens | In emails and links only, not in API responses. |
| Reflected input | The request path in the `instance` member of error bodies, and the request id. Error bodies hold no secret. Validation errors never include the submitted value (`problems.py`). |

No response puts a secret next to text the attacker controls, and the routes that hold a secret cannot be driven
cross-site. The risk does not apply. Rule for the future: a route that returns a secret and reflects any request input
in the same body must either stop reflecting it or be excluded from compression (`exclude_content_types`, or a
`Content-Encoding: identity` header on that response, which the middleware respects).

## Tests

- `backend/tests/api/test_compression.py`, on the real application: a large JSON (the OpenAPI document, served to a
  signed-in user) gets `Content-Encoding: gzip` and `Vary: Accept-Encoding` when the client sends `Accept-Encoding:
  gzip`, decodes to the committed document, and shrinks at least 4 to 1; the same request with `identity` gets plain
  bytes; `Cache-Control`, `Content-Type` and `X-Request-Id` survive; a small body (`/api/healthz`) is left alone; no
  `ETag` is introduced.
- The infra check is a manual one, after release (below). There is nothing in `infra/` to lint: no server file changes.

## Verifying after a release

Every API route that returns a large body needs a session, so check from a signed-in browser: open the Network panel on
a prompts summary call with `include=series` and expect `content-encoding` (`gzip` or `br`, whichever Cloudflare serves)
and a transfer size far below the content size. Origin compression itself shows in nginx's access log only as a smaller
upstream size, so the browser check is the practical one. Nothing on the server needs a hand step.

## What a release changes

Backend only: one new middleware. No migration, no config, no server file, no web change. The web part is not
redeployed. Rollback if needed: `infra/ship.sh --rollback backend` (owner's call).
