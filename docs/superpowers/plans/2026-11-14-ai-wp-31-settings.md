# WP-31 settings: detailed task plan

Brief: [WP-31](../../ai-visibility/work-packages/WP-31-settings-engines.md) (19 rows, 5 steps).
Worktree `.claude/worktrees/wp-31`, branch `ai/wp-31-settings`, cut from origin/develop (head migration 0022).
Written 2026-11-14. Read with AGENTS.md, MASTER-PLAN sections 3 to 6, AI_DEVELOPMENT_UI_RULES.md.

## Ground rules for every task

- One fresh Sonnet implementer per task, then one fresh Sonnet reviewer (PASS or a numbered fix list).
  Tests first: write the cases, run them, see them fail, then write the code. Edit files with the file tools only.
- One commit per task, `WP-31: <task title>`, no attribution lines, no dashes, only this package's files.
- Backend checks (Colima env first: `export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`), always through the medium lane:
  `cd backend && uv run pytest <paths> --no-cov -n 2`, then `uv run ruff check <files>`,
  `uv run ruff format --check <files>`, `uv run mypy <files>`.
- Web checks, from `apps/web`: `pnpm exec vitest run <paths> --maxWorkers=3`, `pnpm lint`, `pnpm typecheck`,
  `pnpm format:check`. `pnpm test`, `pnpm build`, `./check.sh` and `pnpm e2e` only in Task 8, through `infra/dev/heavy`.
- House rules for every web task: design tokens and the 15 `type-*` utilities only, `num` on compared numbers, text
  through `useTranslations`, numbers and dates through `@/lib/format` (never `Intl`, `toFixed`), `money()` for API
  money strings, no em-dash or en-dash and ASCII only in every string, doc and test name, Base UI through
  `components/ui`, features never import another feature (eslint boundaries), Lucide through `Icon`.
- States for every new surface: loading (skeleton, no full-page spinner), empty (reason and action), error (retry
  with the error id), partial, stale (a refetch keeps previous data, `RefetchBar`). Say in the test file which of the
  five do not apply and why (the retention page is static: no read, so no loading or error).
- Each web task also proves: axe clean (`@/test/axe`) in the component test, keyboard path for every action, no
  horizontal scroll at 390 px, Default and Compact density (`h-row` and `h-row-compact` tables), light and dark.
  The reviewer opens the page at 390, 768, 1024 and 1280 px in both themes against the mock
  (`NEXT_PUBLIC_API_MOCKING=all`, web dev server on port 3209, headless Playwright only, stop it after).
- No real provider spend: no test or check turns an engine on against a real provider. Backend tests use the
  testcontainers database and the fixtures in `tests/collectors/ai_support.py`; nothing builds a live
  `DataForSeoClient`. Web tests use MSW only.

## Decisions already taken (recorded, not re-opened)

1. Data retention page is read only. It shows the platform's fixed retention per raw data class from doc 23 section
   9.2: `serp_raw` 400 days, `ai_raw` kept indefinitely (the AI answer class), `first_party_raw` 90 days, `error`
   30 days. No editable setting, no new route. Checked: no existing read exposes it (the only API mentions are the
   `410 raw_expired` problem on the raw answer routes, and `storage/raw.py` `RETENTION`, which no route returns).
2. The Perplexity API row is a static disabled row "Not available yet", class Official API, never pooled.
3. Device per engine is `provider_params.device` on `ProjectEngine`, AI Mode only (`desktop` or `mobile`, default
   `desktop`), changed through the existing `PUT .../engines/{engine_code}` as an additive optional field. The first
   push is the contract: schema fields, ONE regeneration of `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts`.
4. No real provider spend anywhere in this package.

## What the repository says (findings that shape the tasks)

- Device column: `ai.project_engines.provider_params jsonb NOT NULL DEFAULT '{}'` exists since migration 0018
  (`db/tables.py` line 1430). No migration is needed. Nothing reads or writes it today: `save_project_engine`
  leaves it out of the upsert, `ProjectEngineRecord` and `_snapshot` ignore it. Existing rows hold `{}`.
- The collector does not read the device. `providers/dataforseo/ai.py` `ai_mode_body` sends the constant
  `device: desktop, os: windows`, `AiAnswerParams` has no device, and `collectors/ai_prompt.py` `build_requests`
  builds the params without reading the engine's settings. `providers/dataforseo/serp.py` already has the pattern
  (`device` Literal, `_SYSTEMS` per device, default os by device). Minimal change: `AiAnswerParams.device`
  (default `desktop`), `ai_mode_body` sends it with os `windows` for desktop and `android` for mobile, and
  `build_requests` reads `provider_params` for `google_ai_mode` tasks keyed by the task's own workspace, project
  and engine. The desktop request stays byte identical, so `ADAPTER_VERSION` stays 1.
- The mobile os value `android` is taken from the SERP adapter's `_SYSTEMS`; AI Mode with mobile was never sent
  in spike S-04. Treated as an open question with a default (below); tests assert the body only.
- Setup checklist: no `SetupChecklist` exists in `apps/web/src` and no package owns it. Specified in doc 23
  section 13 and doc 25 section 13.1 (path `features/overview/components/setup-checklist.tsx`), shown in the
  design preview at `apps/web/design-preview/index.html` lines 345 to 360 (9 steps). The project root route
  `app/[workspace]/[project]/page.tsx` only redirects until Overview is live (WP-33, WP-40). Data readable today
  without new routes: `GET {P}/engines` (enabled engines, and `active_prompts`, whose largest value is the
  active prompt count because `PROMPT_TEXT_MAX` is the longest any engine takes) and `GET {P}/ai/observations`
  with `limit=1` (any answer in the last 28 days; the API allows up to 92 days).
  Because a feature may not import another feature, Overview cannot import `features/onboarding`; the route file
  composes it (routes may import features).
- Entities "added on": `ProjectEntity.added_at` (core.project_entities.added_at, with `removed_at`) on
  `GET {P}/entities`, already in `schema.ts` and in the mocks (`mocks/entities-state.ts`,
  `handlers/project-entities.ts`). It is the role's date: it is set when the entity joins the project and reset
  to now when a removed entity is added again (`project_service.py` line 206). That is the right date for the SOV
  boundary ("from today"). `Entity.created_at` is the workspace record's date and is wrong for this. No backend
  work. The footnote itself belongs to WP-20, WP-35 and WP-39; this package shows the date and documents the field.
- Existing engines tests: `backend/tests/api/ai/test_engines.py` (9 cases), `backend/tests/domain/test_ai_engines.py`,
  `backend/tests/db/test_ai_schema.py` (`ai.engines` seed only), `backend/tests/ai/test_schedule.py`;
  `apps/web/src/features/prompts/engines.test.tsx` (12 cases). The routes already have their lines in
  `test_route_access.py` and `test_cross_tenant.py`; no route is added, so no new access line is needed.
- doc 20 sections 4.6 and 4.8 are chart and table conventions, not settings. The engines and settings As built
  notes live in doc 20 section 5.19 (Settings), after the existing "Engines (as built ...)" note. See open question 7.

## Files this package does not own that tasks need (ask the coordinator for a lease, record it in tracker.json)

Backend: `backend/src/idraft/api/schemas/ai.py` (`ProjectEngine`, `EngineUpdate` only; the models of WP-12 and
WP-13 stay untouched), `api/ai/engine_routes.py`, `api/ai/engine_repository.py`, `domain/ai_engines.py`,
`collectors/ai_prompt.py` (`build_requests` only; WP-42 owns the planner), `providers/dataforseo/ai.py`
(`AiAnswerParams`, `ai_mode_body`), tests `tests/collectors/ai_support.py` (one optional argument on `enable_engine`)
and `tests/db/test_ai_schema.py` (one new test), `docs/ai-visibility/contracts/README.md` (one index row).
Web: `apps/web/src/features/settings/settings-frame.tsx` and its test (add the `retention` section),
`apps/web/messages/en.json` namespace `settings.items` (one key), `apps/web/src/features/entities/entities-screen.tsx`
and `entities.test.tsx`, `apps/web/src/app/[workspace]/[project]/settings/entities/page.tsx` (pass the project time
zone), `apps/web/src/app/[workspace]/[project]/settings/retention/page.tsx` (WP-02 made it the 404 stub; flip it),
`apps/web/src/app/[workspace]/[project]/planned-routes.test.ts` (remove the retention line),
`apps/web/src/mocks/handlers/prompts.ts`, `mocks/prompts-state.ts`, `mocks/prompt-fixtures.ts` (engine device only).
Mounting the checklist is a one line change in the Overview route files owned by WP-33 or WP-40: WP-31 only exports it.

## Task 1: Device per engine, contract and API (BE-ENGINES-10, part 1)

Files (create): `backend/src/idraft/api/schemas/ai_engines.py`, `backend/tests/api/ai/test_engine_device.py`,
`docs/ai-visibility/contracts/wp-31-engines-device.md`.
Files (change): `domain/ai_engines.py` (`EngineDevice = Literal["desktop", "mobile"]`, `DEFAULT_DEVICE`,
`Engine.supports_device` true for AI Mode only, `device_of(params)` that reads `provider_params` and returns the
default for a missing, junk or unsupported value), `api/schemas/ai.py` (`ProjectEngine.provider_params:
EngineProviderParams` with a default, so the generated client keeps it optional and existing mocks compile;
`EngineUpdate.provider_params: EngineProviderParamsUpdate | None = None`), `api/ai/engine_repository.py`
(`ProjectEngineRecord.provider_params`, `save_project_engine(..., provider_params)` writes it on insert and on
conflict), `api/ai/engine_service.py` (device only: validate, merge, snapshot), `api/ai/engine_routes.py`
(`engine_view` fills `provider_params.device`: the saved device for AI Mode, `desktop` while unconfigured, null for
ChatGPT and Gemini), `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`, `tests/domain/test_ai_engines.py`.
Wire shape: response `provider_params: {device: "desktop" | "mobile" | null}` (null means the engine takes no
device); request `provider_params: {device}` optional. A PUT without `provider_params` keeps the saved device
(a PUT from the countries control must never reset it). AI Mode rows always store `{"device": ...}` on write; other
engines store `{}`. A device for ChatGPT or Gemini is `422 validation_failed` with `device_not_supported` at
`provider_params.device`; a value other than the two is `422` from the `Literal`. No migration, no route added,
no permission change (`projects:write`), audit actions unchanged but `_snapshot` adds `device` for AI Mode only.

Tests first, in `test_engine_device.py` (API with the `api`, `resources`, `migrated` fixtures as in
`test_engines.py`):
- `test_ai_mode_lists_desktop_by_default_and_the_other_engines_list_no_device`
- `test_a_device_is_saved_for_ai_mode_and_read_back` (PUT mobile, GET, and the row holds `{"device": "mobile"}`)
- `test_saving_countries_or_turning_the_engine_off_keeps_the_device`
- `test_a_device_for_chatgpt_or_gemini_is_refused_and_nothing_is_saved` (`provider_params.device`,
  `device_not_supported`)
- `test_a_device_other_than_desktop_or_mobile_is_refused`
- `test_the_device_is_in_the_audit_before_and_after_for_ai_mode_only` (the ChatGPT snapshot keeps its 3 keys, so the
  existing `test_turning_the_first_engine_on_starts_two_runs_a_week` stays green)
- `test_only_a_project_writer_sets_a_device` (viewer, analyst: 403 with a device in the body)
- `test_a_row_with_empty_or_junk_provider_params_reads_as_desktop` (rows inserted with `{}` and with
  `{"device": "tablet"}`)
Guards to break on purpose, each restored after, the failing test recorded in the report:
(a) remove the `supports_device` check in the service: `..._is_refused_and_nothing_is_saved` fails;
(b) make the repository always write the default device: `test_saving_countries_or_turning_the_engine_off_keeps_the_device`
fails; (c) declare the update device as `str`: `test_a_device_other_than_desktop_or_mobile_is_refused` fails;
(d) drop `device` from `_snapshot`: the audit test fails; (e) make `device_of` return the raw value: the junk row
test fails; (f) remove `require_permission` effect by calling the service with `ReadData`: the writer test fails.
Route access and cross-tenant: routes unchanged, so no new lines; run
`uv run pytest tests/api/test_route_access.py tests/security/test_cross_tenant.py --no-cov -n 2` once to show both
stay green.
Contract push: after the tests pass, regenerate `cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`,
then `cd apps/web && pnpm gen:api && pnpm typecheck && pnpm exec vitest run src/lib/api/schema.test.ts`. The contract
note lists the fields, the default, the 422 codes, "no migration", the collector change of Task 2 and a change log.
Checks: `uv run pytest tests/api/ai/test_engine_device.py tests/api/ai/test_engines.py tests/domain/test_ai_engines.py
tests/api/test_openapi.py tests/api/test_route_access.py --no-cov -n 2`, ruff, mypy on the changed files.
Rows closed: BE-ENGINES-10 (setting and API; Task 2 makes the request use it). Push after this task (contract first),
then `infra/dev/wp-status WP-31 building`.

## Task 2: AI Mode request uses the device (BE-ENGINES-10, part 2)

Files: `backend/src/idraft/providers/dataforseo/ai.py` (`AiAnswerParams.device`, `ai_mode_body`),
`backend/src/idraft/collectors/ai_prompt.py` (`build_requests`: one query for the project engines of the AI Mode
tasks, `ai_project_engines` rows by `(workspace_id, project_id, engine_code)` of each task, mapped through
`device_of`), `backend/tests/providers/dataforseo/test_ai.py`, `backend/tests/collectors/test_ai_prompt.py`,
`backend/tests/collectors/ai_support.py` (`enable_engine(..., provider_params: str = "{}")`).
Tests first:
- `test_an_ai_mode_task_is_a_windows_desktop_search` stays as is (default device).
- `test_an_ai_mode_task_for_mobile_asks_a_mobile_device` (device `mobile`, os `android`, keyword unchanged)
- `test_a_scraper_task_never_carries_a_device` (ChatGPT and Gemini bodies have no `device` or `os`)
- `test_a_device_other_than_desktop_or_mobile_is_not_a_valid_ai_request` (`AiAnswerParams` validation)
- collector: `test_an_ai_mode_request_asks_the_device_the_project_chose` (two projects in the workspace, one mobile
  and one desktop, each request carries its own), `test_a_request_for_an_engine_without_settings_asks_desktop`,
  `test_chatgpt_requests_ignore_provider_params`.
  Existing `test_a_request_asks_the_prompt_as_saved_at_its_location_and_queue` stays green unchanged (the default
  `AiAnswerParams` still compares equal).
Guards to break: drop the `project_id` filter of the device query (the two projects test fails); drop the
`workspace_id` filter (add a third row in another workspace with the same project id shape and assert it is not
used); make `ai_mode_body` ignore the device (the mobile test fails); apply the device to scrapers (the scraper
test fails).
No provider call: only `ai_mode_body`, `AiAnswerParams` and `WORKLOAD.build_requests` run; nothing submits.
Checks: `uv run pytest tests/providers/dataforseo/test_ai.py tests/collectors/test_ai_prompt.py
tests/collectors/test_fetching.py --no-cov -n 2`, ruff, mypy, and `uv run lint-imports` if the project defines it
(see `backend/check.sh`).
Rows closed: BE-ENGINES-10 (complete). Changed behavior note for the contract note: the device applies to tasks not
yet posted; answers already collected keep the device the provider reported (`ai.observations.device`).

## Task 3: Built engine rows confirmed (BE-ENGINES-01 to 04 and 12)

Purpose: each built row has a test that names it. Write the missing assertions only; do not change production code.
Files: `backend/tests/api/ai/test_engines.py` (additions), `backend/tests/db/test_ai_schema.py` (one test),
`backend/tests/domain/test_ai_engines.py` (one parametrized test if missing).
Audit table (the implementer confirms by reading, then adds what is missing):
- 01 registry seed: `test_ai_schema.py::test_the_engines_are_seeded_as_the_code_knows_them` covers it; add an
  assertion that `exposes_fanout`, `exposes_citations` and `max_prompt_chars` per engine match `ENGINES` if the
  current test does not compare them.
- 02 `ai.project_engines`: no schema test today. Add `test_project_engines_hold_one_to_fifty_locations_and_a_replicate_count`
  (location_ids empty and 51 entries and replicates 0 and 21 are refused by the CHECKs, the primary key is
  `(project_id, engine_code)`, the engine code must exist, `provider_params` defaults to `{}`).
- 03 routes: add `test_engines_of_a_deleted_project_are_not_found` (GET, PUT, DELETE answer 404),
  `test_location_ids_must_hold_between_one_and_fifty_countries` (empty and 51 ids are `422`) and
  `test_saving_an_engine_twice_with_the_same_settings_changes_nothing_but_the_audit` (idempotent PUT).
- 04 schedule on first enable: `test_turning_the_first_engine_on_starts_two_runs_a_week` covers the two windows;
  add `test_two_engines_turned_on_at_once_make_the_schedules_once` (`asyncio.gather` of two PUTs, exactly two
  `ai_prompt` schedules). If the test cannot fail without `lock=True` in `put_engine`, say so in the report and
  keep it as a regression test.
- 12 coverage per country: `test_an_engine_runs_in_active_countries_only` runs ChatGPT only. Parametrize it over all
  three engine codes, and add `test_an_inactive_country_is_refused_for_every_engine` (location with `is_active`
  false).
Guards to break: remove the `runnable` check in `put_engine` (the city and inactive tests fail); remove `lock=True`
(the gather test, if it can bite); weaken `Engine.runs_at` to accept any type (the parametrized city test fails).
Checks: `uv run pytest tests/api/ai/test_engines.py tests/db/test_ai_schema.py tests/domain/test_ai_engines.py
tests/ai/test_schedule.py --no-cov -n 2`, ruff, mypy.
Rows closed: BE-ENGINES-01, 02, 03, 04, 12. Push after this task (backend complete).

## Task 4: Engines page, class, Perplexity row, cost change summary (WB-SET-06, 07, 08; confirms WB-SET-01 to 03, WB-IA-09)

Files (change): `apps/web/src/features/prompts/engines-screen.tsx`, `apps/web/src/features/prompts/engines.test.tsx`,
`apps/web/messages/en.json` (namespace `aiEngines`, additive keys only).
Files (create): `apps/web/src/features/prompts/engine-cost-model.ts` and `engine-cost-model.test.ts` (pure).
Design (the built screen keeps its row layout, see open question 1):
- Class: a neutral `Badge` after the engine name with the label from `engine.observation_class`: Consumer UI, SERP AI,
  Official API (keys `aiEngines.classes.consumer_ui` and so on), with a visually hidden "Class:" prefix. Unknown
  class from a newer API falls back to the raw code, never blank.
- Perplexity: after the three API rows, a static list item "Perplexity API", class Official API, a disabled
  `Switch` with an accessible name, and the text "Not available yet". No query, no PUT, no country field, not counted
  in any total, never pooled.
- Cost change summary: `engineCostChange(engines, code, turnedOn)` returns `{ delta: number | null, enabledTotal:
  number | null, enabledCount }` from the loaded list (`estimated_monthly_cost_usd`, `money()`); null when a price is
  missing (unknown is never zero). After a successful on or off save the screen shows one `Banner tone="info"
  placement="region"` (live region): "Estimated cost change: about {amount} a month {direction, select, up
  {more} down {less}}. Estimated total for {count, plural, one {# engine} other {# engines}} that are on: {total} a
  month. Estimate from the price book." With a missing price: "No price is on record, so the change is not
  estimated." Country-only saves show none (the cost does not depend on countries). The banner stays until the next
  save starts; it is not dismissible (it states a consequence of the numbers on screen). `announce()` is not
  repeated (the Banner is the live region).
Tests first (`engines.test.tsx` additions and the model test): class badge per engine with the accessible text;
Perplexity row present, switch disabled, text "Not available yet", no request sent when it is focused or clicked;
turning ChatGPT on shows "about $1.56 a month more" with 150 prompts (mock price), turning it off shows "less" and a
total that excludes it; a missing price shows the not-estimated sentence and no number; a country change shows no
summary; the summary is gone after the next save starts; read-only member sees no switches enabled and no summary;
axe clean with the summary and the Perplexity row; model tests for sums, null price and zero engines.
Confirm built rows by naming the existing tests in the report: WB-SET-01 `shows each engine with its switch...`,
WB-SET-02 `turns an engine off at once, keeping its countries` and the `saveFailed` cases, WB-SET-03 add one
assertion that the description says "twice a week, on Monday and Thursday" if no test pins it, WB-IA-09 the settings
frame test lists Engines (`features/settings/settings-frame.test.tsx`).
Checks: `pnpm exec vitest run src/features/prompts/engines.test.tsx src/features/prompts/engine-cost-model.test.ts
src/i18n --maxWorkers=3`, then lint, typecheck, format:check.
i18n: `aiEngines` only. Rows closed: WB-SET-06, WB-SET-07, WB-SET-08; confirmed WB-SET-01, 02, 03, WB-IA-09.

## Task 5: Device selector for AI Mode (web side of BE-ENGINES-10)

Depends on Task 1 being on develop with the regenerated `schema.ts` (it is the contract push).
Files (change): `apps/web/src/features/prompts/engines-screen.tsx`, `engines.test.tsx`, `apps/web/src/features/prompts/prompt-queries.ts`
only if the PUT body type needs a helper, `apps/web/src/mocks/prompts-state.ts` (`StoredEngine.device`),
`apps/web/src/mocks/handlers/prompts.ts` (`engineView` returns `provider_params`, the PUT handler accepts the
optional field, refuses a device for ChatGPT and Gemini with `422 device_not_supported`, keeps the saved device when
the field is absent), `apps/web/src/mocks/prompt-fixtures.ts`, `apps/web/src/mocks/handlers/prompts.test.ts`
(the mock answers what the schema says), `apps/web/messages/en.json` (`aiEngines.device*`).
Design: when `engine.provider_params?.device` is a string (the API's signal that the engine takes a device), the
row shows a `SegmentedControl semantics="radio"` named "Device of {engine}" with Desktop and Mobile (labels reuse the
words of `prompts.filters.devices` through their own `aiEngines` keys), and a hint "Applies from the next run.
Answers already collected keep the device they were collected on." For an engine that is on, a change saves at once
with `provider_params: { device }` plus its current countries and `is_enabled: true`; for one that is off, the choice
is held and sent with the turn-on. Every other save (switch off, countries) sends no `provider_params`. The control
is disabled without `projects:write`. A `device_not_supported` refusal reads as the generic save error row.
Tests first: the control shows only on AI Mode; shows the saved device; a change of an engine that is on sends
`provider_params.device` once and keeps countries; a change while off sends nothing until turn-on and then sends it
once; turning off and country changes send no `provider_params` (RecordPuts helper in `engines.test.tsx`); failure
keeps the old value and says so in words; viewer sees it disabled; keyboard: arrow keys move, a change announces;
axe; phone width wraps without overflow (class assertions are not enough, the reviewer checks it in the browser).
Checks: `pnpm exec vitest run src/features/prompts/engines.test.tsx src/mocks/handlers/prompts.test.ts
src/mocks/prompt-fixtures.test.ts --maxWorkers=3`, lint, typecheck, format:check.
i18n: `aiEngines`. Rows closed: BE-ENGINES-10 on the web side (no separate inventory row). Push after this task.

## Task 6: Entities added-on date and Data retention page (WB-SET-11, WB-SET-14; confirms WB-SET-09, 10, 12)

Part A, entities. Files: `apps/web/src/features/entities/entities-screen.tsx`, `entities.test.tsx`,
`apps/web/src/app/[workspace]/[project]/settings/entities/page.tsx` (pass `timeZone={current.timezone}` as the
schedules page does), `apps/web/messages/en.json` (`entitySettings.columns.added`, `entitySettings.addedHint`).
Add an "Added" column to the competitor table (and the same cell for watched entities) showing `added_at` through
`formatTableDate(added_at, timeZone)` (project time zone, because the SOV boundary is a business date), with the
full timestamp in the cell's `title` through `formatDetailDateTime`. Hidden below `md` like the Domains column. Under
the Competitors heading one `type-meta` sentence: "Share of voice counts a competitor from the date it was added.
Adding or removing one changes share of voice for all entities from that day." (the dialog's own `sov` notice stays).
No backend change; `added_at` is reset when a removed entity is added again, which is what the boundary needs.
Tests first: the date shows per competitor and uses the project time zone (a role added at 23:30 UTC on the day
before shows the next local date in Asia/Kolkata); the own brand row shows its date too or "Own brand" with no date
(decide with the preview: show it); a re-added competitor shows the new date (mock `added_at`); axe.
Part B, retention page. Files (create): `apps/web/src/features/project-settings/retention/retention-screen.tsx`,
`retention-classes.ts` (the four classes with `days: number | null`, key and the doc 23 section 9.2 wording),
`retention.test.tsx`, `retention-classes.test.ts` (pins 400, null, 90, 30), `index.ts` re-exported from
`features/project-settings/index.ts`. Files (change): `apps/web/src/app/[workspace]/[project]/settings/retention/page.tsx`
(replace the 404 re-export with the server page, same pattern as `settings/schedules/page.tsx`, metadata title from
`settings.items.retention`), `apps/web/src/features/settings/settings-frame.tsx` (`'retention'` after `schedules` in
`PROJECT`), `settings-frame.test.tsx`, `apps/web/src/app/[workspace]/[project]/planned-routes.test.ts` (delete the
retention line), `apps/web/messages/en.json` (new top level namespace `dataRetention`, plus `settings.items.retention`
"Data retention"), `apps/web/src/mocks/handlers/retention.ts` (stays an empty list, update its comment: no route).
Design: T4 settings form column. Title "Data retention", one `Banner tone="info" placement="region"`: "Retention is set
by the platform and cannot be changed here." A `PlainTable` (`h-row`, `h-row-compact` in Compact) with columns Data,
What it is, Kept for: "Search results" (serp_raw, 400 days), "AI answers" (ai_raw, "Kept indefinitely"), "Search Console
and other first-party imports" (first_party_raw, 90 days), "Error responses" (error, 30 days). Day counts through
`formatInteger`. A closing sentence: "When a raw answer is past its retention it is no longer kept. The numbers,
mentions and citations read from it stay." (matches `prompts.rawExpired`). Visible to every member, nobody can edit.
States: static, so no loading, error, partial or stale; say so in the test header.
Tests first: four rows with the exact periods, "Kept indefinitely" for AI answers, no form control or button in the
page, the banner, axe, the frame lists "Data retention" and highlights it on `/settings/retention`, the route page
renders (not the 404): `planned-routes.test.ts` no longer lists it. Drift guard: `retention-classes.test.ts`
pins the four values with a comment naming `backend/src/idraft/storage/raw.py` `RETENTION`, and the reviewer checks
them against it and doc 23 section 9.2.
Confirm built rows in the report by test names: WB-SET-09 `schedules.test.tsx`, WB-SET-10 `entities.test.tsx`,
WB-SET-12 the taxonomy tests under `features/taxonomy`.
Checks: `pnpm exec vitest run src/features/entities src/features/project-settings src/features/settings
src/app --maxWorkers=3`, `src/i18n`, lint, typecheck, format:check.
Rows closed: WB-SET-11, WB-SET-14; confirmed WB-SET-09, 10, 12.

## Task 7: Setup checklist, AI steps (WB-SET-17)

Files (create): `apps/web/src/features/onboarding/setup-steps.ts` (pure: three step builders and progress),
`setup-steps.test.ts`, `use-ai-setup-steps.ts`, `setup-checklist.tsx` (presentational, props as doc 25 section 13.1:
`steps`, `progressText`, `expanded`, `onExpandedChange`, optional `onDismiss`, `continueHref`),
`ai-setup-checklist.tsx` (container: reads, builds the steps, owns the expanded state), `setup-checklist.test.tsx`,
`ai-setup-checklist.test.tsx`. Files (change): `features/onboarding/index.ts` (export `AiSetupChecklist`,
`SetupChecklist`, `aiSetupSteps`), `apps/web/messages/en.json` (new top level namespace `setupChecklist`).
Steps and rules (named as the preview does):
1. "Select AI engines": done when at least one engine is enabled; fact "{n} of 3 engines on" (a count, never pooled
   into one score); action "Open Engines" to `settings/engines`.
2. "Add prompts": done when the largest `active_prompts` of the engines list is above 0; fact "{n} active prompts";
   action "Add prompts" to the prompts page.
3. "First answers": done when `GET {P}/ai/observations?limit=1` returns a row; otherwise the fact is "First answers
   arrive after the next Monday or Thursday run" when steps 1 and 2 are done, or "Needs engines and prompts" when not.
Reads: `apiQuery` of `GET {P}/engines` and `GET {P}/ai/observations` inside the feature, with keys that start
`[...projectKey(workspaceId, projectId), 'engines']` and `[..., 'ai', 'observations', ...]` so the existing
`refreshPrompts` (prompts feature) invalidates them after an engine or prompt change; do not import the prompts
feature. Loading: a 40 px skeleton bar. Error: the bar says "Setup could not be checked" with Retry; no step is shown
as done (unknown is never done). Partial: if only one read failed, that step shows "Could not be checked" and the
others render. Collapsed 40 px bar by default ("Setup: {done} of {total} steps complete", 64 px progress bar, "Continue
setup" to the first open step, "Show steps"), expanded list of 32 px rows with `CircleCheck` or empty circle and a
visually hidden "Done: " or "To do: ". Complete: "Setup complete", "Dismiss" only when `onDismiss` is passed
(persistence is the Overview owner's, open question 3). `AiSetupChecklist` takes optional `extraSteps` so the Overview
route can add the non-AI steps; the progress text counts all steps it is given.
Tests first: model (done and fact per case, progress text singular and plural, unknown stays not done, extra steps
count); component (collapsed default, expanded rows, buttons, progressbar `aria-valuenow`, links, Complete without
and with `onDismiss`); container with MSW (engines off, engines on without prompts, all done, one read failing,
both failing with Retry, refetch after `refreshPrompts` updates the bar without a skeleton flash); axe in each state;
keyboard: disclosure toggles with Enter and Space, focus order bar, Continue, Show steps, then the rows' links.
Because no page mounts it, the reviewer checks it in the browser with a throwaway local mount on the engines page
that is never committed; the committed proof is the component tests and axe.
Checks: `pnpm exec vitest run src/features/onboarding src/i18n --maxWorkers=3`, lint, typecheck, format:check.
Rows closed: WB-SET-17 (steps and component; the mount on Overview is WP-33 or WP-40, see open question 2).

## Task 8: End to end flow, As built notes, rebase, final checks, push

Files (create): `apps/web/e2e/flows/ai-settings.spec.ts`. Files (change): `docs/19-api-specification.md` (an
"As built (AI visibility WP-31, <date>): engine device" paragraph at the end of section 3.7.4, after the engines
text), `docs/29-phase-roadmap.md` (a paragraph after the WP-14 one in the As built list), `docs/20-frontend-specification.md`
(a `> As built (AI visibility WP-31 ...)` note in section 5.19 after the existing Engines note: class badge,
Perplexity row, cost change summary, device control, Data retention, the entities Added column, the checklist and
where it lives and why `features/onboarding` and not `features/overview/components`), `docs/design-system/25-component-inventory.md`
(a `> As built (WP-31)` note under 13.1 SetupChecklist: location and props), `docs/ai-visibility/contracts/wp-31-engines-device.md`
(final change log). All append only, no dashes, no rewriting of earlier text.
e2e flow (mock mode, signed in as the editor `priya@digibranders.test`, helpers from `e2e/support.ts` untouched):
open Engines, see three class badges and the Perplexity row, turn AI Mode on and read the cost summary, change the
device to Mobile, reload and see Mobile kept, open Data retention from the settings navigation and read the four
periods, open Entities and see the Added column; axe at 390 and 1280 px; a viewer sees everything read only.
Final steps: `git fetch origin && git rebase origin/develop`; regenerate `openapi/v1.json` and `schema.ts` if the
rebase touched them (resolve by regeneration, never by hand); renumber nothing (no migration); keep both sides of
`messages/en.json` and run `pnpm exec vitest run src/i18n`. Heavy lane, one job at a time:
`infra/dev/heavy --label wp-31-backend -- bash -c 'cd backend && ./check.sh'`, then
`infra/dev/heavy --label wp-31-web -- bash -c 'cd apps/web && pnpm test && pnpm build'`, then
`infra/dev/heavy --label wp-31-e2e -- bash -c 'cd apps/web && pnpm e2e -- flows/ai-settings.spec.ts'`; medium lane
`pnpm lint`, `pnpm typecheck`, `pnpm format:check`. Second reviewer reads the whole diff against the brief's
acceptance criteria and the row list, and opens every changed page at 390, 768, 1024 and 1280 px, both themes,
Default and Compact. Push `git push origin HEAD:develop`, `infra/dev/wp-status WP-31 merged`, report line to the
coordinator. Rows closed: process; all 19 rows accounted for (7 to do closed, 12 built confirmed).

## Rows by task

BE-ENGINES-10 T1, T2, T5; BE-ENGINES-01 to 04 and 12 T3; WB-SET-06, 07, 08 T4 (WB-SET-01 to 03 and WB-IA-09
confirmed there); WB-SET-11 and 14 T6 (WB-SET-09, 10, 12 confirmed there); WB-SET-17 T7.

## Prove it bites (backend, reviewer repeats)

Each guard weakened in a scratch commit that is never pushed, the targeted test run, the failing test name written
in the report, the guard restored: T1 (a) to (f), T2 four guards, T3 three guards. Web guards the reviewer breaks:
the cost model's null price rule (the not-estimated test fails), the "device only when asked" rule (the countries and
turn-off tests that assert no `provider_params` fail), unknown never done in the checklist (the failing read test
fails), the Perplexity switch staying disabled.

## Open questions (default taken unless the coordinator says otherwise)

1. Class "column": the preview shows a table, the built screen is rows with a country field each, which does not fit
   a table at 390 px. Default: keep the rows and show the class as a badge beside the name. Ask only if the owner
   wants the table.
2. The checklist has no mount point: Overview (WP-33, WP-40) is not live and no package owns `SetupChecklist`.
   Default: build `features/onboarding` pieces here, export them, and let the Overview route compose
   `<AiSetupChecklist />` (one line) when it goes live. The coordinator should tell WP-33 and WP-40.
3. Dismissing the checklist permanently needs a stored flag per project (doc 23 section 13); none exists. Default:
   `onDismiss` is optional and unused here; "Show setup checklist" in Settings > General is not built.
4. AI Mode mobile os value: `android` (from the SERP adapter). Default: keep it; a real call is not made. The
   owner can confirm with one paid check later.
5. Device change and comparability: the series of AI Mode answers mixes devices after a change. Default: no
   `ADAPTER_VERSION` bump (desktop requests are unchanged), the hint text says earlier answers keep their device, and
   the observation row already stores the device the provider reported. Revisit if WP-41 wants a boundary marker.
6. Leases listed above. Default: request all at the start; if a backend lease for `collectors/ai_prompt.py` or
   `providers/dataforseo/ai.py` is refused, ship Task 1 and the web side with the device stored but not yet sent, and
   record BE-ENGINES-10 as partial with that reason.
7. The brief names doc 20 sections 4.6 and 4.8 for web As built notes; those are chart and table conventions. Default:
   the notes go in section 5.19 (Settings), with the spec 2026-11-11 section 4.6 reference kept in the text.
8. Branch name: the brief says `ai/wp-31-settings-engines`, the worktree is `ai/wp-31-settings`. Default: keep the
   existing branch; the status line reports whatever git says.
