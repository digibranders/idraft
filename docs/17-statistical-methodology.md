# 17. Statistical Methodology

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [16-metrics-methodology.md](16-metrics-methodology.md), [11-ai-prompt-system.md](11-ai-prompt-system.md), [04-data-model.md](04-data-model.md) section 8

## 1. Why this document exists

Generative answers are stochastic. The same prompt sent to the same engine twice in a minute can mention different brands and cite different sources. A tracker that reports "rank 3" from one response is reporting noise with false precision. This document defines what we estimate, how we attach uncertainty, how many samples we need, and what we refuse to claim.

It also covers SEO rank volatility, where the statistics are simpler but the same honesty rules apply.

Labels used below: **Fact** (mathematical or verified), **Assumption** (we believe it, it affects results, it is testable), **Recommendation** (our design choice), **Limitation** (what the method cannot tell you).

## 2. Sampling model

### 2.1 Unit of observation

One AI observation is one completed response for the tuple:

```
(prompt_version, engine, location, language, replicate_index, observed_at)
```

stored as one row in `ai.observations`, interpreted per project in `ai.observation_facts`.

### 2.2 What is random

For a fixed prompt version *i*, engine *e*, location *l* and a short time window *w*, we model each response as a draw from an unknown distribution of possible answers. For any binary outcome *Y* (for example "own brand mentioned") there is an unknown probability

```
p(i, e, l, w) = P(Y = 1 | prompt i, engine e, location l, window w)
```

Replicates within the same window are treated as independent draws from that distribution.

- **Assumption A1 (replicate independence).** Replicates sent in quick succession through the same provider are independent draws. This can fail if the provider caches responses or if the consumer surface is sticky per session. Test: spike S-05 sends 20 replicates of 30 prompts and checks the exact-duplicate answer rate (`answer_hash` collisions) and the within-run cited-domain Jaccard distribution. If more than 20% of replicate pairs are byte-identical, replicates are not independent for that engine, and we space them in time (for example one per hour) instead.
- **Assumption A2 (stationarity within window).** *p* does not change materially inside the measurement window. For a 7-day window this is reasonable most weeks and false around model releases. Version boundary markers (section 9) flag known model changes.

### 2.3 Two different questions

Every panel-level metric answers one of two questions. They have different uncertainty.

| Question | Name | Population | Uncertainty source |
|---|---|---|---|
| "For **this exact set of prompts**, how often is our brand mentioned?" | Fixed-panel inference | The tracked panel | Response randomness only |
| "For **the kind of questions buyers ask** in this topic, how often are we mentioned?" | Population inference | A hypothetical population of prompts the panel represents | Response randomness plus which prompts were chosen |

**Recommendation.** The product's default is fixed-panel inference, because the panel is a deliberately chosen, stable instrument, like a fixed keyword set in rank tracking. Population inference is offered in the Statistics drawer (Phase 14) with an explicit warning that it is only meaningful if prompts were sampled in a representative way, which is rarely true.

**Limitation.** No prompt panel is a random sample of real user conversations. No provider publishes the distribution of real prompts. So "our brand appears in 34% of AI answers about CRM" is never a claim we make. The claim is always "in 34% of responses to our 250 tracked CRM prompts" and the UI wording enforces it.

## 3. Estimating a single proportion

### 3.1 Point estimate

For *k* successes in *n* valid observations: `p_hat = k / n`.

### 3.2 Interval: Wilson score

We use the Wilson score interval for all binomial proportions. It has near-nominal coverage for small *n* and for *p* near 0 or 1, where the textbook Wald interval (`p_hat ± z*sqrt(p_hat(1-p_hat)/n)`) fails badly and can produce negative bounds. (Fact: Brown, Cai and DasGupta, 2001, "Interval Estimation for a Binomial Proportion", Statistical Science 16(2), recommend Wilson or Jeffreys for small *n*.)

```
z = 1.959964 (95%)
denom  = 1 + z^2 / n
center = (p_hat + z^2 / (2n)) / denom
half   = (z / denom) * sqrt( p_hat(1 - p_hat)/n + z^2 / (4 n^2) )
CI     = [center - half, center + half]
```

SQL implementation (used in rollup views and ad-hoc queries):

```sql
CREATE OR REPLACE FUNCTION core.wilson_lower(k bigint, n bigint, z double precision DEFAULT 1.959964)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN n = 0 THEN NULL ELSE
    ((k::float8/n) + z*z/(2*n) - z*sqrt((k::float8/n)*(1-(k::float8/n))/n + z*z/(4.0*n*n))) / (1 + z*z/n)
  END $$;

CREATE OR REPLACE FUNCTION core.wilson_upper(k bigint, n bigint, z double precision DEFAULT 1.959964)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN n = 0 THEN NULL ELSE
    ((k::float8/n) + z*z/(2*n) + z*sqrt((k::float8/n)*(1-(k::float8/n))/n + z*z/(4.0*n*n))) / (1 + z*z/n)
  END $$;
```

TypeScript mirror lives in `packages/domain/src/stats/wilson.ts` and is tested against the SQL function and against published reference values.

### 3.3 How wide is the interval? (Fact, computed)

95% Wilson interval half-width when the observed rate is 50% (the worst case):

| Replicates *n* | Interval at p_hat = 0.5 | Half-width |
|---|---|---|
| 1 | [0.03, 0.97] (for k=1: [0.21, 1.00]) | uninformative |
| 3 | [0.13, 0.87] | ±0.37 |
| 5 | [0.17, 0.83] | ±0.33 |
| 10 | [0.24, 0.76] | ±0.26 |
| 20 | [0.30, 0.70] | ±0.20 |
| 30 | [0.33, 0.67] | ±0.17 |
| 100 | [0.40, 0.60] | ±0.10 |
| 1,000 | [0.47, 0.53] | ±0.03 |

Two conclusions drive the product design:

1. **Per-prompt rates are imprecise at any affordable replicate count.** With 5 replicates, a prompt at "60%" is statistically indistinguishable from one at 30% or 90%. The UI therefore shows per-prompt results as counts ("3 of 5 runs") with the interval, and uses color only when the interval excludes the comparison value.
2. **Panel-level rates are precise even with one replicate per prompt.** 1,000 prompts x 1 replicate gives about ±3 percentage points on the panel mention rate. This is why the V1 default is breadth (many prompts, 1 replicate) rather than depth (few prompts, many replicates), with extra replicates reserved for a priority subset.

## 4. Panel-level aggregation

### 4.1 Estimator

Let prompt *i* in panel *P* (|P| = m) have *k_i* successes in *n_i* valid observations in the window.

- **Prompt-weighted rate (default):** `R_macro = (1/m) * sum_i (k_i / n_i)`, over prompts with `n_i >= 1`. Each prompt counts equally regardless of how many replicates succeeded.
- **Observation-weighted rate:** `R_micro = sum_i k_i / sum_i n_i`. Identical to the macro rate when all `n_i` are equal.

**Recommendation.** Default to the prompt-weighted rate so that a prompt with extra replicates (priority subset) does not dominate the panel figure. Show `R_micro` in the Statistics drawer. When all prompts have equal *n*, the UI shows a single number.

### 4.2 Fixed-panel interval

Under fixed-panel inference, the variance of `R_macro` is `(1/m^2) * sum_i p_i(1-p_i)/n_i`.

- When `n_i >= 2` for all prompts, estimate each term with the unbiased `p_hat_i(1-p_hat_i)/(n_i - 1)` and use a normal interval on `R_macro`, falling back to Wilson if the result is outside [0, 1] or `m < 30`.
- When `n_i = 1` for some prompts, per-prompt variance is not estimable. Use the **Wilson interval on pooled counts** (`sum k_i`, `sum n_i`). This is conservative (Fact: for independent Bernoulli variables with different means, `sum p_i(1-p_i) <= m * p_bar(1 - p_bar)` by concavity, so the pooled binomial variance is an upper bound).

### 4.3 Population interval (Statistics drawer only)

Cluster bootstrap over prompts: resample *m* prompts with replacement B times (B = 1,000 for interactive requests, 2,000 for exports; section 5), recompute `R_macro`, take the 2.5th and 97.5th percentiles. Computed on demand in the API (m <= 10,000, fast enough in TypeScript), cached by `(project, filters, window, data_version)`.

### 4.4 Rates across engines

Engine-level metrics are computed per engine. A cross-engine "AI mention rate" is shown only as an explicit, equal-weight average of the per-engine rates with the per-engine values visible next to it. Engines are not pooled by observation count, because that would let whichever engine has more replicates or fewer failures dominate.

## 5. Share of voice uncertainty

Share of voice (formula in [16-metrics-methodology.md](16-metrics-methodology.md) section 5) is a ratio of sums, not a simple proportion, so Wilson does not apply. Interval: cluster bootstrap over prompts as in 4.3 (B = 1,000 for interactive, 2,000 for exports). For the default dashboard we show the point estimate plus the number of prompts and observations, and compute the bootstrap interval lazily when the user opens the drawer.

## 6. Comparing periods

The most common question is "did we improve?". The core panel makes this answerable because the same prompts are measured in both periods.

### 6.1 Paired comparison on the core panel (default)

For each prompt *i* in both windows, `d_i = p_hat_i(t2) - p_hat_i(t1)`. The panel change is `mean(d_i)`.

- Interval: paired bootstrap over prompts (resample prompts, keep both periods together), 2,000 draws.
- If every prompt has exactly one observation per period (binary outcomes), the equivalent exact test is **McNemar's test** on the discordant pairs (prompts that flipped 0 to 1 versus 1 to 0). We display the counts: "gained in 41 prompts, lost in 19".

### 6.2 Unpaired comparison (panels changed, or comparing two engines)

Difference of two independent proportions with the **Newcombe hybrid score interval** (Newcombe 1998, method 10), which combines the two Wilson intervals:

```
(L1, U1) = Wilson(k1, n1); (L2, U2) = Wilson(k2, n2); d = p1 - p2
lower = d - sqrt( (p1 - L1)^2 + (U2 - p2)^2 )
upper = d + sqrt( (U1 - p1)^2 + (p2 - L2)^2 )
```

**Limitation.** This treats observations as independent across prompts; if both samples contain repeated prompts, it understates variance. Use only when the paired design is impossible, and label it.

### 6.3 Reporting rule

A change is labeled **"detectable change"** only if its 95% interval excludes zero. Otherwise the UI shows the delta in grey with "within normal variation". We never color a delta green or red unless its interval excludes zero.

### 6.4 Many comparisons at once

A "biggest movers" list over 1,000 prompts will contain about 50 false positives at the 5% level by chance alone. For any list that ranks many prompts or keywords by change, we apply the **Benjamini-Hochberg** procedure at a false discovery rate of 10% and only mark items that survive. Items that do not survive can still appear in the list, sorted by effect size, without the "detectable" badge.

## 7. How many replicates? (planning)

### 7.1 Precision target for a single prompt-engine rate

`n ≈ z^2 * p(1-p) / E^2`. For E = ±0.15 at p = 0.5: n ≈ 43. This is too expensive for every prompt, which is why per-prompt precision is not the goal.

### 7.2 Detecting a change on the panel

Paired design, binary outcomes, 1 observation per prompt per period, discordant proportion `pi_d` (share of prompts that flip) and net effect `delta`. The number of prompts needed for McNemar at alpha 0.05 and power 0.8 is approximately:

```
m ≈ ( z_{α/2} * sqrt(pi_d) + z_β * sqrt(pi_d - delta^2) )^2 / delta^2
```

Example: 25% of prompts flip between weeks (typical of volatile consumer surfaces, to be measured in spike S-05) and we want to detect a net change of 5 points: m ≈ (1.96*0.5 + 0.8416*0.4975)^2 / 0.0025 ≈ 782.5, so 783 prompts. A 1,000-prompt core panel can detect a 5-point weekly change in mention rate; a 200-prompt panel can only detect about 9.8 points.

This formula is exposed in the panel settings screen as "detectable change with this panel size" using the project's measured flip rate.

### 7.3 Recommended V1 sampling design

| Tier | Prompts | Replicates per engine per cycle | Cycle | Purpose |
|---|---|---|---|---|
| Core panel, priority subset | up to 100 | 3 on ChatGPT and Gemini, 1 on AI Mode | weekly | per-prompt diagnostics with usable intervals when aggregated over 4 weeks (n = 12) |
| Core panel, rest | remainder of core | 1 | weekly | panel-level trends and SOV |
| Discovery panel | variable | 1 | monthly | coverage and candidate promotion |

Per-prompt rolling view uses a 28-day window, so a standard core prompt has about 4 observations per engine in the window and a priority prompt about 12. Both are shown with intervals.

**Assumption to validate (S-05):** replicate independence (A1). If replicates are near-duplicates for an engine, extra same-day replicates buy nothing and the priority tier should instead be spread across days.

## 8. Volatility

Volatility metrics describe how much results move between observations. They are descriptive; they carry no significance test.

### 8.1 Mention volatility (per prompt-engine-entity)

**Flip rate** over the ordered sequence of observations `y_1..y_T` (binary mention indicator): `flips / (T - 1)` where `flips = count(y_t != y_{t-1})`. Computed within window. Requires T >= 3; otherwise NULL.

Replicate volatility (same run): for replicates in one run, **within-run disagreement** = `1 - |p_hat - 0.5| * 2` (0 when all replicates agree, 1 when evenly split). Averaged across prompts, it measures how unstable an engine is right now, independent of change over time.

### 8.2 Citation volatility

For two observations *a* and *b*, cited registrable-domain sets `A`, `B`:

```
jaccard_distance(A, B) = 1 - |A ∩ B| / |A ∪ B|     (0 = identical sets; defined as 0 when both empty)
```

- **Temporal citation volatility**: mean Jaccard distance between consecutive observations (replicate 1 to replicate 1 across cycles) of the same prompt-engine.
- **Within-run citation volatility**: mean pairwise Jaccard distance among replicates of the same run.

Computed at domain level by default, URL level on request. Domain level is more stable and easier to act on.

### 8.3 Ranked-list volatility (structured rankings, SERP top 10)

Jaccard ignores order. For ordered lists (a "top 5 CRMs" answer, or SERP top 10 URLs) we use **Rank-Biased Overlap** (Webber, Moffat, Zobel 2010, ACM TOIS 28(4)) with persistence `p = 0.9` (the top 10 positions carry about 86% of the weight) and report `1 - RBO` as distance. RBO handles lists of different length and items that appear in only one list, which rank correlation coefficients (Kendall, Spearman) do not.

Implementation: the extrapolated RBO (RBO_ext) from the paper, in `packages/domain/src/stats/rbo.ts`, tested against the authors' reference examples.

### 8.4 Answer volatility

`answer_hash` equality gives exact-duplicate rate. Semantic answer change (paraphrase-insensitive) is post-MVP: MinHash over word 5-shingles with Jaccard estimate, and later embeddings if justified. We do not ship an "answer similarity" metric until it is validated against human judgments on the gold set.

## 9. Version boundaries and structural breaks

Measurement changes that can shift a series without any real-world change:

- engine model change (reported `model_reported` changes, or provider changelog)
- provider adapter or endpoint change
- prompt version change
- extractor, classifier or canonicalizer version change
- panel membership change
- location or language setting change

Rules:
1. Every series query also returns the list of boundaries in the window (from `ops.component_versions`, `ai.prompt_versions`, `ai.panel_memberships`, and distinct `model_reported` values by first-seen date).
2. Charts draw a vertical marker at each boundary.
3. Period comparisons that straddle a breaking boundary show a warning and, for extractor or classifier changes, offer "recompute old period with current extractor" (possible because raw text is retained).

## 10. SEO rank statistics

Rank tracking observations are close to deterministic for one location, device and time, but real SERPs vary across data centers, personalization is removed by the provider, and position shifts by one or two places day to day are common. Rules:

- **Rank volatility (per keyword):** standard deviation of organic rank over the last 30 checks, computed over checks where the keyword ranked. Also reported: **mean absolute daily change** `mean(|r_t - r_{t-1}|)` over consecutive pairs where both ranked. Unranked checks are counted separately as `unranked_checks`.
- **URL stability (per keyword):** share of consecutive check pairs where the ranking URL did not change. `1.0` is fully stable.
- **SERP volatility (per keyword):** `1 - RBO(top10_t, top10_{t-1}, p = 0.9)` on URLs, averaged over the window. Project-level SERP volatility is the median over keywords, which is not distorted by a few keywords whose SERPs were reshuffled.
- **Anomaly check:** a day where more than 30% of a project's keywords changed rank by more than 10 positions is flagged as a possible collection anomaly before alerts fire (see [26-testing-quality.md](26-testing-quality.md) section 9). Real algorithm updates do produce this pattern, so the flag delays alerts for manual confirmation rather than discarding data.
- **Coloring SEO deltas.** A rank change is colored (blue for improvement, vermillion for decline, per the accessible palette of doc 20 section 4.7) only when its magnitude exceeds the keyword's normal movement: `|change| > max(2, 2 x mean absolute daily change over the last 30 ranked checks)` (not computed with fewer than 10 ranked checks). Smaller moves are shown in neutral grey. Project-level SEO deltas (visibility, top-10 counts) are colored when they exceed 2 standard deviations of their own daily changes over the previous 28 days. This mirrors the "detectable change" rule for AI rates.
- **Rank changes are not tested for significance.** A rank is a single observation per check; we show the change and the keyword's volatility so a user can judge whether a 3-position move is unusual for that keyword.

## 11. What we do not claim

| We do not claim | Why |
|---|---|
| A single AI "rank" for a brand | Structured rank exists only in list-shaped answers; see 16 section 6 |
| Real-world share of AI conversations | Panel is not a sample of real conversations; no provider publishes that distribution |
| That the consumer ChatGPT a given user sees matches our observation | Personalization, memory, logged-in state, model routing, location. Our observations are logged-out, non-personalized samples via a provider |
| Causal effects of content changes on AI visibility | Observational data with many simultaneous changes; experiments (Phase 15) use before/after with a control prompt group and are labeled as such |
| AI search volume | Only modeled estimates exist; see [11-ai-prompt-system.md](11-ai-prompt-system.md) section 7 |
| Statistical significance of single-keyword rank moves | Section 10 |

## 12. References

- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. JASA 22(158).
- Brown, L. D., Cai, T. T., DasGupta, A. (2001). Interval Estimation for a Binomial Proportion. Statistical Science 16(2), 101 to 133.
- Agresti, A., Coull, B. A. (1998). Approximate is better than "exact" for interval estimation of binomial proportions. The American Statistician 52(2).
- Newcombe, R. G. (1998). Interval estimation for the difference between independent proportions: comparison of eleven methods. Statistics in Medicine 17(8).
- McNemar, Q. (1947). Note on the sampling error of the difference between correlated proportions or percentages. Psychometrika 12(2).
- Webber, W., Moffat, A., Zobel, J. (2010). A similarity measure for indefinite rankings. ACM TOIS 28(4).
- Benjamini, Y., Hochberg, Y. (1995). Controlling the false discovery rate. JRSS B 57(1).
- Efron, B., Tibshirani, R. (1993). An Introduction to the Bootstrap. Chapman and Hall (cluster bootstrap, percentile intervals).

Additional primary-source links collected during research are listed in [01-research-findings.md](01-research-findings.md) and `research/08-infra-methodology.md`.
