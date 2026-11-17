# Backend requests for the redesigned AI visibility Overview

Date: 2026-11-16. Written by the web package W0-overview (plan `docs/superpowers/plans/2026-11-16-real-app-port-overview-and-prompts.md`).
Source of the design: `docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md`.

The web app builds every card of the redesign now. Where the backend does not collect a value yet, the card shows
"not collected yet" and never a zero (rule R6). Nothing in production shows an invented value; sample values exist only
in the mock fixtures. This note lists what the backend must add so those cards fill in, with the smallest change for each.
File names are the ones read on `port/w0-overview` (2026-11-16).

Order of value: 1 to 3 (the headline and the position card), then 4 (sentiment and recommendation), then 10 and 8
(competitor series and one topic per prompt), then the rest.

## 1. `ai.visibility_rate`

What: AI Visibility is the share of valid answers that name or cite the brand. It is 100% minus "neither". The registry
row is in `docs/16-metrics-methodology.md` section 2.1.

Today: the four outcome cells exist per prompt and engine (`EngineSummary.outcomes`), so the web already computes the
rate in the browser (`apps/web/src/lib/rates/visibility-model.ts`, the sum of the three cells that are not "neither").
What is missing is the registry key, the weekly points, and the exports.

Smallest change, in `backend/src/idraft/api/ai/metrics.py`:

- Add one `Metric` to `METRICS`: unit `ratio`, weighting prompt weighted, `cell` a helper that returns a `MetricCell` with
  the numerator `mentioned_and_cited + mentioned_only + cited_only` and the denominator the outcomes share. Give it the
  matching `earlier` for `compare=previous_period`. `BREAKDOWN` then picks it up on its own.
- Add the key to `TILES` after `ai.mention_and_citation_rate`.
- Add the key to `SERIES_KEYS`, and add a `visibility` member to `WeekCells` (sum of the three outcome counts of the
  week, pooled the same way as `mentioned` and `cited`). The trend card needs it for the weekly line.

Weekly points, stated on their own because the Overview trend card waits for them: `WeekCells.visibility` is a
`MetricCell` per week (numerator the three outcome counts that are not "neither", denominator the valid answers of the
week), pooled over the trailing four weeks under 10 prompts exactly as `mentioned` and `cited` are (`is_pooled`,
`pool`). Until it exists the trend card says "Not collected yet" for AI visibility and never draws mention or citation
in its place. The web reads it as an optional field (`apps/web/src/lib/api/week-visibility.ts`) and the mock
(`apps/web/src/mocks/prompt-summary.ts`, `weekCells`) already returns it, so the card draws with MSW.

Test: on a fixture, the value equals `1 - neither` for a prompt, a topic and the total, and for every week of a series.

## 2. `ai.mention_order_mean` and the order counts

What: the mean position at which the brand is named among the tracked brands (1 = named first), over the answers that
name it. The position card also needs how many answers name it first, second, third or later, because a mean cannot draw
a distribution.

Today: `own_mention_order` is stored at ingest (`ai.observation_facts`, nullable since migration 0019). The summary reads
it only to count first mentions (`first_mention`).

Smallest change:

- Add `mention_order` to `EngineDetailCells` (`backend/src/idraft/api/schemas/ai.py`) as a `MetricCell`: numerator the
  sum of `own_mention_order` over valid answers that name the brand, denominator the number of those answers. Sums over
  sums, like `fanout_mean`. Register `ai.mention_order_mean` in `METRICS` with `cell=lambda engine: _detail(engine).mention_order`
  and add it to `DETAIL`. Unit `count` (a mean of whole numbers, not a ratio).
- Add `mention_order_counts` to `EngineDetailCells`: four `MetricCell`s for order 1, 2, 3 and 4 or later, over the same
  answers. They add up to the answers that name the brand.
- Both are read from the same query as `first_mention` in `summary_repository.py` (it already filters
  `own_mention_order`).

The web never averages orders of different engines as one pool: see item 3.

## 3. The two keys in `AVERAGED`

What: the summary holds an equal-weight average of the engines for five keys (`engine_average`, doc 19). The Overview
shows "avg of N" next to the engines for AI Visibility and for the mention order too.

Smallest change: add `ai.visibility_rate` and `ai.mention_order_mean` to `AVERAGED` in `api/ai/metrics.py`, and the two
members to the `engine_average` schema in `api/schemas/ai.py`. An engine without a rate of its own (fewer than 4 valid
answers) is left out of the average and the count says how many took part ("avg of N"), as for the other five.

Until then the web computes the average itself from the per-engine cells (`averageVisibility`), never from pooled counts.

## 4. Sentiment and recommendation cells

What: the sentiment card (four shares: positive, neutral, negative, mixed, per engine), the recommendation rate and the
average recommendation position. They are in the headline tiles and the sentiment card.

Today: `ai.recommendation_rate` is built and suppressed (`not_classified`, `SUPPRESSED` in `metrics.py`). The four
`ai.sentiment.*` keys are in `UNBUILT`. The facts table has the columns `own_recommended`, `own_sentiment` and
`sentiment_version` (`db/tables.py`), but nothing writes them (the classifier is WP-54, slice 2).

Smallest change, after the classifier writes the labels:

- Add to `EngineDetailCells`: `recommended` (valid answers with `own_recommended`, over valid answers where it was
  classified or the brand was not named, docs/16 A5) and `sentiment`, four `MetricCell`s over the answers that name the
  brand and were classified (A13). Also report the classified share so the card can say how much it saw.
- Remove `ai.recommendation_rate` and `ai.recommended_given_mentioned` from `SUPPRESSED`, and the four `ai.sentiment.*`
  keys from `UNBUILT`; add them to `METRICS`.
- Structured rank (average recommendation position) needs the ordered list extraction (`ai.structured_rank`, A10) and
  shows list coverage beside it. Same change, behind the same classifier.

Engines the classifier does not cover stay null, never 0. The design says recommendation and sentiment exist on two
platforms only for now.

## 5. Referral traffic route

What: the traffic card shows sessions from AI platforms by source and the landing pages they reach.

Today: no route. `fp.ai_referral_daily` is specified (`docs/18-first-party-integrations.md`) and filled from GA4 once the
integration is built (WP-69). The card needs the `ga4` integration capability: the layout catalog marks
`traffic.ai_referrals` with `integration: 'ga4'`, and `useLayoutCapabilities` offers no integration yet, so the card is
shown as not connected.

Smallest change:

- One read route, for example `GET {P}/traffic/ai-referrals?from&to&group_by=source|landing_page`, over
  `fp.ai_referral_daily` where `origin` is the GA4 one. For `source`: sessions per AI source (ChatGPT, Gemini and the
  other classified referrers), each with the previous window beside it. For `landing_page`: sessions per `landing_url_id`
  with the URL. Answer `200` with `connected: false` when the project has no GA4 integration, so the card can say so.
- Say in the response that the figure is a lower bound and that Google AI Mode and AI Overview cannot be told apart from
  Google organic in GA4 (docs/18 section 11.4, `fp.ai_referral_sessions`).
- Expose the project's connected integrations to the web (a list of codes such as `ga4`) so the layout capabilities can
  turn the card on.

## 6. Source overlap per competitor

What: the competitor drawer, Sources tab: the domains answers cite when each of you is named, their overlap (metric C7,
Jaccard) and the domains in the competitor's top 8 that are not in yours.

Today: `ai/sources/domains` counts citation units per domain for the whole scope. Nothing splits them by which brand the
answer names.

Smallest change: one read on the sources lane, for example `GET {P}/ai/sources/overlap?entity_id=<id>`, over
`ai.citations` joined to the observations whose facts name the entity or the own brand. Return the two domain sets with
citation units, the Jaccard value with the two counts it came from, and the domains in the entity's top 8 and not in the
own top 8. Same scope parameters as the other sources reads (window, engine, term, branded).

## 7. AI Overview as an engine

What: the Platform select lists AI Overview. Its values come from keyword rank checks where an AI Overview showed, never
from asked prompts (docs/16 section 1 rule 5: the denominator is the checks that showed one).

Today: `google_ai_overview` exists in `idraft/domain/ai_engines.py` but the API and the layout catalog accept three
engines only (`ENGINES` in `apps/web/src/lib/layouts/catalog.ts`, "comes back with slice 2"). Prompt to keyword links are
WP-44.

Smallest change: accept `google_ai_overview` in `filter[engine_code_in]` and in `EngineCode` of the layout schema. In
the summary, read its cells from the rank check rows of the keywords linked to a prompt, with a check counting as one
valid answer only when an AI Overview was present. Mentioned and cited come from the overview's text and links. It has no
fan-out and no recommendation. The web then adds the code to `ENGINES` in the catalog in a separate commit, because a
layout that names an engine the API refuses is rejected.

## 8. One topic per prompt (flat rule)

What: every prompt has exactly one required group (topic), so group values add up to the project total. The Overview
shows groups as a flat list, each prompt under its most specific term.

Today: a prompt can carry several topic terms (`ai.prompt_terms`, vocabulary `topic`), and the summary says "a prompt in
two topics counts in each; topic values do not add up to the total" (`TOPIC_NOTE` in `metrics.py`).

Smallest change: a rule on writes (create, import, edit return `422` when a prompt has none or more than one topic term),
a one-time repair migration that keeps the most specific term of a prompt that has several, and a partial unique index on
`ai.prompt_terms` for the topic vocabulary. Then drop the caveat sentence. Until it lands the web shows each prompt under
the most specific of its terms and says nothing about a double count.

## 9. Per-platform weekly run log

What: the collection runs calendar needs one cell per week and platform: how many answers were asked, how many were valid
and how many failed, and whether the run was partial.

Today: `GET {P}/runs` lists runs. The calendar card reads daily answer counts (`ops.answer_calendar`).

Smallest change: one read, for example `GET {P}/ai/collection-weeks?from&to`, grouped by week (Monday, project zone) and
`engine_code`, with `asked`, `valid`, `failed` and `status` (`complete` or `partial`), built from `ai.observations` and the
run rows. Offset the weeks the way the summary series does.

## 10. Per-competitor weekly series

What: share of voice over time (stacked area) and the competitor trend need one weekly value per tracked brand.

Status 2026-11-17: delivered by the server, read by the web. `WeekCells.entities` (`backend/src/idraft/api/schemas/ai.py`) is
filled with `include=series,entities`: the `EntityCells` (`entity_id`, `mentioned`, `share_of_voice`) of each tracked entity of
the engine's `entities` (the own ones first, at most 20) over the weeks the point holds, its own week or, when `is_pooled`,
the weeks of `pool`; weighted as the point's own cells are (Mentioned prompt weighted in a topic, total or country row); no
`previous`. The web draws a rival line only from these points; it never draws a flat or invented line. Share of voice over
time, its rank, the competitor trend and the rate trend (metric Share of voice) ask for them (`include=series,entities` with
`total` and `rows=none`). The one other reader of weekly share of voice, the sparkline of the headline tile, gets the
cells through the extra counts read of item 13, not through a read of its own.

What is still missing is not request 10 any more, it is carried by two other requests:

1. The weekly `share_of_voice` cell, and each weekly entity's, is still the old equal split. The web writes the count share
   itself from the weekly `entities[].mentioned` (one mention one weight, x of y brand mentions per brand and week).
   Request 13 asks for the count share in these cells too.
2. With more than 20 tracked brands the weekly cells stop at 20 (own ones first), so y of "x of y brand mentions" is too
   small. `WeekCells` has no `entities_mentions_total` (request 24), so the web says "More than 20 tracked brands" and draws
   no percent, no layer and no rank until it does.

Nothing else is asked: the order of the cells after the own ones is not relied on, and `previous` is not needed.

## 11. Weekly cells for mention position, recommendation and sentiment

What: the tiles Mention position, Recommendation rate and Sentiment of the headline card draw a 22 px line over the last
weeks in the preview (OV-HEAD-14). The real tiles have no line.

Today: `WeekCells` holds `mentioned`, `cited`, `share_of_voice` and the weekly visibility cell. It holds no mention order,
no recommendation and no sentiment, so the web has nothing to draw and draws nothing (never a flat or invented line).

Smallest change: with `include=series`, add to each `WeekCells`, per engine and for the weekly series of the total, the
`mention_order` mean with its count of ordered answers, and, once item 4 lands, `recommended` and `sentiment` (the
positive share) as `MetricCell`s over the same answers that item 4 counts. Pool the weeks as the other cells do and keep
`is_pooled` and `pool`. A week with fewer than 4 valid answers keeps its counts and no rate.

## 12. Run number and the last run of each platform

What: the status line of the preview says `Updated Sep 28, 02:10 · run 48`, and the tooltip of the Runs tile says `Run 48,
last Sep 28, 02:10` and, with a platform chosen, that platform's last run (OV-SHELL-07, OV-HEAD-16).

Today: the `Run` resource (`GET {P}/runs`) has `run_id`, `status`, `created_at`, `completed_at`, `window_start` and
`window_end`, and no run number and no platform. The web counts the collecting runs of the period and shows the time the
newest finished, in the project zone; the freshness line is the newest answer, a different fact (an answer can come after
the run began, so the two times can differ by hours).

Smallest change: add `run_number` (an integer that counts the collecting runs of the project, oldest is 1) to `Run`, and
`engine_codes` (the platforms the run asked) so a platform's last run is the newest run whose `engine_codes` holds it.
The web then writes `Run 48` and the per-platform time. Until then the line and the tooltip carry no run number.

## 13. Share of voice as brand-mention counts (D17)

What: the owner decided on 2026-11-17 (D17) that share of voice is the brand's mentions over all tracked-brand
mentions, and that the web always writes it as "x of y brand mentions" beside the percent (`docs/16-metrics-methodology.md`
section 5, `docs/glossary/terms.md` M5).

Today: the `share_of_voice` cell (`EngineSummary`, `EntityCells`, `WeekCells`, `SummaryTotal`) is the old equal split:
its numerator is a sum of `1 / (tracked brands the answer names)` and its denominator the valid answers that name a
tracked brand, so it holds no count of brand mentions and the web cannot write "x of y brand mentions" from it. The
`entities[].mentioned` cells do hold the counts (answers that name each tracked brand), which the web sums to build x
and y where a read carries `include=entities`; that is capped at 20 entities, own ones first, so a project with more
tracked brands gets a y that is too small.

Smallest change: make the `share_of_voice` cell of every block above a count share. `numerator` is the brand's
mentions (the valid answers that name it, summed over prompts for a topic row or the total, never prompt weighted, no
`pooled`), `denominator` the sum of those numerators over every tracked entity of the set, `value` their ratio, null
when the denominator is under 4 (R2). The own brand's cell sums its own entities. Do it for the weekly points of
`include=series,entities` too (item 10), and add `n_observations` as today. Keep the key name, so the web reads the
same field and drops its derivation.

Until it lands the web derives the share from `entities[].mentioned` where it has them (the Overview competitor cards,
the competitor drawer, the Prompts page cells) and writes "Not collected yet" for the whole figure where it has not
(a read without `include=entities`, the weekly lines). It never writes a percent without its counts.

Every reader of share of voice now reads one definition (2026-11-17, package "finish share of voice"): the web rewrites
the `share_of_voice` cell of each block that carries `entities` from the `entities[].mentioned` counts
(`apps/web/src/lib/rates/brand-mention-share.ts`: numerator the own mentions, denominator all tracked-brand mentions, no
`pooled`), and marks a block that has no entity cells as not collected. The Overview headline tile, the by-platform,
trend, location and period comparison cards, Share of voice over time and its rank, the group cards, the group drawer, the
Groups tab and the Prompts page all read that cell. When this item lands the file goes and the cell is read as the API
sends it; nothing else in the web changes.

The cards that show share of voice ask one extra read for it: the topic rows and the `total` with `include=entities`
(small, where the prompt rows with entity cells are megabytes), once for each window. The cards that draw share of voice
week by week (Share of voice over time, its rank, the competitor trend, and the rate trend while its metric is Share of
voice) read the `total` with `include=series,entities` and `rows=none` instead (item 10, delivered by the server).

## 24. Entity cell total and the count of answers that name a tracked brand

(Numbered 24: 14 to 23 are taken in this folder and in the Prompts page requests.)

What: two figures the web cannot get from the cells.

1. A project can track more brands than the 20 entity cells an engine carries (item 13). `summary.entities` lists the
   whole tracked set, so the web can see the cut (the cells are at 20 and the set is longer) but not how many mentions
   the missing brands have, so y of "x of y brand mentions" would be too small. The web shows no percent then (it says
   "More than 20 tracked brands") until the API sends the sum.
2. The Lost to competitor card (`ai.opportunities`, row "No tracked brand mentioned") counts the prompts with a valid
   answer that names no tracked brand. It used the denominator of the old `share_of_voice` cell (the valid answers that
   name a tracked brand), which the count share (item 13) no longer holds.

Smallest change: add to `EngineSummary`, `WeekCells` and `SummaryTotal` engines `entities_mentions_total` (integer, the
sum of `mentioned` over every tracked entity of the set, not only the cells listed) and `named_answers` (integer, the
valid answers that name at least one tracked brand). The web then divides by the total instead of the sum of the cells,
and reads the second figure for the Lost to competitor card.

Until it lands: a block with 20 cells of a longer set has no share of voice (its cell says `capped`, the words say "More
than 20 tracked brands"); the Lost to competitor card keeps its figure through the old denominator that the web keeps
beside the rewritten cell (`naming_answers`), which is right only while the API still sends the old cell.

## What the web does until each item lands

| Item | Card state until the backend lands                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Headline and trend compute AI Visibility from the outcome cells; no change in behaviour when the key lands                                                                                         |
| 2, 3 | Position card says "not collected yet"; the mean and its average are hidden                                                                                                                        |
| 4    | Sentiment and recommendation tiles and card say "not collected yet"                                                                                                                                |
| 5    | Traffic card says GA4 is not connected                                                                                                                                                             |
| 6    | Competitor drawer Sources tab says "not collected yet"                                                                                                                                             |
| 7    | Platform select lists AI Overview as not available                                                                                                                                                 |
| 8    | Groups show the most specific term of each prompt                                                                                                                                                  |
| 9    | Calendar keeps the daily answer counts                                                                                                                                                             |
| 10   | Delivered: the weekly cards read `include=series,entities`; they say "Not collected yet" only where a read carries no weekly brand cell, and "More than 20 tracked brands" at the cap (request 24) |
| 11   | The three tiles have no line                                                                                                                                                                       |
| 12   | The status line and the Runs tile tooltip carry no run number and no per-platform time                                                                                                             |
| 13   | Share of voice is derived from the entity mention cells; where there are none it says "Not collected yet"                                                                                          |
| 24   | Over 20 tracked brands there is no share of voice ("More than 20 tracked brands"); the Lost to competitor card keeps the old denominator                                                           |
