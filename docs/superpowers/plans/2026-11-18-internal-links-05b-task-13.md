# Internal links 05, Task 13 in step form: the Changes tab

Expands Task 13 of `2026-11-16-internal-links-05-web-slices-2-3.md` (an outline) against the screens on
`feat/internal-links-web` at c49b4494. Spec 7.10 "Changes tab"; mock `il-changes.js` (`strip`, `alertBanner`,
`linksPanel`, `movedPanel`, `render`).

## What the real code already has (so what changes)

- `LinksTabContext` already has `crawl` (`run`, `linksAvailable`), `state.changesScope` (`cs`, parsed in Task 10),
  `inspect.open`, `registerExport` (the screen owns the in-flight guard and the failure toast: problem detail, else its
  title), `scope`, `timeZone`. Nothing is added to the context.
- `changesSummaryQuery`, `changeLinksQuery`, `changeLinksExportQuery`, `changeLinksPath`, `movedPagesQuery`,
  `isChangeLinkPage`, `isLinksDropped`, `LinksDropped`, `alertText`, `sinceText`, `priorityTone`, `formatDelta`,
  `depthMove` exist (Tasks 8, 10, 11). The MSW changes world answers all four summary states through `setLinksScenario`.
- The screen already shows the Changes badge and the context line link once the tab is registered; it only needs the
  entry in `LINKS_TABS` (the `History` icon).
- The tables are `PlainTable` (not `DataTable`): the changes API has no search, sort or column choice, and `DataTable`
  always draws a search box. Paging is the shared `TableFooter` fed an offset pager (`offset-paging.ts`).

## Decisions

- One links table with a Lost | Added switch (`SegmentedControl`, state of the tab, not of the address), the link scope
  menu on `cs`, and an "Only to T1 and T2 pages" switch (Lost only; default follows the summary: on when anything was
  lost to the important tiers). The mock has two panels; the owner's brief for this task has one table with a switch.
- Page size 100 or 200 (the API takes 200 at most; `TableFooter` sizes are 100, 200, 500).
- Summary states: `ready` full; `pending` neutral note, no strip, the lists still read; `first_crawl` and `unavailable`
  neutral empty states, no Try again. A ready summary whose link counts are all zero while the previous crawl's links
  were dropped says so (the crawl list says `links_available` false for `previous_run_id`).
- A crawl past the last four: the links table is `LinksDropped` and its read is not made; the 410 is also handled if it
  arrives. Moved pages and the summary still answer for such a crawl.
- "Change alert rules" button: not built (alert settings are Task 14, nothing to open yet). Equity is never read or shown.

## Files

Create under `apps/web/src/features/internal-links/changes/`: `offset-paging.ts` (+ test), `changes-tab.tsx`,
`changes-strip.tsx`, `change-links-panel.tsx`, `moved-pages-panel.tsx`, `changes-tab.test.tsx`.
Modify: `tabs.ts` (the entry), `messages/en.json` (`internalLinks.changes`).

## Step 1: failing tests

`offset-paging.test.ts`
- `nextOffset(0, 100, 250)` is 100; `nextOffset(200, 100, 250)` is `null`; `nextOffset(100, 100, 200)` is `null`.
- `previousOffset(0, 100)` is `null`; `previousOffset(50, 100)` is 0; `previousOffset(300, 100)` is 200.
- `rangeOf(100, 50, 250)` is `{ from: 101, to: 150 }`; `rangeOf(0, 0, 0)` is `{ from: 0, to: 0 }`.

`changes-tab.test.tsx` (harness `internalLinksAs('editor', EVENTUS_LINKS)`, `?tab=changes`, mock crawl)
- ready: the group "Changes since the last crawl" shows Editorial links lost 6, Editorial links added 2, Pages added,
  Pages lost; the alert text "2 editorial links to T1 and T2 pages were lost since" with "Alert shown in the app".
- The links table is named "Lost links"; T1 targets first, badges "Lost to T1" and "Lower priority", cell
  "Still linked from Navigation" and "No longer linked".
- Lost reads `change=lost&only=top&link_scope=editorial`; the switch off reads `only=all`; Added reads `change=added`
  with `only=all`, no priority column, and the switch is gone.
- `cs=all` reads `link_scope=all`; the scope menu writes `cs`.
- Paging: 120 rows served in two offsets; Next reads `offset=100`; Previous reads `offset=0`; page size 200 reads
  `limit=200` from offset 0.
- Moved pages: a row with `+1` and a depth text; `No longer reachable` for `depth_state: 'lost'`.
- States: `firstCrawl` shows "This is the first crawl." with no Try again and no tables; `enrich: 'running'` shows
  "Working out what changed" and still lists the moved pages; `enrich: 'failed'` shows "Changes could not be worked out
  for this crawl"; a ready summary with zero counts and a previous crawl without links says the previous crawl's links
  are not stored; the oldest crawl (`run=` the fifth) shows the Links of this crawl are not stored message in the
  table and makes no links read; a 410 on the links read does too.
- Errors: a 500 on the summary shows "The changes could not be loaded" and Try again re-reads; a 500 on the links read
  shows the table's own error with Try again; empty lost list says "No editorial links were lost"; empty with top on
  and lost elsewhere offers "Show all lost links".
- Row click: the source page button opens the inspector for that url id (`inspect=page:<id>` written).
- Export: the Export menu calls `downloadApiFile` with the changes links path and the current view
  (`change`, `link_scope`, `only`, `format: 'csv'`), no `limit`/`offset`; a second press while running is refused
  ("The export is being prepared"); a rejected download toasts "The export could not be made" with the problem detail.
- Equity: no text or `aria-label` contains "equity", and no request or export query does.
- axe in light and dark.

Run: `pnpm exec vitest run --maxWorkers=1 src/features/internal-links/changes`. They fail because the tab is not
registered and the files do not exist.

## Step 2: implement

`offset-paging.ts`: the three pure functions of the outline plus `useOffsetPaging(resetKey)` returning
`{ offset, size, next, previous, setSize, reset }` (state keyed by `resetKey`; a new key starts at 0).
`changes-strip.tsx`: `MetricStrip` md with five items (see the test list), `aria-label` from `strip.label`.
`change-links-panel.tsx`: head (h2 + meta + controls) and `PlainTable` + `TableFooter` inside; props `change`,
`only`, `linkScope`, query result and callbacks come from `changes-tab.tsx`, which owns the state and the export.
`moved-pages-panel.tsx`: its own query, `PlainTable`, delta cells with sign and tone.
`changes-tab.tsx`: summary and crawl list reads, the state switch, the export registration.

## Step 3: messages, checks, commit

Keys under `internalLinks.changes` (all in `en.json`): see the file. Checks: prettier, eslint, one typecheck,
vitest over `src/features/internal-links`, `src/lib/internal-links`, `src/mocks`, `src/i18n`, one `pnpm build`.
Commit by naming files: "Internal links: the Changes tab with lost and added links, the alert and the pages that moved most".
