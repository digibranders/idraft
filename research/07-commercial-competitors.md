# 07. Commercial Competitors: Rank Tracking and AI Visibility Platforms

Research date: 2026-09-29. All URLs below were accessed on 2026-09-29 unless marked otherwise.
Purpose: study how commercial products define, compute, price and present their metrics, so our own SEO rank tracking and AI visibility platform can make better design choices. This is not a spec to copy.

## 0. Legend and method

- **VERIFIED**: the claim was read on the vendor's own page (product, pricing, help center, docs) or the study author's own page. URL given.
- **VERIFIED (3P)**: read on a named third-party page that quotes vendor documentation; not confirmed on the vendor page itself.
- **UNVERIFIED**: taken from search-result summaries, reviews or memory, not confirmed on a primary page.
- **INFERRED**: our own analysis or arithmetic on verified inputs.

Collection method: WebSearch for discovery, then WebFetch or a raw `curl` fetch of the page text. Where WebFetch summaries looked unreliable, raw page text was extracted and read directly (AWR CTR study, First Page Sage, Profound, Peec docs, Otterly help, Scrunch help, Evertune, ZipTie, Rankscale, Goodie, Writesonic, Surfer, Nightwatch, ProRankTracker, Athena, SE Ranking). Pages that failed are listed in section 11.

Vendor pricing changes often. Treat every price as a snapshot on 2026-09-29.

---

## 1. Executive summary

1. **Rank-tracker "visibility" is not one metric.** It ranges from a position-points score with no CTR at all (AWR: position 1 = 30 points down to position 30 = 1 point) to CTR x search volume models (AccuRanker, Ahrefs, SE Ranking, Semrush Share of Voice) to undisclosed proprietary CTR weightings (Semrush Visibility %). VERIFIED, see section 3.
2. **Published CTR curves disagree by roughly 3x on position 1.** Position 1 CTR in 2025 and 2026 sources: 3.6% (First Page Sage, AI answer present) to 7.6% (Ahrefs GSC, informational desktop, Dec 2023) to 20.02% (AWR, US desktop, Jul 2026) to 22.6% (First Page Sage, no AI answer) to 27.3% (AWR branded). Any traffic estimate built on a single static curve carries that uncertainty. VERIFIED numbers, INFERRED conclusion. See section 5.
3. **AI Overviews roughly halve position 1 CTR in most studies.** AWR: 20.02% to 9.69% (-52%, Jul 2026). Ahrefs: -34.5% (Mar 2025), -58% (Dec 2025). Seer: -61% organic (Sep 2025), then an 85% rebound off the Dec 2025 low by Feb 2026. Pew: 8% vs 15% of visits with a click; 1% click a source inside the AI summary. VERIFIED, section 6.
4. **AI visibility "Visibility Score" definitions are incompatible across vendors.** Peec divides by all responses; Profound's overview page divides by responses that name at least one brand (and its glossary reportedly uses all responses); Evertune weights by position with a 0.9 geometric decay; Otterly converts average position into a "Likelihood to Buy" of 10 + ((5 - avgPosition)/4) x 90. VERIFIED, section 4.3.
5. **Only one vendor publishes a sampling-error argument.** Evertune samples each prompt 100 times and publishes margins of error (for example ±44 points for one run of one prompt, ±10 points at 100 runs). Profound and Scrunch say they run daily and average; Scrunch shows the sample size in tooltips ("43% (37 of 86 responses)"). Most others publish single daily runs without uncertainty. An academic paper (Sielinski, arXiv 2603.08924) shows single-run citation rankings are unstable and many domain differences sit inside the noise floor. VERIFIED, section 4.4.
6. **Prompt volume is the least trustworthy number in the category.** Methods range from licensed double-opt-in consumer panels (Profound, Evertune, Semrush clickstream) to Google search volume used as a proxy (Ahrefs, which states plainly this is "a modeling choice, not a measured relationship") to 1 to 5 relative scores (Peec) to unexplained ML models claiming "95%+ accuracy" against platform data that no AI platform publishes (AthenaHQ). VERIFIED, section 4.5.
7. **Data collection: UI capture is the stated norm.** Ahrefs Brand Radar, Profound, Semrush and SE Visible say they capture front-end/UI responses, not APIs. Peec exposes both "UI" and "API" model channels. Scrunch uses "browser automation, official APIs and direct integrations". Evertune deliberately uses API calls to isolate model training knowledge plus consumer apps for live search. VERIFIED, section 4.6.
8. **What customers pay for** is volume units: tracked keywords x update frequency for rank tracking, and prompts x engines x frequency (often expressed as "responses", "checks" or "credits") for AI visibility. Entry AI tracking sits at about $29 to $99 per month for 15 to 50 prompts; enterprise AI visibility (Profound, Evertune Enterprise, Semrush Enterprise AIO) is quote-only. Section 8.

---

## 2. Rank trackers: product-by-product

### 2.1 Semrush Position Tracking

| Item | Finding | Status |
|---|---|---|
| Visibility % | "Visibility % is based on the click-through rate (CTR) that shows a website's progress in Google's top 100 for keywords from the current tracking campaign." 100% means position 1 for every tracked keyword. Exact CTR table not published. | VERIFIED https://www.semrush.com/kb/697-what-is-visibility |
| Landscape definition | A second KB page describes Visibility as "a metric based on the average position of the domain's ranking pages". This conflicts in wording with the CTR-based definition above. | VERIFIED https://www.semrush.com/kb/923-position-tracking-landscape |
| Average position | "For any keyword where you aren't ranking, it will be calculated as a ranking of 100." | VERIFIED https://www.semrush.com/kb/923-position-tracking-landscape |
| Estimated traffic | Daily estimate: CTR at position x keyword volume / 30. | VERIFIED (via search snippet of Semrush KB and news page) https://www.semrush.com/news/256143-position-tracking-tool-estimated-traffic/ ; daily nature VERIFIED at https://www.semrush.com/kb/1191-track-your-rankings |
| Share of Voice | Takes position plus each keyword's search volume and estimated traffic, unlike Visibility %. Exact formula not published. Business/Advanced tier only. | VERIFIED https://www.semrush.com/news/271711-measure-share-of-voice-with-semrush-position-tracking/ |
| AI Overview tracking | When the domain is cited in an AI Overview, Position Tracking records it as a #1 ranking, regardless of organic position. A toggle includes or excludes AIO rankings. | VERIFIED https://www.semrush.com/kb/1435-ai-overview |
| AI Mode tracking | Available with the AI SEO toolkit subscription. | VERIFIED https://www.semrush.com/kb/1191-track-your-rankings |
| Update frequency | Daily; desktop, mobile, tablet; city-level targeting. | VERIFIED https://www.semrush.com/kb/1191-track-your-rankings |
| Pricing | SEO $139/mo (500 tracked keywords); Semrush One Starter $199 (500 kw + 50 AI prompts daily); Pro+ $299 (1,500 kw + 100 prompts); Advanced $549 (5,000 kw + 200 prompts, SEO share of voice, API). Annual about 16% less. | VERIFIED https://www.semrush.com/prices/ |

Design note (INFERRED): counting an AIO citation as "position 1" merges two different events (organic rank and citation inside an answer) into one number. It inflates average position and Visibility % when the toggle is on.

### 2.2 Ahrefs Rank Tracker

| Item | Finding | Status |
|---|---|---|
| Share of Voice formula | "Total clicks your target receives from all Tracked keywords / Total clicks going to all result in the SERP receives for all Tracked keywords". Worked example: 5,000 SERP clicks for "coffee beans" (ZA); position 1 gets 1,500 clicks = 30%, position 2 930 = 18.6%, position 3 860 = 17.2%, position 4 450 = 9%, position 5 200 = 4%. | VERIFIED https://help.ahrefs.com/en/articles/2072381-what-is-share-of-voice-sov-and-how-is-it-calculated |
| Other metrics | Share of Traffic Value, average position, position distribution buckets (1 to 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100). | VERIFIED https://ahrefs.com/rank-tracker |
| SERP features | 19 features including AI Overview; filter "Include target in > AI Overview". | VERIFIED https://ahrefs.com/rank-tracker |
| Update frequency | Weekly on Lite, Standard, Advanced, Enterprise per pricing table. Daily via add-on reported by third parties. | Weekly VERIFIED https://ahrefs.com/pricing ; daily add-on UNVERIFIED |
| Pricing | Lite $129 (750 kw, 5 AI prompts), Standard $249 (2,000 kw, 10 prompts), Advanced $449 (5,000 kw, 20 prompts), Enterprise from $1,499 (10,000+ kw). | VERIFIED https://ahrefs.com/pricing |

Design note (INFERRED): the Ahrefs example implies a SERP-specific click model (clicks sum to 5,000 across results), not a single global curve, but the help page does not say where per-result click estimates come from.

### 2.3 AccuRanker

| Item | Finding | Status |
|---|---|---|
| Share of Voice | Keywords ranking 1 to 20 only. "The average CTR for the position is multiplied by the search volume of each keyword." | VERIFIED https://www.accuranker.com/help/overview/share-of-voice/ |
| CTR models | Static CTR: rank 1 about 31.2%, rank 2 about 16%, and so on. Dynamic "AI CTR": ML model with "more than 120 factors, including pixel position on the page, SERP features, and ads". Two volume sources: AccuRanker's own or Google Keyword Planner. So 4 combinations. | VERIFIED https://www.accuranker.com/blog/share-of-voice-update/ |
| AI Overview metrics | API history endpoints expose `keywords_with_ai_overview` and `keywords_with_ai_overview_owned`. | VERIFIED (search snippet of changelog) https://www.accuranker.com/changelog/newfunctionality/ |
| AccuLLM | Engines: ChatGPT, Perplexity, AI Overview, AI Mode. Metrics: Visibility (average, based on how many times brand and domain are mentioned), Sentiment 0 to 100, Rank (average), Sources, "Top Proximity Score" (earlier mention scores higher), share of citations, share of brand mentions, web search rate. No collection method or frequency disclosed. | VERIFIED https://www.accuranker.com/help/getting-started/accullm/ |
| Pricing | Professional $224/mo (2,000 to 5,000 kw options), Expert $764/mo (10,000 to 25,000 kw; includes AI CTR and AI Search Volume), Enterprise custom. Daily updates on all. 10% annual discount. | VERIFIED https://www.accuranker.com/pricing/ |

### 2.4 SE Ranking

| Item | Finding | Status |
|---|---|---|
| Search visibility | S = F x A x 100%, F = search volume, A = position factor: top 3 = 1; 4th = 0.85; 5th = 0.60; 6 to 7 = 0.50; 8 to 9 = 0.30; 10th = 0.2; 11+ = 0. Single keyword: S = A x 100%. | VERIFIED https://seranking.com/blog/metrics-in-se-ranking/ |
| Traffic forecast | T = F x R x I1 x I2. I1 engine factor: Google 1, Yahoo 0.3, Bing 0.3. I2 CTR by position: 1: 32.50%, 2: 17.60%, 3: 11.40%, 4: 8.10%, 5: 6.10%, 6: 4.40%, 7: 3.50%, 8: 3.10%, 9: 2.60%, 10: 2.40%. | VERIFIED https://seranking.com/blog/metrics-in-se-ranking/ |
| CTR curve vintage | These I2 values match the widely cited 2013 Chitika curve. Separately SE Ranking says it uses ML and SERP-feature-aware CTR. The two statements are not reconciled on the page. | INFERRED (match to Chitika from memory) |
| AI Results Tracker | Mention presence = share of tracked prompts where the brand is mentioned. Link presence = share of prompts where the LLM gave sources and the site was among them. "Top 3 presence" = mention or link in the top 3 positions. Changes shown in percentage points vs first day of period. | VERIFIED https://seranking.com/blog/metrics-in-se-ranking/ |
| Pricing | Core $129/mo (2,000 kw daily), Growth $279 (5,000 kw), Enterprise custom. AI Search add-on $89/mo ($71.20 annual), 200 to 1,000 prompts by tier, engines AI Overviews, AI Mode, Perplexity, ChatGPT. | VERIFIED https://seranking.com/pricing.html |
| SE Visible (separate product) | Basic $99 (200 prompts, 3 projects), Core $189 (450), Plus $355 (1,000). 5 engines: ChatGPT, Gemini, AI Mode, Perplexity, AI Overview. Daily refresh. Collects "real AI responses using a browser and graphical user interface, not simulated answers or API-based results". | VERIFIED https://visible.seranking.com/ |

### 2.5 Advanced Web Ranking (AWR)

| Item | Finding | Status |
|---|---|---|
| Visibility Score | Position 1 = 30 points, 2 = 29, ... 30 = 1; below 30 = 0. Summed across search engines. Example: pos 1 (30) + pos 10 (21) + pos 32 (0) = 51. | VERIFIED https://www.advancedwebranking.com/help/visibility-score |
| Visibility Percentage | vis. score / (30 x no. of search engines x no. of keywords). | VERIFIED https://www.advancedwebranking.com/help/visibility-percentage |
| Click Share | Combines positions, search demand and click likelihood. Calculated from the last 6 months of AWR's own Organic CTR Study (Desktop International), either averaged for top 20 URLs or weighted by SERP feature presence (user setting). Total Click Share covers the full keyword set, not only top 20. | VERIFIED https://www.advancedwebranking.com/help/achieve-complete-seo-reporting-with-visibility-score-click-share-and-market-share ; CTR source VERIFIED (3P summary of AWR help) https://www.advancedwebranking.com/help/click-share-vs-total-click-share-score |
| Estimated Visits | Click Share x Google Ads search volume, per keyword per engine; group = sum. | VERIFIED https://www.advancedwebranking.com/help/estimated-visits |
| Market Share | Your estimated visits / total estimated visits of all competitors in the project. | VERIFIED https://www.advancedwebranking.com/help/achieve-complete-seo-reporting-with-visibility-score-click-share-and-market-share |
| Pricing unit | "one query made weekly for one search engine, for one device with a search depth of 5 pages (or 50 results)". Daily uses 7x units, bi-weekly 0.5x, monthly 0.25x, on-demand pauses. Pro $139/mo (7,000 weekly units), Agency $279 (14,500), Enterprise $699 (35,500), Ent Plus 50k $980. | VERIFIED https://www.advancedwebranking.com/pricing |
| AI visibility | "AI Visibility tracking" listed on pricing; engines and prompt limits not detailed on that page. | VERIFIED (existence only) https://www.advancedwebranking.com/pricing |

AWR is the only vendor that publishes both its CTR data (section 5.1) and the fact that its Click Share metric is driven by that data. That link between research and product is a pattern worth following.

### 2.6 Wincher

| Item | Finding | Status |
|---|---|---|
| Tiers | Three tiers from 500, 1,000 and 5,000 keywords; daily updates on all; on-demand updates on tiers 2 and 3; Share of Voice on tiers 2 and 3 only; SERP features on all; local rank tracker with weekly updates and credits (€10 per 500 extra). Prices not rendered in page source. | VERIFIED https://www.wincher.com/pricing |
| Price | Basic about €49/mo for 500 keywords. | UNVERIFIED (review sites) |

### 2.7 ProRankTracker

| Item | Finding | Status |
|---|---|---|
| Billing unit | "Terms". Organic: 1 keyword + URL + engine/location/device = 1 Term. AI tracking (AIO, AI Mode, LLMs): 1 prompt + URL + platform/location = 2 Terms. Same prompt on multiple platforms counts separately. | VERIFIED https://proranktracker.com/plans_and_pricing |
| Pricing | Starter $99 (1,000 Terms = 1,000 kw or 500 AI prompts), Pro $149 (2,000 Terms), Agency from $199 (3,000 Terms) up to $1,039 (20,000 Terms). Annual about 10% off. Daily top-100 updates. | VERIFIED https://proranktracker.com/plans_and_pricing ; https://proranktracker.com/ai_plans_and_pricing |
| AI engines | ChatGPT, Gemini, Copilot, Perplexity, AI Overviews, AI Mode ("6 AI Platforms"). | VERIFIED https://proranktracker.com/ai_plans_and_pricing |

Pricing insight (INFERRED): ProRankTracker prices one AI prompt check at exactly 2x one organic keyword check. That is a useful public anchor for our own unit economics.

### 2.8 Nightwatch

| Plan | Price (monthly, EUR) | Keywords | AI prompts (daily) | AI answers/mo | Sites | Competitors/site |
|---|---|---|---|---|---|---|
| Starter | €79 | 500 | 50 | 1,500 | 5 | 5 |
| Professional | €159 | 2,500 | 150 | 4,500 | 25 | 10 |
| Agency | €399 | 7,500 | 500 | 15,000 | 100 | 15 |
| Enterprise | Custom | 20,000+ | Unlimited | Unlimited | Unlimited | Unlimited |

AI platforms on every plan: ChatGPT, Claude, Gemini, Perplexity, AI Mode, AI Overview. Engines: Google, YouTube, Bing, Yahoo, DuckDuckGo, Google Maps. Unlimited seats, 3-year SERP archive, 107,000+ locations. VERIFIED https://nightwatch.io/pricing/ (table parsed from raw page text; column mapping INFERRED from label order).

INFERRED: AI answers/mo = prompts x 30, so Nightwatch collects about one answer per prompt per day, not one per engine. Either engines are sampled or rotated, or the "answers" figure is per engine. The page does not say.

### 2.9 Rank tracker comparison table

| Tool | Entry price | Keywords at entry | Default refresh | Visibility / SoV method | CTR source | AIO handling | Status |
|---|---|---|---|---|---|---|---|
| Semrush PT | $139/mo | 500 | Daily | Visibility % (CTR-based, undisclosed); SoV (volume + traffic, undisclosed) | Proprietary | Cited in AIO = position 1 (toggle) | VERIFIED |
| Ahrefs RT | $129/mo | 750 | Weekly | SoV = your clicks / all clicks | Not disclosed | 19 SERP features incl. AIO | VERIFIED |
| AccuRanker | $224/mo | 2,000 | Daily | SoV = CTR x volume, top 20 | Static (31.2%, 16%, ...) or ML dynamic | AIO count and owned count | VERIFIED |
| SE Ranking | $129/mo | 2,000 | Daily | S = F x A (step weights) | 32.5% ... 2.4% table (2013-era values) | AI Results Tracker add-on | VERIFIED |
| AWR | $139/mo | 7,000 weekly (1,000 daily) | Weekly default | 30-point score; Click Share; Market Share | Own CTR study, last 6 months | SERP features weighted CTR option | VERIFIED |
| Wincher | ~€49/mo | 500 | Daily | SoV (tiers 2+) | Not disclosed | SERP features | Tiers VERIFIED, price UNVERIFIED |
| ProRankTracker | $99/mo | 1,000 Terms | Daily | Not reviewed | Not disclosed | AIO + AI Mode + LLMs at 2 Terms each | VERIFIED |
| Nightwatch | €79/mo | 500 | Daily + on demand | Not reviewed | Not disclosed | 6 AI platforms bundled | VERIFIED |

---

## 3. Rank tracker formulas, side by side

| Vendor | Metric | Formula | Status |
|---|---|---|---|
| AWR | Visibility Score | sum over keywords and engines of max(0, 31 - position) for position <= 30 | VERIFIED |
| AWR | Visibility % | VisibilityScore / (30 x engines x keywords) | VERIFIED |
| AWR | Estimated Visits | ClickShare(kw) x GoogleAdsVolume(kw) | VERIFIED |
| AWR | Market Share | yourEstimatedVisits / sum(competitors' estimated visits in project) | VERIFIED |
| SE Ranking | Search visibility | F x A x 100%, A in {1, 0.85, 0.60, 0.50, 0.30, 0.2, 0} | VERIFIED |
| SE Ranking | Traffic forecast | F x R x I1 x I2 (I2 = 32.5% ... 2.4%) | VERIFIED |
| AccuRanker | Share of Voice | sum over kw ranking 1 to 20 of CTR(pos) x volume(kw) | VERIFIED |
| Ahrefs | Share of Voice | sum(your clicks) / sum(clicks to all results) over tracked keywords | VERIFIED |
| Semrush | Estimated traffic (daily) | CTR(pos) x volume / 30 | VERIFIED (snippet) |
| Semrush | Visibility % | CTR-based, 100% = #1 for all keywords, weights undisclosed | VERIFIED (definition), formula not public |
| Semrush | Average position | mean position, unranked counted as 100 | VERIFIED |

---

## 4. AI visibility platforms

### 4.1 Product-by-product

#### Semrush AI Visibility Toolkit, Semrush One, Enterprise AIO

| Item | Finding | Status |
|---|---|---|
| Standalone toolkit | $99/mo per domain (billed annually), 25 custom prompts with daily AI rankings, 1 domain for Brand Performance, 300 reports/day. Engines: ChatGPT, Google AI, Gemini, Perplexity. "Daily, weekly, and monthly data updates". | VERIFIED https://www.semrush.com/pricing/ai/ |
| Bundles | Semrush One Starter 50 prompts daily, Pro+ 100, Advanced 200. | VERIFIED https://www.semrush.com/prices/ |
| Extra prompts | About $60/mo per 50 extra; extra domain $99. | UNVERIFIED (reviews) |
| Metrics | AI Visibility: "A benchmark score (0 to 100) showing how often your brand appears in AI-generated answers compared to competitors" (formula not published). Mentions: "total number of prompts in which a brand is included". Citations: "number of AI responses that cite your domain". Share of Voice: "Percentage of mentions your brand receives ... compared to competitors". Sentiment: "balance of positive and general sentiment". Monthly Audience: "estimate of the total query audience across all topics where your brand appears". Average Position: where a citation of your domain appears (first citation, second citation). | VERIFIED https://www.semrush.com/kb/1594-ai-seo-metrics |
| Data | "over 317 million prompts and responses on ChatGPT, Gemini, Google AI Overviews, and AI Mode". "Prompt responses are captured from real requests and not via any APIs of LLMs." Prompts derived from "billions of real prompts from AI search clickstream data and Google's keyword dataset". 117 regional databases. | VERIFIED https://www.semrush.com/kb/1607-semrush-ai-visibility-data |
| Refresh | Prompt Analysis daily rolling; Brand Performance weekly; Prompt Tracking daily. | VERIFIED https://www.semrush.com/kb/1607-semrush-ai-visibility-data |
| Volume method | "topic-level volume" by grouping semantically related prompts; "third-party data on real AI interactions with Semrush's machine learning models". | VERIFIED https://www.semrush.com/kb/1607-semrush-ai-visibility-data |
| Stated limitation | "no platform can provide exact numbers on visibility"; metrics are "reliable directional signals". | VERIFIED https://www.semrush.com/kb/1607-semrush-ai-visibility-data |
| Enterprise AIO | Quote-only. 261M+ prompt database. Engines listed: ChatGPT, AI Overviews, AI Mode, Perplexity, Copilot, Grok, Gemini, Claude, DeepSeek. Forecasting. Query Fan-Out Analysis launched 2026-01-15: reveals the Google queries behind AI answers, the domains ranking for them, and where the brand is missing. | VERIFIED (search snippets of Semrush Enterprise pages) https://www.semrush.com/lp/enterprise-aio/en/ ; fan-out VERIFIED (snippet) https://www.semrush.com/news/442193-query-fan-out-analysis-comes-to-semrush-enterprise-ai-optimization-revealing-the-search-signals-behind-ai-responses/ |

Inconsistency (INFERRED): Semrush quotes 317M prompts on the KB page and 261M+ on Enterprise marketing. Different datasets or different dates; not explained.

#### Ahrefs Brand Radar

| Item | Finding | Status |
|---|---|---|
| Dataset | Product page: "448M+" monthly prompts; AIO 313.2M, Gemini 30.8M, ChatGPT 30.7M, Perplexity 30.7M, Copilot 30.4M; AI Mode 12.7M; Claude listed. Pricing page: "475M+ organic prompts". Methodology blog: ChatGPT 14.5M, Perplexity 14.6M, Gemini 14.6M, Copilot 13.3M, AIO 282M, AI Mode 24M, Grok 13M. | VERIFIED https://ahrefs.com/brand-radar ; https://ahrefs.com/pricing ; https://ahrefs.com/blog/brand-radar-methodology/ |
| Prompt generation | Seeded from Ahrefs' keyword database ("28.7 billion keywords tracked with positive search volume") and Google People Also Ask; expanded by PAA (behavioral) and fan-out (semantic) systems. | VERIFIED https://ahrefs.com/blog/brand-radar-methodology/ |
| Collection | "All prompts run through the free, publicly available web interfaces", not APIs. Locale mix mirrors keyword database country and language ratios; strongest in English. | VERIFIED https://ahrefs.com/blog/brand-radar-methodology/ |
| Refresh | ChatGPT, Perplexity, Gemini, Copilot: monthly with a 90-day reporting window. AIO and AI Mode: continuous with keyword database refresh. Custom prompts: daily. | VERIFIED https://ahrefs.com/blog/brand-radar-methodology/ ; https://ahrefs.com/pricing |
| Mentions | One mention per response if the brand appears at least once. | VERIFIED https://help.ahrefs.com/en/articles/15501968-ai-visibility-metrics |
| Citations | One citation per domain per response if at least one page is cited. "Found in" = cited plus retrieved but not cited. | VERIFIED same URL |
| Impressions | "summing up search volumes (based on Google) of prompts where your brand appears"; prompt volume = highest-volume keyword whose SERP shows the prompt in PAA. | VERIFIED same URL |
| AI Share of Voice | Brand's share of impressions vs other tracked brands; across platforms a weighted average where platforms with more impressions weigh more. | VERIFIED same URL |
| Honesty statement | "This is a modeling choice, not a measured relationship: we don't claim a validated link between Google search volume and how often a query is asked inside an AI tool." Hallucinated or malformed links are kept. | VERIFIED https://ahrefs.com/blog/brand-radar-methodology/ |
| Pricing | Brand Radar AI from $199/mo. Custom prompt packages: $50 (2,500 checks/mo), $100 (7,000), $250 (25,000). "Tracking one prompt on one platform in one location uses 1 check." Base plans include 150 to 600 checks (5 to 20 prompts). | VERIFIED https://ahrefs.com/pricing |

#### Profound

| Item | Finding | Status |
|---|---|---|
| Pricing | Trial: free, 50 prompts daily for 7 days, ChatGPT, Gemini, AI Overviews, 1 language, 1 region, no history or export. Enterprise: custom; "Up to 9 Answer Engines": ChatGPT, Perplexity, AI Mode, Gemini, Copilot, DeepSeek, Claude, AI Overviews, Exa Search. No published mid tiers on 2026-09-29. | VERIFIED https://www.tryprofound.com/pricing |
| Earlier tiers | Starter $99 and Growth $399 existed in 2025. | UNVERIFIED (review sites) |
| Collection | "We query the front-end experiences that normal users see ... rather than API calls". | VERIFIED https://www.tryprofound.com/features/answer-engine-insights |
| Repeated runs | "AI platforms don't return the same answer twice. We run every tracked prompt daily so your visibility score reflects your true average across all responses." | VERIFIED same URL |
| Visibility score | "the number of responses that include your brand divided by the total number of responses that include at least one brand". | VERIFIED https://help.tryprofound.com/articles/3443229936-answer-engine-insights-overview |
| Share of Voice | "the number of responses that mention your brand divided by the total number of brand mentions across all responses" (numerator and denominator are different units). | VERIFIED same URL |
| Average Position | 1 = typically first brand mentioned; described as aggregating indicators "such as Share of Voice, into a ranked score". | VERIFIED same URL |
| Glossary conflict | Profound's glossary reportedly uses all tracked responses as the denominator (50 of 100 = 50%). | VERIFIED (3P) https://authoritytech.io/blog/brand-free-response-rate-ai-visibility-denominator-2026 |
| Prompt Volumes | Licensed "multiple, double-opt-in consumer panels"; "hundreds of millions of prompts per month from millions of active users"; statistical panel projection corrects demographic, geographic and churn bias; weekly refresh with under one week latency; US, UK, CA, DE, FR and more; ChatGPT, Gemini, Claude, Perplexity. | VERIFIED https://www.tryprofound.com/features/prompt-volumes ; https://www.tryprofound.com/blog/prompt-volumes-general-availability |
| Conversation Explorer | Search of the underlying conversations behind volume numbers. | UNVERIFIED (3P descriptions) |
| Agent Analytics | Server or CDN log ingestion (Akamai, AWS, Cloudflare, Fastly, GCP, Netlify, Vercel, WordPress, GA); bot identity verified against published IP ranges; AI crawler visits plus human referrals from AI. | Integrations VERIFIED https://www.tryprofound.com/pricing ; IP verification VERIFIED (snippet) https://docs.tryprofound.com/agent-analytics/overview |
| Other | FactCheck (claims AI makes vs sources responsible); ChatGPT Shopping; AI Marketer agents. | VERIFIED https://help.tryprofound.com/articles/3443229936-answer-engine-insights-overview ; https://www.tryprofound.com/pricing |

#### Peec AI

| Item | Finding | Status |
|---|---|---|
| Tiers | Starter 50 prompts, Pro 150, Advanced 350 (multi-country, Looker Studio), Enterprise custom (up to 13 models, daily or weekly). "Choose 3 models" on self-serve. Daily. Unlimited users. "Monthly AI answers" = prompts x active models x frequency. | VERIFIED https://peec.ai/pricing |
| Prices | Starter $95 monthly ($80 annual), Pro $245 ($205), Advanced $495 ($420). Page renders prices in JavaScript; not visible in fetched source. | UNVERIFIED (review sites) |
| Visibility | (responses mentioning brand / total responses) x 100. | VERIFIED https://docs.peec.ai/metrics/brand-metrics/visibility |
| Share of Voice | (times your brand was mentioned / total brand mentions) x 100. Example: 4 mentions vs competitor 12 = 25%. | VERIFIED https://docs.peec.ai/metrics/brand-metrics/share-of-voice |
| Position | Average rank among all brands detected in responses where the brand appears, including untracked brands. | VERIFIED https://docs.peec.ai/metrics/brand-metrics/position |
| Sentiment | 0 to 100; "Most sentiment scores fall between 65 and 85". Based on positive and negative indicator language. | VERIFIED https://docs.peec.ai/metrics/brand-metrics/sentiment |
| Source metrics | Retrievals, Retrieved %, Retrieval rate, Citation rate, Total citations, Citations share (per domain and URL). Distinguishes sources (all URLs accessed) from citations (inline references). | VERIFIED https://docs.peec.ai/metrics-overview.md ; https://docs.peec.ai/understanding-chats.md |
| Prompt volume | 1 to 5 relative score "based on real-time search trends, AI conversation data, and industry signals". | VERIFIED https://docs.peec.ai/metrics-overview.md |
| Collection | "Model channels" such as "ChatGPT UI", "Perplexity API", "Google AI Overview": both UI and API surfaces exist and are labelled. | VERIFIED https://docs.peec.ai/api/model-channels.md |
| Fan-out | API endpoints list fan-out search queries and fan-out shopping queries per project; each chat shows fan-outs. | VERIFIED https://docs.peec.ai/llms.txt ; https://docs.peec.ai/understanding-chats.md |
| Opportunity | Gap Analysis: sources that cite competitors but not you, with Gap Score; source classification (competitor, editorial, reference, UGC); Recommended actions; Objections; Fact-checking; Ads library. | VERIFIED https://docs.peec.ai/understanding-sources.md ; https://peec.ai/pricing |
| Limitation stated | "AI models only see HTML content. They can't read behind paywalls or load JavaScript-dependent content." | VERIFIED https://docs.peec.ai/understanding-sources.md |

#### Otterly.AI

| Item | Finding | Status |
|---|---|---|
| Tiers | Lite 15 prompts, Standard 100, Premium 400; Enterprise custom. Base engines on all: AI Overviews, ChatGPT, Perplexity, Copilot. AI Mode, Gemini, Claude are paid add-ons. Daily tracking. 65+ countries. Extra prompts in batches of 100. API 2,000 or 5,000 requests/mo; Agent Analytics 200k or 1M events/mo. | VERIFIED https://help.otterly.ai/pricing-of-otterlyai |
| Prices | Lite $29, Standard $189, Premium $489. | UNVERIFIED (reviews; pricing page returned HTTP 202 with no body) |
| Brand mentions | Sum over day x prompt x engine of 1/0 (multiple mentions in one answer count once; brand variants count once). | VERIFIED https://help.otterly.ai/brand-report-kpi-definition |
| Share of Voice | my brand mentions / all brand mentions x 100; aggregates by summing numerators and denominators across days and engines. | VERIFIED same URL |
| Avg. brand position | sum of positions / number of prompts where brand appeared. | VERIFIED same URL |
| Brand coverage | prompts mentioning brand / all prompts. AIO special case: executions where AIO did not trigger are excluded from the denominator. | VERIFIED same URL |
| Sentiment | Net Sentiment Score = (positive - negative) / total mentions x 100, range -100 to +100. | VERIFIED same URL |
| Domain coverage | prompts citing domain / all prompts (same AIO exclusion). | VERIFIED same URL |
| Brand Visibility Index | x axis Brand Coverage; y axis Likelihood to Buy = 10 + ((5 - avgPosition) / 4) x 90 with a 10% floor (pos 1 = 100%, pos 2 = 77.5%, pos 3 = 55%, pos 4 = 32.5%, pos 5 = 10%). Quadrants: Leaders, Niche, Low Conversion, Low Performance. | VERIFIED https://help.otterly.ai/brand-report-kpi-definition ; https://help.otterly.ai/brand-visibility-index |

#### Scrunch

| Item | Finding | Status |
|---|---|---|
| Pricing | Core $250/mo: 125 unique prompts, 5,000 responses/month, 4 LLMs (ChatGPT, Perplexity, AIO, Copilot), 1 country, 1 persona, 5 competitors, query fan-out "Limited". Enterprise custom: 9 LLMs (adds Claude, Gemini, Meta AI, AI Mode, Grok), AXP (Agent Experience Platform), API. | VERIFIED https://scrunch.com/pricing |
| Brand Presence (Mentions Rate) | (present observations / total observations) x 100; domain citations do not count as presence. | VERIFIED https://helpcenter.scrunchai.com/en/articles/13566677-scrunch-metrics-guide |
| Position | Top (top 25% of the response text), Middle (middle 50%), Bottom (bottom 25%), Missing; percentages only among responses where the brand is present. | VERIFIED same URL |
| Sentiment | Positive, Mixed, Negative, Missing; only responses where the brand is present. | VERIFIED same URL |
| Citations Rate | brand citation observations / total observations x 100; each citation URL classified Brand, Competitor or Other. | VERIFIED same URL |
| Sample size shown | "Rate and average charts in Explorer also show the underlying sample size in the tooltip, for example '43% (37 of 86 responses)'." | VERIFIED same URL |
| Collection | "a mix of browser automation, official APIs and direct integrations"; Grok no longer contributes citation data. | Mix VERIFIED (snippet) https://scrunch.com/blog/ai-search-monitoring-questions-answered ; Grok note VERIFIED metrics guide |

#### ZipTie (ziptie.dev / ziptie.ai)

| Item | Finding | Status |
|---|---|---|
| Pricing model | Usage-based builder: prompt slots x engines x cadence (daily, weekly, monthly pools). Presets: Starter from $42.75/mo, Professional from $659.59, Enterprise from $3,137.09. UGC Impact Analysis +80%. Content Generation +$20/mo per context. API and MCP +$10/mo. Annual -20%. | VERIFIED https://ziptie.dev/pricing |
| Engines | ChatGPT, AI Overviews, Perplexity, AI Mode, Copilot, Bing AI Overview, Gemini. AIO and Bing AIO checks also capture top-10 organic results at no extra cost. | VERIFIED same URL |
| Slot rule | A prompt checked in the current window holds its slot until reset, even if paused or deleted. | VERIFIED same URL |
| AI Success Score | Composite of brand mentions, sentiment and website citations (and placement per some reviews); weights not published. | UNVERIFIED (ZipTie blog snippets and reviews) https://ziptie.dev/blog/ziptie-main-features/ |

#### AthenaHQ

| Item | Finding | Status |
|---|---|---|
| Pricing | Free with $25 credit (300 credits); Starter $295/mo, 3,600 credits; "1 credit = 1 AI response"; 11 models (ChatGPT, Perplexity, AIO, AI Mode, Gemini, Claude, Copilot, Grok, DeepSeek, Meta AI, Mistral). Enterprise custom. API is a paid add-on. | VERIFIED https://www.athenahq.ai/pricing |
| Prompt volume (QVEM) | "Numerical" prompt volume per plan. QVEM claims "95%+ accuracy rate when validated against actual platform data", forecasts "85% accuracy", "50+ sources", no named data source. | VERIFIED https://athenahq.ai/articles/generative-ai-search-query-volume-estimation-model |

#### Evertune

| Item | Finding | Status |
|---|---|---|
| Pricing | Pro $800/mo: "100,000 prompts tracked across 11 AI models", daily, weekly or monthly, global, 25 AI-optimized articles/mo, AI retargeting. Enterprise custom (bot analytics, SSO). | VERIFIED https://www.evertune.ai/pricing |
| Sampling | Samples each prompt 100 times. Published example: 100 unique prompts asked once = 29% visibility, ±9 points overall, ±31 points per topic; asked 100 times = ±1 point overall, ±2 per topic. One prompt: asked once "±44 points", 25 times 36% ±20, 100 times about 48% ±10. | VERIFIED https://www.evertune.ai/platform/methodology |
| Prompt source | EverPanel: "over 150 million real conversations", weighted "to reflect the actual composition of the internet"; "over 80% of AI questions are phrased uniquely", so prompts are grouped by intent and topic. | VERIFIED same URL |
| API plus app | "Through direct API access, Evertune isolates the model's foundational knowledge" and separately measures live consumer apps; the gap diagnoses SEO/content vs brand-building problems. | VERIFIED same URL |
| AI Brand Score | 0 to 100; position weights 1st 100%, 2nd 90%, 3rd 81%, each next 90% of previous; brand names excluded from prompts (unaided). Score 100 = first position in 100% of responses. Engines: ChatGPT, Gemini, Claude, Perplexity, Copilot, DeepSeek, Meta, AIO, AI Mode. | VERIFIED https://www.evertune.ai/resources/insights-on-ai/what-is-ai-brand-score |

#### Rankscale

| Item | Finding | Status |
|---|---|---|
| Pricing | Pro $99/mo (1,200 credits, up to 4,800 answers, 10 dashboards), Growth $385 (5,500 credits, 22,000 answers, REST API, white label), Enterprise $780 (12,000 credits, 48,000 answers). About 0.25 credit per engine query. Credit rollover 2x to 3x. Scheduling hourly to monthly. Engines: ChatGPT, Perplexity, AI Mode, AIO, Gemini, DeepSeek, Mistral, Claude, Grok, Copilot. | VERIFIED https://rankscale.ai/pricing |
| Guidance | "Visibility scores are probabilistic. A single-digit shift without a status change is noise." "Detection takes 2 to 4 weeks to settle once tracking starts." | VERIFIED https://rankscale.ai/resources/modules/diagnose/how-to-read-your-rankscale-dashboard |

#### Goodie (higoodie.com)

Core $399/mo: 5 models, 120 prompts, 2 countries, daily, 50 optimizations/mo, revenue attribution. Pro $999/mo: 8 models, 250 prompts, 5 countries, SKU-level agentic commerce. Enterprise: up to 13 models (adds Claude, Meta, DeepSeek, Grok, Alexa+). Agency Growth $275/mo. Integrations GA, GSC, Bing Webmaster, Vercel, WordPress, Cloudflare, CloudFront. VERIFIED https://higoodie.com/pricing

#### Writesonic (GEO)

Starter $79/mo annual (50 prompts, 50 answers daily, ChatGPT, Gemini, AIO), Basic $199 (100 prompts, 300 answers daily), Growth $399 (200 prompts, 600 answers daily, sentiment, Action Center trial), Enterprise custom (all 10 platforms, "AI search volume and trend insights", Prompt Explorer). VERIFIED https://writesonic.com/pricing

INFERRED: "50 prompts, 50 answers" on Starter means one engine answer per prompt per day across three listed engines, while Basic's 300 answers for 100 prompts is 3 engines. The Starter tier likely rotates engines.

#### Surfer (AI Tracker)

AI Search Analytics $82/mo annual: 50 prompts refreshed daily, mention gap, brand sentiment, 5 brand spaces. Standard $99: 25 prompts weekly. Pro $182: 50 daily. Peace of Mind $299: 100 daily, API. Engines named: ChatGPT, Gemini, AI Overviews "and other AI models". VERIFIED https://surferseo.com/pricing/

#### Others found (not deeply reviewed)

seoClarity Clarity ArcAI (UI scraping advocate, AI bot activity, hallucination monitoring), Conductor, BrightEdge, Similarweb AI, Search Atlas, LLM Pulse, Trakkr, PromptWatch (per-response score = position + context - competitor weight, means with absences as 0, per QueryBurst). QueryBurst explicitly refuses to publish a single AI visibility score. UNVERIFIED beyond the cited pages: https://www.seoclarity.net/blog/scraping-vs.-api ; https://queryburst.com/ai-visibility/prompt-tracker-scores/

### 4.2 AI visibility pricing and coverage table

| Tool | Entry paid price | Prompts at entry | Engines at entry | Refresh | Unit | Collection | Status |
|---|---|---|---|---|---|---|---|
| Semrush AI Visibility | $99/mo per domain (annual) | 25 | ChatGPT, Google AI, Gemini, Perplexity | Daily tracking, weekly brand perf | Prompts per domain | Real requests, not APIs | VERIFIED |
| Ahrefs Brand Radar | $199/mo; prompts from $50 | 83/day (index) or 2,500 checks | AIO, AI Mode, ChatGPT, Gemini, Perplexity, Copilot, Claude, Grok | Monthly (chatbots), continuous (Google), daily (custom) | Checks = prompt x platform x location | Public web UIs | VERIFIED |
| Profound | Trial free; Enterprise custom | 50 (trial) | 3 (trial), up to 9 | Daily | Prompts | Front end | VERIFIED |
| Peec AI | ~$95/mo | 50 | Choose 3 | Daily | prompts x models x days | UI and API channels | Limits VERIFIED, price UNVERIFIED |
| Otterly | ~$29/mo | 15 | 4 base + add-ons | Daily | Prompts | Not disclosed | Limits VERIFIED, price UNVERIFIED |
| Scrunch | $250/mo | 125 (5,000 responses) | 4 | Not stated (responses cap) | Responses | Browser, APIs, integrations | VERIFIED |
| ZipTie | from $42.75/mo | configurable | up to 7 | Daily, weekly, monthly pools | Prompt slots x engines x cadence | Not disclosed | VERIFIED |
| AthenaHQ | $295/mo | 3,600 responses | 11 | Not stated | Credits (1 = 1 response) | Not disclosed | VERIFIED |
| Evertune | $800/mo | "100,000 prompts" | 11 | Daily, weekly, monthly | Prompts (x100 samples) | API + consumer apps | VERIFIED |
| Rankscale | $99/mo | up to 4,800 answers | 10+ | Hourly to monthly | Credits (0.25 per query) | Not disclosed | VERIFIED |
| Goodie | $399/mo | 120 | 5 | Daily | Prompts | Not disclosed | VERIFIED |
| Writesonic | $79/mo (annual) | 50 | 3 | Daily | Prompts, answers | Not disclosed | VERIFIED |
| Surfer | $82/mo (annual) | 50 | 3+ | Daily | Prompts | Not disclosed | VERIFIED |
| SE Visible | $99/mo | 200 | 5 | Daily | Prompts | Browser GUI | VERIFIED |
| SE Ranking add-on | $89/mo | 200 | 4 | Not stated | Prompts | Not disclosed | VERIFIED |
| Nightwatch | €79/mo (bundled) | 50 | 6 | Daily | Prompts, answers | Not disclosed | VERIFIED |
| ProRankTracker | $99/mo | 500 (1,000 Terms) | 6 | Daily | 2 Terms per prompt-platform-location | Not disclosed | VERIFIED |
| AccuRanker AccuLLM | Not published | n/a | 4 | Not stated | n/a | Not disclosed | VERIFIED (engines) |

### 4.3 AI metric formulas, side by side

| Vendor | Headline visibility | Denominator | Share of Voice | Position | Sentiment | Status |
|---|---|---|---|---|---|---|
| Peec | responses mentioning brand / all responses | All responses | brand mentions / all brand mentions | Mean ordinal rank among all detected brands, only where present | 0 to 100 (typical 65 to 85) | VERIFIED |
| Profound | responses with brand / responses with at least one brand (overview) | Brand-bearing responses only (glossary reportedly all responses) | responses mentioning brand / total brand mentions | "1 = typically first"; aggregates SoV-type indicators | Positive/negative associations | VERIFIED + conflict (3P) |
| Otterly | Brand coverage = prompts mentioning / all prompts (AIO non-triggers excluded) | All executions | my mentions / all mentions | sum positions / prompts present; BVI y = 10 + ((5 - p)/4) x 90 | NSS (pos - neg)/total x 100 | VERIFIED |
| Scrunch | present / total observations | All responses | Competitive presence (same denominator) | Top 25% / Middle 50% / Bottom 25% of text | Pos/Mixed/Neg share | VERIFIED |
| Evertune | Visibility % = responses mentioning / all; AI Brand Score = position-weighted | All responses, 100 samples per prompt | n/a | Weights 1.0, 0.9, 0.81, ... | n/a | VERIFIED |
| Ahrefs | Mentions (count), Impressions (sum of Google volume of prompts where present) | n/a | Share of impressions among tracked brands; cross-platform weighted by impressions | n/a | n/a | VERIFIED |
| Semrush | 0 to 100 "benchmark" (formula unpublished) | Unknown | Mentions share vs competitors | Citation order (1st citation, 2nd) | "positive and general" balance | VERIFIED definitions |
| SE Ranking | Mention presence = prompts mentioning / tracked prompts; link presence | Tracked prompts | Not defined on page | Top 3 presence | n/a | VERIFIED |
| AccuLLM | Average of mentions-based score | Not stated | Share of brand mentions, share of citations | Average rank; Top Proximity Score | 0 to 100 | VERIFIED |

Key contrasts (INFERRED):
- **Denominator.** A test by AuthorityTech found 54% of 96 answers across four engines named no tracked vendor. With that rate, a brand in 20 of 96 answers scores 20.8% on Peec's formula and 45.5% on Profound's overview formula. Same data, 2.2x difference. Source for the 54% figure: VERIFIED (3P, small sample) https://authoritytech.io/blog/brand-free-response-rate-ai-visibility-denominator-2026
- **Position.** Three incompatible definitions: ordinal rank among brands (Peec, Otterly, AccuLLM), citation order (Semrush), and text quartile (Scrunch). "Average position 2.3" means different things in each tool.
- **Unit mismatch.** Profound's SoV divides "responses that mention your brand" by "total brand mentions", mixing a response count with a mention count.
- **Presence vs citation.** Scrunch and Ahrefs keep mention and citation strictly separate. Semrush's "Average Position" is about citations while its SoV is about mentions.

### 4.4 Repeated runs and variance

| Vendor | Approach | Status |
|---|---|---|
| Evertune | 100 samples per prompt; publishes margins of error. | VERIFIED |
| Profound | Daily runs; score is the average across responses over time. | VERIFIED |
| Scrunch | Shows n in tooltips; auto-aggregates daily to weekly (15 to 90 days) to monthly (90+). | VERIFIED |
| Rankscale | Tells users single-digit shifts are noise; 2 to 4 week settle period. | VERIFIED |
| Peec | Last 100 chats per prompt visible; daily/weekly/monthly granularity. No uncertainty shown. | VERIFIED |
| Ahrefs Brand Radar | 90-day reporting window for chatbots; runs per prompt not specified. | VERIFIED |
| Semrush | "directional signals"; no run count disclosed. | VERIFIED |
| Others | Not disclosed. | n/a |

Academic evidence: Sielinski, "Quantifying Uncertainty in AI Visibility: A Statistical Framework for Generative Search Measurement" (arXiv 2603.08924, v3 2026-08-26). Repeated sampling on Perplexity, SearchGPT and Gemini across three product topics, daily over nine days and at ten-minute intervals. Citation distributions follow a power law; "many apparent differences between domains fall within the noise floor"; rankings are unstable "throughout the frequently cited domain set"; "single-run visibility metrics provide a misleadingly precise picture". VERIFIED https://arxiv.org/abs/2603.08924

Critique of Evertune's numbers (INFERRED): sampling one prompt 100 times reduces within-prompt noise but does not reduce prompt-selection error. A topic built from 10 prompts still has only 10 independent prompt draws, so the published "±2 points" at topic level treats 1,000 correlated responses as independent. Our platform should report two variance components: within-prompt (run-to-run) and between-prompt (which prompts were chosen).

### 4.5 Prompt discovery and prompt volume methodology

| Vendor | Method | Output | Honesty about limits | Status |
|---|---|---|---|---|
| Profound | Licensed double-opt-in consumer panels; panel projection for demographic, geographic, churn bias | Volumes, trends, intent, sentiment; weekly | Claims accuracy, no validation published | VERIFIED |
| Evertune | EverPanel 150M+ conversations, weighted to internet composition; groups by intent and topic | Topic demand | Discloses phrasing uniqueness (80%+) | VERIFIED |
| Semrush | AI search clickstream + Google keyword data + ML; topic-level volume | Monthly Audience; topic volume | "directional signals" | VERIFIED |
| Ahrefs | Google search volume of highest-volume keyword whose SERP shows the prompt in PAA | Impressions per prompt | States it is a modeling choice, not a measured relationship | VERIFIED |
| Peec | Relative 1 to 5 score from search trends, AI conversation data, industry signals | 1 to 5 | Relative only | VERIFIED |
| AthenaHQ | Proprietary ML (QVEM), "50+ sources" | Absolute monthly numbers | Claims 95%+ accuracy vs "actual platform data" | VERIFIED claim, validity INFERRED doubtful |
| Writesonic | "AI search volume and trend insights" (Enterprise) | Not described | n/a | VERIFIED (feature only) |

Prompt discovery features seen: Peec Prompt Builder and prompt suggestions from brand context and coverage gaps, prompts from keywords, personas; Semrush prompt research; Otterly AI Prompt Research Tool; Goodie prompt research watchlist; Nightwatch Prompt Research; Ahrefs Brand Radar database browsing. VERIFIED on the respective pricing/docs pages above.

### 4.6 Data collection approach

| Approach | Vendors stating it | Status |
|---|---|---|
| Front end / UI only | Ahrefs Brand Radar ("free, publicly available web interfaces"), Profound, Semrush ("not via any APIs of LLMs"), SE Visible (browser GUI) | VERIFIED |
| Mixed, labelled | Peec (UI and API model channels), Scrunch (browser automation, official APIs, integrations) | VERIFIED |
| Deliberately both for diagnosis | Evertune (API for training knowledge, consumer apps for live search) | VERIFIED |
| Not disclosed | Otterly, ZipTie, Athena, Rankscale, Goodie, Writesonic, Surfer, Nightwatch, ProRankTracker, AccuLLM | n/a |

seoClarity's argument for UI capture: the ChatGPT UI adds shopping results, formatting and undisclosed parameters absent from the API; its side-by-side used GPT-5 with browsing. VERIFIED https://www.seoclarity.net/blog/scraping-vs.-api

INFERRED risks of UI capture that vendors do not discuss: terms of service exposure, logged-in vs logged-out differences, account/persona memory, geolocation of the scraping IP, and silent UI changes that break parsers (Scrunch notes Grok stopped contributing citation data).

### 4.7 Query fan-out, citation intelligence, content opportunity, reporting

| Capability | Who has it (verified) |
|---|---|
| Query fan-out | Semrush Enterprise AIO (Google queries behind AI answers + ranking domains), Peec (fan-out search and shopping queries via API and per chat), Scrunch (Core "Limited", Enterprise full), Ahrefs (fan-out used to generate prompts) |
| Sources vs citations split | Peec (sources vs inline citations; retrieval rate vs citation rate), Ahrefs ("Found in" vs cited), Scrunch (Brand/Competitor/Other) |
| Source classification | Peec (competitor, editorial, reference, UGC), ZipTie UGC Impact Analysis (Reddit depth) |
| Gap analysis | Peec Gap Analysis with Gap Score; Semrush Enterprise fan-out gaps; Surfer mention gap |
| Accuracy / hallucination | Profound FactCheck, Peec Fact-checking and Objections, seoClarity accuracy monitoring |
| Agent / bot analytics | Profound, Peec, Otterly, Scrunch, Goodie, Evertune Enterprise, Ahrefs Bot Analytics |
| Content actions | Profound AI Marketer agents, Peec Actions, Writesonic Action Center, Goodie optimizations, ZipTie content generation, Evertune articles, Athena content agent |
| AI ads monitoring | Peec Ads library, Writesonic ads monitoring, Rankscale ad tracking |
| Reporting | Looker Studio (Peec Advanced, Otterly, Rankscale, Nightwatch Professional), MCP servers (Peec, Otterly, ZipTie, Ahrefs, Semrush, Goodie, Nightwatch, Surfer), CSV/JSON (Profound Enterprise) |

Sources for this table: pricing and docs URLs in 4.1.

---

## 5. Published CTR-by-position curves

### 5.1 Advanced Web Ranking CTR study (July 2026, Google US, desktop, all intents)

Method: "more than 1.75 million US SERPs each month, roughly 1 million on desktop and 750,000 on mobile, with click and impression estimates for each of the top 20 organic positions". Position 1 baseline "184.8 million impressions and 37.0 million clicks". A third-party article states AWR's free CTR tool uses Search Console data and that a Google impressions logging error affected data from 2025-05-13 to 2026-04-27. VERIFIED https://www.advancedwebranking.com/seo/organic-ctr ; logging-error note VERIFIED (3P) https://www.searchenginejournal.com/google-desktop-mobile-ctr-q2-2026/591402/

| Position | All SERPs | With AI Overview |
|---|---|---|
| 1 | 20.02% | 9.69% |
| 2 | 10.36% | 3.69% |
| 3 | 3.89% | 1.70% |
| 4 | 1.71% | 1.27% |
| 5 | 1.08% | 1.02% |
| 6 | 0.73% | 0.55% |
| 7 | 0.46% | 0.35% |
| 8 | 0.47% | 0.34% |
| 9 | 0.54% | 0.47% |
| 10 | 0.58% | 0.43% |
| 11 | 0.67% | 0.61% |
| 12 | 0.70% | 0.60% |
| 13 | 0.82% | 0.71% |
| 14 | 0.88% | 0.91% |
| 15 | 0.80% | 0.70% |
| 16 | 0.67% | 0.69% |
| 17 | 0.64% | 0.66% |
| 18 | 0.55% | 0.56% |
| 19 | 0.52% | 0.54% |
| 20 | 0.27% | 0.22% |

Branded vs unbranded (US, all devices, July 2026): pos 1 27.32% / 19.38%; 2 16.93 / 9.64; 3 12.75 / 6.02; 4 10.23 / 3.88; 5 7.91 / 2.68; 6 6.12 / 1.86; 7 5.12 / 1.37; 8 4.40 / 1.10; 9 4.02 / 0.94; 10 4.04 / 0.81. VERIFIED same URL.

Query length (US, all devices, July 2026), position 1: 1 word 25.67%, 2 words 21.2%, 3 words 23.8%, 4 words 21.97%. Position 3: 5.37 / 7.85 / 8.79 / 6.75. VERIFIED same URL.

Position 1 by intent (desktop, July 2026), all SERPs vs with AIO: informational 17.69% vs 10.88%; commercial 11.91% vs 3.51%; transactional 10.38% vs 7.80%. VERIFIED same URL.

Position 1 by industry (US, all devices, July 2026): from 12.2% (Law, Government and Politics) to 31.24% (Arts and Entertainment); Health and Fitness 13.28%, Technology and Computing 15.01%, Shopping 27.03%. VERIFIED same URL.

Monthly volatility, desktop position 1, all SERPs / with AIO: Aug 2025 36.53 / 19.15; Jan 2026 41.29 / 25.58; Feb 45.57 / 18.03; Mar 31.73 / 14.69; Apr 20.14 / 1.96; May 14.61 / 3.23; Jun 21.44 / 10.23; Jul 20.02 / 9.69. Mobile position 1 all SERPs rose from 29.78% (Dec 2025) to 39.04% (Jun 2026). VERIFIED same URL.

Decade view (US, all devices, annual averages), positions 1 / 2 / 3: 2015 29.3 / 17.37 / 10.9; 2019 28.4 / 15.8 / 10.85; 2023 28.55 / 14.46 / 8.61; 2024 27.78 / 12.21 / 7.24; 2025 25.77 / 10.5 / 6.1. VERIFIED same URL.

SERP layout effect on position 1 (desktop, July 2026, vs 20.02% baseline): sitelinks +286%; images + videos +226%; AIO only -36% (15.69% of SERPs); AIO + PAA + videos -81% (7.34% of SERPs, 84.8% zero-click); local pack -94%; AIO + local pack + products + PAA + videos -99%. Zero-click rate 74.3% with AIO vs 53.6% without. AIO on 43% of sampled desktop SERPs. VERIFIED same URL.

Q2 2026 quarterly report (via SEJ): desktop positions 1 to 2 combined 29.05% without AIO vs 10.04% with AIO; mobile position 1 35.95% without vs 8.51% with. VERIFIED (3P) https://www.searchenginejournal.com/google-desktop-mobile-ctr-q2-2026/591402/

### 5.2 First Page Sage (report dated 2026-09-22)

Method: "meta-analysis ... built from our own client Search Console panel, our GEO referral-attribution dataset, and a weekly SERP crawl". Claims AI answers appear on 81.6% of US queries (Sep 2026) up from 23.4% (Sep 2025), and that Google made the AI answer the default in July 2026. These prevalence figures are far above AWR's 43% desktop AIO share for July 2026, so treat as vendor-specific. VERIFIED (numbers), comparability INFERRED. https://firstpagesage.com/reports/google-click-through-rates-ctrs-by-ranking-position/

| Element | AI answer present | No AI answer | Blended |
|---|---|---|---|
| Organic 1 | 3.6% | 22.6% | 7.1% |
| Organic 2 | 1.4% | 10.2% | 3.0% |
| Organic 3 | 0.8% | 5.8% | 1.7% |
| Organic 4 | 0.5% | 3.7% | 1.1% |
| Organic 5 | 0.3% | 2.5% | 0.7% |
| Organic 6 | 0.3% | 1.8% | 0.6% |
| Organic 7 | 0.2% | 1.3% | 0.4% |
| Organic 8 | 0.2% | 0.9% | 0.3% |
| Organic 9 | 0.1% | 0.7% | 0.2% |
| Organic 10 | 0.1% | 0.5% | 0.2% |
| Ad 1 to 4 | 1.8 / 1.2 / 0.9 / 0.7% | 3.4 / 2.3 / 1.8 / 1.4% | 2.1 / 1.4 / 1.1 / 0.8% |

AI answer citation position CTR: citation 1 5.2% (39.7% of AI answer clicks), 2 3.1% (23.7%), 3 1.9% (14.5%), 4 1.2% (9.2%), 5 0.8% (6.1%), 6+ 0.9% (6.9%); all citations 13.1%. Local pack 1 / 2 / 3: 14.8% / 12.6% / 11.9%; business recommended in AI answer 7.3%. Featured snippet 11.4% (on 6.8% of queries). Blended position 1 fell from 39.8% (2025 report) to 7.1%. 74.2% of US searches end without a click. "Fewer than four in ten cited URLs also rank in the organic top 10 for the same query." Share of discovery clicks 2026: AI citations 46.2%, organic 33.8%, paid 11.4%, local 8.6%. VERIFIED same URL.

Earlier First Page Sage curve (2025 report): position 1 39.8% VERIFIED (quoted in 2026 report). Positions 2 to 10 of the 2025 curve (about 18.7, 10.2, 7.2, 5.1, 4.4, 3.0, 2.1, 1.9, 1.6%) UNVERIFIED (memory).

### 5.3 Older and vendor-embedded curves (still used in products)

| Source | Pos 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sistrix 2020 (80M+ keywords) | 28.5 | 15.7 | 11.0 | n/a | n/a | n/a | n/a | n/a | n/a | 2.5 | VERIFIED https://www.sistrix.com/blog/why-almost-everything-you-knew-about-google-ctr-is-no-longer-valid/ |
| Backlinko (GSC data via Semrush) | 27.6 | 15.8 | 11.0 | 8.4 | 6.3 | 4.9 | 3.9 | 3.3 | 2.7 | 2.4 | Pos 1 VERIFIED https://backlinko.com/google-ctr-stats ; rest UNVERIFIED (chart image) |
| SE Ranking traffic forecast (Chitika 2013 values) | 32.5 | 17.6 | 11.4 | 8.1 | 6.1 | 4.4 | 3.5 | 3.1 | 2.6 | 2.4 | Values VERIFIED https://seranking.com/blog/metrics-in-se-ranking/ ; Chitika origin INFERRED |
| AccuRanker static CTR | ~31.2 | ~16 | n/a | | | | | | | | VERIFIED https://www.accuranker.com/blog/share-of-voice-update/ |
| Ahrefs GSC aggregate, informational, desktop, pos 1 only | 7.6 (Dec 2023, no AIO) / 3.9 (Dec 2025, no AIO) / 1.6 (Dec 2025, with AIO) | | | | | | | | | | VERIFIED https://ahrefs.com/blog/ai-overviews-reduce-clicks-update |

Sistrix layout effects: position 1 ranges 13.7% (Shopping) to 46.9% (sitelinks); featured snippet 23.3%; knowledge panel 16.7%; Google Ads 18.8%. VERIFIED Sistrix URL above.

INFERRED: Ahrefs' position 1 CTRs (1.6% to 7.6%) are 3x to 10x lower than AWR's (20% to 28%) because Ahrefs sums clicks over impressions across all informational queries on desktop, including impressions that never scrolled to the result, while AWR estimates per-SERP CTR. The same label "position 1 CTR" covers different estimators. Our product should name the estimator, not just the number.

---

## 6. AI Overview impact on CTR: study summary

| Study | Period | Method and sample | Key numbers | Status |
|---|---|---|---|---|
| Ahrefs (Apr 2025) | Mar 2024 vs Mar 2025 | 300,000 keywords (150k with AIO, 150k informational without), aggregated GSC, desktop | Pos 1 CTR with AIO 0.073 to 0.026; forecast without AIO 0.040; -34.5% | VERIFIED https://ahrefs.com/blog/ai-overviews-reduce-clicks/ |
| Ahrefs update | Dec 2023 vs Dec 2025 | Same design | With AIO 0.073 to 0.016; without AIO 0.076 to 0.039; forecast 0.037; -58% at pos 1, -19.4% at pos 10 | VERIFIED https://ahrefs.com/blog/ai-overviews-reduce-clicks-update |
| Seer Interactive | Jun 2024 to Sep 2025 | 3,119 informational queries, 42 orgs, 25.1M organic and 1.1M paid impressions | Organic CTR with AIO 1.76% to 0.61% (-61%); without AIO 2.74% to 1.62% (-41%); paid with AIO 19.70% to 6.34% (-68%); cited organic 0.70% vs 0.52% not cited (+35%); cited paid 7.89% vs 4.14% (+91%) | VERIFIED https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-september-2025-update |
| Seer Interactive 2026 | Jan 2025 to Feb 2026 | 53 brands, 5.47M queries, 2.43B organic and 296.9M paid impressions | AIO organic CTR 1.31% (Dec 2025) to 2.36% (Feb 2026), +85% rebound; no AIO 3.82% (Feb 2026); cited 2.07% vs not cited 0.94% (+120%), cited still -38% vs no-AIO queries; AIO prevalence informational 36%, commercial 8%, transactional 5%; comparison queries 95.4% AIO trigger, questions 85.9% | VERIFIED https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-2026-update |
| Pew Research Center | Mar 2025 | 900 US adults, 68,879 searches, 12,593 (18%) with AI summary | Click on a result in 8% of visits with summary vs 15% without; click on a source inside summary 1%; session ended 26% vs 16%; 10+ word queries 53% summaries; questions 60% | VERIFIED https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/ |
| AWR | Jul 2026 | 1.75M US SERPs/month | Pos 1 20.02% to 9.69% (-52%); pos 2 -64%; pos 3 -56%; zero-click 74.3% vs 53.6%; last 12 months pos 1 20.9% vs 28.0% prior 12 | VERIFIED https://www.advancedwebranking.com/seo/organic-ctr |
| Semrush | Jan to Nov 2025 | 10M+ keywords, Datos clickstream, 200K+ keywords for zero-click | AIO share 6.49% (Jan) to 24.61% (Jul) to 15.69% (Nov); same-keyword before/after showed slightly more clicks with AIO; informational share of AIO queries 91.3% (Jan) to 57.1% (Oct) | VERIFIED https://www.semrush.com/blog/semrush-ai-overviews-study/ |
| SparkToro / Datos | 2024 | US and EU clickstream | US 58.5% zero-click, 360 of 1,000 searches reach open web; EU 59.7%, 374 of 1,000 | VERIFIED (SparkToro title plus search snippet; title and snippet disagree on which region is 360 vs 374) https://sparktoro.com/blog/2024-zero-click-search-study-for-every-1000-us-google-searches-only-374-clicks-go-to-the-open-web-in-the-eu-its-360/ |
| SparkToro / Similarweb | Jan to Apr 2026 | US clickstream | 68% of US Google searches end without a click (60.5% in 2024) | VERIFIED (3P, quoted by AWR); SparkToro 2026 page returned 403 |
| First Page Sage | 2026 | Client GSC panel, referral dataset, SERP crawl | Pos 1 3.6% with AI answer vs 22.6% without (-84%) | VERIFIED |

Takeaway (INFERRED): the direction is consistent (AIO lowers organic CTR) but magnitude ranges from -34.5% to -84% at position 1, and Seer and AWR both show large month-to-month swings tied to Google UI tests. A static "AIO multiplier" will be wrong within weeks. Semrush's same-keyword analysis even points the other way, which shows how much selection effects matter (AIOs appear on low-click queries).

---

## 7. Misleading metrics to avoid (or to fix in our product)

1. **Single-run AI "rank" or "position".** One response per prompt per day, reported as "you rank #2 in ChatGPT". Evertune's own example shows ±44 points of uncertainty for a single run, and Sielinski shows rankings are unstable across samples. VERIFIED evidence; recommendation INFERRED.
2. **Visibility scores with hidden denominators.** Peec vs Profound differ only in the denominator and can differ by 2x on the same data (section 4.3). Profound's own pages disagree. Always print numerator, denominator and n.
3. **Opaque 0 to 100 composites.** Semrush AI Visibility and ZipTie AI Success Score do not publish weights. A composite that moves cannot be explained to a client.
4. **Prompt volume with invented precision.** Absolute numbers for prompt demand (AthenaHQ "95%+ accuracy") have no public ground truth. Ahrefs' Google-volume proxy is honest about being a modeling choice. Panels (Profound, Evertune) are real data but representativeness is unpublished. Prefer ranges or relative tiers with the method named.
5. **AIO citation counted as organic position 1** (Semrush Position Tracking). It merges two different events and inflates average position.
6. **Static CTR curves from a different era.** SE Ranking's forecast uses values that match a 2013 curve (32.5% at position 1), while 2026 measured desktop position 1 is 20.02% (AWR) or 3.6% with an AI answer (First Page Sage). Traffic estimates built this way can be off by 2x to 9x.
7. **"Position 1 CTR" without the estimator.** 1.6% (Ahrefs GSC aggregate with AIO) and 27.3% (AWR branded) are both "position 1 CTR".
8. **Average position that silently imputes 100 for unranked keywords** (Semrush). Adding or removing unranked keywords moves the average without any ranking change.
9. **Sentiment scores without a baseline.** Peec says most scores fall between 65 and 85, so a "72" carries little information. Otterly's NSS (-100 to +100) is more interpretable because it is a documented difference of counts.
10. **"Position" with three meanings**: brand order (Peec, Otterly), citation order (Semrush), text quartile (Scrunch). Name it precisely.
11. **Cross-platform averages without weighting disclosure.** Ahrefs weights SoV by platform impressions, which lets AI Overviews (hundreds of millions of prompts) dominate a "cross-platform" figure.
12. **Share of Voice from a hand-picked competitor set.** Every tool computes SoV only among tracked brands; adding or removing a competitor changes your SoV with no change in AI answers. Peec's position metric notably counts untracked brands too.
13. **Topic-level precision claims that ignore prompt-selection error** (Evertune ±2 points from 10 prompts x 100 runs).

---

## 8. What customers pay for

Rank tracking unit prices (INFERRED arithmetic on VERIFIED list prices, monthly billing):

| Tool | Price | Daily keyword checks included | Approx. $ per daily keyword per month |
|---|---|---|---|
| SE Ranking Core | $129 | 2,000 | $0.065 |
| ProRankTracker Starter | $99 | 1,000 | $0.099 |
| AccuRanker Professional | $224 | 2,000 | $0.112 |
| AWR Pro | $139 | 1,000 (7,000 weekly units / 7) | $0.139 |
| Nightwatch Starter | €79 | 500 (plus 50 AI prompts) | €0.158 |
| Semrush SEO | $139 | 500 (plus full suite) | $0.278 |
| Ahrefs Lite | $129 | 750 weekly (full suite) | weekly only |

AI visibility unit prices (INFERRED):

| Tool | Price | Responses or checks per month | Approx. $ per response |
|---|---|---|---|
| ProRankTracker | $99 | 500 prompt-platform combos x 30 days = 15,000 | $0.0066 |
| Ahrefs custom prompts Scale | $250 | 25,000 checks | $0.010 |
| Ahrefs custom prompts Basic | $50 | 2,500 checks | $0.020 |
| Rankscale Pro | $99 | up to 4,800 | $0.021 |
| Peec Starter | ~$95 | 50 x 3 x 30 = 4,500 | ~$0.021 |
| Scrunch Core | $250 | 5,000 | $0.050 |
| Writesonic Starter | $79 | 50 x 30 = 1,500 | $0.053 |
| Nightwatch Starter | €79 | 1,500 (bundled with 500 kw) | under €0.053 |
| AthenaHQ Starter | $295 | 3,600 | $0.082 |
| Semrush AI toolkit | $99 | 25 prompts daily (engines x 4 if all run) = 750 to 3,000 | $0.033 to $0.132 |

What buyers get charged on:
- **Volume**: keywords x frequency; prompts x engines x frequency (Peec, Ahrefs, ZipTie, ProRankTracker make this explicit).
- **Engine breadth**: 3 to 4 engines at entry; 9 to 13 at enterprise (Profound 9, Scrunch 9, Athena 11, Evertune 11, Goodie and Peec 13).
- **Geography and language**: 1 country at entry (Profound trial, Scrunch Core); multi-country gated to higher tiers (Peec Advanced).
- **History, export, API, MCP, SSO**: gated to higher tiers almost everywhere (Profound trial has no history or export).
- **Action layer**: content generation, optimizations, agents are the main upsell for AI visibility vendors (Profound AI Marketer, Goodie, Writesonic, ZipTie, Evertune).
- **Seats**: many AI vendors give unlimited seats (Profound, Peec, Otterly, ZipTie, Nightwatch); Semrush and Ahrefs charge per seat.

---

## 9. Implications for our platform (INFERRED recommendations)

1. Store raw observations (engine, surface channel UI/API, locale, persona, timestamp, response text, brands in order, sources, citations, fan-out queries) and compute every metric from them, so formulas can be shown and re-computed.
2. Publish every formula in-product with numerator, denominator and n, as Scrunch does in tooltips. Show confidence intervals from bootstrap over runs and over prompts.
3. Report within-prompt and between-prompt variance separately. Let users choose samples per prompt (1, 5, 10, 25) with visible cost and precision trade-off.
4. Keep mention, citation, retrieval-without-citation, and position as separate metrics. Offer composites only as labelled, user-weighted views.
5. Use a denominator of all responses by default, and show "responses naming no tracked brand" as its own metric.
6. Use time-varying, SERP-layout-aware CTR models with ranges (for example AWR-style per-layout curves, updated monthly), and label the estimator. Never a single 2013-era curve.
7. Keep AIO citation separate from organic rank; show both on the keyword row.
8. For prompt demand, prefer relative tiers with method disclosure, or Google-volume proxies stated as proxies. Avoid absolute "AI search volume" unless backed by a panel and published validation.
9. Price on transparent units (responses per month), similar to Ahrefs checks and Peec's prompts x models x frequency, with a stated ratio to keyword checks (ProRankTracker uses 1 prompt = 2 keyword checks).

---

## 10. Source list (all accessed 2026-09-29)

Rank trackers
- https://www.semrush.com/kb/697-what-is-visibility
- https://www.semrush.com/kb/923-position-tracking-landscape
- https://www.semrush.com/kb/1191-track-your-rankings
- https://www.semrush.com/kb/1435-ai-overview
- https://www.semrush.com/news/271711-measure-share-of-voice-with-semrush-position-tracking/
- https://www.semrush.com/news/256143-position-tracking-tool-estimated-traffic/ (search snippet only)
- https://www.semrush.com/prices/
- https://help.ahrefs.com/en/articles/2072381-what-is-share-of-voice-sov-and-how-is-it-calculated
- https://ahrefs.com/rank-tracker
- https://ahrefs.com/pricing
- https://www.accuranker.com/pricing/
- https://www.accuranker.com/help/overview/share-of-voice/
- https://www.accuranker.com/blog/share-of-voice-update/
- https://www.accuranker.com/help/getting-started/accullm/
- https://seranking.com/pricing.html
- https://seranking.com/blog/metrics-in-se-ranking/
- https://visible.seranking.com/
- https://www.advancedwebranking.com/help/visibility-score
- https://www.advancedwebranking.com/help/visibility-percentage
- https://www.advancedwebranking.com/help/estimated-visits
- https://www.advancedwebranking.com/help/achieve-complete-seo-reporting-with-visibility-score-click-share-and-market-share
- https://www.advancedwebranking.com/help/click-share-vs-total-click-share-score (search snippet only)
- https://www.advancedwebranking.com/pricing
- https://www.wincher.com/pricing
- https://proranktracker.com/plans_and_pricing
- https://proranktracker.com/ai_plans_and_pricing
- https://nightwatch.io/pricing/

AI visibility
- https://www.semrush.com/pricing/ai/
- https://www.semrush.com/kb/1594-ai-seo-metrics
- https://www.semrush.com/kb/1607-semrush-ai-visibility-data
- https://www.semrush.com/lp/enterprise-aio/en/ (search snippet only)
- https://www.semrush.com/news/442193-query-fan-out-analysis-comes-to-semrush-enterprise-ai-optimization-revealing-the-search-signals-behind-ai-responses/ (search snippet only)
- https://ahrefs.com/brand-radar
- https://ahrefs.com/blog/brand-radar-methodology/
- https://help.ahrefs.com/en/articles/15501968-ai-visibility-metrics
- https://www.tryprofound.com/pricing
- https://www.tryprofound.com/features/answer-engine-insights
- https://www.tryprofound.com/features/prompt-volumes
- https://www.tryprofound.com/blog/prompt-volumes-general-availability
- https://www.tryprofound.com/blog/introducing-prompt-volumes
- https://help.tryprofound.com/articles/3443229936-answer-engine-insights-overview
- https://help.tryprofound.com/articles/6240000968-interpret-answer-engine-insights
- https://docs.tryprofound.com/agent-analytics/overview (search snippet only)
- https://peec.ai/pricing
- https://docs.peec.ai/metrics/brand-metrics/visibility
- https://docs.peec.ai/metrics/brand-metrics/share-of-voice
- https://docs.peec.ai/metrics/brand-metrics/position
- https://docs.peec.ai/metrics/brand-metrics/sentiment
- https://docs.peec.ai/metrics-overview.md
- https://docs.peec.ai/understanding-chats.md
- https://docs.peec.ai/understanding-sources.md
- https://docs.peec.ai/api/model-channels.md
- https://docs.peec.ai/llms.txt
- https://help.otterly.ai/pricing-of-otterlyai
- https://help.otterly.ai/brand-report-kpi-definition
- https://help.otterly.ai/brand-visibility-index
- https://scrunch.com/pricing
- https://helpcenter.scrunchai.com/en/articles/13566677-scrunch-metrics-guide
- https://ziptie.dev/pricing
- https://www.athenahq.ai/pricing
- https://athenahq.ai/articles/generative-ai-search-query-volume-estimation-model
- https://www.evertune.ai/pricing
- https://www.evertune.ai/platform/methodology
- https://www.evertune.ai/resources/insights-on-ai/what-is-ai-brand-score
- https://rankscale.ai/pricing
- https://rankscale.ai/resources/modules/diagnose/how-to-read-your-rankscale-dashboard
- https://higoodie.com/pricing
- https://writesonic.com/pricing
- https://surferseo.com/pricing/
- https://queryburst.com/ai-visibility/prompt-tracker-scores/
- https://authoritytech.io/blog/brand-free-response-rate-ai-visibility-denominator-2026
- https://www.seoclarity.net/blog/scraping-vs.-api
- https://arxiv.org/abs/2603.08924

CTR and AIO studies
- https://www.advancedwebranking.com/seo/organic-ctr
- https://www.searchenginejournal.com/google-desktop-mobile-ctr-q2-2026/591402/
- https://firstpagesage.com/reports/google-click-through-rates-ctrs-by-ranking-position/
- https://www.sistrix.com/blog/why-almost-everything-you-knew-about-google-ctr-is-no-longer-valid/
- https://backlinko.com/google-ctr-stats
- https://ahrefs.com/blog/ai-overviews-reduce-clicks/
- https://ahrefs.com/blog/ai-overviews-reduce-clicks-update
- https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-september-2025-update
- https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-2026-update
- https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/
- https://www.semrush.com/blog/semrush-ai-overviews-study/
- https://sparktoro.com/blog/2024-zero-click-search-study-for-every-1000-us-google-searches-only-374-clicks-go-to-the-open-web-in-the-eu-its-360/ (title and snippet only)

---

## 11. Pages that failed or returned incomplete content

| URL | Result | Workaround |
|---|---|---|
| https://www.semrush.com/kb/1061-visibility-position-tracking | HTTP 404 | Used KB 697, 923, 1191 |
| https://www.advancedwebranking.com/blog/ctr-google-2025-q4 | Fetched, no CTR data in extracted text | Used AWR /seo/organic-ctr and SEJ Q2 2026 summary |
| AWR /help/* pages via curl | JavaScript-rendered, empty body | WebFetch succeeded |
| https://otterly.ai/pricing | HTTP 202, empty body; WebFetch empty | Used help.otterly.ai pricing article (limits); prices UNVERIFIED |
| https://peec.ai/pricing | Prices rendered client-side, not in source | Limits VERIFIED; prices UNVERIFIED |
| https://www.wincher.com/pricing | Prices rendered client-side | Tiers VERIFIED; price UNVERIFIED |
| https://proranktracker.com/pricing | HTTP 404 | Used /plans_and_pricing and /ai_plans_and_pricing |
| https://www.evertune.ai/methodology | HTTP 404 | Used /platform/methodology |
| https://sparktoro.com/blog/in-2026-less-than-one-third-of-google-searches-still-send-a-click/ | HTTP 403 | 68% figure taken from AWR's citation (3P) |
| https://backlinko.com/google-ctr-stats | Positions 2 to 10 in a chart image | Only position 1 (27.6%) VERIFIED |
| Profound pricing (WebFetch) | Summary omitted Conversation Explorer | Raw text read; Conversation Explorer UNVERIFIED |
| AccuRanker SoV help page | No static CTR table | Used AccuRanker blog for 31.2% / 16% |
