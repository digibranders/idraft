# 16. Metrics Methodology

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [09-rank-tracking-methodology.md](09-rank-tracking-methodology.md) (all SEO metric formulas), [17-statistical-methodology.md](17-statistical-methodology.md) (intervals, volatility, comparisons), [15-seo-ai-correlation.md](15-seo-ai-correlation.md) (cross-channel analyses), [04-data-model.md](04-data-model.md)

This is the metric catalog. Every number the product shows is defined here or in doc 09, with its numerator, denominator, filters, and assumptions. If a metric is not in these two documents, it does not ship.

## 1. Rules that apply to every metric

1. **Every metric has a visible denominator.** The API returns numerator, denominator and sample counts with the value ([19-api-specification.md](19-api-specification.md) section 2.6). The UI shows them on hover and in exports.
2. **Observation classes are never pooled.** AI metrics are computed per engine. An engine belongs to exactly one class (`consumer_ui`, `serp_ai`, `official_api`). Cross-engine summaries are explicit equal-weight averages of per-engine values, displayed next to the per-engine values ([17-statistical-methodology.md](17-statistical-methodology.md) section 4.4).
3. **Only valid, current facts count.** AI metrics read `ai.observation_facts` (or rollups built from it) with `is_valid AND is_current`. Invalid observations are reported as collection health, not as zero visibility.
4. **Branded prompts are separated.** Prompts with `is_branded = true` (the prompt names the own brand) are excluded from default AI visibility metrics and shown in their own "Branded prompts" view. A branded prompt almost always mentions the brand, which inflates visibility. (Pattern borrowed from Limelit Open, Apache-2.0, see `research/06-open-source.md`.)
5. **"No surface" is not a miss.** For `google_ai_overview` and keyword-based `google_ai_mode` observations, a check without an AI Overview is not an observation of the AI Overview. AI Overview metrics use checks where an AI Overview was present as the denominator, and report presence rate separately.
6. **Estimates are labeled.** Anything modeled (CTR-based clicks, AI demand, search volume) carries `is_estimate: true` and a method string.
7. **Every metric carries a method version** (`method_version`) so a formula change is visible as a version boundary.
8. **Window and panel membership at time.** A window metric uses prompts that were members of the selected panel during each observation's date (from `ai.panel_memberships`), not today's membership.

## 2. The metric response contract

API JSON is snake_case ([03-system-architecture.md](03-system-architecture.md), [19-api-specification.md](19-api-specification.md) section 2.12). The block below is the **wire format** and is identical to doc 19 section 2.6. Inside the TypeScript code the same type exists in camelCase (`nObservations`, `isEstimate`, `methodVersion`, ...); `packages/contracts` converts field names mechanically at the API boundary, so there is exactly one field list.

```ts
interface MetricValue {                 // wire format (snake_case)
  metric: string;                       // registry key, e.g. 'ai.mention_rate' (section 2.1)
  value: number | null;                 // null when denominator is 0 or the metric is suppressed
  numerator: number | null;
  denominator: number | null;
  unit: 'ratio' | 'count' | 'rank' | 'score' | 'usd' | 'clicks';   // no percent: visibility is returned as a ratio
  n_observations: number;               // observations, SERP checks or first-party rows that contributed
  n_prompts?: number;                   // distinct prompts (AI)
  n_keywords?: number;                  // distinct keywords (SEO)
  ci?: { low: number; high: number; level: 0.95; method: 'wilson' | 'bootstrap_cluster' | 'normal_fixed_panel' };
  aggregation?: 'prompt_weighted' | 'observation_weighted';
  window: { from: string; to: string; timezone: string };
  filters: Record<string, unknown>;
  observation_class?: 'consumer_ui' | 'serp_ai' | 'official_api' | 'serp' | 'first_party';
  engines?: string[];
  is_estimate: boolean;
  method: string;                       // short human description
  method_version: number;
  version_boundaries?: Array<{ at: string; component: string; from: number | string; to: number | string }>;
  // Optional fields
  entity_id?: string;                   // entity the value is about (SOV, competitor rates)
  engine_code?: string;                 // set when the value is for exactly one engine
  dimension?: { type: string; id: string; label: string };   // breakdown rows
  suppressed_reason?: 'insufficient_data' | 'no_surface' | 'not_classified' | 'below_min_impressions';
  pooled?: { successes: number; trials: number };             // raw counts behind a prompt-weighted rate
  source?: string; data_origin?: 'api' | 'file_import'; data_state?: 'final' | 'provisional' | 'mixed'; coverage?: number;  // first-party (doc 18 section 11.4)
}
```

For prompt-weighted rates, `numerator` is the sum of per-prompt rates and `denominator` the number of prompts; the raw counts are in `pooled`. List rows use the reduced `MetricCell` form with shared fields hoisted to `meta.metric_context` (doc 19 section 2.6 rule 10).

### 2.1 Metric registry keys

Every metric has one registry key (`metric`). Keys for A1 to A14 and C1, C3 are in the tables of sections 4 and 7. The others:

| Metric | Key |
|---|---|
| Citation rate among observations with any citation (A2 variant) | `ai.citation_rate_given_citations` |
| Share of observations with a qualifying ranked list (A9 denominator) | `ai.ranked_list_presence_rate` |
| AI surface presence (share of keyword checks with an AI Overview or AI Mode answer, section 1 rule 5) | `ai.surface_presence_rate` |
| Mention-count share (exports and explicit request only, section 5) | `ai.mention_count_share` |
| V4 mention volatility, V5 citation volatility, V6 within-run instability | `ai.flip_rate`, `ai.citation_jaccard_distance`, `ai.within_run_disagreement` |
| F1, F2, F3, F5 fan-out metrics (F4 is a ranked list, not a value) | `ai.fanout_presence_rate`, `ai.fanout_mean_queries`, `ai.fanout_keyword_coverage`, `ai.fanout_own_top10_share` |
| SEO metrics of section 11 | `seo.keywords_tracked`, `seo.keywords_checked`, `seo.top3_count`, `seo.top10_count`, `seo.top20_count`, `seo.top100_count`, `seo.average_rank`, `seo.median_rank`, `seo.capped_average_rank`, `seo.visibility_volume`, `seo.visibility_equal`, `seo.est_clicks`, `seo.est_clicks_aio_adjusted` (Phase 14), `seo.share_of_voice`, `seo.improved_count`, `seo.declined_count`, `seo.new_ranking_count`, `seo.lost_ranking_count`, `seo.featured_snippet_ownership`, `seo.aio_presence_rate`, `seo.aio_citation_rate`, `seo.cannibalization_count` |
| Keyword research metrics (section 11.1) | `seo.search_volume`, `seo.keyword_difficulty`, `seo.cpc_usd`, `seo.search_volume_trend` |
| First-party metrics (section 10) | the `fp.*` keys of [18-first-party-integrations.md](18-first-party-integrations.md) section 11.4 |

## 3. Scope and notation (AI)

- Scope S = project, engine e, window W, filters (panel, topics, intents, locations, languages, prompt ids, branded flag).
- O(S) = valid, current observation facts in scope.
- P(S) = distinct prompts with at least one observation in O(S).
- For prompt i: `n_i` valid observations, `k_i` successes for the outcome in question.
- Default aggregation is **prompt-weighted**: `R = (1/|P|) * Σ_i k_i / n_i`. When every prompt has the same `n_i`, this equals the pooled ratio. See [17-statistical-methodology.md](17-statistical-methodology.md) section 4 for the rationale and interval method.

## 4. Core AI visibility metrics

| # | Metric (API key) | Per-observation outcome | Denominator | Notes |
|---|---|---|---|---|
| A1 | Mention Rate (`ai.mention_rate`) | `own_mentioned` | valid observations | Headline AI metric |
| A2 | Domain Citation Rate (`ai.citation_rate`) | `own_domain_cited` (any citation whose domain role is `own`) | valid observations | Also shown: "Citation rate among answers with citations" using observations with `total_citation_count > 0` as denominator |
| A3 | Mention and Citation Rate (`ai.mention_and_citation_rate`) | `own_mentioned AND own_domain_cited` | valid observations | |
| A4 | Four-outcome distribution (`ai.outcome_mix`) | one of: mentioned and cited, mentioned only, cited only, neither | valid observations | The four shares sum to 1. Never collapsed into one number |
| A5 | Recommendation Rate (`ai.recommendation_rate`) | `own_recommended = true` | valid observations where recommendation was classified or brand not mentioned | Unmentioned counts as not recommended. Classification coverage shown |
| A6 | Recommendation share of mentions (`ai.recommended_given_mentioned`) | `own_recommended = true` | observations where own mentioned and classified | "When we are mentioned, how often are we recommended" |
| A7 | Share of Voice (`ai.share_of_voice`) | `sov_o(e)` (section 5) | observations with at least one tracked entity mentioned | Per entity; all tracked entities sum to 100% |
| A8 | Citation Share (`ai.citation_share`) | own citation units | all citation units | Citation unit = distinct canonical URL per observation |
| A9 | Structured Top-3 Rate (`ai.structured_top3_rate`) | `own_structured_rank <= 3` | observations with a qualifying ranked list (`had_structured_list`) | Also shown: ranked-list presence rate. Top-5 available as `ai.structured_top5_rate` |
| A10 | Mean / median structured rank (`ai.structured_rank`) | `own_structured_rank` | observations where own has a structured rank | Median is the default display |
| A11 | Prominence (`ai.prominence`) | `own_prominence` | observations where own mentioned | Mean; section 6 |
| A12 | First-mention rate (`ai.first_mention_rate`) | `own_mention_order = 1` | observations where own mentioned | Mention order distribution also available |
| A13 | Sentiment distribution (`ai.sentiment`) | `own_sentiment` class | observations where own mentioned and sentiment classified | Four shares, never a single score |
| A14 | Competitor gap (`ai.competitor_gap`) | `Rate(competitor) - Rate(own)` for a chosen base metric (A1, A2, A5) | same as base metric | Paired on the same observations; interval by prompt-cluster bootstrap |

Dimension breakdowns (topic, intent, funnel stage, engine, country, language, persona, prompt type) are the same metrics grouped by that dimension:

| Breakdown | Grouping source | Caveat |
|---|---|---|
| Topic visibility | `ai.prompt_terms` for vocabulary `topic` (subtree aware) | A prompt in two topics counts in both; topic values do not sum to the total |
| Intent / funnel visibility | `ai.prompts.intent`, `funnel_stage` | |
| Engine visibility | `engine_code` | Never pooled across classes |
| Country / language visibility | `location_id` of observation / prompt `language_code` | |
| Persona visibility | `persona_term_id` | |

## 5. Share of Voice (AI)

For observation o and tracked entity set E (own plus active competitors at observation time):

```
M_o = { e ∈ E : e mentioned in o }
sov_o(e) = 1 / |M_o|  if e ∈ M_o,  else 0          (defined only when |M_o| >= 1)

SOV(e) = Σ_{o ∈ O, |M_o|>=1} sov_o(e)  /  |{o ∈ O : |M_o| >= 1}|
```

Properties:
- Each observation carries equal weight, so a long answer listing 12 brands does not dominate.
- SOV over all tracked entities sums to 100% by construction.
- **SOV depends on the tracked competitor set.** Adding a competitor lowers everyone else's SOV. This is inherent to any share metric. Mitigations: the UI shows the entity set and the date each competitor was added; competitor additions create a version boundary; and "SOV including untracked mentions" (using `ai.entity_candidates` counts per observation, Phase 13) is offered as an alternative denominator.
- We do not use Profound-style formulas that divide response counts by mention counts (mixed units; `research/07-commercial-competitors.md` section 4.3).

Mention-count share (Peec-style: brand mentions / all brand mentions) is available in exports as `ai.mention_count_share` for comparability, labeled as such.

## 6. Prominence, mention order, structured rank

Three different things. They are never combined into one "AI rank".

| Concept | Definition | When defined |
|---|---|---|
| Structured rank | Position of the entity as an item subject in a qualifying ordered list ([13-ai-extraction-engine.md](13-ai-extraction-engine.md) stage 6) | Only when the answer contains a qualifying ordered list and the entity is an item subject |
| Mention order | Order of the entity's first mention among tracked entities mentioned in the answer (1 = first) | When mentioned |
| Prominence | `1 - first_char_offset / answer_char_count`, in [0, 1] | When mentioned |

Why prominence uses character position rather than quartiles (Scrunch-style top/middle/bottom): a continuous value averages cleanly and quartiles can be derived from it. Limitation: prominence is sensitive to answer length and preamble; a brand named after a 300-character introduction in a short answer gets lower prominence than one named after the same introduction in a long answer. It is a descriptive signal, not a quality score.

## 7. Source and citation metrics

Citation unit: one distinct canonical URL cited in one observation (duplicates within an answer counted once; `occurrences` kept separately).

| # | Metric | Formula |
|---|---|---|
| C1 | Source Share of domain d (`ai.source_share`) | citation units with registrable domain d / all citation units in scope |
| C2 | Top cited domains / pages | ranking by citation units, with observation count and prompt count |
| C3 | Source Diversity (`ai.source_diversity`) | distinct registrable domains cited; plus effective number of sources `1 / Σ_d s_d^2` where `s_d` is source share (inverse Herfindahl) |
| C4 | Source category distribution | citation units grouped by `core.domains.default_category` (tenant override applied) |
| C5 | New sources (window vs previous window) | domains with at least 2 citation units in the current window and 0 in the previous window of equal length |
| C6 | Lost sources | domains with at least `min_support` units in a window and 0 units in each of the 2 following full windows (doc 14 section 8) |
| C7 | Competitor source overlap | Jaccard similarity between the sets of domains cited in observations where the competitor is mentioned vs where own is mentioned |
| C8 | Retrieved but not cited (ChatGPT only) | retrieval results with `was_cited = false`, by domain; own-domain retrieved-not-cited rate = own retrieved not cited / own retrieved |
| C9 | Owned page citation count | citation units whose URL belongs to an owned domain, by URL |

The "at least 2 units" rule in C5 and C6 suppresses single-observation noise; it is a parameter (`min_support`, default 2) shown in the UI.

## 8. Change and volatility metrics

| # | Metric | Definition |
|---|---|---|
| V1 | New mentions | prompt-engine pairs where own had 0 mentions in the previous window (with at least 2 observations) and at least 1 in the current window |
| V2 | Lost mentions | inverse of V1 |
| V3 | New / lost citations | same logic for own-domain citation |
| V4 | Mention volatility | flip rate ([17-statistical-methodology.md](17-statistical-methodology.md) section 8.1) |
| V5 | Citation volatility | mean Jaccard distance of cited-domain sets between consecutive observations (section 8.2 of doc 17) |
| V6 | Within-run instability | disagreement across replicates of the same run |
| V7 | Period change | difference in any rate metric between two windows, with paired bootstrap interval and "detectable change" flag (doc 17 section 6) |

V1 to V3 lists are sorted by effect size and marked "detectable" only when they survive the Benjamini-Hochberg filter (doc 17 section 6.4).

## 9. Query fan-out metrics (engines that expose fan-out)

Available only for engines with `exposes_fanout = true` (V1: `chatgpt_web`; Phase 14: official API engines).

| # | Metric | Formula |
|---|---|---|
| F1 | Fan-out presence rate | observations with at least one fan-out query / valid observations |
| F2 | Mean fan-out queries per answer | mean `fanout_count` over observations with fan-out |
| F3 | Fan-out keyword coverage | distinct normalized fan-out queries matching a tracked keyword (exact normalized match in V1) / distinct normalized fan-out queries |
| F4 | Top fan-out queries | ranking by number of observations issuing the query, per prompt or topic |
| F5 | Fan-out queries where own ranks (Phase 15) | among fan-out queries matched to tracked keywords, share where own organic rank <= 10 at the nearest check |

F3 and F5 connect AI retrieval to SEO: "ChatGPT searched for 'crm pricing comparison', which we track, and we rank 14 for it."

## 10. First-party AI metrics

Defined fully in [18-first-party-integrations.md](18-first-party-integrations.md). Always labeled with the source and never combined with synthetic observations.

| Metric | Source | Notes |
|---|---|---|
| Google generative AI impressions | GSC "Generative AI performance" report, imported from UI export (no API as of 2026-09-29) | Impressions only; no clicks or queries |
| Bing AI citations, cited pages, grounding queries | Bing Webmaster AI Performance report, imported from export (no API as of 2026-09-29) | Sampled; export reflects the active filter |
| AI referral sessions | GA4 Data API: Google's "AI Assistant" channel and our own referrer classifier, side by side | Google's channel excludes AI Overviews and AI Mode |
| AI referral key events and conversion rate | GA4: `keyEvents / sessions` for AI-referred sessions | Attribution model is GA4's |
| AI crawler requests | Cloudflare AI Crawl Control via GraphQL, or server logs | Crawls are not citations |

## 11. SEO metrics (index)

All SEO metrics are defined in [09-rank-tracking-methodology.md](09-rank-tracking-methodology.md):

| Metric | Section in doc 09 |
|---|---|
| Current, previous, best, worst, average, median rank; rank change | 4 |
| Top-3/10/20/100 counts, distribution, new and lost keywords | 5 |
| SEO visibility (volume-weighted and equal-weight), estimated clicks | 6 |
| SEO share of voice | 7 |
| SERP feature ownership, featured snippet ownership, AI Overview presence and citation rate | 5 and [10-serp-feature-tracking.md](10-serp-feature-tracking.md) |
| Rank volatility, URL stability | 4 and doc 17 section 10 |
| Cannibalization count | [08-seo-keyword-system.md](08-seo-keyword-system.md) section 9 |
| Landing-page visibility | [08-seo-keyword-system.md](08-seo-keyword-system.md) section 10 |
| Competitor visibility and averages | 5 and 7 |

### 11.1 Keyword research metrics

Four metrics describe a keyword's demand rather than a rank. They come from the DataForSEO Labs keyword overview ([06-dataforseo-seo-integration.md](06-dataforseo-seo-integration.md) section 7), are stored on `seo.keyword_metric_snapshots` (the latest per key in `seo.keyword_metrics_current`), and are all provider estimates (`is_estimate: true`). Their grain is **keyword x location x language** (and `source`, which is `dataforseo_labs` today): `filters` carries `location_id` and `language_code`, `n_keywords` is 1, and they do not depend on a project, so a keyword tracked by two projects has one value.

| Key | Meaning | Source column | Unit | Method |
|---|---|---|---|---|
| `seo.search_volume` | Average monthly searches reported by the provider | `search_volume` (integer, 0 or more) | `count` | `window` is the twelve calendar months ending with the latest month the snapshot has a volume for. No numerator or denominator. |
| `seo.keyword_difficulty` | How hard the keyword is to rank for, as the provider defines it (doc 09 section 8) | `keyword_difficulty` (smallint, 0 to 100) | `score` | Provider value, not recomputed. |
| `seo.cpc_usd` | Average cost per click advertisers pay, in US dollars | `cpc_usd` (numeric(10,4), 0 or more) | `usd` | Provider value, not recomputed. |
| `seo.search_volume_trend` | Direction of search volume over the last year | derived from `monthly_searches` | `ratio` | Least-squares slope of the monthly volumes in the twelve calendar months ending with the latest month that has one, divided by their mean: a fraction a month, so 0.018 is 1.8% a month. A month without a volume is left out, not counted as zero. Null with fewer than 3 months or a mean of zero. `n_observations` is the number of months used. |

- A keyword Labs knows nothing of has a snapshot with every value null; the metrics are then null with no denominator, not zero.
- Seasonality is not a registry key. It is the index of each calendar month over the same twelve months, shown with the trend; a keyword is seasonal when the highest index is above 1.5 and the lowest below 0.67, and only when all twelve months have a volume ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 6).
- **As built (step 5, keywords).** The API returns `seo.search_volume` as a `MetricValue` in the `metrics` of a tracked keyword and `seo.search_volume_trend` in the metrics history (`GET {W}/keywords/{keyword_id}/metrics-history`), both with `method_version` 1. Difficulty and CPC are returned as plain fields (`keyword_difficulty` as an integer, `cpc_usd` as a decimal string with four places) next to the search volume. The trend field of a keyword row, `trend_pct_per_month`, is the same slope times 100.

## 12. Combined SEO and AI metrics (index)

Defined in [15-seo-ai-correlation.md](15-seo-ai-correlation.md). No opaque master score. Summary:

| Metric | Definition sketch |
|---|---|
| AI Overview citation rate by organic rank bucket | P(own cited in AIO \| AIO present, own organic rank in bucket b) |
| Organic top-10 keywords with zero AI visibility | tracked keywords ranked <= 10 whose linked prompts have Mention Rate = 0 and Citation Rate = 0 in window (with minimum observations) |
| Weak organic, strong AI | matrix quadrant SEO weak, AI strong, using the thresholds of doc 15 section 4.1 |
| Cited-page organic performance | for owned URLs cited by AI engines, their organic ranks for tracked keywords |
| Source-domain organic prominence | for top cited third-party domains, their SEO SOV on the project's keywords |
| Cross-channel quadrant | classification of keyword-prompt clusters into SEO strong/weak x AI strong/weak with explicit thresholds |

## 13. Computation strategy

### 13.1 Rollup table (counts and sums only)

`ai.daily_prompt_engine_metrics` ([04-data-model.md](04-data-model.md) section 8.7) holds, per project, date, prompt, engine, and entity, the counts needed by A1 to A13:

```
n_valid, n_mentioned, n_cited, n_mentioned_and_cited,
n_recommended, n_recommendation_classified,
n_structured_list, n_top3, n_top5, sum_structured_rank, n_structured_rank,
sum_prominence, n_prominence, n_first_mention,
n_sentiment_pos, n_sentiment_neu, n_sentiment_neg, n_sentiment_mixed,
n_any_tracked_mentioned, sov_sum,
citation_units_entity, citation_units_total, n_with_citations
```

Rollups are rebuilt for a (project, date) whenever facts for that date change (new ingest, re-derivation). Because they store counts and sums, window metrics are exact sums over rows, and any dimension that is a property of the prompt (topic, intent, persona) is a join from the rollup to prompt metadata.

### 13.2 Mention Rate, prompt-weighted, with fixed-panel interval

```sql
WITH per_prompt AS (
  SELECT m.prompt_id,
         sum(m.n_valid)     AS n,
         sum(m.n_mentioned) AS k
  FROM ai.daily_prompt_engine_metrics m
  JOIN ai.prompts p ON p.id = m.prompt_id AND NOT p.is_branded
  WHERE m.project_id  = $1
    AND m.engine_code = $2
    AND m.entity_id   = $3
    AND m.metric_date BETWEEN $4 AND $5
    AND EXISTS (SELECT 1 FROM ai.panel_memberships pm
                WHERE pm.panel_id = $6 AND pm.prompt_id = m.prompt_id
                  AND pm.valid_from <= (m.metric_date + 1)::timestamptz
                  AND (pm.valid_to IS NULL OR pm.valid_to > m.metric_date::timestamptz))
  GROUP BY m.prompt_id
  HAVING sum(m.n_valid) > 0
)
SELECT
  avg(k::float8 / n)                           AS mention_rate_prompt_weighted,
  sum(k)                                       AS k_total,
  sum(n)                                       AS n_total,
  count(*)                                     AS n_prompts,
  core.wilson_lower(sum(k)::bigint, sum(n)::bigint) AS ci_low_pooled,     -- used when any n_i = 1
  core.wilson_upper(sum(k)::bigint, sum(n)::bigint) AS ci_high_pooled,
  bool_and(n >= 2)                             AS all_prompts_have_replicates,
  sum( (k::float8/n) * (1 - k::float8/n) / greatest(n - 1, 1) ) / count(*)^2 AS var_fixed_panel
FROM per_prompt;
```

The API picks the interval method: if `all_prompts_have_replicates` and `n_prompts >= 30`, a normal interval with `var_fixed_panel`; otherwise the pooled Wilson interval (conservative, doc 17 section 4.2).

### 13.3 Share of Voice

```sql
-- One denominator row per (project, date, prompt, engine): observations with >= 1 tracked entity mentioned.
CREATE VIEW ai.daily_prompt_engine_denominators AS
SELECT project_id, metric_date, prompt_id, engine_code,
       max(n_valid) AS n_valid,
       max(n_any_tracked_mentioned) AS n_any_tracked_mentioned,
       max(citation_units_total) AS citation_units_total,
       max(n_with_citations) AS n_with_citations
FROM ai.daily_prompt_engine_metrics
GROUP BY project_id, metric_date, prompt_id, engine_code;

-- SOV per entity for one engine and window.
WITH num AS (
  SELECT entity_id, sum(sov_sum) AS sov_num
  FROM ai.daily_prompt_engine_metrics
  WHERE project_id = $1 AND engine_code = $2 AND metric_date BETWEEN $3 AND $4
  GROUP BY entity_id
), den AS (
  SELECT sum(n_any_tracked_mentioned) AS sov_den
  FROM ai.daily_prompt_engine_denominators
  WHERE project_id = $1 AND engine_code = $2 AND metric_date BETWEEN $3 AND $4
)
SELECT num.entity_id, num.sov_num / nullif(den.sov_den, 0) AS share_of_voice
FROM num CROSS JOIN den;
```

Denominator-type columns are repeated on every entity row of the same (prompt, date, engine) by the rollup job; the view exposes them once so application code never sums them across entities by mistake.

### 13.4 Caching and budgets

| Query class | Target p95 on the V1 droplet | Mechanism |
|---|---|---|
| Overview tiles (12 metrics, one engine set, 28 days) | 300 ms | rollups + Redis cache 5 min keyed by `data_version` |
| Prompt Explorer list (1,000 prompts x 4 engines, 28 days) | 500 ms | rollups; server-side pagination and sort |
| SOV over 12 weeks | 200 ms | rollups (spike S-09 validates) |
| Bootstrap intervals (on demand) | 1.5 s | computed in API from per-prompt aggregates (at most 10,000 rows), cached |
| Citation intelligence (top domains, 90 days) | 800 ms | `ai.daily_domain_citations` rollup (below) |

```sql
CREATE TABLE ai.daily_domain_citations (
    project_id      uuid NOT NULL,
    workspace_id    uuid NOT NULL,
    metric_date     date NOT NULL,
    engine_code     text NOT NULL,
    domain_id       integer NOT NULL,
    domain_role     text NOT NULL,
    citation_units  integer NOT NULL,
    observations    integer NOT NULL,
    prompts         integer NOT NULL,          -- daily distinct count: do not sum across days
    url_count       integer NOT NULL,          -- daily distinct count: do not sum across days
    PRIMARY KEY (project_id, metric_date, engine_code, domain_id)
);
```

Window-level distinct counts (prompts, URLs per domain) and topic-filtered source metrics are computed from `ai.citations` joined to prompt terms, bounded by project and window; the rollup serves citation-unit sums and trends.


## 14. Metric method versions (V1)

| Metric family | method_version | Notes |
|---|---|---|
| AI rates (A1 to A6, A12) | 1 | Prompt-weighted default; branded excluded by default |
| SOV (A7) | 1 | Observation-normalized |
| Structured rank metrics (A9, A10) | 1 | Tied to extractor ranked-list rules v1 |
| Prominence (A11) | 1 | Character-offset formula |
| Source metrics (C1 to C9) | 1 | Citation unit = distinct canonical URL per observation |
| Keyword research metrics (`seo.search_volume`, `seo.keyword_difficulty`, `seo.cpc_usd`, `seo.search_volume_trend`) | 1 | Provider values; the trend is the 12 month regression of section 11.1 |
| SEO visibility | 1 | `ctr_v1` curve |
| SEO SOV | 1 | Top-20 denominator |
