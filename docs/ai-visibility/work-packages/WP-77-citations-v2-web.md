# WP-77: Citations v2 web (the preview's Citations page, exactly)

| Field | Value |
|---|---|
| Wave | X: owner change of 2026-11-16 (Citations replaces Sources) |
| Kind | web |
| Status | new; the coordinator adds it to `docs/ai-visibility/tracker.json` |
| Branch and worktree | `ai/wp-77-citations-v2-web` in `.claude/worktrees/wp-77` (`infra/dev/wp-start WP-77 citations-v2-web`) |
| Depends on (merged on develop first) | [WP-76 citations-v2-api](WP-76-citations-v2-api.md) and its `pnpm gen:api` commit |
| Owner decisions | Section 2, accepted 2026-11-17 |
| Estimate | 11 Sonnet-agent tasks, about 9 hours with one task in flight |
| Detailed plan | `docs/superpowers/plans/<date>-ai-wp-77-citations-v2-web.md`, written by Opus at step 0 once the generated types exist (section 6) |

## 1. Goal

Replace the real `/ai/citations` screen with the design preview's Citations page (`apps/web/design-preview`, route `#/citations` and `#/citations/gaps`, files `cit.js`, `cit-inspector.js`, `cit-data.js`; committed fff09a26 and d54204f8 on develop). **The owner asked for an exact match**: same layout, controls, columns, widths, copy, tooltips, states, drawers and keyboard behaviour. Section 3 is the parity spec. Where the app cannot match, section 2 lists the forced differences; nothing else may differ.

## 2. Decisions

Accepted by the owner on 2026-11-17 as proposed ("Accept defaults"), including the one copy change of section 3.5 ("No page of your site contains ..."). WP-76 and this package build on them; changing one later is a single line in the plan.

| # | Question | Default | Why |
|---|---|---|---|
| D-1 | The preview's "Group" select: what is a group in the app? | The prompt's topic terms (the Topics vocabulary, a term or one under it). Label and copy stay "Group" and "All groups" as in the preview. | The app has no prompt group table; topics are how prompts are grouped. |
| D-2 | What is a "run"? | Per prompt and engine: one collection run with a valid answer. "Last 4 runs" is each pair's last four; "the runs before" the four before those. | A manual run covers only the prompts someone picked, and two schedules split the prompts between them; a project-wide run number would make "Last run" a 5 prompt sample. |
| D-3 | What does Citation growth compare? | All answers, as the preview (copy unchanged). Alternative: only the prompt and engine pairs answered in both windows (`matched_*` in the response), with the how text "Total citations now minus before on the prompts answered in both windows, divided by before." | Exact match by default; the alternative stops a prompt added last week from reading as growth. |
| D-4 | Platforms | The project's enabled engines: ChatGPT, Gemini, Google AI Mode today. Google AI Overview joins the select when its engine ships (WP-64). | The preview shows four; the app has three engines. |
| D-5 | Old tabs and controls | Removed: Domains and New and lost tabs, the date range picker and country control in the top bar, saved views, More actions, min support, sort select, column chooser, density, branded and flag toggles, the domain and source inspectors. | They are not in the preview. The `ai/sources/*` routes stay (the Overview cards use them). |
| D-6 | Cited pages volume | Server sorted, searched and paged, 200 rows per page; the next page loads when the table is scrolled to its end. Owner counts and the footer totals come from the response. | The preview filters every URL in the browser; a real third-party list is thousands of rows. |
| D-7 | Default competitors | The first three tracked competitors in Settings order. | As the preview. |
| D-8 | The planned Sources page | The `sources` navigation entry is removed; WP-61 is re-scoped by the coordinator (Publishers and Categories, if still wanted, live elsewhere). | The owner said one Citations page replaces Sources. |
| D-9 | "Cited alongside" in the page drawer | Counted once per answer ("k of N" never exceeds N). | The preview counts each other URL, so a domain with two URLs in one answer counts twice and "k of N" can pass N. |
| D-10 | A prompt with no topic | Group cell "No group" in tertiary, sorted last; the drawer shows no group badge; the closest page card says "No page of yours is cited for this group" and lists nothing. | The preview's prompts always have a group. |

## 3. Parity spec (the preview is the source of truth)

Line references are to `apps/web/design-preview/cit.js` (C) and `cit-inspector.js` (I) at d54204f8. When this table and the preview disagree, the preview wins; fix the table.

### 3.1 Page and address

| Item | Preview | App |
|---|---|---|
| Layout | Toolbar row, metric strip, one table panel that fills the page and scrolls inside (C 183 to 332) | Same; no page header row; `<h1 class="sr-only">Citations</h1>` |
| Tabs in the route | `#/citations` (Cited pages), `#/citations/gaps` (Gap analysis) | `/ai/citations` and `/ai/citations/gaps` (a sibling route segment) |
| Query keys | `platform`, `group`, `runs`, `comp`, `owner`, `gaps`, `q`, `inspect` (C 40 to 66); defaults are not written | Same keys and defaults: `platform=all`, `group=all`, `runs=4`, `comp`=first three, `owner=own`, `gaps` absent means only gaps (`gaps=all` shows all), `q` up to 200 characters; unknown values fall back to the default. Old keys (`tab`, `role`, `kind`, `engine`, `win`, `from`, `to`, `min`, `sort`, `domain`, `cols`, `density`, `country`, `cmp`, `topic`, `branded`) are read once: `tab=pages` or `tab=domains` opens Cited pages, `tab=new-lost` opens Cited pages, `role=own|competitor|third_party` becomes `owner`, `topic` becomes `group`, the rest are dropped, and the address is rewritten without them |
| Leaving the page | Its query does not follow to the next page (C 720 to 724) | Same |
| Inspector targets | `inspect=cited-page:<url>`, `inspect=gap-prompt:<id>`; a shared link reopens the drawer (C 730 to 733) | `inspect=cited-page:<url_id>` and `inspect=gap-prompt:<prompt_id>` (two new `INSPECTOR_TYPES`, width 440); `inspect=prompt:<id>` opens the prompt inspector in place |

### 3.2 Toolbar (C 110 to 198)

| Control | Preview | Notes for the app |
|---|---|---|
| Platform select | Name "Platform"; options "All platforms" then each platform with its logo; menu `min-w-52`, trigger `sm:w-56` | Options from the enabled engines (D-4) |
| Group select | Name "Group"; searchable; "All groups" then the groups; menu `min-w-60`, trigger `sm:w-52` | Options: the topic terms (D-1) |
| Runs select | Name "Runs"; "Last 4 runs" note "28 days", "Last 2 runs" note "Sep 21 to Sep 28", "Last run" note "Sep 28"; menu `min-w-56`, trigger `sm:w-44` | From the `window.trend` slot dates of a `runs=4` read, in the project's zone: 4 runs "N days" with N = whole days from slot 4's first answer to slot 1's last answer plus the median days between consecutive slots (one run's length: four weekly runs give 28); 2 runs "<slot 2 last, MMM d> to <slot 1 last>"; 1 run "<slot 1 last>". With fewer slots than the choice, the note names the slots that exist |
| Competitors | Trigger "Competitors:" then up to two names, "+N" for more, "None" when empty, chevron; `sm:w-60` | Same |
| Competitors popover | Dialog "Competitors to compare"; head "Compare with" and "k of 5"; one row per tracked competitor: checkbox, color dot, name, domain at the right; rows past five disabled at 50% opacity; stays open after a change; foot "Up to 5 tracked competitors. Manage the list in Settings." (C 142 to 173) | Tracked list from the entities read (role competitor), color from `color_index`, domain from the entity's domains; the selection keeps the tracked order |
| Reset | Icon button "Reset scope" (undo icon), invisible at the default scope on desktop, hidden below `lg` (C 175 to 181, 696 to 698) | Same |
| Layout | Scope group is a 2 column grid below `lg`, a wrapping row from `lg` | Same |
| Export | Button with download icon, "Export", at the right (`xl:ml-auto`) | Exports the visible tab as CSV with `@/lib/csv/csv-write` (the preview only shows a note) |

### 3.3 Metric strip (C 200 to 257)

One `dl`, `grid-cols-2`, `@xl:grid-cols-3`, `@5xl:grid-cols-6` by the strip's own width (container query), 1 px gaps on `bg-border-subtle`, rounded border. Each slot is one 36 px line (`h-control`): label at the left (`type-meta`, truncates), figure at the right (`type-body-strong`, `num`), optional delta after it. No info buttons. The tooltip of the whole slot and of the figure (focusable, `aria-label` = label, value and tooltip) is: what, then context (capitalised, full stop), then tip, then how.

| Slot | Label | Value | Delta | Context | Tip |
|---|---|---|---|---|---|
| citations | Total citations | own units | none | "in N answers" | "Citations of <own domain> pages in N answers to M prompts." |
| frequency | Citation rate | equal-weight average of the engines' `answers_citing / answers`, 1 decimal; "n/a" | `trendIcon` points change, tone only when `isDetectableChange` | All platforms: "average of K platforms"; one platform: "k of n answers"; "no answers" | "k of n answers cite you[, summed over the platforms. The rate is their equal-weight average]. Change against <previous text>." |
| coverage | Prompt coverage | same with `prompts_citing / prompts` | same | "average of K platforms" / "k of n prompts" | same with "prompts cite you" |
| urls | Unique cited URLs | `own_urls` | neutral signed count, nothing when equal; tooltip "N before. Counts are not tested for detectability" | "pages of <own domain>" | none |
| domains | Unique cited domains | `domains` | same | "in answers to your prompts" | none |
| growth | Citation growth | `formatRelativeChange((citations - previous_citations) / previous_citations)`; "n/a" when previous is 0 | none | "+N vs the previous 4 runs" (signed difference, `previousText()` without its dates, C 255) | "N citations now, M in <previous text>." (the same counts as the value; under the D-3 alternative all three use `matched_*`) |

The what and how texts are the `INFO` table (C 210 to 217), word for word, with the own domain from the project. `<previous text>`: "the previous 4 runs (Aug 10 to Aug 31)", "the 2 runs before (Sep 7 to Sep 14)", "the run before (Sep 21)", with the dates of the previous window's slots (C 99 to 104).

### 3.4 Tabs and table toolbar (C 259 to 330)

- A segmented tablist "Citations views" at the start of the table toolbar: "Cited pages" and "Gap analysis"; the active one `border-primary-border bg-primary-subtle type-body-strong text-primary-text`; the gap tab shows a neutral count badge of `meta.gaps` (screen readers: ", N gaps"), absent when no competitor is chosen.
- Then a hairline divider (`md` and up), search (placeholder "Search pages" / "Search prompts and groups", `aria-label` "Search in table", `aria-keyshortcuts` "/", `/` focuses it, 200 characters), the tab's controls, and the tab's summary at the right.
- Counted nouns use the preview's `plural()` everywhere: "1 citation", "2 citations", "1 answer", "to 1 competitor".
- The panel is at least 384 px tall (`min-h-96`). Footer, 48 px: the tab's count text at the left, "Updated <latest answer, MMM d, HH:mm> · run <latest_run_number>" at the right.
- Empty states replace the table: title, `max-w-reading` text, one button (C 381 to 394).

### 3.5 Cited pages (C 410 to 571)

Owner filter, a pressed-button group "Domain type": "Your site", "Competitors", "Third-party", "All", each with its count (`meta.owners`); changing it resets the sort. Footer: "N pages · M citations" (from `page.total` and `meta.citations`).

| Column | Width | Header tip | Cell |
|---|---|---|---|
| Page (sortable, pinned) | 280 | none | Own: the path; others: domain in `text-foreground-tertiary` then the path; tooltip "<title> (<url>)"; "New" neutral badge when `previous_citations == 0`, tooltip "Not cited in <previous text>" |
| Domain type (only when owner is not Your site) | 140 | none | Color dot (own `chart-1`, competitor its color, third-party `chart-other`) and "Your site", the competitor's name, or "Third-party" |
| Citations (sortable) | 104 | "Answers whose citation list includes this URL" | count |
| Change (sortable) | 88 | "Against <previous text>. Counts are not tested for detectability" | neutral signed count, else "No change" in tertiary |
| Prompts (sortable) | flexible, at least 280 | "How many tracked prompts cite this page, and the one that cites it most" | count (32 px), the top prompt (truncates; tooltip "Cited most for: <text> (N×)"), then a chip "+N" or "Details" that opens the prompts popover |
| Platforms | 196 (all) or 112 (one) | "Citations on each platform" | per engine: logo and count, 40% opacity at 0; tooltip "<engine>: N citations" |
| Trend | 104 | "Citations in each of the last 8 weekly runs" | 96 px sparkline, 20 px high, owner color; label "Citations per run, oldest first: ...". A project with fewer than 8 slots draws the slots it has (`window.trend`), and the tip says "last N runs" |
| Last cited (sortable) | 104 | none | `MMM d` of `last_cited_at`, "n/a" |

Default sort: Citations descending; a header click sorts descending, a second click ascending. Ties: citations, then address.

Prompts popover (C 416 to 444): dialog "Prompts that cite <path>", head "Cited for" and "N prompts · M citations", an ordered list of up to 10 prompts with "N×", foot link "Show all N prompts" (more than 10) or "Open the page details", which opens the page drawer on its Prompts tab. Width 384 px.

Owner nouns of the empty states (C 26 to 31): Your site "your", Competitors "competitor", Third-party "third-party", All none. The preview's "No your page contains ..." reads badly: write "No page of your site contains ..." and "No pages of your site are cited in ..." for Your site (the one copy change to the preview, accepted 2026-11-17), the preview's wording for the others.

Empty states: no rows at all "No citations in this scope" / "No answer in <scope text> cites a page. Choose more runs or another group." / Reset scope. No match: "No pages match" / 'No <owner noun> page contains "<q>".' or "No <owner noun> pages are cited in <scope text>." / Clear search or Show all pages. `<scope text>` is "<platform>, <group>, <runs label>".

### 3.6 Gap analysis (C 573 to 686)

Controls: checkbox "Only gaps" (default on). Summary at the right: "**N** of M prompts lost to a competitor on at least one platform". Footer: "N prompts[ with a gap]".

| Column | Width | Header tip | Cell |
|---|---|---|---|
| Prompt (sortable, pinned) | flexible | none | prompt text, truncates, tooltip the text |
| Group (sortable) | 136 | none | the topic name, secondary |
| <own brand name> (sortable) | 120 | "Whether answers to the prompt cite your site, with how many answers do" | the mark below, with `lost = gap` |
| each selected competitor (sortable) | 120 | "Whether answers cite <domain>" | the mark, neutral; header starts with the competitor's color dot |
| Lost on (sortable, default descending) | 184 | "Platforms where a selected competitor is cited and you are not" | engine logos of `lost_on`, then "to N competitors"; tooltip "Lost on <engines> to <names>"; "None" in tertiary when not lost |

The mark (`statePill`, C 589 to 606): a 24 px box with a check icon when cited, a minus when not (a mention without a link is a minus), "n/a" with no answers; screen reader text "Cited" or "Not cited". Only your mark has a tone: positive when cited and lost nowhere, warning when cited but lost on another platform, negative when not cited and lost, tertiary otherwise. Competitor marks are `text-foreground` when cited, tertiary otherwise. Tooltip: one sentence per engine joined by ". ": "<engine>: cited in k of n answers", "mentioned in m of n answers, never cited", "not cited in n answers", "no answers".

Sorts (C 613 to 620): prompt and group by text; you by state rank (cited 3, mentioned 2, not 1, none 0), then engines cited on, then citing answers; a competitor by its citing answers; Lost on by gap, then lost-to count, then competitor answers. Ties by prompt text. This sort and the search and "Only gaps" run in the browser over `data` (at most the project's prompt limit).

Empty states: no competitor chosen "Choose competitors to compare" / "The gap analysis compares you with up to 5 tracked competitors." / Choose competitors (opens the popover). No answers "No answers in this scope" / "No prompt in <scope text> has an answer yet." / Reset scope. Search "No prompts match" / 'No prompt or group contains "<q>".' / Clear search. No gaps "No gaps in this scope" / "On every platform, the prompts that cite a selected competitor also cite you." / Show all prompts.

### 3.7 Page drawer, `cited-page` (I 71 to 207)

Header: title = page title; badges: owner badge (dot + "Your page" / competitor name / "Third-party") then the scope parts (platform, group, runs label); context "Cited page · i of n · N citations". Tabs: **Prompts** (default), **Overview**. J and K step through the table's order.

- Prompts: card "Prompts that cite this page", meta "N prompts · cited in M answers"; compact table Prompt (button, opens the prompt inspector with this list for J and K, tooltip "<text>. Open its answers") / Platforms (logos, 25% opacity where 0; tooltip "<engine>: k of n answers" or "no answers"; width 96 or 80) / Cited ("k/n", tooltip "Cited in k of the prompt's N answers"; width 80, right). Empty "No prompt cites this page" / "Nothing in this scope. Choose more runs or another group."
- Overview: Summary card (meta "change against the runs before"): Citations with signed change, Prompts, Last cited; then the address field (link icon, the URL as cited, truncates) with a copy button (tooltip and label "Copy address", copies the full URL; toast "Address copied", error toast "Could not copy the address" / "Copy it from the field instead.") and an open button (tooltip "Open the page", label "Open the page in a new tab", opens it in a new tab with `noopener`). "Citations per run" card (meta "last 8 weekly runs"): 56 px sparkline, axis first and last trend slot dates. "By platform" (meta "citations · share"): Platform / Citations / Share (0 decimals). "Cited alongside" (meta "domains in the same answers"): Domain with dot and "Your site" or "Competitor" badge / Answers "k of N" (tooltip "Cited in k of the N answers that cite this page"); empty "Cited alone" / "No other domain is cited in the answers that cite this page."

### 3.8 Gap drawer, `gap-prompt` (I 209 to 331)

Header: title = prompt text; badge = group (none for a prompt with no group, D-10); context "Prompt · i of n · lost on <engines>" or "not lost on any platform". Tabs: **Gap** (default), **By platform**.

- Gap: "Who is cited" (meta "N answers", tool button "Open answers" with message icon, opens the prompt inspector): Brand (dot + name; own first) / State (the mark, width 144) / Answers ("k of n"). "Pages competitors win with" (meta "what to answer better"), empty "No competitor page is cited" / "None of the selected competitors is cited for this prompt in this scope.". "Your closest page" (meta "update it before writing a new one"): own pages cited here ("Cited in some answers to this prompt"), else the closest pages ("Cited for other <group> prompts"); empty "No page of yours is cited for <group>" / "This prompt needs a page of its own. Start from the competitor pages above.". "Third-party pages in these answers" (meta "where to be listed"), empty "No third-party page" / "The answers cite no third-party page.". Page lists: dot, URL, optional note, "N×". The competitor list's note is the competitor's name, and it and the third-party list show engine logos (tooltip "Cited on <engines>"); the closest page list shows no logos (I 218 to 238, 284, 294).
- By platform: card "By platform", meta "answers that cite each brand"; columns Platform (logo and name, 128 px), <own brand> (112 px), each competitor (112 px); the marks of you (lost when the engine is in `lost_on`) and each competitor, each mark's tooltip only that engine's sentence; the table scrolls sideways when wide (I 306 to 330).

### 3.9 Responsive, keyboard, accessibility

Checked at 375, 768, 1024 and 1440 px, light and dark, with the drawer docked and closed. Phone: scope grid of two columns, reset hidden, the panel keeps 384 px and the page scrolls, the gap summary wraps. The row's first cell is a button ("Open <url>" / "Open <prompt>"); a row click opens the drawer except on a cell action; `/` focuses search; Escape closes popovers and returns focus to the trigger. The pinned corner header sits above the other headers and pinned cells.

## 4. What the replacement removes and repoints

- Delete from `apps/web/src/features/citations` everything only the old tabs use, after `grep -rn "features/citations\|lib/citations" apps/web/src` shows no other importer (the Overview source cards and the prompt inspector import some parts: keep those).
- `apps/web/src/features/ai-overview/cards/sources/parts/drill.ts`: `CitationsTarget` becomes `{ tab: 'pages' | 'gaps'; owner?; page?: url_id }`; `role` maps to `owner`; the domain and New and lost targets open Cited pages with the matching owner; the date window is no longer carried (the page reads runs). Update `drill.test.ts`, `drill-source.test.ts` and the three cards' tests. `drill-links.ts` `DESTINATIONS.citations` stops carrying the window.
- `apps/web/src/lib/navigation/registry.ts`: remove the `sources` entry (D-8) and update `registry.test.ts`.
- `apps/web/messages/en.json`: replace the `citations` namespace with the strings of section 3.
- e2e: replace `e2e/flows/ai-citations.spec.ts` and `ai-citations-inspectors.spec.ts` with one spec that walks both tabs, both drawers, the competitors popover and the phone width.
- Gap tab requests: the web never calls `citation-gaps` with no competitor (the empty state shows instead); `comp=` with no ids means None, as the preview (C 46).
- MSW: `src/mocks/handlers/citations-v2.ts` for the five routes, answering from a fixture generated from the preview's `cit-data.js` (section 5), so the app with mocks shows the preview's numbers.

## 5. How exact match is checked

1. A small Node script `apps/web/scripts/citations-fixture.mjs` imports `design-preview/cit-data.js` and writes `src/mocks/fixtures/citations-v2.json` in the WP-76 response shapes. The app has three engine codes, so the script leaves out the preview's Google AI Overview answers (D-4) and writes, beside the responses, an `expected` block with the strip values, page counts and gap counts it computed over the three engines. The MSW handler serves the responses.
2. With `NEXT_PUBLIC_API_MOCKING=all`, the e2e spec asserts the `expected` block on screen. For reference, the preview over its four platforms prints 1132 citations, 13 own URLs, 26 domains and 161 gaps of 250 prompts (`node design-preview/cit-data.check.mjs`); the three engine numbers differ and are the ones checked.
3. Side by side screenshots of the preview (port 4190) and the app (mocks) at 1440 and 375 px, with Platform set to ChatGPT so both show the same numbers (All platforms differs only by the fourth platform), for: Cited pages default, owner All, prompts popover, Gap analysis, competitors popover, both drawers on each tab. The final reviewer lists every visible difference; each one is fixed or is a section 2 item.

## 6. Steps

| # | Task |
|---|---|
| 0 | Start the worktree; Opus writes the detailed plan from the generated types (every task: files, tests first, full code, checks) and commits it |
| 1 | Fixture script and MSW handlers for the five routes, with a schema test |
| 2 | Query wrappers and URL state (keys, defaults, old-key migration), unit tested |
| 3 | Toolbar: three selects, competitors popover, reset, export |
| 4 | Metric strip (section 3.3), unit tests of every value, context and tooltip |
| 5 | Tabs, table panel, search, footer, empty states |
| 6 | Cited pages table, owner filter, prompts popover, paging |
| 7 | Gap analysis table, mark, sorts, only gaps, summary |
| 8 | Page drawer and gap drawer, prompt inspector in place |
| 9 | Remove the old tabs and inspectors; repoint the Overview drills; remove the Sources nav entry |
| 10 | e2e spec, side by side screenshots, as-built note; rebase; full checks through the lock; push |

## 7. Acceptance criteria

- Section 5 passes: the numbers match the preview and the reviewer's difference list is empty or holds only section 2 items
- Every string in section 3 appears in `en.json` word for word; no em-dash or en-dash anywhere
- Loading (skeletons shaped like the strip and the table), error (retry) and refetch (previous data kept) states on the strip, both tables and both drawers
- axe clean at the four widths in both themes; keyboard path for every action
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm build` green; e2e spec green against mocks and against the dev API

## 8. Files this package owns

- `apps/web/src/features/citations/` (rewritten), `apps/web/src/app/[workspace]/[project]/ai/citations/`, `apps/web/src/lib/citations/` (new wrappers; old ones only where nothing else imports them)
- `apps/web/src/mocks/handlers/citations-v2.ts`, `apps/web/src/mocks/fixtures/citations-v2.json`, `apps/web/scripts/citations-fixture.mjs`
- `apps/web/e2e/flows/ai-citations.spec.ts`, `apps/web/e2e/support/ai-citations.ts`

Leases needed: `lib/inspector/placement.ts` (two inspector types), `lib/navigation/registry.ts` (remove `sources`), the Overview `drill.ts` and its tests, `mocks/handlers/index.ts` (register the handler), the `citations` namespace of `messages/en.json`.

## 9. As built (2026-11-17)

Branch `claude/ai-wp-77-citations-v2-web-481cad`. The plan is `docs/superpowers/plans/2026-11-17-ai-wp-77-citations-v2-web.md`; its Open points are answered below.

### 9.1 What was built

- Screen: `apps/web/src/features/citations/board-screen.tsx` and its modules (`board-state`, `board-reads`, `board-text`, `scope-toolbar`, `competitor-picker`, `measures-strip`, `board-panel`, `board-export`, `cited-pages/`, `gaps/`, `drawers/`). Routes `/ai/citations` (Cited pages) and `/ai/citations/gaps` (Gap analysis) share one screen through `citations-route.tsx`.
- Reads: the five WP-76 routes through `lib/citations/board-queries.ts`; Cited pages is server sorted, searched and paged (200 rows a page, the next page at the end of the scroll).
- Drawers: the page drawer (`inspect=cited-page:<url_id>`, tabs Prompts and Overview) and the gap drawer (`inspect=gap-prompt:<prompt_id>`, tabs Gap and By platform), each with J and K, "i of n", focus back to the row that opened it, and a "not in this scope" body for a 404.
- Prompt inspector in place: `PromptDrawerHost` of `features/prompts`, composed by the route and handed to the screen as an element (`inspect=prompt:<id>`).
- Export writes a CSV of the tab on screen: Cited pages writes every row the API has for the owner and search, most cited first; Gap analysis writes the rows shown, in the table's order.
- Mocks: `src/mocks/handlers/citations-v2.ts` over `src/mocks/fixtures/citations-v2.json`, generated by `scripts/citations-fixture.mjs` from the preview's `cit-data.js`. The fixture's `expected` block holds the strip, page and gap numbers of ChatGPT, of the enabled platforms and of all three; names are mapped by position onto the requesting project.
- Removed: the Domains and New and lost tabs, the domain and source inspectors, the old Citations files, the `sources` navigation entry and route.
- Repointed: the Overview cards that link to Citations (`drill.ts`, `drill-links.ts` and the cards' tests): a domain row and the New and lost links open Cited pages, the page reads runs and no longer carries a date window.
- e2e: `e2e/flows/ai-citations.spec.ts` with `e2e/support/ai-citations.ts` replace the two old specs. The walk covers both tabs, both drawers, the competitors popover, search, sort, Runs, Group, Reset scope, Export, the old-link migration, and the phone width in both themes. It asserts the fixture's `expected` block on screen under `NEXT_PUBLIC_API_MOCKING=all`; with `E2E_CITATIONS_REAL=1` only the structure is checked. `ai-citations-inspectors.spec.ts` and its support file are deleted (nothing else imported them).

### 9.2 House components (owner approved)

Added: `BoardTable` (12-tables.md section 20), `TrendIcon`, `PressedGroup`. Extended through documented variants: `Select` (prefix, option display and note, popup width), `Popover` (narrow and wide widths, menu and none paddings that also drop the section gap), `EntitySwatch` (dot), `EngineLogo` (hidden name, contained in its cell), `SparklineCell` (size, entity colour, end dot, fill), `MetricStrip` (line), `TabNav` (segmented), `EmptyState` (table and card), `InspectorSection` (meta, flush, title size, stacked action), `Inspector` (`hideMoreActions`), `Badge` (`badgeVariants` exported). The additions and variants are documented in the design system documents (07, 12, 13, 16, 17, 23 and 25); specimens were added to `/design-system` in the task that built each, and the list of specimens was not re-audited for this note.

### 9.3 Differences from the preview

- The route tabs are `nav` links with `aria-current="page"`, not a `tablist` with `aria-selected` (each tab is a route).
- The view tabs pad `px-2`, not `px-2.5` (the spacing lint refuses 10 px); each tab is 4 px narrower.
- The Group select is the house `Combobox` popup (a button that opens a searchable list), not the preview's listbox with a search field.
- A sortable header that has a tooltip has a whole-cell hover area, and a click anywhere on it sorts.
- The Change cell's tooltip covers the cell's width.
- The sparkline is the house canvas at 1.5 px with a 2.5 px inset; a flat series is drawn mid-height and a single point draws a dot.
- The New badge's tooltip is the second line of the row button's tooltip (two Base UI tooltips on nested triggers would both open).
- The prompt inspector in place reads the address's date range (the Prompts page's window, not the runs) and has no answer viewer.
- Export writes a CSV (the preview shows a note).
- The Overview's domain drills open Cited pages by owner and do not add a domain search term (`q=<domain>` is not added).

The browser parity pass was done on 2026-11-17 in Chrome against the preview on port 4190, at 1440 and 375 px, for the listed states, by DOM measurements (`getBoundingClientRect`, `getComputedStyle`). The app was signed in on `app.localhost`, because a `__Host-session` cookie from another session already existed on `localhost`. The whole-row competitor toggle hit area was confirmed: a click on the name, on empty space, on the right edge and on the dot each toggles the competitor.

The pass found differences that were fixed in the commit "match the preview popovers, drawer table headers and drawer overflow": the prompts popover's 12 px gap and scroll, the competitors popover's 24 px of height and 4 px of offset, lowercase drawer table headers, the gap drawer's "Open answers" row, the page scrollbar from the `sr-only` engine names in the drawers, the extra More actions button of both drawer headers, the Export icon size (14 px) and the Reset button's border and weight.

Remaining differences from the preview, none fixed in this package:

- Shared inspector chrome, used by every drawer of the app. Changing it is outside this package without an owner decision.
  - The phone sheet header: a labelled back button, and First and Next buttons on the phone.
  - Drawer accessible names: "Close" against the preview's "Close inspector", "First page in this list" against "Previous page", and the tablist's name.
  - The tab bar is 1 px taller and the tab gap is 24 px against the preview's 20 px.
  - The drawer card titles are `h3` against the preview's `h2`.
- Accepted, not shared chrome:
  - 200 rows per page of Cited pages against the preview's all 278 (the server pages the rows, D-6).
  - The error state for a mock id that no fixture row has.
  - Data names (fixture names are mapped by position onto the requesting project).
- Second browser pass (2026-11-17, same method, head c52215e8): the prompts popover, drawer table headers, the "Who is cited" card, the page drawer overflow, the drawer headers, Export and Reset scope all matched the preview. The competitors popover sat 8 px from its trigger against the preview's 4 px (an earlier reading of the offset was reversed); the extra `sideOffset` prop was removed again, so it now uses the default 4 px and was not measured a third time. Known remaining 1 px: the prompts popover list starts about 1.2 px lower than in the preview (header content 21 px against 20 px). The Reset scope button is disabled at the default scope in the app and always enabled in the preview.

### 9.4 Open points and how each was resolved

1. A new house table: `BoardTable` in `components/app/table/`, documented in 12-tables.md section 20, with a specimen. `DataTable` stays the table for record lists.
2. Route tabs: `TabNav variant="segmented"`, a `nav` named "Citations views" with `aria-current`; the gap count badge keeps its hidden ", N gaps".
3. Rate deltas: toned only when the change is detectable (`TrendIcon` through `formatMetricDelta`); the words say "within normal variation" otherwise.
4. Names under mocks: the model maps by position onto the requesting project (own host, competitor `i`, topic `i mod T`), so every count and the `expected` block hold. The fixture's prompt ids are synthetic, so under mocks "Open answers" opens a prompt inspector that finds no prompt; the e2e checks that the button is there and does not click it.
5. Engine marks without visible names: `EngineLogo nameDisplay="visually-hidden"`, documented in 07-icons.md.
6. The prompt inspector in place: `features/prompts/prompt-drawer-host.tsx`, exported from `features/prompts/index.ts`, with the J and K order through `lib/inspector/prompt-order.ts`.
7. A page the scope does not cite: the drawer stays and says "Not cited in this scope" with the scope text; the gap drawer does the same for a prompt with no answer.
8. The two Overview drills: Cited pages by owner, no `q=<domain>` (see 9.3). Export's order is the one in 9.1.
9. Sort is not in the address (the preview's behaviour): a link reopens the default sort.
10. The Group control: the house `Combobox`, the terms depth first by name in one flat list, with its empty, clear and open labels.
11. Tooltips inside a tooltip: one tooltip with the inner text as its second line (the New badge, the strip deltas).
12. App-only strings (load errors, no-engine state, Group labels, drawer back labels, tab list names, not-found states, CSV headers and toasts): under `citations` in `messages/en.json`.
13. Freshness time: the app prints the latest answer in scope (Sep 28 at 02:12, run 48, for ChatGPT and Gemini; 02:10 for ChatGPT alone), not the preview's fixed 02:10. Data, not layout.
14. The open button: the tooltip says "Open the page" and the name "Open the page in a new tab", as the preview.
15. Inspector card titles: `InspectorSection` takes `meta`, `flush` and `titleSize`; both Citations drawers use the section size, as the preview's `cardFrame` does.
16. The layouts catalog keeps its `sources` screen key (it follows the API's `ResolvedLayout`); only the navigation entry and route went.
17. Leases beyond the brief: see 9.5.
18. Fixture times are the preview's run times in Europe/Berlin (Fynix's zone). A project in another zone shows other clock times under mocks; the counts do not change.
19. Off-scale padding: `px-2` (see 9.3).

### 9.5 Files outside the section 8 leases that were touched

- `features/prompts`: `prompt-drawer-host.tsx` (new) and its export line in `index.ts`.
- `src/mocks/respond.ts` (one problem code), `apps/web/.prettierignore` (the generated fixture), `src/test/rankings-harness.tsx` (an export).
- `e2e/flows/ai-overview-sources.spec.ts` (its Citations link cases changed with the drills).
- `features/ai-overview/cards/activity/key-changes-card.tsx` (the fourth card that calls the Citations drill; the brief names three).
- `docs/design-system` (12, 13, 16, 17, 23, 25 and 07) and the `/design-system` specimens.
- House components: `Select`, `Popover`, `EntitySwatch`, `EngineLogo`, `SparklineCell`, `MetricStrip`, `TabNav`, `EmptyState`, `InspectorSection`, `Badge`, and the new `BoardTable`, `TrendIcon` and `PressedGroup`.

### 9.6 Checks

- Run for the e2e commit: `eslint` and `prettier --check` on the two e2e files, and `pnpm typecheck` once (it covers `e2e/**/*.ts`).
- Run: the browser parity pass with the preview (see 9.3), by DOM measurements at 1440 and 375 px; after its fixes, the test files of the touched components one at a time, `eslint` and `prettier --check` on the changed files, and `pnpm typecheck` once.
- Not run in this worktree, under the owner's load rule: the full `pnpm test`, `pnpm build`, the Playwright e2e (against mocks or the dev API) and the whole-project `pnpm lint`. The new e2e spec was written from the screen's code and has never been executed; its first run may need locator fixes.
- Still to do before the push: those runs, and the rebase onto `origin/develop`.
