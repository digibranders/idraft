# Port the redesigned AI visibility Overview and Prompts page to the real app

Date: 2026-11-16. Source of truth for look and behaviour: the design preview in `apps/web/design-preview` on
`origin/develop` (Overview: `aiov*.js`, spec `docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md`;
Prompts: `prompts*.js`, `index.html` section `data-view="prompts"`). Target: `apps/web/src` (Next.js app).

This plan comes from three read-only gap analyses (Overview, Prompts, backend and API) and the owner's decisions below.

## Owner decisions (2026-11-16)

1. **Topics:** flat UI now, rule later. The Groups tab shows each prompt under its most specific topic term, two levels
   (group, then its prompts), no parent rows. The Group filter and the Add prompts topic picker go flat. The backend
   rule "exactly one topic per prompt" is a separate later task (not in this port).
2. **Missing data:** build every column, card and popover exactly as in the mock against typed optional fields and MSW
   fixtures. In production they show "not collected yet" (Overview) or n/a (Prompts) until the backend lands. A backend
   request list is written for the fields below. No invented values ship in production; sample values exist only in
   fixtures.
3. **Overview:** replace the screen, keep the catalog. New default layout (the mock's 11 cards), Platform and Group
   single selects, a headline card. The other real cards stay in the Add card catalog (not deleted). Date range,
   country and Branded stay. Old multi-engine links (`engine=a,b`) fall back to All platforms.
4. **Wording and extras:** rename Engines to Platform, Topic to Group, Country to Location across the app (labels,
   messages, tests, e2e). Keep the real Panel, Type and Branded filters and the lock and type badges. Shared table
   changes apply to all pages (column chooser width row, option icons, chip hiding).

Naming note: the Prompts mock says "Engine" for its select; the owner chose "Platform", so the real select reads
"Platform". Update the preview labels afterwards so the two match.

## Rules for every builder

- Work only in your own worktree and branch (given in the brief). Own only the files listed for your package. A file
  owned by another package is read-only for you; ask the lead instead of editing it.
- `apps/web/messages/en.json` is shared: only package W0-names edits existing values. Everyone else adds keys only
  inside their own new sub-namespace, appended at the end of its parent object.
- Types are strict (no `any`), statistical rules R1 to R12 (`docs/ai-visibility/inventory/overview-and-charts.md`) bind
  every number: counts with rates, no rate under 4 valid answers, no engine pooling for a rate, unknown is never zero,
  one denominator per number, changes in points and coloured only when detectable.
- Do not port mock shortcuts: seeded series, flat rival lines, geometric position shapes, pooled-count detectability
  for averages, hard-coded key-change lines.
- Design system and component rules: `AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`. Reuse existing components. No
  new colors outside tokens. Light and dark. 1280, 1024, 768 and 390 px.
- No em-dashes or AI-slop prose in any text, comment or commit message. No attribution lines in commits.
- Before reporting: `pnpm lint`, `pnpm typecheck`, `pnpm test` (the files you touched, plus any suite you could
  break), `pnpm format:check` in `apps/web`. Report the result of each, and what you did not check.
- Commit on your branch with a clear message. Never push, never touch `main` or `develop`.

## Waves and packages

### Wave 0 (parallel, disjoint files)

**W0-names** (branch `port/w0-names`). Rename pass. Engines to Platform (labels only; API values `engine`, URL keys
and code identifiers stay), Topic to Group, Country to Location, "Topics & Prompts" to "Prompts" (sidebar, h1,
metadata, back links, budgets and citations links). Owns existing values in `messages/en.json`, and the label
assertions in unit tests and e2e (`prompts.test.tsx` L96, `project-shell.test.tsx`, `registry.test.ts`, budgets and
citations tests, e2e `shell`, `ai-prompts`, `ai-overview`, `ai-topics-by-engine`, `ai-runs-costs`, `support/*`).
Check `getByRole` names where the h1, sidebar link and "Prompts" tab now share a word.

**W0-shared** (branch `port/w0-shared`). Shared parts, additive and opt-in so other pages do not regress:
`components/ui/select.tsx` (optional option icon), `components/app/filters/filter-bar.tsx` (hide the chip of one
field), `components/app/data-table/column-chooser.tsx` plus its call in `data-table.tsx` (Narrower, Wider, Reset width
row for the identity column, reusing `IDENTITY_RESIZE`), `components/app/chart/chart-frame.tsx` and
`cards/topics/card-frame.tsx` (an "i" info button mode selected by context, footnote text kept in the DOM for PNG
export and screen readers; printed footnote stays the default for other screens), `components/app/chart/echart.tsx`
(register Treemap). Tests for each, and run the Rankings, Citations, Runs, Prompts and AI Overview suites.

**W0-facts** (branch `port/w0-facts`). Prompts data contract. New `features/prompts/facts/**`: types (position,
sentiment shares, brands, other brands, cited links, latest answer, linked-keyword volume, intent) and the pure
functions ported from `design-preview/prompts-extra.js` (equal-weight per-engine averaging, POSITION_MIN_LISTS 2,
SENTIMENT_MIN = MIN_OBSERVATIONS, LIST_SIZE 10, brand ordering, unknown states) with unit tests; a read hook that asks
for the facts in the summary read (never one request per row); `src/mocks/prompt-facts.ts` and
`src/mocks/handlers/prompt-facts.ts` (registered in `handlers/index.ts`), intent variety in
`mocks/prompt-fixtures.ts`, `include` list in `handlers/prompt-answers.ts`. Also writes
`docs/ai-visibility/backend-requests-prompts-page.md`: the exact fields the backend must add
(`linked_keyword.search_volume`, `EngineSummary.position`, `sentiment`, `recommended`, `other_brands`, `top_links`,
`latest.screenshot_url`, flat single-valued topic rule) with the smallest change for each.

**W0-overview** (branch `port/w0-overview`). Overview foundation. `src/lib/layouts/**` (catalog keys
`ai.visibility_split`, `ai.position_distribution`, `ai.sentiment_by_engine`, `traffic.ai_referrals`,
`ai.unlinked_mentions`; widths, options, the visibility metric option; competitor cards follow page scope, so the
engine option is dropped for new layouts and old stored ones are tolerated), regenerate
`backend/src/idraft/api/layouts/catalog.json` with `pnpm gen:layout-catalog`, `mocks/handlers/layouts.ts`,
`presets/presets.ts` (Default, Executive, Analyst, Competitive as in the mock), the `aiOverview.presets` strings, new
pure modules in `lib/rates/**` (visibility = sum of the three non-neither outcome cells, equal-weight average across
platforms, "avg of N" label data), the `metric` URL key and single-platform helpers in `scope/scope-model.ts` and
`scope/use-overview-scope.ts` (no behaviour change for existing keys), empty `cards/headline/index.ts`,
`cards/tracking/index.ts`, `cards/traffic/index.ts`, and the shared hook file for opening the competitor drawer.
Writes `docs/ai-visibility/backend-requests-overview.md` (`ai.visibility_rate`, `ai.mention_order_mean` and their
averages, flat single topic, sentiment and recommendation cells, referral, source overlap, AI Overview as an engine).
Also adds the `docs/16` registry rows for the two new keys.

Gate: review and merge wave 0 into `port/real-app`, run the full web checks, then start wave 1.

### Wave 1

**P-shell** (Prompts tab). `prompts-screen.tsx`, `prompt-columns.tsx`, `prompt-model.ts` sort ids, `seams/columns.ts`
context, new `engine-select.tsx` (labelled Platform), `prompts-scope.tsx`, `rate-columns.tsx` (remove the visible
"avg of N", per-platform columns off by default). Location column only when the top bar is All locations. Column
order as in the mock.

**O-shell** (Overview scope and screen). `ai-overview-screen.tsx`, `overview-context.tsx`, `scope/**` (except the two
foundation files), `header/**`, `states/**`, `notices/**`, `data/**`, `drilldown/drill-links.ts`, e2e
`ai-overview.spec.ts` and support. Platform single select with logos (AI Overview shown as not available), searchable
Group select (flat or tree from the vocabulary), Compare, reset, URL, meta line, a reason inside every card that has nothing for the scope (no "N cards not drawn" note: the owner kept every card in its place on 2026-11-16), empty
states, old `engine=a,b` links fall back to All.

### Wave 2 (parallel after wave 1 merges)

- **P-metrics**: new `columns/{intent,volume,position,recommendation,sov,sentiment}-column.tsx`, generic over row type
  so the Groups tab reuses them; sorts, tooltips, unknown states.
- **P-popovers**: `columns/{brands,links,screenshot}-column.tsx`, `features/prompts/lists/**` (list popover, brand
  rows, Add as competitor with Undo through `features/entities` hooks, answer dialog, one-platform-only visibility).
- **P-groups**: `topics-table.tsx`, `topic-tree.ts`, `topics-by-engine/**`, `topic-drawer/**`, `topic-inspector.tsx`,
  `prompt-inspector.tsx` badge, `selection-model.ts`, topic functions of `prompt-model.ts`, group filter and Add
  dialog picker flattened, the Overview topic cards parity (`cards/topics/topic-nodes.ts`, `parity.test.ts`).
- **O-headline**: `cards/headline/**` (hero, split bar, 8 tiles), `numbers/**` retirement for this screen,
  `data/aggregates.ts`.
- **O-trends**: `cards/engines/**` and `cards/competitors/**` made scope-following (trend with Average line and
  visibility metric, outcome split, share of voice, SOV over time, competitor gap with They lead and You lead).
- **O-groups**: `cards/topics/**` (heat map by platform with visibility metric, extremes hidden for one group, group
  prompts).

### Wave 3

- **O-sources-tracking**: `cards/sources/**` parity, source-type treemap by role, unlinked mentions, `cards/tracking/**`
  (position distribution, sentiment), `cards/traffic/**` (referral, "not connected" state), `cards/activity/**`.
- **O-competitor-drawer**: `features/ai-overview/competitor-drawer/**` (Overview, Prompts, Sources tabs, J and K),
  `lib/inspector/placement.ts`, the shared prompt opener extracted from `features/prompts` into a neutral home.
- **Integration**: rewrite remaining e2e assertions, `/visual` pages, fix cross-package regressions.

## Review gates

After each wave an independent reviewer (fresh agent, not the builder) compares every package against the mock file by
file and against the rules above, and reports findings with file and line. The builder fixes. Then the lead merges into
`port/real-app` and runs the full `apps/web` checks (lint, typecheck, test, format:check, build) and the relevant e2e.

## Out of scope (written up as backend requests)

Backend work: `ai.visibility_rate` and `ai.mention_order_mean` keys, the sentiment, recommendation and structured
rank classifier (WP-54), prompt to keyword links (WP-44), source categories and competitor overlap (WP-60), GA4
referrals (WP-69), untracked brands, screenshots (needs a provider spike), one topic per prompt, AI Overview as an
engine. Pushing to `develop` and releasing to `main` happen only on the owner's word.

## Mock drift (added 2026-11-16, same day)

The preview kept changing while this plan was written, so the target moves:

- Prompts preview, commit 176bdbde (local on the preview worktree, not yet on `origin/develop`): comparison defaults to
  off, the trend line moves into the Mention rate cell when comparing, Avg position shows the bare list count, Brands
  and Cited links get a green check when the own brand or site is in them.
- Overview preview, `origin/develop` 9082face: every info text says what the card shows, then how it is counted
  (`aiov-info.js`, spec section 5.0 updated).

Rule: every reviewer diffs against the newest preview at review time (`git log` on `apps/web/design-preview`), and one
last re-sync pass runs after wave 3 against the final preview, listing each preview commit made since this plan and
porting it. The owner should say when the preview is frozen.

## Preview change ledger (checked 2026-11-16, commits after the plan baseline ef780b4e)

Every package brief must cover the rows that touch it. Reviewers check each row.

| Commit | Change | Package |
|---|---|---|
| 9082face | Overview info texts say what the card shows, then how it is counted (`aiov-info.js` has the text per card) | every Overview card package, O-shell reports the mapping |
| 2577bee7 | Lock icon removed from prompt rows (type badge stays) | P-shell |
| c2eb7393 | Compare defaults off; no Trend column, sparkline inside Mention rate only while comparing; Avg position shows the bare list count; Brands and Cited links get a green check (brand named or site cited) or a grey dash | P-shell, P-metrics, P-popovers |
| 7d1382ce, 45bfeb48 | Prompts top part in fixed places (controls row, summary strip with all four platform slots); platform marks in select, strip, headers, chooser | P-shell |
| 6f3e4a9c | Overview Group select and groups heat map are one flat level, no parents | O-shell, O-groups |
| 2413d3a9 | Metric select of the platform columns removed; platform columns show the mention rate | P-shell |
| 48a5af36 | Intent column is plain text, no badge | P-metrics |
| 1cb2a311 | Density menu removed from the Prompts and Topics tables, rows always compact | P-shell, P-groups |
| 1f4101f7 | Prompt count and sort note removed from the Prompts toolbar, footer keeps the count | P-shell |
| 58088738 | Prompts strip shows AI visibility per platform (named or cited) with an info button | P-shell |
| 98e7d226 | Overview keeps one layout in every scope: every card keeps its place and smallest height, cards with nothing for a scope show why | O-shell, all Overview card packages |
| 09be48bc, 1059557d | Internal links feature | out of scope |
