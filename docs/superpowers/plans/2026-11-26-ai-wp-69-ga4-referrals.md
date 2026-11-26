# WP-69 slice 1: GA4 AI referral sessions, route and Overview card

Branch `ai/wp-69-first-party-signals` (worktree `.claude/worktrees/wp-69`), cut from origin/develop 9e9d1efb on 2026-11-26.
Rows closed: BE-GEO-11, and the GA4 half of WB-XCH-06 (the Overview "AI traffic" card, OV-TRF-01).
Not in this slice (tasks 1 and 3 of the WP file stay open): Cloudflare crawlers, the bot registry, server logs, GSC generative import,
Bing AI import, the landing page breakdown (R2 report), CH-30.

## Why

The Overview card "AI traffic" says "Not collected yet" and always will: nothing reads Google Analytics. A project can link a GA4
property (integrations API, `kind = 'ga4'`), but no schedule exists for it, no client method calls the GA4 Data API, no table holds the
numbers and no route serves them. docs/18 section 7 specifies the sync; this plan builds its first slice.

## Decisions (made here, change them in review if wrong)

1. **One report per run, not R1 and R2.** `runReport` with dimensions `date, sessionSource, sessionMedium, sessionManualSource,
   sessionDefaultChannelGroup` and metrics `sessions, engagedSessions, keyEvents, totalRevenue`, no filter. Classification happens in
   our code (a pure function), and only the rows that are AI under a classifier are stored. The landing page report (R2) is the next
   slice, so `landing_url_id` is always 0 here ("all pages").
2. **`fp.metric_observations` is not created.** docs/18 names it for the raw R1/R2 rows; nothing else needs it yet. Rows go straight to
   `fp.ai_referral_daily`.
3. **Two classifiers stored side by side** (docs/18 7.3): `ga4_ai_assistant_channel` (rows whose `sessionDefaultChannelGroup` is
   `AI Assistant`, `assistant_code` = lowercased `sessionSource`, `rules_version` 0) and `own_rules` (rule set version 1, table
   `fp.ai_referrer_rules`, seeded by the migration). Ambiguous rules are not stored in v1 (the table has no confidence column; the
   headline excludes them anyway). Rows from `google` AI Overview or AI Mode are never produced: GA4 files them under organic search.
4. **Window.** First run pulls the last 90 days; every later run re-pulls the last 3 days (GA4 restates recent days, docs/18 7.2).
   Sync state lives in `fp.integrations.backfill_state["ga4"]` (`{version, through, complete}`), as the GSC pull does for `"gsc"`.
   One `runReport` per run covers the whole window (the `date` dimension splits it), paged with `offset`/`limit` 100000.
   One transaction per run replaces the window: delete rows of (integration, window dates), insert the new ones.
5. **Schedule.** A planner tick (new `collectors/ga4_plan.py`, same shape as `gsc_plan.py`) creates one `ops.schedules` row
   "Daily GA4 sync" per live ga4 integration (workload `ga4_sync`, daily 06:00 in the integration's schedule timezone America/Los_Angeles
   like GSC, window 6 h) and sends a `Ga4SyncTask` when due or unfinished.
6. **Route.** `GET {P}/fp/ai-referrals` exactly as docs/19 3.10 and docs/18 7.3 specify: `window`, `group_by` (`assistant` and `origin`
   built; `landing_page` answers `422 not_available` until R2), `classifier` (`both` default). Response gains `meta.connected`,
   `meta.last_success_at`, `meta.lower_bound: true` and `meta.notes`. `200` with `connected: false` and empty data when the project has no
   live ga4 integration. Each value is the sessions of the window with the previous window of the same length beside it.
7. **Web.** The existing card keeps its states; when the route returns data the body becomes bars of sessions per assistant (flat
   bars, no glow, `BarList` look of the other cards) with previous-window change and the two classifier totals in the table view.
   Nothing is invented: unknown stays "n/a", never 0.

## Tasks (each: a fresh Sonnet implementer writing tests first, then a fresh Sonnet reviewer)

Checks per task are targeted and serial (`pytest --no-cov -n 0 <path>`, `vitest --maxWorkers=1 <path>`); no full suites (owner rule).

### Task 1: Migration 0041, tables, rules seed

Files: `backend/src/idraft/db/migrations/versions/0041_ai_referrals.py`, `backend/src/idraft/db/tables.py`, `backend/tests/db/support.py`,
`test_tables.py`, `test_grants.py`, `test_rls.py` (registrations), `backend/tests/security/test_cross_tenant.py` (`_TENANT_ROWS` and seed),
new `backend/tests/db/test_ai_referrals_schema.py`.
- `fp.ai_referrer_rules`: global, DDL as docs/18 section 7.4 spec (primary key `(rule_set_version, rule_id)`, unique on the
  match tuple); seed the 20 rows of 7.4 as `rule_set_version = 1`. Grants: api and worker `SELECT` only.
- `fp.ai_referral_daily`: DDL as docs/18 spec plus a composite FK `(integration_id, workspace_id)` to `fp.integrations(id, workspace_id)`
  ON DELETE CASCADE (the doc DDL omits it; `gsc_page_daily` has it). RLS `tenant_isolation`. Grants: api `SELECT`, worker
  `SELECT, INSERT, DELETE`. Index `(project_id, metric_date) WHERE is_current`.
- Tests first: schema test (columns, checks reject bad `origin`/`classifier`/`unit`, cascade on integration delete, RLS isolates two
  workspaces, rules seed has 20 rows with unique patterns and `google.com`, `bing.com`, `msn.com` absent, test_migrations single head).

### Task 2: Google client `run_report`

Files: `backend/src/idraft/providers/google/client.py`, `errors.py` (only if needed), `backend/tests/providers/google/fake_google.py`
(add a `:runReport` handler to `FakeGoogle`, JSON body safe), `test_client.py`.
- `GoogleClient.run_report(access_token, property, *, start_date, end_date, dimensions, metrics, offset=0, limit=100000) ->
  Ga4Report` where `Ga4Report` is a frozen slots dataclass `(rows: tuple[Ga4Row, ...], row_count: int, quota_remaining: int | None)` and
  `Ga4Row(dimensions: tuple[str, ...], metrics: tuple[str, ...])` (values stay strings, the caller converts). URL
  `https://analyticsdata.googleapis.com/v1beta/{property}:runReport`, `returnPropertyQuota: true`. Validation: row dimension and metric counts
  must match the request, else `GoogleResponseError`. Missing `rows` means no rows.
- Tests first: parses a page, empty result, offset paging, 401 (token renewed by the caller), 429 and 403-with-quota text to
  `GoogleQuotaError`, other 403 to `GooglePermissionError`, malformed count to `GoogleResponseError`, 5xx retried then `GoogleUnavailableError`.

### Task 3: Classifier, pure

Files: `backend/src/idraft/domain/ai_referrals.py`, `backend/tests/domain/test_ai_referrals.py`.
- `Rule` (frozen dataclass) and `classify(rows, rules) -> list[ReferralRow]` where input rows are
  `(date, source, medium, manual_source, channel_group, sessions, engaged, key_events, revenue)`; output rows are
  `(date, classifier, rules_version, assistant_code, sessions, engaged, key_events, revenue)` summed per key.
- Rules: `utm_source` match beats a referrer-host match, exact beats suffix, ambiguous rules and `google.com`/`bing.com`/`msn.com` never match,
  hosts and patterns compare lowercased, a source of `(direct)` or `(not set)` never matches. GA4 channel classifier: channel group equals
  `AI Assistant` (case-insensitive), code = lowercased source, `rules_version` 0.
- Tests first, one per rule above plus summing of two GA4 rows with the same key and unknown values staying out (never counted as 0).

### Task 4: GA4 sync, planner, worker

Files: `backend/src/idraft/collectors/ga4_sync.py`, `ga4_store.py`, `ga4_plan.py`, `backend/src/idraft/domain/ga4_pull.py`,
`backend/src/idraft/worker/assembly.py` (register the job and the tick, as GSC), `backend/tests/collectors/gsc_support.py` (generalise
`make_property` to `kind`/`external_property`, keep its defaults), `test_gsc_plan.py` (the test
`test_a_ga4_property_is_never_planned_and_does_not_get_a_schedule` is replaced by one saying the GSC planner still does not plan ga4),
new `test_ga4_sync.py`, `test_ga4_plan.py`, `backend/tests/worker/test_assembly.py` (a tick-to-stored-numbers test).
- `sync_integration(ctx, workspace_id, integration_id) -> SyncReport` mirrors `gsc_sync.sync_integration` (same `Outcome`, same
  error mapping: invalid grant marks reauth, permission marks integration error, other Google errors save failed state and retry later,
  unknown errors re-raise after saving). Facts load with `kind == 'ga4'` (parameterise `gsc_store.load_integration`).
- Pull: window as decision 4, one report, rules read once per run, `ga4_store.replace_window(db, facts, start, end, rows)` deletes then
  inserts inside the caller's transaction, every statement names `workspace_id`, then state saved in the same transaction
  (`last_success_at`, `backfill_state["ga4"]`). Idempotent: a second run leaves one copy.
- Quota: `returnPropertyQuota` remaining tokens below 30 percent of the hourly property budget stop the run with state `retry later`
  (docs/18 7.5); no Redis in this slice (in-process only, with a `shortcut:` comment).
- Planner: `ga4_plan.plan_syncs(sessions, send, *, now) -> PlanReport` copies `gsc_plan` for `kind == 'ga4'`; `Ga4SyncTask`
  dedupe key `ga4_sync:{integration_id}`.
- Tests first: first run stores 90 days, rerun replaces not duplicates, ambiguous and organic-search rows are not stored, GA4 channel rows
  stored under the right classifier, invalid grant to reauth_required, 403 to error, 429 to retry later, disabled integration skipped,
  cross-workspace integration id skipped, planner creates one schedule once and never for a disabled or unattached property.

### Task 5: Route `GET {P}/fp/ai-referrals`

Files: `backend/src/idraft/api/fp/__init__.py`, `routes.py`, `service.py`, `repository.py`, `schemas` (in `api/schemas/fp.py`),
`backend/src/idraft/api/main.py` (one import and one `include_router`; the router is not registered yet), `backend/tests/api/fp/`,
`backend/tests/security/test_route_access.py` and `test_cross_tenant.py` (access line and anchor block), `backend/openapi/v1.json`
(regenerated: `cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`), `docs/ai-visibility/contracts/fp-ai-referrals.md`.
- Contract note first, then schemas and the route answering 501, then the body. Permission `data:read`. Query: `window` (the
  project's window grammar used by the other `{P}` data routes), `group_by`, `classifier`.
- One grouped query per classifier window (statement count test), previous window beside it. `difference` is sessions of own rules minus
  sessions of the GA4 channel (null when either is null). `connected` is true when a live ga4 integration exists.
- Tests first: 200 `connected: false` without an integration, data with both classifiers, previous window, group_by origin, 422 for
  `landing_page`, 403 without `data:read`, cross-tenant 404, statement count, no number is invented when a window has no rows (null).

### Task 6: Web card

Files: `apps/web/src/lib/api/schema.ts` (regenerated by `pnpm gen:api`), `apps/web/src/mocks/handlers/` (the module for this feature),
`apps/web/src/features/ai-overview/cards/traffic/referrals-card.tsx`, a new `referrals-body.tsx` (bars and table), `.test.tsx`,
`apps/web/messages/en.json` (`aiOverview.sourcesTracking.referrals`), `docs/design-system/15-data-visualization.md` only if a row is added.
- Invoke the `design-taste-frontend` skill first, then follow `AI_DEVELOPMENT_UI_RULES.md` (tokens, `@/lib/format`, ASCII copy, flat bars
  without glow, `ChartFrame`, Table alternative, every percent with its count, unknown never zero).
- States: no GA4 linked (as today), linked and no data yet (as today), data (bars per assistant with sessions and change against the
  previous window, a note that Google AI Mode and AI Overview are not counted, the classifier toggle `GA4 channel` / `Our rules` with
  the other total and the difference in the table), error with retry, loading skeleton (height already pinned), stale keeps previous data.
- Tests first with MSW: each state above, the empty-after-link state, the toggle, a partial row with null sessions, the not-measured
  platforms (`google_ai_mode`, `google_ai_overview`) still say not measured.

### Task 7: Final review and hand-over

- Fresh Sonnet reviewer reads the whole diff against this plan, runs the targeted tests, runs prove-it-bites on the tenant guards
  (the `workspace_id` predicates of `replace_window` and the route) in a scratch commit that is not pushed.
- Backend: `uv run ruff check`, `ruff format --check`, `mypy` on touched paths. Web: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`
  on touched paths. Full `check.sh`, `pnpm test` and `pnpm build` run only in the release (`infra/ship.sh`), never here.
- As built notes in docs/19 (the route) and docs/18 (section 7: what the slice stores, what is left), and `docs/ai-visibility/inventory`
  rows BE-GEO-11 marked built. Push with `git fetch origin && git rebase origin/develop && git push origin HEAD:develop`.

## Risks

- The GA4 Data API response shape is from the public docs, not a live account (docs/18 marks it UNVERIFIED). The first real run needs a
  linked property; until then only the fake Google proves it. Say so in the hand-over.
- Migration number 0041 can collide with another session's migration: renumber on rebase.
- The GA4 `Ambiguous` rules and the landing page report are deliberately left out; the card never claims more than the stored classifiers.
