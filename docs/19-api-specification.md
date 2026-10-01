# 19. API Specification

Status: Draft for architecture freeze (Phase 0)
Owner: Backend
Last updated: 2026-09-30
Depends on: [03-system-architecture.md](03-system-architecture.md), [04-data-model.md](04-data-model.md), [16-metrics-methodology.md](16-metrics-methodology.md), [17-statistical-methodology.md](17-statistical-methodology.md), [21-scheduler-workers.md](21-scheduler-workers.md), [24-security.md](24-security.md), [29-phase-roadmap.md](29-phase-roadmap.md)

This document is the HTTP contract between the API process (FastAPI, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)) and its clients: the Next.js app today, and API-key integrations once API keys ship. There are no provider callbacks; DataForSEO readiness is polling only. Table, column and enum names come from doc 04 and the domain documents. Where this document needs a column or table those documents do not define, it says so in section 8 instead of inventing silently.

## 1. Overview

### 1.1 Base URL and surfaces

| Surface | URL | Notes |
|---|---|---|
| Versioned API | `https://<domain>/api/v1` | All tenant, analytics and auth routes |
| Auth | `https://<domain>/api/v1/auth/*` | Our own auth module inside the FastAPI app, section 3.1 |
| Provider callbacks | none | Readiness is polling only; there is no pingback endpoint (section 3.12) |
| Health | `https://<domain>/api/healthz`, `/api/readyz` | Unversioned, public, section 3.12 |
| Metrics | none | No `/metrics` endpoint; nothing is exported to Prometheus (ADR-022). Performance data goes to Sentry |
| OpenAPI document | `https://<domain>/api/v1/openapi.json` | Requires an authenticated session. The same document is committed to the repository (section 1.3) |

The web app and the API share **one origin** ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). Caddy routes `/api/*` to the `api` container and everything else to `web`, so the browser calls the API same-origin: no CORS, one cookie, no separate API hostname and no staging API. Server components in `apps/web` call the API over the Docker network at the internal service URL (doc 20 section 3.5); the paths are the same.

Every tenant route lives under `/api/v1/workspaces/{workspace_id}`. Project routes live under `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. The catalog abbreviates these as `{W}` and `{P}`.

### 1.2 Versioning policy

1. **Major version in the URL.** `v1` is the only version. A breaking change ships as `/v2` for the affected routes; `v1` and `v2` run side by side in the same process.
2. **Additive changes do not bump the version.** Within `v1` we may add endpoints, optional request fields, response fields, query parameters, and values to **open enums**. Clients must ignore unknown response fields.
3. **Open and closed enums.** Enums backed by registry tables are open: `engine_code` (`ai.engines`), `feature_type` (`seo.serp_feature_types`), `provider_code` (`ops.providers`), domain `category` (`core.domain_categories`), `metric` keys, `event_type`, `rule_type`, `source` values on candidates. Clients must render unknown values generically. Enums backed by `CHECK` constraints in doc 04 are closed; adding a value to one is a breaking change unless the OpenAPI document already marks it open.
4. **Breaking changes** include: removing or renaming a field, changing a type or unit, changing a default that alters results (for example the default aggregation of a metric), tightening validation, and changing a metric formula without a new `method_version`.
5. **Deprecation.** A deprecated route or field keeps working and every response that touches it carries `Deprecation: @<unix-seconds>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594) and `Link: <https://docs.<domain>/api/deprecations#<id>>; rel="deprecation"`. The sunset date is at least **6 months** after the first response carrying `Deprecation`. Deprecated fields are marked `deprecated: true` in OpenAPI. Requests to deprecated routes are counted per API key so owners can be notified before sunset.
6. **Metric methodology changes are not API versions.** A formula change increments `method_version` in the metric response (doc 16 section 14) and appears as a version boundary; the route and response shape stay the same.

### 1.3 OpenAPI generation

- Every route is a FastAPI path operation whose path, query, header and body parameters and per-status responses (`response_model` and `responses=`) are Pydantic v2 models in `backend/src/sightline/api/schemas/`. FastAPI generates OpenAPI 3.1 from the same models it validates with, so the document cannot drift from validation ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)).
- Each route also declares its permission (doc 24 section 3.2) through the `require_permission(...)` dependency and its phase through `openapi_extra`; both are emitted as vendor extensions `x-permission` and `x-phase`, which the route permission coverage test and section 7 use.
- CI exports the document with `app.openapi()` to `backend/openapi/v1.json` (a committed artifact), fails if the committed file differs from the generated one, and runs `oasdiff breaking` against the last release tag. A breaking diff on `v1` fails the build.
- The TypeScript client in `apps/web` is generated from that committed document (section 1.4) in the same CI job and is also committed. A change to a Pydantic model that the web app does not follow fails CI at client generation or type checking.
- `/api/v1/auth/*` routes are ordinary FastAPI routes in the same document under the tag `auth`.

### 1.4 Client SDKs

| Client | Mechanism |
|---|---|
| Next.js app (`apps/web`) | `openapi-typescript` generates `apps/web/src/lib/api/schema.d.ts` from `backend/openapi/v1.json`; `openapi-fetch` (`createClient<paths>()`) is the only HTTP client, wrapped for TanStack Query (doc 20 section 3.5). Types only: responses are not re-validated at runtime, because the server validates every response against its model. TanStack Query keys are derived from the path template plus normalized params. |
| External SDKs | Deferred with API keys ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). When keys ship, any OpenAPI 3.1 generator works from the published document; we publish only the document |

The Pydantic models are the single source of truth. A route handler cannot return a shape its response model rejects: FastAPI validates and serializes every response through `response_model`, and a mismatch is a `ResponseValidationError` (500) that fails tests.

## 2. Conventions

### 2.1 Authentication

| Method | How | Used by |
|---|---|---|
| Session cookie | `__Host-session` cookie set by our auth module (`HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain` attribute because web and API share one origin). The value is an opaque session id; the session lives in `auth.sessions` with a 60 s Redis read-through cache. Doc 24 section 2.1 | Next.js app (browser and server components, which forward the cookie) |
| API key | **Planned, deferred** ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)): `Authorization: Bearer sk_live_<prefix8>_<secret32>`. The `auth.api_keys` table exists; no route accepts keys in V1 | Integrations, scripts, log agent (when shipped) |

Session authentication is a FastAPI dependency (`current_session`) that reads the cookie, loads the session through the Redis cache, and rejects revoked or expired sessions with `401`. In V1 an `Authorization` header is ignored.

Rules 1 to 4 describe the planned API key behavior and apply only once API keys ship:

1. If an `Authorization` header is present, the request is authenticated by API key only and cookies are ignored. A malformed or unknown key is `401 invalid_api_key`; an expired key is `401 api_key_expired`; a request from an IP outside the key's allowlist is `403 ip_not_allowed`.
2. An API key belongs to exactly one workspace. Requests with a key for workspace A to `/api/v1/workspaces/B/...` return `404 not_found` (section 2.2).
3. An API key carries a scope list that is a subset of the permission keys in section 2.13, fixed at creation and never wider than the creating user's role at that time. A route whose permission is not in the key's scopes returns `403 api_key_scope_insufficient`.
4. API keys cannot call: `/api/v1/auth/*`, `/api/v1/me` mutations, API key management, member and role management, integration connect and disconnect, workspace deletion. These routes return `403 session_required`.
5. **Re-authentication for sensitive actions.** Routes marked **fresh** in the catalog require a session authenticated within the last 10 minutes (by password, or by TOTP code when the user has two-factor on: the password alone cannot make such a session fresh) (doc 24 section 2). Otherwise they return `403 fresh_session_required` with `reauth_url` in the problem body. Fresh routes are marked in the catalog. They include: create and delete an API key (when API keys ship), change a member's role or project scope, remove a member, connect, reauthorize or disconnect an integration, rotate a webhook secret, delete a project, delete or restore a workspace.
6. **2FA enforcement.** A user whose role in the path workspace is `owner` or `admin` and who has not enabled TOTP receives `403 two_factor_enrollment_required` on every route of that workspace except `GET {W}` and `GET /api/v1/me`. This rule is deferred to launch hardening ([29-phase-roadmap.md](29-phase-roadmap.md) section 1.1): until it is built no route returns this error, and TOTP is an opt-in for every role.
7. **CSRF.** `SameSite=Lax` plus an Origin check: for every `POST`, `PUT`, `PATCH`, `DELETE` under `/api/`, with or without a cookie, the `Origin` header must equal the app's own origin (`https://<domain>`) exactly. Otherwise `403 origin_not_allowed`. This includes sign-in and the other public auth routes, and it includes server-side calls from `web`, which must set the header themselves. There is no staging or preview origin. API-key requests (when shipped) carry no cookies and will skip the Origin check.
8. **CORS.** Not used. Web and API share one origin, so the API sends no `Access-Control-*` headers and answers cross-origin preflights with `403`. All response headers (`ETag`, `Location`, `Retry-After`, `RateLimit-*`, `X-Request-Id`, `Deprecation`, `Sunset`) are readable by the app without an expose list.

### 2.2 Tenancy in the path

- Tenant routes: `/api/v1/workspaces/{workspace_id}/...`; project routes: `/api/v1/workspaces/{workspace_id}/projects/{project_id}/...`.
- The permission dependency (`require_permission`) resolves the caller's membership for `workspace_id`, then checks project scope (`auth.memberships.project_ids`, doc 24 section 3.1) for `project_id`, then the route permission.
- **404, not 403, for anything the caller cannot see.** A workspace the caller is not a member of, a project outside the caller's project scope, and any resource id (project, tracked keyword, prompt, observation, run, export, alert) that belongs to another workspace or project all return `404 not_found` with an identical body. A 403 is returned only when the caller can see the resource but lacks the permission for the action (`403 forbidden`), so a 403 never confirms the existence of another tenant's data.
- **Order of checks**, each answering before the next is looked at: session (`401`), membership (`404`), project scope (`404`), a suspended workspace on a write (`403 workspace_suspended`), permission (`403 forbidden`), fresh session (`403 fresh_session_required`), then the body (`422`). A well-formed request for another workspace is therefore `404` whatever its body holds. Two answers come earlier and depend on nothing about the workspace: a body that is not JSON (`400`) and, for a signed-in caller, a query parameter the route does not have (`422`, section 2.4). A `403` says nothing about the resource: a member without the permission gets it for a project that exists, one that does not and one of another workspace alike.
- The membership is read from the database on every request and never cached, so a removed member, a disabled user and a changed role take effect on the next request. The workspace is taken from the path only. A project is checked against the member's scope when its path parameter is named `project_id`, which tests enforce for every route (path parameters come from a known set, with or without a converter); a route that takes a project id in its query or body checks the scope itself.
- **Workspace status.** A `deleting` workspace is `404` for its members on every workspace route, and is left out of `GET /api/v1/workspaces`; `GET /api/v1/me` still lists the membership with `status: 'deleting'`, so the web app can say what happened. A `suspended` workspace can be read and not changed: every `POST`, `PUT`, `PATCH` and `DELETE` in it is `403 workspace_suspended`, whatever the caller's role. No route sets either status yet.
- Child ids are always resolved together with their parent path. `GET {P}/prompts/{prompt_id}` with a prompt from a different project of the same workspace is also `404`.
- Global dictionaries (`core.domains`, `core.urls`, `core.locations`, `ai.engines`, `seo.serp_feature_types`) are never listed without a tenant join, except the small registries under section 3.2.5.

### 2.3 Identifiers

| Kind | JSON type | Examples |
|---|---|---|
| Tenant entities (uuid v7) | string, lowercase hyphenated uuid | `workspace_id`, `project_id`, `tracked_keyword_id`, `prompt_id`, `run_id`, `alert_rule_id` |
| Observations and other `bigint` ids | **string** of decimal digits | `serp_snapshot_id`, `observation_id` (`ai.observations.id`), `url_id`, `raw_payload_id`, `alert_event_id`, `audit_log_id`, `task_id`, `derivation_log_id` |
| Small integer ids | number | `domain_id`, `location_id`, `derivation_id`, `rule_set_version` |
| Registry codes | string | `engine_code`, `feature_type`, `provider_code`, `category` |

Partitioned observation tables have composite primary keys `(id, observed_at)`. The API addresses them by `id` alone. Responses always include `observed_at`, and detail links carry it as a hint (`?observed_at=2026-09-22T03:14:07Z`) so the server can prune partitions. Without the hint the lookup probes each monthly partition's primary key index, which is correct but slower.

Composite keys without a surrogate id are addressed by their natural key in the path, URL-encoded: entity candidates by `normalized_name`, project engines by `engine_code`. Entity domains have their own id, since one entity may claim several path prefixes on a host.

### 2.4 Pagination, sorting, filtering

**Cursor pagination (default for all lists that can grow).**

| Parameter | Type | Default | Rule |
|---|---|---|---|
| `limit` | integer | 50 | 1 to 200 |
| `cursor` | string | none | Opaque value from `page.next_cursor` |

```json
{
  "data": [ { "tracked_keyword_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11" } ],
  "page": { "limit": 50, "next_cursor": "eyJrIjpbMTIsIjAxOTI...", "has_more": true },
  "meta": { "data_version": 18412 }
}
```

- Keyset pagination on a stable sort key plus the row id as tie-breaker, for example `(current_rank, tracked_keyword_id)` or `(observed_at DESC, id DESC)`. No `OFFSET` on large tables.
- The cursor is base64url JSON containing the last row's sort values, the sort spec, and a hash of the normalized filters. Reusing a cursor with different filters or sort returns `400 invalid_cursor`. Cursors do not expire, but rows inserted before the cursor position after the first page are not returned (normal keyset semantics).
- Totals are not computed by default. `include=total` adds `page.total` (exact, capped at 100,000; above that `page.total_is_lower_bound: true`). Endpoints that compute aggregates anyway (for example the tracked keyword list, which always knows its count from the state table) return `page.total` without the flag.
- Sorts on computed metrics (Prompt Explorer by mention rate) use the computed value plus id as the keyset; the cursor also pins `data_version`, and a changed `data_version` returns `409 cursor_stale` so the client restarts from page one instead of silently skipping rows.

**Offset pagination (small admin lists only).** Projects, members, invitations, API keys, budgets, schedules, alert rules, webhook endpoints, vocabularies, panels, connections, integrations, domain category overrides, price book: `offset` (default 0) and `limit` (default 50, max 200), response `page: { offset, limit, total }`.

**Sorting.** `sort` is a comma-separated list of allowed fields; a leading `-` means descending: `sort=-search_volume,keyword`. Each list endpoint documents its allowed fields in OpenAPI (`x-sort-fields`). Unknown fields return `422 validation_failed`. The row id is always appended as the final tie-breaker.

**Filtering.** `filter[<field>]=<value>` with operator suffixes:

| Suffix | Meaning | Example |
|---|---|---|
| none | equals | `filter[device]=mobile` |
| `_in` | any of, comma-separated | `filter[intent_in]=commercial,transactional` |
| `_ne` | not equal | `filter[status_ne]=archived` |
| `_lt`, `_lte`, `_gt`, `_gte` | range | `filter[rank_lte]=10`, `filter[search_volume_gte]=500` |
| `_is_null` | null test, `true` or `false` | `filter[rank_is_null]=true` (beyond depth) |
| `q` field | trigram text search on the endpoint's text column | `filter[q]=crm pricing` |

- Taxonomy filters are subtree-aware: `filter[term]=<term_id>` matches the term and its descendants (doc 08 section 2). `filter[term_in]` is OR within the list; repeating different vocabularies is AND: `filter[term][topic]=<id>&filter[term][market]=<id>`.
- Group filters include subgroups: `filter[group]=<group_id>`.
- Boolean values are `true` and `false`. Dates are `YYYY-MM-DD`; timestamps RFC 3339.
- Filters are validated per endpoint against an allowlist; unknown filters return `422 validation_failed` rather than being ignored, so a typo cannot silently widen a result. The same holds for every query parameter of every route: one the route does not declare is `422 validation_failed` with the error code `extra_forbidden`. A protected route answers `401` first, so an anonymous caller cannot use this to list a route's parameters.

**Expansion.** `include=<a>,<b>` adds optional blocks to rows (for example `include=sparkline,competitors,features` on tracked keywords). Each expansion is documented per endpoint with its cost; unrequested blocks are absent, not null.

### 2.5 Time windows

| Parameter | Type | Meaning |
|---|---|---|
| `from`, `to` | date `YYYY-MM-DD` (inclusive) | Business-date window. For observation lists they also accept RFC 3339 timestamps |
| `window` | enum | Shorthand, mutually exclusive with `from`/`to`: `last_7d`, `last_28d` (default), `last_90d`, `last_12w`, `last_26w`, `mtd`, `last_month`, `last_365d` |
| `tz` | IANA zone | Defaults to the project timezone |
| `compare` | enum | `previous_period` (same length, immediately before), `previous_year`, `none` (default) |
| `compare_from`, `compare_to` | date | Explicit comparison window; overrides `compare` |
| `granularity` | enum | Series only: `day`, `week` (ISO week, Monday start), `month` |

Rules:

1. Rollup tables store business dates computed in the project timezone at ingest (`observed_date`, `metric_date`, doc 04 section 2). Endpoints backed by rollups therefore accept only `tz` equal to the project timezone and return `422 timezone_not_supported` otherwise. Endpoints that filter raw rows by `observed_at` (observation lists, SERP snapshot lists, rank events) accept any `tz`.
2. GSC data uses Pacific Time dates (doc 18 section 4.7). First-party GSC metrics ignore `tz` and return `window.timezone = "America/Los_Angeles"`.
3. `to` defaults to today in `tz`. When today is included, `meta.partial_last_day` is `true`.
4. Maximum window: 400 days for day granularity series, 25 months for week and month granularity, 90 days for observation-level lists without a `prompt_id`, `tracked_keyword_id` or `run_id` filter. Larger requests return `422 window_too_large`; exports have no such limit.
5. The resolved window is echoed in every metric (`window`) so clients never recompute it.

### 2.6 Metric values

Every metric in every response is a `MetricValue` object as defined in doc 16 section 2, serialized in snake_case (section 2.12). This includes tiles, table cells that show a rate or count with a denominator, series points (as the reduced `MetricPoint` below), breakdown rows, and first-party metrics. There is no endpoint that returns a bare rate.

```ts
// Wire format of doc 16 section 2 MetricValue (field-for-field, snake_case).
interface MetricValue {
  metric: string;                       // registry key, e.g. 'ai.mention_rate', 'seo.visibility_volume'
  value: number | null;                 // null when denominator is 0 or the metric is suppressed
  numerator: number | null;
  denominator: number | null;
  unit: 'ratio' | 'count' | 'rank' | 'score' | 'usd' | 'clicks';
  n_observations: number;               // AI observations, SERP checks, or first-party rows that contributed
  n_prompts?: number;                   // AI
  n_keywords?: number;                  // SEO
  ci?: { low: number; high: number; level: 0.95; method: 'wilson' | 'bootstrap_cluster' | 'normal_fixed_panel' };
  aggregation?: 'prompt_weighted' | 'observation_weighted';
  window: { from: string; to: string; timezone: string };
  filters: Record<string, unknown>;     // the resolved filters, including defaults (e.g. include_branded: false)
  observation_class?: 'consumer_ui' | 'serp_ai' | 'official_api' | 'serp' | 'first_party';
  engines?: string[];
  is_estimate: boolean;
  method: string;                       // short human description, e.g. 'Prompt-weighted share of valid answers naming the brand'
  method_version: number;
  version_boundaries?: Array<{ at: string; component: string; from: number | string; to: number | string }>;

  // Optional fields (also in doc 16 section 2):
  entity_id?: string;                   // entity the value is about (SOV, competitor rates)
  engine_code?: string;                 // set when the value is for exactly one engine
  dimension?: { type: string; id: string; label: string };   // breakdown rows
  suppressed_reason?: 'insufficient_data' | 'no_surface' | 'not_classified' | 'below_min_impressions';
  pooled?: { successes: number; trials: number };   // raw counts behind a prompt-weighted rate ("3 of 5 runs")
  source?: string; data_origin?: 'api' | 'file_import'; data_state?: 'final' | 'provisional' | 'mixed'; coverage?: number; // first-party (doc 18 section 11.4)
}

// Reduced form used inside list rows (rule 10). Merged with meta.metric_context[metric] it is a complete MetricValue.
type MetricCell = Pick<MetricValue, 'metric' | 'value' | 'numerator' | 'denominator' | 'n_observations'>
  & Partial<Pick<MetricValue, 'n_prompts' | 'n_keywords' | 'ci' | 'engine_code' | 'entity_id' | 'suppressed_reason' | 'pooled' | 'engines'>>;

// Series points carry the counts, not only the value.
interface MetricPoint {
  t: string;                            // bucket start date
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  n_observations: number;
  ci?: { low: number; high: number };   // level and method are on the series header
  is_partial?: boolean;                 // bucket not complete
}

interface MetricSeries extends Omit<MetricValue, 'value' | 'numerator' | 'denominator' | 'ci'> {
  granularity: 'day' | 'week' | 'month';
  ci_method?: 'wilson' | 'bootstrap_cluster' | 'normal_fixed_panel';
  points: MetricPoint[];
}
```

Rules enforced by the metric service and by a contract test that walks every metric route:

1. `value` is `null` whenever the metric has a denominator and it is `0`. It is never `0` for an empty denominator, and never `NaN`. Metrics without a natural denominator (totals such as `seo.keywords_tracked`, provider attributes such as `seo.search_volume`, cost sums) return `denominator: null` and say so in `method`; everything else returns both `numerator` and `denominator`, and `value = numerator / denominator` holds exactly. For prompt-weighted rates the numerator is the sum of per-prompt rates and the denominator the number of prompts, with raw counts in `pooled`.
2. Rates are ratios in [0, 1]. Visibility (doc 09 section 6) is also returned as a ratio; the UI multiplies by 100. Ranks use `unit: 'rank'`; for a median rank `numerator` is `null` and `denominator` is the ranked count.
3. `is_estimate: true` for anything modeled: estimated clicks, volume-weighted visibility inputs that use search volume, modeled AI demand, CTR-based figures (doc 03 invariant 6). `method` names the model (for example `ctr_v1`).
4. `version_boundaries` lists every breaking boundary inside `window` from `ops.component_versions` (`is_breaking = true`), prompt version changes, panel membership changes, `model_reported` first-seen dates, competitor set changes (for SOV), CTR curve changes, and provider changes on `ai.project_engines` (doc 17 section 9). It is present (possibly empty) on every series and on every window metric.
5. AI metrics are per engine. A cross-engine figure is returned only as an additional `MetricValue` with `metric` suffixed `.engine_average`, `aggregation` unchanged, `engines` listing the inputs, and `method` stating "equal-weight average of per-engine values" (doc 17 section 4.4). The per-engine values are always in the same response.
6. Observation classes are never pooled. A request that would pool (for example `engine_codes=chatgpt_web,google_ai_overview` with `aggregate=pooled`) is rejected with `422 observation_classes_not_poolable`; there is no `pooled` option at all for AI rates.
7. Branded prompts are excluded by default (`filters.include_branded = false`, doc 16 section 1 rule 4). `branded_only=true` selects the branded view.
8. `ci` is present for AI proportions (Wilson or fixed-panel normal, doc 16 section 13.2) and absent for SEO rank metrics (doc 17 section 10). Cluster bootstrap intervals are computed only by the statistics endpoints (section 3.7.9).
9. Per-prompt and per-keyword cells below the minimum support (4 valid observations per engine for matrix cells, doc 15 section 3) return `value: null` with `suppressed_reason: 'insufficient_data'` and the real counts. AI Overview and keyword-run AI Mode metrics use checks where the surface was present as the denominator; a keyword with no surface in the window returns `suppressed_reason: 'no_surface'`, and the presence rate is a separate metric (doc 16 section 1 rule 5).
10. **Hoisting in lists.** Paginated lists and matrix rows return each metric as a `MetricCell`. The fields that are identical for every cell of one metric key in the response (`unit`, `aggregation`, `window`, `filters`, `observation_class`, `is_estimate`, `method`, `method_version`, `version_boundaries`) appear once in `meta.metric_context[metric]`. A cell merged with its context is a complete `MetricValue`; the web app's `lib/api` exports `expandMetricCell()` for this, typed from the generated `MetricCell` and `MetricValue` schemas. Tiles, detail endpoints, comparisons and series always return full `MetricValue` objects.

**Comparison objects** (returned when `compare` is set):

```ts
interface MetricComparison {
  metric: string;
  current: MetricValue;
  previous: MetricValue;
  delta: {
    value: number | null;                        // current.value - previous.value
    ci?: { low: number; high: number; level: 0.95; method: 'paired_bootstrap' | 'newcombe' | 'mcnemar_exact' };
    is_detectable: boolean | null;               // null when not tested (SEO ranks, doc 17 section 10)
    label: 'detectable_change' | 'within_normal_variation' | 'not_tested';
    discordant?: { gained: number; lost: number }; // McNemar counts, paired AI comparisons
  };
  boundaries_straddled: Array<{ at: string; component: string; from: number | string; to: number | string }>;
}
```

### 2.7 Errors

All errors use RFC 9457 `application/problem+json`. They are produced by FastAPI exception handlers registered once on the app: one for our `ProblemError` hierarchy (each subclass carries `status`, `code` and extensions), one for `RequestValidationError` (mapped to `422 validation_failed`, with `errors[]` built from the Pydantic error `loc`, `type` and `msg`), one for Starlette `HTTPException` (404, 405), and a catch-all that returns `500 internal_error` and reports to Sentry.

```json
{
  "type": "https://<domain>/api/problems/validation_failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "2 fields are invalid.",
  "instance": "/api/v1/workspaces/0192.../projects/0192.../tracked-keywords",
  "code": "validation_failed",
  "request_id": "req_01J9ZC4W8Q2T6V3K5M7N9P1R3S",
  "errors": [
    { "location": "query", "path": "filter.rank_lte", "code": "less_than_equal", "message": "Must be at most 100." },
    { "location": "query", "path": "sort", "code": "literal_error", "message": "Unknown sort field 'volume'. Allowed: search_volume, current_rank, rank_change, keyword, priority, created_at." }
  ]
}
```

- `type` resolves to a documentation page per code. `code` is the stable machine value; `title` and `detail` are for humans and may change.
- `errors[]` is present for `validation_failed` and for bulk endpoints that reject individual items. `location` is `body`, `query`, `path` or `header`; `path` is a dot path into that location. `code` inside `errors[]` is the Pydantic error type, or one of our own for a rule Pydantic cannot state: `extra_forbidden` (unknown query parameter), `null_not_allowed`, `slug_reserved`, `slug_is_id`, `timezone_unknown`, `project_unknown`, `scope_not_allowed`.
- Extensions per code are listed here and, once error codes are enumerated in the OpenAPI document (review log F31), there too (for example `existing_id` on `duplicate`, `retry_after_seconds` on `rate_limited`, `reauth_url` on `fresh_session_required`, `limit` and `used` on quota errors).
- 5xx bodies never contain stack traces, SQL, or provider responses.

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON, wrong content type for the body parser |
| 400 | `invalid_cursor` | Cursor does not decode or does not match filters and sort |
| 400 | `idempotency_key_required` | Planned (section 2.8); not returned in V1 |
| 401 | `unauthenticated` | No session and no API key |
| 401 | `session_expired` | Session past sliding or absolute lifetime |
| 401 | `invalid_credentials` | Wrong email or password at sign-in; wrong credential on re-authentication or password change |
| 401 | `invalid_code` | Wrong, reused or unusable TOTP code or recovery code |
| 400 | `invalid_token` | An emailed token that is unknown, used or expired |
| 401 | `invalid_api_key`, `api_key_expired` | Planned with API keys (section 2.1); not returned in V1 |
| 403 | `forbidden` | Caller can see the resource but lacks the permission |
| 403 | `api_key_scope_insufficient` | Planned with API keys: key scopes do not include the route permission |
| 403 | `session_required` | Planned with API keys: route not callable with an API key |
| 403 | `fresh_session_required` | Sensitive action, section 2.1 rule 5 |
| 403 | `two_factor_enrollment_required` | Owner or admin without TOTP |
| 403 | `two_factor_required_for_role` | Owner or admin trying to turn TOTP off |
| 403 | `second_factor_required` | Re-authentication with the password alone by a user who has TOTP on |
| 403 | `email_not_verified` | Creating a workspace or accepting an invitation before the email address is verified |
| 403 | `workspace_suspended` | A write in a suspended workspace (section 2.2) |
| 403 | `registration_closed` | Registration without a usable invitation while `REGISTRATION=invited` |
| 403 | `origin_not_allowed` | CSRF Origin check failed |
| 403 | `ip_not_allowed` | Planned with API keys: key IP allowlist |
| 404 | `not_found` | Missing, deleted, or not visible to the caller (section 2.2) |
| 405 | `method_not_allowed` | |
| 409 | `duplicate` | Unique identity already exists. `existing_id` is included where the caller may know the existing resource; no route built so far sends it (a slug may belong to a workspace or project the caller cannot see, sections 3.2.1 and 3.3) |
| 409 | `conflict` | Concurrent modification of the same resource: a statement could not get a row another request holds within 3 seconds, or two requests waited on each other. Nothing was written. Safe to retry |
| 409 | `invalid_state_transition` | For example confirming an import that is not `preview_ready` |
| 409 | `idempotency_key_in_use` | Planned (section 2.8): same key still processing |
| 409 | `cursor_stale` | Computed-sort cursor after `data_version` changed |
| 409 | `last_owner` | Removing or demoting the only owner |
| 409 | `entity_in_use` | Deleting an entity attached to a project (current or historical) |
| 409 | `integration_reauth_required` | Action needs a connection in `active` status |
| 410 | `invitation_expired` | Accepting an invitation past its 7 days; answered only to the address it was sent to |
| 410 | `export_expired` | Download link past 24 hours |
| 412 | `precondition_failed` | `If-Match` does not match the current ETag |
| 413 | `payload_too_large` | Body above the route limit (JSON 1 MB default; uploads 50 MB) |
| 415 | `unsupported_media_type` | |
| 422 | `validation_failed` | Schema validation; `errors[]` populated |
| 422 | `weak_password` | Password policy; `reason` is `too_short`, `too_long`, `contains_email`, `breached` or `unchanged` |
| 422 | `immutable_field` | Changing tracked keyword identity or prompt text by PATCH |
| 422 | `idempotency_key_reused` | Planned (section 2.8): same key with a different request fingerprint |
| 422 | `quota_exceeded` | `core.workspace_quotas` limit; `limit`, `used`, `requested` included |
| 422 | `competitor_limit` | More than 10 active SEO competitors (doc 08 section 4) |
| 422 | `reason_required` | Locked core panel change without a reason |
| 422 | `panel_locked` | Core panel change without `panels:core:modify` |
| 422 | `single_valued_vocabulary` | Second term from a single-valued vocabulary |
| 422 | `window_too_large`, `timezone_not_supported` | Section 2.5 |
| 422 | `observation_classes_not_poolable` | Section 2.6 rule 6 |
| 422 | `engine_not_enabled` | Engine not in `ai.project_engines` for the project |
| 422 | `url_not_allowed` | SSRF rules rejected a URL (doc 24 section 7.3) |
| 429 | `rate_limited` | Section 2.9 |
| 429 | `manual_run_limit` | 20 manual runs per project per day (doc 24 section 8) |
| 429 | `export_concurrency_limit` | 10 concurrent exports per workspace |
| 500 | `internal_error` | Unexpected; Sentry event id in `request_id` correlation |
| 503 | `service_unavailable` | A dependency the request cannot do without is down (sign-in when Redis cannot count attempts) |
| 503 | `query_timeout` | A statement exceeded its timeout (15 seconds); for analytics, retry with a narrower window |
| 503 | `provider_paused` | Provider paused for the workspace or platform (doc 21 section 6) |
| 503 | `maintenance` | Planned maintenance; `Retry-After` set |

The table lists cross-cutting codes. Route-specific codes (for example `invalid_regex`, `cycle_detected`, `engine_has_no_fanout`) appear in the catalog's Errors column; each has a stable `code` and a `type` page, and all are enumerated in OpenAPI per route. A metered synchronous action that would exceed a hard budget (LLM prompt generation) returns `422 budget_exceeded`.

A run blocked by budget is not an error: the run is created with status `budget_blocked` and returned with 202 (section 2.10), because doc 24 section 8 requires the blocked run and its estimate to be visible.

### 2.8 Idempotency

**Status: deferred** ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). In V1 the API neither requires nor processes the `Idempotency-Key` header: it is ignored when sent, and the idempotency error codes are never returned. Catalog rows that say "Idempotency-Key required" describe the planned behavior, so the header can ship later without changing any route. In V1, duplicate submissions are contained by the database guarantees of doc 21 (unique run and task keys; `ops.collection_tasks` rows exist before any queue job), so a double click cannot double-submit provider work, and the web app disables a trigger until its request settles.

Planned design:

- Header: `Idempotency-Key: <1 to 255 printable ASCII characters>`; a uuid v4 or v7 is recommended.
- **Required** on every POST that creates a run, an import, an export, a backfill, a re-derivation, or a discovery job, and on bulk create endpoints. These routes return `400 idempotency_key_required` without it. **Optional** on all other POST routes.
- Scope: `(workspace_id, actor, key)`, where actor is the user id or API key id. Retention: **24 hours** from the first request.
- The fingerprint is `sha256(method | route template | path params | canonical JSON body)`; multipart uploads use the file sha256 plus the canonical options part.
- Behavior:

| Situation | Result |
|---|---|
| First request | Processed; status and body stored once the handler finishes |
| Repeat, same fingerprint, finished | Stored status and body replayed, header `Idempotent-Replayed: true`, no side effects |
| Repeat, same fingerprint, still processing | `409 idempotency_key_in_use`, `Retry-After: 1` |
| Repeat, different fingerprint | `422 idempotency_key_reused` |
| Original request failed with 5xx | Not stored; the retry is processed as new |
| Original request failed with 4xx | Stored and replayed (the same input fails the same way) |

- Storage: a Redis lock for the in-flight state plus a PostgreSQL row for the stored response (proposed `ops.idempotency_keys`, section 8 item 5), so replays survive a Redis loss. Run creation additionally relies on the database guarantees of doc 21 (unique run and task keys), so a duplicate that slips past the header check still cannot double-submit provider work.

### 2.9 Rate limits

Limits follow doc 24 section 8. Request limits are a FastAPI dependency (`rate_limit`) backed by Redis: a sliding-window counter updated atomically by one Lua script per request, keyed as listed below. The dependency sets the `RateLimit-*` headers and raises `429 rate_limited`; if Redis is unreachable it fails open for reads and closed for auth routes.

| Caller | Limit | Key |
|---|---|---|
| Session | 600 requests per minute per user, 1,200 per minute per workspace | Redis sliding window |
| API key | Planned (deferred): 120 requests per minute per key by default, configurable per key | Redis sliding window |
| Auth routes | 5 failed sign-ins per 15 minutes per account, 20 per 15 minutes per IP, exponential lockout | Auth module plus Redis |
| Manual collection | 20 manual runs per project per day, plus quota and budget | PostgreSQL count of `ops.collection_runs` with `trigger = 'manual'` |
| Exports | 10 concurrent per workspace | PostgreSQL count of `ops.exports` in `queued` or `running` |

Every response to an authenticated request carries:

```
RateLimit-Policy: "user";q=600;w=60, "workspace";q=1200;w=60
RateLimit-Limit: 600
RateLimit-Remaining: 587
RateLimit-Reset: 23
```

`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the window resets) describe the tightest applicable policy. A `429` response includes `Retry-After` in seconds and `retry_after_seconds` in the problem body. The expensive analytics endpoints (statistics drawer, diagnostics, matrix cluster level) additionally count as 5 requests each, stated in OpenAPI as `x-rate-cost: 5`.

### 2.10 Asynchronous operations

Work that takes longer than a request (collection runs, imports, exports, backfills, re-derivations, discovery jobs, link suggestion jobs) is started with a POST that returns `202 Accepted`:

```
HTTP/1.1 202 Accepted
Location: /api/v1/workspaces/0192.../projects/0192.../runs/0192f1c2-7a4e-7d31-9b0e-5c1f2a3b4c5d
Retry-After: 2
```

The body is the created resource. Every async resource embeds the same `operation` block, so clients can poll any of them the same way:

```ts
interface Operation {
  kind: 'collection_run' | 'keyword_import' | 'file_import' | 'export' | 'rederivation'
      | 'discovery_job' | 'integration_backfill' | 'link_suggestion' | 'prompt_generation';
  status: 'queued' | 'running' | 'waiting_for_input' | 'succeeded' | 'succeeded_with_errors'
        | 'failed' | 'cancelled' | 'blocked';
  progress: { done: number; total: number | null; unit: 'tasks' | 'rows' | 'observations' | 'days' | 'items' };
  started_at: string | null;
  finished_at: string | null;
  error: { code: string; detail: string } | null;
  links: { self: string; result?: string; cancel?: string };
}
```

Mapping of domain statuses to `operation.status` (the domain status is always returned too, unchanged):

| Resource | Domain status | Operation status |
|---|---|---|
| `ops.collection_runs` | `planned` / `running` / `completed` / `completed_with_errors` / `failed` / `cancelled` / `budget_blocked` | `queued` / `running` / `succeeded` / `succeeded_with_errors` / `failed` / `cancelled` / `blocked` |
| Keyword import | `uploaded`, `parsing` / `preview_ready`, `needs_mapping` / `writing` / `completed` / `completed_with_errors` / `failed` / `cancelled` | `running` / `waiting_for_input` / `running` / `succeeded` / `succeeded_with_errors` / `failed` / `cancelled` |
| `fp.file_imports` | `uploaded`, `validating` / `needs_mapping` / `imported` / `rejected` / `superseded`, `deleted` | `running` / `waiting_for_input` / `succeeded` / `failed` / `succeeded` |
| Export | `queued` / `running` / `ready` / `failed` / `expired` | `queued` / `running` / `succeeded` / `failed` / `succeeded` |
| `ops.derivation_log` | `running` / `succeeded` / `failed` | `running` / `succeeded` / `failed` |

Polling guidance: `Retry-After` is set on 202 responses and on GETs of non-terminal resources (2 seconds for live checks, 10 seconds for runs, 5 seconds for imports and exports). Terminal resources have no `Retry-After`. Live checks (`check-now`) typically finish in under 10 seconds; live AI runs in up to 120 seconds (doc 21 section 11). Server-sent events are not offered in V1.

### 2.11 Caching and conditional requests

- **Configuration resources** (projects, tracked keywords, prompts, entities, schedules, alert rules) return a strong `ETag` derived from the row's `updated_at` (or a row version where no `updated_at` exists). `PATCH` and `PUT` accept `If-Match`; a mismatch returns `412 precondition_failed`. `If-Match` is optional in V1 except on prompt version creation and panel membership changes, where it is required to prevent two editors from creating conflicting versions.
- **Analytics resources** return a weak ETag `W/"<data_version>.<sha256 of normalized request>"`. `data_version` is the per-project counter that rollup and ingest jobs increment (doc 03 section 7.4). `If-None-Match` with a current ETag returns `304 Not Modified` with no body.
- `Cache-Control: private, no-cache` on all authenticated responses (clients may store, must revalidate). `Vary: Authorization, Cookie, Origin`.
- `meta.data_version` is included in every analytics response. Heavy aggregate endpoints are cached server-side in Redis for 5 minutes keyed by `(workspace, project, route, normalized params, data_version)` (doc 03 section 7.4); `meta.cache` is `hit` or `miss`.
- Raw payload routes return `Cache-Control: private, max-age=3600, immutable`, because raw payloads never change.

### 2.12 Field naming and formats

| Concern | Rule |
|---|---|
| JSON keys | `snake_case` on all `/api/v1` routes, including `/api/v1/auth/*` |
| Column names | Response fields reuse doc 04 column names where they exist (`current_rank`, `depth_requested`, `own_domain_cited`, `citation_kind`) |
| Booleans | `is_*`, `has_*`, or the doc 04 name (`owned_by_project`) |
| Timestamps | RFC 3339 in UTC with `Z`, millisecond precision optional: `2026-09-22T03:14:07Z` |
| Business dates | `YYYY-MM-DD`, in the project timezone unless the field says otherwise (GSC: Pacific Time) |
| Money | Decimal **string** in USD, scale as stored: `"cost_usd": "0.012000"`; `numeric(14,2)` budget fields as `"250.00"` |
| Rates | JSON number in [0, 1], at most 6 decimals |
| Nullability | Documented nullable fields are always present with `null`; optional fields (`?` in schemas) may be absent |
| Enums | lowercase `snake_case` strings, exactly as in doc 04 `CHECK` constraints |
| Unknown request fields | Rejected with `422 validation_failed` (Pydantic `extra="forbid"` on every request model) |
| Envelope | Single resource: `{ "data": {...}, "meta": {...} }`. List: `{ "data": [...], "page": {...}, "meta": {...} }`. `meta` is optional on configuration endpoints |
| Collected text | Returned as plain strings. AI answer markdown is returned as markdown; clients must sanitize before rendering (doc 24 section 7.1). The API never returns provider HTML inline |

### 2.13 Permissions notation

The **Permission** column in the catalog names one key from `backend/src/sightline/api/permissions.py` (a `StrEnum`, emitted in OpenAPI and therefore present in the generated client). The keys and their roles are the doc 24 section 3.2 matrix, which is canonical; this specification uses no other keys:

`workspace:delete`, `workspace:update`, `members:manage`, `integrations:manage`, `providers:manage`, `budgets:manage`, `costs:read`, `projects:write`, `keywords:write`, `prompts:write`, `entities:write`, `taxonomy:write`, `panels:core:modify`, `schedules:write`, `runs:trigger`, `data:read`, `raw:read`, `exports:create`, `audit:read`, `alerts:write`, `views:write`, `imports:write`, `api_keys:manage`, `ops:read`, `tasks:requeue`, `fp:logs:write` (API-key-only scope for the log agent, doc 18 section 9.1; unused until API keys ship).

Pseudo-permissions used in the catalog:

| Notation | Meaning |
|---|---|
| `public` | No authentication |
| `authenticated` | Any signed-in user; no workspace in the path |
| `member` | Any role in the path workspace, including `billing` |
| `platform_operator` | Installation operator: `auth.users.is_platform_operator = true` (doc 24 section 3.1, doc 04 section 4) |

Suffix **fresh** means the route also requires a fresh session (section 2.1 rule 5). API key scopes use the same keys (doc 24 section 2.2).

## 3. Endpoint catalog

### 3.0 How to read the catalog

- Columns: **Method**, **Path** (`{W}` = `/api/v1/workspaces/{workspace_id}`, `{P}` = `{W}/projects/{project_id}`), **Permission** (section 2.13), **Request** (query, body; `?` = optional), **Response** (`200` body type unless stated), **Pg** (`cursor`, `offset`, or `no`), **Errors** (notable codes beyond the defaults), **Ph** (roadmap phase from doc 29 in which the route ships; `10a` and `10b` per doc 29 Phase 10).
- Default errors apply to every route and are not repeated: `401 unauthenticated`, `403 forbidden`, `404 not_found` for any path id, `422 validation_failed`, `429 rate_limited`, `500 internal_error`.
- Types referenced in the tables are defined in the "Schemas" block of each area in TypeScript-like notation. `Page<T>` is the list envelope of section 2.4, `One<T>` is `{ data: T, meta? }`.

Shared schemas:

```ts
type Uuid = string; type BigId = string; type Iso = string; type Day = string; type Usd = string;

interface UrlRef    { url_id: BigId; canonical_url: string; host: string; registrable_domain: string; path: string }
interface DomainRef { domain_id: number; host: string; registrable_domain: string; category: string | null; category_source: 'seed_list' | 'rule' | 'llm' | 'manual' | 'tenant_override' | null }
interface EntityRef { entity_id: Uuid; canonical_name: string; entity_type: 'brand' | 'product' | 'organization' | 'person' | 'other'; role: 'own' | 'competitor' | 'watch' | null; color_index: 1 | 2 | 3 | 4 | 5 | 6 | null }   // --chart-1 to --chart-6, so it follows the theme; null lets the UI choose
interface UserRef   { user_id: Uuid; name: string; email: string }
interface Actor     { actor_type: 'user' | 'api_key' | 'system'; actor_id: string; label: string }
interface VersionBoundary { at: Iso; component: string; from: number | string; to: number | string }

// Depth-aware rank cell (doc 09 section 3). rank = null never means "does not rank".
interface RankCell {
  state: 'ranked' | 'beyond_depth' | 'not_checked' | 'failed';
  rank: number | null;              // organic rank; null unless state = 'ranked'
  absolute_rank: number | null;
  depth_requested: number | null;   // 10, 20, 50, 100; null when not_checked
  url: UrlRef | null;
  observed_at: Iso | null;
  serp_snapshot_id: BigId | null;
}
interface RankChange {
  value: number | null;             // previous - current; positive = improved; null unless label = 'numeric'
  label: 'numeric' | 'new' | 'lost' | 'unchanged_beyond' | 'consistent_beyond' | 'first_check';
  previous_rank: number | null;
  previous_observed_at: Iso | null;
}
```

### 3.1 Auth and session (Phase 1)

Authentication is our own module in the FastAPI app (`sightline.api.auth`, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)), replacing Better Auth (ADR-014, superseded). Passwords are hashed with argon2id (minimum 12 characters, breached-list check). Sessions are opaque random ids stored hashed in `auth.sessions` and cached in Redis for 60 s; the cookie is `__Host-session` (section 2.1). Email verification and password reset use single-use tokens stored hashed in `auth.verification_tokens`. TOTP (pyotp) lives in `auth.totp_secrets` and is required for `owner` and `admin` (rule 6 in section 2.1). Bodies are snake_case like every other route. Google sign-in (OIDC) is deferred; there is no social sign-in route in V1. Workspace membership, invitations and roles are ordinary routes in section 3.2.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/register` | public | `{ name, email, password, invitation_token? }` | `201 { user_id, email_verified }`. With `REGISTRATION=invited` (the default) `invitation_token` is required and the account is created verified; with `open` the user is created unverified and a verification email is sent | no | `403 registration_closed` (no usable invitation for this email; one answer for every reason), `422 weak_password` (with `reason`: `too_short`, `too_long`, `contains_email`, `breached`), `409 duplicate`, `429 rate_limited` (10 per hour per client address) | 1 |
| POST | `/api/v1/auth/verify-email/request` | public | `{ email }` | `202` whether or not the address has an account (no account enumeration); the work happens after the response | no | `429 rate_limited` (30 requests per hour per client address, counted before any lookup), `503 service_unavailable` | 1 |
| POST | `/api/v1/auth/verify-email` | public | `{ token }` (from the fragment of the emailed link, posted by the web page) | `200`; email marked verified, token consumed | no | `400 invalid_token` (one answer for unknown, used, expired), `429 rate_limited` (60 per hour per client address) | 1 |
| POST | `/api/v1/auth/sign-in` | public | `{ email, password }` | `200 { status: 'signed_in' }` with `__Host-session` set; or `200 { status: 'totp_required' }` with a pending session (10 minutes) that only `totp/verify` and `sign-out` accept | no | `401 invalid_credentials` (same for unknown email, wrong password, disabled account), `429 rate_limited` (lockout, with `retry_after_seconds`; also 300 sign-ins per hour per client address), `503 service_unavailable` (Redis cannot count attempts) | 1 |
| POST | `/api/v1/auth/totp/verify` | pending or full session | `{ code }` or `{ recovery_code }` (exactly one) | `200`; the session is replaced by a full, fresh one and the cookie is set again | no | `401 invalid_code` (wrong, already used, or 2FA not on), `429 rate_limited` | 1 |
| POST | `/api/v1/auth/sign-out` | none required | none | `204`; the session, pending or full, is revoked if the cookie names a live one; the cookie is cleared either way | no | | 1 |
| POST | `/api/v1/auth/password-reset/request` | public | `{ email }` | `202` whether or not the address has an account | no | `429 rate_limited` (30 per hour per client address, shared with the verification request), `503 service_unavailable` | 1 |
| POST | `/api/v1/auth/password-reset/confirm` | public | `{ token, new_password }` | `200`; all sessions revoked, email marked verified, account lockout lifted; nobody is signed in | no | `400 invalid_token`, `422 weak_password` (the token stays usable), `429 rate_limited` | 1 |
| POST | `/api/v1/auth/password/change` | authenticated (session) fresh | `{ current_password, new_password }` | `200`; other sessions revoked | no | `401 invalid_credentials`, `422 weak_password` | 1 |
| POST | `/api/v1/auth/totp/setup` | authenticated (session) fresh | none | `{ otpauth_uri, secret }`; secret stored unconfirmed | no | `409 totp_already_enabled` | 1 |
| POST | `/api/v1/auth/totp/setup/confirm` | authenticated (session) | `{ code }` | `{ recovery_codes }` (shown once, stored hashed; `Cache-Control: no-store`); TOTP enabled; other sessions revoked | no | `401 invalid_code`, `409 totp_already_enabled`, `409 conflict` (no setup in progress) | 1 |
| POST | `/api/v1/auth/totp/recovery-codes` | authenticated (session) fresh | none | `{ recovery_codes }` (shown once; previous codes invalidated; `Cache-Control: no-store`) | no | `409 totp_not_enabled` | 1 |
| POST | `/api/v1/auth/totp/disable` | authenticated (session) fresh | none | `200`; other sessions revoked; blocked for an owner or admin of any workspace, whether or not 2FA is on; for anyone else a no-op when it is not on | no | `403 two_factor_required_for_role` | 1 |
| GET | `/api/v1/auth/sessions` | authenticated (session) | none | `{ data: Array<{ session_id, created_at, last_seen_at, ip, user_agent, is_current }> }`: the caller's signed-in sessions that still work. A sign-in that is waiting for its TOTP code is not listed, but `revoke-others` ends it | no | | 1 |
| DELETE | `/api/v1/auth/sessions/{session_id}` | authenticated (session) | none | `204`; session revoked and evicted from the Redis cache; revoking the current session also clears the cookie | no | `404 not_found` (not the caller's session) | 1 |
| POST | `/api/v1/auth/sessions/revoke-others` | authenticated (session) | none | `204` | no | | 1 |

Password change and TOTP changes revoke other sessions; password reset revokes every session (doc 24 section 2). Every sign-in, failed sign-in, TOTP change and session revocation writes `ops.audit_logs` from the auth service: a success in the same transaction, a failure in its own transaction that commits before the error is returned. `GET /api/v1/me` returns the current session, so there is no separate get-session route. The public auth routes are limited per client address and the email-sending ones per mailbox (doc 24 section 2); these use fixed windows in Redis.

**Current user (ours):**

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/me` | authenticated | none | `One<Me>` | no | | 1 |
| PATCH | `/api/v1/me` | authenticated (session only) | `{ name?, image? }` (at least one; `image` is an `https://` URL of at most 2,048 characters, or `null` to remove it) | `One<Me>` | no | | 1 |
| POST | `/api/v1/me/reauthenticate` | authenticated (session only) | `{ password }` or `{ totp_code }` (exactly one). A user with 2FA on must send `totp_code` | `{ fresh_until }`; re-verifies the credential and replaces the session (new cookie, same absolute end); the new session's `fresh_until` is 10 minutes ahead | no | `401 invalid_credentials`, `403 second_factor_required` (password given, 2FA is on), `429 rate_limited` (lockout; also 30 per hour per user) | 1 |

```ts
interface Me {
  user: { user_id: Uuid; name: string; email: string; email_verified: boolean; image: string | null; two_factor_enabled: boolean;
          is_platform_operator: boolean;   // the caller's own flag; gates "create workspace" while registration is by invitation
          created_at: Iso };
  session: { fresh_until: Iso | null; expires_at: Iso; auth_method: 'session' | 'api_key' };
  api_key?: { api_key_id: Uuid; name: string; scopes: string[]; workspace_id: Uuid };   // when called with an API key (deferred)
  memberships: Array<{
    workspace: { workspace_id: Uuid; name: string; slug: string; status: 'active' | 'suspended' | 'deleting' };
    role: 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer' | 'billing';
    project_ids: Uuid[] | null;        // null = all projects (doc 24 section 3.1)
    permissions: string[];             // resolved keys for this role
  }>;
}
```

### 3.2 Workspaces, members, invitations, roles, API keys, quotas, audit (Phase 1)

#### 3.2.1 Workspaces

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/workspaces` | authenticated | none | `{ data: Workspace[] }` of the caller's memberships | no | | 1 |
| POST | `/api/v1/workspaces` | authenticated, verified email; while `REGISTRATION=invited` a platform operator | `{ name, slug, timezone? }` (`timezone` defaults to `UTC`) | `201 One<Workspace>`; caller becomes `owner`; default quotas row | no | `409 duplicate` (slug; no `existing_id`, the other workspace may be someone else's), `403 email_not_verified`, `403 forbidden` (not an operator), `422 validation_failed` with `timezone_unknown`, `429 rate_limited` (5 workspaces per user per day; an attempt refused for another reason costs none, so a taken slug still answers `409` when the allowance is used up) | 1 |
| GET | `{W}` | member | none | `One<Workspace>` | no | | 1 |
| PATCH | `{W}` | `workspace:update` | `{ name?, slug?, logo?, timezone? }` | `One<Workspace>` | no | `409 duplicate` | 1 |
| DELETE | `{W}` | `workspace:delete` fresh | `{ confirm_slug }` | `202`; `status = 'deleting'`, access revoked, hard purge after 30 days (doc 24 section 13) | no | `422 confirmation_mismatch` | deferred |
| POST | `{W}/restore` | `workspace:delete` fresh | none | `One<Workspace>` within the 30-day window | no | `409 invalid_state_transition` | deferred |

```ts
interface Workspace { workspace_id: Uuid; name: string; slug: string; logo: string | null; plan_code: string;
                      timezone: string; status: 'active' | 'suspended' | 'deleting'; created_at: Iso; purge_after: Iso | null }
```

"Deferred" in the Ph column means the route is specified and not built: it waits for launch hardening or for the phase that needs it ([29-phase-roadmap.md](29-phase-roadmap.md) section 1.1).

**Slugs.** A workspace or project slug is 3 to 40 characters: lower-case letters, digits and hyphens, starting and ending with a letter or digit, and not shaped like a uuid. Words that are routes of the web app are refused; the two lists are the enums `ReservedWorkspaceSlug` and `ReservedProjectSlug` in the OpenAPI document, so the forms refuse the same words.

**Time zones.** A time zone is `UTC` or an IANA `Area/Location` name that PostgreSQL knows. A zone a browser still reports by an old name (`Intl` gives `Asia/Calcutta`) is stored and returned by its current name (`Asia/Kolkata`). An unknown name is `422 validation_failed` with the error code `timezone_unknown` on the field.

**Partial updates.** A `PATCH` takes at least one field. A field that cannot be null and is sent as null is a validation error on that field. A change that changes nothing returns the resource, writes nothing and records nothing.

#### 3.2.2 Members and invitations

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/members` | member | none (`filter[role]`, `filter[q]` deferred) | `Page<Member>`, by name | offset | | 1 |
| PATCH | `{W}/members/{user_id}` | `members:manage` fresh | `{ role?, project_ids? }` (only an owner can grant `owner` or change an owner) | `One<Member>` | no | `409 last_owner`, `422 validation_failed` with `project_unknown` or `scope_not_allowed` | 1 |
| DELETE | `{W}/members/{user_id}` | `members:manage` fresh | none | `204`; access removed with the member's next request | no | `409 last_owner` | 1 |
| DELETE | `{W}/members/me` | member | none | `204` (leave workspace) | no | `409 last_owner` | deferred |
| GET | `{W}/invitations` | `members:manage` | none (`filter[status]` deferred) | `Page<Invitation>`, newest first | offset | | 1 |
| POST | `{W}/invitations` | `members:manage`; fresh when the role is `owner` or `admin` | `{ email, role, project_ids? }` (only an owner can invite an owner) | `201 One<Invitation>`; email sent; expires in 7 days | no | `409 duplicate` (pending invitation or existing member), `403 fresh_session_required`, `422 validation_failed` with `project_unknown` or `scope_not_allowed`, `429 rate_limited` (per hour: 20 per inviter, 50 per workspace, 3 per invited address; an attempt that is refused, for any reason, costs none of the three) | 1 |
| DELETE | `{W}/invitations/{invitation_id}` | `members:manage` | none | `204` (withdraw; the link stops working; repeating it is not an error) | no | `409 invalid_state_transition` (already accepted or declined, or past its date) | 1 |
| POST | `/api/v1/invitations/accept` | authenticated (the invited address, verified) | `{ token }` from the link `{origin}/invite#token=<token>` | `One<AcceptedInvitation>`; accepting again returns the same | no | `400 invalid_token` (one answer for a token that is unknown, withdrawn, sent to another address, or void because its sender has since left, been disabled or lost the right to grant the role), `410 invitation_expired`, `403 email_not_verified`, `403 workspace_suspended` | 1 |
| POST | `{W}/invitations/{invitation_id}/resend` | `members:manage` | none | `One<Invitation>` | no | `409 invalid_state_transition` | deferred |
| POST | `/api/v1/invitations/preview` | public | `{ token }` in the body, never the query (a query string reaches the access log) | `One<InvitationPreview>` (workspace name and slug, role, invited email, inviter name) | no | | deferred |
| POST | `/api/v1/invitations/decline` | authenticated (the invited address) | `{ token }` | `204` | no | | deferred |

An invitation is accepted by its token, not by its id: the invited person is not yet a member, so row-level security hides the invitation row from them, and the only lookup the database offers is by token hash (doc 04 section 13). A new person opens the link, registers with `invitation_token` (their address is then verified), signs in and calls accept. The token is in the emailed link only; the database keeps its hash.

- **Owners.** Only an owner grants the owner role, invites an owner, or changes or removes an owner. The last owner cannot be demoted or removed. Owners and admins always have every project: `project_ids` must be null for them, and promotion to either lifts a scope the member had.
- **Scope.** `project_ids: null` is every project; a list limits the member to those projects, which must be live projects of the workspace; an empty list is a member of no project, who sees the workspace and none of its projects.
- **An invitation grants nothing until it is accepted**, so what its sender may grant is judged twice: when it is sent, and again when it is accepted. When a member stops managing members (removed, or demoted below admin), the pending invitations they sent are withdrawn; when an owner stops being an owner, the ones they sent for the owner role are. Each withdrawal is an `invitation.cancelled` audit entry whose `after` gives the reason (`sender_demoted` or `sender_removed`). An invitation already past its date is left as it is. Someone who already belongs and accepts an invitation keeps the membership they have.
- **What a member sees of the others.** Name, email, role, scope and joining date. `two_factor_enabled` and `last_active_at` are null unless the caller holds `members:manage` or the row is the caller's own.

```ts
interface Member { user: UserRef; role: Role; project_ids: Uuid[] | null; two_factor_enabled: boolean | null; joined_at: Iso;
                   last_active_at: Iso | null }   // when a signed-in session of theirs was last used; null when signed out everywhere
interface Invitation { invitation_id: Uuid; email: string; role: Role; project_ids: Uuid[] | null;
                       status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'; invited_by: UserRef; expires_at: Iso; created_at: Iso }
interface AcceptedInvitation { workspace: { workspace_id: Uuid; name: string; slug: string }; member: Member }   // where to send the user
```

#### 3.2.3 Roles and permissions

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/roles` | authenticated | none | `{ data: Array<{ role, description, permissions: string[] }>, permission_keys: Array<{ key, description, api_key_scope: boolean }> }` generated from `sightline.api.permissions` | no | | deferred |

Roles are fixed in V1 (doc 24 section 3.1); there are no custom roles.

#### 3.2.4 API keys

**Deferred** ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)). These routes are not mounted in V1 and the Settings screen has no API keys page; the `auth.api_keys` table exists so the design below can ship without a migration. The `Ph` column reads `deferred`.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/api-keys` | `api_keys:manage` | `filter[status]?` | `Page<ApiKey>` (never the secret) | offset | || deferred |
| POST | `{W}/api-keys` | `api_keys:manage` fresh | `{ name, scopes: string[], expires_in_days? (1 to 730, default 365), ip_allowlist?: string[] (CIDR), rate_limit_per_minute? (1 to 600) }` | `201 One<ApiKey & { secret: string }>`; secret shown once | no | `422 scope_exceeds_role` || deferred |
| PATCH | `{W}/api-keys/{api_key_id}` | `api_keys:manage` | `{ name?, ip_allowlist?, rate_limit_per_minute? }` (scopes are immutable; create a new key) | `One<ApiKey>` | no | || deferred |
| DELETE | `{W}/api-keys/{api_key_id}` | `api_keys:manage` fresh | none | `204`; revoked immediately | no | || deferred |

```ts
interface ApiKey { api_key_id: Uuid; name: string; prefix: string; scopes: string[]; ip_allowlist: string[];
                   rate_limit_per_minute: number; status: 'active' | 'expired' | 'revoked'; expires_at: Iso | null;
                   last_used_at: Iso | null; last_used_ip: string | null; created_by: UserRef; created_at: Iso }
```

#### 3.2.5 Quotas, audit logs, registries

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/quotas` | member | none | `One<QuotaUsage>` | no | | deferred |
| PUT | `/api/v1/admin/workspaces/{workspace_id}/quotas` | platform_operator | `{ max_projects, max_tracked_keywords, max_active_prompts, max_ai_observations_per_month, max_serp_checks_per_month }` | `One<QuotaUsage>` | no | | deferred |
| GET | `{W}/audit-logs` | `audit:read` | `from?`, `to?`, `filter[actor_type]?`, `filter[actor_id]?`, `filter[action]?` (prefix match, e.g. `panel.`), `filter[target_type]?`, `filter[target_id]?` | `Page<AuditLog>` sorted `-occurred_at` | cursor | | deferred |
| GET | `/api/v1/locations` | authenticated | `filter[q]?` (left out: all, by name, so `filter[location_type]=Country` lists countries), `filter[country_iso]?`, `filter[location_type]?`, `filter[supports]?` (`serp`, `ai_mode`, `llm_scraper`) | `Page<Location>` | cursor | | 2 |
| GET | `/api/v1/engines` | authenticated | none | `{ data: Engine[] }` from `ai.engines` | no | | 6 |
| GET | `/api/v1/serp-feature-types` | authenticated | none | `{ data: Array<{ code, label, ownable, tracked_by_default }> }` | no | | 4 |
| GET | `/api/v1/domain-categories` | authenticated | none | `{ data: Array<{ code, label, description }> }` | no | | 2 |
| GET | `/api/v1/component-versions` | authenticated | `filter[component]?` | `{ data: Array<{ component, version, released_at, notes, is_breaking }> }` (no `git_sha`) | no | | 1 |

```ts
interface QuotaUsage {
  limits: { max_projects: number; max_tracked_keywords: number; max_active_prompts: number; max_ai_observations_per_month: number; max_serp_checks_per_month: number };
  usage:  { projects: number; tracked_keywords_active: number; prompts_active: number; ai_observations_this_month: number; serp_checks_this_month: number };
  period: { from: Day; to: Day; timezone: string };
}
interface AuditLog { audit_log_id: BigId; occurred_at: Iso; actor: Actor; action: string; target_type: string; target_id: string;
                     before: unknown | null; after: unknown | null; ip: string | null; user_agent: string | null; request_id: string | null }
interface Location { location_id: number; name: string; country_iso: string; location_type: string; parent_id: number | null; supports: string[] }
interface Engine { engine_code: string; label: string; observation_class: 'consumer_ui' | 'official_api' | 'serp_ai'; vendor: string;
                   exposes_citations: boolean; exposes_fanout: boolean; is_active: boolean }
```

Engine codes (the `ai.engines` registry, doc 04 section 8.1; identical in docs 07 and 12): `chatgpt_web`, `chatgpt_web_forced_search`, `gemini_web`, `perplexity_web`, `copilot_web`, `claude_web` (consumer UI); `google_ai_overview`, `google_ai_mode` (SERP AI); `openai_api_search`, `gemini_api_grounded`, `anthropic_api_search`, `perplexity_api`, `xai_api_search` (official API). Codes without a V1 provider exist in the registry with `is_active = false`.

### 3.3 Projects (Phase 1)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/projects` | member | `filter[status_in]?` (default `active,paused`; `filter[q]` deferred) | `Page<Project>` limited to the caller's project scope, by name; deleted projects never | offset | | 1 |
| POST | `{W}/projects` | `projects:write`, and a membership that is not limited to some projects (`403 forbidden` otherwise, before the body is looked at) | `ProjectCreate` | `201 One<Project>` | no | `409 duplicate` (slug), `422 quota_exceeded` (`limit`, `used`, `requested`), `422 validation_failed` with `timezone_unknown` | 1 |
| GET | `{P}` | member | none | `One<Project>` | no | | 1 |
| PATCH | `{P}` | `projects:write` | `{ name?, slug?, primary_domain?, default_location_id?, default_language_code?, timezone?, deep_check_weekday?, status? ('active','paused','archived') }` | `One<Project>` with `meta.warnings` | no | `409 duplicate` (slug); `412 precondition_failed` once `If-Match` is built (deferred) | 1 |
| DELETE | `{P}` | `projects:write` fresh | `{ confirm_slug }` | `204`; soft delete (`deleted_at`), schedules deactivated | no | `422 confirmation_mismatch` | deferred |
| GET | `{P}/settings` | `data:read` | none | `One<ProjectSettingsV1>` | no | | 3 |
| PATCH | `{P}/settings` | `projects:write` | partial `ProjectSettingsV1` (JSON merge patch, RFC 7396) | `One<ProjectSettingsV1>` | no | | 3 |
| GET | `{P}/domains` | `data:read` | `filter[role]?` (`own`, `competitor`, `watch`) | `{ data: ProjectDomain[] }` read-only view of `core.project_domain_roles` | no | | 2 |

```ts
interface ProjectCreate {
  name: string; slug: string;
  primary_domain?: string;               // host; resolved into core.domains, stored as primary_domain_id
  default_location_id?: number; default_language_code?: string;
  timezone?: string;                     // IANA; default workspace timezone
  deep_check_weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 0 = Sunday; default 1
  settings?: Partial<ProjectSettingsV1>;
  own_entity?: { canonical_name: string; domains: string[]; aliases?: string[] };   // Phase 2+: creates entity with role 'own', is_primary
}
interface Project {
  project_id: Uuid; workspace_id: Uuid; name: string; slug: string;
  primary_domain: DomainRef | null; default_location_id: number | null;
  default_location: { location_id: number; name: string; country_iso: string; location_type: string } | null;   // the location default_location_id names
  default_language_code: string | null;
  timezone: string; deep_check_weekday: number; status: 'active' | 'paused' | 'archived';
  data_version: number; entity_config_version: number;
  created_by: UserRef | null; created_at: Iso; updated_at: Iso;
}
// Pydantic model ProjectSettingsV1 stored in core.projects.settings (doc 04 section 4)
interface ProjectSettingsV1 {
  version: 1;
  seo: {
    default_device: 'desktop' | 'mobile' | 'both';                 // 'both' expands to two tracked keywords
    default_depth_profile: 'light' | 'standard' | 'deep' | 'full' | 'weekly' | 'weekly_light' | 'until_own_match_100';
    default_frequency: 'daily' | 'weekly';
    visibility_weight_scheme: 'uniform' | 'priority' | 'business_value';   // doc 09 section 6.2
    visibility_volume_mode: 'annual_average' | 'seasonal';              // doc 08 section 6
    ctr_curve_version: number;                                          // default 1 (ctr_v1)
    providers: { serp: string };                                        // doc 05 section 4
  };
  ai: {
    ai_weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    chatgpt_series: 'chatgpt_web' | 'chatgpt_web_forced_search';        // doc 07 section 1 rule 1
    classifier_budget_usd_month: string;                               // default "10.00" (doc 13 stage 11)
    classify_competitor_sentiment: boolean;
    priority_subset_max: number;                                        // default 100
  };
  matrix: { seo_strong_lte: number; seo_weak_gt: number; ai_strong_gte: number; ai_weak_lte: number; min_observations: number };
  entity_config_version: number;                                        // read-only here; bumped by entity changes (doc 13 section 3)
}
interface ProjectDomain { entity: EntityRef; domain: DomainRef; match_scope: 'host' | 'registrable' | 'path_prefix'; path_prefix: string | null }
```

**The project limit** (`max_projects`) counts active and paused projects. An archived project does not count, so archiving one frees a slot, and bringing it back (`status` from `archived` to `active` or `paused`) needs a free slot and is `422 quota_exceeded` without one. A deleted project is gone for the count, and its slug stays taken until the delete route decides otherwise. `409 duplicate` for a slug carries no `existing_id`: the project that holds it may be deleted or outside the caller's scope.

`filter[status_in]` takes comma-separated statuses and may be given more than once (up to 10 times); every value counts and an unknown one is `422`.

**What is accepted today.** `ProjectCreate` takes `name`, `slug`, `timezone?`, `deep_check_weekday?` and `default_language_code?`, and `PATCH {P}` takes those and `status`. `primary_domain`, `default_location_id` and `own_entity` arrive with Phase 2, which creates the tables they point at, and `settings` with Phase 3, its first reader; until then a request that sends one is `422`, and `Project.primary_domain` and `default_location_id` are null. The settings routes move to Phase 3 for the same reason.

Changing `timezone` affects only future business dates; already computed `observed_date` values stay (doc 04 section 2). The response of `PATCH {P}` always has `meta.warnings`, which holds `timezone_change_applies_forward` when the zone changed and is empty otherwise. `deep_check_weekday` is stored and steers nothing yet; from Phase 4 a changed weekday updates the next occurrence of the project's `seo_rank` schedule, and `status` also pauses and resumes collection. Today `status` decides the default listing and what counts against the project limit.

### 3.4 Entities: brands, competitors, aliases, domains, candidates (Phase 2, candidates Phase 8)

Entities are workspace-scoped; roles are per project (doc 04 section 6). Any change to an entity, alias, entity domain or project role increments `entity_config_version` for every project that uses the entity (`core.project_domain_roles` is a plain view, so it is current at once), and schedules re-derivation of the last 90 days (doc 13 section 6). Mutating responses list the triggered work in `meta.rederivations: Array<{ project_id, derivation_log_id, links }>` and `meta.backfills` (competitor SEO backfill, doc 08 section 4).

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/entities` | `data:read` | `filter[entity_type]?`, `filter[q]?`, `filter[project_id]?`, `filter[role]?` | `Page<Entity>` | cursor | | 2 |
| POST | `{W}/entities` | `entities:write` | `EntityCreate` | `201 One<Entity>` | no | `409 duplicate` | 2 |
| GET | `{W}/entities/{entity_id}` | `data:read` | none | `One<EntityDetail>` (aliases, domains, projects and roles) | no | | 2 |
| PATCH | `{W}/entities/{entity_id}` | `entities:write` | `{ canonical_name?, entity_type?, parent_entity_id?, description?, is_ambiguous?, disambiguation_hints? }` | `One<Entity>` | no | `409 duplicate` | 2 |
| DELETE | `{W}/entities/{entity_id}` | `entities:write` | none | `204` only if never attached to a project | no | `409 entity_in_use` | 2 |
| GET | `{W}/entities/{entity_id}/aliases` | `data:read` | none | `{ data: Alias[] }` | no | | 2 |
| POST | `{W}/entities/{entity_id}/aliases` | `entities:write` | `AliasInput` or `{ items: AliasInput[] }` (max 200) | `201 { data: Alias[] }` | no | `409 duplicate`, `422 invalid_regex` (RE2 compile, doc 13 stage 4) | 2 |
| PATCH | `{W}/entities/{entity_id}/aliases/{alias_id}` | `entities:write` | partial `AliasInput` | `One<Alias>` | no | | 2 |
| DELETE | `{W}/entities/{entity_id}/aliases/{alias_id}` | `entities:write` | none | `204` | no | | 2 |
| GET | `{W}/entities/{entity_id}/domains` | `data:read` | none | `{ data: EntityDomain[] }` | no | | 2 |
| POST | `{W}/entities/{entity_id}/domains` | `entities:write` | `{ domain: string (host or URL), match_scope: 'host' \| 'registrable' \| 'path_prefix', path_prefix? }` | `201 One<EntityDomain>`; domain canonicalized (doc 14 section 3); `meta.warnings: ['domain_role_conflict']` when another entity in a shared project claims it at the same specificity (doc 13 stage 2) | no | `409 duplicate` | 2 |
| DELETE | `{W}/entities/{entity_id}/domains/{entity_domain_id}` | `entities:write` | none | `204` | no | | 2 |
| GET | `{P}/entities` | `data:read` | `filter[role]?`, `filter[include_removed]?` | `{ data: ProjectEntity[] }` | no | | 2 |
| POST | `{P}/entities` | `entities:write` | `{ entity_id, role: 'own' \| 'competitor' \| 'watch', is_primary?, track_seo?, track_ai?, color_index? }` | `201 One<ProjectEntity>`; for `competitor` with `track_seo`, `meta.backfills` lists the historical rank backfill | no | `409 duplicate`, `422 competitor_limit`, `409 primary_own_exists` | 2 |
| PATCH | `{P}/entities/{entity_id}` | `entities:write` | `{ role?, is_primary?, track_seo?, track_ai?, color_index? }` | `One<ProjectEntity>` | no | | 2 |
| DELETE | `{P}/entities/{entity_id}` | `entities:write` | none | `200 One<ProjectEntity>` with `removed_at` set; history kept for SOV integrity (doc 04 section 6) | no | `409 cannot_remove_primary_own` | 2 |
| POST | `{P}/alias-test` | `data:read` | `{ text?: string, markdown?: string, observation_id?: BigId }` (one of) | `{ data: { mentions: Array<{ entity: EntityRef, spans: Array<{ start, end, alias_id, match_method, score, status }>, confidence, status: 'accepted' \| 'uncertain' \| 'discarded' }>, negatives_applied: Array<{ start, end, alias_id }>, skipped_alias_ids: Uuid[] } }`; no persistence | no | `413 payload_too_large` (100 KB), `422 too_many_matches` (over 250,000) | 2 |
| GET | `{P}/competitor-suggestions` | `data:read` | `window?`, `min_share?` (default 0.2) | `{ data: Array<{ domain: DomainRef, keywords_top10: number, share_of_keywords: MetricValue, seo_sov: MetricValue }> }` computed from stored `organic_domain_ids` (doc 08 section 4) | no | | 5 |
| GET | `{P}/entity-candidates` | `data:read` | `filter[status]?` (default `new`), `filter[engine_code]?`, `sort?` (`-prompt_count` default, `-observation_count`, `-last_seen_at`) | `Page<EntityCandidate>` | cursor | | 8 |
| POST | `{P}/entity-candidates/{normalized_name}/accept` | `entities:write` | `{ role: 'competitor' \| 'watch', canonical_name?, entity_type?, domains?: string[] }` | `201 One<ProjectEntity>`; creates entity, alias (display name), linked domains; status `accepted` | no | `409 invalid_state_transition`, `422 competitor_limit` | 8 |
| POST | `{P}/entity-candidates/{normalized_name}/ignore` | `entities:write` | none | `One<EntityCandidate>` status `ignored` | no | | 8 |

```ts
interface EntityCreate { entity_type: 'brand' | 'product' | 'organization' | 'person' | 'other'; canonical_name: string;
                         parent_entity_id?: Uuid; description?: string; is_ambiguous?: boolean; disambiguation_hints?: string[];
                         aliases?: AliasInput[]; domains?: DomainInput[] }
interface DomainInput { domain: string;                                // a host, or a URL whose host is meant
                        match_scope?: 'host' | 'registrable' | 'path_prefix';   // default 'registrable'
                        path_prefix?: string }                         // exactly when match_scope is 'path_prefix'
interface Entity { entity_id: Uuid; entity_type: EntityCreate['entity_type']; canonical_name: string; parent_entity_id: Uuid | null;
                   description: string | null; is_ambiguous: boolean; disambiguation_hints: string[];
                   alias_count: number; domains: EntityDomain[]; created_at: Iso; updated_at: Iso }
interface EntityDetail extends Entity { aliases: Alias[]; projects: Array<{ project_id: Uuid; role: 'own' | 'competitor' | 'watch'; is_primary: boolean; removed_at: Iso | null }> }
interface AliasInput { alias: string; match_mode?: 'word_boundary' | 'exact_case' | 'substring' | 'regex';   // default 'word_boundary'
                       case_sensitive?: boolean; language_code?: string | null; is_negative?: boolean; requires_context?: boolean }
interface Alias extends AliasInput { alias_id: Uuid; entity_id: Uuid; created_by: UserRef | null; created_at: Iso }
// Domain-shaped aliases (doc 13 stage 4) are generated when the automaton is compiled; they are not rows and are not listed here.
// POST {P}/alias-test reports them with match_method 'alias_domain'.
interface EntityDomain { entity_domain_id: Uuid; entity_id: Uuid; domain: DomainRef; match_scope: 'host' | 'registrable' | 'path_prefix'; path_prefix: string | null }
interface ProjectEntity { project_id: Uuid; entity: EntityRef; role: 'own' | 'competitor' | 'watch'; is_primary: boolean;
                          track_seo: boolean; track_ai: boolean; color_index: 1 | 2 | 3 | 4 | 5 | 6 | null; added_at: Iso; removed_at: Iso | null;
                          alias_count: number; domains: EntityDomain[] }
interface EntityCandidate { normalized_name: string; display_name: string; first_seen_at: Iso; last_seen_at: Iso;
                            observation_count: number; prompt_count: number; engines: string[];
                            sample_observation_ids: BigId[]; linked_domains: DomainRef[]; status: 'new' | 'accepted' | 'ignored' }
```

**As built (step 4).** Request rules that report as `422 validation_failed` with these field codes: `invalid_domain` (not a host or an http(s) URL), `domain_is_public_suffix` (a registrable rule on `co.uk` or `github.io` would claim every site under it), `path_prefix_mismatch` (`path_prefix` given without `match_scope: 'path_prefix'`, or the reverse), `invalid_path_prefix` (a query or fragment), `invalid_regex` (RE2 cannot compile the pattern: no backreferences or lookaround), `one_of` (the alias test takes exactly one of `text` and `markdown`). Hosts and path prefixes are stored the way the canonicalizer writes them (doc 14 section 3.3), so `https://www.Acme.com/x` is the host `www.acme.com` and `/@acme/` is `/@acme`; a registrable rule is stored against the registrable domain itself (`acme.com`). `domain_role_conflict` is raised when, in a project that gives the entity a live role, another entity claims the same thing (registrable domain, host, or host and path prefix) as the rule just added. A member limited to some projects sees only the entities those projects have named, and roles in those projects only (`404` for any other entity); changing a workspace entity, its aliases or its domains needs a membership that is not limited, since every project shares the entity (`403 forbidden` otherwise). Entity lists sort by name without case, with the id as tie-breaker; `filter[q]` matches names and aliases as text, and `filter[project_id]` and `filter[role]` keep entities a live role names. Deleting an entity a role names, even a removed role, or one that has products is `409 entity_in_use`; a parent that would make a cycle is `422 cycle_detected`, and one that does not exist is `422 validation_failed` with `parent_unknown`. Names and word aliases are trimmed; an alias that ignores case is a duplicate in any case. `own_entity` on project create makes word aliases that ignore case, with no language, and registrable domain rules. The alias test reports offsets in UTF-16 code units, so they index a JavaScript string directly; it takes no `observation_id` until observations exist (step 8), and markdown is matched as its source text until stage 3 parsing arrives. `meta.rederivations` and `meta.backfills` are left out until the work they list exists (steps 8 and 5).

### 3.5 Taxonomy (Phase 2)

Vocabularies are workspace-wide (`project_id = null`) or project-scoped (doc 04 section 5.3). Terms are a tree with a materialized path; filters are subtree-aware.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/vocabularies` | `data:read` | `filter[project_id]?` (includes workspace-wide), `filter[kind]?` | `Page<Vocabulary>` | offset | | 2 |
| POST | `{W}/vocabularies` | `taxonomy:write` | `{ kind, name, project_id?, is_hierarchical?, is_single_valued? }` | `201 One<Vocabulary>` | no | `409 duplicate` | 2 |
| PATCH | `{W}/vocabularies/{vocabulary_id}` | `taxonomy:write` | `{ name?, is_single_valued? }` (turning on single-valued fails if any subject has two terms) | `One<Vocabulary>` | no | `409 single_valued_violation` | 2 |
| DELETE | `{W}/vocabularies/{vocabulary_id}` | `taxonomy:write` | none | `204`; terms and assignments cascade | no | | 2 |
| GET | `{W}/vocabularies/{vocabulary_id}/terms` | `data:read` | `format?` (`tree` default, `flat`), `filter[q]?` | `{ data: TermNode[] }` | no | | 2 |
| POST | `{W}/vocabularies/{vocabulary_id}/terms` | `taxonomy:write` | `{ name, parent_id?, slug?, description? }` or `{ items: [...] }` (max 500; `path` strings such as `CRM/CRM for Startups` create missing parents) | `201 { data: Term[] }` | no | `409 duplicate` | 2 |
| PATCH | `{W}/terms/{term_id}` | `taxonomy:write` | `{ name?, slug?, parent_id?, description? }` (move recomputes `path` for the subtree) | `One<Term>` | no | `422 cycle_detected` | 2 |
| DELETE | `{W}/terms/{term_id}` | `taxonomy:write` | `cascade?` (default `false`) | `204` | no | `409 has_children` | 2 |
| POST | `{P}/term-assignments` | `keywords:write` for keywords, `prompts:write` for prompts | `{ op: 'add' \| 'remove' \| 'replace', subject_type: 'tracked_keyword' \| 'prompt', subject_ids?: Uuid[] (max 5,000), subject_filter?: object (same filters as the subject list endpoint), term_ids: Uuid[] }` | `{ data: { subjects_matched, assignments_added, assignments_removed } }` | no | `422 single_valued_vocabulary` | 2 |

```ts
interface Vocabulary { vocabulary_id: Uuid; project_id: Uuid | null; kind: 'topic' | 'cluster' | 'product' | 'service' | 'market' | 'campaign' | 'persona' | 'tag' | 'custom';
                       name: string; is_hierarchical: boolean; is_single_valued: boolean; term_count: number }
interface Term { term_id: Uuid; vocabulary_id: Uuid; parent_id: Uuid | null; name: string; slug: string; path: string;
                 source: 'manual' | 'import' | 'auto_cluster' | 'ai_suggestion'; description: string | null; created_at: Iso }
interface TermNode extends Term { children: TermNode[]; keyword_count: number; prompt_count: number }   // the counts arrive with keywords (step 5) and prompts (step 8); children is empty in the flat format
interface TermInput { name?: string; parent_id?: Uuid; path?: string; slug?: string; description?: string }   // exactly one of name and path; a path ("CRM/CRM for Startups") starts at the root and creates missing parents
```

`replace` removes the subject's existing terms **within the vocabularies of the given term ids** and adds the new ones; it never touches other vocabularies. Assignment writes `assigned_by = 'manual'` (or `'import'` from import pipelines).

### 3.6 SEO (Phases 3 to 5)

#### 3.6.1 Keywords and tracked keywords (Phase 3)

`seo.keywords` is the workspace dictionary (text plus language); `seo.tracked_keywords` is the measured series per project, engine, location, language and device (doc 08 section 1). Identity fields are immutable: changing location or device means creating a new tracked keyword and archiving the old one.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/keywords` | `data:read` | `filter[q]`, `filter[language_code]?` | `Page<Keyword>` | cursor | | 3 |
| GET | `{W}/keywords/{keyword_id}` | `data:read` | none | `One<KeywordDetail>` (current metrics per location and source, tracked variants visible to the caller) | no | | 3 |
| GET | `{W}/keywords/{keyword_id}/metrics-history` | `data:read` | `location_id`, `language_code`, `source?` (default `dataforseo_labs`), `from?`, `to?` | `One<KeywordMetricsHistory>` | no | | 3 |
| GET | `{W}/keywords/{keyword_id}/ai-demand` | `data:read` | `location_id`, `language_code` | `One<{ snapshots: Array<{ fetched_at, ai_demand_estimate, monthly_estimates, method_note }>, latest: MetricValue }>` with `is_estimate: true`, labeled "Modeled AI demand" (doc 11 section 7) | no | | 11 |
| POST | `{P}/keyword-metrics/refresh` | `runs:trigger` | `{ keyword_ids?: Uuid[] (max 1,000), stale_days?: number }`; Idempotency-Key required | `202 One<Run>` (workload `keyword_metrics`) | no | `429 manual_run_limit` | 3 |
| GET | `{P}/tracked-keywords` | `data:read` | Filters and sorts below; `include?` (`sparkline`, `competitors`, `features`, `metrics`, `groups`, `terms`, `aio`); `date?` (state as of a past date, from history) | `Page<TrackedKeywordRow>` with `page.total` | cursor | | 3 |
| POST | `{P}/tracked-keywords` | `keywords:write` | `TrackedKeywordCreate` | `201 { data: TrackedKeyword[] }` (two rows when `device = 'both'`) | no | `409 duplicate` (`existing_id`), `422 quota_exceeded`, `422 search_operator_not_allowed`, `422 keyword_too_long` (over 700 chars) | 3 |
| POST | `{P}/tracked-keywords/bulk-create` | `keywords:write` | `{ items: TrackedKeywordCreate[] (max 1,000), on_duplicate: 'skip' \| 'merge_terms' }`; Idempotency-Key required | `200 { data: { created: Uuid[], skipped: Array<{ index, existing_id }>, rejected: Array<{ index, code, message }> } }`; larger sets use imports (3.6.3) | no | `422 quota_exceeded` (whole batch, nothing written) | 3 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}` | `data:read` | none | `One<TrackedKeywordDetail>` | no | | 3 |
| PATCH | `{P}/tracked-keywords/{tracked_keyword_id}` | `keywords:write` | `TrackedKeywordPatch` | `One<TrackedKeyword>`; `depth_profile` or `target_url` change increments `config_version` and writes `seo.tracked_keyword_config_history` | no | `422 immutable_field`, `412 precondition_failed` | 3 |
| DELETE | `{P}/tracked-keywords/{tracked_keyword_id}` | `keywords:write` | none | `204` (soft delete, `deleted_at`; history retained) | no | | 3 |
| POST | `{P}/tracked-keywords/bulk-update` | `keywords:write` | `{ ids?: Uuid[] (max 5,000), filter?: object, set: TrackedKeywordPatch, add_group_ids?, remove_group_ids?, add_term_ids?, remove_term_ids? }` (exactly one of `ids`, `filter`) | `{ data: { matched, updated, config_versions_created } }` | no | `422 too_many_subjects` (filter matches more than 20,000) | 3 |
| POST | `{P}/tracked-keywords/bulk-archive` | `keywords:write` | `{ ids?: Uuid[], filter?: object, archive: boolean }` (archive sets `is_active = false`: not scheduled, not counted in quota, history kept) | `{ data: { matched, updated } }` | no | `422 quota_exceeded` (unarchive) | 3 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/config-history` | `data:read` | none | `{ data: Array<{ config_version, depth_profile, target_url: UrlRef \| null, valid_from, valid_to, changed_by: UserRef \| null, change_reason }> }` | no | | 3 |
| PUT | `{P}/tracked-keywords/{tracked_keyword_id}/competitors` | `keywords:write` | `{ include: Uuid[], exclude: Uuid[] }` (entity ids with a project role) | `One<{ effective_competitors: EntityRef[], overrides: Array<{ entity_id, mode }> }>` | no | `422 entity_not_in_project` | 3 |

Tracked keyword list filters (all optional): `filter[q]`, `filter[group]`, `filter[term]`, `filter[term_in]`, `filter[device]`, `filter[location_id]`, `filter[language_code]`, `filter[search_engine]`, `filter[intent_in]`, `filter[funnel_stage_in]`, `filter[priority_lte]`, `filter[is_active]` (default `true`), `filter[source_in]`, `filter[depth_profile_in]`, `filter[rank_lte]`, `filter[rank_gte]`, `filter[rank_is_null]` (beyond depth at the latest check), `filter[rank_change_label_in]` (`numeric`, `new`, `lost`, `unchanged_beyond`, `consistent_beyond`, `first_check`), `filter[improved]`, `filter[declined]`, `filter[feature_present]` (feature type), `filter[feature_owned]`, `filter[aio_state]` (`absent`, `present_not_cited`, `present_cited`, `not_loaded`), `filter[ranking_url_id]`, `filter[target_url_match]`, `filter[is_stale]`, `filter[cannibalization_class_in]`, `filter[search_volume_gte]`, `filter[keyword_difficulty_lte]`.

Sort fields: `keyword`, `current_rank` (beyond depth sorts last in both directions), `rank_change`, `best_rank`, `search_volume`, `keyword_difficulty`, `cpc_usd`, `priority`, `last_observed_at`, `created_at`.

```ts
interface Keyword { keyword_id: Uuid; text: string; normalized_text: string; language_code: string; created_at: Iso }
interface KeywordMetrics {                       // from seo.keyword_metrics_current plus latest snapshot
  source: string; location_id: number; language_code: string; fetched_at: Iso; data_month: Day | null;
  search_volume: MetricValue;                    // unit 'count', is_estimate true, method = provider source
  cpc_usd: Usd | null; competition: number | null; competition_level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  keyword_difficulty: number | null;             // provider metric, doc 09 section 8
  intent_main: string | null; trend_pct_per_month: number | null; is_seasonal: boolean | null;
}
interface KeywordMetricsHistory {
  snapshots: Array<{ snapshot_id: BigId; fetched_at: Iso; data_month: Day | null; search_volume: number | null;
                     monthly_searches: Array<{ year: number; month: number; search_volume: number | null }>;
                     cpc_usd: Usd | null; keyword_difficulty: number | null; is_material_change: boolean }>;
  trend: MetricValue;                            // regression slope / mean, doc 08 section 6
  seasonality: { index_by_month: Array<{ month: number; index: number }>; is_seasonal: boolean; method: string };
}
interface TrackedKeywordCreate {
  keyword: string; location_id?: number; language_code?: string; device?: 'desktop' | 'mobile' | 'both';
  search_engine?: 'google' | 'bing'; os?: 'windows' | 'macos' | 'android' | 'ios' | null;
  depth_profile?: DepthProfile; target_url?: string | null; intent?: Intent; funnel_stage?: FunnelStage;
  priority?: 1 | 2 | 3 | 4 | 5; business_value?: string | null; frequency?: 'daily' | 'weekly' | 'custom'; schedule_id?: Uuid;
  group_ids?: Uuid[]; term_ids?: Uuid[]; competitor_overrides?: { include: Uuid[]; exclude: Uuid[] };
}
type DepthProfile = 'light' | 'standard' | 'deep' | 'full' | 'weekly' | 'weekly_light' | 'until_own_match_100';
type Intent = 'informational' | 'navigational' | 'commercial' | 'transactional' | 'local' | 'unknown';
type FunnelStage = 'tofu' | 'mofu' | 'bofu' | 'retention' | 'unknown';
type TrackedKeywordPatch = Partial<Pick<TrackedKeywordCreate, 'depth_profile' | 'target_url' | 'intent' | 'funnel_stage' | 'priority'
                                  | 'business_value' | 'frequency' | 'schedule_id'>> & { is_active?: boolean; change_reason?: string };
interface TrackedKeyword {
  tracked_keyword_id: Uuid; keyword: Keyword; search_engine: 'google' | 'bing'; location_id: number; language_code: string;
  device: 'desktop' | 'mobile'; os: string | null; config_version: number; depth_profile: DepthProfile; target_url: UrlRef | null;
  intent: Intent; intent_source: 'provider' | 'manual' | 'rule' | null; funnel_stage: FunnelStage; priority: number;
  business_value: string | null; frequency: 'daily' | 'weekly' | 'custom'; schedule_id: Uuid | null;
  source: 'manual' | 'csv_import' | 'api' | 'gsc_import' | 'discovery' | 'bulk_paste'; is_active: boolean;
  created_by: UserRef | null; created_at: Iso; updated_at: Iso;
}
interface TrackedKeywordState {                  // seo.tracked_keyword_state (doc 04 section 7.6)
  current: RankCell; change: RankChange;
  best_rank: number | null; best_rank_at: Iso | null; worst_rank: number | null; first_ranked_at: Iso | null;
  feature_types_present: string[]; owned_feature_types: string[];
  aio: { state: 'absent' | 'present_not_cited' | 'present_cited' | 'not_loaded' | 'unknown'; citation_position: number | null; observation_id: BigId | null };
  target_url_match: boolean | null; url_changed_at: Iso | null;
  consecutive_failures: number; is_stale: boolean; last_observed_at: Iso | null;
}
interface TrackedKeywordRow extends TrackedKeyword {
  state: TrackedKeywordState;
  metrics?: KeywordMetrics;                                  // include=metrics
  competitors?: Array<{ entity: EntityRef; current: RankCell; change: RankChange }>;   // include=competitors
  sparkline?: { depth_mode: 'daily_depth'; points: Array<{ t: Iso; rank: number | null; depth: number; state: RankCell['state'] }> };  // last 30 checks
  groups?: Array<{ group_id: Uuid; name: string; path: string }>;
  terms?: Array<{ term_id: Uuid; vocabulary_kind: string; name: string; path: string }>;
  cannibalization_class?: 'likely_cannibalization' | 'co_ranking' | 'unstable_url' | 'none' | null;
}
interface TrackedKeywordDetail extends TrackedKeywordRow {
  config_history_count: number; competitor_overrides: Array<{ entity_id: Uuid; mode: 'include' | 'exclude' }>;
  linked_prompts: Array<{ prompt_id: Uuid; text: string; link_type: string; is_primary: boolean }>;   // Phase 6+
  schedule: { schedule_id: Uuid; name: string; next_run_at: Iso } | null;
}
```

#### 3.6.2 Keyword groups (Phase 3)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/keyword-groups` | `data:read` | `format?` (`tree`, `flat`) | `{ data: Array<{ group_id, parent_id, name, path, keyword_count, children? }> }` | no | | 3 |
| POST | `{P}/keyword-groups` | `keywords:write` | `{ name, parent_id? }` | `201 One<KeywordGroup>` | no | `409 duplicate` | 3 |
| PATCH | `{P}/keyword-groups/{group_id}` | `keywords:write` | `{ name?, parent_id? }` | `One<KeywordGroup>` | no | `422 cycle_detected` | 3 |
| DELETE | `{P}/keyword-groups/{group_id}` | `keywords:write` | none | `204` (members are unlinked, not deleted; subgroups cascade) | no | | 3 |
| POST | `{P}/keyword-groups/{group_id}/members` | `keywords:write` | `{ tracked_keyword_ids: Uuid[] (max 5,000) }` | `{ data: { added } }` | no | | 3 |
| POST | `{P}/keyword-groups/{group_id}/members/remove` | `keywords:write` | `{ tracked_keyword_ids: Uuid[] }` | `{ data: { removed } }` | no | | 3 |

#### 3.6.3 Keyword imports (Phase 3)

Pipeline per doc 08 section 3.3: upload to R2 (`imports/` prefix), parse and validate per row, normalize, duplicate analysis, preview, confirm, write in batches of 1,000, enqueue metrics fetch, downloadable report. Recorded in `seo.keyword_imports`.

Three ways to supply rows: (a) presigned upload: `POST .../upload-url`, client `PUT`s the file to R2, then `POST .../keyword-imports` with `upload_id`; (b) `multipart/form-data` with parts `file` and `options` (JSON), max 50 MB; (c) JSON body with `rows` (max 10,000) or `paste` text (one keyword per line, optional `<TAB>tags`).

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| POST | `{P}/keyword-imports/upload-url` | `imports:write` | `{ filename, content_type ('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), bytes }` | `201 { upload_id, upload_url, method: 'PUT', required_headers, expires_at }` (15 minutes) | no | `413 payload_too_large` | 3 |
| POST | `{P}/keyword-imports` | `imports:write` | `{ source: 'upload' \| 'paste' \| 'api', upload_id?, paste?, rows?, column_mapping?, defaults?: { location_id, language_code, device, depth_profile, group_path, term_paths, priority } }` or multipart; Idempotency-Key required | `202 One<KeywordImport>` | no | `415 unsupported_media_type`, `422 upload_not_found` | 3 |
| GET | `{P}/keyword-imports` | `data:read` | `filter[status]?` | `Page<KeywordImport>` sorted `-created_at` | cursor | | 3 |
| GET | `{P}/keyword-imports/{import_id}` | `data:read` | none | `One<KeywordImport>` | no | | 3 |
| GET | `{P}/keyword-imports/{import_id}/rows` | `data:read` | `filter[outcome_in]?` (`new`, `duplicate`, `variant`, `conflict`, `invalid`), `filter[action]?` | `Page<ImportRow>` sorted by `row_no` | cursor | `409 invalid_state_transition` (before `preview_ready`) | 3 |
| PATCH | `{P}/keyword-imports/{import_id}` | `imports:write` | `{ column_mapping?, defaults?, row_actions?: Array<{ row_no, action: 'create' \| 'skip' \| 'merge' \| 'force_separate' }> }` | `202 One<KeywordImport>` (re-preview) | no | `409 invalid_state_transition` | 3 |
| POST | `{P}/keyword-imports/{import_id}/confirm` | `imports:write` | `{ duplicate_action: 'skip' \| 'merge_terms' }`; Idempotency-Key required | `202 One<KeywordImport>` status `writing` | no | `409 invalid_state_transition`, `422 quota_exceeded` (per-row reasons in `errors[]`, nothing written) | 3 |
| POST | `{P}/keyword-imports/{import_id}/cancel` | `imports:write` | none | `One<KeywordImport>` | no | `409 invalid_state_transition` (after `writing` started) | 3 |
| GET | `{P}/keyword-imports/{import_id}/report` | `data:read` | none | `{ download_url, expires_at }` signed R2 link valid 24 hours (CSV, one row per input row with outcome and reason) | no | `409 invalid_state_transition` | 3 |

```ts
interface KeywordImport {
  import_id: Uuid; source: 'upload' | 'paste' | 'api'; original_filename: string | null;
  status: 'uploaded' | 'parsing' | 'needs_mapping' | 'preview_ready' | 'writing' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' | 'expired';
  column_mapping: Record<string, string>;          // file header -> field (doc 08 section 3.2)
  counts: { rows_total: number; new: number; duplicate: number; variant: number; conflict: number; invalid: number; created: number; skipped: number; merged: number };
  quota: { limit: number; used: number; would_use: number };
  created_by: UserRef; created_at: Iso; finished_at: Iso | null;
  operation: Operation;                            // kind 'keyword_import'
}
interface ImportRow { row_no: number; raw: Record<string, string>; normalized_text: string | null; device: string | null; location_id: number | null;
                      outcome: 'new' | 'duplicate' | 'variant' | 'conflict' | 'invalid'; reason_code: string | null; reason: string | null;
                      existing_tracked_keyword_id: Uuid | null; action: 'create' | 'skip' | 'merge' | 'force_separate' }
```

Previews expire after 7 days (`status = 'expired'`); the upload stays in R2 under the import retention.

#### 3.6.4 Rank history, SERP snapshots, SERP features (Phase 4)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/rank-history` | `data:read` | `from`, `to` or `window` (default `last_90d`); `entity_ids?` (default own primary plus effective competitors, max 11); `include?` (`absolute`, `url`, `events`); `format?` (`points` default, `columns`) | `One<RankHistory>` (section 4.2) | no | `422 window_too_large` | 4 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/metrics` | `data:read` | `window?` | `One<{ average_rank, median_rank, best_rank, worst_rank, days_in_top_3, days_in_top_10, days_in_top_20, rank_volatility, mean_abs_daily_change, url_stability, unranked_checks: MetricValue }>` (doc 09 section 4) | no | | 5 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/serp-snapshots` | `data:read` | `from?`, `to?`, `filter[depth_requested]?`, `filter[has_ai_overview]?` | `Page<SerpSnapshotSummary>` sorted `-observed_at` | cursor | | 4 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/serp-current` | `data:read` | none | `One<{ serp_snapshot_id, observed_at, results: Array<{ organic_rank, absolute_rank, url: UrlRef, domain: DomainRef, title, snippet, entity: EntityRef \| null }> }>` top 20 from `seo.serp_current_results` | no | | 4 |
| GET | `{P}/serp-snapshots/{serp_snapshot_id}` | `data:read` | `observed_at?` (partition hint); `include?` (`titles`: reads titles and snippets from R2 through the Redis cache) | `One<SerpSnapshotDetail>` | no | `503 raw_unavailable` (titles only; compact facts still returned with `titles_source: 'unavailable'`) | 4 |
| GET | `{P}/serp-snapshots/{serp_snapshot_id}/raw` | `raw:read` | `observed_at?` | Raw provider JSON, decompressed, `Content-Type: application/json`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` | no | `410 raw_expired` (past R2 retention) | 4 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/serp-features` | `data:read` | `from?`, `to?`, `filter[feature_type_in]?`; `limit_checks?` (default 30) | `One<{ checks: Array<{ observed_at, serp_snapshot_id, depth_requested, features: SerpFeature[] }>, presence: Array<{ feature_type, presence_rate: MetricValue, own_ownership_rate: MetricValue }> }>` | no | | 4 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/aio-history` | `data:read` | `from?`, `to?` | `{ data: Array<{ observed_at, serp_snapshot_id, device, location_id, ai_overview_state, own_cited, own_citation_position, competitors_cited: EntityRef[], source_count, organic_rank: RankCell, observation_id }> }` (doc 10 section 5) | no | | 4 |
| GET | `{P}/seo/rank-events` | `data:read` | `from?`, `to?` (timestamps allowed), `filter[event_type_in]?`, `filter[tracked_keyword_id]?`, `filter[entity_id]?`, `filter[group]?`, `filter[term]?` | `Page<RankEvent>` sorted `-occurred_at` | cursor | | 4 |
| POST | `{P}/seo/check-now` | `runs:trigger` | `{ tracked_keyword_ids: Uuid[] (1 to 100), depth?: 10 \| 20 \| 50 \| 100 }` (default: the keyword's daily depth); Idempotency-Key required | `202 One<Run>` (`trigger = 'manual'`, live mode, doc 21 section 11); `status = 'budget_blocked'` when a hard budget would be exceeded | no | `429 manual_run_limit`, `422 quota_exceeded` (`max_serp_checks_per_month`), `503 provider_paused` | 4 |

```ts
interface SerpSnapshotSummary {
  serp_snapshot_id: BigId; observed_at: Iso; observed_date: Day; config_version: number; provider_code: string; provider_endpoint: string;
  se_domain: string | null; location_id: number; language_code: string; device: string; os: string | null;
  depth_requested: number; depth_returned: number; se_results_count: number | null; item_types: string[];
  has_ai_overview: boolean; ai_overview_state: 'absent' | 'present' | 'present_async_loaded' | 'present_not_loaded' | null;
  has_ai_mode_link: boolean | null; served_from_cache: boolean; cost_usd: Usd | null;
  own: RankCell;                                   // from seo.domain_rank_observations for the own entity
}
interface SerpSnapshotDetail extends SerpSnapshotSummary {
  organic: Array<{ organic_rank: number; absolute_rank: number; url: UrlRef; domain: DomainRef;
                   entity: EntityRef | null;       // resolved with the roles valid at observation time
                   title: string | null; snippet: string | null }>;
  titles_source: 'domain_rank_observations' | 'serp_current_results' | 'raw_cache' | 'unavailable';
  features: SerpFeature[];
  ai_overview_observation_id: BigId | null;
  provenance: { raw_payload_id: BigId; parser_version: number; canonicalizer_version: number; provider_task_id: string | null; collection_task_id: BigId | null };
}
interface SerpFeature { feature_type: string; ordinal: number; rank_absolute: number | null; source_urls: UrlRef[];
                        owned_by_project: boolean; owned_position: number | null; competitor_entity_ids: Uuid[]; payload: Record<string, unknown> | null }
interface RankEvent { rank_event_id: BigId; occurred_at: Iso; tracked_keyword_id: Uuid; keyword: string; entity: EntityRef;
                      event_type: string; from_rank: number | null; to_rank: number | null; from_url: UrlRef | null; to_url: UrlRef | null;
                      other_entity: EntityRef | null; serp_snapshot_id: BigId }
```

#### 3.6.5 SEO analytics (Phase 5)

All responses use `MetricValue` (section 2.6). Scope filters shared by every route in this table: `filter[group]`, `filter[term]`, `filter[device]`, `filter[location_id]`, `filter[intent_in]`, `filter[priority_lte]`, `entity_id?` (default own primary). Rollups come from `seo.daily_project_metrics`, `seo.daily_page_metrics` and `seo.cannibalization_flags`.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/seo/metrics/overview` | `data:read` | `date?` (default latest complete), `compare?`, scope filters | `One<{ tiles: Array<MetricValue \| MetricComparison> }>`; tile keys below | no | | 5 |
| GET | `{P}/seo/metrics/distribution` | `data:read` | `date?`, `compare?`, scope filters | `One<{ buckets: Array<{ bucket: '1' \| '2_3' \| '4_10' \| '11_20' \| '21_50' \| '51_100' \| 'beyond', value: MetricValue }>, depth_note: string }>` | no | | 5 |
| GET | `{P}/seo/metrics/visibility-series` | `data:read` | `window`, `granularity`, `variant` (`volume` default, `equal`), `entity_ids?` | `{ data: MetricSeries[] }` one per entity; `is_estimate: true` for `volume` | no | | 5 |
| GET | `{P}/seo/metrics/sov-series` | `data:read` | `window`, `granularity`, `view` (`total_market` default, `among_tracked`), `entity_ids?` | `{ data: MetricSeries[] }` plus an `other_domains` series for `total_market` (doc 09 section 7) | no | | 5 |
| GET | `{P}/seo/metrics/series` | `data:read` | `metric` (any SEO tile key), `window`, `granularity`, `entity_ids?` | `{ data: MetricSeries[] }` | no | | 5 |
| GET | `{P}/seo/metrics/breakdown` | `data:read` | `dimension` (`group`, `term`, `device`, `location`, `intent`), `metrics` (comma list of tile keys), `date?`, `compare?` | `{ data: Array<{ dimension: { type, id, label }, values: MetricValue[] }> }`; topic rows do not sum to the total (stated in `meta.notes`) | no | | 5 |
| GET | `{P}/seo/metrics/features` | `data:read` | `window`, `filter[feature_type_in]?`, `granularity?` | `{ data: Array<{ feature_type, presence_rate: MetricValue, ownership_rate: MetricValue, ownership_by_entity: MetricValue[], series?: MetricSeries }> }` (doc 10 section 4) | no | | 5 |
| GET | `{P}/seo/metrics/volatility` | `data:read` | `window` | `One<{ rank_volatility: MetricValue, url_stability: MetricValue, pixel_displacement: MetricValue, serp_volatility?: MetricValue }>`; `serp_volatility` (RBO, doc 17 section 10) from Phase 14 | no | | 5 |
| GET | `{P}/seo/competitors` | `data:read` | `date?`, `window?`, `compare?` | `{ data: Array<{ entity: EntityRef, average_rank, median_rank, top3, top10, visibility, sov: MetricValue, overtakes, overtaken_by: MetricValue, keywords_ranked: MetricValue }> }` | no | | 5 |
| GET | `{P}/seo/competitor-ranks` | `data:read` | `entity_ids?`, keyword filters as in 3.6.1, `sort?` (`gap`, `own_rank`, `-search_volume`) | `Page<{ tracked_keyword_id, keyword, search_volume, own: RankCell, competitors: Array<{ entity: EntityRef, cell: RankCell }> }>` | cursor | | 5 |
| GET | `{P}/seo/keyword-gap` | `data:read` | `competitor_id`, `segment?` (`only_competitor` default, `competitor_ahead`, `own_ahead`, `only_own`, `neither`), `competitor_rank_lte?` (default 10) | `Page<{ tracked_keyword_id, keyword, search_volume, own: RankCell, competitor: RankCell }>` plus `meta.segment_counts` | cursor | | 5 |
| GET | `{P}/seo/landing-pages` | `data:read` | `date?`, `window?`, `sort?` (`-visibility_contribution` default, `-keywords_ranking`, `average_rank`, `-search_volume`) | `Page<{ url: UrlRef, keywords_ranking, average_rank, top3, top10, search_volume, visibility_contribution, target_coverage: MetricValue }>` | cursor | | 5 |
| GET | `{P}/seo/landing-pages/{url_id}` | `data:read` | `window?` | `One<{ url: UrlRef, metrics: MetricValue[], keywords: Array<{ tracked_keyword_id, keyword, current: RankCell, is_target: boolean }>, rank_trend: MetricSeries }>` | no | | 5 |
| GET | `{P}/seo/cannibalization` | `data:read` | `filter[class_in]?` (default `likely_cannibalization,co_ranking`) | `Page<{ tracked_keyword_id, keyword, class, evidence: CannibalizationEvidence, computed_at, method_version }>` | cursor | | 5 |
| GET | `{P}/tracked-keywords/{tracked_keyword_id}/cannibalization` | `data:read` | none | `One<{ class, evidence: CannibalizationEvidence, hypotheses: string[] }>` (hypotheses labeled, doc 08 section 9.3) | no | | 5 |

SEO tile keys (`metric` values): `seo.keywords_tracked`, `seo.keywords_checked`, `seo.top3_count`, `seo.top10_count`, `seo.top20_count`, `seo.top100_count` (deep checks only), `seo.average_rank`, `seo.median_rank`, `seo.visibility_volume`, `seo.visibility_equal`, `seo.est_clicks`, `seo.share_of_voice`, `seo.improved_count`, `seo.declined_count`, `seo.new_ranking_count`, `seo.lost_ranking_count`, `seo.featured_snippet_ownership`, `seo.aio_presence_rate`, `seo.aio_citation_rate`, `seo.cannibalization_count`, `seo.capped_average_rank` (exports only, doc 09 section 3).

```ts
interface CannibalizationEvidence {
  window_checks: number; distinct_owned_urls: number; url_switch_rate: number; co_ranking_rate: number;
  primary_url: UrlRef; median_rank_primary: number | null; median_rank_other: number | null;
  urls: Array<{ url: UrlRef; checks_ranking: number; median_rank: number | null; first_seen: Iso; last_seen: Iso }>;
}
```

### 3.7 AI (Phases 6 to 9, source intelligence 13, claims 15)

#### 3.7.1 Prompts and versions (Phase 6)

A prompt's text is immutable per version (doc 11 section 2). `PATCH` changes metadata only; new text goes through the versions endpoint. Metadata changes are audit-logged but create no version.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/prompts` | `data:read` | `filter[q]`, `filter[panel]`, `filter[term]`, `filter[intent_in]`, `filter[funnel_stage_in]`, `filter[prompt_type_in]`, `filter[is_branded]`, `filter[importance_lte]`, `filter[is_active]` (default `true`), `filter[language_code]`, `filter[country_iso]`, `filter[source_in]`, `filter[has_keyword_links]`; `sort` (`text`, `importance`, `created_at`, `updated_at`); `include?` (`terms`, `panels`, `links`) | `Page<Prompt>` | cursor | | 6 |
| POST | `{P}/prompts` | `prompts:write` | `PromptCreate` | `201 One<Prompt>`; `meta.lint: LintWarning[]` | no | `409 duplicate` (same normalized text, language, country), `422 quota_exceeded`, `422 prompt_too_long` (per enabled engine, doc 11 section 4), `422 panel_locked` | 6 |
| POST | `{P}/prompts/bulk-create` | `prompts:write` | `{ items: PromptCreate[] (max 1,000), on_duplicate: 'skip' \| 'error' }`; Idempotency-Key required | `{ data: { created: Uuid[], skipped, rejected: Array<{ index, code, message }> }, meta: { lint_summary } }` | no | `422 quota_exceeded` | 6 |
| POST | `{P}/prompts/bulk-update` | `prompts:write` | `{ ids?, filter?, set: { intent?, funnel_stage?, prompt_type?, importance?, expected_frequency?, persona_term_id?, is_branded? } }` | `{ data: { matched, updated } }` | no | | 6 |
| POST | `{P}/prompts/bulk-archive` | `prompts:write` | `{ ids?, filter?, archive: boolean }` (`is_active`) | `{ data: { matched, updated } }`; archiving a core panel member requires `panels:core:modify` | no | `422 panel_locked` | 6 |
| POST | `{P}/prompts/lint` | `data:read` | `{ text, context_preamble?, language_code, engine_codes? }` | `{ data: { is_branded: boolean, matched_aliases: Array<{ entity: EntityRef, alias }>, warnings: LintWarning[] } }` (no persistence) | no | | 6 |
| POST | `{P}/prompts/from-keywords/preview` | `data:read` | `{ tracked_keyword_ids: Uuid[] (max 200), templates?: Array<'recommendation' \| 'comparison' \| 'how_to' \| 'procurement'>, allow_competitor_names?: boolean }` | `{ data: Array<{ tracked_keyword_id, suggestions: Array<{ text, template, prompt_type, near_duplicate_of: Uuid \| null }> }> }` (template generation, doc 11 section 5.3 step 1; no persistence) | no | | 6 |
| GET | `{P}/prompts/{prompt_id}` | `data:read` | none | `One<PromptDetail>` | no | | 6 |
| PATCH | `{P}/prompts/{prompt_id}` | `prompts:write` | `{ intent?, funnel_stage?, prompt_type?, importance?, expected_frequency?, persona_term_id?, is_branded?, is_active?, language_code?, country_iso? }` | `One<Prompt>` | no | `422 immutable_field` (`text`, use versions), `412 precondition_failed` | 6 |
| DELETE | `{P}/prompts/{prompt_id}` | `prompts:write` | none | `204` soft delete; open panel memberships closed with `valid_to = now()` | no | `422 panel_locked` | 6 |
| GET | `{P}/prompts/{prompt_id}/versions` | `data:read` | none | `{ data: PromptVersion[] }` newest first | no | | 6 |
| POST | `{P}/prompts/{prompt_id}/versions` | `prompts:write` (locked core member: `panels:core:modify` unless `change_kind = 'typo'`) | `{ text, context_preamble?, change_kind: 'wording' \| 'typo' \| 'context', change_reason? }`; `If-Match` required | `201 One<PromptVersion>`; `current_version_id` re-pointed; `meta.warnings: ['series_break']` for core members | no | `409 duplicate` (same `text_hash`: use restore), `422 reason_required`, `412 precondition_failed` | 6 |
| POST | `{P}/prompts/{prompt_id}/versions/{version_id}/restore` | same as above | `{ change_reason }`; `If-Match` required | `One<Prompt>` with `current_version_id = version_id` (no new row, doc 11 section 2 rule 3) | no | `409 invalid_state_transition` (already current) | 6 |
| GET | `{P}/prompts/{prompt_id}/timeline` | `data:read` | `from?`, `to?` | `One<{ versions: PromptVersion[], panel_memberships: PanelMembership[], model_changes: Array<{ engine_code, model_reported, first_seen_at }>, version_boundaries: VersionBoundary[] }>` | no | | 6 |

```ts
interface PromptCreate {
  text: string; context_preamble?: string | null; language_code: string; country_iso?: string | null;
  intent?: Intent; funnel_stage?: FunnelStage;
  prompt_type?: 'question' | 'comparison' | 'recommendation' | 'how_to' | 'definition' | 'local' | 'transactional' | 'other';
  importance?: 1 | 2 | 3 | 4 | 5; expected_frequency?: 'daily' | 'weekly' | 'monthly';
  persona_term_id?: Uuid | null; term_ids?: Uuid[]; panel_ids?: Uuid[]; panel_reason?: string;
  is_branded?: boolean;                              // override; default computed from own-brand aliases
  keyword_ids?: Uuid[];                              // creates keyword_prompt_links, link_type 'manual' or 'exact_match'
  generated_from?: { tracked_keyword_id: Uuid; template: string };   // link_type 'generated', creation_method 'template'
}
interface Prompt {
  prompt_id: Uuid; current_version: PromptVersion; language_code: string; country_iso: string | null;
  intent: Intent; funnel_stage: FunnelStage; is_branded: boolean; is_branded_source: 'computed' | 'override';
  prompt_type: string; importance: number; expected_frequency: 'daily' | 'weekly' | 'monthly';
  source: string; creation_method: 'human' | 'template' | 'llm_generated' | 'imported'; persona_term_id: Uuid | null;
  is_active: boolean; created_by: UserRef | null; created_at: Iso; updated_at: Iso;
  terms?: Array<{ term_id: Uuid; vocabulary_kind: string; name: string; path: string }>;
  panels?: Array<{ panel_id: Uuid; name: string; panel_type: string; since: Iso }>;
  links?: Array<{ link_id: Uuid; keyword_id: Uuid; text: string; link_type: string; status: string; is_primary: boolean }>;
}
interface PromptVersion { prompt_version_id: Uuid; version_no: number; text: string; context_preamble: string | null; text_hash: string;
                          change_kind: 'initial' | 'wording' | 'typo' | 'context' | 'restore'; change_reason: string | null;
                          created_by: UserRef | null; created_at: Iso; is_current: boolean }
interface LintWarning { rule: 'contains_brand_alias' | 'leading_wording' | 'multiple_questions' | 'length' | 'engine_limit'
                              | 'language_mismatch' | 'persona_in_question' | 'missing_decision_context';
                        severity: 'info' | 'warning' | 'error'; message: string; span?: { start: number; end: number } }
```

#### 3.7.2 Panels and memberships (Phase 6, sizing Phase 9)

One core panel per project is created with the project and is locked by default. Membership is history (`valid_from`, `valid_to`); window metrics use membership at observation time (doc 16 section 1 rule 8).

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/panels` | `data:read` | `filter[panel_type]?` | `Page<Panel>` | offset | | 6 |
| POST | `{P}/panels` | `prompts:write` | `{ panel_type: 'discovery' \| 'experiment' \| 'custom', name }` | `201 One<Panel>` | no | `409 duplicate`, `422 core_panel_exists` | 6 |
| PATCH | `{P}/panels/{panel_id}` | `prompts:write`; `is_locked` change: `panels:core:modify` | `{ name?, is_locked? }` | `One<Panel>` | no | | 6 |
| DELETE | `{P}/panels/{panel_id}` | `prompts:write` | none | `204` (memberships closed, history kept); core panel cannot be deleted | no | `409 invalid_state_transition` | 6 |
| GET | `{P}/panels/{panel_id}/memberships` | `data:read` | `at?` (timestamp; default now), `include_history?` (all intervals), `filter[prompt_id]?` | `Page<PanelMembership>` | cursor | | 6 |
| POST | `{P}/panels/{panel_id}/memberships` | `prompts:write`; locked panel: `panels:core:modify` | `{ prompt_ids: Uuid[] (max 2,000), reason? }` (reason required for locked panels); `If-Match` required | `{ data: { added, already_member }, meta: { churn_90d: number, churn_warning: boolean } }` (warning above 10% in 90 days, doc 11 section 3) | no | `422 panel_locked`, `422 reason_required`, `422 core_panel_size_limit` (1,500) | 6 |
| POST | `{P}/panels/{panel_id}/memberships/remove` | same as above | `{ prompt_ids, reason? }`; `If-Match` required | `{ data: { removed }, meta: { churn_90d, churn_warning } }` | no | same | 6 |
| GET | `{P}/panels/{panel_id}/sizing` | `data:read` | `engine_code`, `metric?` (`ai.mention_rate` default) | `One<{ prompts: number, measured_flip_rate: MetricValue, detectable_change_weekly: number \| null, method: string, recommendation: string }>` (doc 17 section 7.2) | no | | 9 |
| GET | `{P}/panels/{panel_id}/promotion-candidates` | `data:read` | discovery panels only | `{ data: Array<{ prompt: Prompt, observations_per_engine: Record<string, number>, informative_rate: MetricValue, max_similarity_to_core: number }> }` (doc 11 section 3.1) | no | `422 not_a_discovery_panel` | 9 |

```ts
interface Panel { panel_id: Uuid; panel_type: 'core' | 'discovery' | 'experiment' | 'custom'; name: string; is_locked: boolean;
                  member_count: number; created_at: Iso }
interface PanelMembership { panel_id: Uuid; prompt_id: Uuid; prompt_text: string; valid_from: Iso; valid_to: Iso | null;
                            added_by: UserRef | null; reason: string | null }
```

#### 3.7.3 Prompt candidates inbox (Phase 11)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/prompt-candidates` | `data:read` | `filter[status]` (default `new`), `filter[source_in]`, `filter[language_code]`, `filter[has_near_duplicate]`; `sort` (`-gsc_impressions_28d`, `-ai_demand_estimate`, `-created_at`) | `Page<PromptCandidate>` | cursor | | 11 |
| PATCH | `{P}/prompt-candidates/{candidate_id}` | `prompts:write` | `{ text?, suggested_terms?, suggested_intent?, linked_keyword_ids? }` | `One<PromptCandidate>` | no | `409 invalid_state_transition` | 11 |
| POST | `{P}/prompt-candidates/decide` | `prompts:write`; `add` to a locked core panel: `panels:core:modify` | `{ ids: Uuid[] (max 500), action: 'accept' \| 'reject' \| 'snooze' \| 'add', panel_id?: Uuid (default discovery panel), snooze_days?: number (default 30), reason? }` | `{ data: { updated, prompts_created: Uuid[], rejected: Array<{ id, code }> } }` | no | `422 quota_exceeded`, `422 panel_locked` | 11 |
| POST | `{P}/prompt-candidates/generate` | `prompts:write` | `{ tracked_keyword_ids?: Uuid[], keyword_candidate_ids?: Uuid[], methods: Array<'template' \| 'llm'>, max_per_keyword?: number (1 to 5), persona_term_id? }`; Idempotency-Key required | `202 One<Job>` (`operation.kind = 'prompt_generation'`); LLM variants are budgeted and cost-metered | no | `422 budget_exceeded` | 11 |
| POST | `{P}/prompt-candidates/uploads` | `imports:write` | multipart `file` (CSV of questions, max 5 MB) plus `options` `{ language_code, country_iso?, source: 'faq' \| 'support_ticket' }` | `202 One<Job>`; the file is deleted after 30 days (doc 11 section 5.1) | no | `413 payload_too_large` | 11 |

```ts
interface PromptCandidate { candidate_id: Uuid; text: string; language_code: string; country_iso: string | null; source: string;
                            source_ref: Record<string, unknown>; generation: Record<string, unknown> | null;
                            suggested_terms: Uuid[]; suggested_intent: string | null; linked_keyword_ids: Uuid[];
                            ai_demand_estimate: MetricValue | null;    // is_estimate true, labeled modeled
                            gsc_impressions_28d: number | null; near_duplicate_of: Uuid | null;
                            status: 'new' | 'accepted' | 'rejected' | 'snoozed' | 'added'; decided_by: UserRef | null; decided_at: Iso | null; created_at: Iso }
interface Job { job_id: Uuid; operation: Operation; created_by: Actor; created_at: Iso }   // generic async job record (section 8 item 7)
```

#### 3.7.4 Engines per project (Phase 6)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/engines` | `data:read` | none | `{ data: ProjectEngine[] }` | no | | 6 |
| PUT | `{P}/engines/{engine_code}` | `projects:write` | `{ location_ids: number[], replicates: number (1 to 5 in UI, schema 1 to 20), provider_code, provider_params?: object, is_enabled: boolean }` | `One<ProjectEngine>`; a change of `provider_code` or `provider_params` is recorded as a version boundary (doc 05 section 4) | no | `422 location_not_supported` (not in `core.provider_location_map` for the workload), `422 engine_inactive` | 6 |
| DELETE | `{P}/engines/{engine_code}` | `projects:write` | none | `204`; observations stay | no | | 6 |

```ts
interface ProjectEngine { engine: Engine; location_ids: number[]; replicates: number; provider_code: string;
                          provider_params: Record<string, unknown>; is_enabled: boolean;
                          estimated_monthly_cost_usd: Usd }   // price-book estimate for the current panel sizes
```

#### 3.7.5 AI collection triggers (Phase 7)

AI runs are `ops.collection_runs` rows with workload `ai_prompt` or `ai_mode_keyword`; they are listed and cancelled through the run endpoints in section 3.11.4.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| POST | `{P}/prompts/{prompt_id}/run-now` | `runs:trigger` | `{ engine_codes: string[], location_ids?: number[], replicates?: 1 \| 2 \| 3 }`; Idempotency-Key required | `202 One<Run>` (`trigger = 'manual'`, live endpoints, up to 120 s per engine) | no | `422 engine_not_enabled`, `429 manual_run_limit`, `422 quota_exceeded` (`max_ai_observations_per_month`) | 7 |
| GET | `{P}/runs/{run_id}/ai-coverage` | `data:read` | none | `One<{ by_engine: Array<{ engine_code, planned, observed, valid, invalid_by_status: Record<'partial' \| 'empty' \| 'refused' \| 'error', number>, valid_rate: MetricValue }>, missing: Array<{ prompt_id, engine_code, location_id, replicate_index, task_status }> }>` | no | `422 not_an_ai_run` | 7 |

#### 3.7.6 Observations (Phase 7; extraction fields Phase 8)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/ai/observations` | `data:read` | `from`, `to` (timestamps or dates); `filter[engine_code_in]`, `filter[observation_class]`, `filter[prompt_id]`, `filter[prompt_version_id]`, `filter[tracked_keyword_id]`, `filter[run_id]`, `filter[status_in]`, `filter[is_valid]`, `filter[outcome_in]` (`mentioned_and_cited`, `mentioned_only`, `cited_only`, `neither`), `filter[entity_mentioned]` (entity id), `filter[cited_domain_id]`, `filter[cited_url_id]`, `filter[model_reported]`, `filter[replicate_index]`, `filter[location_id]`, `filter[own_recommended]` | `Page<ObservationSummary>` keyset `(observed_at DESC, id DESC)` | cursor | `422 window_too_large` | 7 |
| GET | `{P}/ai/observations/{observation_id}` | `data:read` | `observed_at?`; `derivation_id?` (default current) | `One<ObservationDetail>` (section 4.3) | no | | 7 |
| GET | `{P}/ai/observations/{observation_id}/raw` | `raw:read` | `observed_at?` | Raw provider JSON, headers as the SERP raw route; HTML fields stay escaped text | no | `410 raw_expired` | 7 |
| GET | `{P}/ai/observations/{observation_id}/derivations` | `data:read` | none | `{ data: Array<{ derivation: Derivation, facts: ObservationFacts, mentions_count, is_current }> }` | no | | 8 |

```ts
interface ObservationSummary {
  observation_id: BigId; observed_at: Iso; observed_date: Day; engine_code: string; observation_class: 'consumer_ui' | 'official_api' | 'serp_ai';
  subject: { type: 'prompt'; prompt_id: Uuid; prompt_version_id: Uuid; version_no: number }
         | { type: 'serp'; serp_snapshot_id: BigId; tracked_keyword_id: Uuid }
         | { type: 'keyword'; tracked_keyword_id: Uuid };               // AI Mode keyword run
  query_text: string; run_id: Uuid | null; replicate_index: number; location_id: number | null; language_code: string | null; device: string | null;
  status: 'complete' | 'partial' | 'empty' | 'refused' | 'error'; model_reported: string | null;
  answer_char_count: number | null; citation_count: number; fanout_count: number; served_from_cache: boolean;
  facts: ObservationFacts | null;                                      // null before extraction (Phase 7) or when no current derivation
}
interface ObservationFacts {                                           // ai.observation_facts, current derivation
  derivation_id: number; is_valid: boolean;
  outcome: 'mentioned_and_cited' | 'mentioned_only' | 'cited_only' | 'neither';   // cross product, never collapsed
  own_mentioned: boolean; own_domain_cited: boolean; own_recommended: boolean | null; own_structured_rank: number | null;
  own_prominence: number | null; own_mention_order: number | null; own_sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  own_citation_count: number; total_citation_count: number; tracked_entities_mentioned: number;
  competitor_mentions: Uuid[]; competitor_cited: Uuid[]; had_structured_list: boolean;
}
interface Derivation { derivation_id: number; extractor_version: number; entity_config_version: number;
                       recommendation_version: number; sentiment_version: number; created_at: Iso }
```

#### 3.7.7 Citations, sources, fan-out (Phase 7 and 9; advanced source intelligence Phase 13)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/ai/citations` | `data:read` | `from`, `to`, `filter[engine_code_in]`, `filter[domain_id]`, `filter[url_id]`, `filter[domain_role_in]`, `filter[role_entity_id]`, `filter[prompt_id]`, `filter[citation_kind_in]`, `filter[referral_tag]` | `Page<CitationRow>` keyset `(observed_at DESC, observation_id DESC, citation_index)` | cursor | `422 window_too_large` | 7 |
| GET | `{P}/ai/sources/domains` | `data:read` | AI scope params (3.7.9); `filter[domain_role_in]`, `filter[category_in]`, `include_engine_internal?` (default false), `include_unresolved_redirects?` (default false); `sort` (`-citation_units` default, `-observations`, `-prompts`, `-trend`) | `Page<SourceDomainRow>` from `ai.daily_domain_citations` | cursor | | 9 |
| GET | `{P}/ai/sources/pages` | `data:read` | as above plus `filter[domain_id]` | `Page<SourcePageRow>` | cursor | | 9 |
| GET | `{P}/ai/fanout-queries` | `data:read` | AI scope params; `group_by` (`query` default, `prompt`); `filter[matched]` (tracked keyword match) | `Page<{ query_text, normalized_text, observations, prompts, engines, matched_keyword: { keyword_id, tracked_keyword_ids, own_rank: RankCell \| null } \| null }>` (F4; `own_rank` F5 from Phase 15) | cursor | `422 engine_has_no_fanout` | 9 |
| GET | `{P}/ai/sources/domains/{domain_id}` | `data:read` | AI scope params | `One<{ domain: DomainRef, publisher: Publisher \| null, role, source_share: MetricValue, series: MetricSeries, top_pages: SourcePageRow[], prompts: Array<{ prompt_id, text, citation_units }>, co_mentioned_entities: Array<{ entity: EntityRef, observations }> }>` | no | | 13 |
| GET | `{P}/ai/sources/categories` | `data:read` | AI scope params | `{ data: Array<{ engine_code, categories: Array<{ category, value: MetricValue }> }> }` (C4) | no | | 13 |
| GET | `{P}/ai/sources/changes` | `data:read` | AI scope params, `kind` (`new` default, `lost`), `min_support?` (default 2) | `Page<{ domain: DomainRef, current_units, previous_units, first_seen_at, last_seen_at }>` (C5, C6) | cursor | | 13 |
| GET | `{P}/ai/sources/diversity` | `data:read` | AI scope params, `granularity?` | `{ data: Array<{ engine_code, distinct_domains: MetricValue, effective_sources: MetricValue, series?: MetricSeries }> }` (C3) | no | | 13 |
| GET | `{P}/ai/sources/competitor-overlap` | `data:read` | AI scope params, `entity_ids?` | `{ data: Array<{ entity: EntityRef, jaccard: MetricValue, shared_domains: DomainRef[] }> }` (C7) | no | | 13 |
| GET | `{P}/ai/sources/retrieved-not-cited` | `data:read` | AI scope params (engines exposing retrieval only), `filter[domain_role_in]` | `Page<{ url: UrlRef, domain: DomainRef, retrieved, cited, retrieved_not_cited_rate: MetricValue }>` (C8) | cursor | `422 engine_has_no_retrieval` | 13 |
| GET | `{P}/ai/sources/influential-pages` | `data:read` | AI scope params, `term_id`, `windows?` (default 4), `min_share?` (default 0.25) | `{ data: Array<{ url: UrlRef, shares: MetricValue[] }> }` (doc 14 section 6) | no | | 13 |
| GET | `{W}/domain-category-overrides` | `data:read` | none | `Page<{ domain: DomainRef, category, set_by: UserRef, set_at }>` | offset | | 13 |
| PUT | `{W}/domain-category-overrides/{domain_id}` | `entities:write` | `{ category }` | `One<...>`; rollups for affected windows are recomputed | no | | 13 |
| DELETE | `{W}/domain-category-overrides/{domain_id}` | `entities:write` | none | `204` | no | | 13 |
| GET | `/api/v1/publishers` | authenticated | `filter[q]`, `filter[registrable_domain]` | `Page<Publisher>` | cursor | | 13 |

```ts
interface CitationRow { observation_id: BigId; observed_at: Iso; engine_code: string; prompt_id: Uuid | null; tracked_keyword_id: Uuid | null;
                        citation_index: number; url: UrlRef; domain: DomainRef; raw_url: string; title: string | null; source_name: string | null;
                        citation_kind: 'inline' | 'source_list' | 'search_result' | 'reference_card' | 'product_card' | 'footnote';
                        first_char_offset: number | null; answer_block_index: number | null; occurrences: number;
                        domain_role: 'own' | 'competitor' | 'third_party'; role_entity: EntityRef | null; referral_tag: string | null }
interface SourceDomainRow { domain: DomainRef; role: 'own' | 'competitor' | 'third_party'; role_entity: EntityRef | null;
                            source_share: MetricValue; citation_units: number; observations: number; prompts: number; engines: string[];
                            trend: MetricComparison; first_seen_at: Iso; last_seen_at: Iso }
interface SourcePageRow { url: UrlRef; title: string | null; role: 'own' | 'competitor' | 'third_party'; citation_units: number;
                          observations: number; prompts: number; engines: string[]; first_seen_at: Iso; last_seen_at: Iso;
                          own_best_rank?: RankCell | null }       // owned pages: best organic rank for linked keywords
interface Publisher { publisher_id: Uuid; name: string; publisher_type: string; parent_publisher_id: Uuid | null; registrable_domains: string[] }
```

#### 3.7.8 Extraction and re-derivation (Phase 8)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/ai/derivations` | `data:read` | none | `{ data: Derivation[], meta: { current_derivation_id, entity_config_version, pending_rederivations } }` | no | | 8 |
| POST | `{P}/ai/extraction/preview` | `data:read` | `{ text?, markdown?, observation_id? }` | `{ data: { mentions: Array<{ entity: EntityRef, mention_count, first_char_offset, mention_order, prominence, structured_rank, structured_list_size, is_recommended, recommendation_method, sentiment, match_method, confidence, evidence_spans: Array<[number, number]>, status: 'accepted' \| 'uncertain' }>, lists: Array<{ list_index, items, qualifies }>, candidates: string[] } }` (stages 3 to 10 with the current config, no LLM stage, no persistence) | no | `413 payload_too_large` | 8 |
| GET | `{P}/ai/rederivations` | `data:read` | `filter[status]?` | `Page<Rederivation>` from `ops.derivation_log` | cursor | | 8 |
| POST | `{P}/ai/rederivations` | `entities:write` | `{ from: Day, to: Day, reason: 'manual' \| 'extractor_upgrade' \| 'alias_changed' }`; Idempotency-Key required | `202 One<Rederivation>` | no | `409 rederivation_running` (overlapping range) | 8 |
| GET | `{P}/ai/rederivations/{derivation_log_id}` | `data:read` | none | `One<Rederivation>` | no | | 8 |

```ts
interface Rederivation { derivation_log_id: BigId; target_table: string; reason: string; scope: { from: Day; to: Day; derivation_id: number };
                         rows_affected: number | null; actor: string; started_at: Iso; finished_at: Iso | null;
                         status: 'running' | 'succeeded' | 'failed'; operation: Operation }
```

#### 3.7.9 AI metrics, Prompt Explorer, statistics drawer (Phase 9; population inference Phase 14)

**AI scope parameters** (shared by every route in this section and by 3.7.7 source routes):

| Parameter | Default | Meaning |
|---|---|---|
| `engine_codes` | project's enabled engines | Comma list. Each engine returns its own values. `422 engine_not_enabled` for others |
| `window`, `from`, `to`, `compare`, `compare_from`, `compare_to`, `granularity` | `last_28d` | Section 2.5 |
| `panel_id` | project core panel | Membership at observation time |
| `subject` | `prompts` | `prompts`, or `keywords` for `google_ai_overview` and keyword-run `google_ai_mode` observations |
| `prompt_ids`, `filter[term]`, `filter[intent_in]`, `filter[funnel_stage_in]`, `filter[prompt_type_in]`, `filter[location_id]`, `filter[language_code]`, `filter[persona_term_id]`, `filter[country_iso]` | none | Scope filters (doc 16 section 3) |
| `include_branded` / `branded_only` | `false` / `false` | Doc 16 section 1 rule 4 |
| `aggregation` | `prompt_weighted` | Or `observation_weighted` |
| `entity_id` / `entity_ids` | own primary | Entity for rates; list for SOV and competitor comparisons |

**Metric keys** (doc 16 sections 4 to 9): `ai.mention_rate`, `ai.citation_rate`, `ai.citation_rate_given_citations`, `ai.mention_and_citation_rate`, `ai.outcome_mix` (returns four values `ai.outcome_mix.mentioned_and_cited`, `.mentioned_only`, `.cited_only`, `.neither` that sum to 1), `ai.recommendation_rate`, `ai.recommended_given_mentioned`, `ai.share_of_voice`, `ai.mention_count_share` (exports and explicit request only, labeled), `ai.citation_share`, `ai.structured_top3_rate`, `ai.structured_top5_rate`, `ai.ranked_list_presence_rate`, `ai.structured_rank` (`stat=median` default or `mean`), `ai.prominence`, `ai.first_mention_rate`, `ai.sentiment` (four values `ai.sentiment.positive`, `.neutral`, `.negative`, `.mixed`), `ai.competitor_gap` (`base_metric` required: `ai.mention_rate`, `ai.citation_rate`, `ai.recommendation_rate`), `ai.source_share` (`domain_id` required), `ai.source_diversity`, `ai.surface_presence_rate` (share of keyword checks with an AI Overview or AI Mode answer; doc 16 section 1 rule 5), `ai.fanout_presence_rate`, `ai.fanout_mean_queries`, `ai.fanout_keyword_coverage`, `ai.fanout_own_top10_share` (Phase 15), `ai.flip_rate`, `ai.citation_jaccard_distance`, `ai.within_run_disagreement` (doc 16 V4 to V6). Fan-out, surface presence and volatility keys are registered in doc 16 section 2.1.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/ai/metrics/overview` | `data:read` | AI scope params | `One<{ engines: Array<{ engine_code, tiles: Array<MetricValue \| MetricComparison> }>, engine_average: MetricValue[] }>`; tiles A1, A2, A3, A4, A5, A7 (own), A8, A9, A11 | no | | 9 |
| GET | `{P}/ai/metrics/{metric}` | `data:read` | AI scope params plus metric-specific params (`base_metric`, `domain_id`, `stat`) | `{ data: Array<MetricValue \| MetricComparison> }` one per engine (and per entity for SOV and gap), plus `.engine_average` entries when more than one engine | no | `404 unknown_metric`, `422 observation_classes_not_poolable` | 9 |
| GET | `{P}/ai/metrics/{metric}/series` | `data:read` | AI scope params, `granularity` (`week` default) | `{ data: MetricSeries[] }` one per engine (per entity for SOV) | no | | 9 |
| GET | `{P}/ai/metrics/{metric}/breakdown` | `data:read` | AI scope params, `dimension` (`topic`, `intent`, `funnel_stage`, `engine`, `country`, `language`, `persona`, `prompt_type`), `vocabulary_id?` (for `topic`, subtree roll-up level `depth?`) | `{ data: Array<{ dimension: { type, id, label }, values: MetricValue[] }> }`; `meta.notes` states that multi-term prompts count in each term | no | | 9 |
| GET | `{P}/ai/competitors` | `data:read` | AI scope params, `entity_ids?` | `{ data: Array<{ entity: EntityRef, by_engine: Array<{ engine_code, mention_rate, recommendation_rate, citation_share, share_of_voice: MetricValue }>, top_sources: DomainRef[] }> }` | no | | 9 |
| GET | `{P}/ai/prompt-explorer` | `data:read` | AI scope params; `sort` (`-mention_rate`, `mention_rate`, `-citation_rate`, `-recommendation_rate`, `-volatility`, `text`, `-importance`) with `sort_engine` (required for metric sorts); `filter[outcome_in]`, `filter[mention_rate_lte]`, `filter[mention_rate_gte]`, `filter[has_competitor_mention]`, `filter[is_stale]` | `Page<PromptExplorerRow>` (section 4.4) | cursor | `409 cursor_stale` | 9 |
| GET | `{P}/ai/prompt-explorer/{prompt_id}` | `data:read` | AI scope params | `One<PromptExplorerDetail>` | no | | 9 |
| GET | `{P}/ai/stats/interval` | `data:read` | AI scope params, `metric`, `method` (`auto` default: Wilson or fixed-panel normal per doc 16 section 13.2; `bootstrap_cluster` for population inference and SOV), `replicates?` (1,000 interactive, 2,000 export) | `One<{ value: MetricValue, inference: 'fixed_panel' \| 'population', warning: string \| null }>`; population mode carries the doc 17 section 2.3 warning | no | `422 method_not_applicable` | 9 (bootstrap and population: 14) |
| GET | `{P}/ai/stats/compare` | `data:read` | AI scope params with a comparison window, `metric`, `design` (`paired` default on the core panel, `unpaired`) | `One<MetricComparison>` per engine (`paired_bootstrap` or McNemar counts; Newcombe for unpaired, labeled) | no | `422 comparison_window_required` | 9 |
| GET | `{P}/ai/stats/movers` | `data:read` | AI scope params with a comparison window, `metric`, `level` (`prompt`, `topic`), `direction?` (`up`, `down`, `both`), `fdr?` (default 0.10) | `Page<{ subject: { type, id, label }, engine_code, comparison: MetricComparison, bh_significant: boolean }>` sorted by effect size (doc 16 section 8, doc 17 section 6.4) | cursor | | 9 |
| GET | `{P}/ai/stats/volatility` | `data:read` | AI scope params, `level` (`panel` default, `prompt`), `prompt_id?` | `One<{ flip_rate: MetricValue, citation_jaccard_distance: MetricValue, within_run_disagreement: MetricValue, ranked_list_rbo_distance?: MetricValue }>` (doc 17 section 8) | no | | 9 |

```ts
interface PromptExplorerDetail {
  prompt: Prompt;
  by_engine: Array<{ engine_code: string; mention_rate: MetricValue; citation_rate: MetricValue; recommendation_rate: MetricValue;
                     outcome_mix: MetricValue[]; structured_rank: MetricValue; prominence: MetricValue; sentiment: MetricValue[];
                     competitors: Array<{ entity: EntityRef; mention_rate: MetricValue; share_of_voice: MetricValue }>;
                     volatility: { flip_rate: MetricValue; citation_jaccard_distance: MetricValue };
                     top_domains: SourceDomainRow[]; top_pages: SourcePageRow[] }>;
  fanout_queries: Array<{ query_text: string; observations: number; matched_keyword_id: Uuid | null }>;
  linked_keywords: Array<{ keyword_id: Uuid; text: string; link_type: string; is_primary: boolean;
                           tracked: Array<{ tracked_keyword_id: Uuid; device: string; location_id: number; current: RankCell; aio_state: string }> }>;
  timeline: { versions: PromptVersion[]; panel_memberships: PanelMembership[]; version_boundaries: VersionBoundary[] };
  latest_observations: ObservationSummary[];          // 10 newest; full list via /ai/observations?filter[prompt_id]=
}
```

#### 3.7.10 Claims (reserved schema, Phase 15)

`ai.claims` and `ai.claim_occurrences` exist in doc 04 section 8.6 but are not populated before Phase 15. The routes below are registered only when the `claims` feature flag is on; before that they return `404 not_found` and are absent from the published OpenAPI document.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/ai/claims` | `data:read` | `filter[entity_id]`, `filter[claim_type_in]`, `filter[polarity_in]`, `filter[status_in]`; `sort` (`-occurrence_count`, `-last_seen_at`) | `Page<{ claim_id, entity: EntityRef, claim_text, claim_type, polarity, first_seen_at, last_seen_at, occurrence_count, status, contradicts_claim_id }>` | cursor | | 15 |
| GET | `{P}/ai/claims/{claim_id}` | `data:read` | none | `One<{ claim, occurrences: Array<{ observation_id, observed_at, engine_code, evidence_span: [number, number], excerpt, supporting_citation: CitationRow \| null, confidence }> }>` | no | | 15 |
| PATCH | `{P}/ai/claims/{claim_id}` | `entities:write` | `{ status: 'unreviewed' \| 'accurate' \| 'inaccurate' \| 'outdated' \| 'disputed' }` | `One<Claim>`; audit-logged | no | | 15 |

### 3.8 Cross-channel (links Phase 6; matrix and pages 10a; 10b; diagnostics 15)

Keywords and prompts stay separate objects joined by `core.keyword_prompt_links` (doc 15 section 1). Only `active` links feed the matrix.

#### 3.8.1 Keyword to prompt links

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/keyword-prompt-links` | `data:read` | `filter[status_in]` (default `active,suggested`), `filter[link_type_in]`, `filter[keyword_id]`, `filter[prompt_id]`, `filter[confidence_gte]` | `Page<KeywordPromptLink>` | cursor | | 6 |
| POST | `{P}/keyword-prompt-links` | `prompts:write` | `{ keyword_id, prompt_id, is_primary? }` (`link_type = 'manual'`, `status = 'active'`) | `201 One<KeywordPromptLink>` | no | `409 duplicate` | 6 |
| PATCH | `{P}/keyword-prompt-links/{link_id}` | `prompts:write` | `{ is_primary?, status?: 'active' \| 'rejected' }`; setting `is_primary` clears the prompt's previous primary | `One<KeywordPromptLink>` | no | | 6 |
| DELETE | `{P}/keyword-prompt-links/{link_id}` | `prompts:write` | none | `204` | no | | 6 |
| POST | `{P}/keyword-prompt-links/decide` | `prompts:write` | `{ ids: Uuid[] (max 1,000), action: 'accept' \| 'reject' }` | `{ data: { updated } }` | no | | 10a |
| POST | `{P}/keyword-prompt-links/suggest` | `prompts:write` | `{ methods: Array<'cluster' \| 'semantic' \| 'fanout' \| 'ai_suggestion'>, prompt_ids?: Uuid[] }` (`ai_suggestion` from Phase 11, budgeted); Idempotency-Key required | `202 One<Job>` (`operation.kind = 'link_suggestion'`); results appear as `status = 'suggested'` | no | | 10a |

```ts
interface KeywordPromptLink { link_id: Uuid; keyword: Keyword; prompt: { prompt_id: Uuid; text: string };
                              link_type: 'exact_match' | 'manual' | 'generated' | 'semantic' | 'cluster' | 'ai_suggestion' | 'fanout';
                              confidence: number | null; is_primary: boolean; status: 'suggested' | 'active' | 'rejected';
                              method_version: number | null; created_by: UserRef | null; created_at: Iso }
```

#### 3.8.2 SEO and AI matrix, page intelligence, analyses

Matrix parameters (defaults from `ProjectSettingsV1.matrix`, doc 15 section 4.1): `location_id` (required), `device` (required), `window` (default `last_28d`), `ai_axis` (`mention_rate` default, `citation_rate`, `recommendation_rate`), `engine_codes` (default `chatgpt_web,gemini_web,google_ai_overview`), `seo_strong_lte` (10), `seo_weak_gt` (20), `ai_strong_gte` (0.5), `ai_weak_lte` (0.1), `min_observations` (4), plus keyword filters from 3.6.1. The resolved thresholds and AI axis definition are echoed in `meta.definition` so the UI can print them on the matrix.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/xch/matrix` | `data:read` | matrix params | `One<{ quadrants: Array<{ seo: 'strong' \| 'weak', ai: 'strong' \| 'weak', keywords: number, search_volume: number }>, near_threshold: number, insufficient: { seo: number, ai: number }, not_tracked_in_location: number, definition: MatrixDefinition }>` | no | | 10a |
| GET | `{P}/xch/matrix/rows` | `data:read` | matrix params, `filter[quadrant]` (`seo_strong_ai_strong`, `seo_strong_ai_weak`, `seo_weak_ai_strong`, `seo_weak_ai_weak`, `near_threshold`, `insufficient`), `sort` (`-search_volume` default, `organic_rank`, `ai_presence`) | `Page<MatrixRow>` (section 4.5) from `core.xch_keyword_weekly` plus the current week on demand | cursor | | 10a |
| GET | `{P}/xch/aio-citation-by-rank` | `data:read` | `window`, `device?`, `location_id?`, keyword filters, `include_keywords_for_bucket?` | `{ data: Array<{ bucket: '1' \| '2_3' \| '4_10' \| '11_20' \| '21_100' \| 'beyond', citation_rate: MetricValue }>, keywords?: Array<{ tracked_keyword_id, keyword, organic_rank: RankCell, cited_in_aio: boolean, competitors_cited: EntityRef[] }> }`; Wilson intervals (doc 15 section 5) | no | | 10a |
| GET | `{P}/pages` | `data:read` | `scope` (`owned` default, `third_party`), `window`, `sort` (`-citation_units`, `-keywords_ranking`, `-visibility_contribution`, `-gsc_clicks`), `filter[domain_id]`, `filter[term]` | `Page<PageRow>` | cursor | | 10a |
| GET | `{P}/pages/{url_id}` | `data:read` | `window`, `engine_codes?` | `One<PageIntelligence>`: sections `seo`, `ai_overview`, `ai_engines`, `mentions_associated`, `first_party` (Phase 12; each block with its own source label), each built from `MetricValue`s (doc 15 section 6) | no | | 10a |
| GET | `{P}/pages/{url_id}/series` | `data:read` | `window`, `granularity` (`week` default), `channels` (`seo`, `aio`, `chatgpt_web`, `gemini_web`, `google_ai_mode`, `gsc`, `ga4_ai_referrals`) | `{ data: Array<{ channel, series: MetricSeries }> }`; separate axes, never summed | no | | 10a |
| GET | `{P}/pages/insights` | `data:read` | `kind` (`ranks_not_cited`, `cited_weak_rank` in 10a; `third_party_influential_not_ranking` from Phase 13), `window`, `min_topic_observations?` (default 20) | `Page<{ url: UrlRef, keywords: Array<{ tracked_keyword_id, keyword, current: RankCell }>, citation_units, engines, topics }>` (doc 15 section 5) | cursor | | 10a |
| GET | `{P}/xch/matrix/clusters` | `data:read` | `vocabulary_id` (kind `topic` or `cluster`), `window`, `engine_codes`, `seo_strong_gte` (0.30), `seo_weak_lte` (0.05), `ai_strong_gte`, `ai_weak_lte` | `{ data: Array<{ term: Term, seo_visibility: MetricValue, ai_presence: MetricValue[], quadrant, keywords, prompts }> }` (doc 15 section 4.3) | no | | 10b |
| GET | `{P}/xch/competitors` | `data:read` | `window`, `engine_codes?`, `entity_ids?` | `{ data: Array<{ entity: EntityRef, seo_sov: MetricValue, seo_visibility: MetricValue, keyword_gap_counts: Record<string, number>, ai_sov: MetricValue[], recommendation_rate: MetricValue[], citation_share: MetricValue[], top_co_occurring_sources: DomainRef[], beats_own_in_both: number }> }` (doc 15 section 9) | no | | 10b |
| GET | `{P}/xch/domain-dominance` | `data:read` | `window`, `engine_codes`, `top_n?` (default 50) | `One<{ domains: Array<{ domain: DomainRef, seo_sov: MetricValue, ai_source_share: MetricValue[] }>, spearman: Array<{ engine_code, rho: number, n: number }>, top20_jaccard: Array<{ engine_code, value: number }> }>` | no | | 10b |
| GET | `{P}/xch/rank-citation-association` | `data:read` | `window` (min 8 weeks), `engine_code` (one per call, never pooled) | `One<{ groups: Array<{ group: 'improved' \| 'stable' \| 'declined', keyword_weeks: number, mean_delta_citation_next: MetricValue }>, within_keyword_spearman: MetricValue, caveats: string[] }>` (doc 15 section 5.1; `ci.method = 'bootstrap_cluster'`) | no | `422 window_too_small` | 10b |

```ts
interface MatrixDefinition { location_id: number; device: string; window: { from: Day; to: Day; timezone: string };
                             ai_axis: 'mention_rate' | 'citation_rate' | 'recommendation_rate'; engines: string[];
                             ai_presence_method: string;   // e.g. 'Equal-weight average of own mention rate on chatgpt_web, gemini_web, google_ai_overview (conditional on AIO present)'
                             thresholds: { seo_strong_lte: number; seo_weak_gt: number; ai_strong_gte: number; ai_weak_lte: number; min_observations: number } }
interface PageRow { url: UrlRef; role: 'own' | 'competitor' | 'third_party'; keywords_ranking: number; average_rank: MetricValue;
                    visibility_contribution: MetricValue; aio_citations: number; citation_units_by_engine: Record<string, number>;
                    retrieved_not_cited: number | null; gsc_clicks?: MetricValue; gsc_impressions?: MetricValue }
```

#### 3.8.3 Diagnostics and opportunities

Diagnostics return **evidence** and **hypotheses** as separate blocks. Hypotheses are rule-generated, each with `evidence_refs` pointing to the evidence items that triggered it; there is never a single causal sentence (doc 15 sections 7 and 8).

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/opportunities/keywords-to-prompts` | `data:read` | `window`, `min_aio_presence?` (0.5), `intent_in?` (default `commercial,transactional`) | `Page<{ tracked_keyword_id, keyword, search_volume, intent, aio_presence_rate: MetricValue, active_linked_prompts: 0 }>` (doc 15 section 5) | cursor | | 10b |
| POST | `{P}/opportunities/keywords-to-prompts/send-to-inbox` | `prompts:write` | `{ tracked_keyword_ids: Uuid[] (max 500), methods: Array<'template' \| 'llm'> }`; Idempotency-Key required | `202 One<Job>` (creates prompt candidates) | no | | 10b |
| GET | `{P}/opportunities/ai-first` | `data:read` | `window`, `engine_codes`, `kd_lte?` (30), `competitor_rate_gte?` (0.3), `own_rate_lte?` (0.1) | `Page<{ prompt_id, text, linked_keywords: Array<{ keyword_id, text, keyword_difficulty, search_volume }>, competitor_mention_rate: MetricValue, own_mention_rate: MetricValue }>` labeled "AI-first opportunities" | cursor | | 10b |
| GET | `{P}/opportunities/publishers` | `data:read` | `window`, `term_id?`, `engine_codes`, `min_reach?` (3) | `Page<{ domain: DomainRef, publisher: Publisher \| null, reach: number, opportunity: number, score: number, competitors_mentioned: EntityRef[], sample_observation_ids: BigId[], cited_titles: string[] }>` (doc 14 section 7; wording "Sources frequently cited in answers that mention competitors but not you") | cursor | | 13 |
| GET | `{P}/diagnostics/keywords/{tracked_keyword_id}` | `data:read` | `window` (default `last_90d`), `compare_days?` (30) | `One<KeywordDiagnostic>` | no | | 15 |
| GET | `{P}/diagnostics/prompts/{prompt_id}` | `data:read` | `window`, `engine_codes` | `One<PromptDiagnostic>` | no | | 15 |

```ts
interface EvidenceItem { evidence_id: string; kind: string; title: string; data: unknown; links: Record<string, string> }
interface Hypothesis { code: string; text: string; evidence_refs: string[]; label: 'hypothesis' }
interface KeywordDiagnostic {
  evidence: { rank_history: EvidenceItem; ranking_url_history: EvidenceItem; competitors_above: EvidenceItem; serp_composition: EvidenceItem;
              ai_overview: EvidenceItem; cannibalization: EvidenceItem; gsc?: EvidenceItem; linked_prompts: EvidenceItem; demand: EvidenceItem };
  hypotheses: Hypothesis[];      // codes: layout_change, ranking_url_changed, competitor_improved, demand_decreased, collection_anomaly
}
interface PromptDiagnostic {
  evidence: { rate_trends: EvidenceItem; competitor_rates: EvidenceItem; sources_now_vs_before: EvidenceItem; own_pages_lost: EvidenceItem;
              fanout: EvidenceItem; linked_keywords: EvidenceItem; model_changes: EvidenceItem; answer_examples: EvidenceItem };
  hypotheses: Hypothesis[];      // codes: own_source_lost, fanout_weak_rank, new_competitor_source, model_changed, within_normal_variation
}
```

### 3.9 Discovery (Phase 11)

Candidates land in an inbox; nothing is tracked or paid for daily until promoted (doc 08 section 5).

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/keyword-candidates` | `data:read` | `filter[status]` (default `new`), `filter[source_in]`, `filter[intent_in]`, `filter[search_volume_gte]`, `filter[keyword_difficulty_lte]`, `filter[location_id]`, `filter[language_code]`; `sort` (`-opportunity_score` default, `-search_volume`, `-gsc_impressions_28d`, `keyword_difficulty`, `-first_seen_at`) | `Page<KeywordCandidate>` | cursor | | 11 |
| POST | `{P}/keyword-candidates/decide` | `keywords:write` | `{ ids: Uuid[] (max 1,000), action: 'accept' \| 'reject' \| 'snooze' \| 'unsnooze', snooze_days?: number (default 30) }` | `{ data: { updated } }` | no | | 11 |
| POST | `{P}/keyword-candidates/promote` | `keywords:write` | `{ ids: Uuid[] (max 1,000), device: 'desktop' \| 'mobile' \| 'both', location_id?, depth_profile?, group_ids?, term_ids?, intent?, priority? }`; Idempotency-Key required | `{ data: { tracked_keyword_ids: Uuid[], skipped: Array<{ id, code }> } }`; status `tracked`; metrics fetch queued | no | `422 quota_exceeded` (nothing written) | 11 |
| POST | `{P}/keyword-candidates/create-prompts` | `prompts:write` | `{ ids: Uuid[] (max 500), methods: Array<'template' \| 'llm'> }`; Idempotency-Key required | `202 One<Job>` (prompt candidates, doc 11 section 5.3) | no | | 11 |
| POST | `{P}/keyword-candidates/uploads` | `imports:write` | multipart `file` (CSV, one keyword per row, max 5 MB) plus `options` `{ location_id, language_code }` | `202 One<Job>` (`source = 'manual'`) | no | | 11 |
| GET | `{P}/discovery-jobs` | `data:read` | `filter[status]?` | `Page<Run>` (workload `discovery`) | cursor | | 11 |
| POST | `{P}/discovery-jobs` | `runs:trigger` | `DiscoveryJobCreate`; Idempotency-Key required | `202 One<Run>` with `estimated_cost_usd`; `budget_blocked` when over budget | no | `429 manual_run_limit` | 11 |
| GET | `{P}/discovery-jobs/{run_id}` | `data:read` | none | `One<Run & { candidates_created: number, candidates_updated: number }>` | no | | 11 |
| POST | `{P}/keyword-clusters/compute` | `taxonomy:write` | `{ min_overlap?: number (default 4 of top 10), group?: Uuid }`; Idempotency-Key required | `202 One<Job>`; writes `cluster` terms with `source = 'auto_cluster'` (doc 08 section 2); no provider calls | no | | 11 |
| GET | `{P}/keyword-clusters` | `data:read` | `filter[source]?` (default `auto_cluster`) | `{ data: Array<{ term: Term, keywords: Array<{ tracked_keyword_id, keyword }>, mean_overlap: number }> }`; rename, merge and break through taxonomy routes | no | | 11 |

```ts
interface KeywordCandidate {
  candidate_id: Uuid; text: string; language_code: string; location_id: number; sources: string[]; source_details: Record<string, unknown>;
  search_volume: MetricValue | null; keyword_difficulty: number | null; cpc_usd: Usd | null; intent: string | null;
  ai_demand_estimate: MetricValue | null;              // is_estimate true, "Modeled AI demand"
  gsc_impressions_28d: number | null; gsc_avg_position: number | null; competitor_best_rank: number | null;
  opportunity: { score: number; components: { volume_term: number; intent_weight: number; kd_term: number; gap_bonus: number; gsc_bonus: number } };
  status: 'new' | 'accepted' | 'rejected' | 'snoozed' | 'tracked'; snoozed_until: Iso | null; data_as_of: Day; first_seen_at: Iso;
}
interface DiscoveryJobCreate {
  sources: Array<'labs_keyword_ideas' | 'labs_keyword_suggestions' | 'labs_related' | 'autocomplete' | 'competitor_ranked'
                 | 'domain_intersection' | 'paa' | 'related_searches' | 'gsc' | 'fanout'>;
  seeds?: string[]; competitor_entity_ids?: Uuid[]; location_id?: number; language_code?: string;
  limits: { max_items: number; max_cost_usd: string };      // hard cap checked against the price-book estimate
}
```

### 3.10 First-party integrations (GSC basic Phase 11; full Phase 12; logs V1.5)

A **connection** is one credential grant; an **integration** is one property on a connection (doc 18 section 3.1). Only `owner` and `admin` connect or disconnect (`integrations:manage`), and both actions are audit-logged.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| POST | `{P}/integrations/{kind}/authorize` | `integrations:manage` fresh, session only | `kind` in `gsc`, `ga4`, `bing_wmt`; body `{ return_to? }` | `{ authorization_url, state_expires_at }`; state and PKCE verifier stored in Redis for 10 minutes, bound to session, workspace and project | no | | 11 |
| GET | `/api/v1/oauth/{provider}/callback` | public (state must match the caller's session) | `code`, `state`; `provider` in `google`, `bing` | `302` to `https://<domain>/.../integrations/select?connection_id=...`; creates or updates `fp.connections`, stores the refresh token in `ops.secrets` | no | `400 invalid_state` (redirect with error), `409 scope_denied` | 11 |
| GET | `{W}/connections` | `integrations:manage` | `filter[product]?`, `filter[status]?` | `Page<Connection>` | offset | | 11 |
| POST | `{W}/connections` | `integrations:manage` fresh, session only | `{ product: 'cloudflare', api_token }` or `{ product: 'bing_wmt', api_key }` | `201 One<Connection>`; token validated (Cloudflare `settings` node, Bing `GetUserSites`) | no | `422 credential_invalid` | 12 |
| GET | `{W}/connections/{connection_id}/properties` | `integrations:manage` | none | `{ data: Array<{ external_property, label, property_type, permission_level, is_selectable, suggested_project_id, overlap_warning }> }` | no | `409 integration_reauth_required` | 11 |
| POST | `{W}/connections/{connection_id}/reauthorize` | `integrations:manage` fresh, session only | `{ return_to? }` | `{ authorization_url, state_expires_at }` | no | `422 not_oauth` | 11 |
| DELETE | `{W}/connections/{connection_id}` | `integrations:manage` fresh | `delete_imported_data?` (query, default `false`) | `202 One<Connection>` status `revoked`; token revoked at provider, secret destroyed, schedules disabled; data purge job when requested | no | | 11 |
| GET | `{P}/integrations` | `data:read` | none | `Page<Integration>` | offset | | 11 |
| POST | `{P}/integrations` | `integrations:manage` | `{ connection_id, kind, external_property, backfill?: { months: 1 to 16, search_types?: string[] }, settings?: { hourly?: boolean } }`; Idempotency-Key required | `201 One<Integration>` with `backfill_run` link (202 semantics for the backfill) | no | `409 duplicate` (property already connected in the workspace, FP-Q4), `422 property_not_accessible` | 11 |
| GET | `{P}/integrations/{integration_id}` | `data:read` | none | `One<Integration>` with `backfill_state` progress per type | no | | 11 |
| PATCH | `{P}/integrations/{integration_id}` | `integrations:manage` | `{ status?: 'active' \| 'disabled', settings? }` | `One<Integration>` | no | `409 integration_reauth_required` | 11 |
| DELETE | `{P}/integrations/{integration_id}` | `integrations:manage` fresh | `delete_data?` (query) | `204`, or `202` with a purge job when `delete_data=true` | no | | 11 |
| POST | `{P}/integrations/{integration_id}/sync` | `integrations:manage` | `{ from: Day, to: Day, mode: 'incremental' \| 'resync_final' }`; Idempotency-Key required | `202 One<Run>` (`trigger = 'manual'` or `backfill`) | no | `409 integration_reauth_required` | 11 |
| POST | `{P}/fp-imports/upload-url` | `imports:write` | `{ filename, content_type, bytes }` | `201 { upload_id, upload_url, expires_at }` | no | `413 payload_too_large` (50 MB) | 12 |
| POST | `{P}/fp-imports` | `imports:write` | multipart (`file` plus `options`) or `{ upload_id, options }`; `options = { report_kind: 'gsc_genai_search' \| 'gsc_genai_discover' \| 'bing_ai_performance' \| 'server_log', external_property, report_view, period_start, period_end, filters }`; Idempotency-Key required | `202 One<FileImport>` | no | `409 duplicate` (same `file_sha256`: returns the existing import), `422 grain_not_daily` | 12 |
| GET | `{P}/fp-imports` | `data:read` | `filter[report_kind]`, `filter[status_in]` | `Page<FileImport>` | cursor | | 12 |
| GET | `{P}/fp-imports/{import_id}` | `data:read` | none | `One<FileImport>` with `validation_report` and a 20-row preview when `needs_mapping` | no | | 12 |
| POST | `{P}/fp-imports/{import_id}/mapping` | `imports:write` | `{ column_mapping, filters? }` | `202 One<FileImport>` | no | `409 invalid_state_transition` | 12 |
| DELETE | `{P}/fp-imports/{import_id}` | `imports:write` | none | `202`; status `deleted`, rows removed, R2 evidence deleted | no | | 12 |
| POST | `/api/v1/ingest/logs` | `fp:logs:write` (API key only) | `Content-Type: application/x-ndjson`, optionally `Content-Encoding: gzip`; header `X-Integration-Id`; max 10 MB per batch | `202 { file_import_id, lines_received }` | no | `413 payload_too_large` | V1.5 |

First-party metrics (doc 18 section 11.4). Every value is a `MetricValue` with `observation_class: 'first_party'`, `is_estimate: false`, `source`, `data_origin`, `data_state`, `coverage`. They are never combined with synthetic metrics in one value.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/fp/metrics/{metric}` | `data:read` | `metric` in `fp.gsc_clicks`, `fp.gsc_impressions`, `fp.gsc_ctr`, `fp.gsc_avg_position`, `fp.gsc_hidden_query_share`, `fp.gsc_genai_impressions`, `fp.bing_ai_citations`, `fp.bing_ai_cited_pages`, `fp.bing_ai_citation_share`, `fp.ai_referral_sessions`, `fp.ai_referral_key_events`, `fp.ai_crawl_requests`, `fp.ai_user_fetches`; `window`, `integration_id?`, `search_type?` (default `web`), `filter[url_id]`, `filter[query_hash]`, `filter[country_iso3]`, `filter[device]`, `classifier?` (`both` default), `filter_hash?` (required for imported Bing and gen AI metrics when several filters exist) | `{ data: MetricValue[] }` (two values for `classifier=both`) | no | `422 filter_hash_required`; GSC position with fewer than 20 impressions returns `value: null` with `suppressed_reason: 'below_min_impressions'` (doc 18 section 10) | 12 |
| GET | `{P}/fp/metrics/{metric}/series` | `data:read` | as above plus `granularity` | `{ data: MetricSeries[] }`; provisional days flagged per point (`is_partial`) | no | | 12 |
| GET | `{P}/fp/gsc/queries` | `data:read` | `window`, `integration_id?`, `filter[matched]`, `filter[q]`, `sort` (`-clicks`, `-impressions`, `avg_position`) | `Page<{ query_hash, query_text, clicks, impressions, ctr: MetricValue, avg_position: MetricValue, matched_keywords: Array<{ keyword_id, tracked_keyword_ids }> }>` | cursor | | 11 |
| GET | `{P}/fp/gsc/pages` | `data:read` | `window`, `search_type?`, `sort` | `Page<{ url: UrlRef, clicks, impressions, ctr: MetricValue, avg_position: MetricValue, data_state }>` from `fp.gsc_page_daily` (page totals include anonymized queries) | cursor | | 12 |
| GET | `{P}/fp/ai-referrals` | `data:read` | `window`, `group_by` (`assistant`, `landing_page`, `origin`), `classifier` (`both` default) | `{ data: Array<{ key, ga4_ai_assistant_channel: MetricValue \| null, own_rules: MetricValue \| null, difference: number \| null }>, meta: { rules_version, notes } }` (doc 18 section 7.3) | no | | 12 |
| GET | `{P}/fp/ai-crawlers` | `data:read` | `window`, `group_by` (`bot`, `bot_class`, `path`, `status_class`), `origin` (`cloudflare`, `server_logs`) | `{ data: Array<{ key, requests: MetricValue, verification_mix?: Record<'verified' \| 'unverified' \| 'spoofed', number> }>, meta: { label: 'claimed user agent' \| 'verification mix', gaps: Day[] } }` | no | | 12 |
| GET | `{P}/fp/bing-ai` | `data:read` | `report_view`, `filter_hash?`, `window?` | `One<{ filters: Record<string, unknown>, rows: unknown[], badge: 'sampled_by_bing' }>`; rows with different `filter_hash` never merged | no | | 12 |
| GET | `{P}/fp/genai-impressions` | `data:read` | `surface` (`search`, `discover`), `view` (`dates`, `pages`, `countries`, `devices`), `filter_hash?` | `One<{ filters, rows, note: 'Impressions only; imported file; already inside Web totals' }>` | no | | 12 |
| GET | `/api/v1/fp/referrer-rules` | authenticated | `rule_set_version?` (default latest) | `{ data: Array<{ rule_id, match_field, match_type, pattern, assistant_code, operator, confidence }>, meta: { rule_set_version } }` | no | | 12 |
| GET | `/api/v1/fp/bot-registry` | authenticated | none | `{ data: Array<{ bot_code, ua_token, operator, bot_class, honors_robots, registry_version }> }` | no | | 12 |

```ts
interface Connection { connection_id: Uuid; product: 'gsc' | 'ga4' | 'bing_wmt' | 'cloudflare'; auth_method: 'oauth' | 'api_key' | 'api_token' | 'service_account';
                       subject_label: string | null; scopes: string[]; status: 'active' | 'reauth_required' | 'revoked' | 'error';
                       connected_by: UserRef | null; connected_at: Iso; last_refresh_at: Iso | null; last_error_code: string | null; integration_count: number }
interface Integration { integration_id: Uuid; connection_id: Uuid | null; kind: 'gsc' | 'bing_wmt' | 'ga4' | 'cloudflare' | 'server_logs';
                        external_property: string; status: 'active' | 'reauth_required' | 'disabled' | 'error'; last_success_at: Iso | null;
                        last_error: string | null; backfill_state: Record<string, unknown>; sync_paused_since: Iso | null; created_at: Iso }
interface FileImport { import_id: Uuid; report_kind: string; origin: 'upload' | 'logpush' | 'agent' | 'api'; external_property: string;
                       report_view: string | null; period_start: Day | null; period_end: Day | null; filters: Record<string, unknown>;
                       filter_hash: string; filter_source: 'file_metadata' | 'user_declared' | 'both_matched' | 'not_applicable';
                       original_filename: string | null; file_format: string; bytes: number; parser_version: number;
                       status: 'uploaded' | 'needs_mapping' | 'validating' | 'imported' | 'rejected' | 'superseded' | 'deleted';
                       rows_total: number | null; rows_imported: number | null; rows_rejected: number | null; is_truncated: boolean;
                       validation_report: Record<string, unknown>; superseded_by: Uuid | null; uploaded_by: UserRef | null;
                       uploaded_at: Iso; imported_at: Iso | null; operation: Operation }
```

### 3.11 Operations

#### 3.11.1 Providers and price book

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/providers` | `providers:manage` | none | `{ data: Array<{ provider_code, label, kind, status: 'active' \| 'paused' \| 'degraded', paused_reason, error_rate_1h: MetricValue, outstanding_tasks, last_success_at }> }` | no | | 4 |
| GET | `{W}/providers/{provider_code}/balance` | `providers:manage` | none | `One<{ balance_usd: Usd, trailing_14d_spend_usd: Usd, days_remaining: number \| null, checked_at: Iso, account: 'platform' \| 'workspace' }>` (doc 21 section 10 `balance_check`) | no | `422 balance_not_supported` | 4 |
| POST | `{W}/providers/{provider_code}/pause` | `providers:manage` | `{ reason }` | `One<ProviderStatus>`; tasks stay `pending` (doc 21 section 6) | no | | 4 |
| POST | `{W}/providers/{provider_code}/resume` | `providers:manage` | none | `One<ProviderStatus>` | no | | 4 |
| GET | `{W}/price-book` | `costs:read` | `filter[provider_code]`, `filter[endpoint]`, `valid_at?` (default today) | `Page<{ price_id, provider_code, endpoint, price_unit, unit_price_usd: Usd, conditions, valid_from, valid_to, source_url, verified_at }>`; estimates only (doc 04 section 11.1) | offset | | 3 |

Bring-your-own provider credentials per workspace are post-MVP (doc 05 section 4) and not in this catalog.

#### 3.11.2 Costs and budgets

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/costs` | `costs:read` | `from`, `to`, `group_by` (comma list of `project`, `workload`, `provider`, `endpoint`, `engine`, `day`, `channel`), `filter[project_id]`, `filter[workload_in]`, `filter[provider_code]` | `{ data: Array<{ keys: Record<string, string>, cost_usd: Usd, request_count: number, subjects: number }>, meta: { total_cost_usd, cost_sources: Record<'provider_reported' \| 'computed_from_tokens' \| 'price_book_estimate', Usd> } }` from `ops.cost_daily` | no | | 3 |
| GET | `{W}/costs/unit-costs` | `costs:read` | `month` (`YYYY-MM`), `filter[project_id]?` | `{ data: Array<{ project_id, per_tracked_keyword_month: Usd, per_serp_check: Usd, per_active_prompt_month: Usd, per_ai_observation: Usd, per_engine: Record<string, Usd>, extraction_llm_usd: Usd }> }` | no | | 4 |
| GET | `{W}/costs/forecast` | `costs:read` | `month`, `filter[project_id]?` | `{ data: Array<{ project_id, workload, estimated_cost_usd: Usd, method: 'price_book_x_schedules', is_estimate: true }> }` | no | | 4 |
| GET | `{W}/budgets` | `costs:read` | `filter[project_id]?` | `Page<Budget>` | offset | | 1 |
| POST | `{W}/budgets` | `budgets:manage` | `{ project_id?, workload, limit_usd, soft_limit_pct?, action_on_hard? }` | `201 One<Budget>` | no | `409 duplicate` | 1 |
| PATCH | `{W}/budgets/{budget_id}` | `budgets:manage` | `{ limit_usd?, soft_limit_pct?, action_on_hard? }` | `One<Budget>` | no | | 1 |
| DELETE | `{W}/budgets/{budget_id}` | `budgets:manage` | none | `204` | no | | 1 |
| GET | `{W}/budgets/status` | `costs:read` | `month?` | `{ data: Array<{ budget: Budget, spent_usd: Usd, committed_estimate_usd: Usd, pct_used: number, state: 'ok' \| 'soft_exceeded' \| 'hard_exceeded', blocked_runs: number }> }` | no | | 3 |

```ts
interface Budget { budget_id: Uuid; project_id: Uuid | null; workload: 'seo_rank' | 'ai_prompt' | 'keyword_research' | 'ai_benchmark' | 'extraction_llm' | 'first_party' | 'all';   // budget groups, doc 04 section 11.4.1
                   period: 'month'; limit_usd: Usd; soft_limit_pct: number; action_on_hard: 'pause' | 'alert_only'; created_at: Iso }
```

#### 3.11.3 Schedules

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/schedules` | `data:read` | `filter[workload]`, `filter[is_active]` | `Page<Schedule>` | offset | | 3 |
| POST | `{P}/schedules` | `schedules:write` | `ScheduleInput` | `201 One<Schedule>` | no | `422 invalid_cron`, `422 selector_empty` | 3 |
| GET | `{P}/schedules/{schedule_id}` | `data:read` | none | `One<Schedule>` | no | | 3 |
| PATCH | `{P}/schedules/{schedule_id}` | `schedules:write` | partial `ScheduleInput`; `next_run_at` is recomputed | `One<Schedule>`; audit-logged | no | | 3 |
| DELETE | `{P}/schedules/{schedule_id}` | `schedules:write` | none | `204`; runs keep `schedule_id` for history | no | `409 schedule_in_use` (integration schedules are removed by disconnecting) | 3 |
| POST | `{P}/schedules/{schedule_id}/pause` | `schedules:write` | `{ reason? }` | `One<Schedule>` (`is_active = false`) | no | | 3 |
| POST | `{P}/schedules/{schedule_id}/resume` | `schedules:write` | none | `One<Schedule>`; missed occurrences are not caught up (doc 21 section 3.1) | no | | 3 |
| GET | `{P}/schedules/{schedule_id}/preview` | `data:read` | `count?` (1 to 10, default 5) | `{ data: Array<{ window_start, window_end, subjects: number, tasks: number, estimated_cost_usd: Usd, budget_state }> }` | no | | 3 |
| POST | `{P}/schedules/preview` | `data:read` | `ScheduleInput` (unsaved) | same as above | no | | 3 |

```ts
interface ScheduleInput {
  workload: 'seo_rank' | 'ai_prompt' | 'ai_mode_keyword' | 'keyword_metrics' | 'discovery' | 'ai_benchmark' | 'gsc_sync' | 'bing_sync' | 'ga4_sync' | 'cloudflare_sync';   // task workloads, doc 04 section 11.4.1
  name: string; cadence: 'daily' | 'weekly' | 'monthly' | 'cron'; cron_expr?: string; timezone: string;
  window_start_local: string;               // 'HH:MM'
  window_hours: number;                     // 1 to 24
  weekday?: number; priority: 'high' | 'standard' | 'low'; provider_mode: 'standard_queue' | 'priority_queue' | 'live';
  selector: { all?: true; groups?: Uuid[]; terms?: Uuid[]; priority_lte?: number; panels?: Uuid[]; engines?: string[]; stale_days?: number };
}
interface Schedule extends ScheduleInput { schedule_id: Uuid; is_active: boolean; next_run_at: Iso; last_run_id: Uuid | null; created_at: Iso }
```

#### 3.11.4 Runs and tasks

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/runs` | `data:read` | `filter[project_id]`, `filter[workload_in]`, `filter[status_in]`, `filter[trigger_in]`, `from`, `to` | `Page<Run>` sorted `-created_at` | cursor | | 4 |
| GET | `{P}/runs` | `data:read` | same without project filter, plus `filter[schedule_id]` | `Page<Run>` | cursor | | 3 |
| GET | `{P}/runs/{run_id}` | `data:read` | none | `One<RunDetail>` | no | | 3 |
| POST | `{P}/runs/{run_id}/cancel` | `runs:trigger` for manual runs the caller created; `schedules:write` otherwise | `{ reason? }` | `One<Run>`; `pending` tasks become `cancelled`; submitted tasks are still fetched (already paid) | no | `409 invalid_state_transition` | 3 |
| GET | `{P}/runs/{run_id}/tasks` | `data:read` | `filter[status_in]`, `filter[provider_code]`, `filter[engine_code]` | `Page<Task>` | cursor | | 4 |
| POST | `{P}/runs/{run_id}/retry-failed` | `tasks:requeue` | `{ statuses: Array<'failed' \| 'dead'> }`; Idempotency-Key required | `202 One<Run>` | no | `409 invalid_state_transition` (run not terminal) | 4 |
| GET | `{W}/tasks` | `ops:read` | `filter[status_in]` (default `failed,dead`), `filter[project_id]`, `filter[provider_code]`, `filter[workload]`, `filter[last_error_code]` | `Page<Task>` sorted `-completed_at` | cursor | | 4 |
| POST | `{W}/tasks/{task_id}/requeue` | `tasks:requeue` | none | `One<Task>` (`pending`, `next_attempt_at = now()`); a SERP task submits a new provider task | no | `409 invalid_state_transition` | 4 |
| POST | `{W}/tasks/requeue` | `tasks:requeue` | `{ task_ids?: BigId[] (max 500), filter?: object }`; Idempotency-Key required | `{ data: { requeued, skipped } }` | no | | 4 |

`POST {W}/tasks/{task_id}/requeue` is the only requeue route (docs 20 and 21 use it), so the route follows the tenancy rule of doc 24 section 4.

```ts
interface Run {
  run_id: Uuid; project_id: Uuid; schedule_id: Uuid | null; workload: string; trigger: 'schedule' | 'manual' | 'backfill' | 'retry';
  status: 'planned' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' | 'budget_blocked';
  window_start: Iso; window_end: Iso; tasks_total: number; tasks_succeeded: number; tasks_failed: number;
  estimated_cost_usd: Usd | null; actual_cost_usd: Usd | null; blocked_by_budget_id: Uuid | null;
  created_by: Actor | null; created_at: Iso; completed_at: Iso | null; operation: Operation;
}
interface RunDetail extends Run { tasks_by_status: Record<string, number>; config_snapshot: Record<string, unknown>;
                                  results?: { tracked_keyword_ids?: Uuid[]; observation_ids?: BigId[] } }   // manual runs: links to results
interface Task { task_id: BigId; created_at: Iso; run_id: Uuid; workload: string; subject_type: 'tracked_keyword' | 'prompt_version' | 'keyword' | 'integration' | 'seed_set';
                 subject_id: string; engine_code: string | null; location_id: number | null; replicate_index: number;
                 provider_code: string; provider_endpoint: string; provider_task_id: string | null; scheduled_for: Iso;
                 status: 'pending' | 'submit_unknown' | 'submitted' | 'ready' | 'fetched' | 'ingested' | 'failed' | 'dead' | 'cancelled' | 'skipped_cached';
                 attempts: number; next_attempt_at: Iso | null; cost_usd: Usd | null; last_error_code: string | null; last_error_message: string | null;
                 raw_payload_id: BigId | null }
```

#### 3.11.5 Alerts and outbound webhooks

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/alert-rule-types` | authenticated | none | `{ data: Array<{ rule_type, channel: 'seo' \| 'ai' \| 'ops', params_schema: JSONSchema, default_severity }> }` (doc 08 section 12.1, doc 11 section 10) | no | | 5 |
| GET | `{P}/alert-rules` | `data:read` | `filter[rule_type_in]`, `filter[is_active]` | `Page<AlertRule>` | offset | | 5 |
| POST | `{P}/alert-rules` | `alerts:write` | `AlertRuleInput` | `201 One<AlertRule>` | no | `422 invalid_params` (per `rule_type`), `404` for unknown webhook endpoint | 5 |
| GET | `{P}/alert-rules/{alert_rule_id}` | `data:read` | none | `One<AlertRule>` | no | | 5 |
| PATCH | `{P}/alert-rules/{alert_rule_id}` | `alerts:write` | partial `AlertRuleInput` | `One<AlertRule>` | no | | 5 |
| DELETE | `{P}/alert-rules/{alert_rule_id}` | `alerts:write` | none | `204` (events cascade per doc 04) | no | | 5 |
| POST | `{P}/alert-rules/{alert_rule_id}/test` | `alerts:write` | none | `{ data: { deliveries: Array<{ destination, status, http_status? }> } }` using a synthetic event labeled `test` | no | | 5 |
| GET | `{P}/alert-events` | `data:read` | `from`, `to`, `filter[rule_id]`, `filter[event_kind_in]`, `filter[severity_in]`, `filter[acknowledged]`, `filter[subject_type]`, `filter[subject_id]` | `Page<AlertEvent>` sorted `-occurred_at` | cursor | | 5 |
| POST | `{P}/alert-events/acknowledge` | `alerts:write` | `{ ids: BigId[] (max 500) }` | `{ data: { acknowledged } }` | no | | 5 |
| GET | `{P}/alert-digests` | `data:read` | `from`, `to` | `Page<{ digest_id, digest_mode, period_start, period_end, event_count, sent_at, channels, anomaly_hold: boolean }>` | cursor | | 5 |
| GET | `{P}/alert-digests/{digest_id}` | `data:read` | none | `One<{ digest, groups: Array<{ rule: AlertRule, events: AlertEvent[] }>, muted: Array<{ subject, rule_type, until }> }>` | no | | 5 |
| GET | `{W}/webhook-endpoints` | `alerts:write` | none | `Page<WebhookEndpoint>` (never the secret) | offset | | 5 |
| POST | `{W}/webhook-endpoints` | `alerts:write` | `{ name, kind: 'slack_incoming' \| 'custom', url, event_types?: string[] }` | `201 One<WebhookEndpoint & { signing_secret: string }>` (shown once; `custom` only) | no | `422 url_not_allowed` (SSRF rules, doc 24 section 7.3) | 5 |
| PATCH | `{W}/webhook-endpoints/{endpoint_id}` | `alerts:write` | `{ name?, url?, event_types?, is_active? }` | `One<WebhookEndpoint>` | no | `422 url_not_allowed` | 5 |
| DELETE | `{W}/webhook-endpoints/{endpoint_id}` | `alerts:write` | none | `204`; rules referencing it lose that destination | no | | 5 |
| POST | `{W}/webhook-endpoints/{endpoint_id}/test` | `alerts:write` | none | `{ data: Delivery }` (event type `webhook.test`) | no | | 5 |
| POST | `{W}/webhook-endpoints/{endpoint_id}/rotate-secret` | `alerts:write` fresh | `{ overlap_hours?: number (default 24, max 72) }` | `{ data: { signing_secret, previous_valid_until } }` | no | | 5 |
| GET | `{W}/webhook-endpoints/{endpoint_id}/deliveries` | `alerts:write` | `filter[status_in]` | `Page<Delivery>` | cursor | | 5 |
| POST | `{W}/webhook-deliveries/{delivery_id}/redeliver` | `alerts:write` | none | `202 One<Delivery>` (new attempt, same event id) | no | | 5 |

```ts
interface AlertRuleInput {
  name: string; rule_type: string;              // e.g. 'rank_drop', 'aio_citation_lost', 'ai_panel_change', 'ai_collection_degraded'
  scope: { groups?: Uuid[]; terms?: Uuid[]; tracked_keyword_ids?: Uuid[]; prompt_ids?: Uuid[]; panel_ids?: Uuid[];
           engine_codes?: string[]; min_priority?: number; device?: string; location_ids?: number[] };
  params: Record<string, unknown>;              // validated against the rule type's params_schema
  destinations: Array<{ type: 'in_app' } | { type: 'email'; recipients: 'workspace_admins' | 'project_members' | string[] }
                    | { type: 'slack_webhook'; webhook_endpoint_id: Uuid } | { type: 'webhook'; webhook_endpoint_id: Uuid }>;
  digest_mode: 'immediate' | 'hourly_digest' | 'daily_digest';   // 'immediate' only for critical rule types (doc 08 section 12.2)
  is_active?: boolean;
}
interface AlertRule extends AlertRuleInput { alert_rule_id: Uuid; channels: string[]; created_at: Iso }   // channels mirrors ops.alert_rules.channels
interface AlertEvent { alert_event_id: BigId; rule_id: Uuid; subject_type: string; subject_id: string; subject_label: string;
                       event_kind: string; severity: 'info' | 'warning' | 'critical'; evidence: Record<string, unknown>;
                       occurred_at: Iso; notified_at: Iso | null; digest_id: Uuid | null; acknowledged_by: UserRef | null; acknowledged_at: Iso | null }
interface WebhookEndpoint { endpoint_id: Uuid; name: string; kind: 'slack_incoming' | 'custom'; url_display: string;   // host plus masked path
                            event_types: string[]; is_active: boolean; disabled_reason: string | null; consecutive_failures: number;
                            secret_fingerprint: string | null; created_at: Iso }
interface Delivery { delivery_id: Uuid; event_id: Uuid; event_type: string; attempt: number; status: 'pending' | 'succeeded' | 'failed' | 'gave_up';
                     http_status: number | null; response_ms: number | null; next_attempt_at: Iso | null; created_at: Iso }
```

#### 3.11.5a Saved views (Phase 5)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{P}/saved-views` | `data:read` | `filter[screen]` | `Page<SavedView>` (own private views plus workspace views) | offset | | 5 |
| POST | `{P}/saved-views` | `views:write` | `{ screen, name, query_string, columns?, sort?, visibility, is_pinned? }` | `201 One<SavedView>` | no | `409 duplicate_name`; `403` for `visibility: 'workspace'` below editor | 5 |
| PATCH | `{P}/saved-views/{view_id}` | `views:write` (owner, or editor and above for workspace views) | partial input | `One<SavedView>` | no | | 5 |
| DELETE | `{P}/saved-views/{view_id}` | same as PATCH | none | `204` | no | | 5 |

Backed by `core.saved_views` (doc 04 section 11.6).

#### 3.11.5c Layouts (platform foundation phase)

Which cards and headline numbers a person sees on a screen ([layout customization design](superpowers/specs/2026-09-30-layout-customization-design.md)). Workspace-scoped: a layout is the same in every project.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/layouts/{screen}` | any member | none | `One<ResolvedLayout>` with `ETag` (personal, else team default, else `source: 'builtin'` with a null document) | no | `404` unknown screen | 1 |
| PUT | `{W}/me/layouts/{screen}` | any member, session only | `LayoutDocument`; `If-Match` when a personal layout exists | `One<ResolvedLayout>` | no | `422 validation_failed`, `412 precondition_failed` | 1 |
| DELETE | `{W}/me/layouts/{screen}` | any member, session only | none | `204` (back to the team or built-in default) | no | | 1 |
| PUT | `{W}/layouts/{screen}/default` | `layouts:manage` | `LayoutDocument`; `If-Match` when a team default exists | `One<ResolvedLayout>` | no | `422 validation_failed`, `412 precondition_failed` | 1 |
| DELETE | `{W}/layouts/{screen}/default` | `layouts:manage` | none | `204` | no | | 1 |

```ts
interface LayoutDocument { schema: 1; numbers?: NumberItem[]; cards?: CardItem[] }
interface NumberItem { id: string; metric: string; engine?: string }
interface CardItem { id: string; type: string; width?: 'third' | 'half' | 'two_thirds' | 'full'; options?: Record<string, string> }
interface ResolvedLayout {
  screen: string;
  source: 'personal' | 'team' | 'builtin';
  document: LayoutDocument | null;      // null when source is 'builtin': the web app holds the built-in default
  team_default_exists: boolean;
  updated_at: Iso | null;
  updated_by: { user_id: Uuid; name: string } | null;
}
```

`PUT` validates the screen, `schema`, that every card type and metric key is in the catalog for that screen, allowed widths, the limits (12 cards, 6 numbers) and the size (16 KB). The list of valid keys is JSON generated from the catalog in `packages/contracts`. Option contents are validated by the web app against each card type; the API checks only that `options` is a flat object of strings. Setting or removing a team default writes `ops.audit_logs` (`layout.default.set`, `layout.default.remove`). API keys cannot call these routes (section 2.1 rule 4). Backed by `core.layouts` (doc 04 section 11.6a).

#### 3.11.5b Platform alerts (platform operators only)

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/admin/platform-alerts` | platform operator flag | `filter[status]`, `from`, `to` | `Page<PlatformAlert>` (doc 25 section 6 catalog) | cursor | `404` for non-operators | 1 |
| POST | `/api/v1/admin/platform-alerts/{alert_id}/ack` | platform operator flag | `{ note? }` | `One<PlatformAlert>` | no | | 1 |

#### 3.11.6 Exports

Exports run asynchronously and deliver a signed R2 link valid 24 hours (doc 08 section 3.4). At most 10 concurrent exports per workspace.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| POST | `{P}/exports` | `exports:create` | `{ kind, format: 'csv' \| 'xlsx' \| 'jsonl', filters?, columns?, window?, options? }`; Idempotency-Key required | `202 One<Export>` | no | `429 export_concurrency_limit`, `422 format_not_supported` (XLSX above 1,000,000 rows) | 3 |
| GET | `{P}/exports` | `data:read` | `filter[kind]`, `filter[status_in]` | `Page<Export>` | cursor | | 3 |
| GET | `{P}/exports/{export_id}` | `data:read` | none | `One<Export>` | no | | 3 |
| GET | `{P}/exports/{export_id}/download` | `data:read` (creator or `exports:create`) | none | `302` to a signed R2 URL; audit-logged (`export.download`) | no | `409 invalid_state_transition` (not ready), `410 export_expired` | 3 |
| DELETE | `{P}/exports/{export_id}` | `exports:create` | none | `204`; object deleted | no | | 3 |
| POST | `{W}/exports` | `exports:create` (costs: `costs:read`; audit: `audit:read`) | `{ kind: 'costs' \| 'audit_logs', format, from, to }`; Idempotency-Key required | `202 One<Export>` | no | `429 export_concurrency_limit` | 5 |

Project export kinds (phase in which each becomes available): `tracked_keywords` (3), `keyword_metrics` (3), `rank_history` (4; one row per check, depth-aware null as empty rank plus `depth_requested`), `serp_features_history` (4), `competitor_ranks` (5), `seo_metrics_daily` (5), `landing_pages` (5), `prompts` (6), `ai_observations` (7; answer text optional), `citations` (7), `ai_metrics` (9; every metric with numerator, denominator, n and interval, including `ai.mention_count_share` and `seo.capped_average_rank`), `sources` (9), `matrix_rows` (10a), `gsc_queries` (12).

```ts
interface Export { export_id: Uuid; kind: string; format: 'csv' | 'xlsx' | 'jsonl'; params: Record<string, unknown>;
                   status: 'queued' | 'running' | 'ready' | 'failed' | 'expired'; row_count: number | null; bytes: number | null;
                   expires_at: Iso | null; created_by: Actor; created_at: Iso; operation: Operation }
```

#### 3.11.7 Operations summaries

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `{W}/ops/summary` | `ops:read` | none | `One<{ overdue_runs, budget_blocked_runs, dead_tasks_24h, stale_tracked_keywords: MetricValue, stale_prompt_engines: MetricValue, integrations_reauth_required, providers: Array<{ provider_code, status }> }>` (doc 21 section 9) | no | | 4 |
| GET | `/api/v1/admin/ops/summary` | platform_operator | none | `One<{ queues: Array<{ name, waiting, active, delayed, failed }>, planner_lag_seconds, reconciler_last_run_at, poll_ready_last_run_at, disk_used_pct, partitions_ahead_months: Record<string, number>, last_backup_at, last_restore_test: { at, passed }, provider_balances: Array<{ provider_code, balance_usd }> }>` | no | | 4 |

### 3.12 Provider callbacks and health

There are no provider callback routes. DataForSEO readiness is polling only (doc 06 section 4.2, [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)): the worker's `poll_ready` task reads `tasks_ready` every 60 s, every 30 s while a collection window is open, and the id sweeper fetches tasks older than the window by id. No pingback URL is sent to the provider, so there is no route token, no Caddy IP allowlist and no public callback surface.

| Method | Path | Permission | Request | Response | Pg | Errors | Ph |
|---|---|---|---|---|---|---|---|
| GET | `/api/healthz` | public | none | `200 {"status":"ok"}` when the process event loop responds | no | | 1 |
| GET | `/api/readyz` | public | none | `200 {"status":"ready","checks":{"postgres":true,"redis":true,"migrations":true}}` or `503` with the failing check names only | no | | 1 |

`/api/healthz` and `/api/readyz` reveal no versions, hostnames or error messages. `/api/readyz` is what the Compose healthcheck and the deploy script use to decide when a new API container can take traffic, and what the external uptime check calls.

## 4. Example payloads

Ids are shortened for readability where marked `...`; everything else is a literal, valid payload for the schemas above.

### 4.1 Tracked keyword list row

`GET {P}/tracked-keywords?include=metrics,competitors,sparkline&sort=current_rank&limit=50` (one row shown; the sparkline is truncated to 5 of 30 points for the example).

```json
{
  "data": [
    {
      "tracked_keyword_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
      "keyword": { "keyword_id": "0192f0a1-2b10-7c3e-9d2a-11aa22bb33cc", "text": "best crm for startups", "normalized_text": "best crm for startups", "language_code": "en", "created_at": "2026-07-02T10:14:00Z" },
      "search_engine": "google", "location_id": 2840, "language_code": "en", "device": "desktop", "os": null,
      "config_version": 2, "depth_profile": "standard",
      "target_url": { "url_id": "812034", "canonical_url": "https://acme.io/crm-for-startups", "host": "acme.io", "registrable_domain": "acme.io", "path": "/crm-for-startups" },
      "intent": "commercial", "intent_source": "provider", "funnel_stage": "mofu", "priority": 1, "business_value": "12.00",
      "frequency": "daily", "schedule_id": "0192e111-0000-7000-8000-000000000001", "source": "csv_import", "is_active": true,
      "created_by": { "user_id": "0192d000-aaaa-7bbb-8ccc-000000000009", "name": "Dana Ruiz", "email": "dana@example.com" },
      "created_at": "2026-07-02T10:14:00Z", "updated_at": "2026-09-01T08:00:00Z",
      "state": {
        "current": { "state": "ranked", "rank": 4, "absolute_rank": 7, "depth_requested": 20,
                     "url": { "url_id": "812034", "canonical_url": "https://acme.io/crm-for-startups", "host": "acme.io", "registrable_domain": "acme.io", "path": "/crm-for-startups" },
                     "observed_at": "2026-09-29T06:41:12Z", "serp_snapshot_id": "88410231" },
        "change": { "value": 2, "label": "numeric", "previous_rank": 6, "previous_observed_at": "2026-09-28T06:40:55Z" },
        "best_rank": 3, "best_rank_at": "2026-08-12T06:39:40Z", "worst_rank": 14, "first_ranked_at": "2026-07-03T06:41:02Z",
        "feature_types_present": ["ai_overview", "people_also_ask", "video", "related_searches"],
        "owned_feature_types": ["people_also_ask"],
        "aio": { "state": "present_not_cited", "citation_position": null, "observation_id": "5512093" },
        "target_url_match": true, "url_changed_at": "2026-08-10T06:40:11Z",
        "consecutive_failures": 0, "is_stale": false, "last_observed_at": "2026-09-29T06:41:12Z"
      },
      "metrics": {
        "source": "dataforseo_labs", "location_id": 2840, "language_code": "en", "fetched_at": "2026-09-20T07:12:00Z", "data_month": "2026-08-01",
        "search_volume": { "metric": "seo.search_volume", "value": 1900, "numerator": null, "denominator": null, "unit": "count",
                           "n_observations": 1, "n_keywords": 1, "window": { "from": "2025-09-01", "to": "2026-08-31", "timezone": "UTC" },
                           "filters": { "location_id": 2840, "language_code": "en" }, "is_estimate": true,
                           "method": "Provider-reported average monthly search volume (DataForSEO Labs), annual average", "method_version": 1 },
        "cpc_usd": "14.2300", "competition": 0.67, "competition_level": "HIGH", "keyword_difficulty": 58,
        "intent_main": "commercial", "trend_pct_per_month": 1.8, "is_seasonal": false
      },
      "competitors": [
        { "entity": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
          "current": { "state": "ranked", "rank": 1, "absolute_rank": 3, "depth_requested": 20,
                       "url": { "url_id": "90211", "canonical_url": "https://www.hubspot.com/products/crm", "host": "www.hubspot.com", "registrable_domain": "hubspot.com", "path": "/products/crm" },
                       "observed_at": "2026-09-29T06:41:12Z", "serp_snapshot_id": "88410231" },
          "change": { "value": 0, "label": "numeric", "previous_rank": 1, "previous_observed_at": "2026-09-28T06:40:55Z" } },
        { "entity": { "entity_id": "0192c1...02", "canonical_name": "Pipedrive", "entity_type": "brand", "role": "competitor", "color_index": 3 },
          "current": { "state": "beyond_depth", "rank": null, "absolute_rank": null, "depth_requested": 20, "url": null,
                       "observed_at": "2026-09-29T06:41:12Z", "serp_snapshot_id": "88410231" },
          "change": { "value": null, "label": "lost", "previous_rank": 18, "previous_observed_at": "2026-09-28T06:40:55Z" } }
      ],
      "sparkline": {
        "depth_mode": "daily_depth",
        "points": [
          { "t": "2026-09-25T06:40:02Z", "rank": 9, "depth": 20, "state": "ranked" },
          { "t": "2026-09-26T06:39:58Z", "rank": null, "depth": 20, "state": "beyond_depth" },
          { "t": "2026-09-27T06:41:30Z", "rank": 7, "depth": 20, "state": "ranked" },
          { "t": "2026-09-28T06:40:55Z", "rank": 6, "depth": 100, "state": "ranked" },
          { "t": "2026-09-29T06:41:12Z", "rank": 4, "depth": 20, "state": "ranked" }
        ]
      },
      "cannibalization_class": "none"
    }
  ],
  "page": { "limit": 50, "next_cursor": "eyJzIjpbImN1cnJlbnRfcmFuayJdLCJrIjpbNCwiMDE5MmYwYTEuLi4iXX0", "has_more": true, "total": 4812 },
  "meta": { "data_version": 18412, "partial_last_day": true }
}
```

### 4.2 Rank history series (depth-aware null encoding)

`GET {P}/tracked-keywords/{id}/rank-history?from=2026-09-20&to=2026-09-24&entity_ids=own`

Encoding rules:

1. One point per **successful check**, not per calendar day. Days without a scheduled check (weekly profiles) have no point.
2. `state: "beyond_depth"` always has `rank: null` and a non-null `depth_requested`. It means "not in top N", never "not ranking" (doc 09 section 3). Clients must not draw a line through it and must not impute a rank.
3. A scheduled check that failed permanently is a point with `state: "failed"`, `rank: null`, `depth_requested: null`.
4. Deep checks (`depth_requested: 100`) carry ranks 21 to 100. `bands` lists the ranges where the daily depth hides positions, so charts draw weekly points for 21 to 100 and a shaded band elsewhere (doc 06 section 2.2).
5. `urls` is a dictionary keyed by `url_id` so points reference URLs without repeating them.
6. `format=columns` returns the same data as parallel arrays per entity (`t`, `state`, `rank`, `absolute_rank`, `depth_requested`, `url_id`, `serp_snapshot_id`).

```json
{
  "data": {
    "tracked_keyword_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
    "window": { "from": "2026-09-20", "to": "2026-09-24", "timezone": "America/New_York" },
    "deep_check_weekday": 1,
    "config_history": [
      { "config_version": 1, "depth_profile": "light", "valid_from": "2026-07-02T10:14:00Z", "valid_to": "2026-09-22T15:00:00Z" },
      { "config_version": 2, "depth_profile": "standard", "valid_from": "2026-09-22T15:00:00Z", "valid_to": null }
    ],
    "urls": {
      "812034": { "url_id": "812034", "canonical_url": "https://acme.io/crm-for-startups", "host": "acme.io", "registrable_domain": "acme.io", "path": "/crm-for-startups" },
      "812990": { "url_id": "812990", "canonical_url": "https://acme.io/blog/crm-guide", "host": "acme.io", "registrable_domain": "acme.io", "path": "/blog/crm-guide" }
    },
    "series": [
      {
        "entity": { "entity_id": "0192c0...00", "canonical_name": "Acme", "entity_type": "brand", "role": "own", "color_index": 1 },
        "points": [
          { "date": "2026-09-20", "observed_at": "2026-09-20T06:40:10Z", "state": "beyond_depth", "rank": null, "absolute_rank": null, "depth_requested": 10, "url_id": null, "serp_snapshot_id": "88100112" },
          { "date": "2026-09-21", "observed_at": "2026-09-21T06:39:44Z", "state": "ranked", "rank": 14, "absolute_rank": 19, "depth_requested": 100, "url_id": "812990", "serp_snapshot_id": "88177120" },
          { "date": "2026-09-22", "observed_at": "2026-09-22T06:41:03Z", "state": "beyond_depth", "rank": null, "absolute_rank": null, "depth_requested": 10, "url_id": null, "serp_snapshot_id": "88250931" },
          { "date": "2026-09-23", "observed_at": null, "state": "failed", "rank": null, "absolute_rank": null, "depth_requested": null, "url_id": null, "serp_snapshot_id": null },
          { "date": "2026-09-24", "observed_at": "2026-09-24T06:40:37Z", "state": "ranked", "rank": 9, "absolute_rank": 12, "depth_requested": 20, "url_id": "812034", "serp_snapshot_id": "88401544" }
        ]
      }
    ],
    "bands": [
      { "entity_id": "0192c0...00", "from": "2026-09-20", "to": "2026-09-20", "kind": "beyond_depth", "depth_requested": 10, "label": "not in top 10" },
      { "entity_id": "0192c0...00", "from": "2026-09-22", "to": "2026-09-22", "kind": "beyond_depth", "depth_requested": 10, "label": "not in top 10" }
    ],
    "events": [
      { "rank_event_id": "7719022", "occurred_at": "2026-09-24T06:40:37Z", "event_type": "entered_top_10", "entity_id": "0192c0...00", "from_rank": null, "to_rank": 9 },
      { "rank_event_id": "7719023", "occurred_at": "2026-09-24T06:40:37Z", "event_type": "url_changed", "entity_id": "0192c0...00", "from_rank": 14, "to_rank": 9 }
    ],
    "summary": {
      "average_rank": { "metric": "seo.average_rank", "value": 11.5, "numerator": 23, "denominator": 2, "unit": "rank",
                        "n_observations": 4, "n_keywords": 1, "window": { "from": "2026-09-20", "to": "2026-09-24", "timezone": "America/New_York" },
                        "filters": { "entity": "own" }, "observation_class": "serp", "is_estimate": false,
                        "method": "Mean organic rank over ranked checks only; beyond-depth checks excluded and counted", "method_version": 1,
                        "version_boundaries": [ { "at": "2026-09-22T15:00:00Z", "component": "tracked_keyword_config", "from": 1, "to": 2 } ] },
      "checks": 4, "ranked_checks": 2, "beyond_depth_checks": 2, "failed_checks": 1
    },
    "version_boundaries": [ { "at": "2026-09-22T15:00:00Z", "component": "tracked_keyword_config", "from": 1, "to": 2 } ]
  },
  "meta": { "data_version": 18412 }
}
```

### 4.3 AI observation detail

`GET {P}/ai/observations/5512731?observed_at=2026-09-22T05:12:44Z`

```json
{
  "data": {
    "observation_id": "5512731", "observed_at": "2026-09-22T05:12:44Z", "observed_date": "2026-09-22",
    "engine_code": "chatgpt_web", "observation_class": "consumer_ui",
    "subject": { "type": "prompt", "prompt_id": "0192e5...10", "prompt_version_id": "0192e5...11", "version_no": 1 },
    "query_text": "What is the best CRM for a 20-person SaaS startup?",
    "run_id": "0192f1c2-7a4e-7d31-9b0e-5c1f2a3b4c5d", "replicate_index": 2, "location_id": 2840, "language_code": "en", "device": "desktop",
    "status": "complete", "model_reported": "chatgpt-web-2026-09",
    "answer_text": "These are the best CRMs for a 20-person SaaS startup:\n\n1. HubSpot: free tier and strong marketing tools.\n2. Acme CRM: simple pipeline setup and fair pricing.\n3. Pipedrive: sales-focused and easy to learn.\n\nIf you need deep customization later, Salesforce is an option, but it is expensive for small teams.",
    "answer_markdown": "These are the best CRMs for a 20-person SaaS startup:\n\n1. HubSpot: free tier and strong marketing tools.\n2. Acme CRM: simple pipeline setup and fair pricing.\n3. Pipedrive: sales-focused and easy to learn.\n\nIf you need deep customization later, Salesforce is an option, but it is expensive for small teams.",
    "answer_html_available": true, "answer_char_count": 305, "citation_count": 3, "fanout_count": 2, "served_from_cache": false,
    "blocks": [
      { "index": 0, "type": "paragraph", "start": 0, "end": 53 },
      { "index": 1, "type": "list_item", "list_id": 0, "list_ordered": true, "list_item_number": 1, "start": 55, "end": 104 },
      { "index": 2, "type": "list_item", "list_id": 0, "list_ordered": true, "list_item_number": 2, "start": 105, "end": 157 },
      { "index": 3, "type": "list_item", "list_id": 0, "list_ordered": true, "list_item_number": 3, "start": 158, "end": 204 },
      { "index": 4, "type": "paragraph", "start": 206, "end": 305 }
    ],
    "mentions": [
      { "entity": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
        "role": "competitor", "mention_count": 1, "first_char_offset": 58, "mention_order": 1, "prominence": 0.8098,
        "structured_rank": 1, "structured_list_size": 3, "is_recommended": true, "recommendation_method": "rule",
        "sentiment": null, "sentiment_method": null, "match_method": "alias_word", "confidence": 0.95, "evidence_spans": [[58, 65]] },
      { "entity": { "entity_id": "0192c0...00", "canonical_name": "Acme", "entity_type": "brand", "role": "own", "color_index": 1 },
        "role": "own", "mention_count": 1, "first_char_offset": 108, "mention_order": 2, "prominence": 0.6459,
        "structured_rank": 2, "structured_list_size": 3, "is_recommended": true, "recommendation_method": "rule",
        "sentiment": "positive", "sentiment_method": "rule", "match_method": "alias_word", "confidence": 0.95, "evidence_spans": [[108, 116]] },
      { "entity": { "entity_id": "0192c1...02", "canonical_name": "Pipedrive", "entity_type": "brand", "role": "competitor", "color_index": 3 },
        "role": "competitor", "mention_count": 1, "first_char_offset": 161, "mention_order": 3, "prominence": 0.4721,
        "structured_rank": 3, "structured_list_size": 3, "is_recommended": true, "recommendation_method": "rule",
        "sentiment": null, "sentiment_method": null, "match_method": "alias_word", "confidence": 0.95, "evidence_spans": [[161, 170]] },
      { "entity": { "entity_id": "0192c1...03", "canonical_name": "Salesforce", "entity_type": "brand", "role": "competitor", "color_index": 4 },
        "role": "competitor", "mention_count": 1, "first_char_offset": 244, "mention_order": 4, "prominence": 0.2,
        "structured_rank": null, "structured_list_size": null, "is_recommended": false, "recommendation_method": "rule",
        "sentiment": null, "sentiment_method": null, "match_method": "alias_word", "confidence": 0.95, "evidence_spans": [[244, 254]] }
    ],
    "citations": [
      { "citation_index": 1, "url": { "url_id": "90211", "canonical_url": "https://www.hubspot.com/products/crm", "host": "www.hubspot.com", "registrable_domain": "hubspot.com", "path": "/products/crm" },
        "domain": { "domain_id": 4411, "host": "www.hubspot.com", "registrable_domain": "hubspot.com", "category": "vendor_site", "category_source": "seed_list" },
        "raw_url": "https://www.hubspot.com/products/crm?utm_source=chatgpt.com", "title": "Free CRM Software | HubSpot", "source_name": "HubSpot",
        "citation_kind": "inline", "first_char_offset": 104, "answer_block_index": 1, "occurrences": 1,
        "domain_role": "competitor", "role_entity": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
        "referral_tag": "chatgpt.com" },
      { "citation_index": 2, "url": { "url_id": "812120", "canonical_url": "https://acme.io/pricing", "host": "acme.io", "registrable_domain": "acme.io", "path": "/pricing" },
        "domain": { "domain_id": 5120, "host": "acme.io", "registrable_domain": "acme.io", "category": "vendor_site", "category_source": "seed_list" },
        "raw_url": "https://acme.io/pricing?utm_source=chatgpt.com", "title": "Pricing | Acme CRM", "source_name": "Acme",
        "citation_kind": "inline", "first_char_offset": 156, "answer_block_index": 2, "occurrences": 1,
        "domain_role": "own", "role_entity": { "entity_id": "0192c0...00", "canonical_name": "Acme", "entity_type": "brand", "role": "own", "color_index": 1 },
        "referral_tag": "chatgpt.com" },
      { "citation_index": 3, "url": { "url_id": "77310", "canonical_url": "https://www.g2.com/categories/crm", "host": "www.g2.com", "registrable_domain": "g2.com", "path": "/categories/crm" },
        "domain": { "domain_id": 2201, "host": "www.g2.com", "registrable_domain": "g2.com", "category": "review_aggregator", "category_source": "seed_list" },
        "raw_url": "https://www.g2.com/categories/crm", "title": "Best CRM Software in 2026", "source_name": "G2",
        "citation_kind": "source_list", "first_char_offset": null, "answer_block_index": null, "occurrences": 1,
        "domain_role": "third_party", "role_entity": null, "referral_tag": null }
    ],
    "fanout_queries": [
      { "seq": 1, "query_text": "best crm for startups 2026", "normalized_text": "best crm for startups 2026", "source_field": "search_queries", "matched_keyword_id": null },
      { "seq": 2, "query_text": "acme crm pricing", "normalized_text": "acme crm pricing", "source_field": "search_queries", "matched_keyword_id": "0192f0a1-99aa-7bbb-8ccc-000000000321" }
    ],
    "retrieval_results": [
      { "result_index": 1, "fanout_seq": 1, "url": { "url_id": "77310", "canonical_url": "https://www.g2.com/categories/crm", "host": "www.g2.com", "registrable_domain": "g2.com", "path": "/categories/crm" }, "title": "Best CRM Software in 2026", "was_cited": true },
      { "result_index": 2, "fanout_seq": 1, "url": { "url_id": "812034", "canonical_url": "https://acme.io/crm-for-startups", "host": "acme.io", "registrable_domain": "acme.io", "path": "/crm-for-startups" }, "title": "CRM for Startups | Acme", "was_cited": false },
      { "result_index": 3, "fanout_seq": 2, "url": { "url_id": "812120", "canonical_url": "https://acme.io/pricing", "host": "acme.io", "registrable_domain": "acme.io", "path": "/pricing" }, "title": "Pricing | Acme CRM", "was_cited": true }
    ],
    "facts": {
      "derivation_id": 14, "is_valid": true, "outcome": "mentioned_and_cited",
      "own_mentioned": true, "own_domain_cited": true, "own_recommended": true, "own_structured_rank": 2,
      "own_prominence": 0.6459, "own_mention_order": 2, "own_sentiment": "positive",
      "own_citation_count": 1, "total_citation_count": 3, "tracked_entities_mentioned": 4,
      "competitor_mentions": ["0192c1...01", "0192c1...02", "0192c1...03"], "competitor_cited": ["0192c1...01"],
      "had_structured_list": true
    },
    "derivation": { "derivation_id": 14, "extractor_version": 1, "entity_config_version": 7, "recommendation_version": 1, "sentiment_version": 1, "created_at": "2026-09-18T11:02:00Z" },
    "provenance": { "provider_code": "dataforseo", "provider_endpoint": "ai_optimization/chat_gpt/llm_scraper/task_get/advanced", "provider_task_id": "09221512-1535-0613-0000-1c2d3e4f5a6b",
                    "raw_payload_id": "3301877", "adapter_version": 1, "normalizer_version": 1, "canonicalizer_version": 1,
                    "latency_ms": 41200, "cost_usd": "0.004000", "retry_count": 0, "collection_task_id": "10442918" },
    "links": { "raw": "/api/v1/workspaces/0192.../projects/0192.../ai/observations/5512731/raw?observed_at=2026-09-22T05:12:44Z",
               "prompt": "/api/v1/workspaces/0192.../projects/0192.../prompts/0192e5...10" }
  }
}
```

`answer_text` and `answer_markdown` are returned as data. The client renders markdown only through the sanitizer described in doc 24 section 7.1 and highlights `evidence_spans` as character ranges into `answer_text`.

### 4.4 Prompt Explorer row

`GET {P}/ai/prompt-explorer?engine_codes=chatgpt_web,gemini_web&window=last_28d&sort=-mention_rate&sort_engine=chatgpt_web` (one row; shared metric context hoisted to `meta.metric_context` per section 2.6 rule 10).

```json
{
  "data": [
    {
      "prompt_id": "0192e5...10", "text": "What is the best CRM for a 20-person SaaS startup?", "version_no": 1,
      "importance": 1, "intent": "commercial", "prompt_type": "recommendation", "is_branded": false,
      "terms": [ { "term_id": "0192b0...05", "vocabulary_kind": "topic", "name": "CRM for Startups", "path": "crm/crm-for-startups" } ],
      "panels": [ { "panel_id": "0192e0...01", "name": "Core", "panel_type": "core" } ],
      "by_engine": [
        { "engine_code": "chatgpt_web",
          "mention_rate": { "metric": "ai.mention_rate", "engine_code": "chatgpt_web", "value": 0.6667, "numerator": 8, "denominator": 12, "n_observations": 12, "n_prompts": 1, "ci": { "low": 0.391, "high": 0.862, "level": 0.95, "method": "wilson" } },
          "citation_rate": { "metric": "ai.citation_rate", "engine_code": "chatgpt_web", "value": 0.4167, "numerator": 5, "denominator": 12, "n_observations": 12, "n_prompts": 1, "ci": { "low": 0.193, "high": 0.68, "level": 0.95, "method": "wilson" } },
          "recommendation_rate": { "metric": "ai.recommendation_rate", "engine_code": "chatgpt_web", "value": 0.5, "numerator": 6, "denominator": 12, "n_observations": 12, "n_prompts": 1, "ci": { "low": 0.254, "high": 0.746, "level": 0.95, "method": "wilson" } },
          "outcome_mix": [
            { "metric": "ai.outcome_mix.mentioned_and_cited", "engine_code": "chatgpt_web", "value": 0.3333, "numerator": 4, "denominator": 12, "n_observations": 12, "n_prompts": 1 },
            { "metric": "ai.outcome_mix.mentioned_only", "engine_code": "chatgpt_web", "value": 0.3333, "numerator": 4, "denominator": 12, "n_observations": 12, "n_prompts": 1 },
            { "metric": "ai.outcome_mix.cited_only", "engine_code": "chatgpt_web", "value": 0.0833, "numerator": 1, "denominator": 12, "n_observations": 12, "n_prompts": 1 },
            { "metric": "ai.outcome_mix.neither", "engine_code": "chatgpt_web", "value": 0.25, "numerator": 3, "denominator": 12, "n_observations": 12, "n_prompts": 1 }
          ],
          "top_competitor": { "entity": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
                              "mention_rate": { "metric": "ai.mention_rate", "engine_code": "chatgpt_web", "entity_id": "0192c1...01", "value": 0.9167, "numerator": 11, "denominator": 12, "n_observations": 12, "n_prompts": 1, "ci": { "low": 0.646, "high": 0.985, "level": 0.95, "method": "wilson" } } },
          "flip_rate": { "metric": "ai.flip_rate", "engine_code": "chatgpt_web", "value": 0.3636, "numerator": 4, "denominator": 11, "n_observations": 12, "n_prompts": 1 },
          "last_observed_at": "2026-09-22T05:12:44Z", "is_stale": false },
        { "engine_code": "gemini_web",
          "mention_rate": { "metric": "ai.mention_rate", "engine_code": "gemini_web", "value": 0.25, "numerator": 1, "denominator": 4, "n_observations": 4, "n_prompts": 1, "ci": { "low": 0.046, "high": 0.699, "level": 0.95, "method": "wilson" } },
          "citation_rate": { "metric": "ai.citation_rate", "engine_code": "gemini_web", "value": 0.0, "numerator": 0, "denominator": 4, "n_observations": 4, "n_prompts": 1, "ci": { "low": 0.0, "high": 0.49, "level": 0.95, "method": "wilson" } },
          "recommendation_rate": { "metric": "ai.recommendation_rate", "engine_code": "gemini_web", "value": 0.0, "numerator": 0, "denominator": 3, "n_observations": 4, "n_prompts": 1, "ci": { "low": 0.0, "high": 0.561, "level": 0.95, "method": "wilson" } },
          "outcome_mix": [
            { "metric": "ai.outcome_mix.mentioned_and_cited", "engine_code": "gemini_web", "value": 0.0, "numerator": 0, "denominator": 4, "n_observations": 4, "n_prompts": 1 },
            { "metric": "ai.outcome_mix.mentioned_only", "engine_code": "gemini_web", "value": 0.25, "numerator": 1, "denominator": 4, "n_observations": 4, "n_prompts": 1 },
            { "metric": "ai.outcome_mix.cited_only", "engine_code": "gemini_web", "value": 0.0, "numerator": 0, "denominator": 4, "n_observations": 4, "n_prompts": 1 },
            { "metric": "ai.outcome_mix.neither", "engine_code": "gemini_web", "value": 0.75, "numerator": 3, "denominator": 4, "n_observations": 4, "n_prompts": 1 }
          ],
          "top_competitor": { "entity": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
                              "mention_rate": { "metric": "ai.mention_rate", "engine_code": "gemini_web", "entity_id": "0192c1...01", "value": 1.0, "numerator": 4, "denominator": 4, "n_observations": 4, "n_prompts": 1, "ci": { "low": 0.51, "high": 1.0, "level": 0.95, "method": "wilson" } } },
          "flip_rate": { "metric": "ai.flip_rate", "engine_code": "gemini_web", "value": 0.3333, "numerator": 1, "denominator": 3, "n_observations": 4, "n_prompts": 1 },
          "last_observed_at": "2026-09-23T04:02:10Z", "is_stale": false }
      ],
      "linked_keywords": [
        { "keyword_id": "0192f0a1-2b10-7c3e-9d2a-11aa22bb33cc", "text": "best crm for startups", "is_primary": true, "link_type": "generated",
          "current": { "state": "ranked", "rank": 4, "absolute_rank": 7, "depth_requested": 20, "url": null, "observed_at": "2026-09-29T06:41:12Z", "serp_snapshot_id": "88410231" },
          "aio_state": "present_not_cited" }
      ],
      "top_cited_domains": ["g2.com", "hubspot.com", "acme.io"]
    }
  ],
  "page": { "limit": 50, "next_cursor": "eyJzIjpbIi1tZW50aW9uX3JhdGUiXSwiZHYiOjE4NDEyfQ", "has_more": true },
  "meta": {
    "data_version": 18412,
    "metric_context": {
      "ai.mention_rate": { "unit": "ratio", "aggregation": "prompt_weighted", "observation_class": "consumer_ui", "is_estimate": false,
                           "window": { "from": "2026-09-02", "to": "2026-09-29", "timezone": "America/New_York" },
                           "filters": { "panel_id": "0192e0...01", "include_branded": false, "entity_id": "0192c0...00" },
                           "method": "Share of valid answers that name the own brand (per prompt: successes over valid observations)", "method_version": 1,
                           "version_boundaries": [ { "at": "2026-09-17T00:00:00Z", "component": "model_reported:chatgpt_web", "from": "chatgpt-web-2026-08", "to": "chatgpt-web-2026-09" } ] },
      "ai.citation_rate": { "unit": "ratio", "aggregation": "prompt_weighted", "observation_class": "consumer_ui", "is_estimate": false,
                            "window": { "from": "2026-09-02", "to": "2026-09-29", "timezone": "America/New_York" },
                            "filters": { "panel_id": "0192e0...01", "include_branded": false, "entity_id": "0192c0...00" },
                            "method": "Share of valid answers citing any own-domain URL", "method_version": 1, "version_boundaries": [] },
      "ai.recommendation_rate": { "unit": "ratio", "aggregation": "prompt_weighted", "observation_class": "consumer_ui", "is_estimate": false,
                                  "window": { "from": "2026-09-02", "to": "2026-09-29", "timezone": "America/New_York" },
                                  "filters": { "panel_id": "0192e0...01", "include_branded": false, "entity_id": "0192c0...00" },
                                  "method": "Share of answers where the own brand is recommended; unmentioned counts as not recommended; unclassified mentions excluded", "method_version": 1, "version_boundaries": [] }
    }
  }
}
```

In the Gemini recommendation cell, the one mention was not classified, so it leaves the denominator (doc 16 A5: classified observations plus observations without a mention). The denominator is 3 while `n_observations` stays 4, and the difference is the classification gap the UI shows. `ai.flip_rate` is the doc 17 section 8.1 flip rate (flips over T minus 1 consecutive pairs).

### 4.5 SEO and AI matrix row

`GET {P}/xch/matrix/rows?location_id=2840&device=desktop&filter[quadrant]=seo_strong_ai_weak` (one row; `meta.definition` and `meta.metric_context` omitted for length).

```json
{
  "tracked_keyword_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
  "keyword": "best crm for startups", "location_id": 2840, "device": "desktop", "resolution": "exact",
  "search_volume": 1900, "keyword_difficulty": 58, "intent": "commercial",
  "organic": {
    "latest": { "state": "ranked", "rank": 4, "absolute_rank": 7, "depth_requested": 20, "url": null, "observed_at": "2026-09-29T06:41:12Z", "serp_snapshot_id": "88410231" },
    "median_window": 5.0, "bucket": "4_10", "class": "strong"
  },
  "aio": {
    "presence_rate": { "metric": "seo.aio_presence_rate", "value": 0.9286, "numerator": 26, "denominator": 28, "n_observations": 28, "n_keywords": 1 },
    "own_citation_rate": { "metric": "seo.aio_citation_rate", "value": 0.0385, "numerator": 1, "denominator": 26, "n_observations": 26, "n_keywords": 1, "ci": { "low": 0.007, "high": 0.189, "level": 0.95, "method": "wilson" } },
    "own_mention_rate": { "metric": "ai.mention_rate", "engine_code": "google_ai_overview", "value": 0.1154, "numerator": 3, "denominator": 26, "n_observations": 26, "ci": { "low": 0.04, "high": 0.29, "level": 0.95, "method": "wilson" } }
  },
  "ai_mode": { "source": "linked_prompts",
               "own_mention_rate": { "metric": "ai.mention_rate", "engine_code": "google_ai_mode", "value": null, "numerator": 1, "denominator": 3, "n_observations": 3, "n_prompts": 3, "suppressed_reason": "insufficient_data" } },
  "engines": {
    "chatgpt_web": {
      "mention_rate": { "metric": "ai.mention_rate", "engine_code": "chatgpt_web", "value": 0.0833, "numerator": 0.25, "denominator": 3, "n_observations": 16, "n_prompts": 3, "pooled": { "successes": 1, "trials": 16 } },
      "citation_rate": { "metric": "ai.citation_rate", "engine_code": "chatgpt_web", "value": 0.0, "numerator": 0, "denominator": 3, "n_observations": 16, "n_prompts": 3, "pooled": { "successes": 0, "trials": 16 } }
    },
    "gemini_web": {
      "mention_rate": { "metric": "ai.mention_rate", "engine_code": "gemini_web", "value": 0.0, "numerator": 0, "denominator": 3, "n_observations": 8, "n_prompts": 3, "pooled": { "successes": 0, "trials": 8 } },
      "citation_rate": { "metric": "ai.citation_rate", "engine_code": "gemini_web", "value": 0.0, "numerator": 0, "denominator": 3, "n_observations": 8, "n_prompts": 3, "pooled": { "successes": 0, "trials": 8 } }
    }
  },
  "ai_presence": { "metric": "ai.mention_rate.engine_average", "value": 0.0662, "numerator": 0.1987, "denominator": 3, "n_observations": 50, "engines": ["chatgpt_web", "gemini_web", "google_ai_overview"] },
  "ai_class": "weak", "quadrant": "seo_strong_ai_weak",
  "linked_prompts": { "count": 3, "primary": { "prompt_id": "0192e5...10", "text": "What is the best CRM for a 20-person SaaS startup?" } },
  "seo_leader": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
  "ai_leader": { "entity_id": "0192c1...01", "canonical_name": "HubSpot", "entity_type": "brand", "role": "competitor", "color_index": 2 },
  "owned_page_cited": { "url_id": "812120", "canonical_url": "https://acme.io/pricing", "host": "acme.io", "registrable_domain": "acme.io", "path": "/pricing" },
  "gsc": null,
  "week_start": "2026-09-28"
}
```

For prompt-weighted rates the `numerator` is the sum of per-prompt rates and the `denominator` the number of prompts with observations, so `value = numerator / denominator` always holds; `pooled` carries the raw success and trial counts for display ("1 of 16 answers").

### 4.6 Metric response with interval, comparison and version boundaries

`GET {P}/ai/metrics/ai.mention_rate?engine_codes=chatgpt_web,gemini_web&window=last_28d&compare=previous_period`

```json
{
  "data": [
    {
      "metric": "ai.mention_rate",
      "current": {
        "metric": "ai.mention_rate", "engine_code": "chatgpt_web", "entity_id": "0192c0...00",
        "value": 0.342, "numerator": 85.5, "denominator": 250, "unit": "ratio",
        "n_observations": 1450, "n_prompts": 250, "pooled": { "successes": 509, "trials": 1450 },
        "ci": { "low": 0.309, "high": 0.375, "level": 0.95, "method": "normal_fixed_panel" },
        "aggregation": "prompt_weighted",
        "window": { "from": "2026-09-02", "to": "2026-09-29", "timezone": "America/New_York" },
        "filters": { "panel_id": "0192e0...01", "include_branded": false, "subject": "prompts" },
        "observation_class": "consumer_ui", "engines": ["chatgpt_web"], "is_estimate": false,
        "method": "Prompt-weighted share of valid answers that name the own brand", "method_version": 1,
        "version_boundaries": [
          { "at": "2026-09-17T00:00:00Z", "component": "model_reported:chatgpt_web", "from": "chatgpt-web-2026-08", "to": "chatgpt-web-2026-09" }
        ]
      },
      "previous": {
        "metric": "ai.mention_rate", "engine_code": "chatgpt_web", "entity_id": "0192c0...00",
        "value": 0.301, "numerator": 75.25, "denominator": 250, "unit": "ratio",
        "n_observations": 1438, "n_prompts": 250, "pooled": { "successes": 440, "trials": 1438 },
        "ci": { "low": 0.269, "high": 0.333, "level": 0.95, "method": "normal_fixed_panel" },
        "aggregation": "prompt_weighted",
        "window": { "from": "2026-08-05", "to": "2026-09-01", "timezone": "America/New_York" },
        "filters": { "panel_id": "0192e0...01", "include_branded": false, "subject": "prompts" },
        "observation_class": "consumer_ui", "engines": ["chatgpt_web"], "is_estimate": false,
        "method": "Prompt-weighted share of valid answers that name the own brand", "method_version": 1, "version_boundaries": []
      },
      "delta": {
        "value": 0.041, "ci": { "low": 0.012, "high": 0.071, "level": 0.95, "method": "paired_bootstrap" },
        "is_detectable": true, "label": "detectable_change", "discordant": { "gained": 41, "lost": 19 }
      },
      "boundaries_straddled": [
        { "at": "2026-09-17T00:00:00Z", "component": "model_reported:chatgpt_web", "from": "chatgpt-web-2026-08", "to": "chatgpt-web-2026-09" }
      ]
    },
    {
      "metric": "ai.mention_rate",
      "current": {
        "metric": "ai.mention_rate", "engine_code": "gemini_web", "entity_id": "0192c0...00",
        "value": 0.284, "numerator": 71, "denominator": 250, "unit": "ratio",
        "n_observations": 250, "n_prompts": 250, "pooled": { "successes": 71, "trials": 250 },
        "ci": { "low": 0.232, "high": 0.343, "level": 0.95, "method": "wilson" },
        "aggregation": "prompt_weighted",
        "window": { "from": "2026-09-02", "to": "2026-09-29", "timezone": "America/New_York" },
        "filters": { "panel_id": "0192e0...01", "include_branded": false, "subject": "prompts" },
        "observation_class": "consumer_ui", "engines": ["gemini_web"], "is_estimate": false,
        "method": "Prompt-weighted share of valid answers that name the own brand (one observation per prompt: pooled Wilson interval)", "method_version": 1,
        "version_boundaries": []
      },
      "previous": {
        "metric": "ai.mention_rate", "engine_code": "gemini_web", "entity_id": "0192c0...00",
        "value": 0.296, "numerator": 74, "denominator": 250, "unit": "ratio",
        "n_observations": 250, "n_prompts": 250, "pooled": { "successes": 74, "trials": 250 },
        "ci": { "low": 0.243, "high": 0.355, "level": 0.95, "method": "wilson" },
        "aggregation": "prompt_weighted",
        "window": { "from": "2026-08-05", "to": "2026-09-01", "timezone": "America/New_York" },
        "filters": { "panel_id": "0192e0...01", "include_branded": false, "subject": "prompts" },
        "observation_class": "consumer_ui", "engines": ["gemini_web"], "is_estimate": false,
        "method": "Prompt-weighted share of valid answers that name the own brand (one observation per prompt: pooled Wilson interval)", "method_version": 1,
        "version_boundaries": []
      },
      "delta": { "value": -0.012, "ci": { "low": -0.061, "high": 0.037, "level": 0.95, "method": "mcnemar_exact" },
                 "is_detectable": false, "label": "within_normal_variation", "discordant": { "gained": 22, "lost": 25 } },
      "boundaries_straddled": []
    },
    {
      "metric": "ai.mention_rate.engine_average", "entity_id": "0192c0...00",
      "value": 0.313, "numerator": 0.626, "denominator": 2, "unit": "ratio",
      "n_observations": 1700, "n_prompts": 250, "aggregation": "prompt_weighted",
      "window": { "from": "2026-09-02", "to": "2026-09-29", "timezone": "America/New_York" },
      "filters": { "panel_id": "0192e0...01", "include_branded": false, "subject": "prompts" },
      "observation_class": "consumer_ui", "engines": ["chatgpt_web", "gemini_web"], "is_estimate": false,
      "method": "Equal-weight average of per-engine values; engines are not pooled by observation count", "method_version": 1,
      "version_boundaries": [
        { "at": "2026-09-17T00:00:00Z", "component": "model_reported:chatgpt_web", "from": "chatgpt-web-2026-08", "to": "chatgpt-web-2026-09" }
      ]
    }
  ],
  "meta": { "data_version": 18412, "cache": "hit", "partial_last_day": true }
}
```

The engine average carries no `ci` in the default response; its interval is available from `GET {P}/ai/stats/interval?metric=ai.mention_rate.engine_average&method=bootstrap_cluster` (Phase 14).

### 4.7 Problem details

Quota exceeded on bulk keyword creation (nothing written):

```json
{
  "type": "https://<domain>/api/problems/quota_exceeded",
  "title": "Workspace quota exceeded",
  "status": 422,
  "detail": "Creating 1,200 tracked keywords would exceed the workspace limit of 5,000 active tracked keywords (4,410 in use).",
  "instance": "/api/v1/workspaces/0192d1.../projects/0192d2.../tracked-keywords/bulk-create",
  "code": "quota_exceeded",
  "request_id": "req_01J9ZD2K7M4N6P8Q0R2S4T6V8W",
  "quota": "max_tracked_keywords",
  "limit": 5000,
  "used": 4410,
  "requested": 1200
}
```

Sensitive action without a fresh session:

```json
{
  "type": "https://<domain>/api/problems/fresh_session_required",
  "title": "Re-authentication required",
  "status": 403,
  "detail": "Creating an API key requires signing in again within the last 10 minutes.",
  "instance": "/api/v1/workspaces/0192d1.../api-keys",
  "code": "fresh_session_required",
  "request_id": "req_01J9ZD3A1B2C3D4E5F6G7H8J9K",
  "reauth_url": "https://<domain>/reauthenticate?return_to=%2Fsettings%2Fapi-keys"
}
```

## 5. Outbound webhooks (alerts to Slack and custom URLs)

### 5.1 Endpoints and events

Webhook endpoints are workspace resources (section 3.11.5) referenced by alert rule destinations. Two kinds:

| Kind | Body | Signature |
|---|---|---|
| `slack_incoming` | Slack incoming-webhook JSON (`text` plus `blocks`) rendered from the event | Not signed (Slack incoming webhooks do not verify signatures); the URL itself is the secret and is stored in `ops.secrets` (`webhook_secret`) |
| `custom` | The JSON envelope below | HMAC-SHA256, section 5.3 |

Event types:

| Type | Sent when | Phase |
|---|---|---|
| `alert.fired` | An alert event is created for a rule with `digest_mode = 'immediate'` (critical rule types, max 10 per project per hour, then rolled into the digest; doc 08 section 12.2) | 5 |
| `alert.digest` | An hourly or daily digest is sent | 5 |
| `alert.anomaly_hold` | Alerts for a day are held by the mass-movement anomaly check (doc 17 section 10) | 5 |
| `webhook.test` | `POST .../test` | 5 |

### 5.2 Payload envelope

```json
{
  "id": "0192f7aa-51c0-7e3d-8b21-6c9d0e1f2a3b",
  "type": "alert.fired",
  "api_version": "v1",
  "created_at": "2026-09-29T07:02:14Z",
  "workspace_id": "0192d1...",
  "project_id": "0192d2...",
  "data": {
    "alert_event": {
      "alert_event_id": "901233",
      "rule": { "alert_rule_id": "0192e9...", "name": "Priority 1 keywords: drop of 5+", "rule_type": "rank_drop" },
      "event_kind": "rank_drop", "severity": "critical",
      "subject": { "type": "tracked_keyword", "id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11", "label": "best crm for startups (US, desktop)" },
      "evidence": { "from_rank": 3, "to_rank": 11, "depth_requested": 20, "serp_snapshot_id": "88410231", "previous_serp_snapshot_id": "88300112" },
      "occurred_at": "2026-09-29T06:41:12Z",
      "links": { "app": "https://<domain>/w/acme/p/acme-us/keywords/0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
                 "api": "/api/v1/workspaces/0192d1.../projects/0192d2.../alert-events?filter[subject_id]=0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11" }
    }
  }
}
```

`alert.digest` carries `data.digest` with `digest_id`, `period_start`, `period_end`, `event_count`, the top 20 items grouped by rule (sorted by priority and search volume, doc 08 section 12.2), and a link to the full list. Payloads are at most 256 KB; larger digests are truncated to the top items with `truncated: true`. Payloads never contain answer text, SERP snippets, or GSC query text; they carry ids and labels only, so a receiver fetches details through the API with its own credentials.

### 5.3 Signature

Headers on every `custom` delivery:

```
Content-Type: application/json
User-Agent: <product>-webhooks/1
Webhook-Id: 0192f7aa-51c0-7e3d-8b21-6c9d0e1f2a3b
Webhook-Timestamp: 1790665334
Webhook-Signature: v1=5f2b0c8e...e91a, v1=0a77c1d4...33bf
```

- `signed_payload = Webhook-Id + "." + Webhook-Timestamp + "." + raw_request_body` (exact bytes).
- `v1 = hex(HMAC-SHA256(signing_secret, signed_payload))`. The signing secret is 32 random bytes, shown once as `whsec_<base64url>`.
- During secret rotation (`rotate-secret`, default overlap 24 hours) the header contains one `v1=` value per valid secret. Receivers accept the request if any value matches.
- Receivers must compare in constant time and reject timestamps more than 5 minutes from their clock to prevent replay.
- `Webhook-Id` equals the envelope `id` and is stable across retries of the same event; receivers deduplicate on it.

### 5.4 Delivery and retries

- Delivery runs as a Taskiq task on the worker's `collect` queue under the SSRF rules of doc 24 section 7.3 (http or https on ports 80 and 443, resolved-IP checks, no private ranges, redirects re-checked, maximum 5). The URL is validated at creation and again at every delivery.
- Timeout 10 seconds. Any `2xx` is success. `410 Gone` disables the endpoint immediately (`disabled_reason = 'gone'`).
- Other failures (non-2xx, timeout, connection error, SSRF rejection after DNS change) retry at 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours after the previous attempt, each with up to 20% jitter: 8 attempts over about 45 hours. After the last attempt the delivery is `gave_up`.
- After 20 consecutive deliveries end in `gave_up`, or no success for 72 hours with at least 10 attempts, the endpoint is disabled (`disabled_reason = 'failing'`) and workspace admins receive an in-app and email notice.
- Delivery is at-least-once and unordered. Every attempt is recorded (proposed `ops.webhook_deliveries`, section 8 item 8) with status, HTTP status and latency; response bodies are not stored.
- Slack deliveries use the same retry schedule; Slack's `429` honors `Retry-After`.

## 6. Performance targets

Targets are p95 server time on the V1 droplet with production-shaped data (doc 03 section 5; doc 16 section 13.4), measured by a timing middleware in the FastAPI app and reported through Sentry performance monitoring (10% sampling); nothing is exported to Prometheus (ADR-022). A route class that misses its target for 3 consecutive days raises a Sentry alert; the API's scaling trigger is overall p95 above 300 ms (doc 03 section 5).

| Endpoint class | Examples | p95 target | Mechanism |
|---|---|---|---|
| Overview tiles (12 metrics, one engine set, 28 days) | `{P}/seo/metrics/overview`, `{P}/ai/metrics/overview` | 300 ms | Rollups plus Redis cache (5 minutes, keyed by `data_version`) |
| Prompt Explorer list (1,000 prompts x 4 engines, 28 days) | `{P}/ai/prompt-explorer` | 500 ms | `ai.daily_prompt_engine_metrics`, server-side sort and keyset pagination |
| SOV over 12 weeks | `{P}/ai/metrics/ai.share_of_voice/series` | 200 ms | Rollups and denominator view (spike S-09) |
| Bootstrap intervals (on demand) | `{P}/ai/stats/interval?method=bootstrap_cluster`, `{P}/ai/stats/compare` | 1.5 s | Per-prompt aggregates (at most 10,000 rows) in Python (NumPy), cached by `data_version` |
| Citation intelligence (top domains, 90 days) | `{P}/ai/sources/domains`, `{P}/ai/sources/pages` | 800 ms | `ai.daily_domain_citations` |
| Configuration reads | project, prompt, entity, schedule GETs | 100 ms | Primary key lookups |
| Configuration writes | PATCH and single POST | 200 ms | Single transaction |
| Bulk writes (up to 1,000 items) | `bulk-create`, `bulk-update` | 2 s | One statement per batch |
| Tracked keyword list (page of 50 with `include=sparkline,competitors,metrics`) | `{P}/tracked-keywords` | 400 ms | `seo.tracked_keyword_state`, covering index for sparklines (doc 08 section 7) |
| Rank history (one keyword, 1 year, 11 entities) | `rank-history` | 250 ms | `seo.domain_rank_observations` index on `(tracked_keyword_id, entity_id, observed_at)` |
| SEO series and breakdowns | `visibility-series`, `sov-series`, `breakdown` | 300 ms | `seo.daily_project_metrics` |
| SERP snapshot detail | `{P}/serp-snapshots/{id}` | 150 ms without titles; 800 ms with `include=titles` on a cache miss | Compact arrays in PostgreSQL; R2 plus Redis for titles |
| Observation detail | `{P}/ai/observations/{id}` | 200 ms with `observed_at` hint | Partition-pruned primary key |
| Observation and citation lists | `{P}/ai/observations`, `{P}/ai/citations` | 400 ms | Indexed filters, 90-day list limit |
| Matrix (1,000 keywords, 1,000 prompts) | `{P}/xch/matrix`, `{P}/xch/matrix/rows` | 800 ms | `core.xch_keyword_weekly` (doc 29 Phase 10 acceptance) |
| Page intelligence detail | `{P}/pages/{url_id}` | 800 ms | Page rollups joined on `url_id` |
| Diagnostics | `{P}/diagnostics/*` | 1.5 s | Parallel evidence queries; cached 5 minutes |
| Async starts | `check-now`, `run-now`, imports, exports | 300 ms to the 202 | Only planning rows and an enqueue; live check result in under 10 s end to end (doc 21 section 11) |
| Import preview | 5,000-row CSV | under 2 minutes to `preview_ready` (doc 29 Phase 3) | Taskiq task on the `process` queue |
| Exports | 50,000 rows | under 60 s to `ready` | Streaming cursor to R2 |
| Health | `/api/healthz`, `/api/readyz` | 20 ms, 100 ms | No heavy checks |

Statement timeouts protect the process: 2 s for configuration routes, 5 s for analytics routes, 10 s for statistics and diagnostics. A timeout returns `503 query_timeout`, never a partial result.

## 7. Endpoint count by phase

Counts are of catalog rows in section 3 (one method plus path per row), generated from the `Ph` column; CI regenerates this table from the `x-phase` extensions and fails if it drifts. MVP is Phases 0 to 9 plus 10a (doc 29). Phase 0 ships no routes.

| Phase | Name (doc 29) | MVP | New endpoints | Main areas |
|---|---|---|---|---|
| 1 | Platform foundation | yes | 54 | 16 auth module routes, `/api/v1/me`, workspaces, members, invitations, roles, quotas, audit, projects, budgets, health, component versions |
| 2 | Entities, domains, taxonomy | yes | 29 | Entities, aliases, entity domains, project entities, alias test, vocabularies, terms, term assignments, locations, domain categories |
| 3 | SEO keyword system | yes | 49 | Keywords, tracked keywords and bulk operations, groups, imports, keyword metrics, schedules, runs, costs, price book, exports |
| 4 | SEO rank collection | yes | 24 | Rank history, SERP snapshots and raw, features, AIO history, rank events, check-now, tasks, providers, unit costs, ops summaries |
| 5 | SEO analytics | yes | 37 | SEO metrics, competitors, keyword gap, landing pages, cannibalization, competitor suggestions, alerts, digests, webhook endpoints, workspace exports |
| 6 | AI prompt system | yes | 29 | Prompts, versions, lint, template preview, panels, memberships, engines, manual keyword-prompt links |
| 7 | AI collection | yes | 6 | Run-prompt-now, AI run coverage, observations and raw, citations |
| 8 | AI extraction | yes | 9 | Derivations, extraction preview, re-derivations, entity candidates |
| 9 | AI analytics | yes | 16 | AI metrics, breakdowns, Prompt Explorer, competitors, statistics drawer, top sources, fan-out, panel sizing and promotion |
| 10a | SEO and AI integration (MVP slice) | yes | 9 | Link suggestions, keyword matrix, AIO citation by rank bucket, page intelligence |
| **MVP total** | | | **262** | |
| 10b | SEO and AI integration (rest) | no | 7 | Cluster matrix, competitor cross-channel, domain dominance, rank and citation association, keywords-to-prompts, AI-first opportunities |
| 11 | Keyword and prompt discovery | no | 29 | Keyword and prompt candidate inboxes, discovery jobs, clustering, GSC connect and basic sync, AI demand |
| 12 | First-party integrations | no | 16 | API-token connections, file imports, first-party metrics, GSC pages, referrals, crawlers, Bing and gen AI imports, rule and bot registries |
| 13 | Source intelligence | no | 12 | Domain detail, categories, new and lost sources, diversity, overlap, retrieved-not-cited, influential pages, category overrides, publishers, publisher opportunities |
| 14 | Advanced statistics and benchmarks | no | 0 | No new routes: adds `method=bootstrap_cluster` and population inference to `{P}/ai/stats/interval`, `serp_volatility` to SEO volatility, BH badges on all mover lists, official API engines through `{P}/engines` and every AI metric route, and `seo.est_clicks_aio_adjusted` |
| 15 | Advanced intelligence | no | 5 | Keyword and prompt diagnostics, claims (reserved schema) |
| V1.5 | Server logs (doc 18) | no | 1 | `POST /api/v1/ingest/logs` |
| **Post-MVP total** | | | **70** | |
| Deferred | API keys (ADR-022) | no | 4 | API key list, create, update, revoke (section 3.2.4) |
| **Total** | | | **336** | |

Per area: auth and session 19, workspaces and administration 30, projects 8, entities 21, taxonomy 9, SEO 55, AI 71, cross-channel 23, discovery 10, first-party 30, operations 58, health 2.

## 8. Gaps and inconsistencies found in the source documents

The API above depends on the following items. Each needs a decision or a doc change before the Phase 0 architecture freeze of doc 19. Item numbers are referenced from sections 2 and 3.

1. **Permission keys.** Resolved: doc 24 section 3.2 now lists every key this specification uses (`workspace:update`, `taxonomy:write`, `alerts:write`, `views:write`, `imports:write`, `api_keys:manage`, `ops:read`, `tasks:requeue`, `fp:logs:write` and the original set); section 2.13 lists them. `ops:manage` was replaced by `ops:read` (reads) and `tasks:requeue` (requeue, retry).
2. **Platform operator.** Resolved: `auth.users.is_platform_operator` (doc 04 section 4, doc 24 section 3.1); catalog pseudo-permission `platform_operator`.
3. **Identity columns.** Resolved in doc 04 section 4: `auth.memberships.project_ids`, `auth.invitations.project_ids`, the `auth.api_keys` fields (scopes, expiry, IP allowlist, per-key rate limit, `last_used_ip`, `revoked_at`) and `auth.workspaces.purge_after`.
4. **`data_version`.** Resolved: `core.projects.data_version` and `core.projects.entity_config_version` are columns (doc 04 section 4; doc 13 section 3 updated).
5. **Idempotency storage.** Resolved: `ops.idempotency_keys` (doc 04 section 11.8). The header itself is deferred (section 2.8); the table stays unused until it ships.
6. **Imports and exports tables.** Resolved: `seo.keyword_imports`, `seo.keyword_import_rows` and `ops.exports` (doc 04 section 11.8). Upload records for presigned URLs remain an implementation detail of the import row (`upload_object_key`).
7. **Generic jobs.** Resolved: `ops.jobs` (doc 04 section 11.8).
8. **Alerts and webhooks.** Resolved: `ops.alert_digests`, `ops.webhook_endpoints`, `ops.webhook_deliveries`, `ops.alert_rules.destinations` and the `webhook` channel (doc 04 section 11.5); secret kind `webhook_signing_secret` (doc 04 section 11.1).
9. **Tables defined outside doc 04.** Mostly resolved: doc 04 section 15 names every companion table as canonical and the keyword import tables moved into doc 04. Open: `core.keyword_weights` (a view used in doc 09 SQL) is still undefined, and some section 15 entries (`ops.task_attempts`, `seo.cannibalization_flags`, `seo.daily_page_metrics`, `ai.citation_entity_links`, `core.workspace_domain_categories`, `ai.external_mention_snapshots`, `ops.data_quality_flags`) have column lists but no DDL yet.
10. **Inbox columns.** Resolved: `snoozed_until` on `seo.keyword_candidates` (doc 08) and `ai.prompt_candidates` (doc 11). Open: `ai.entity_candidates` has no surrogate id, so the API addresses candidates by `normalized_name`.
11. **Current-state columns.** Resolved: `seo.tracked_keyword_state` has `target_url_match`, `aio_state`, `aio_citation_position`, `aio_observation_id` and `current_depth_requested` (doc 04 section 7.6).
12. **Run and task columns.** Resolved: `ops.collection_runs` has `status_reason`, `blocked_by_budget_id`, `created_by_type`, `created_by_id`, `origin_request_id`; `ops.collection_tasks` has `dispatched_at`, `ready_source` and `result_meta`; `superseded_by` is on `seo.serp_snapshots` and `ai.observations` (doc 04).
13. **Workload enums.** Resolved: one canonical list with a mapping table (doc 04 section 11.4.1); the `Budget` and `ScheduleInput` unions here use it.
14. **Engine codes.** Resolved: `perplexity_api` everywhere; the registry list is identical in docs 04 (section 8.1), 07 (section 1), 12 (section 4) and here (section 3.2.5).
15. **Metric contract.** Resolved: doc 16 section 2 now shows the snake_case wire format with the optional fields and the prompt-weighted numerator rule, and doc 16 section 2.1 registers the SEO, fan-out, volatility and surface presence keys. The `unit` enum still has no percent, so visibility is returned as a ratio.
16. **Doc 18 section 11.2.** Resolved: question candidates go to `ai.prompt_candidates`.
17. **Requeue route.** Resolved: docs 20 and 21 use `POST {W}/tasks/{task_id}/requeue` (section 3.11.4).
18. **`fp.gsc_queries` tenancy.** Resolved: doc 04 section 10 defines it with `workspace_id` and RLS (doc 18 amendment A1 applied).
19. **`ProjectSettingsV1`** is referenced by doc 04 but its fields are specified nowhere. Section 3.3 proposes the fields this API needs (default device and depth profile, visibility weights, AI weekday, ChatGPT series choice from doc 07 section 4.2, classifier budget, matrix thresholds).
20. **Archive versus delete.** `seo.tracked_keywords` and `ai.prompts` have `is_active` and `deleted_at` but no archived state. The API treats archive as `is_active = false` (kept, not scheduled, not counted in quotas) and delete as soft delete.
21. **Auth surface.** Resolved by ADR-022: authentication is our own FastAPI module, the route names in section 3.1 are ours, and spike S-07 (Better Auth) is dropped.
22. **Keyword metrics source.** Doc 09 SQL joins `seo.keyword_metrics_current` on `source = 'dataforseo_labs'`, while doc 04 lists three sources. The default source for `search_volume` in API responses is `dataforseo_labs`; a documented fallback order is needed when Labs has no value.
