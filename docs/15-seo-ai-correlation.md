# 15. SEO and AI Correlation

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [09-rank-tracking-methodology.md](09-rank-tracking-methodology.md), [10-serp-feature-tracking.md](10-serp-feature-tracking.md), [11-ai-prompt-system.md](11-ai-prompt-system.md) section 6, [14-citation-intelligence.md](14-citation-intelligence.md), [16-metrics-methodology.md](16-metrics-methodology.md), [17-statistical-methodology.md](17-statistical-methodology.md)

## 1. Principles

1. **A keyword is not a prompt.** A keyword is a search query measured by rank in a SERP. A prompt is a conversational question measured by mention and citation rates over repeated samples. They are linked explicitly (`core.keyword_prompt_links`), never merged.
2. **Different measurements sit side by side, not averaged together.** Organic rank, AI Overview citation, ChatGPT mention rate and GSC clicks are shown as separate columns with their own units, denominators and observation classes.
3. **Matrices and component metrics, not a master score.** We do not publish a combined "AI + SEO visibility score". Every cross-channel view is a table or scatter of component metrics with explicit thresholds.
4. **Association, not causation.** Cross-channel analyses describe co-occurrence. Where we compute longitudinal associations, the UI labels them as such and lists known confounders.

## 2. Joining keys

| Join | Key | Notes |
|---|---|---|
| Keyword to prompt | `core.keyword_prompt_links` (active only) | Many-to-many, typed, with confidence |
| Keyword to AI Overview | `ai.observations.tracked_keyword_id` + `serp_snapshot_id` | Same check as the organic rank |
| Keyword to AI Mode (keyword runs) | `ai.observations.tracked_keyword_id` (engine `google_ai_mode`) | Opt-in per keyword group |
| Page | `core.urls.id` | Organic ranking URL, AI citation URL, AIO reference URL, GSC page |
| Domain / competitor | `core.domains.id`, `core.entity_domains` | SEO competitor and AI competitor are the same entity |
| Topic / cluster | `core.taxonomy_terms` via `seo.tracked_keyword_terms` and `ai.prompt_terms` | Shared vocabulary |
| Fan-out query to keyword | `ai.fanout_queries.matched_keyword_id` | Exact normalized match in V1 |
| GSC query to keyword | `fp.gsc_queries.matched_keyword_ids` | Exact normalized match |

### 2.1 Resolving a link to a measurable keyword

A matrix view has a selected location L and device D. A link (keyword k, prompt p) resolves to tracked keyword `tk(k, L, D)`:

1. If a tracked keyword exists for (project, k, L, D), use it.
2. Else if one exists for (project, k, L, other device), use it and mark the cell "other device".
3. Else the link is shown with "not tracked in this location" and excluded from quadrant counts.

Prompt observations are filtered to locations in the same country as L. A prompt tracked for the US is never compared with a keyword tracked for Germany.

## 3. The keyword-level channel row

For each tracked keyword in scope, over window W (default 28 days):

| Column | Definition | Source |
|---|---|---|
| Organic rank | latest rank with depth; median over window as secondary | `seo.domain_rank_observations` |
| Rank bucket | 1, 2 to 3, 4 to 10, 11 to 20, 21 to 100, beyond | derived |
| Search volume, KD, intent | latest | `seo.keyword_metrics_current` |
| AIO presence rate | checks with AIO / checks | `seo.serp_snapshots` |
| AIO own citation rate | checks with own cited / checks with AIO | `seo.domain_rank_observations.cited_in_ai_overview` |
| AIO own mention rate | AIO observations with own mentioned / AIO observations | `ai.observation_facts` (engine `google_ai_overview`) |
| AI Mode own mention / citation rate | keyword runs if enabled, else linked prompts | `ai.observation_facts` |
| ChatGPT mention, citation, recommendation rates | prompt-weighted average over **linked active prompts** | rollups |
| Gemini mention, citation rates | same | rollups |
| Linked prompts | count, with the primary link | links |
| Competitor leader (SEO) | tracked competitor with best organic rank | domain rank rows |
| Competitor leader (AI) | tracked entity with highest SOV over linked prompts, all consumer engines equal-weighted | rollups |
| Owned page cited | own URL most cited in linked prompts and AIO | citations |
| GSC clicks, impressions, avg position | window totals for the matched query | `fp.gsc_search_analytics` (labeled first-party, GSC position is a different measurement) |

Each AI rate carries `n_observations` and `n_prompts`. Cells with fewer than 4 valid observations per engine in the window show "insufficient data" instead of a rate.

This row set is materialized weekly (and on demand for the current week) into:

```sql
CREATE TABLE core.xch_keyword_weekly (
    project_id            uuid NOT NULL,
    workspace_id          uuid NOT NULL,
    week_start            date NOT NULL,
    tracked_keyword_id    uuid NOT NULL,
    organic_rank_latest   smallint,
    organic_rank_median   numeric(6,2),
    depth_latest          smallint NOT NULL,
    aio_checks            smallint NOT NULL,
    aio_present           smallint NOT NULL,
    aio_own_cited         smallint NOT NULL,
    aio_own_mentioned     smallint NOT NULL,
    ai_mode_obs           smallint NOT NULL,
    ai_mode_own_mentioned smallint NOT NULL,
    ai_mode_own_cited     smallint NOT NULL,
    linked_prompts        smallint NOT NULL,
    chatgpt_obs           integer NOT NULL,
    chatgpt_mention_num   numeric(10,4) NOT NULL,   -- sum over linked prompts of per-prompt rates (prompt-weighted)
    chatgpt_citation_num  numeric(10,4) NOT NULL,
    chatgpt_recommendation_num numeric(10,4) NOT NULL,
    chatgpt_prompts_obs   smallint NOT NULL,        -- linked prompts with >= 1 observation
    gemini_obs            integer NOT NULL,
    gemini_mention_num    numeric(10,4) NOT NULL,
    gemini_citation_num   numeric(10,4) NOT NULL,
    gemini_recommendation_num  numeric(10,4) NOT NULL,
    gemini_prompts_obs    smallint NOT NULL,
    seo_leader_entity_id  uuid,
    ai_leader_entity_id   uuid,
    computed_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, week_start, tracked_keyword_id)
);
```

## 4. The SEO and AI matrix

### 4.1 Classification

Per keyword (or per cluster, section 4.3), with configurable thresholds (defaults shown):

| Axis | Strong | Middle | Weak | Insufficient |
|---|---|---|---|---|
| SEO | organic rank <= 10 | 11 to 20 | > 20 or beyond depth | never checked in window |
| AI | AI presence >= 0.5 | 0.1 to 0.5 | <= 0.1 | fewer than 4 valid observations on the selected engines |

**AI presence** for the matrix is, by default, the equal-weight average of the own mention rates on the selected engines (default: ChatGPT, Gemini, AI Overview mention rate conditional on AIO present). The user can switch the AI axis to citation rate or recommendation rate. The chosen definition is printed on the matrix.

Quadrants (strong or weak on both axes; middle rows are listed separately):

| Quadrant | Reading | Typical next step (hypothesis, not a claim) |
|---|---|---|
| SEO strong, AI strong | Visible in both | Monitor; defend |
| SEO strong, AI weak | Ranks, but AI answers do not mention or cite the brand | GEO opportunity: check whether the ranking page is cited, whether competitors are recommended, which sources are cited instead |
| SEO weak, AI strong | AI mentions the brand despite weak rankings | Authority or brand signal from other sources; check which sources support the mention |
| SEO weak, AI weak | Low visibility everywhere | Content or authority gap |

### 4.2 Display

A 2x2 grid with counts, search volume represented, and drill-down to the keyword rows; a scatter plot (x = organic rank bucket, y = AI presence) with point size = search volume; and a table with every column of section 3. Middle-band keywords are shown in a "near threshold" list rather than forced into a quadrant.

### 4.3 Cluster-level matrix

For a topic or cluster term C:

- SEO axis: volume-weighted SEO visibility of C's keywords ([09-rank-tracking-methodology.md](09-rank-tracking-methodology.md) section 6), thresholds strong >= 30%, weak <= 5%.
- AI axis: prompt-weighted mention rate over C's prompts (not only linked prompts: all prompts with term C), per engine, equal-weight average.

Clusters exist in both channels through the shared taxonomy, so a cluster can be analyzed even when individual keyword-prompt links are sparse.

## 5. Analyses that answer the product questions

| Question | Analysis | Output |
|---|---|---|
| We rank 2 organically; are we cited in the AI Overview? | Same-check comparison: for checks with AIO present, own organic rank vs `cited_in_ai_overview` | **AIO citation rate by organic rank bucket** with Wilson intervals; per-keyword list for rank 1 to 3 without AIO citation |
| We rank 8; does ChatGPT still recommend us? | Keywords in bucket 4 to 10; linked prompts' ChatGPT recommendation rate | Table with rates, n, and competitors recommended instead |
| We do not rank; are we cited by Gemini? | Keywords beyond depth with linked prompts where Gemini own-domain citation rate > 0 | Table with cited own URLs |
| Does a competitor outrank us and dominate AI? | Keywords where competitor organic rank < own, and competitor SOV > own SOV on linked prompts | Per competitor: count, volume represented, keyword list |
| Which top-10 keywords have zero AI visibility? | Tracked keywords with organic rank <= 10 whose AI presence (section 4.1 definition) is 0 on every selected engine with at least 4 valid observations per engine | Keyword list with volume and linked prompts |
| Which pages rank but are never cited? | Owned URLs ranking top 10 for at least one tracked keyword in W, with zero citation units across engines in W, among pages whose linked topics had at least 20 observations | Page list with keywords and topics |
| Which pages are cited despite weak rankings? | Owned URLs with >= 2 citation units in W whose best organic rank for any tracked keyword is > 20 or none | Page list with engines and prompts |
| Does organic improvement associate with more AI citations? | Section 5.1 | Association table with caveats |
| Which keywords trigger AI Overviews? | AIO presence rate per keyword in W; by intent, cluster, device | Sorted list and breakdowns |
| Which keywords produce AI Mode results where we appear? | `ai_mode_keyword` observations with own mentioned or cited | List with rates |
| Do the same domains dominate SERPs and AI citations? | Per domain: SEO SOV (top 20) vs AI source share; Spearman rank correlation across the top 50 domains; Jaccard overlap of top-20 domain sets | Scatter and overlap stats per engine |
| Which prompts correspond to valuable SEO keywords? | Prompts ranked by linked keywords' volume x business value | Table |
| Which SEO keywords should become tracked prompts? | Keywords with volume above project median, commercial or transactional intent, AIO present in >= 50% of checks, and no active linked prompts | Suggestions into the prompt candidate inbox |
| Which AI prompt opportunities have low search competition? | Prompts whose linked keywords have KD <= 30 or volume below the project's 25th percentile, where competitors are mentioned in >= 30% of observations and own in <= 10% | Table, labeled "AI-first opportunities" |
| Which pages influence AI answers despite weak rankings? | Same as "cited despite weak rankings", plus third-party pages repeatedly cited for our topics that do not appear in stored top-20 SERPs | Two lists |
| Which fan-out queries do we already track, and how do we rank? | F3 and F5 in doc 16 | Table per prompt |

### 5.1 Longitudinal association: organic rank changes and AI citation changes

Question: when a keyword's organic rank improves, does its AI citation frequency tend to rise afterwards?

Method (descriptive, Phase 10):

1. Unit: keyword-week pairs for keywords with at least 8 weeks of data and at least 4 valid AI observations per week (AIO checks and/or linked prompt observations).
2. For each keyword-week, compute `Δrank` (median rank this week minus previous week; negative is improvement) and `Δcite_next` (own citation rate next week minus this week).
3. Group keyword-weeks into `improved` (Δrank <= -3), `stable` (|Δrank| <= 1), `declined` (Δrank >= 3).
4. Report mean `Δcite_next` per group with cluster bootstrap intervals (clustered by keyword), and the within-keyword Spearman correlation between rank and citation rate averaged across keywords.

Caveats printed with the result: rank and citation can move together because of a shared cause (content update, site-wide authority change, Google layout change); AIO citations are partially drawn from the organic results themselves, so a mechanical association is expected for AIO and says little about ChatGPT or Gemini; small samples per keyword. The analysis is shown per engine, never pooled.

## 6. Page intelligence (unified)

For each owned URL (and optionally any third-party URL):

| Section | Metrics |
|---|---|
| SEO | tracked keywords ranking with this URL, average rank, rank distribution, top-3 and top-10 counts, volume represented, estimated visibility contribution, target-page coverage, rank trend ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 10) |
| AI Overview | checks where this URL is cited in AIO, citation positions, keywords |
| ChatGPT / Gemini / AI Mode | citation units, observations, prompts, per engine; retrieved-not-cited count (ChatGPT) |
| Mentions associated | entity mentions in the same answer block as this URL's citation (association) |
| First-party | GSC clicks, impressions, CTR, average position (GSC measurement); imported generative AI impressions if available; AI referral sessions to this landing page (GA4) |
| Trend | weekly series for each channel, separate axes |

Powered by `seo.daily_page_metrics`, `ai.project_source_stats` (grain `url`) and `fp.gsc_page_daily`, joined on `url_id`; `ai.daily_domain_citations` adds domain-level context joined on `domain_id`.

## 7. Diagnostics: "Why am I losing this keyword?"

The keyword diagnostic panel lists **evidence** in fixed sections and **hypotheses** in a separate, labeled section. It never produces a single causal sentence.

Evidence (all from stored data):
1. Rank history with depth, version boundaries, and event markers.
2. Ranking URL history and target-URL match.
3. Competitors above us now vs 30 days ago, their ranking URLs and rank history.
4. SERP composition change: features appeared or disappeared (AIO, video, PAA), absolute-rank displacement.
5. AI Overview presence and whether we are cited; who is cited instead.
6. Cannibalization flags and co-ranking URLs.
7. GSC for the matched query: impressions and clicks trend (different measurement, labeled).
8. Linked prompts' AI visibility trend.
9. Search volume trend (demand change).

Hypotheses (rule-generated, each linked to the evidence that triggered it):

| Trigger | Hypothesis text |
|---|---|
| New feature above organic results and absolute rank worsened while organic rank stable | "Traffic may be affected by SERP layout change, not rank loss" |
| Ranking URL changed and rank dropped | "A different page now ranks; check intent match of the new URL" |
| Competitor gained 5+ positions in the same window | "Competitor improvement; compare their ranking page" |
| Volume down more than 30% | "Demand decreased; rank may be unaffected" |
| Mass movement anomaly on the date | "Possible collection anomaly or algorithm update" |

Backlink and content data are not collected in V1, so hypotheses never cite them.

## 8. Diagnostics: "Why am I losing this prompt?"

Evidence:
1. Mention, citation and recommendation rate trends per engine with intervals and detectability flags.
2. Competitor mention and recommendation rates on the same observations (paired).
3. Most cited domains and pages for this prompt now vs previous window (new and lost sources).
4. Own pages cited before and not now; own pages retrieved but not cited (ChatGPT).
5. Fan-out queries (ChatGPT) and how we rank for the ones we track.
6. Linked keywords' organic ranks and AIO status.
7. Model changes (`model_reported`) and version boundaries in the window.
8. Answer examples: the latest answers with mentions highlighted, side by side with an earlier answer where we were mentioned.

Hypotheses (rule-generated):

| Trigger | Hypothesis text |
|---|---|
| Own-cited source lost and mention rate fell | "Answers stopped citing your page X, which previously appeared when you were mentioned" |
| Fan-out queries where we rank beyond top 20 appear frequently | "ChatGPT searches for queries where you rank poorly: list" |
| New source domain cited in >= 25% of observations, co-occurring with competitor mentions | "A new source associated with competitor mentions: domain" |
| Model changed in window | "Engine model changed on date; some change may be due to the model" |
| Change not detectable (interval includes zero) | "The drop is within normal variation for this prompt" |

## 9. Competitor cross-channel view

Per competitor: SEO SOV and visibility, keyword gap counts ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 4.1), AI SOV per engine, recommendation rate, citation share, top sources co-occurring with the competitor's mentions, and the overlap of keywords where the competitor beats us in both channels.

## 10. What we do not claim

| Not claimed | Reason |
|---|---|
| A combined SEO plus AI score | Different units, classes and denominators; any weighting would be arbitrary |
| That a keyword's rank causes AI visibility | Observational data; see 5.1 caveats |
| That AI traffic can be estimated from our observations | No reliable AI demand data; first-party referral data is the only traffic measure |
| That a prompt represents its linked keyword's search volume | Different concepts; links are editorial |
