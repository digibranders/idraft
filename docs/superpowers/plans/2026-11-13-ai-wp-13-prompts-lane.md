# WP-13 prompts-lane: detailed task plan

Brief: [WP-13](../../ai-visibility/work-packages/WP-13-prompts-lane.md). Contract: [C1](../../ai-visibility/contracts/c1-prompts.md).
Branch `ai/wp-13-prompts-lane`, worktree `.claude/worktrees/wp-13`, cut from `origin/develop` at `dd1acfa8`.
Owner decisions taken at their defaults, never blocked on: D-21 branded means own aliases only, competitor
aliases get `contains_competitor_alias`; D-22 the person sets the funnel stage, default `unknown`, no LLM;
D-23 bulk archive by filter is built; D-46 ETag and If-Match on prompt PATCH are built.

## What exists (read from code at dd1acfa8)

- WP-03 published every C1 shape: `PromptCreate.is_branded/source/creation_method/generated_from`,
  `PromptLintItems`, `PromptLintRequest.language_code`, `PromptLint.tracked/near_duplicate_of/
  suggested_prompt_type`, `PromptQuota.would_create`, `LintEstimate`, `Prompt.prompt_type_source/
  is_branded_source`, the widened `LintRule`, `PromptSort`, `PromptSelectionFilter`,
  `PromptBulkArchiveByFilter`, `PromptBulkUpdate` (with its `nothing_to_change` and `added_and_removed`
  checks), `AiLimits` in `schemas/ai_limits.py`, the stubs `bulk_update_prompts` (`@not_built`) and
  `ai_limits` in `api/ai/limits_routes.py` (registered in `main.py`), and `refuse_unbuilt` calls in
  `list_prompts`, `create_prompt`, `bulk_create_prompts` (`_unbuilt_members`), `update_prompt`, `lint_prompts`.
- Columns of `ai.prompts` (migration 0018): `expected_frequency` (default `weekly`), `source` (17 values,
  default `manual`), `creation_method` (default `human`), `is_branded`, `prompt_type` exist. `prompt_type_source`
  and `is_branded_source` do NOT exist. `generated_from` has no column (keyword links are N08, not this package).
  `ai.prompt_terms` has `assigned_by`. API column grant on `ai.prompts`: UPDATE on intent, funnel_stage,
  is_branded, prompt_type, importance, is_active, updated_at only.
- Problem codes: `PreconditionFailedError` (412), `QuotaExceededError`, `TooManySubjectsError`,
  `NotFoundError`, `invalid_fields`/`FieldError` exist in `problems.py`. WP-13 needs no new code, so no
  `ProblemError` subclass module is created.
- Quota and limits: `prompt_repository.quota_usage` (workspace active prompts, base plan 150),
  `api/ai/run_repository.ai_tasks_since` (month answers as Run now counts them),
  `api/operations/runs_repository.manual_runs_since`, `MANUAL_RUNS_PER_DAY = 20` in `api/operations/runs.py`.
  `lock_ai_observation_limit` upserts and locks: a read must not use it.
- Money: `ai/pricing.task_prices(db, queue, on)` (standard price 0.0012 per task on each AI engine, numeric
  14,8), `domain/ai_engines.monthly_cost` (prompts x 2 x 52 / 12 x price, to the cent), `BASE_PLAN`.
- Term assignments route `api/taxonomy/assignments.py` calls the keywords service, which refuses
  `subject_type: prompt` with `subject_type_not_supported`; `TermAssignment` (in `schemas/keywords.py`) has
  `subject_filter: TrackedKeywordFilter`. `TermNode` (in `schemas/taxonomy.py`) has `keyword_count` only.
- Precedents: statement counter `tests/api/ai/sources_support.statements`; fixtures in
  `tests/api/ai/support.py` (`ai_project`, `add_prompt`, `seed_prompts`, `set_prompt_quota`, `enable_engine`);
  bulk archive tests in `test_prompt_bulk_archive.py`; keyset cursor `encode_cursor/decode_cursor(scope=)`.

## Leases the lead must request (exact paths)

| Path | Task | Change |
|---|---|---|
| `backend/src/idraft/db/tables.py` | 3 | two `Column` lines in `ai_prompts` (`prompt_type_source`, `is_branded_source`) |
| `backend/tests/db/test_grants.py` | 3 | the two new columns in the `ai.prompts` UPDATE tuple |
| `backend/src/idraft/api/schemas/taxonomy.py` | 10 | `TermNode.prompt_count: int \| None` (opt-in, absent unless asked) |
| `backend/src/idraft/api/schemas/keywords.py` | 10 | only the `TermAssignment.subject_type` description ("`prompt` arrives with prompts" is false once built) |

Not leases (protocol): the new migration (numbered at push, MASTER-PLAN 3.9), `backend/openapi/v1.json` and
`apps/web/src/lib/api/schema.ts` (regenerated in the same push), anchor blocks `# WP-13 prompts-lane` in
`test_route_access.py` and `test_cross_tenant.py`, the append-only As built sections of docs 19 and 29, the
C1 change log. New files nobody owns (add to the package's owned list): `backend/src/idraft/api/ai/prompt_lint.py`,
`backend/tests/api/ai/test_prompt_*.py` new files. Deleted as C1 step 3 says: `tests/api/ai/test_contract_prompts.py`,
`tests/api/ai/test_contract_lint_bulk.py` (each assertion moves to a real test below).

## Migration

One, expand only, working name `xxxx_ai_prompt_value_sources.py` (renamed to the next free number, today
`0021`, with `down_revision` the head, after the last rebase; the push takes the heavy lock):

```sql
ALTER TABLE ai.prompts
  ADD COLUMN prompt_type_source text NOT NULL DEFAULT 'person'
             CHECK (prompt_type_source IN ('rule','person')),
  ADD COLUMN is_branded_source  text NOT NULL DEFAULT 'computed'
             CHECK (is_branded_source IN ('computed','override'));
GRANT UPDATE (prompt_type_source, is_branded_source) ON ai.prompts TO app_api;
-- downgrade: REVOKE, then DROP COLUMN both
```

Constant defaults make it a catalog change, no rewrite. Existing rows: `person` (the caller sent the type)
and `computed` (no override existed). No new table, so no RLS, grant or `_TENANT_ROWS` entry. No other
column is needed: `source`, `creation_method`, `expected_frequency` exist; `generated_from` is checked and
written to the audit entry only. Migrations run only in the test containers (`pytest` fixtures), never against
`idraft-dev-postgres-1`; a manual check uses a database `idraft_wp_13` on the same server.

## Questions to settle before coding (each has a default; build the default if unanswered)

1. Estimate rounding. C1 example shows `answers_per_month: 9` and `"0.010800"` for one prompt; PD-QC-01 says
   rounded down and PD-QC-03 says "same formula as `monthly_cost`, to the cent". Default: answers
   `floor(prompts_fit * 104 / 12)` (8 for one prompt), money `monthly_cost()` (`"0.01"`), run now unrounded.
   The example is corrected in the C1 change log.
2. `prompt_type` rule. C1 example suggests `recommendation` for "what are the best ... ?"; the owner rule
   (doc 19 decided 2026-11-12, N02) has no recommendation branch. Default: the owner rule; example corrected.
3. `language_mismatch` without a new dependency: script check plus a function-word check for en, de, fr, es,
   it, pt, nl (no `pyproject.toml` lease). A library would need a dependency lease.
4. Term assignments for prompts take `subject_ids` only; `subject_filter` with `subject_type: prompt` is
   `422` (`subject_filter` / `filter_not_supported`). Selection by filter is `bulk-update`. Widening needs
   the `schemas/keywords.py` lease to grow into a union.
5. `TermNode.prompt_count` is opt-in (`include=prompt_count` on the terms read) and counts active prompts
   branded or not (a membership count, like `keyword_count`, not a rate).
6. A bulk selection by filter takes at most 1,000 prompts (`422 too_many_subjects`, `limit: 1000`).

## Task 0: environment (no commit)

- `uv sync --frozen` is run by the lead through the medium lane; do not run it again.
- Docker variables, exported in the shell before any lane command:
  `export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`
  (`colima status` only; never start, stop or restart Colima, never touch `idraft-dev-*`).
- Targeted pytest for a path (medium lane only):
  `infra/dev/heavy --lane medium --label wp13-tN --wait 30 --max 20 -- bash -c 'cd backend && uv run pytest -n 2 --no-cov tests/api/ai/test_prompt_lint.py'`
- Lint and types of changed files (medium lane): `... -- bash -c 'cd backend && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy && uv run lint-imports'`
- The single heavy check (last push only): `infra/dev/heavy --label wp13-check --wait 30 --max 30 -- bash -c 'cd backend && ./check.sh -n 4'`
- `tests/api/test_openapi.py` fails from Task 1 until Task 12 regenerates `v1.json`: leave it out of
  targeted runs; never regenerate earlier.
- No real provider or LLM call anywhere: lint, rules, estimate and limits are pure or SQL; prices come from
  the seeded price book in the test database.

## Task 0b: contract first (one doc commit, push allowed)

The contract-first push is already done: WP-03 pushed every C1 schema and stub with `v1.json` and `schema.ts`.
WP-13 adds only small optional or additive items: `include=prompt_count` and `TermNode.prompt_count`,
`PromptCreate.prompt_type` losing its default (`question`), the `ETag` response header on GET and PATCH,
`Prompt.prompt_type_source` and `is_branded_source` becoming always returned, and the term assignment
description. Their consumers are the lane S3 web packages (WP-27, WP-28, WP-29), run by this same session
after WP-13, and they mock first. So no early code push: an early push would cost a second `v1.json` and
`schema.ts` regeneration for no consumer. This task writes the C1 change log lines (the six choices above,
the corrected examples, the additions) in `docs/ai-visibility/contracts/c1-prompts.md` and commits
`WP-13: Contract notes for the prompts lane`. A doc only push keeps develop green.
The single regeneration is Task 12.

## Common rules for every task

- Tests first: write the named tests, see them fail for the right reason, then build. Edits with the file
  tools only. ASCII only. Commit `WP-13: <task title>`, naming only this package's files, no attribution.
- Tenant scoping: every statement names `workspace_id`; every service method opens
  `workspace_transaction` and calls `live_project` first, so a foreign, deleted or unknown project is `404`
  from the service (the stub `501` goes with the mark). Ids of another project or workspace are not matched
  and are no error (bulk archive rule).
- Lint stays `data:read`, writes nothing: no insert, no upsert, no audit entry (asserted in Task 1).
- Each stub removal deletes its `refuse_unbuilt` entry, its `not_built_yet` raise and the `Not built yet` /
  `Not returned yet` sentences of its fields and route descriptions. `_unbuilt_members` is deleted in Task 5.

## Task 1: Lint items, tracked, near_duplicate_of, would_create

Rows: PD-N01, BE-PROMPTS-08 (confirmed). Files: `prompt_service.py`, `prompt_routes.py`,
`prompt_repository.py`, `schemas/ai.py` (descriptions), tests `tests/api/ai/test_prompt_lint.py`.

- Route: `PromptLintItems` is served (remove its raise). The service takes both shapes through one internal
  list of `(text, language_code | None, country_iso | None)`.
- Repository `lint_matches(db, workspace_id, project_id, markets: set[(language, country)]) -> list[LintRow]`
  (`id, text, text_hash, language_code, country_iso, is_active`): ONE statement over the project's live
  prompts (archived included) in the items' markets. `# shortcut: reads every prompt of these markets; a
  functional index on the folded text when a project passes 10,000 prompts.`
- Per item: `tracked = {prompt_id, is_active}` when `key_of` identity matches; else `near_duplicate_of =
  {prompt_id, text}` when `fold(text) == fold(row.text)` in the same market, `fold = " ".join(t.casefold().split())`.
  Both absent for the `texts` shape and when not found (`exclude_if`).
- `quota.would_create` (items shape only) = items not tracked, not a repeat of an earlier item's identity,
  and at most `PROMPT_TEXT_MAX` characters. Absent for `texts`.
- Statements: the `texts` shape keeps today's count exactly (measure before the change, pin it); the
  `items` shape adds exactly one statement whatever the number of items.

Tests (names and assertions):
- `test_lint_items_says_which_prompts_are_tracked`: active and archived identity return `tracked` with the right `is_active`.
- `test_lint_items_finds_a_prompt_differing_only_in_case_and_spacing`: "Best  CRM?" vs tracked "best crm?" gives `near_duplicate_of`, no `tracked`.
- `test_a_prompt_in_another_market_is_neither_tracked_nor_near`: same text, other country or language: both absent.
- `test_would_create_leaves_out_tracked_repeated_and_unsavable`: 5 items (1 tracked, 1 repeat, 1 of 2,001 chars, 2 new) gives `would_create == 2`.
- `test_lint_texts_answers_as_before`: the old shape has no `tracked`, `near_duplicate_of`, `would_create`, `estimate`.
- `test_lint_stores_nothing`: row counts of `ai.prompts`, `ai.prompt_versions`, `ops.audit_logs`, `core.workspace_quotas` unchanged.
- `test_lint_items_statement_count_does_not_grow_with_items`: 1 and 200 items send the same number of statements.
- `test_another_workspaces_prompt_is_not_tracked`: B tracks the text; A's lint has no `tracked`.
- `test_lint_items_is_for_readers_and_404_for_a_foreign_project`: viewer 200, billing 403, B's project 404.

## Task 2: Five lint rules and language_code

Rows: BE-PROMPTS-09, PD-N03. Files: new `backend/src/idraft/api/ai/prompt_lint.py` (pure functions, no DB,
no API imports beyond the rule names), `prompt_service.py` (`_lint` calls them), `prompt_routes.py` (remove
the `language_code` refusal), tests `tests/api/ai/test_prompt_lint_rules.py` (pure, no containers, fixture
tables written by Haiku) and two route tests in `test_prompt_lint.py`.

Rules, in this order after `contains_brand_alias`; `engine_limit` stays last. Spans are UTF-16 units
(`to_utf16`). Messages are plain ASCII sentences.

| Rule | Fires when | Severity | Span |
|---|---|---|---|
| `contains_competitor_alias` | an accepted mention of an entity with role `competitor` (D-21: never sets `is_branded`) | `warning`; `info` when `suggested_prompt_type == comparison` | first accepted span |
| `leading_wording` | an English superlative (`best`, `top`, `leading`, `greatest`, `number one`, `#1`) within 3 words of an own or competitor alias span, or the case-folded pattern `why is <words> the best` | `warning` | the superlative |
| `multiple_questions` | more than one run of `?`, U+FF1F or U+061F (a run such as `??` counts once) | `warning` | none |
| `word_count` | words < 5 or > 60; words are whitespace tokens, and a token of Han, Hiragana, Katakana, Thai, Lao, Khmer or Myanmar counts `ceil(chars / 2)` | `warning` | none |
| `language_mismatch` | a language is known (item `language_code`, or body `language_code` for `texts`), the text has >= 4 words, and either the dominant script (>= 60 % of letters, from `unicodedata.name`) is not one of the language's scripts, or for en, de, fr, es, it, pt, nl another language's function words hit >= 2 and >= the declared language's hits + 2 | `warning` | none |

`# shortcut: superlatives and function words are English and six Latin languages; per language lists when
those markets are sold.` Unknown language codes skip the script table.

Fixture tables (`@pytest.mark.parametrize`, each row text, language, expected rules), at least:

- Positive: "best crm" en (word_count); "What is X? And what is Y?" en (multiple_questions); "Why is Acme the
  best CRM for agencies?" en with own alias Acme (contains_brand_alias, leading_wording); "Is HubSpot the best
  CRM for startups?" with competitor HubSpot (contains_competitor_alias, leading_wording); "HubSpot vs Acme
  for a small agency" (contains_competitor_alias at `info`); "Quelle est la meilleure solution de facturation ?"
  en (language_mismatch); a 61 word sentence (word_count).
- Negative: "What is the best CRM for startups?" (no alias, so no leading_wording); "Really?? Is it worth it"
  (one run, no multiple_questions); "Acme pricing compared with the top tools on the market today" (alias 5
  words from "top"); "Welche CRM Software passt zu einer kleinen Agentur?" de (no mismatch); a 5 word and a
  60 word prompt (no word_count).
- Non-Latin (written as `\u` escapes in the test file, which stays ASCII): a Japanese question of about 24
  Han and kana characters with no spaces, ja (no word_count, no mismatch) and the same text en
  (language_mismatch); two short Japanese questions each ending in U+FF1F, ja (multiple_questions); two Arabic
  clauses each ending in U+061F, ar (multiple_questions); a Russian question of six Cyrillic words, ru (none)
  and en (language_mismatch); U+1F4C8 (a surrogate pair) then " Is HubSpot good for agencies?": the competitor
  span starts at 3; "Warum ist Acme das beste CRM?" de: no leading_wording (documented limit),
  contains_brand_alias only.

Route tests: `test_lint_takes_a_language_code_for_texts` (mismatch reported, 200); `test_lint_rules_run_on_items`
(per item language used). Prove it bites: none beyond the fixtures (pure rules).

## Task 3: prompt_type rule, prompt_type_source, override, suggested_prompt_type, filter

Rows: BE-PROMPTS-10, BE-PROMPTS-11, PD-N02, CF-13. Files: migration `xxxx_ai_prompt_value_sources.py`,
`db/tables.py` (lease), `tests/db/test_grants.py` (lease), `prompt_lint.py` (`suggest_prompt_type`),
`schemas/ai.py`, `prompt_repository.py`, `prompt_service.py`, `prompt_routes.py`,
tests `test_prompt_type_rule.py` (pure) and `test_prompts.py`.

- Rule (owner, doc 19 decided 2026-11-12), case folded, first match wins: word bounded `vs`, `vs.` or
  `versus` gives `comparison`; text starting with or containing the words `how to` gives `how_to`; a leading
  interrogative (`what which who whom whose where when why how is are can could should does do did will
  would`) or a text ending in `?`, U+FF1F or U+061F gives `question`; else `other`. No LLM.
- `PromptCreate.prompt_type: PromptType | None = None`. Left out: the rule, `prompt_type_source = 'rule'`;
  sent: as sent, `'person'`. `PATCH prompt_type` sets `'person'`. `Prompt.prompt_type_source` always
  returned (required field). `PromptRecord`, `NewPrompt`, `_prompts()`, `insert_prompts`, `_snapshot` carry it.
- Lint returns `suggested_prompt_type` for every text, both shapes.
- List: `filter[prompt_type_in]` served. Refactor `list_prompts` into `_conditions(given) -> list[ColumnElement]`
  used by the list now and by the selections of Task 8; `PromptFilter` gains `prompt_types: frozenset[str]`.
  The cursor scope gains the key only when the filter is used, so cursors issued before still decode.
- Migration test (in `test_prompts.py`, testcontainers): an existing row reads `person` and `computed`;
  `app_api` may update both columns; a value outside the check is refused.

Tests:
- `test_the_type_rule_reads_the_wording` (parametrized: "HubSpot vs Pipedrive" comparison, "Asana versus
  Trello?" comparison, "How to migrate a CRM" how_to, "What is a CRM?" question, "Kann ich Acme testen?"
  question by the mark, "best crm" other, "Vsauce channels" other, "Quelle CRM choisir ?" question).
- `test_a_prompt_without_a_type_gets_the_rule_and_says_so`: `prompt_type` and `prompt_type_source == "rule"`.
- `test_a_type_sent_is_kept_and_marked_person`; `test_a_type_changed_by_patch_becomes_person`.
- `test_bulk_create_items_take_the_rule_one_by_one`.
- `test_the_list_filters_by_prompt_type`: two of three types requested, the third left out; an unknown value is 422.
- `test_the_new_columns_default_and_are_granted` (migration test above).

## Task 4: Estimate in lint (cost and answers per engine)

Rows: PD-N05. Files: `prompt_service.py`, `prompt_routes.py`, `schemas/ai.py` (descriptions),
tests `test_prompt_lint_estimate.py`.

- Only with the `items` shape (its opt-in; `texts` never pays for it). Engines: `engine_codes` when sent,
  else the project's enabled engines (`engines.enabled_countries` keys), in `EngineCode` order.
- Per engine: `prompts_fit` = would-create items whose text the engine fits; `answers_per_month =
  prompts_fit * runs_per_week * answers_per_engine * 52 // 12`; `monthly_cost_usd = monthly_cost(prompts_fit,
  price)`; `run_now_answers = prompts_fit * answers_per_engine`; `run_now_cost_usd = price * run_now_answers`;
  price from ONE `task_prices(db, queue=BASE_PLAN.queue, on=today UTC)` call; no price: both costs null.
  `total_monthly_cost_usd` = sum of the non-null monthly costs, null when none is priced (no engines included).
- Statements: two more than Task 1's items count (engines, prices), constant in items.

Tests (price 0.0012 seeded):
- `test_the_estimate_counts_answers_and_cost_per_engine`: 3 new items on chatgpt_web: `prompts_fit 3`,
  `answers_per_month 26`, `monthly_cost_usd "0.03"`, `run_now_answers 3`, `run_now_cost_usd "0.0036"` (as
  `Decimal`, compare numerically).
- `test_one_prompt_costs_a_cent_and_eight_answers`: 1 item: 8 answers, `"0.01"`.
- `test_150_prompts_on_three_engines_cost_4_68`: per engine 1,300 answers and `"1.56"`, total `"4.68"` (no
  quota needed: lint does not refuse past the quota).
- `test_ai_mode_leaves_out_a_prompt_over_700_characters`: one 701 char item: ai_mode `prompts_fit 0`, others 1.
- `test_tracked_and_repeated_items_cost_nothing`: estimate built on `would_create` only.
- `test_an_engine_without_a_price_has_null_cost_and_the_total_sums_the_rest` (end the price row in the test DB).
- `test_without_enabled_engines_the_estimate_is_empty` (`engines []`, total null).
- `test_texts_shape_has_no_estimate`.
Prove it bites: change `// 12` to `/ 12` rounded, or 52 to 48: the first three tests fail.

## Task 5: Branded override, provenance fields

Rows: PD-N04, PD-N07, BE-PROMPTS-15. Files: `schemas/ai.py`, `prompt_repository.py`, `prompt_service.py`,
`prompt_routes.py` (delete `_unbuilt_members`), tests `test_prompt_provenance.py`.

- `is_branded` sent: stored as sent, `is_branded_source = 'override'`; left out: computed from own aliases,
  `'computed'`. `PATCH is_branded` sets `'override'`. `Prompt.is_branded_source` always returned.
- `source` (five caller values) default `manual`; `creation_method` (`human`, `template`, `imported`) default
  `human`; both written by `insert_prompts`. `generated_from`: the `tracked_keyword_id` must be a live tracked
  keyword of the project (one statement for all items, `seo.tracked_keywords` by workspace and project), else
  field code `tracked_keyword_unknown` at `generated_from.tracked_keyword_id` (create: 422; bulk-create: item
  rejected). It is not stored as a column: the `prompt.created` audit snapshot carries `source`,
  `creation_method`, `generated_from`. With `generated_from` and no `creation_method`, `template` is set.
- `expected_frequency`: not exposed (owner decision Q28); the column keeps its default. Row closes with that reason.

Tests: `test_an_is_branded_override_is_kept_and_marked`; `test_without_override_branded_is_computed`;
`test_patch_is_branded_marks_override`; `test_source_and_creation_method_are_saved_and_shown`;
`test_llm_generated_is_refused_from_a_caller` (422); `test_generated_from_names_a_tracked_keyword_of_the_project`
(another project's keyword: `tracked_keyword_unknown`); `test_generated_from_is_in_the_audit_entry`;
`test_bulk_create_rejects_only_the_item_with_an_unknown_keyword`.

## Task 6: Quota and limits read

Rows: PD-N06, BE-PROMPTS-16, CF-11. Files: `limits_routes.py` (remove `@not_built` and the raise; use the
`Prompts` dependency from `prompt_routes.get_prompt_service`), `prompt_service.py` (`limits`),
`prompt_repository.py` (`limits_row`), tests `test_prompt_limits.py`.

- One read only transaction: `live_project`; database `now()` once (day and month start in UTC as
  `runs._today` does, written locally); `quota_usage`; `ai_tasks_since(db, ws, month_start)`;
  `manual_runs_since(db, ws, project, day_start)`; the month limit read WITHOUT the upsert or lock
  (`select max_ai_observations_per_month`), absent row falling back to `_MONTHLY_ANSWERS_DEFAULT = 20_000`
  (migration 0003 default; creating a project always writes the row). `manual_runs_today.limit =
  MANUAL_RUNS_PER_DAY`.
- Statement count constant (pin the measured number; same for 1 and 30 prompts, 0 and 5 runs).

Tests: `test_limits_show_workspace_prompts_across_projects` (two projects, archived prompts not counted,
archived project counted, deleted project not); `test_limits_month_answers_match_what_run_now_counts`
(after a bulk run of 2 prompts x 3 engines, `used` grows by 6, planned run included);
`test_manual_runs_today_count_this_project_only`; `test_the_limit_defaults_match_the_database`
(information_schema default equals the constant); `test_limits_write_nothing` (no quotas row created for a
workspace whose row was deleted in the test); `test_limits_statement_count_is_constant`;
`test_limits_for_a_viewer_200_billing_403_foreign_project_404`.
Prove it bites: drop the project predicate in the manual run count (count every project): the third test fails.

## Task 7: List filters and sort, is_active=any

Rows: BE-PROMPTS-12, PD-N13. Files: `prompt_routes.py`, `prompt_service.py`, `prompt_repository.py`,
tests `test_prompt_list_filters.py`.

- `filter[funnel_stage_in]`, `filter[importance_in]`, `filter[is_branded]` through `_conditions`;
  `filter[is_active]=any` maps to `PromptFilter.is_active = None` (already supported by the repository).
  The list never hides branded prompts (it is not a rate).
- `sort`: left out, `ORDER BY id DESC` and the cursor key `[id]` exactly as today. Given: `ORDER BY col dir,
  id dir` (text is the current version's text), keyset `(col, id) < (:v, :id)` for descending and `>` for
  ascending, key `[value, id]` with timestamps ISO and importance int. Scope adds `sort` and each used
  filter, so a cursor used with another sort or filter is `400 invalid_cursor`.

Tests: `test_each_new_filter_narrows_the_list` (parametrized per filter); `test_is_active_any_lists_both`;
`test_each_sort_orders_and_pages_without_gaps_or_repeats` (7 prompts, `limit=3`, all 8 sorts, equal
importance values for the tie-break); `test_a_cursor_from_another_sort_is_invalid`;
`test_a_cursor_without_sort_still_works_as_before`; `test_bounds_are_422` (`importance_in=6`, `sort=volume`).
Prove it bites: leave `sort` out of the cursor scope: `test_a_cursor_from_another_sort_is_invalid` fails.

## Task 8: Bulk update and bulk archive by filter

Rows: BE-PROMPTS-06, BE-PROMPTS-07, PD-N09, CF-12. Files: `prompt_routes.py` (drop `@not_built` and the
raises), `prompt_service.py`, `prompt_repository.py`, `schemas/ai_bulk.py` (descriptions only),
tests `test_prompt_bulk_update.py`, `test_prompt_bulk_archive.py` (add the filter cases).

- Selection (shared by both routes): `ids` as today through `lock_prompts`; `filter` through `_conditions`
  of a `PromptFilter` built from `PromptSelectionFilter` (`is_active` None means both), locked `FOR NO KEY
  UPDATE` in id order, `LIMIT 1001`: more than 1,000 is `422 too_many_subjects` with `limit: 1000`. Every
  statement names workspace and project.
- Bulk update, one transaction: terms in `add_term_ids` and `remove_term_ids` checked with
  `keywords.project_terms` (`term_unknown` at the list's path; two added terms of one single-valued
  vocabulary: `single_valued_vocabulary`); an added term of a single-valued vocabulary replaces the
  prompt's other term of it. Writes: one `UPDATE ... WHERE id = ANY AND (col IS DISTINCT FROM ...)
  RETURNING id` for `set` (with `prompt_type_source = 'person'` and `is_branded_source = 'override'` when
  those are set, `updated_at = now`); one `DELETE ... RETURNING prompt_id` for removals and replaced
  single-valued terms; one `INSERT ... ON CONFLICT DO NOTHING RETURNING prompt_id` (`assigned_by = 'manual'`);
  `updated_at` bumped for term-only changes. `matched` = selected, `updated` = union of returned ids.
  Audit: one `prompt.bulk_changed` on the project (`set`, term ids, matched, changed) and one
  `prompt.updated` per changed prompt (`after`: what was set, `bulk: true`).
- Bulk archive by filter: as by ids; `archive: false` takes the workspace lock first and is all or none
  against the quota (`quota_exceeded` with `limit`, `used`, `requested`).
- Statement count constant (1 and 50 prompts).

Tests: `test_bulk_update_sets_metadata_and_counts_matched_and_updated` (one already equal: matched 3,
updated 2); `test_bulk_update_adds_and_removes_terms`; `test_an_added_single_valued_term_replaces_the_other`;
`test_bulk_update_by_filter_changes_what_the_list_would_show`; `test_bulk_update_leaves_another_projects_prompts_alone`
(same workspace, other project's id in `ids` and matching the filter: not matched, unchanged);
`test_bulk_update_ignores_another_workspaces_ids`; `test_bulk_update_term_unknown_and_single_valued_are_422`;
`test_bulk_update_writes_one_summary_and_one_entry_per_changed_prompt`; `test_bulk_update_marks_type_and_branded_as_set_by_a_person`;
`test_a_filter_over_1000_prompts_is_too_many_subjects`; `test_bulk_update_statement_count_is_constant`;
`test_bulk_update_viewer_403_foreign_project_404`; `test_bulk_archive_by_filter_archives_what_matches`;
`test_bringing_back_by_filter_past_the_quota_changes_nothing`; `test_bulk_archive_by_ids_works_as_before`.
Prove it bites: (a) drop `project_id ==` from the selection: `..._leaves_another_projects_prompts_alone`
fails; (b) drop the quota branch of the filter path: `test_bringing_back_by_filter_past_the_quota_changes_nothing`
fails. The workspace predicate is backed by RLS, so removing it alone does not fail a test: say so in the report.

## Task 9: ETag and If-Match on PATCH

Rows: PD-N11. Files: `prompt_routes.py` (GET and PATCH set the `ETag` header; remove the `If-Match`
refusal), `prompt_service.py`, tests `test_prompt_etag.py`.

- `etag(record) = '"' + sha256(json.dumps({**_snapshot(record), "current_version_id": ..., "prompt_type_source":
  ..., "is_branded_source": ...}, sort_keys=True)).hexdigest()[:32] + '"'`: changes with every metadata or
  term change, with no reliance on `updated_at`.
- `PATCH` with `If-Match`: the prompt is read under its row lock (as now); 404 first if missing; the header
  is a comma list; `*` matches any; otherwise no listed value equal to the current ETag is `412
  precondition_failed` and nothing changes. Without the header: as today.

Tests: `test_get_and_patch_return_an_etag`; `test_the_etag_changes_with_terms_and_metadata`;
`test_a_matching_if_match_changes_the_prompt`; `test_a_stale_if_match_is_412_and_changes_nothing`;
`test_if_match_star_and_lists_match`; `test_if_match_on_a_missing_prompt_is_404`;
`test_a_viewer_is_refused_before_if_match_is_looked_at`; `test_if_match_over_128_characters_is_422`.
Prove it bites: make the comparison always true: `test_a_stale_if_match_is_412_and_changes_nothing` fails.

## Task 10: Term assignments and term counts for prompts

Rows: BE-TOPICS-02, BE-TOPICS-03. Files: `taxonomy/assignments.py` (prompt branch before the keywords
service), `prompt_service.py` (`assign_terms`), `prompt_repository.py` (shared with Task 8 term writes),
`taxonomy/routes.py` (`include`), `taxonomy/service.py`, `taxonomy/repository.py` (`prompt_counts`),
`schemas/taxonomy.py` (lease), `schemas/keywords.py` description (lease), tests `test_prompt_terms.py`.

- `subject_type: prompt`: the caller must also hold `prompts:write` (checked in the service, 403; today the
  same roles as `keywords:write`); `subject_filter` is 422 (question 4); `subject_ids` (up to 5,000)
  selected as Task 8 by ids; `add`, `remove`, `replace` with the keyword semantics (replace works within the
  vocabularies of `term_ids`). Answer `subjects_matched`, `assignments_added`, `assignments_removed`. Audit
  as bulk update. The keyword branch is untouched.
- `GET {W}/vocabularies/{id}/terms?include=prompt_count`: ONE grouped statement as `keyword_counts`
  (active, live prompts, live projects, projects the member can see, each prompt once, rolled up to
  ancestors). Absent without `include` (`exclude_if`).

Tests: `test_term_assignments_add_remove_replace_on_prompts`; `test_term_assignments_leave_another_projects_prompts_alone`;
`test_term_assignments_ignore_another_workspaces_prompts_and_refuse_its_terms` (`term_unknown`);
`test_a_prompt_subject_filter_is_422`; `test_keyword_assignments_answer_as_before`;
`test_prompt_counts_roll_up_and_count_each_prompt_once`; `test_prompt_counts_leave_out_archived_and_deleted`;
`test_prompt_counts_leave_out_projects_the_member_cannot_see`; `test_prompt_count_costs_one_statement_and_is_absent_unless_asked`.
Prove it bites: drop the project predicate (assignments) and the `visible` predicate (counts): the second and
eighth tests fail.

## Access matrix and cross tenant (inside `# WP-13 prompts-lane` only)

- `test_route_access.py`: no new route (bulk-update and limits are in the WP-03 block). Nothing to add
  unless a route is added; the block stays as is.
- `test_cross_tenant.py` `QUERIES` under the WP-13 line: `("GET", _W + "/projects/{project_id}/prompts")`
  with `filter[prompt_type_in]=question`, `filter[funnel_stage_in]=unknown`, `filter[importance_in]=3`,
  `filter[is_branded]=false`, `filter[is_active]=any`, `sort=-importance`; `("GET", _W +
  "/vocabularies/{vocabulary_id}/terms")` with `include=prompt_count`. `BODIES` keeps one body per route
  (the WP-03 bulk-update body becomes strict once `@not_built` goes), so the second shapes (lint `items`,
  bulk-archive `filter`, term assignments `prompt`) are covered by the tenant tests named in Tasks 1, 8, 10.
- No new table, so no `_TENANT_ROWS` line.
- `test_the_published_contracts_are_the_not_built_routes` keeps passing: the two marks go.

## Task 11: As built notes; built rows confirmed

Rows confirmed (no rebuild): BE-PROMPTS-01 (`test_prompts.py`, migration tests), 02 (list tests), 03 and 04
(`test_prompts.py`, `test_prompt_bulk.py`), 05 (`test_prompts.py`), 25 (audit tests in Tasks 5 and 8),
BE-TOPICS-01 (term_ids tests). Files: `docs/19-api-specification.md` (an "As built (WP-13)" paragraph in
3.7.1 and one in 3.5), `docs/29-phase-roadmap.md` (one line), C1 change log (fills done), replace the
contract test files' remaining assertions (`test_the_api_document_has_the_prompt_additions` becomes
`test_no_c1_description_says_not_built` in `test_prompts.py`), delete both `test_contract_*` C1 files.
Commit `WP-13: As built notes for the prompts lane`.

## Task 12: Rebase, regenerate once, final checks, push, report

1. `git fetch origin && git rebase origin/develop`; rename the migration to the next free number and set
   `down_revision` to the head (`test_the_history_is_linear_with_a_single_head` proves it).
2. Regenerate once: `cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`; then in
   `apps/web` (medium lane): `pnpm gen:api`, `pnpm typecheck`, `pnpm test src/lib/api/schema.test.ts`.
   Commit `WP-13: Regenerate the API document and web client`.
3. Heavy: the single `check.sh -n 4` command of Task 0, plus `tests/api/test_openapi.py` inside it.
4. `git push origin HEAD:develop` (rejected: back to 1). Never `main`, never `infra/ship.sh`.
5. `infra/dev/wp-status WP-13 merged "..." --rows 31/31 --tasks 13/13` and the same line to the coordinator,
   with the guard list and failing test names.

## Rows per task

| Task | Rows |
|---|---|
| 1 | PD-N01, BE-PROMPTS-08 |
| 2 | BE-PROMPTS-09, PD-N03 |
| 3 | BE-PROMPTS-10, BE-PROMPTS-11, PD-N02, CF-13 |
| 4 | PD-N05 |
| 5 | PD-N04, PD-N07, BE-PROMPTS-15 |
| 6 | PD-N06, BE-PROMPTS-16, CF-11 |
| 7 | BE-PROMPTS-12, PD-N13 |
| 8 | BE-PROMPTS-06, BE-PROMPTS-07, PD-N09, CF-12 |
| 9 | PD-N11 |
| 10 | BE-TOPICS-02, BE-TOPICS-03 |
| 11 | BE-PROMPTS-01 to 05, BE-PROMPTS-25, BE-TOPICS-01 |

## Commit titles

`WP-13: Contract notes for the prompts lane`, `WP-13: Lint knows tracked prompts and near duplicates`,
`WP-13: Five lint rules and language code`, `WP-13: Prompt type rule and its source`, `WP-13: Cost and
answers estimate in lint`, `WP-13: Branded override and provenance at create`, `WP-13: Quota and limits read`,
`WP-13: Prompt list filters and sort`, `WP-13: Bulk update and bulk archive by filter`, `WP-13: ETag and If-Match
on prompt changes`, `WP-13: Term assignments and term counts for prompts`, `WP-13: As built notes for the
prompts lane`, `WP-13: Regenerate the API document and web client`.

## Reviewer checklist (every task)

1. Tests were written first and named as above; the targeted run (medium lane, `-n 2 --no-cov`) is green.
2. Only owned or leased files changed; no shell edits; ASCII only; commit title form; no staged files of others.
3. Every statement names `workspace_id`; project scoped reads name `project_id`; a foreign project is 404 from
   the service; foreign ids are not matched.
4. Lint writes nothing; lint and limits are `data:read`; writes are `prompts:write`; viewer refused before
   any new member is read.
5. Aggregates and counts are one grouped statement with a statement count test; new costly parts are opt-in
   (`items` shape, `include=prompt_count`) and absent unless asked; the list never filters branded silently.
6. Quota and money: numbers equal the writes' own (`quota_usage`, `ai_tasks_since`, `monthly_cost`); exact
   expected values in the tests; null, never zero, for a missing price.
7. Cursor: the scope includes every used filter and the sort; old cursors without sort still decode.
8. Each removed `refuse_unbuilt` entry, raise and `Not built yet` text is gone; `@not_built` gone for both stubs.
9. mypy strict clean; no `Any` added; ruff and format clean.
10. Prove it bites: weaken each guard of the task in a scratch commit never pushed, run the named test,
    record the failure, restore. Guards: lint stores nothing (Task 1); would_create arithmetic (1); estimate
    arithmetic (4); limits scope (6); cursor scope (7); bulk update project scope and filter quota (8);
    If-Match (9); assignment scope and count visibility (10).

Package end: a second fresh reviewer reads the whole diff against the brief's acceptance criteria and the 31
rows. There is no web page in this package, so the four width browser check does not apply.
