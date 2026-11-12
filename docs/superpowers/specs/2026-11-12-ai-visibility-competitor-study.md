# AI visibility: competitor study (what to drop, keep, build and borrow)

Status: written 2026-11-12 for the product owner; the owner answered Q3 and Q4 on 2026-11-12 (section 8). A study, not a build commitment: it fixes stable IDs so plans can cite a data point or a verdict, and it states what each item needs from the backend.
Roadmap: sequencing is in [2026-11-12-ai-visibility-roadmap.md](../plans/2026-11-12-ai-visibility-roadmap.md). The page-level gaps against our own approved preview are in [2026-11-12-topics-prompts-preview-parity.md](2026-11-12-topics-prompts-preview-parity.md).
Specs this study reads against: [AI prompt tracking slice 1](2026-11-11-ai-prompt-tracking-slice-1-design.md), [11](../../11-ai-prompt-system.md), [14](../../14-citation-intelligence.md), [15](../../15-seo-ai-correlation.md), [16](../../16-metrics-methodology.md), [19](../../19-api-specification.md) section 3.7, [20](../../20-frontend-specification.md), [24](../../24-security.md), and the design system ([24-page-templates](../../design-system/24-page-templates.md), [23-application-patterns](../../design-system/23-application-patterns.md), [15-data-visualization](../../design-system/15-data-visualization.md)).

## 1. Purpose and method

**Purpose.** Decide, data point by data point, what an AI visibility product shows that idraft should not copy, should copy and show better, already does better, or neither tool has. The output feeds the web plan ([2026-11-12-ai-prompts-w2-web-parity.md](../plans/2026-11-12-ai-prompts-w2-web-parity.md)) and the backend handoff ([2026-11-12-ai-prompts-d-backend-handoff.md](../plans/2026-11-12-ai-prompts-d-backend-handoff.md)).

**The studied tool.** One competing product, Nuwtonic (an AI search visibility and GEO tool), is the only external product in this study. From here on it is "the studied tool".

**Method.**

| Item | Value |
|---|---|
| Date inspected | 2026-11-12 (one session) |
| Access | One signed-in workspace of the studied tool (28 saved prompts, one tracked brand, a security vendor in India and the Middle East) |
| Pages inspected | Nine: Add Prompt, Prompt Run (list and per-prompt detail), Dashboard, Prompt Fan-outs, Citations, Off Page GEO, GEO Audit, GEO Audit Dashboard, Advanced GEO Optimizations |
| Mode | Read only. Nothing was added, saved, run or generated; buttons that spend credits (Run now, Run all, Analyze, Generate, Fix) were never clicked |
| Viewports | 1440 by 900 desktop and a phone pass (375 or 390 wide) |
| Evidence | One inventory per page (purpose, layout, every displayed metric, formulas where visible, empty and error states, mobile). The inventories are working notes kept outside the repository (files named `nuwtonic-<page>.md`); this study quotes their findings and does not reproduce them |
| Our side | Code and docs read by grep, not assumed: every status below names the file or doc it rests on |
| Limits | One workspace and one tracked day on the Dashboard; some degenerate numbers (momentum, per day) may look better with more days. Drop verdicts rest on definitions, not only on that sample |

A "data point" is a displayed metric, field or fixed label that carries information. 195 were reviewed: **87 kept, 108 dropped.**

| Page | Kept | Dropped |
|---|---|---|
| Add Prompt (AP) | 15 | 9 |
| Prompt Run (PR) | 20 | 35 |
| Dashboard (DB) | 8 | 24 |
| Prompt Fan-outs (FO) | 12 | 5 |
| Citations (CI) | 12 | 6 |
| Off Page GEO (OP) | 7 | 7 |
| GEO Audit (GA) | 2 | 3 |
| GEO Audit Dashboard (GD) | 10 | 17 |
| Advanced GEO (GF) | 1 | 2 |

Drop classes across the 108: DEFECT 42, NOISE 21, SCORE 20, DUP 19, PLAN 5, SCOPE 1. 62 of the 108 have a corrected replacement among the kept points.

## 2. How to read the status words

| Word | Meaning |
|---|---|
| BUILT | Exists in the web app or backend today on `origin/develop`; the file, route or screen is named |
| PLANNED | In our docs or in the parity spec, not built; the reference is named |
| NEW | In neither our docs nor our code |
| S1+ | Slice 1 follow-up: web work on data slice 1 already collects (gap ids G.. in the parity spec) |
| S2, S3, S4 | AI prompt tracking slices as named in slice 1 spec section 2. S2: recommendation, rank, prominence, sentiment, entity candidates, AI Overview, fan-out, retrieved-not-cited. S3: replicates, intervals, period comparison, volatility. S4: panels, versions, text edits, candidates inbox, keyword links, alerts |
| doc nn, DS nn | `docs/nn-*.md` and `docs/design-system/nn-*.md` |
| Ph n | Phase n of [29-phase-roadmap.md](../../29-phase-roadmap.md) (older numbering; where a Ph 9 or Ph 13 route has no slice, "no slice assigned" is written) |
| B n, G n, W n | Backend item and gap item of the parity spec; web task of the web plan |
| Size | S under a day, M one to three days, L more (estimates, not measured) |

Status corrections made on 2026-11-12 against the earlier draft of this study:

| Item | Earlier reading | Now |
|---|---|---|
| Topic drawer | Missing | BUILT: `apps/web/src/features/prompts/topic-inspector.tsx` (Overview and Prompts tabs, per-engine rates, top prompts). Competitors, Related and trend are still missing |
| Metric strip | Planned | Still NOT built (the Prompts feature has no `MetricStrip`); web task W1 |
| Run now mocks, raw answer 410 and 503 | Open | BUILT on `origin/develop` (mocks deliver a Run now answer; `answer-inspector.tsx` says when the raw answer is past retention or not available) |
| AI schedules deleted | Backend gap | Fixed by `e4aa8d8` (turning an engine on recreates them, only on an off to on change) |
| `last_observed_at`, `last_valid_at` (B1) | Backend gap | BUILT on `origin/develop` (`6d681a5`); the web has not read them yet |
| Confidence intervals | A lead | NOT a lead yet: `ci` is null in slice 1 and the Wilson library (`apps/web/src/lib/stats/wilson.ts`) is not used on screen. Planned S3 |

In the drop list, a drop means: do not carry this over as the studied tool defines or shows it. Where a correct version exists, "Replaced by" names the kept data point.

Drop classes: DUP repeats another data point; SCORE is an opaque or composite score (our [02-product-requirements.md](../../02-product-requirements.md) section 5 and NFR-10 forbid an opaque AI visibility score); DEFECT is misleading as built; NOISE is decorative, unexplained or unverifiable; PLAN is a credit or plan mechanic; SCOPE is excluded by our product scope.

## 3. The drop list

Examples checked and confirmed on the studied tool:

| Example | Result | Rows |
|---|---|---|
| Totals that change with the loaded rows | Prompts cited 12 then 17, average coverage 24% then 26%, total runs 132 then 192, again under search | PR-02, PR-03, PR-04 |
| Three totals for one number | One competitor share is 15.6% (of 225), 18.6% (of about 188) and 14.6% (of 239). Citations says 50 and 39 for one idea | DB-12, DB-13, DB-14, CI-02, CI-06 |
| A card named SEO Health that is a GEO score | It is the mean overall GEO score | GD-02 |
| Green zero-change chips | "+0.0 pts" in green with no earlier audit; elsewhere relative percents of tiny bases (400% on a rank) | GD-04, DB-02 |
| A Dashboard with no date range | No date, engine, country or compare control, while tooltips cite a "selected date range" | DB-02 |
| Unexplained slot counters | 44 of 50 used while 28 prompts are saved | AP-14, AP-15, AP-16 |
| Inconsistent engine names | OpenAI, Anthropic, Meta in filters; ChatGPT, Claude, Llama on chips | PR-22 |
| Positions that differ list vs detail | List shows #7 and #8, the detail strip #5 and #5 | PR-17 |

### 3.1 Add Prompt

| ID | Data point | Why dropped | Class | Replaced by |
|---|---|---|---|---|
| AP-02 | Funnel chip counts (89, 30, 30, 29) | Disagree with the list count (88); hiding added prompts changes rows, not chips | DEFECT | AP-01 on one filtered set |
| AP-07 | Buyer intent colours | Moderate and Low both rose, so the middle tier looks as bad as the worst; red on a normal top of funnel question reads as a warning | DEFECT | neutral text in AP-06 |
| AP-08 | Priority filter and sort on suggestions | The field is never displayed | NOISE | AP-21 |
| AP-13 | Toolbar frequency, location, language on the suggestion list | Changing them changes nothing visible | NOISE | AP-10 to AP-12 at add time |
| AP-14 | "44 / 50 prompts used" | Contradicts 28 saved prompts beside it; 16 slots never explained | DEFECT | AP-17 |
| AP-15 | Red quota bar, "6 slots left" | Derived from AP-14 | DEFECT | AP-17 |
| AP-16 | Slot cost by frequency | Unexplained weighting; a credit mechanic | PLAN | none |
| AP-18 | Plan note, "daily tracking disabled for LTD plans" | Plan artefact of a lifetime deal | PLAN | none |
| AP-24 | Green dot before each saved prompt | Decorative | NOISE | AP-22 |

### 3.2 Prompt Run

| ID | Data point | Why dropped | Class | Replaced by |
|---|---|---|---|---|
| PR-01 | Prompts tracked card | Third place the same count appears | DUP | AP-23 |
| PR-02 | Prompts cited card | Recomputed from loaded rows, no denominator or period | DEFECT | CI-01 |
| PR-03 | Average coverage card | Unweighted mean of per-prompt percentages over loaded rows | DEFECT | DB-01, PR-06 |
| PR-04 | Total runs card | Sum over loaded rows; "runs" mixes engines and repeat checks | DEFECT | n in PR-06 |
| PR-07 | Coverage bar colours | Thresholds never stated; differ from the Visibility column | NOISE | none (colour only for detectable change) |
| PR-08 | Average position over cited runs only | Blank for uncited and sorts as best; ignores how often cited; a source position is not a rank | DEFECT | PR-32, structured rank in S2 |
| PR-09 | Runs per prompt (6 or 12) | Mixes engines with repeat checks | DEFECT | n beside each rate (PR-06) |
| PR-10 | Cited / Not cited badge | Flips on one cited answer of six; hides weak coverage | DEFECT | PR-06 |
| PR-14 | "What changed vs the last check" banner on the list | One prompt's latest delta shown as global | DEFECT | PR-41 |
| PR-16 | Cited with grade A, B, C | Invented thresholds, composite of position | SCORE | none |
| PR-17 | Position in manual-runs table | Differs from the detail strip for the same run | DEFECT | PR-32 |
| PR-18 | Score 0 to 100 per run | Formula is 100 minus 5 times (position minus 1): invented | SCORE | none |
| PR-19 | Improved, Declined, Unchanged pills and row tint | Compares two single answers with no variance | DEFECT | PR-41, M-03 |
| PR-22 | Provider names (OpenAI, Anthropic, Meta) in filter and charts | Two names for one engine | DEFECT | one engine label (ADR-DS-020) |
| PR-24 | Citation gap input pre-filled with a bare domain | A domain is not a page to optimise | DEFECT | PR-23 with a chosen page |
| PR-26 | Engine chip order differs per prompt | Unstable | NOISE | fixed engine order (DS 14 section 4) |
| PR-28 | Sentiment "0.2" per answer | Bare number, no scale, "Not available" for most | DEFECT | DB-09 |
| PR-30 | "Brands mentioned" list | Lists cited source domains, not brands named | DEFECT | mentions in PR-27 |
| PR-33 | KPI Total runs | Repeat of PR-04 | DUP | PR-06 |
| PR-35 | KPI Average position | Repeat of PR-08 | DUP | PR-32 |
| PR-36 | KPI Visibility score (67) | Mean of per-run scores, a composite | SCORE | none |
| PR-37 | KPI Top 3 rate | Top 3 of citation order, not of a ranked list | DEFECT | structured top 3 (A9, S2) |
| PR-39 | Fixed KPI card colours | Colours are identity, not meaning | NOISE | none |
| PR-40 | Rank trend (two points, "Dropped 6.5") | Average over cited engines only; two points are not a trend | DEFECT | PR-41 |
| PR-43 | Top 3 bar per provider | Repeat of PR-37 | DUP | PR-42 |
| PR-44 | Run share by provider donut | Equal by design; no legend; donuts not allowed by DS 15 | NOISE | none |
| PR-45 | "X has the highest citation rate" | Names a winner at 0.0% | DEFECT | none |
| PR-46 | Provider cards with ring gauges | Ring of a composite score | SCORE | PR-42 |
| PR-47 | Top 10 Visibility Share per domain | Rank-weighted with an invented top 3 boost | SCORE | CI-04 |
| PR-48 | Top 10 Position Strength Share | Share of inverse rank, invented | SCORE | CI-04 |
| PR-49 | "Top coverage 92.4%, Others 7.6%" | Split of a score share; no decision depends on it | NOISE | none |
| PR-52 | Visibility bar per tracking run | Per-run composite with its own colour thresholds | SCORE | PR-50 |
| PR-53 | Expanded run: sources tagged "Target" | Same list as PR-31, own page tagged differently | DUP | PR-31 |
| PR-54 | Provider shown as logo only | Already PR-21 and PR-25; no text for assistive tech | DUP | PR-21 |
| PR-55 | Manual runs strip scoped to one prompt | Repeats PR-11 to PR-20 for one prompt | DUP | PR-11 to PR-15 |

### 3.3 Dashboard

| ID | Data point | Why dropped | Class | Replaced by |
|---|---|---|---|---|
| DB-02 | Delta chips (68.1%, 530.0%, 400.0%) | Relative percent change from a tiny base, period never shown, no sample size, red for a rise in a rank | DEFECT | points with detectability (W3, S3) |
| DB-03 | Status pills Healthy, Watch, Needs action | Thresholds hidden; verdict words | SCORE | descriptive labels (`OpportunityStatus`) |
| DB-04 | Total mentions (63) | Derived from citation URLs, not from answer text | DEFECT | DB-12 |
| DB-05 | Average position KPI | Repeat of PR-08 | DUP | PR-32 |
| DB-06 | Top 3 presence | Repeat of PR-37 | DUP | A9 in S2 |
| DB-07 | Visibility score (21.3%) | Composite | SCORE | DB-01 |
| DB-08 | Brand authority score (92.0%) | Separate model, not from prompt runs, delta fixed at 0.0% | SCORE | none |
| DB-10 | Your Key Scores bar chart | Repeats DB-01, DB-06, DB-07, DB-08; red under 50 with no stated thresholds | DUP | DB-01 |
| DB-11 | AI Answer Coverage donut | Repeat of DB-01 as a donut | DUP | DB-01 |
| DB-13 | Mentions by Brand bar | Same data as DB-12, colours re-assigned by rank | DUP | DB-12 |
| DB-14 | Top 10 Mention Share, total 239 | Third total for one share; "Others 5%" noise | DEFECT | DB-12 |
| DB-15 | Top 10 Visibility Share | Rank-weighted, invented formula | SCORE | CI-04 |
| DB-16 | Pressure index (48.9) | Undefined blend of share, rank and day coverage | SCORE | none |
| DB-18 | Competitor share (72.0%) | 100 minus own share | DUP | DB-12 |
| DB-19 | Momentum leader (-12.0 mention/day) | One day of data, so every competitor "falls" | DEFECT | none (needs two windows, M-01) |
| DB-22 | Per-competitor average position | Repeat of PR-08 | DUP | none |
| DB-23 | Per-competitor momentum | Equals minus the mention count | DEFECT | none |
| DB-24 | Per-competitor day coverage | 100% on every row | NOISE | none |
| DB-25 | Per-competitor mentions per day | Equals total mentions | DEFECT | none |
| DB-26 | Rank Position vs Mention Share scatter | Axis is the undefined average position; "strong rank zone" is a judgement | SCORE | SEO and AI matrix (doc 15) |
| DB-27 | Competitor Pressure Ranking bars | Sorted ascending under a title that says sorted by pressure | DEFECT | DB-28 |
| DB-29 | Brief counts (sections 5, signals 35) | Vanity counts | NOISE | none |
| DB-30 | Brief prose: overview, presence, reputation | LLM text with no sources or dates | NOISE | none |
| DB-32 | Brief "Risks flagged" and "Action items" | The one risk was not a risk; actions empty | DEFECT | none |

### 3.4 Prompt Fan-outs, Citations, Off Page

| ID | Data point | Why dropped | Class | Replaced by |
|---|---|---|---|---|
| FO-06 | "0.6% of all fan-outs" | Share of 310 uses; denominator moves with the prompt filter | DEFECT | FO-05 |
| FO-08 | Priority High, Medium, Low with "Score 100/100" | Inverse of the citation rate; nearly every row High 100 | SCORE | FO-07 |
| FO-10 | Header "302 opportunities" | Counts every query, cited or not | DEFECT | FO-16 |
| FO-12 | Topic cluster "Priority 0 or 1" | Unexplained | NOISE | FO-11 |
| FO-15 | "All fan-out queries" tab | Same 302 rows as Opportunities | DUP | FO-01 |
| CI-02 | "50 other pages keep winning" | Conflicts with KPI "39 beating you" | DEFECT | CI-14 |
| CI-03 | Cited you KPI and bar | Repeat of the headline | DUP | CI-01 |
| CI-06 | Beating you (39) | URL count, "keep winning" never defined | DEFECT | CI-14 |
| CI-08 | Pos (#1, #4) | Best, first or average, for which engine: never said | DEFECT | PR-32 per answer |
| CI-17 | "Positions 1 then 3, 7" | Compact notation, ambiguous | DEFECT | per-engine columns (CI-12) |
| CI-18 | Rank number box on winning cards | Ties across engines; meaningless as a rank | NOISE | none |
| OP-01 | "Run at least 10 prompts first" | Arbitrary gate | PLAN | none |
| OP-02 | 50 credits, "only the last run is stored" | Credit mechanic; no history | PLAN | none |
| OP-03 | "Recommended plan" paragraph | LLM prose, no evidence link or date | NOISE | none |
| OP-05 | High priority tab (0) | Always empty because priority is flat | NOISE | none |
| OP-06 | Priority Medium or Low | 32 Medium, 12 Low, 0 High: orders nothing | SCORE | none |
| OP-11 | "No competitors listed" | Ambiguous: none exist, or not analysed | DEFECT | OP-10 with the real count |
| OP-13 | Ready-to-use draft (Reddit comment, LinkedIn post, pitch email) | Generated content is a V1 exclusion (doc 02 section 5); posting brand replies in forums raises compliance risk | SCOPE | OP-12 checklist |

### 3.5 GEO Audit, GEO Audit Dashboard, Advanced GEO

| ID | Data point | Why dropped | Class | Replaced by |
|---|---|---|---|---|
| GA-03 | "5 credits" per audit | Credit mechanic | PLAN | none |
| GA-04 | Sitewise "Coming Soon" | Placeholder, no data | NOISE | none |
| GA-05 | "All major LLMs" | Not selectable, not listed | DEFECT | none |
| GD-01 | AI Citation Readiness (25.2) | Mean of per-page composites | SCORE | GD-15 |
| GD-02 | "SEO Health" (41.4) | Mean overall GEO score under an SEO label | DEFECT | none |
| GD-04 | "+0.0 pts" in green | No earlier audit; a zero looks like an improvement | DEFECT | none |
| GD-05 | "Critical" rating | Thresholds never stated | SCORE | none |
| GD-07 | Score pill per page | All eleven red | SCORE | GD-15 |
| GD-09 | Impact label | "Critical" on all 11 rows | NOISE | none |
| GD-10 | Two unlabeled type icons | Identical on every row | NOISE | none |
| GD-11 | Three sub-tabs | Same 11 pages and values on each | DUP | GD-06 |
| GD-12 | "Total Fixes: 22" | 22 recommended but 11 rows and 0 generated | DEFECT | GF-02 |
| GD-13 | Summary ring (41.4) | Repeat of GD-02 | DUP | none |
| GD-14 | Category bars (69, 55, 45) | First page only, mistaken for site-wide | DEFECT | GD-15 |
| GD-20 | Nine per-page 0 to 100 metrics | Opinion scores; checks carry the same evidence | SCORE | GD-15 |
| GD-22 | Letter grade (F on all 11) | Composite | SCORE | none |
| GD-23 | E-E-A-T and link-authority verdicts | LLM verdicts, no evidence | NOISE | GD-19 |
| GD-24 | "Simulated AI answer" | One sentence restating the score; not an answer | DEFECT | none |
| GD-26 | Difficulty and expected outcome of actions | "Medium" everywhere | NOISE | none |
| GD-27 | Top keywords per page (5) | We track keywords | DUP | tracked keywords |
| GF-01 | Empty state and 3 step text | Dead end: no cost, no sample, no target | NOISE | GF-02 |
| GF-03 | 22 recommended vs 0 generated | Two objects, one name | DEFECT | GF-02 with status |

## 4. Keep and improve, per studied page

`Our way` is the better presentation or definition; `Status` is as of 2026-11-12; `Data source` names the table, column or route. "Web only" means the data already arrives from `GET {P}/ai/prompts-summary` or `GET {P}/ai/observations` (`P` is the project path).

### 4.1 Add Prompt: to Topics & Prompts (Add dialog, Prompts tab) and Discover > Prompts

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| AP-01 | Suggested count | Count in the toolbar computed on the same filtered set as rows and chips; "New 24" as a `CountTabs` count | Discover > Prompts | PLANNED S4 candidates inbox (doc 20 5.13, DS 24 9.11) | `ai.prompt_candidates` (doc 11 5.2); `{P}/prompt-candidates` not built |
| AP-03 | Funnel stage | Neutral `Badge` plus `FilterChip` "Stage"; sortable column | Prompts tab, Discover | Field BUILT in API (`Prompt.funnel_stage`, `filter[funnel_stage_in]`), not shown in the web app. PLANNED S1+ (who classifies is open) | `ai.prompts.funnel_stage` |
| AP-04 | Question text | `PromptCell`, two lines then tooltip, full text in the inspector; text immutable per version | Prompts tab | BUILT: `apps/web/src/features/prompts/prompt-columns.tsx`, `prompt-inspector.tsx` | `ai.prompt_versions.text` |
| AP-05 | Intent category | Two separate axes: intent (informational, commercial, transactional, navigational, local) and prompt type; topic is the taxonomy | Prompts tab filter, Add dialog | PLANNED: G10 and B16 (prompt type is empty: the Add dialog sets `question` on every prompt; needs a decision) | `ai.prompts.intent`, `prompt_type` |
| AP-06 | Buyer intent label | Sort aid only, labelled "Estimate", neutral; our `importance` 1 to 5 is the real priority | Discover > Prompts | `importance` BUILT (`prompt-inspector.tsx`, `PATCH`); model scored buyer intent NEW (low value) | `ai.prompts.importance` |
| AP-09 | Already-added flag | Per-line lint in the Add dialog; near-duplicate indicator in the inbox | Add dialog, Discover | BUILT in the dialog (`add-prompts-dialog.tsx`); near-duplicate PLANNED (doc 20 5.13, Ph 11) | `POST {P}/prompts/lint` |
| AP-10 | Track frequency per prompt | Cadence belongs to a panel, not each prompt; state the cadence in words | Topics & Prompts, Settings > Schedules | Cadence line BUILT. Per-panel cadence PLANNED S4 (doc 11 section 8; weekly vs twice a week conflict open) | `ai.prompts.expected_frequency`, `GET {P}/schedules` |
| AP-11 | Location per prompt | Only countries every enabled engine asks in; reasons for a refused engine | Add dialog, Prompts tab | BUILT: `add-prompts-dialog.tsx` (`countriesForEngines`) | `ai.prompts.country_iso` |
| AP-12 | Language per prompt | Required at add; shown in the inspector | Add dialog, inspector | BUILT | `ai.prompts.language_code` |
| AP-17 | Plan prompt limit | "Adds N of your remaining M" in the dialog; active-prompt meter in the header | Add dialog, header | Dialog BUILT (`add.quota`). Header meter NEW (small) | `core.workspace_quotas.max_active_prompts` (150, `BASE_PLAN`) |
| AP-19 | Saved prompt text | Table plus inspector with full text | Prompts tab | BUILT (as AP-04) | `ai.prompt_versions` |
| AP-20 | Saved prompt category | Topic with path tooltip (parent shown) | Prompts tab | Topic column BUILT; path tooltip PLANNED S1+ (G45, W2) | `prompt.terms[].path` |
| AP-21 | Saved prompt priority | `importance` 1 to 5, edit in a details dialog | Inspector | Shown BUILT; edit dialog PLANNED S1+ (G125, W5) | `ai.prompts.importance` |
| AP-22 | Prompt status | Archive with Undo and an "Archived" badge | Inspector | BUILT: `prompt-inspector.tsx` | `ai.prompts.is_active`, `DELETE prompts/{id}` |
| AP-23 | Saved prompt count | Table caption "N prompts" and header meta "13 topics, 250 prompts, updated" | Topics & Prompts | Caption BUILT; meta PLANNED S1+ (G01, G33, W6). Backend time field BUILT (B1, `6d681a5`) | summary `last_observed_at`; `GET {P}/runs` |

### 4.2 Prompt Run: to the prompt inspector, Runs and Citations

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| PR-05 | Country per prompt | Country column and filter | Prompts tab | BUILT: `prompts-screen.tsx` | `ai.prompts.country_iso` |
| PR-06 | Brand coverage | Per engine two cells, Mentioned and Cited, "5 of 6 (83%)", n visible, hatched "insufficient" under 4 answers, interval text in the Stats tab, never pooled across engines ("avg of N") | Prompts and Topics tabs, inspector | Counts BUILT. Percent, pill, average column PLANNED S1+ (W1, W2). Interval S3 (G48, B15) | `GET {P}/ai/prompts-summary` MetricCell (`numerator`, `denominator`, `n_observations`) |
| PR-11 | Manual runs: successful and failed | Valid answers per engine ("N valid of M answers"); Runs page with status; alert when valid rate falls under 90% | Runs, prompt inspector | Tooltip BUILT; Runs BUILT (`apps/web/src/app/[workspace]/[project]/ops/runs`); alert PLANNED (`ai_collection_degraded`, doc 11 section 10) | `GET {P}/runs`, `ai.observations.status` |
| PR-12 | Manual run quota used | State the limit before the click ("14 of 20 manual runs left today") plus the monthly cap | Prompt inspector, Costs | Refusal reasons BUILT; counter before the click NEW (small) | `MANUAL_RUNS_PER_DAY = 20` (`backend/src/idraft/api/operations/runs.py`), `max_ai_observations_per_month` |
| PR-13 | Last run time | Header meta "Updated Sep 28, 02:10" from the last answer | Topics & Prompts header | PLANNED S1+ (G01, W6). Backend BUILT (B1) | summary `last_observed_at` |
| PR-15 | Run type | Trigger column (schedule, manual, backfill, retry) | Runs | BUILT: Runs page | `ops` runs `trigger` |
| PR-20 | Time of run or answer | `formatRelative` with exact time on hover | Answers table, Runs | BUILT (`prompt-inspector.tsx`) | `ai.observations.observed_at` |
| PR-21 | Engine filter | Engine `FilterChip`, one label per engine | Topics & Prompts | BUILT (`prompts-screen.tsx`) | `GET {P}/engines` |
| PR-23 | Citation gap state | Neutral label "Not cited in 0 of 8 answers" with who is cited instead; no paid action | Prompt inspector Citations tab | PLANNED: G97, B6 (W4, W7); diagnostics Ph 15 | `ai.citations` joined to observations |
| PR-25 | Per-engine status on a prompt | Row per engine: Mentioned k of n, Cited k of n, bar and logo; no rank until S2 | Prompt inspector | Text BUILT; bars PLANNED S1+ (G113, W4) | prompts-summary per engine |
| PR-27 | Answer text | Evidence text with marked mentions; Formatted and Raw modes | Answer viewer | BUILT: `answer-inspector.tsx`, `answer-segments.ts` | `GET {P}/ai/observations/{id}` |
| PR-29 | Inline footnote markers [n] | `CitationMarker` jumping to the `CitationList` item | Answer viewer | PLANNED (DS 23 section 5.4); not built | `ai.citations.first_char_offset`, `answer_block_index` |
| PR-31 | Sources of an answer | Same with role badge Own, Competitor, Third party; host visible | Answer viewer | BUILT: `answer-inspector.tsx` | `ai.citations.domain_role` |
| PR-32 | Own page position in sources | "Source 2 of 9", never called rank; structured rank only in S2 | Answer viewer | List order BUILT; explicit field NEW (small) | `ai.citations.citation_index` |
| PR-34 | Citation rate per prompt | "Cited 5 of 6" per engine, interval in Stats | Prompt inspector | Counts BUILT; interval S3 | prompts-summary `cited` |
| PR-38 | Last tracked | Date of the latest valid answer per engine | Prompt inspector | PLANNED S1+ (G30, W6). Backend BUILT (B1) | `last_valid_at` |
| PR-41 | What changed by engine | Per engine "Mentioned 3 of 4 now, 4 of 4 before", labels New and Lost, at least 2 answers per window, "possible change" until detectable | Prompt inspector History, alerts | PLANNED: G05 (two reads, W3), alerts (doc 11 section 10), detectability S3 | `ai.observation_facts` |
| PR-42 | Rate per engine on one prompt | Table with engine logo, n and interval; small multiples for the trend | Prompt inspector Stats and History | Counts BUILT; chart PLANNED S1+ (G94, W4), CI band S3 | observations list (`filter[prompt_id]`) |
| PR-50 | Citation outcome per run | Outcome words (Mentioned and cited, Mentioned only, Cited only, Neither) | Answers table | BUILT: `prompt-inspector.tsx` | `ai.observation_facts` |
| PR-51 | Own page cited per run | "Cited page" column with `displayUrl`, linking to the page record | Answers table, Pages | PLANNED: G97, B6, doc 15 section 6 (also M-02) | `ai.citations` (role own, `url_id`) |

### 4.3 Dashboard: to AI Visibility > Overview and Competitors

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| DB-01 | Detection rate | `MetricStrip` item per engine: "34% mention, 612 of 1,800 obs", change in points with detectability, equal weight average labelled | AI Visibility > Overview, Topics & Prompts | PLANNED: DS 24 9.2, `GET {P}/ai/metrics/overview` (Ph 9); the strip on Topics & Prompts is W1 | prompts-summary MetricCell |
| DB-09 | Brand sentiment | Four shares (positive, neutral, negative, mixed) with n per engine, no single score | Prompt inspector, Overview card | PLANNED S2 (A13, B14); columns exist and are null | `ai.observation_facts.own_sentiment` |
| DB-12 | Share of voice per brand | `BarList` ranked, own brand `chart-1`, tracked set and date each competitor was added in the footnote, one formula (per answer, 1 divided by brands named) | Overview, Competitors, topic drawer | Pooled cell per engine BUILT in the topic drawer (`topic-inspector.tsx`); per-entity values PLANNED (B5, D1 Task 5) | `share_of_voice` MetricCell; `ai.entity_mentions` |
| DB-17 | Top competitor | Entity with the highest share of voice, its value and n | Competitors Comparison | PLANNED: DS 24 9.8, `GET {P}/ai/competitors` (Ph 9), B5 | `ai.entity_mentions` |
| DB-20 | New entrants | Candidates tab: brands seen and not tracked, with prompts and engines, "Track" button with the share-of-voice boundary note | Competitors > Candidates | PLANNED S2 (doc 20 5.10, doc 19 3.4); Settings > Entities BUILT (`settings/entities`) | `ai.entity_candidates` (doc 04, not in migration 0018) |
| DB-21 | Competitor mention count | "Named in 35 of 192 answers" per entity per engine | Competitors, prompt Competitors tab | PLANNED: B5; one prompt only is possible S1+ (G98, W4) from `facts.competitor_mentions` | `observation_facts.competitor_mentions` |
| DB-28 | Competitor table | Entity comparison `DataTable` with metric switcher, own brand first with swatch, gap column coloured only when detectable | Competitors | PLANNED (DS 24 9.8, DS 23 6.1) | `GET {P}/ai/competitors` |
| DB-31 | LLM competitor and topic suggestions | Suggestions during onboarding, accept or reject, source shown | Onboarding, Settings > Entities | NEW (low) | none |

### 4.4 Prompt Fan-outs: to Prompt detail (Fan-out tab), Discover and Sources

Doc 07 and doc 16 section 9: fan-out exists for ChatGPT only. Gemini and AI Mode say "not exposed", never zero.

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| FO-01 | Fan-out query text | `DataTable` with sort, search and the engine note; Discover source chip "Fan-out" | Prompt detail Fan-out tab, Discover | PLANNED S2 (`GET {P}/ai/fanout-queries`, doc 19 line 1248; DS 24 9.6, 9.11). Handoff item B19 | Texts already stored for ChatGPT in `ai.observations.provider_extras.fan_out_queries` (`backend/src/idraft/providers/dataforseo/ai_parse.py`); not exposed by the API |
| FO-02 | Prompts per query | Columns "Prompts" and "Answers" | same | PLANNED S2 | same, grouped by normalised text |
| FO-03 | Last seen | Date column, sortable | same | PLANNED S2 | `observed_at` |
| FO-04 | Fresh badge | "New in window" neutral badge with first-seen date | same | PLANNED S2 | first `observed_at` |
| FO-05 | Times used | "In 6 of 12 ChatGPT answers" (doc 16 F4) | same | PLANNED (doc 16 F4) | `ai.observations` |
| FO-07 | Own citation rate for the query | Own domain retrieved and cited, k of n each (C8 shape) | same | PLANNED S2 (retrieved-not-cited); `ai.retrieval_results` not created | not available yet |
| FO-09 | Who gets cited instead | Domain list with role, own domain included, worded as an association (query to source linkage `fanout_seq` is nullable) | same, popover | PLANNED S2 | `ai.citations` of those observations (BUILT) |
| FO-11 | Topic clusters of fan-out queries | Group by our topic taxonomy of the originating prompt | Fan-out tab | PLANNED (doc 16 F4 per topic) | `ai.prompt_terms` |
| FO-13 | Domains cited most often | Domains tab with source share, role, category | Citations > Domains | PLANNED (B6; DS 24 9.7) | `ai.citations` |
| FO-14 | Fan-outs by prompt | Column "Fan-out per answer" (mean, ChatGPT only) in the Prompts table | Prompts tab | PLANNED S2; value already in `fanout_count` on `ObservationSummary` | `ai.observations.fanout_count` |
| FO-16 | Totals (302 unique, 310 uses) | F1 presence rate and F2 mean queries per answer with n | Prompt detail, Overview card | PLANNED (doc 16 F1, F2); web can compute from the observation list now (ChatGPT only) | `fanout_count` |
| FO-17 | Minimum times seen | `min_support` control, default 2 | Fan-out tab | PLANNED | `GET {P}/ai/fanout-queries` params to confirm |

### 4.5 Citations: to AI Visibility > Citations and Sources

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| CI-01 | Prompts cited (17 of 28) | Strip item "Own citation share" with units and observations; "17 of 28 prompts, last 28 days" in the meta line | Citations | PLANNED (DS 24 9.7); B6 | `ai.citations` role own |
| CI-04 | Unique pages (1,124) | "Citation units", "Distinct domains", "Effective sources" (C3), each with its observation count | Citations | PLANNED (doc 16 C3) | `ai.citations.url_id` |
| CI-05 | Own cited pages (15) | Domains tab row Own, expand to cited pages with share | Citations | PLANNED | `ai.citations` |
| CI-07 | Page title and path | `URLCell` with `displayUrl`, escaped title, host visible | Citations Pages tab | PLANNED | `ai.citations.title` |
| CI-09 | Cites | Citation units, defined in `MetricInfo` (distinct URL per answer), with observations and prompts | Citations | PLANNED (doc 16 C2) | `ai.citations` |
| CI-10 | Prompts per page | Count column; list in the inspector | Citations | PLANNED | `ai.observations.prompt_id` |
| CI-11 | Quote or claim an engine used | "Quoted passage" section in the source inspector, escaped text, only where the provider gives one | Source inspector | NEW: `ai.citations` has title and source name only; whether the raw payload carries a quote is unverified; claims table is Ph 15 | not in `ai.citations` |
| CI-12 | Engines per page | Engine columns (ChatGPT, Gemini, AI Mode shares) | Citations | PLANNED | `ai.citations.engine_code` |
| CI-13 | Prompts that produced the citation | List with links to the prompt inspector | Source inspector | PLANNED | `ai.observations` |
| CI-14 | Competitor and third party pages | Pages tab with role filter, "Cited with" column, domain roll-up | Citations | PLANNED (DS 24 9.7) | `ai.citations.domain_role` |
| CI-15 | Winning pages for one prompt | Prompt Citations tab: table per engine of top domains and pages, own rows highlighted, New and Lost markers | Prompt detail | PLANNED: G97, DS 24 9.6 (W7). Web only fallback: read each answer's `citations` | `GET {P}/ai/observations/{id}` (`citations`) |
| CI-16 | Result banner for a prompt | `Banner` in the inspector: "Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13 pages cited" | Prompt inspector | PLANNED S1+ with G97 | observations list |

### 4.6 Off Page GEO: to Sources > Opportunities and Discover > Opportunities

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| OP-04 | Action type buckets | `CountTabs` over condition labels; action types as a second filter | Sources > Opportunities | Conditions PLANNED (DS 23 7.3, doc 14 section 7, Ph 13). Action types NEW | `ai.citations`, `ai.entity_mentions` |
| OP-07 | Opportunity title | Row names the observed condition ("Cited in 9 answers that name a competitor and not you"); no imperative, no "quick win" (DS 23 7.3) | Sources > Opportunities | PLANNED | same |
| OP-08 | Source domain and page title | `DomainCell` and category badge | same | PLANNED | `core.domains`, `ai.citations` |
| OP-09 | Cited by AI | Reach (distinct prompts) and units, with window and n | same | PLANNED (doc 14 section 7) | `ai.citations` |
| OP-10 | Competitor gap with sites cited instead | "Competitors named: X, Y" and sample observation links | same, popover | PLANNED (doc 14 section 7) | `ai.entity_mentions` |
| OP-12 | Do-this steps | Fixed checklist per condition type (rule based), status todo or done, owner | same, inspector | NEW; task status needs a small table | none |
| OP-14 | Related prompts | Links that open the prompt inspector (`?inspect=prompt:`) | same | BUILT pattern (URL state); this view PLANNED | `ai.prompts` |

### 4.7 GEO Audit, GEO Audit Dashboard, Advanced GEO: to SEO > Pages ("AI readiness" tab)

Nothing in our docs covers page-level GEO audits. The closest items are Pages and page performance ([32-page-performance.md](../../32-page-performance.md)) and AI referral and crawler imports ([18-first-party-integrations.md](../../18-first-party-integrations.md)). Rows not marked PLANNED are NEW and need an SSRF-safe page fetch ([24-security.md](../../24-security.md) section 7.3).

| ID | Data point | Our way | idraft page | Status | Data source |
|---|---|---|---|---|---|
| GA-01 | Target URL | Pick from watched pages or paste; the fetch it will make is shown | SEO > Pages | URL paste and watchlist PLANNED (doc 32 section 5); audit NEW | page watchlist (doc 32) |
| GA-02 | URL list or CSV | Our import wizard with preview and validation | SEO > Pages | Wizard BUILT for keywords (`apps/web/src/features/rankings/import`); URL import PLANNED (doc 32 slice 2); audit NEW | same |
| GD-03 | Pages analysed | "11 of 38 watched pages checked, Oct 6" | SEO > Pages | NEW | none |
| GD-06 | Page URL in the queue | `URLCell`; opening a row opens the inspector, never a paid action | SEO > Pages | NEW | none |
| GD-08 | Top issue per page | Failing checks per page with evidence and count of pages affected | SEO > Pages | NEW | none |
| GD-15 | Checklist (27 checks) | `SimpleTable` in the inspector: check, status, the HTML fact behind it; no score | page inspector | NEW | page fetch |
| GD-16 | Structured data checks | JSON-LD found vs expected for the page type, missing type named | page inspector | NEW (M-10) | page fetch |
| GD-17 | Suggested fix code | Snippet with copy button, "suggestion, not applied" | page inspector | NEW | none |
| GD-18 | Content gaps | Topics and entities named in answers that recommend competitors and absent from the page | page inspector | PLANNED Ph 15 (doc 29) | `ai.entity_mentions`, answers |
| GD-19 | Freshness and authorship | Dates from sitemap `lastmod` (doc 14 section 8), author present or not, as facts | page inspector | PLANNED in part; rest NEW | sitemap fetch |
| GD-21 | Page type and geo intent | Neutral badge, used to pick which checks apply | page inspector | NEW (low) | none |
| GD-25 | Quotable statements and claims | List of candidate passages with counts | page inspector | NEW (low) | none |
| GF-02 | Fix inbox | Queue with status (suggested, reviewed, done), snippet preview, no write to the customer site | SEO > Pages | NEW | none |

## 5. Where idraft leads, and where the studied tool does

### 5.1 idraft leads

| # | Lead | Studied tool | idraft | Evidence |
|---|---|---|---|---|
| L1 | Counts and denominators | Percents with no n; cards recompute from loaded rows | Count of valid answers beside every cell ("4 of 8"); invalid answers left out and counted in the tooltip; a topic cell is prompt weighted and says so | `apps/web/src/features/prompts/prompt-model.ts` (`countText`), `prompt-columns.tsx`; `MetricCell` in `backend/src/idraft/api/schemas/ai.py` |
| L3 | Evidence viewer | Markdown answer, a "Brands mentioned" list that shows source domains | Mentions marked by UTF-16 offsets; roles own, competitor, watched, untracked; uncertain mentions flagged; ads excluded; sources with role; raw answer download that says when it is past retention or not available; "open at the provider" link; model name | `answer-segments.ts`, `answer-inspector.tsx`, `backend/src/idraft/api/ai/observations.py` (`offsets_unit: utf16`) |
| L4 | Hashed evidence | None shown | Each answer stored with SHA-256 (`answer_hash`), the raw payload with SHA-256 and a retention class; prompt text immutable with a text hash. Not displayed in the UI yet | `backend/src/idraft/collectors/ai_prompt_ingest.py`, `db/tables.py`, `0018_ai_prompts.py` |
| L5 | Engines per country | 249 countries and 129 languages with no check against engine support | Country list limited to countries every enabled engine asks in; per-engine refusal reasons on Run now | `add-prompts-dialog.tsx` (`countriesForEngines`) |
| L6 | Cost control | Credits, slot counter 44 of 50 with 28 saved | Estimated monthly cost per engine before it is turned on; budget-blocked runs visible in Runs and Costs; manual run limits and quota errors named | `engines-screen.tsx`, `GET {P}/engines` (`estimated_monthly_cost_usd`) |
| L7 | Honest answer states | Not seen | Answer status complete, partial, empty, refused, error stored and labelled; excluded from every rate; no-engine, no-answers, partial-list and error states built | `prompt-inspector.tsx`, `answer-inspector.tsx`, `prompts-screen.tsx` |
| L8 | One definition per metric | Three totals for one share; position differs between list and detail | One metric catalogue with numerator and denominator ([16](../../16-metrics-methodology.md)), branded prompts separated, share of voice per answer, no pooling across engine classes | doc 16 sections 1 and 5; `include_branded` on the summary |
| L9 | State in the URL, keyboard, inspector | Filters apply after Refresh; full page detail about 4,200 px | Filters, tab and inspector in the URL (`?inspect=prompt:`), J and K to step, 440 px drawer | `AI_DEVELOPMENT_UI_RULES.md` rules 9 and 15; `prompt-inspector.tsx` |
| L10 | Design discipline | Donuts, ring gauges, fixed identity colours, colours re-assigned by rank | No donut, no composite score, own brand always `chart-1`, colour only for a detectable change | `DESIGN_SYSTEM.md`, `docs/design-system/15-data-visualization.md` |

Not a lead yet: **L2 intervals.** The studied tool shows none. We have a Wilson interval library and an "insufficient under 4 answers" rule (`apps/web/src/lib/stats/wilson.ts`, `rates.ts`) but no screen uses them and `ci` is null in slice 1. W4 adds the Stats tab interval from the library; the backend `ci` is S3. Until then say "planned", not "ahead".

### 5.2 The studied tool is ahead

| # | Area | What it has | Our position |
|---|---|---|---|
| N1 | Engine coverage | Six engines: ChatGPT, Claude, Gemini, Grok, Llama, Perplexity | Three (ChatGPT, Gemini, Google AI Mode; `backend/src/idraft/domain/ai_engines.py`), AI Overview in S2. Official API engines are Ph 14 and a separate class, never pooled (doc 05) |
| N2 | Fan-out view | A working opportunity list with winners | We store the ChatGPT texts, no route or screen (B19, W9) |
| N3 | Page-level GEO checks | 27 checks per page, fix suggestions | Nothing in our docs (W15, needs a decision) |
| N4 | Off-page task list | Reddit, LinkedIn, directory, review site tasks with steps | Only publisher opportunities as evidence (doc 14 section 7, Ph 13) |
| N5 | Prompt suggestions on one screen | 88 suggestions from the site, one click each | Add dialog is paste only; inbox is S4 and Ph 11 (W12) |
| N6 | Per-prompt winners and quotes | A full list of cited pages per prompt with the quote | Per-answer sources only; aggregate B6 and the quote are open |

## 6. What both tools miss

Value is for an SEO or agency team. "Data today" cites what the backend has now.

| # | Item | Value | Effort | Data today | In our docs? |
|---|---|---|---|---|---|
| M-01 | Change alerts: mention or citation lost or gained per prompt and engine, competitor overtakes share of voice | High | M (rules, digest) plus L (settings UI) | `ai.observation_facts` has the facts. No alert tables or routes (`alert-rules` absent from `apps/web/src/lib/api/schema.ts`). Detectability needs S3 | Yes: doc 11 section 10, doc 20 5.17, doc 19 `alert-rules`; slice spec: alerts in S4 |
| M-02 | Prompt to page mapping: which own URL each prompt and engine cites, and which prompts cite no own page | High | S to M | `ai.citations` (`domain_role = own`, `url_id`, `engine_code`) joined to observations. No route (B6) | Partly: doc 15 section 6, doc 20 5.5 |
| M-03 | Answer diff over time: latest answer vs the last one that named you, differences in entities and sources | High | M | `answer_text`, `answer_hash`, `ai.citations`, `ai.entity_mentions` stored | Yes: AnswerCompare (DS 23 6.3), Prompt Detail T3 (not in slice 1) |
| M-04 | Share of voice against named competitors with intervals, per prompt, topic and engine | High | M (B5) plus M (intervals) | Tables exist; the API carries the entity list only until D1 Task 5 | Yes: B5, intervals S3, bootstrap Ph 14 |
| M-05 | Source gap analysis: domains cited where competitors are named and you are not | High | M | `ai.citations` and `ai.entity_mentions`; no route | Yes: doc 14 section 7, `GET {P}/ai/sources/competitor-overlap` (Ph 13) |
| M-06 | Citation to page action list: pages that rank but are never cited, pages cited despite weak rank | High | M to L | Citations BUILT; rank data BUILT in the rankings feature | Yes: doc 15 section 5, `GET {P}/pages/insights` (Ph 10a) |
| M-07 | Brand sentiment as four shares per engine | Medium | M | Columns exist, null; classifier is S2 | Yes: A13, B14 |
| M-08 | Wrong fact and hallucination flags: claims about the brand reviewed as accurate, inaccurate, outdated, disputed | High for brand risk | L | `ai.claims` reserved in doc 04 section 8.6, not created | Yes: Ph 15, `GET {P}/ai/claims` behind a flag |
| M-09 | AI crawler access checks: robots.txt rules per AI bot (GPTBot, Google-Extended, PerplexityBot), `llms.txt`, sitemap and meta robots | High (cheap, deterministic) | S to M | None. Needs the SSRF-safe fetcher (doc 24 7.3). Observed crawler hits are a different thing | Observed crawls only (doc 18, Ph 12). The configuration check is NEW (W15) |
| M-10 | Schema suggestions tied to a cited page (JSON-LD present vs page type) | Medium | M | None; page fetch and parse | NEW |
| M-11 | Per-country and per-language views of every rate | High | S (B2) to M | Prompts carry `country_iso`, `language_code`; summary scope filter is D1 Task 2 | Yes: doc 16 breakdowns, B2, G11 |
| M-12 | Client reports: shareable link and PDF per client project, from saved views | High for agencies | L (PDF), S (CSV) | Rankings client export BUILT; `POST {P}/exports` not built | Reports sidebar item exists with no screen spec; PDF and branding NEW |
| M-13 | Scheduled reports and digests by email | Medium | M to L | Digest routes specified (doc 19 `alert-digests`); no report content | Digest yes; report content NEW |
| M-14 | Annotations on charts (page published, release) and a before and after view | Medium | M | None | Doc 32 for page performance only; AI charts NEW |
| M-15 | Saved views | Medium | M (platform) | `core.saved_views` not created | Yes: doc 19 3.11.5a, B8, G02 |
| M-16 | API and CSV export of rates, answers, citations | Medium | S (CSV), M (API keys) | Client export pattern exists for rankings | Yes: doc 19 3.12, G124 |
| M-17 | What-if sizing: how many prompts detect a change of N points | Medium | S to M | Formula BUILT in `apps/web/src/lib/stats/panel.ts`; flip rate needs paired runs (S3) | Yes: doc 11 3.2, G65 |
| M-18 | "Why did we lose this prompt" evidence panel with hypotheses kept apart | High | L | Most inputs stored | Yes: doc 15 section 8, Ph 15 |
| M-19 | Model change markers on charts and beside a drop | Medium | S | `ai.observations.model_reported` stored | Yes: alert `ai_model_changed`, G96 |
| M-20 | Fan-out queries we already rank for (and those we do not), into the keyword inbox | Medium | M, L for rank coverage | Texts stored for ChatGPT | Yes: doc 16 F3, F5 (Ph 15) |
| M-21 | AI referral sessions (GA4) and AI crawler hits beside visibility | High | L | Search Console BUILT; GA4 and Cloudflare not | Yes: doc 18, Ph 12 |
| M-22 | Competitor discovery with "Track" and a note that share of voice changes from today | High | M | `ai.entity_candidates` not in migration 0018 | Yes: S2, doc 20 5.10 |
| M-23 | Prompts we lose to a named competitor, sorted by importance | High | S to M | `observation_facts` (`own_mentioned = false`, `competitor_mentions` not empty) | Partly: A14, doc 15 section 5 |
| M-24 | Freshness and health beside every number ("last valid answer", "N failed in the last run") | Medium | S | `observations.status`, runs; B1 BUILT | Yes: G30, B1 |
| M-25 | Keyword to prompt coverage: tracked keywords with no prompt, prompts with no keyword | Medium | L | `core.keyword_prompt_links` not created | Yes: doc 15 section 5, S4 links, Ph 10a |

## 7. UI and UX verdicts

Our design system is the rule (`DESIGN_SYSTEM.md`, `AI_DEVELOPMENT_UI_RULES.md`). ADOPT means the studied pattern is clearly better than what we have or specify and is adapted to our tokens and components. A verdict never rests on looking different.

| # | Pattern | Studied tool | Ours (file or doc) | Verdict | Why and how it maps to our tokens and components |
|---|---|---|---|---|---|
| U-01 | Page layout and density | One column of full width cards, 256 px sidebar, 24 px gaps, about 5,990 px page | 208 px sidebar, 20 px gutters, one row header (`DESIGN_SYSTEM.md` decisions 4 and 6) | KEEP OURS | Denser and scannable |
| U-02 | KPI summary | Seven cells about 204 px tall, each with a status pill, delta chip and button | `MetricStrip`, one 76 px panel (rule 10, `apps/web/src/components/app/metric`) | KEEP OURS | Rule 10 forbids large KPI cards. The one line definition is our `MetricInfo` |
| U-03 | Score donuts, ring gauges, key score bars | Donut for coverage, split, run share; ring per provider | `OutcomeMixBar` (100% stacked) and `BarList` (DS 15 section 1 rule 6) | NOT COMPARABLE | Donuts are banned and the scores behind them are dropped |
| U-04 | Table design | Rows 55 to 90 px with wrapping, "Load more", client sort | `DataTable`: 40 or 32 px rows, column chooser, `/` search, URL sort, pagination 25, row opens inspector | KEEP OURS | Total and sort stay consistent and keyboard reachable |
| U-05 | Drawer vs full page | Prompt breakup is a full page of 12 sections | 440 px inspector with tabs; full page only for deep objects (rule 9, DS 16 section 1) | KEEP OURS | Keeps list context |
| U-06 | Recommended prompt flow | 88 suggestions, stage chips, intent, one click Add, "Added" state, "Add all" | Add dialog; inbox only specified (DS 24 9.11) | ADOPT (partial) | Discover > Prompts inbox (T6): stage and intent `FilterChip`s, per row Add plus `BulkActionBar`, "Already tracked" state, source and "Generated phrasing, not an observed user prompt" banner (doc 20 5.13). No buyer intent colours, no "Add all" without preview. Task W12 |
| U-07 | Fan-out opportunity view | Queries with times used, own citation rate, expandable "Domains winning this query", clusters, minimum times seen | Fan-out tab and Discover chip specified, nothing built | ADOPT | `DataTable` with expandable row (`DomainCell` list), `CountTabs` for the engine note, `min_support` control; no priority score. Task W9 |
| U-08 | Citation gap view (winning pages per prompt) | Banner "cited or not", then a card per URL with engines, positions, quote | Prompt Citations tab: top 5 domains and pages (G97, planned) | ADOPT | `Banner` plus `DataTable` (rule 7: not cards), own rows tinted `primary-subtle`; fold the "Not cited" state into the inspector header. Task W7 |
| U-09 | Fix queue and task rows | Off Page rows: opportunity, cited by count, popover, expandable steps, copy button | `OpportunityStatus` rows (DS 23 7.3), publisher opportunities (doc 14 7) | ADOPT (anatomy only) | Row layout for Sources > Opportunities: condition label, counts with n, popover with `DomainCell` list, expandable checklist, "Related prompts" link, status todo or done. No LLM drafts, credits or Fix button |
| U-10 | Empty and loading states | "No ideas match your filters"; empty state flashes before data | Reason plus action, skeletons, no flash (rule 17; built in `prompts-screen.tsx`) | KEEP OURS | Ours name the cause and the next step |
| U-11 | Mobile layout | Add Prompt becomes cards; a 968 px table in a scroller | Two line list rows under 768 px (DS 19 section 6.7) | KEEP OURS | Spec is better; the build is open (G14) |
| U-12 | Colour use | Green, amber, rose on scores; colours re-assigned by rank per chart | Tokens only; own brand `chart-1`; change colours only when detectable (rule 6) | KEEP OURS | One identity per entity |
| U-13 | Engine strip on a prompt | Chips with logo and "Cited, #4" | `EngineCell`, per engine columns, `EngineStatusGlyph` | KEEP OURS | Equal; ours carries n |
| U-14 | Answer reader | 70 and 30 split, clickable footnote markers | Stacked in the inspector, `CitationMarker` specified (DS 23 5.2, 5.4) | KEEP OURS | Equal in spec; build the markers (PR-29) |
| U-15 | Count cell with a popover of who wins | "5 cited instead" with an info button and a chip popover | "Cited with" column shows one entity (DS 24 9.7) | ADOPT (small) | A `Popover` from a count cell listing up to 5 `DomainCell` rows with counts, in Citations, Fan-out and Opportunities tables |
| U-16 | Per-engine change wording | "Missing in latest check", "New in latest check" pills | Insufficient hatching and `Delta` (DS 23 8.4, 8.5) | ADOPT (wording) | Neutral `Badge`s "New" and "Lost" inside the engine change cell, with the k of n. Task W8 |
| U-17 | Run log tint, "Improved or Declined" pills | Row tinted green or rose | `Delta` colours only when detectable (rule 6) | KEEP OURS | Single answer changes are noise |
| U-18 | Filters | Selects that apply only after "Refresh"; no URL state | `FilterBar` chips, instant, URL state (rules 8 and 15) | KEEP OURS | A stale list under a new filter label misleads |
| U-19 | Quota card | Red bar 44 of 50 | Dialog line, `Meter` for budgets (DS 23 11.2) | KEEP OURS | Ours explains the number; add the header meter (AP-17) |
| U-20 | Status pills | Healthy, Watch, Needs action | Neutral descriptive `Badge`; no pill shaped badges | KEEP OURS | Verdict words need stated thresholds |
| U-21 | Run controls | "Run all", "Run selected", "Run now" spending credits | Run now per prompt with named limits; bulk run needs B7 | KEEP OURS | Ours says why a run is refused |
| U-22 | Audit input page | Segmented Single, Bulk, Sitewise, CSV dropzone | Import wizard with preview (`features/rankings/import`) | KEEP OURS | Ours previews before spending |
| U-23 | Brand brief | Text cards, counts, topic chips | none | NOT COMPARABLE | Unsourced prose |
| U-24 | Read the claim in a row | Click a row to read the quote | Domain row expands to pages; source inspector (DS 24 9.7) | ADOPT (conditional) | "Quoted passage" section in the source inspector once a quote field exists (CI-11) |
| U-25 | Prompt picker on analysis pages | Persistent combobox at the top | Prompt chosen from the table, J and K, `FilterChip` | KEEP OURS | No second control |
| U-26 | Table toolbar | Search, Run all, Download in one row | `DataTableToolbar` with search, columns, density, export | KEEP OURS | Equal |

## 8. Open questions and the owner's answers

The owner decided Q3 and Q4 on 2026-11-12 through the question dialog. Q1, Q2, Q5, Q6 and Q7 are checks or scope notes, not decisions of that round.

| # | Question | Status | Answer or default used in the plans | If it fails |
|---|---|---|---|---|
| Q1 | Does the provider payload carry a quote text for each cited source (CI-11)? Only normalised columns were read | To check (not a decision) | Assume no; W7 ships without a quote section | The quote stays NEW and U-24 waits |
| Q2 | Are fan-out queries in `provider_extras` complete? The column is bounded at 16 KB (`octet_length(provider_extras::text) <= 16384`, migration 0018) | To check (not a decision) | B19 reports a `truncated` flag per answer when the bound could have cut a list | A route could show short lists as complete |
| Q3 | Weekly or twice a week cadence (three sources, two answers) | **Decided 2026-11-12** | Twice a week (Monday and Thursday) for every prompt; weekly may become a per panel option later. Doc 11 section 8 is corrected | none: AP-10 and the Panels tab are unblocked on cadence |
| Q4 | Which slice owns B5 and the citations aggregate B6 | **Decided 2026-11-12** | Slice 2 pre-work, built now: D1 Task 5 builds B5; B6 is the next backend item | none: the competitor and Citations views proceed |
| Q5 | Is page-level AI readiness (W15) in scope, and who fetches pages safely? | Not part of the 2026-11-12 round | Out of scope until the owner decides | Stays NEW |
| Q6 | The visual state of the mobile tables and of the topic drawer was not inspected in this pass (code and docs only) | To check (not a decision) | none | Treat G14 as open |
| Q7 | The studied tool data come from one workspace and one tracked day on the Dashboard | Scope note | Drop verdicts rest on definitions | none |

Other decisions of 2026-11-12 that the plans rely on: a version restore is not a `change_kind`; `prompt_type` is a server rule plus a person override; the weekly series is `include=series` on the summary first; gzip is on now; the Topics tab is an indented tree.

## 9. Evidence and not verified

Evidence: the nine page inventories (working notes, not in the repository), plus the files named in each row. Not verified: the studied tool's formulas marked "(inference)" in the inventories; the quote text of a provider payload; fan-out list completeness; the mobile and drawer visuals of our own app. Every "BUILT" in this study was checked by grep on 2026-11-12 against `origin/develop` at `6d681a5`.
