# Google AI Overview as the fourth platform (WP-64 task 1, rewritten)

Owner decision, 2026-11-25: build now. This treats D-50 as decided. Rank checks must run for real data to appear; this plan makes
the platform real in the product, it does not restart rank tracking.

## Why WP-64 is rewritten

WP-64 bundled five pieces of work (17 rows, about 9 hours). Only task 1 makes AI Overview a platform. Tasks 2 to 5 (AI Mode on
keywords, SEO visibility per topic, links suggest and matrix and page intelligence, fan-out and competitor views) stay in WP-64
and are not part of this plan. The inventory statuses were also out of date: BE-AIO-01, BE-AIO-03 and CF-19 are built
(commits 2efb8f36 and 4c797ec0: `api/ai/aio_summary.py`, `PromptAiOverview` with `source_state` and `checks`, `AiOverviewTotals`,
the web column, strip chip and by-platform row).

## What this plan builds

AI Overview is an engine of keyword level. It is read from the rank checks of a prompt's linked keyword. It is never asked per
prompt: no task, no endpoint, no price, no schedule, no run-now, no monthly estimate of its own (it is included with rank checks).

### Stage 1: the engine is real (this release)

1. Backend engine row. `EngineCode.GOOGLE_AI_OVERVIEW`, an `Engine` flag `keyword_level` (no endpoint asked per prompt), migration
   0039 inserting the `ai.engines` row (`serp_ai`, vendor google, citations yes, fan-out no). `GET /engines` lists it with
   `price_usd_per_month` 0 and a plain note that it comes with rank checks.
2. Keep AI Overview out of every per-prompt path: the planner (`collectors/ai_prompt.py _engines`), `askable_engines`, run-now and
   bulk run, cost estimates of prompts, `ensure_ai_schedule` (turning only AI Overview on must not create a prompt schedule), and
   the unit cost per engine. Raise the hardcoded `max_length=3` and `ENGINES_MAX = 3` limits to 4, and map the code in
   `api/internal_links/extras.py`.
3. Web: Settings Platforms row for Google AI Overview (switch, no price, note "Read from the rank checks of linked keywords"), the
   Platform select on the Overview and the Engine select on Prompts offer it as a choice, the strip and by-engine card keep the
   keyword figures they have (rate over prompts with a linked tracked keyword), cards with no AI Overview data say "Not collected
   for Google AI Overview" instead of zero. Regenerate the client with `pnpm gen:api`.
4. Mock: the design preview already models AI Overview as a working platform; align labels, the Platforms settings row and the
   not-collected states with the real app.
5. Targeted tests, browser check in the mock and the real app, merge to `develop`, release with `infra/ship.sh`.

### Stage 2: AI Overview answers as observations (next release, not started)

BE-AIO-02 (observations from rank checks with a SERP subject, own idempotency key), BE-AIO-06 (extraction of mentions and
citations from the AI Overview text through `extract_answer_facts`). This needs the AI Overview answer text, which the rank parser
does not keep today (`serp_parse.py` keeps state and citations only). The raw payload is kept, so it is a parser change plus a
writer. It is blocked on checking the raw `ai_overview` element shape against a real payload. Until then AI Overview has presence
and citation figures but no mention rate, share of voice, sentiment or position, and the cards say so.

## Tasks (one subagent at a time, tests first, one commit each)

| # | Task | Checks |
|---|---|---|
| 1 | Backend: engine code, flag, migration 0039, exclusions, limits to 4, tests updated | targeted pytest `--no-cov -n 0` on the files named by the research map, ruff, mypy on changed files |
| 2 | Backend: OpenAPI regenerated; web client `pnpm gen:api` | `pnpm typecheck` |
| 3 | Web: Platforms settings row and cost model; selects; strip and by-engine integration; not-collected states | vitest on changed files, lint, typecheck |
| 4 | Mock: align the design preview | open in the browser |
| 5 | Review (fresh Sonnet) and browser test of both | |
| 6 | Merge, `infra/ship.sh` | |

## Rules

Files are edited with the file tools. One commit per task, message `AI Overview engine: <task>`, no attribution lines, no dashes.
No real provider call in any test. Only targeted, serial checks (owner rule of 2026-11-17); the full `./check.sh` runs once, in the
main checkout, through `infra/ship.sh`.

## Stage 2 build (started 2026-11-26)

Owner go: "build stage 2" and add a Google AI Overview ring to the Outcome split by platform card.

Checked on a real prod payload (2026-11-26, three Eventus snapshots): the `ai_overview` item has `markdown` (the whole
answer), `items[]` (`ai_overview_element`, each with `text`, `markdown`, `links`, `references`) and `references[]` (`source`,
`domain`, `url`, `title`, `text`). So the answer text is in the payload the parser already receives; the parser only drops it.

Decisions:

1. Observation shape: one `ai.observations` row per rank check whose overview was shown and whose text loaded. Engine
   `google_ai_overview`, class `serp_ai`, `prompt_id` null, `tracked_keyword_id`, `serp_snapshot_id`, `serp_observed_at` and
   `query_text` set, raw payload shared with the snapshot. The unique key is the rank task, so a re-ingest writes nothing twice.
   Citations, entity mentions and the fact row go through the same functions as the other platforms (deterministic regex
   extraction, no model call, no cost).
2. A valid answer is a check where the overview was shown and its text loaded (`present`, `present_async_loaded`).
   `absent`, `present_not_loaded` and `unknown` are no answer: they never count as "neither".
3. A prompt's answer is its linked keyword's latest valid check (the keyword the existing `aio_summary` picks). Prompts that
   share a keyword share one check and each counts, so n on the ring is the number of prompts with a valid check, not the
   number of checks. The ring says so in its tooltip.
4. Two meanings of `isKeywordLevelEngine` are split: "never asked per prompt" stays (run-now, cost, schedules); a new
   predicate says "has answers" (Citations, Competitors, answer reads, Outcome split).
5. Existing checks gain text by re-reading the stored payloads (free); no provider call.
6. No prod write and no release without the owner's word.

Order: parser and writer, extraction and backfill, summary read, OpenAPI and client, ring, then Citations, Competitors and
Prompts one at a time.
