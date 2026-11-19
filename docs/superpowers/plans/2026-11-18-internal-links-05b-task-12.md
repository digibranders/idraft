# Internal links 05, Task 12 in step form: the page header

Expands Task 12 of `2026-11-16-internal-links-05-web-slices-2-3.md` (an outline) against the screens that exist on
`feat/internal-links-web` at 3b5923ad. Spec 7.1 "Page header layout" and 7.10 "Crawl picker"; mock `il.js` (`pageRow`,
`statItems`, `tabs`, `crawlMenu`, `moreMenu`).

## What the real code already has (so what changes)

- `crawl-header.tsx` is the actions group only (crawled text, More, Export, Crawl now) and is the `actions` slot of
  `PageToolbar`; the tabs are the toolbar `tabs` slot and the numbers are the `stats` slot, so the numbers sit ABOVE the
  tabs. `summary-strip.tsx` shows Pages, Tiered, T1 pages, T1 depth, No editorial links in, hidden below `md`.
- `crawlInView(runs, state.run)` gives `{ crawl, run, older, linksAvailable, unknown }` and `state.invalid.run` holds a
  malformed id (Task 10 hand-off: show not found for either).
- `changesSummaryQuery(scope, run)` answers `state` pending, first_crawl, ready, unavailable and answers for a crawl whose
  links were dropped (only the link level reads answer 410).
- `Tabs` (segmented) takes `label` text only; no badge, no icon.
- `changes` and `opportunities` are not registered in `LINKS_TABS` yet (Tasks 13 and 17): badges and the lost-links
  link must only appear for registered tabs.

## Layout

Line 1 (`CrawlHeader`): tabs left (scroll sideways inside themselves, the chosen tab scrolled into view; icons from
`xl`; a count badge on Changes and Opportunities), actions right in the order Crawl now, Export, More. Below `md` the
tabs take the whole line, the actions drop to their own right aligned line, the Export button is hidden and its item
moves into More (`useMediaQuery(MEDIA.md)`).
Line 2: `CrawlPicker` (the crawl in scope with its menu, "Older crawl", "Back to latest"), a divider, then `ContextLine`
(Tiered, T1 pages, T1 average depth, No editorial links in, the lost-links figure when there is one, and the
comparison sentence). One scrolling line, never wraps. "Pages" is dropped (the picker says the page count).

`PageToolbar` keeps only the sr-only h1; the header goes in its `children` slot. The summary strip, `stats` slot and the
`crawled` text of the old header are removed.

## Files

Create: `lib/internal-links/context-stats.ts`, `lib/internal-links/tab-badges.ts` (+ tests);
`features/internal-links/crawl-picker.tsx`, `context-line.tsx`, `tab-badge.tsx`, `crawl-not-found.tsx`,
`use-tab-badges.ts` (+ tests `crawl-header.test.tsx`).
Modify: `crawl-header.tsx`, `internal-links-screen.tsx`, `tabs.ts` (icon per entry), `components/ui/tabs.tsx`
(optional `icon` and `badge` on a segmented item), `lib/dom/use-media-query.ts` (`MEDIA.md`),
`internal-links-screen.test.tsx`, `states.test.tsx`, `messages/en.json`.
Delete: `summary-strip.tsx`.

## Steps

- [ ] **1. Failing tests (pure).** `context-stats.test.ts`: `contextStats({ tiers, noEditorial, lostToTop })` with tiers
  `T1 10 pages depth 1.34`, `T2 20`, `T3 30`, `T4 5`, Untiered 35 gives `tiered {tiered: 65, total: 100, untiered: 35}`,
  `t1Pages 10`, `t1Depth 1.34`, `noEditorial 7`, `lost 3`; with `lostToTop 0` `lost` is null; with T1 at 0 pages
  `t1Depth` is null; with no T1 row `t1Pages` is 0.
  `tab-badges.test.ts`: `changesBadge(summary)` is the alert's `lost_links` when `state` is ready and an alert exists
  with lost links above 0, else null (pending, first_crawl, unavailable, no alert, undefined); `opportunitiesBadge(counts)`
  is `open` when above 0, else null.
  Run `pnpm exec vitest run --maxWorkers=1 src/lib/internal-links/context-stats.test.ts src/lib/internal-links/tab-badges.test.ts` (FAIL: module not found).
- [ ] **2. Implement** `context-stats.ts` and `tab-badges.ts` (code in the commit); run (PASS).
- [ ] **3. Failing component tests** in `crawl-header.test.tsx` (the screen with MSW, as `internal-links-screen.test.tsx`):
  - picker: trigger text "Crawled 14 Nov, 40 pages"; opened it lists every crawl newest first as radios with date and
    "Trigger, N pages"; the checked one is the crawl in view; a queued, crawling, processing, failed or cancelled run is
    disabled with its state as the reason; a run without links is disabled with "Its links were dropped; Pages and Tier
    flow still work" only when the tab needs links (Links, Journey, Changes, Opportunities); choosing an older crawl
    writes `run=<id>`, choosing the latest removes it; an older crawl shows "Older crawl" and "Back to latest", which
    removes `run`.
  - not found: `?run=` of a listed crawl that failed, of a well formed unknown id and of a malformed text each show the
    heading "That crawl was not found" with "Back to latest" (no tab panel content), the latest crawl's picker, and no
    tab panel read; pressing the button removes `run`.
  - context line: `group` "Crawl in scope" holds Tiered, T1 pages, T1 average depth, No editorial links in; no "Pages"
    chip; the comparison sentence for ready ("Since 7 Nov: 6 pages added, 1 page lost"), pending, first_crawl and
    unavailable (scenario switches of the mock world); the lost figure appears with ready and lost_to_top above 0 and
    reads "Lost editorial links to T1 and T2"; the text never contains "equity".
  - badges: with Changes and Opportunities registered (mocked registry) the tab names are "Changes, 6 alerts" and
    "Opportunities, 12 open"; with them unregistered no request to `changes/summary` for the badge or to `opportunities`
    is made.
  - header: Crawl now, Export, More in that order in line 1; at a narrow width (matchMedia false) the Export item is in
    the More menu; wide, Export is a button and More has no export item; the header creates no live region (the
    existing announcer test stays).
  - axe in light and dark on the header with an older crawl open.
  Run (FAIL: no "Crawl in scope" group, no picker, no not found state).
- [ ] **4. Implement.** `tab-badge.tsx`, `crawl-picker.tsx`, `context-line.tsx`, `crawl-not-found.tsx`,
  `use-tab-badges.ts`, `crawl-header.tsx` (two lines), the `Tabs` `icon` and `badge` slots, `MEDIA.md`, the screen
  wiring (`needsLinks` is true for the Links, Journey, Changes and Opportunities tabs), `tabs.ts` icons (Pages
  `FileText`, Links `Link2`, Journey `Workflow`, Tier flow `Grid3x3`, Changes `History`, Opportunities `Sparkles`).
  Run the new tests and the screen tests (PASS).
- [ ] **5. Messages** (`internalLinks.picker`, `context`, `notFound`, `header.badge*`), update the old screen tests
  (strip text, `Crawl summary` becomes `Crawl in scope`), prettier, eslint, one typecheck, vitest on
  `src/features/internal-links src/lib/internal-links src/mocks src/i18n`, one `pnpm build`.
- [ ] **6. Commit** by file name: "Internal links: two line header with the crawl picker, the context line, tab badges and the not found state".

## Messages

`internalLinks.picker`: `label` "Crawl shown", `crawled` "Crawled {date}, {count, plural, one {# page} other {# pages}}",
`detail` "{trigger}, {count, plural, one {# page} other {# pages}}", `trigger.*` (Website added, Schedule, Manual, Higher
limit), `state.*` (queued Waiting, crawling Crawling, processing Processing, failed Failed, cancelled Cancelled),
`older` "Older crawl", `backToLatest` "Back to latest", `linksDropped` "Its links were dropped; Pages and Tier flow
still work".
`internalLinks.context`: `label` "Crawl in scope", `tiered`, `tieredValue`, `tieredTip`, `t1Pages`, `t1Depth`,
`noEditorial`, `lost` "Lost editorial links to {tiers}", `lostTip` "Show what changed since the last crawl",
`tierPair` "{first} and {second}", `tierRange` "{first} to {last}", `sinceFallback` "the previous crawl",
`changesReady` "Since {since}: {pagesAdded, plural, one {# page} other {# pages}} added, {pagesLost, plural, one {# page} other {# pages}} lost",
`changesReadyLinks` (the same plus ", {linksAdded, plural, one {# link} other {# links}} added, {linksLost, plural, one {# link} other {# links}} lost"),
`changesPending` "Comparing with the previous crawl is being worked out.", `changesFirst` "First crawl, so there is nothing to compare with yet.", `changesUnavailable` "The comparison with the previous crawl is not available."
`internalLinks.notFound`: `title` "That crawl was not found", `reason` "This project has no crawl with that address, or the crawl has no data. The latest crawl is one step away."
`internalLinks.header`: `badgeAlerts` "{count, plural, one {# alert} other {# alerts}}", `badgeOpen` "{count, number} open".
Removed: `internalLinks.strip`, `internalLinks.header.crawled`.

## Left out on purpose

"Client summary (HTML)" in More below `md` (Task 19 builds it). Equity is shown nowhere. The lost figure is a link to the
Changes tab only once that tab is registered (Task 13), and plain text before.
