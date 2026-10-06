# 09. Rank Tracking Methodology

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md), [08-seo-keyword-system.md](08-seo-keyword-system.md), [16-metrics-methodology.md](16-metrics-methodology.md), [17-statistical-methodology.md](17-statistical-methodology.md)

This document defines what a rank is, how every SEO metric is computed, and which assumptions each metric carries. SQL shown is representative and runs against the tables in [04-data-model.md](04-data-model.md).

## 1. Definitions

| Term | Definition |
|---|---|
| **Check** | One SERP snapshot for one tracked keyword (keyword + location + language + device + engine) at one time |
| **Organic rank** | Position among organic results only, 1-based, as defined by the provider's organic group rank (DataForSEO `rank_group` for `type = organic`). **Canonical metric.** |
| **Absolute rank** | Position among all left-column SERP elements, including ads, AI Overview, features (DataForSEO `rank_absolute`). Secondary metric |
| **Depth requested** | Number of organic results requested in the check (10, 20, 50 or 100; see depth profiles in doc 06) |
| **Ranked** | The entity has at least one organic result within the depth requested |
| **Beyond depth** | Not ranked within the depth requested. Stored as `organic_rank = NULL` with `depth_requested`. It means "not in top N", not "does not rank" |
| **Entity rank** | Best (lowest) organic rank among all URLs matching the entity's domain rules |
| **Ranking URL** | The URL at the entity rank |
| **Deep check** | A check at depth 100 (weekly for the `standard` profile) |

### 1.1 Why organic rank is canonical (ADR-007)

- It is what users, clients, and every major rank tracker mean by "position".
- It does not move when Google inserts or removes a SERP feature above the results. Absolute rank does, which makes absolute-rank history noisy for reasons unrelated to the page's standing.
- It is comparable across providers; absolute rank definitions differ (right-column handling, what counts as an element).
- Absolute rank is still stored and shown ("Pixel/visual position" is post-MVP), because a keyword whose organic rank is stable but whose absolute rank went from 3 to 9 (an AI Overview and a video carousel appeared) has lost traffic, and users need to see that.

## 2. Multiple URLs and multiple domains

- **Several URLs of the same entity rank** (for example `/pricing` at 4 and `/blog/crm-guide` at 11): entity rank = 4, ranking URL = `/pricing`. All ranks and URLs are stored (`all_organic_ranks`, `all_url_ids`) and drive the cannibalization detector ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 9).
- **Grouped sub-results** (indented result from the same site) share the parent's rank and are stored as additional URLs, not additional ranks.
- **Subdomains:** matched by the entity's domain rules. `blog.acme.com` counts for Acme when the rule is registrable-domain scope. A project that wants `docs.acme.com` tracked separately configures it as its own entity or with host scope.
- **Target URL mismatch:** when a tracked keyword has a `target_url_id` and the ranking URL differs, the check records `target_url_match = false` (derived in the state table). The keyword detail view shows "ranking URL is not the target URL".

## 3. The depth-aware null rule

Ranks beyond the requested depth are unknown, not absent. Every metric obeys these rules:

1. **Bucket counts** (top 3, top 10, top 20) use every check whose depth covers the bucket. A daily depth-20 check contributes to top 3, 10, 20. Checks at depth 50 or more contribute to top 50 counts; only depth-100 checks contribute to top 100 counts.
2. **"Ranked" for a series** is always stated with its depth: "ranked in top 20" daily, "ranked in top 100" weekly.
3. **Averages and medians** use ranked checks only and always display the count of ranked keywords next to the value ("Average position 7.4 across 612 ranked keywords of 1,000").
4. **Rank change** between two checks is numeric only when both are ranked. When one or both are beyond depth, the change is categorical (section 4).
5. **Effective depth.** When a SERP returns fewer organic results than requested because Google has no more (`depth_returned < depth_requested` and the provider reports no further pages), the effective depth of that check is `depth_returned`, and "not in top N" uses that N. Checks where results are short for other reasons (parser anomaly) are flagged, not reinterpreted.
6. **Visibility** treats beyond-depth as CTR 0. The error bound is stated: at depth 20, the maximum understatement per keyword is CTR(21)/CTR(1) = 0.33% of that keyword's maximum contribution under curve `ctr_v1` (section 6.3).

We never impute rank 100 or 101 for unranked keywords in the default views. That common practice (for example, Semrush imputes 100 for unranked keywords in average position, per `research/07-commercial-competitors.md`) produces averages that move with keyword count rather than with performance. A **capped average** (unranked = depth + 1) is available in exports under an explicit name for users who need parity with other tools.

## 4. Per-keyword metrics

Let `r_t` be the entity rank at check `t` (NULL if beyond depth `d_t`).

| Metric | Formula | Notes |
|---|---|---|
| Current rank | `r_T` for the latest successful check T | With `d_T` |
| Previous rank | `r_{T-1}` for the previous successful check with the same or greater depth coverage | Deep and daily checks are compared within the smaller depth |
| Rank change | `r_{T-1} - r_T` if both ranked (positive = improved) | See categorical cases below |
| Best rank | `min(r_t)` over retained history, ranked checks only | With date |
| Worst rank | `max(r_t)` over ranked checks in the selected window | Beyond-depth checks are reported separately as a count |
| Average rank (window) | `mean(r_t)` over ranked checks in window | With `n_ranked / n_checks` |
| Median rank (window) | `percentile_cont(0.5)` over ranked checks in window | |
| Days in top N | count of checks with `r_t <= N` in window, with `d_t >= N` | |
| Rank volatility | `stddev_samp(r_t)` over last 30 ranked checks | Definition in [17-statistical-methodology.md](17-statistical-methodology.md) section 10 |
| Mean absolute daily change | `mean(abs(r_t - r_{t-1}))` over consecutive ranked pairs | |
| URL stability | share of consecutive pairs with the same ranking URL | 1.0 = stable |

Categorical rank change (when a numeric change is not defined):

| Previous | Current | Label |
|---|---|---|
| beyond depth `d` | ranked | `new` ("entered top d") |
| ranked | beyond depth `d` | `lost` ("dropped out of top d") |
| beyond depth | beyond depth | `unchanged_beyond` |
| ranked at `r > d_T` (from a deep check) | beyond `d_T` (daily) | `consistent_beyond` (no change inferred) |
| no previous check | any | `first_check` |

### 4.1 Events (append-only, feed alerts)

Computed at ingest by comparing the new check with the state table. Written to `seo.rank_events` (partitioned monthly, one row per event).

```sql
CREATE TABLE seo.rank_events (
    id                 bigint GENERATED ALWAYS AS IDENTITY,
    occurred_at        timestamptz NOT NULL,
    workspace_id       uuid NOT NULL,
    project_id         uuid NOT NULL,
    tracked_keyword_id uuid NOT NULL,
    entity_id          uuid NOT NULL,
    event_type         text NOT NULL,   -- see list below
    from_rank          smallint,
    to_rank            smallint,
    from_url_id        bigint,
    to_url_id          bigint,
    other_entity_id    uuid,            -- for overtake events
    serp_snapshot_id   bigint NOT NULL,
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX ON seo.rank_events (project_id, occurred_at DESC, event_type);
```

| Event type | Condition |
|---|---|
| `entered_top_3`, `entered_top_10`, `entered_top_20`, `entered_top_100` | previous rank > N or beyond, current <= N; depth covers N in both checks |
| `lost_top_3`, `lost_top_10`, `lost_top_20`, `lost_top_100` | inverse |
| `new_ranking` | first time ranked within depth after at least 2 consecutive beyond-depth checks (debounce) |
| `lost_ranking` | beyond depth after being ranked, confirmed by 2 consecutive checks (debounce) |
| `rank_drop` / `rank_gain` | numeric change beyond a per-rule threshold (alerts define thresholds; events store the magnitude) |
| `url_changed` | ranking URL differs from previous ranked check |
| `feature_gained` / `feature_lost` | owned SERP feature appears / disappears (per feature type) |
| `aio_appeared` / `aio_disappeared` | AI Overview present / absent vs previous check |
| `aio_citation_gained` / `aio_citation_lost` | entity's domain cited / not cited in AI Overview vs previous check where AIO present in both |
| `overtaken_by` | a competitor ranks better than own entity now, and did not in the previous check |
| `overtook` | own entity ranks better than a competitor now, and did not previously |

Debounce rules for `new_ranking` and `lost_ranking` exist because single-check flips at the edge of the depth are common and would otherwise flood alerts.

**As built (step 5, rank collection).** The rules are the pure functions of `backend/src/sightline/ranks/` (no database, no I/O; an import contract keeps them so), applied by the ingest. Where the text above leaves room, this is what they do:

- **The own side is one.** A keyword's current rank is the best organic rank among all entities with role `own`, and its events are attributed to the primary own entity (a project without one writes no rank events). Each own and competitor entity still has its own `domain_rank_observations` row per check.
- **The previous check is the last successful check**, held in the state (`previous_rank`, `previous_observed_at`, `previous_depth_requested`). A change is computed within the smaller depth of the two checks: both ranks beyond that depth count as beyond it. A numeric change is written as `rank_gain` or `rank_drop` for every change, with the ranks; thresholds belong to the alert rules.
- **The debounce run** (`consecutive_beyond`) grows only on a check that looked as deep as the keyword last ranked (`last_ranked_rank`), so a daily depth-20 check cannot declare a keyword seen at 45 lost. A ranked check that is `consistent_beyond` leaves the run alone, so a weekly deep check neither ends it nor hides a later `new_ranking`. `lost_ranking` carries that last rank as `from_rank`.
- **Features count on the first page only** (the tenth organic result's absolute rank is the limit), so the state does not change with the depth of the check; the feature rows keep the whole truth. The AI Overview is cited, not owned: it is left out of owned feature types and followed by the `aio_*` events.
- **A grouped sub-result** is another URL at its parent's rank (`all_organic_ranks` repeats the rank, `result_count` counts distinct ranks). The ranking URL changes only between two ranked checks in a row.
- **The depth of a check is the depth requested.** A SERP that returns fewer results because Google has no more is not told apart yet.
- **Carried for a product decision:** the `entered_top_100`, `lost_top_100` events and numeric changes between ranks 21 and 100 cannot fire in the `standard` profile, because a deep check is only ever compared with the daily check before it (the state would need the previous deep check). A citation change across a check where the AI Overview did not load is not reported.

## 5. Project-level SEO metrics

Let K be the set of active tracked keywords in scope (filters: group, term, device, location, intent) and T the check date. For each keyword k, `r_k` is the latest rank on or before T (for daily series) or from the latest deep check (for top-100 metrics).

| Metric | Formula | Denominator shown |
|---|---|---|
| Keywords tracked | `|K|` | |
| Keywords checked | keywords with a successful check on T | `|K|` |
| Top-3 / 10 / 20 count | `count(k : r_k <= N)` | checked keywords |
| Top-100 count | `count(k : r_k <= 100)` using latest deep check | keywords with a deep check in the last 8 days |
| Rank distribution | histogram buckets 1, 2 to 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100, beyond | checked keywords |
| Average rank (ranked) | `mean(r_k)` over ranked keywords | ranked count |
| Median rank (ranked) | median over ranked keywords | ranked count |
| New ranking keywords (period) | keywords with a `new_ranking` event in period | |
| Lost ranking keywords (period) | keywords with a `lost_ranking` event in period | |
| Improved / declined / unchanged | counts of keywords with positive / negative / zero numeric change vs the comparison date | keywords ranked on both dates |
| SEO visibility | section 6 | |
| Estimated clicks | section 6 | |
| Share of voice (SEO) | section 7 | |
| Featured snippet ownership | `count(k : own entity owns featured_snippet)` / `count(k : featured_snippet present)` | keywords with the feature |
| SERP feature ownership (per type) | same pattern per feature type | keywords with the feature |
| AI Overview presence rate | `count(k : has_ai_overview)` / checked keywords | checked keywords |
| AI Overview citation rate | `count(k : own cited in AIO)` / `count(k : has_ai_overview)` | keywords with AIO |
| Competitor average rank | per competitor, same as own | ranked count per competitor |
| Rank volatility (project) | median of per-keyword volatility | keywords with >= 10 ranked checks |
| URL stability (project) | median of per-keyword URL stability | same |
| Cannibalization count | keywords flagged by the detector | [08-seo-keyword-system.md](08-seo-keyword-system.md) section 9 |

## 6. SEO visibility and estimated clicks

### 6.1 What established tools do (research summary)

From `research/07-commercial-competitors.md` (verified 2026-09-29):

- AWR Visibility: a points score, 30 points for position 1 down to 1 point for position 30; no CTR, no volume.
- SE Ranking: visibility with a stepwise factor (1 for top 3, 0.85 at 4, down to 0.2 at 10, 0 from 11).
- AccuRanker and Ahrefs Share of Voice: CTR(position) x search volume, AccuRanker over the top 20.
- Semrush Visibility %: CTR-based, 100% means position 1 for every keyword; weights not published.

Published CTR curves disagree by roughly 3x at position 1 (3.6% to 27.3% depending on estimator, layout, and period) and fluctuate strongly month to month (AWR desktop position 1 ranged from 14.6% to 45.6% within 2026). So: **absolute click estimates are uncertain by a factor of about 3; ratios computed with one fixed curve are much more stable.** Our visibility metric is a ratio for that reason.

### 6.2 Formulas

For keyword set K, entity e, CTR curve C (versioned), keyword weight `w_k` (default 1), and search volume `V_k` (latest monthly value from `seo.keyword_metrics_current`):

```
Volume-weighted SEO Visibility (%)  = 100 * Σ_k w_k * V_k * C(r_ek)  /  Σ_k w_k * V_k * C(1)

Equal-weight SEO Visibility (%)     = 100 * Σ_k w_k * C(r_ek)        /  Σ_k w_k * C(1)

Estimated monthly organic clicks    = Σ_k V_k * C(r_ek)                        (labelled estimate)
```

- `C(r) = 0` when r is NULL (beyond depth).
- Keywords with no search volume are excluded from the volume-weighted variant and counted in a "no volume data" note; they are included in the equal-weight variant.
- `w_k` defaults to 1. Projects may set weights from `business_value` or `priority` (priority 1 = weight 3, 2 = 2, 3 = 1, 4 = 0.5, 5 = 0.25). The weight scheme is shown in the metric info panel.
- Both visibility variants are shown; the volume-weighted one is the default headline because it reflects demand, and the equal-weight one guards against a few head terms dominating.
- 100% means position 1 for every keyword in scope. The metric is not comparable across projects with different keyword sets; the UI says so.

### 6.3 CTR curve `ctr_v1`

We use one fixed, versioned curve for visibility, and allow layout-aware estimates only as an explicitly labeled option.

`ctr_v1` definition:

- Positions 1 to 6: AWR CTR study, Google US desktop, all SERPs, July 2026 (verified 2026-09-29): 20.02, 10.36, 3.89, 1.71, 1.08, 0.73 percent.
- Positions 7 to 100: power-law tail anchored at position 6: `C(p) = 0.73% * (p / 6)^-1.9`.

| Position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 15 | 20 | 21 | 30 | 50 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ctr_v1` % | 20.02 | 10.36 | 3.89 | 1.71 | 1.08 | 0.73 | 0.54 | 0.42 | 0.34 | 0.28 | 0.13 | 0.074 | 0.067 | 0.034 | 0.013 | 0.0035 |

Why a smoothed tail instead of AWR's measured positions 7 to 20: AWR's measured values rise after position 7 (0.46% at 7, 0.88% at 14), which reflects bottom-of-page and continuous-scroll effects and a Google impressions logging issue reported for 2025-05 to 2026-04 (verified, third-party). Using them directly would make a page's visibility **decrease** when it moves from position 14 to position 8, which is wrong as a performance signal. The tail is a modeling choice, labeled as such, and the curve is monotonic by construction.

Mobile uses the same curve in V1 (assumption; revisit when a mobile-specific curve with page-2 data is available).

The curve is stored in `ops.ctr_curves` with a version; changing it creates a version boundary on visibility charts and recomputation of history is offered.

```sql
CREATE TABLE ops.ctr_curves (
    version       smallint NOT NULL,
    device        text NOT NULL CHECK (device IN ('desktop','mobile','any')),
    layout        text NOT NULL DEFAULT 'all' CHECK (layout IN ('all','with_ai_overview')),
    position      smallint NOT NULL CHECK (position BETWEEN 1 AND 100),
    ctr           numeric(8,6) NOT NULL,        -- fraction, 0.2002 = 20.02%
    source        text NOT NULL,
    PRIMARY KEY (version, device, layout, position)
);
```

### 6.4 Layout-aware click estimate (optional, Phase 14)

AWR also publishes a curve for SERPs with an AI Overview (position 1 9.69%, 2 3.69%, 3 1.70%; verified). A layout-aware estimate uses `C_aio(r)` for checks with `has_ai_overview` and `C(r)` otherwise. It is shown only as "Estimated clicks (AIO-adjusted)" next to the standard estimate, never as the visibility headline, because the with-AIO curve is even more volatile month to month (AWR with-AIO desktop position 1 ranged from 1.96% to 25.58% in 2026) and because AIO presence is measured once per check while users see varying layouts.

### 6.5 SQL: visibility for one project and date

```sql
WITH latest AS (
  SELECT DISTINCT ON (d.tracked_keyword_id)
         d.tracked_keyword_id, d.organic_rank
  FROM seo.domain_rank_observations d
  WHERE d.project_id = $1 AND d.entity_id = $2
    AND d.observed_date BETWEEN $3::date - 7 AND $3::date     -- latest check within a week
    AND d.is_valid
  ORDER BY d.tracked_keyword_id, d.observed_at DESC
)
SELECT
  100 * sum(w.weight * km.search_volume * coalesce(c.ctr, 0))
      / nullif(sum(w.weight * km.search_volume * c1.ctr), 0)            AS visibility_pct,
  sum(km.search_volume * coalesce(c.ctr, 0))                             AS est_monthly_clicks,
  count(*) FILTER (WHERE km.search_volume IS NULL)                       AS keywords_without_volume
FROM latest l
JOIN seo.tracked_keywords tk ON tk.id = l.tracked_keyword_id
JOIN core.keyword_weights w ON w.tracked_keyword_id = tk.id               -- view: resolves weight scheme
LEFT JOIN seo.keyword_metrics_current km
       ON km.keyword_id = tk.keyword_id AND km.location_id = tk.location_id
      AND km.language_code = tk.language_code AND km.source = 'dataforseo_labs'
LEFT JOIN ops.ctr_curves c  ON c.version = $4 AND c.device = 'any' AND c.layout = 'all' AND c.position = l.organic_rank
JOIN      ops.ctr_curves c1 ON c1.version = $4 AND c1.device = 'any' AND c1.layout = 'all' AND c1.position = 1;
```

Rollups store `visibility_pct` and `est_clicks` per day and dimension in `seo.daily_project_metrics` so dashboards do not run this per request.

## 7. Share of voice (SEO)

```
SEO SOV(e) = Σ_k V_k * C(r_ek)  /  Σ_k V_k * Σ_{p=1..20} C(p)
```

The denominator is the total estimated clicks available to the top 20 organic positions for the keyword set. It does **not** depend on which competitors are configured, which avoids a known anti-pattern (SOV that changes when the competitor list changes). The SOV of all tracked entities does not sum to 100%; the remainder is "other domains", shown as its own series. A second view, "share among tracked entities", normalizes over the configured entities only and is labeled as such.

Top-20 is chosen because daily checks cover it under the default depth profile.

## 8. Keyword difficulty and intent

- **Keyword difficulty** is DataForSEO Labs `keyword_difficulty`: 0 to 100 on a logarithmic scale derived from the link profiles of the current top 10 (verified). It is a provider metric, displayed with its source, not blended into any of our scores.
- **Intent** default comes from DataForSEO (`main_intent`, with `foreign_intent` as secondary) and is overridable per tracked keyword (`intent_source = 'manual'`). Our intent enum maps provider labels: informational, navigational, commercial, transactional; `local` is set by rule when the SERP contains a local pack in the majority of the last 5 checks.

## 9. What these metrics do not tell you

| Metric | Limitation |
|---|---|
| Organic rank | A single non-personalized sample per check from one location and device. Real users see personalized, localized, and experiment-varied SERPs |
| Visibility | Depends on the CTR curve shape; not comparable across projects; not traffic |
| Estimated clicks | Uncertain by about 3x (curve disagreement); ignores brand strength, snippet quality, features |
| Rank changes | One observation per day; 1 to 2 position moves are often noise (see keyword volatility) |
| SERP feature ownership | Captured once per check; features rotate |
| GSC average position | A different measurement (impression-weighted average of topmost position across all users). Never mixed with our rank; shown side by side with its own label ([18-first-party-integrations.md](18-first-party-integrations.md)) |
