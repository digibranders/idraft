# AI visibility Overview redesign (platform and group scoped)

Status: approved by the owner on 2026-11-16 (design read in chat). Built first in the design preview, then in the app.
Extends [overview-and-charts.md](../../ai-visibility/inventory/overview-and-charts.md), which stays the source for the
statistical rules (R1 to R12), the chart catalogue (CH-nn) and the customize design. This document records what the
redesign changes.

## 1. Why

The owner's senior asked for a dashboard that shows 12 metrics for every platform, with a platform control and a group
(topic) control that drive the whole page. The senior's sheet has the columns All platforms, ChatGPT, Gemini, AI
Overview and Google AI Mode, then All groups, number of run and date. The left column names the sections: Overview,
Citation Monitoring, Prompt Tracking, Competitor Analysis, Competitor gap Analysis, Platform Comparison, Traffic
Analysis and Fan-out queries. The page must also have charts, not only tables.

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | **AI Visibility is a plain rate**: the share of valid answers where the brand is mentioned or cited. It equals 100% minus "neither". It is shown with a split bar: named and linked, named only (an unlinked mention), cited only, neither. New registry key `ai.visibility_rate` (doc 16 section 2.1 must list it before it ships). | NFR-10 forbids an opaque composite score. The senior's own definition is "percentage of responses where the brand appears". The bar carries what a blended score would hide. |
| D2 | **"All platforms" is the equal-weight average** of the per-platform values, labelled "avg of N", always next to the per-platform values. Never a pooled ratio. | Doc 16 rule 2, R3. |
| D3 | **Platform is a single select** (All platforms, ChatGPT, Gemini, AI Overview, AI Mode). AI Overview is read from rank checks of linked keywords and counts only checks that showed one; the card says "when an AI Overview appears". | AI Overview is not asked (doc 16 section 1 rule 5). |
| D4 | **Group is a single select** (All groups, or one group). Every prompt has exactly one required primary group, so group values add up to the project total. Keywords share the same groups, which allows SEO against AI per group. The taxonomy keeps its two levels (parent and topic). | One primary group removes the "a prompt counts in two topics" caveat of doc 16 section 4. |
| D5 | **No pie or donut charts.** Shares use 100% stacked bars, treemaps, bar lists and heatmaps. | DS 15, and they read more accurately. |
| D6 | The page has a headline block (the plain visibility hero and the key numbers). The metric matrix of all 12 metrics by platform was built and then removed from the page by the owner (2026-11-16); the 12 metrics stay available through the headline, the cards and their tooltips. | The owner wanted a lighter page. |
| D7 | Metrics that the backend does not collect yet (recommendation, recommendation position, sentiment, referral traffic) show an honest "not collected yet" state in the mock with labelled sample values, never a blank or a zero. | Unknown is never zero (R6). |

## 3. The 12 metrics

| Senior's metric | Definition here | Registry key | Backend today |
|---|---|---|---|
| Total prompts tracked | prompts counted once, in scope | `ai.prompts_in_scope` | built |
| AI Visibility | mentioned or cited, share of valid answers (D1) | `ai.visibility_rate` (new) | built from the four-outcome counts |
| Mention rate | A1, prompt-weighted | `ai.mention_rate` | built |
| Avg mention position | mean mention order among tracked brands, 1 = named first (A12 family) | `ai.mention_order_mean` (new) | order stored at ingest |
| Recommendation rate | A5 | `ai.recommendation_rate` | slice 2 |
| Avg recommendation position | structured rank from ordered lists only, with list coverage | `ai.structured_rank` | slice 2 |
| Share of voice | A7 | `ai.share_of_voice` | built |
| Source citation rate | A2 | `ai.citation_rate` | built |
| Brand sentiment | four shares: positive, neutral, negative, mixed (A13) | `ai.sentiment` | slice 2 |
| Unlinked brand mention | the "named only" outcome (A4) | `ai.outcome_mix` | built |
| Referral traffic | GA4 AI referral sessions | `fp.ai_referral_sessions` | needs GA4 |
| Top domain cited | C2 | `sources.top_domains` | built |

Platform availability: referral traffic splits for ChatGPT and Gemini only (Google AI Mode and AI Overview cannot be
separated from Google organic in GA4). Fan-out queries come from ChatGPT only. AI Overview has no asked prompts.

## 4. Scope behaviour

- **Platform:** a value card or trend filters to the platform. A "by platform" card becomes "this platform against the
  others". A card that cannot exist for a platform is hidden and a quiet note says how many are hidden.
- **Group:** with one group selected, the group comparison cards are replaced by the prompts of that group and the
  other cards show the group beside the project value.
- Both controls, the compare setting and the branded chip are saved in the URL (`#/ai?platform=chatgpt&group=Pricing`).
- The header line states the last run, the run number and the prompts in scope.

## 5. Layout

1. Headline: the AI Visibility hero with its split bar, then 8 tiles (mention, share of voice, citation, avg mention
   position, recommendation, sentiment, prompts, runs and last run).
2. Visibility trend (two thirds, a line per platform with the average dashed, or one platform against the previous
   period) and the outcome split per platform (one third, 100% stacked bars).
3. (The metric matrix was removed.)
4. Competitor analysis: share of voice bar list and share of voice over time (stacked area).
5. Competitor gap analysis: the gap in mention rate to each competitor and the prompts lost to each.
6. Groups: group by platform heatmap (two thirds) and strongest and weakest groups (one third). With one group
   selected: that group's prompts.
7. Citation monitoring: top domains, source types (treemap), own pages cited, unlinked mention prompts.
8. Prompt tracking: mention position distribution and sentiment by platform.
9. Traffic analysis: referral sessions by source and landing pages (sample until GA4 is connected).
10. Fan-out queries (ChatGPT only), key changes, collection runs calendar.

Every block is a card of the layout catalog (new keys: `ai.visibility_split`,
`ai.position_distribution`, `ai.sentiment_by_engine`, `traffic.ai_referrals`, `ai.unlinked_mentions`; the rest reuse
existing keys), so customize mode, presets and per-user and team layouts apply as specified in the existing doc
section 9. Presets: Executive, Analyst, Competitive.

### 5.0 Card information

Every card has an "i" button at the end of its title row. Its text says how the card is counted and what it leaves
out. Hover or keyboard focus shows it in a tooltip; a click opens it in a small popover, which is how touch reaches
it. Nothing is printed under a card. The headline block has one button, on the AI Visibility hero; the key numbers
keep their definitions on hover.

### 5.1 Customize mode (built in the preview)

- **A layout is a list of cards** with a width each, at most 12 (the layout library's limit). The headline hero and
  tiles are one card, `ai.visibility_split`, so the numbers zone of the library is not used on this page yet.
- **The default shows 12 of the 18 cards (Brand sentiment among them)**, one for each section of the senior's sheet. The other cards are in the
  card catalog. Presets: Default, Executive, Analyst, Competitive; each fills complete rows of 12 columns at 1280 px.
- **Controls:** Customize toggle, a toolbar on every card (drag handle with arrow keys, width, hide, move menu), an
  Add card slot that opens the catalog, Start from (presets), and a save bar with Reset, Cancel, Save layout and a
  menu for Save as team default and Remove team default (both ask first, because other people see the change).
- **Resolution:** the person's own layout, else the team default, else the built in Default. Reset goes back to the
  team default when there is one. Leaving with unsaved changes asks first, by route change, Escape or Cancel.
- **Scope and layout are separate:** a card that cannot be drawn for the platform or group stays in the layout. It is
  hidden outside customize mode (a note names it) and shows a placeholder while customizing.
- **Not built yet:** per-card options (for example the trend's metric lives in the page scope), a free resize grip,
  undo and redo, and the layouts API. The preview stores layouts in browser storage under the key convention of the
  project Overview (`preview-layout:<kind>:ai_overview`).

## 6. Statistical rules that bind every card

R1 counts with every rate, R2 no rate below 4 valid answers (hatched cell, "3 answers"), R5 changes in points and coloured
only when detectable, R6 unknown is never zero, R9 share of voice names its tracked set, R10 branded prompts excluded by
default, R11 mentions and citations are never on one axis, R12 one denominator per number.

## 7. Design preview build

Route `#/ai`, files `aiov-*.js` in `apps/web/design-preview/`. Data is computed from the existing prompts fixture
(`prompts-data.js`: 250 core prompts, three asked engines, AI Overview from rank checks, five competitors, 13 topics in
two parents) plus a deterministic layer for the measures the fixture lacks (joint mentioned and cited counts, mention
order, sentiment, domains, fan-out queries, referral sessions). No fixture file is changed. Theme tokens only, no new
colours. Verified on the localhost origin in a background tab, in light and dark, at 1280, 1024, 768 and 390 pixels.

## 7.1 Competitor drawer (built in the preview)

The Competitor gap card shows counts, "They lead" and "You lead" per competitor. A competitor name, a count, or a
competitor row of the Share of voice card opens the **competitor drawer** (440 px, the planned competitor inspector,
`inspect=entity:<id>`; WP-39 / WB-CMP-12). A count opens it on the Prompts tab with that kind of lead chosen.

- **Lead rule:** a brand leads a prompt when it is named in at least 2 more answers than the other, over the platforms
  in scope, and the prompt has at least 4 valid answers. A smaller difference is "equal or too close", because with
  about 8 answers a prompt a one answer difference is mostly noise. The card and the drawer read the same counts (R12).
  Owner default 2026-11-16 (the owner said "go ahead" to the recommended threshold).
- **Overview tab:** you against the competitor for mention rate, share of voice and source share (gap in points, not
  tested for detectability), a two line trend, and the same by platform.
- **Prompts tab:** They lead, You lead and Equal with counts; an "You are absent" chip under They lead (the plan's
  "lost to" definition: the competitor is named and you never are); the groups where it happens most (click to narrow);
  up to 10 prompts, largest difference first, with both rates as paired bars; a link to the full filtered list
  (`opp=lost_to:<id>`). A prompt opens in the prompt drawer.
- **Sources tab:** the domains answers cite when each of you is named, their overlap (Jaccard, metric C7), and the
  domains in their top 8 and not in yours.
- The drawer follows the page scope and steps with J and K through the competitors in the card's order.
- **Backend need:** the per-competitor mentions per prompt (the summary with `include=entities`) for the Prompts tab,
  and the source overlap read for the Sources tab. Not built: Competitors page, the filtered prompt list link target.

## 8. Not decided yet

- Whether "All platforms" averages AI Overview in for the metrics it supports (the mock includes it only for mention,
  citation, share of voice and mention position).
- Whether the group select shows the two-level tree or a flat list once there are more than 13 groups.
- The exact tiles of the Executive and Analyst presets.
