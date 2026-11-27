# 33. Cannibalization and Switching (own pages competing for tracked keywords)

Status: Draft for the product owner's review; requirement received 2026-11-26
Last updated: 2026-11-26
Related: [08-seo-keyword-system.md](08-seo-keyword-system.md) section 9; [09-rank-tracking-methodology.md](09-rank-tracking-methodology.md) sections 2 to 4; [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md) sections 2 and 5; [04-data-model.md](04-data-model.md) sections 7.5 and 7.6; [18-first-party-integrations.md](18-first-party-integrations.md) section 4; [20-frontend-specification.md](20-frontend-specification.md)

Labels as in doc 18: **(verified date)** marks a fact read on a primary page, **INFERRED** marks our reasoning, **UNVERIFIED** marks a claim to confirm in a spike, **Decision** marks a design choice. The visual reference is the design preview route `#/cannibalization` (section 9).

## 1. Summary

One new page under SEO with two tabs, both about a keyword losing to its own site, and both limited to keywords the project already tracks:

| Tab | Question it answers | Shape |
|---|---|---|
| Cannibalization | Which keywords have two or more of my pages competing for them right now, and which pages are they? | A state, read over a period |
| Switching | When did Google change which of my pages ranks for a keyword, and did the keyword do better or worse for it? | A timeline of events |

**The core feature needs no new provider spend.** Every daily check already reads the top 100 and stores each owned URL with its rank (`seo.domain_rank_observations.all_organic_ranks` and `all_url_ids`, doc 04 section 7.5). The two tabs are derived views over data the product already collects. Optional enrichments (a one-time history backfill, Search Console clicks per page) are priced in section 4 and 5 and are separate phases.

Decisions proposed in this document:

1. Extend the detector of doc 08 section 9 rather than write a second definition. Four amendments, listed in section 6.4, ship as `cannibalization_v2`; thresholds stay as they are.
2. A switch counts only when it is **confirmed** (the new page is the ranking page on the next readable check too). Single-check changes are shown as a count, not as switches. This is what keeps the Switching tab from being provider noise (doc 09 section 4.1: the same query returns different SERPs between readings).
3. Both tabs are tables with a metric strip. Charts are used where they carry information a table cannot: switches per week (Switching tab), rank by page over time (keyword drawer), and a one-line history strip per row.

## 2. Definitions

A **tracked keyword** is one text in one location, language and device (doc 04 principle 5). Desktop and mobile are two tracked keywords and are never mixed on this page; the page has a Device control as the Keywords page does.

- **Own page:** a canonical URL on a domain of the project's own entity. A competitor's pages never count here.
- **Ranking page:** the own page at the best organic rank on a check (`ranking_url_id`).
- **Co-ranking:** two own pages at two different organic ranks on the same check, both within the depth.
- **Grouped sub-result:** an own page nested under another own result. It shares its parent's rank (`result_count` counts distinct ranks) and is **not** co-ranking: Google shows it as one result. The page lists it as a "Sub-result" and never counts it as competition (doc 09 section 2, `ranks/resolve.py`).
- **Switch:** the ranking page changes from page A to page B and B is also the ranking page on the next readable check.
- **Flip-flop:** a switch that returns the page it replaced within 14 days. The return is the flip-flop; the first move stays "Moved" until the page returns.
- **Unreadable check:** a result whose address Google hid behind `google.com/goto` (doc 06 section 5.2). It names no page, so it is skipped for switches and shown as a hollow cell in the history strip.
- **Target page:** the page the team wants for the keyword (`target_url_id`, doc 04 section 7.1). "Left the target" is a switch away from it.

## 3. What the product already has

| Fact | Where | Use here |
|---|---|---|
| Daily depth-100 check on every tracked keyword (decision 2026-11-04) | doc 06 section 2.2 | No keyword is checked less deep than the feature needs |
| Every own URL with its rank per check, one per distinct rank, plus grouped children | doc 04 section 7.5; `ranks/resolve.py` | Co-ranking, ranking page per check, switches |
| `url_changed` rank event and `url_changed_at` | doc 09 section 4.1; `ranks/events.py` | Raw signal. Unconfirmed, so it is not the switch count of this page |
| `target_url_match` on the state row | doc 04 section 7.6 | "Not the target page" mark |
| Detector spec and `seo.cannibalization_flags` table | doc 08 section 9; doc 04 section 15.1 | Extended, not replaced |
| Detector, flags table, API and screen | not built | The work of section 8 |

INFERRED consequence: a freshly wiped project (production was reset on 2026-11-25) has only a few checks. The detector says "not enough checks" below 10 ranked checks in the period, and the page shows that state instead of a verdict.

### 3.1 Verified against the real tables (2026-11-27)

`seo.domain_rank_observations` holds one row per check, per entity (`role` own or competitor), keyed by `(tracked_keyword_id, entity_id, observed_at, serp_snapshot_id)`. For the own entities it keeps `all_organic_ranks` and `all_url_ids`, two parallel arrays: every organic rank an own result holds and the URL id at that rank, in the same order; a grouped sub-result repeats its parent's rank (`result_count` counts distinct ranks). It also keeps `depth_requested`, `is_valid`, `observed_date`. This is enough to rebuild, for every past check, which own page ranked where. Nothing else is needed and nothing new is collected: provider spend 0.

Rules that follow, and the first release applies:

1. **Readable check:** `is_valid` and `depth_requested` of 20 or more. A lighter depth cannot show the second page the co-ranking rule looks for in the top 20, so it is skipped like an unreadable check (hollow cell in the history strip).
2. **Several own entities** of one project count as one own side: their `(url, rank)` pairs are merged on a check.
3. **Grouped sub-result:** of the pairs that share a rank, the first in array order is the page at that rank and the others are grouped (never co-ranking).
4. **How many checks before a verdict:** 10 ranked checks in the chosen period (`MIN_CHECKS`). With one check a day that is 10 days of history, so a keyword added today has no verdict for 10 days and the 14, 30 and 90 day periods all give a verdict from day 10. The previous-period comparison needs 10 ranked checks in the earlier window too, else the strip shows no change figure. Below the minimum the row says "Not enough checks"; the number of checks behind each row is returned.
5. **Switches are derived on read** from the same rows (one query over the period, a few thousand rows for 55 keywords at 90 days). The `seo.url_switches` table of section 8 is an optimisation kept for when a project has thousands of keywords; it is not built in the first release, so no migration is needed.

## 4. DataForSEO research

All prices are per the DataForSEO pages read on 2026-11-26 and the verified tables in `research/01-dataforseo-seo.md` section 4.3. The sub-agent that read the documentation pages saw them truncated, so request-parameter and response-field details below are marked UNVERIFIED until a spike confirms them against a real response.

| Endpoint | What it gives for this feature | Price | Verdict |
|---|---|---|---|
| SERP Google Organic, `task_post` and `task_get/advanced` (already used) | Every organic result of the top 100 with `rank_group`, `url`, `domain`. Nested same-site results appear under `related_result` when `group_organic_results` is true (our setting) | $0.0006 per page of 10 on the standard queue, so $0.006 at depth 100, plus about $0.0006 for `resolve_poisoned_results` (doc 06 section 2) | **The source.** Already paid for. Nothing to add |
| Labs `historical_serps` | One SERP snapshot per **month** for a keyword, up to 12 months back, in the Advanced format (UNVERIFIED depth per snapshot) | $0.00012 per monthly snapshot, no task fee listed. A keyword's 12 months cost $0.00144; 1,000 keywords cost $1.44 | Optional one-time **backfill for Cannibalization** on a newly added keyword. Monthly points cannot show switching, so it never feeds the Switching tab |
| Labs `ranked_keywords` | For a domain or page: keywords it ranks for, one `serp_item` per keyword, `rank_changes` with `previous_rank_absolute` and `is_new/is_up/is_down` (UNVERIFIED) | $0.012 per task plus $0.00012 per item | Discovery of **untracked** keywords. Out of scope ("tracked keywords only"). No previous URL, so it cannot show switching |
| Labs `relevant_pages` | Per page: keyword count and position buckets | $0.012 plus $0.00012 per item | Page-level totals only. No competing URL per keyword. Not used |
| Labs `page_intersection` | Keywords two or more named pages both rank for, with each page's rank side by side (up to 20 pages) | $0.012 plus $0.00012 per item (sample request 0.0103 USD, UNVERIFIED) | Useful to **find** cannibalized untracked keywords for a pair of pages. Out of scope now; a candidate for the Discovery inbox (doc 08 section 5) |
| `stop_crawl_on_match` | Cheaper checks that stop at the first own match | Billed up to the match | **Must not be used** for tracked keywords on this feature: it stops at the first own page and hides the second page (doc 06 section 2.3) |

Findings that shape the design:

1. Labs data refreshes weekly or on a 30 to 90 day cycle per query and has no device parameter (doc 06 section 7.3, UNVERIFIED conflict between the two statements on the pricing page and the endpoint pages). It is discovery data, never tracking, so the Switching tab can only come from our own daily snapshots.
2. The SERP API has no history of its own. Switching exists only from the day tracking starts, which is why the page states "since tracking started" and why the backfill (monthly, coarse) is Cannibalization only.
3. Each additional own page on a SERP costs nothing: the page is in the same response. The marginal provider cost of the feature is zero for the core, and $0.00144 per keyword once for an optional backfill.
4. To confirm in the S-series spike before the backfill ships: the earliest accepted `date_from` of `historical_serps`, its depth per snapshot, and whether `ranked_keywords` can return more than one row per keyword for one domain.

## 5. Search Console enrichment (later phase)

Search Console answers the question rank data cannot: which of the two pages actually gets the clicks. It is the strongest evidence for a verdict and the best way to size the loss.

- **Not collected today.** Doc 18 shape B was `[date, query, page, country, device]` and changed on 2026-11-05 to `[date, query, country, device]`, so there is no query-by-page data.
- **Proposed shape E:** `[date, query, page]`, `searchType = web`, filtered to the queries of tracked keywords (`dimensionFilterGroups` on `query`, in batches), pulled daily for the last 3 days and backfilled over the 16 months Google keeps. Cost is API quota only. Row limit 25,000 per request, paged with `startRow`.
- **Product use:** the keyword drawer gains a "Clicks by page" card (share of clicks and impressions per page, Google's numbers, labeled "Google Search Console", never merged with our ranks, doc 18 principle 1). "Likely cannibalization" can then say "page B takes 38% of the impressions and 9% of the clicks".
- **Honest limits:** anonymized queries are missing from query-level data, and Search Console records a result only when it was shown, so two pages with impressions are not automatically in conflict. It supports a verdict, it does not replace the rank-based one.

## 6. The detector

### 6.1 Signals per tracked keyword over the chosen period

Period choices on the page: 14, 30 and 90 days, one check a day. The comparison for the strip is the same number of days before, shown only when the history is long enough.

| Signal | Definition |
|---|---|
| Ranked checks | Readable checks with at least one own page in the top 100 |
| Pages | Own pages that ranked, each with share of checks ranked, times it was the ranking page, median and best rank, last seen |
| Switches | Confirmed switches (section 2), each with rank before and after, days held, flip-flop flag |
| Co-ranking rate | Share of ranked checks with a second own page within the top 20 |
| Reference page | The page with the best median rank when it is the ranking page (on at least 3 checks) |
| Rank gap | Median rank of the checks where another page ranks, minus the median rank where the reference page ranks. Never negative |
| Switch rate | Confirmed switches divided by ranked checks minus one |

### 6.2 Classes (thresholds unchanged from doc 08 section 9.3)

| Class | Rule | Shown as |
|---|---|---|
| `likely_cannibalization` | two or more ranking pages AND switch rate 0.2 or more AND rank gap 3 or more | Warning badge |
| `co_ranking` | co-ranking rate 0.5 or more with both pages in the top 20 | Neutral badge, often fine |
| `unstable_url` | switch rate 0.2 or more, rank gap under 3 | Neutral badge |
| `none` | otherwise | No badge |
| `insufficient` (new state) | fewer than 10 ranked checks in the period | "Not enough checks" |
| `unranked` (new state) | no ranked check in the period | Not listed |

Rules stay conservative: a keyword is never called a conflict on one odd reading. The words on screen are "evidence of competition", never "caused by", and the causes list is labeled "hypotheses, not findings".

### 6.3 Page pairs

A page pair is two own pages that both rank on at least 3 checks of the same keyword with a conflict. The pair table sums volume and counts keywords and likely cases per pair, shows which page has the better median rank on how many keywords, and a title overlap hint (shared title words, a hint only). It is the level where the fix is chosen: merge, redirect or differentiate one page. Clicking a pair filters the keyword table to it.

### 6.4 Amendments to doc 08 section 9 (`cannibalization_v2`)

1. **Reference page** is the best median rank, not the most frequent page. Doc 08 compared against "the URL that ranked most often"; if Google hands a keyword to the weaker page more often, the penalty came out negative and the case was missed (found while building the mock).
2. **Switch debounce:** a change counts when the new page holds the best rank on the next readable check too. Doc 08 counted every consecutive pair that differs.
3. **Grouped sub-results are not co-ranking.** Already true in `result_count`; stated here so the UI cannot drift.
4. **Minimum evidence:** 10 ranked checks, else `insufficient`.

Thresholds (0.2, 3 places, 0.5, top 20, 14-day flip window, 10 checks) are parameters stored with `method_version`. The mock's `canni-data.js` implements this version and `canni-data.check.mjs` asserts it; the backend port starts from that file and a pytest of the same cases.

## 7. What the page shows

### 7.1 Placement and shell

A new item **Cannibalization** in the SEO group of the sidebar, after Keywords. Route `/{workspace}/{project}/cannibalization` with the second tab at `/cannibalization/switching`. Template T2 (as Citations and Prompts): scope toolbar, metric strip, one panel that fills the page with the table scrolling inside. The shell's date range and country controls are hidden on this page (it has its own Period and Device), as on Pages.

Scope controls: Device (Desktop, Mobile), Group (keyword groups), Period (14, 30, 90 days), Reset, Export. Every control is in the address, so a link reopens the same view.

### 7.2 Cannibalization tab

Metric strip (6): keywords with a conflict, likely cannibalization, co-ranking, unstable page, search volume at risk, typical rank gap. Counts show the change against the previous period, neutral in tone (counts are not tested for detectability).

Views, a switch inside the panel:

- **By keyword** (default, filter Conflicts): Keyword (with a target mark when the ranking page is not the target), Status, Pages (a letter mark and short name per page, the reference page first as A), Rank, Rank gap, Switches, Together, Volume, Ranking page (the history strip). Filters: Conflicts, Likely, Co-ranking, Unstable, All keywords, each with its count.
- **By page pair:** Pages, Keywords, Volume, Likely, Which page ranks better, Title overlap.

**Column widths.** Each table has one flexible column (the history strip on the keyword table) that takes the room the others leave. The Pages column is sized to its content over the keywords in scope, so it does not jump when a filter changes, and the Status column shows a short word ("Likely", with the full name in the tooltip and for screen readers). Every other column has a default, a least and a widest width and is adjustable as the table rules require (12-tables sections 9 and 10): drag the right edge of the header, or focus that edge (a vertical separator with a value) and press the arrow keys (16 px, 48 with Shift), Home and End for the least and widest, Enter or a double click for the default. A "Reset column widths" button appears while any column differs from its default. Widths are kept per table in the browser; the real app keeps them in the saved view.

**Naming pages without color.** A page is a letter (A is the page to compare with) in a box whose border carries its color, plus a short name. The same letter and color are used in the table, the history strip, the drawer chart (the letter is also printed at the end of each line, and marker shapes differ) and the page lists, so no meaning depends on seeing color. The Pages cell is a button: it opens a list (Escape closes it and returns focus) with each page's name, its full address as a link that opens the live page, badges (Best page, Target page, Sub-result) and its numbers (share of checks ranked, times it was the ranking page, median rank). The history strip is an image with a text alternative that states the checks per page and the number of switches; the drawer timeline's alternative is the list of switches below it.

Keyword drawer (right inspector, 440 px, `inspect=cann-keyword:<id>`), three tabs:

1. **Evidence:** a plain sentence of what the checks show, three figures (rank gap, switches, together), **Rank by page** (one line per page, lower is better, with a Table alternative), **Possible causes to check** (hypotheses: title overlap, page types, target mismatch, internal links), **Options** (set the target page, plan a merge or redirect, open the SERP; nothing changes by itself).
2. **Timeline:** one lane per page across the period (full color the ranking page, faded ranked beside it, outlined unreadable) and the list of confirmed switches.
3. **Pages:** each own page with share of checks ranked, times it ranked first, median and best rank, target mark, Sub-result badge.

### 7.3 Switching tab

Metric strip (6): confirmed switches (with change), keywords that switched, flip-flop keywords, left the target page, rank improved after, rank dropped after.

Above the table, one chart: **Switches per week**, stacked columns by what the new page did to the rank (improved, no change, dropped), with a Table alternative. A week with many switches across many keywords is the visible sign of a Google update, which is why this is a chart and not a table.

Views: **Changes** (default; filters All, Flip-flops, Rank improved, Rank dropped, Left the target) with When, Switch (from and to page), Rank before and after, Held days, Type (Moved or Flip-flop), Target page; and **By keyword** (Ranking page now, switches, flip-flops, pages, held now, longest hold, history strip; filter "only keywords that switched"). A row opens the same drawer on its Timeline tab.

### 7.4 Why tables first, and which charts

| Need | Form | Reason |
|---|---|---|
| Scan and sort hundreds of keywords | Table with metric strip | The Keywords page, Citations and Prompts use the same pattern; sorting and filtering are the task |
| See which page ranked on each day, at row level | History strip (one cell per check, one color per page) | A table cell cannot show a time series; a color change is a switch; costs one line of height |
| Understand one keyword | Rank-by-page line chart in the drawer | The only view where co-ranking (two lines together) and switching (lines taking turns) are both visible |
| Spot a Google update | Switches per week columns | Clusters of switches show on the time axis, not in rows |
| Compare share of problems by group | Not needed | A group filter and the strip counts answer it; no pie or donut |

Every chart has a Table alternative and marker shapes as well as color (design-system documents 15 and 20).

### 7.5 Later (not in the first release)

Alert rules `cannibalization_detected`, `page_flip_flop` and `left_target_page` (rule catalog of doc 08 section 12, digest and dedupe as the other SEO alerts); a "Clicks by page" card (section 5); an Overview widget "URL conflicts"; a link from a page pair to Internal links for both pages; CSV export of both tables; setting the target page from the drawer (writes `target_url_id`, doc 04 section 7.1).

## 8. Backend plan

No new collection. New derived data, computed after each check is ingested and rebuilt nightly:

```sql
-- Confirmed switches (one row per switch, derived from seo.domain_rank_observations).
CREATE TABLE seo.url_switches (
    tracked_keyword_id uuid NOT NULL REFERENCES seo.tracked_keywords(id) ON DELETE CASCADE,
    workspace_id       uuid NOT NULL,
    project_id         uuid NOT NULL,
    observed_at        timestamptz NOT NULL,     -- first check on which the new page ranked
    from_url_id        bigint NOT NULL,
    to_url_id          bigint NOT NULL,
    rank_before        smallint NOT NULL,
    rank_after         smallint NOT NULL,
    held_days          smallint NOT NULL,
    is_revert          boolean NOT NULL,         -- flip-flop: returns the page it replaced within 14 days
    method_version     smallint NOT NULL,
    PRIMARY KEY (tracked_keyword_id, observed_at)
);
```

`seo.cannibalization_flags` (doc 04) keeps its shape; `evidence jsonb` carries the signals of section 6.1 and `method_version` is 2. The nightly detector runs on the `process` queue (doc 08 section 9.3); the switch derivation runs in the same task and is idempotent over a window.

API (OpenAPI first, then `pnpm gen:api`): `GET /projects/{project_id}/cannibalization` (rows with class and signals; filters device, group, class, period; paged), `GET /projects/{project_id}/cannibalization/pairs`, `GET /projects/{project_id}/url-switches` (events and weekly buckets), `GET /tracked-keywords/{id}/url-history` (per-check page and rank for the drawer chart and timeline). Reads need `rankings:read`; nothing here writes. Responses carry the period, the method version and the number of checks behind each verdict.

Cost model (doc 27): marginal provider cost 0. Storage: `seo.url_switches` is small (a few rows per keyword per month); the drawer reads `all_organic_ranks` and `all_url_ids` from the existing observations.

## 9. Build plan

| Phase | Work | Output | Provider cost |
|---|---|---|---|
| 0 | Owner review of this document and the preview; amend doc 08 section 9 to `cannibalization_v2`; add the page to doc 20 and the navigation registry; add the new words (Cannibalization, Switching, Flip-flop, Rank gap, Ranking page, Target page) to `docs/glossary/terms.md` before any string reaches `messages/en.json` | Agreed spec | 0 |
| 1 | Backend: detector module (port of `canni-data.js` with pytest from `canni-data.check.mjs` cases), `seo.url_switches` migration, nightly task, rebuild command, API routes, OpenAPI | Endpoints returning real verdicts for Eventus | 0 |
| 2 | Web: page, two tabs, drawer, charts, empty and insufficient states, Playwright flow with axe in both themes, glossary words | The screens in the preview, on real data | 0 |
| 3 | Search Console shape E and the "Clicks by page" card | Evidence of who gets the clicks | API quota |
| 4 | Alerts, Overview widget, optional `historical_serps` backfill on keyword add | Notifications and day-one history for Cannibalization | $0.00144 per keyword once |

Tests: the detector is pure, so it is tested on frozen fixtures (the cases of the mock check: flicker is not a switch, return within 14 days is a flip-flop, a grouped sub-result is not co-ranking, a negative penalty cannot happen, 9 ranked checks is `insufficient`). A metric regression dataset freezes the expected classes (doc 26). The depth-aware null rule applies: a check that did not rank is "over 100", never rank 101.

## 10. Risks and open questions for the owner

| # | Risk or question | Mitigation or default |
|---|---|---|
| C-1 | Provider SERPs vary between readings (doc 09 section 4.1), so a keyword can look unstable because of the provider | Confirmed switches, one-check changes counted apart, "evidence" wording, minimum 10 checks |
| C-2 | `google.com/goto` results name no page | Unreadable checks skipped and shown as hollow cells |
| C-3 | A new project has too little history (production reset 2026-11-25) | "Not enough checks yet" state; Cannibalization can use the backfill in phase 4 |
| C-4 | Desktop and mobile differ | Separate by device, never mixed |
| C-5 | Location variance (a keyword in two countries) | Each tracked keyword keeps its location; a Country filter follows the Keywords page when multi-country is used |
| C-6 | Two pages ranking together is often fine | Co-ranking is neutral, "unstable" is neutral, only "likely" is a warning |
| C-7 | Canonical, redirect and fragment variants of one page counted as two | Canonicalization rules of doc 14 section 3 apply before comparing |
| O-1 | Should "unstable page" count in the headline "Keywords with a conflict"? | Default yes (the strip shows each class beside it) |
| O-2 | Default period | 30 days (the doc 08 window) |
| O-3 | Is a target page set per keyword today, or should the page offer to set one? | Phase 2 shows the mark when it exists; setting it is phase 4 |
| O-4 | Search Console phase (section 5): in the first release or after? | After; it needs the Google connection per project |

## 11. The design preview

Route `#/cannibalization` and `#/cannibalization/switching` in `apps/web/design-preview`, on the preview server of port 4190 (`design-preview-develop`). Files: `canni.js` (page), `canni-inspector.js` (drawer), `canni-data.js` (generator and detector), `canni-data.check.mjs` (`node design-preview/canni-data.check.mjs` from `apps/web`). The data is illustrative: Eventus Security's 55 tracked keywords with a seeded 90-day history of daily checks per device. The last check of every keyword keeps the rank the Keywords mock shows, and `best soc service provider` and `top soc service provider` reproduce the two-page finding of the production check of 2026-11-04. Nothing in the preview calls a provider.
