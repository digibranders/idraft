# Release A: the first production test of AI visibility

Written 2026-11-13 evening by the coordinator. Releases happen only on the owner's word ("ship it") through
`infra/ship.sh`. Nothing here is shipped until then.

## What release A is

The first version of AI visibility that the owner can open in production and judge: an Overview dashboard that
is customizable like the approved preview, topics performance by engine, a Citations page, a complete prompt
inspector and topic drawer, and the backend behind all of it. It is the smallest release that shows the whole
idea working end to end.

Target size: about 272 of the 1,017 new rows built (27 percent), about 43 percent of the whole feature.

## What is already on develop (waiting to be released)

Backend, merged: layouts API (core.layouts, migration 0021), summary additions (compare periods, API pooling,
small cells, filters, by country), prompt records (lint upgrade, prompt type rule, bulk update by filter,
quotas, ETag and If-Match, term assignments, migration 0022), sources reads (diversity, domain detail,
new and lost, flagged citations excluded by default, fan-out topics).

Web, merged: chart platform and chart parts, shared app parts, table extensions, list rows and presets and date
range picker, the layouts core and the full customize UI, prompt inspector completion, topics by engine with the
topic drawer (competitors, related, prompts by engine, in search), the Citations tab in the inspector and the
Citations page (Domains and Pages, live in the sidebar).

## Scope, in priority order

### Tier 1: must be in release A (the point of the release)

1. Overview dashboard: WP-32 (backend aggregates), WP-33 (page shell, scope, numbers, presets, export),
   WP-34 to WP-37 (the cards: rates by engine, outcomes, funnel, change summary, share of voice, lost to a
   competitor, topics by engine, sources, fan-out, activity). Customizable with the five presets, per user and
   team default. This is requirements R-06, R-07, R-08.
2. Topics by engine on the Overview too (WP-36 reuses the WP-20 parts). Requirement R-09.
3. Compare with the previous period and deltas everywhere: WP-19. Without it the Overview shows numbers
   without direction, which makes it much weaker than the Nuwtonic dashboard.
4. Release hygiene (no new features, but a release is not safe without it): the quality sweep below.
5. Real data to look at (see "Data for the test").

### Tier 2: should be in release A if the time allows (each is cheap and raises trust)

- WP-22 Citations New and lost (16 rows): the "lost sources" story is the most actionable part of citations.
- WP-26 Evidence viewer completion (14 rows, includes the hashes that close WB-PI-23): evidence is what makes
  the numbers believable.
- WP-30 Runs, costs, budgets and collection health (13 rows to do): freshness and "is data arriving" belong in
  a first test.
- WP-31 Settings: engines page extras and setup checklist (7 rows): how the owner turns engines on.
- WP-17 Topics & Prompts header, filters and menus (22 rows): polish of a page that already works.

### Tier 3: not in release A (release B and later)

- WP-27 and WP-28 Add prompts and Import dialogs redesign (R-10): about 144 rows, the largest block. The
  current dialogs keep working. This is the next release.
- WP-24 Fan-out tab, WP-29 menus and edit details, WP-39 Competitors page, WP-18 table polish, WP-23.
- Everything from Wave 4 on (versions, discover inbox, alerts, exports, command palette, page-level AI
  readiness, and so on).
- F-23 customize mode inside the real prompt and topic drawers (the generic parts exist and are tested).

## Work plan (3 working sessions, one subagent each)

| Stream | Now | Then |
|---|---|---|
| Backend | WP-32 aggregates: contract first push, then routes | support for WP-19 and the cards if a read is missing |
| Overview web | WP-33 shell: T1 to T6, milestone M1 at T6 | WP-34, WP-35, WP-36, WP-37 cards one after another |
| Third session | WP-21 finishing (e2e, As built, final push) | WP-19 compare, then WP-34 or WP-36 in parallel with the shell owner |

Critical path: WP-33 milestone M1 (about 5 hours) then four card packages (about 8 to 10 hours with two
sessions in parallel) then integration, e2e and a browser pass (about 3 hours). Estimate: 18 to 24 hours of
running time, so release A is ready for "ship it" tomorrow evening if the sessions run overnight.

## Quality sweep before "ship it" (about 3 hours, partly in parallel)

1. Full e2e run once on develop (it was not re-run after the last merges). Fix the red specs: F-03 list
   (costs-runs, keyword-detail, schedules, shell), F-06 Keywords page overflows 87 px at 375 px.
2. F-24 build the methodology page, so every metric info link works (small static page from
   docs/16-metrics-methodology.md).
3. F-25 and the WP-20 limits (drawer header at exactly 440 px, a manual look), F-21 toast covering the save bar,
   F-20 table header, the three load flakes (F-05).
4. Overview verification in a real browser: 390, 768, 1024, 1280, light and dark, customize mode, presets,
   save, discard, conflict, export.
5. Migrations 0021 (layouts) and 0022 (prompt value sources) apply cleanly on the server; run ANALYZE after
   (F-12).
6. `infra/ship.sh` checks pass on the machine (backend about 6,000 tests, web about 7,600 tests, build).

## Data for the test

The AI answer schedules stay paused (owner rule). Without answers the pages show their empty states, so
release A needs one controlled data load: enable the engines for the Eventus project and run the bulk run once
(144 answers, about 0.17 USD). This needs the owner's yes, a budget set first, and the DataForSEO credentials.
Alternative with no spend: the dev seed (devseed) fills the dev database only, not production.

## Decisions needed from the owner before release A

- O1: flagged citations (Gemini grounding redirects, google.com) excluded from shares by default. Reverse is
  one constant.
- The nine defaults taken in WP-20 and the WP-33 plan choices (page order, Competitive preset, client side
  aggregation first).
- Latest stands in for the Overview tab on prompts (default yes).
- Real data run: yes or no, and the budget.
- Mac restart and Docker prune (machine health only).

## Risks

- Machine load: other projects on the same Mac slow the sessions; the heavy lock and the watcher keep it safe
  but add waiting time.
- WP-33 is the biggest unknown (13 tasks, the page that all cards depend on).
- Backend shape changes late in WP-32 would force card rework: WP-32 publishes its contract first to avoid it.
- No real data until the owner approves spend: the first look may show empty states.
