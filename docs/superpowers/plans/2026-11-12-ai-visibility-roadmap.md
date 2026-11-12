# AI visibility: roadmap and sequencing

Status: written 2026-11-12, awaiting owner review. Sequencing only: scope lives in the other four documents.

| Document | Role |
|---|---|
| [Competitor study](../specs/2026-11-12-ai-visibility-competitor-study.md) | What to drop, keep, build and borrow (IDs AP, PR, DB, FO, CI, OP, GA, GD, GF, M, U) |
| [Preview parity spec](../specs/2026-11-12-topics-prompts-preview-parity.md) | Gaps G01 to G125, decisions D-1 to D-10, preview mistakes |
| [Web plan W2](2026-11-12-ai-prompts-w2-web-parity.md) | Web tasks W1 to W16 |
| [Backend handoff D](2026-11-12-ai-prompts-d-backend-handoff.md) | Backend items B6 to B19, start order, owner decisions |
| [D1](2026-11-12-ai-prompts-d1-summary-additions.md) | Backend plan for B1 to B5 (B1 built, `6d681a5`) |

Slices follow the [slice 1 spec](../specs/2026-11-11-ai-prompt-tracking-slice-1-design.md) section 2: S2 recommendation, rank, prominence, sentiment, entity candidates, AI Overview, fan-out, retrieved-not-cited; S3 replicates, intervals, period comparison, volatility; S4 panels, versions, text edits, candidates inbox, keyword links, alerts. Releases: work lands in `develop`; `main` only through `infra/ship.sh` when the owner says to release ([release runbook](../../ops/release-and-deploy.md)).

## 1. Stages

### Stage 0: decisions (before the backend starts; the web does not wait)

The owner answers the decisions of the handoff section 5 and the parity spec section 4. None blocks stage 1 web work.

| Decision | Recommended | Blocks |
|---|---|---|
| Cadence: weekly or twice a week | Twice a week as built | B10 Panels (stage 5) |
| Restore as a `change_kind` | No | B11 (stage 5) |
| Source of `prompt_type` | Server rule plus person override | B16, the Type filter |
| Slice owning B5 and B6 | Slice 2, built now | stage 2 competitor and Citations views |
| Weekly series path | `include=series` | none (D1 proceeds) |
| gzip for the API | decided separately | response size of `include` |
| Nested topics (D-3) | Flat now, decide before W2 ships if the taxonomy goes deeper than two levels | topic table layout |
| Bulk Run now capped at 20 a day in the browser until B7 (D-5) | Ship capped | W5 |
| Page level AI readiness in scope (W15) | Not yet | stage 5 new items |

### Stage 1: web only on slice 1 data, in parallel with the first backend items

Web session: W1 metric strip and pill, W2 rate columns and sorting, W3 previous period deltas, W4 prompt inspector tabs, W5 menus, bulk actions, export, views. Each is its own commit and needs no backend change. Order is value first; W1 and W2 share files, so they go in sequence; W3 and W4 can run in parallel in separate worktrees; W5 last.

Backend session in parallel: **B2** (D1 Task 2), then D2 starting with **B6** (and B7 and B19 as stage 2 begins). The web starts W6 and W7 against mocks of these contracts as soon as the contracts are written, so the stage boundary is soft.

Exit: the Topics & Prompts page on slice 1 data matches the preview for every row the parity checklist (section 8) marks "slice 1".

### Stage 2: wiring

| Web | Needs | Backend order |
|---|---|---|
| W6 header meta, stale badge, country and Branded Only scope | B1 (built), B2 | B2 first |
| W7 Citations tab and Citations page | B6 | B6 second |
| W8 competitor views | B5 (D1 Task 5) | B5 third |
| W10 bulk run | B7 | B7 after B19 |

Backend order once the owner says go: **B2, B6, B5, B19, B7**, then B4 and B3, then the B9b split. W9 (fan-out) and W11 (trend) depend on items that appear later in that list and are scheduled in stage 3.

### Stage 3: slice 2

Fan-outs (B19, W9, adopt U-07); per entity cells for every view (B5, already built in stage 2); recommendation, prominence, sentiment (B14: DB-09, M-07, G42, G121, W2's Recommendation column); AI Overview as the fourth engine (B13, needs keyword links); entity candidates and competitor discovery (DB-20, M-22); retrieved-not-cited (FO-07); AI Visibility Overview page (W13); previous period and weekly series in the API (B4 and B3, built early as D1 Tasks 3 and 4, with W3 switching to one read and W11 landing).

### Stage 4: slice 3

Intervals and `ci` on `MetricCell`, the paired verdict on `compare`, replicates, volatility and flip rate (B15); the interim unpaired test of W3 is replaced by the server verdict; trends with bands (G29, G112); what-if sizing (M-17); change alerts need detectability (M-01).

### Stage 5: slice 4 and the new items

Panels and Versions (B10 to B12, W14), text edits, keyword links, the candidates inbox and recommended prompts (B18, W12, adopt U-06), saved views persistence (B8), alerts (M-01, M-13). New items, all NEW in the study and none scheduled until approved:

| Item | Study ids | Notes |
|---|---|---|
| Page level AI readiness: robots.txt per AI bot, `llms.txt`, JSON-LD vs page type | M-09, M-10, GD-15, GD-16 (W15) | Product decision and an SSRF-safe fetch service ([24](../../24-security.md) 7.3) first |
| Change alerts: mention or citation lost or gained, competitor overtakes | M-01 | Specified (doc 11 section 10, doc 20 5.17); needs B15 |
| Answer diffs | M-03 | AnswerCompare (DS 23 6.3), Prompt Detail T3 |
| Client reports: shareable link and PDF | M-12, M-13 | CSV first (W5); PDF and branding NEW |
| Prompt to page mapping | M-02, PR-51 | First version comes with B6 |

## 2. Dependency table

| Web task | Needs backend item | Can start against mocks | Stage |
|---|---|---|---|
| W1 metric strip | none | not needed | 1 |
| W2 rate columns, sorting | none | not needed | 1 |
| W3 previous period | none (D1 Task 3 / B4 later) | yes | 1 |
| W4 inspector tabs | none (Citations tab waits for W7) | yes | 1 |
| W5 menus, bulk, export, views | none (B7 lifts the cap; B8 for persistence) | yes | 1 |
| W6 header meta, scope | B1 built; B2 (D1 Task 2) | yes | 2 |
| W7 Citations | B6 | yes | 2 |
| W8 competitor views | B5 (D1 Task 5) | yes | 2 |
| W9 fan-out view | B19 | yes | 3 (mock earlier) |
| W10 bulk run | B7 | yes | 2 |
| W11 weekly trend | B3 (D1 Task 4); entity lines need B5 | yes | 3 |
| W12 Discover inbox | B18 (slice 4) | yes, but wait for the contract | 5 |
| W13 Overview page | Ph 9 overview, or B6 plus B5 | partly | 3 |
| W14 Panels, Versions | B10, B11, B12 | no | 5 |
| W15 AI readiness | decision and fetch service | no | 5 |
| W16 topic SEO columns, mobile rows | B9b for visibility only | counts yes | 2 to 3 |

## 3. Who does what

| Work | Web session | Backend session |
|---|---|---|
| Stage 1 | W1 to W5, mocks for the D1 contract | B2 (D1 Task 2); write D2 (B6, B7, B19) |
| Stage 2 | W6, W7, W8, W10 (each first as a mock, then `pnpm gen:api` when the route is on develop) | B6, B5 (D1 Task 5), B19, B7 |
| Stage 3 | W9, W11, W13 | B4, B3 (D1 Tasks 3 and 4), B9b, B14, B13, entity candidates |
| Stage 4 | replace the interim test with the server verdict, bands | B15 |
| Stage 5 | W12, W14, W15 when approved | B8, B10 to B12, B17, B18 |
| Always | Keep `apps/web/src/lib/api/schema.ts` regenerated in the task that needs it; update the parity checklist | Regenerate `backend/openapi/v1.json` with each API change; write the As built notes in docs 19 and 29 |
| Owner | answers the stage 0 decisions; says "go" to the backend and "ship it" to release | |

## 4. First week plan

| Day | Web | Backend |
|---|---|---|
| 1 | Rebase on `origin/develop`, `pnpm gen:api` (B1 fields). Start W1: rate model and tests first | Owner says go. Start D1 Task 2 (B2) |
| 2 | W1 strip and pill, percent beside counts | B2 tests and OpenAPI; start the D2 plan (B6 first) |
| 3 | W2 rate columns and sorting | Finish B2; D2 plan reviewed; B6 task 1 (`ai/citations`) |
| 4 | W3 Delta component and previous read | B6 `sources/domains` and `sources/pages` |
| 5 | W4 starts (history model and tests); write the B6 mock to the contract in the handoff | B6 tests, cross-tenant, OpenAPI; hand the web the contract |
| End of week | Stage 1 is half done: W1 to W3 merged to `develop` | B2 and B6 on develop; B5 next |

No release is planned this week; `main` moves only when the owner says to ship.

## 5. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| **Cadence conflict.** Three sources, two answers (slice 1 and the base plan: twice a week; doc 11 section 8 and the preview: weekly core, monthly discovery; commit `c1abdd4` set mocks weekly) | Panels, the Panels tab copy and any "weekly" trend promise disagree with collection | Decision 1; until then the page says "twice a week"; do not build Panels |
| **Topic vocabulary shared with keywords.** The "In search" card and the topic SEO columns assume keyword topics and prompt topics are one vocabulary; not verified | A topic could count the wrong keywords | Verify before W16; the check is a grep and one query on `core.taxonomy_terms` |
| **16 KB `provider_extras` bound.** `_bounded` halves the longest list and sets `truncated`; a long fan-out list can be cut | A fan-out view could show a partial list as complete | B19 reports `answers_truncated`; W9 shows the note; do not compute F4 shares without the denominator note |
| **Provider payload quotes.** Whether the raw payload carries a quote per citation is unchecked (CI-11) | U-24 "Quoted passage" cannot be promised | Treat as NEW; check one raw payload before W7 scopes a quote section |
| **Response size.** `include=series,entities` is about 1.5 MB at full capacity and the API has no gzip middleware (D1 open point 3) | Slow drawers | Ask for `include` only with `filter[term]` or a small page; decide gzip |
| **Interim detectability test** disagrees with the prompt weighted value (D-2) | A coloured delta that the number does not support | Label it interim; paired test in stage 4 |
| **Copying the preview's invented numbers** (jitter trend lines, flip rates, authors) | False data on screen | Parity spec section 6 item 6; empty states instead |
| **Two sessions on `schema.ts` and `schemas/ai.py`** | Rebase conflicts | D1's split (backend regenerates `openapi/v1.json`, web regenerates the client) |
| **Rank data issues at the provider** feed AI Overview (B13) | Slice 2 AI Overview column is unreliable | Keep it out of slice 1; decide at slice 2 start |
| **Mocks drift from the contract** | Surprises at wiring | Mock handlers have tests; the backend commit lists the contract changes; the first task after a backend merge is `pnpm gen:api` and a typecheck |

## 6. Where idraft already leads and what we protect

Counts with denominators, evidence viewer, engines and countries checked together, one definition per metric, honest states (study section 5.1). Every task must keep these: a percent never appears without its count, a rate under 4 answers never appears without the pill, a colour never appears without a detectable change. Intervals are a planned lead (W4 first, B15 later), not a current one.

## 7. Open items needing owner input

Stage 0 decisions; nested topics (D-3); whether W15 is in scope; whether to read `AGENTS.md` literally about regenerating the web client in the backend commit (handoff section 5, decision 7).

## 8. How we measure that the page is at parity

Parity means every row below is ticked or has a named reason. "S1" rows need no backend item.

**Slice 1 data (W1 to W5)**
- [ ] Metric strip: Prompts card plus one card per enabled engine, hidden in the empty state, skeletons while loading (G12)
- [ ] Percent beside every count; insufficient pill under 4 answers (G13)
- [ ] Topics: Mention rate (avg of N) and Citation rate columns, Top engine, sorting with default Mention desc, Expand all, subtitle, footer counts (G20 to G25, G33)
- [ ] Prompts: Mention rate and Citation rate columns, metric switcher with Share of voice, default sort Mention desc, topic path badge (G40, G41, G45)
- [ ] Compare with previous period, deltas on strip, rows and drawers, Detectable changes only chip (G05, G06, G111, G115)
- [ ] Prompt inspector tabs Latest, History, Competitors counts, Stats with intervals; Citations tab prepared (G90 to G96, G98, G100, G48)
- [ ] Row and topic menus, bulk bar, Add prompt from a topic, export CSV, Copy link, view presets, Branded Only on Prompts, date range to 92 days, Edit details, topic J and K (G02 to G04, G07, G08, G26 to G28, G46, G47, G82, G110, G118, G123 to G125)

**Needs a backend item**
- [ ] Header meta, Updated and Stale, country scope on Topics (B1, B2: G01, G11, G30, G44)
- [ ] Citations tab and Citations page (B6: G97, CI-01 to CI-16)
- [ ] Competitors tab, Top competitor, per entity share of voice (B5: G43, G116, G98)
- [ ] Fan-out view (B19)
- [ ] Bulk run (B7)
- [ ] Weekly trend sparklines and the topic visibility trend (B3, B5: G29, G112)
- [ ] Topic SEO columns and "In search" (B9: G31, G114, G117), mobile list rows (G14)

**Later slices (not part of parity, named so nothing is lost)**
- [ ] Recommendation column and card (G42, S2), AI Overview (G120, S2), intervals from the API (S3)
- [ ] Panels, Versions, Edit prompt text, Link a keyword, Open page (G60 to G70, G81, G99, G102, S4)

**Quality bar for every row:** the mock and the real route agree after `pnpm gen:api`; axe passes at four widths in both themes (as plan C task 11); no dash used as punctuation in any message; the owner has seen the page on real answers from the Eventus Security project ([ai-first-run](../../ops/ai-first-run.md)).
