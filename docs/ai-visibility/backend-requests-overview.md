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

Test: on a fixture, the value equals `1 - neither` for a prompt, a topic and the total.

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

Today: the weekly series holds the own brand only (`WeekCells` has `mentioned`, `cited`, `share_of_voice`, no entities;
inventory `overview-and-charts.md` section 0 finding 5, need N3).

Smallest change: with `include=series,entities`, add `entities` to each `WeekCells`: the same `EntityCells`
(`entity_id`, `mentioned`, `share_of_voice`) the window cells already have, for the tracked set in the response, at most
20 entities. Pool the weeks the way the own series does and keep the `is_pooled` and `pool` fields. The web draws a rival
line only from these points; it never draws a flat or invented line.

## What the web does until each item lands

| Item | Card state until the backend lands |
|---|---|
| 1 | Headline and trend compute AI Visibility from the outcome cells; no change in behaviour when the key lands |
| 2, 3 | Position card says "not collected yet"; the mean and its average are hidden |
| 4 | Sentiment and recommendation tiles and card say "not collected yet" |
| 5 | Traffic card says GA4 is not connected |
| 6 | Competitor drawer Sources tab says "not collected yet" |
| 7 | Platform select lists AI Overview as not available |
| 8 | Groups show the most specific term of each prompt |
| 9 | Calendar keeps the daily answer counts |
| 10 | Share of voice over time and the competitor trend say "not collected yet" |
