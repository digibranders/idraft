# Prompts page parity: findings of the register pass (2026-11-17)

Branch `port/regpr`, cut from `port/real-app` at `6fe302f1`. The real app was run on a local dev server with the MSW
fixtures (project Eventus Security, ChatGPT and Gemini on, Google AI Mode and Google AI Overview not collected), driven by
Playwright Chromium at 1440, 1280, 1024, 768 and 390 px, light and dark, and compared with the preview on
http://localhost:4190. The tests of `features/prompts`, `lib/prompt-facts` and the glossary guard ran green (141 files, 2,035
tests). No code was changed. Evidence screenshots and probe scripts are in the session scratchpad
(`/private/tmp/claude-501/-Users-a12345-Desktop-AI-idraft/38be1196-3e3f-4213-945a-82d5cc839c82/scratchpad/regpr/`).

Rows are in `prompts-page-parity.md`. A `done` row names the check; a `differs` row says what differs.

## 1. Rows that were untrue, and what is true

Rows already marked `done` that were re-checked (more than 45 of the 80 were looked at again in the browser or in the tests;
the rest are covered by tests that ran green):

| Row                                   | What it said                                                                               | What is true                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-TVIEW-02                           | done d543f371: By platform columns as in the preview                                       | The `Platform gap` column is 152 px (the preview 120) and the Group column stretches to 438 px (the preview 260). Now `differs`                                                                         |
| PR-NOPORT-17 and PR-OPEN-02 (premise) | the real app keeps its own Schedule, Type and Branded filters and its lock and type badges | The real Prompts page has the Branded filter only. There is no Schedule filter, no Type filter, no schedule lock and no type badge in the table. PR-NOPORT-17 is now `differs`, PR-OPEN-02 stays `todo` |
| PR-DRAWER-16                          | differs, not checked                                                                       | Checked: a new Location closes an open group or prompt drawer, archiving the open prompt closes the drawer first. Now `done 60b690eb`                                                                   |
| PR-DRAWER-11 to 15                    | differs, not compared line by line                                                         | Compared now against the preview (group drawer header, Overview, Prompts, Competitors, Related). They stay `differs`, with the real differences written out in each row                                 |

Register rows that described the preview or the real app wrongly, now corrected in the status or the verify cell:

- PR-TOOLBAR-05 said the Updated text is hidden at 1024. 1024 is `lg`, so it is visible there in the preview and in the real
  app. It is hidden at 768 and 390.
- PR-STRIP-11 measured the strip as 323 px at 390. Both the preview and the real app measure 366 px now.
- PR-COMPARE-09 and PR-PCOLS-09: the compare width of Mention rate is 200 in the real app (204 in the preview), a known
  difference.
- PR-OPEN-06, PR-OPEN-07 and PR-OPEN-10 were open points of the preview. The real app has already fixed them (sort fallback,
  Enter on a focused row, `aria-describedby` on the column header).
- PR-OPEN-09 and PR-RESP-06: the real app keeps the Period and Location controls in the top bar at 390 px, so the Location
  column is reachable on a phone. Real is better.
- Rows that said `not re-checked` (PR-PCOLS-03, 04, 05) were measured: Prompt 300, Group 160, Location 120 px at 1440.

## 2. Real gaps (features missing in the real app)

| Gap                                                                                                                                                             | Rows                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| No Schedule filter, no Schedule chip, no schedule on a prompt, no Move to schedule in the bulk bar (`todo`)                                                     | PR-OPEN-02, PR-MENU-07, and the `differs` rows PR-FILTER-01, 03, 11, 12, PR-TERM-05, PR-TABLE-07, PR-RESP-03, PR-DATA-06, PR-DATA-17 |
| No Type filter, and no type badge in the Prompt cell (the type shows in the prompt drawer badge only)                                                           | PR-OPEN-02, PR-CELL-01                                                                                                               |
| No global search or command palette: the top bar has no search field and Cmd or Ctrl plus K does nothing (`todo`; `/` works)                                    | PR-KEY-01                                                                                                                            |
| No Import prompts, Generate from keywords, Open page, Edit prompt (the preview stubs; the real menus leave them out). `Link a keyword` is not built either      | PR-MENU-01, PR-MENU-03, PR-MENU-12                                                                                                   |
| The comparison `vs same period last year` is not offered although the API accepts `compare=previous_year`                                                       | PR-COMPARE-01, PR-COMPARE-03, PR-OPEN-03                                                                                             |
| Branded filter has `Included` only (no `Only`)                                                                                                                  | PR-FILTER-08                                                                                                                         |
| The Group drawer Overview has no `Top prompts in this group` card; the Prompts tab lists the prompts with counts per platform, not Mention and Citation columns | PR-DRAWER-12, PR-DRAWER-13                                                                                                           |
| No tracked keywords per group, so no `Related keywords` card and no SEO numbers in `In search` (backend request)                                                | PR-DRAWER-12, PR-DRAWER-14, PR-DRAWER-15                                                                                             |
| Trend icon in the strip and in the group and prompt drawers (see section 3)                                                                                     | PR-POST-01, PR-POST-02                                                                                                               |

Real defects and wording differences found on screen (all `differs` rows, none fixed in this pass):

- Empty table state: at 1440 the centred block spans the whole table width, so `Change the search or the filters to see more
prompts.` is cut off at the panel edge (PR-TABLE-08). A search that finds nothing also shows no button, and the text does
  not say what the scope is.
- Strip tooltip: `Mentioned` and `Cited` where the preview says `Mention` and `Citation`, and Share of voice counts answers
  that mention a brand, not brand mentions (the open decision D17, PR-STRIP-04, PR-CELL-08, PR-DATA-03). A prompt weighted
  percent still sits beside pooled counts in the Groups tab and the group drawer (open decision, PR-DATA-05).
- Strip info text has an ASCII apostrophe in `that platform's answers` where the preview has U+2019 (PR-STRIP-09), and the
  popover is 360 px (the preview 288) and named `About AI visibility rate` (PR-STRIP-08).
- The Filter button and the chips are 36 px high, the chip remove button 24 px (the preview 32 and 28) (PR-TOOLBAR-04,
  PR-FILTER-02). The shared filter bar says `Clear filters` where the preview says `Reset filters` (PR-FILTER-09), and
  `Show: Detectable changes only` is an editor with a radio, not a toggling menu item (PR-FILTER-04, PR-FILTER-05, PR-OPEN-01).
- Row 1 wraps at 768 px (More actions and Add prompts drop to a second line), the preview keeps one line (PR-TOOLBAR-02,
  PR-RESP-04). The real row also carries the `Gemini degraded` status badge.
- Column chooser is 360 px (the preview 280), puts a column that is turned off below the others, and its reset button says
  `Reset width` (PR-COLS-01, 02, 07). `ChatGPT mention` is 152 px (the preview 176) (PR-PCOLS-12).
- Row button is named `Actions for ...` (the preview `More actions for ...`) and is always visible (PR-TOPICS-14,
  PR-TABLE-11); the header checkbox is `Select all 65 prompts loaded` and the last header `Actions` (PR-PCOLS-01,
  PR-TABLE-06).
- Toasts: archive says `1 prompt archived` with no `History is kept...` description, Run now says `Run queued` with a
  generic description, Copy link has no description (PR-MENU-02, 05, 08). After an archive focus stays in the table, not in
  the search (PR-TABLE-12, PR-KEY-06).
- Drawers: tablists are named `Prompt sections` and `Group sections` (the preview `Prompt details`, `Group details`), the step
  buttons have no `(K)` and `(J)` tooltip and stop at the ends, J and K do not wrap (PR-DRAWER-02, PR-DRAWER-05, PR-KEY-02).
  At 1440 the group drawer's badges and its Add prompt and Run now buttons are cramped in one row (PR-DRAWER-11).
- Tab pair: radios with `?tab=prompts`, not links (PR-NAV-05, a decision, real is better because Back works).

## 3. Preview changes after the register header not yet in the real app

`git log 1363ff90..HEAD -- apps/web/design-preview` lists ten commits; `git status --short apps/web/design-preview` is
clean (the files the header called uncommitted have been committed since).

| Commit                                         | Change                                                                                                                                      | Real app                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `3d6a8843`, `f4c672b3`                         | The rate columns show an arrow, then a trending icon, instead of the trend line and the change text                                         | Done in the real Mention rate cell (`65bc0f39`)                                                                                                                                                                                                                                                        |
| `e4c433ff`                                     | Every change in points on the Prompts and Citations pages is one `trendIcon` (green up, red down, grey dash), with the figures in its hover | Mention rate cells: done, with a richer hover (direction, from and to, previous period, verdict, sample, weekly rates). The strip slots (`−3.5 pts`), the group drawer Rates card (`+4.2 pts`) and the prompt drawer strip (`+14.3 pts`) still write text. Added as PR-POST-01 and PR-POST-02 (`todo`) |
| `36d32e13`                                     | The glossary pass in the preview                                                                                                            | Done earlier in the real app (`d1b61100`); PR-POST-05                                                                                                                                                                                                                                                  |
| `fff09a26`                                     | Citations replaces Sources in the sidebar                                                                                                   | Present (PR-POST-06)                                                                                                                                                                                                                                                                                   |
| `15bd576c`                                     | Shared trend icon on the Overview, touches `prompts-parts.js`                                                                               | Overview is another register                                                                                                                                                                                                                                                                           |
| `7050439d`, `2b582033`, `45cf3fcb`, `d54204f8` | Internal links and Citations page work                                                                                                      | Not the Prompts page                                                                                                                                                                                                                                                                                   |

One preview point: the Mention rate header tip in the preview still says `the line is the rate of each week`, although the line
is gone. The real tip speaks of the icon (PR-POST-04).

## 4. Rows that remain `todo`, and why

| Row        | Why                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| PR-MENU-07 | Move to schedule is not built; the Prompts page has no schedule                                                  |
| PR-KEY-01  | The command palette (Cmd or Ctrl plus K) and the global search are not built; `/` is done                        |
| PR-OPEN-02 | The Schedule and Type filters are not built                                                                      |
| PR-POST-01 | The strip slots write the change as text; the preview draws a trend icon                                         |
| PR-POST-02 | The group drawer Rates card and the prompt drawer strip write the change as text; the preview draws a trend icon |

## 5. Tally by status

| Status  | Before (329 rows)                    | After (335 rows) |
| ------- | ------------------------------------ | ---------------- |
| done    | 80                                   | 223              |
| differs | 39                                   | 107              |
| todo    | 210 (209 `todo`, PR-OPEN-01 `todo:`) | 5                |

By package (rows, before to after): P-shell todo 117 to 2 (done 5 to 81, differs 1 to 41); P-popovers todo 42 to 1 (done 26 to
57, differs 6 to 16); P-metrics todo 27 to 1 (done 21 to 41, differs 2 to 11); shared todo 24 to 0 (done 0 to 16, differs 0 to
9); P-groups done 28 to 28, differs 24 to 24, todo 0 to 1 (the new PR-POST-02).

Six rows were added (PR-POST-01 to 06), so the register has 335 rows.

## 6. Gap pass of 2026-11-17 (branch `port/gap-prompts`)

Built: the trend icon in the strip and the drawers (PR-POST-01 and 02, `13c36022`), `vs same period last year` (PR-COMPARE-01, 03, PR-OPEN-03, `00ba7b1c`), the Branded `Only` value (PR-FILTER-08, `2bdc844f`), the `Top prompts in this group` card and the `Related keywords` card in the Related tab (PR-DRAWER-12, 14, `8b8ebfa2`), the typographic apostrophe of the strip info (PR-STRIP-09, `8b8ebfa2`), the empty state cut-off (PR-TABLE-08, `8b34d4b1`), and in `7dd365e7` the toasts of archive and Run now (PR-MENU-05, 08), the 32 px Filter button and chips (PR-TOOLBAR-04, PR-FILTER-02), the 280 px column chooser (PR-COLS-01), `ChatGPT mention` 176 px (PR-PCOLS-12), `Platform gap` 120 px (PR-TVIEW-02) and the type badge of the Prompt cell (PR-CELL-01).

Not built, with the reason in the rows: Schedule filter, Schedule chip and Move to schedule (backend request 17), Edit prompt (request 18), Generate from keywords (request 19), Open page (request 20), Import prompts (request 21), the Type filter (the preview's Filter menu does not offer it), row 1 at 768 px (the `Gemini degraded` badge), focus on the search after an archive (the grid keeps focus on purpose), the Group column width in By platform (the preview has four platforms).

Shell gap (not a Prompts page gap): the command palette and the global search in the top bar, Cmd or Ctrl plus K (PR-KEY-01). The preview has a search field in the top bar of every page and the real shell has none; the mock handler `src/mocks/handlers/command-palette.ts` is empty, so no search route exists yet either. It belongs to the shell package, and no page can build it alone.

Opt-in props added to shared components (defaults keep today's look, so Rankings, Citations and the other pages are unchanged): `compact` on `FilterBar` and `FilterChip`, `compactChooser` on `DataTable`, `compact` on `ColumnChooser`, `containerQuery` on the keyword column, and the optional `kind` of `compareParams` (`lib/compare/compare-model.ts`, which the Overview also calls; its call is unchanged). One shared change is not opt-in: a table's message row (empty, no match, error) is now as wide as the panel and pinned left, which only changes a table that scrolls sideways.

## What was not verified

- No screen reader, touch device or reduced-motion setting was used (PR-KEY-04 to 09 name what was read).
- The toast timings, the three-toast limit and the Add dialog success toast were not produced on screen; the unit tests
  cover the Add success flow.
- A set of two or three platforms (select reads `2 platforms`, chip text) needs three platforms on; the fixture has two.
- Google AI Mode and Google AI Overview states were seen only through the unit tests, since the project does not collect them.
- The Overview's per-platform figures were not compared on screen with the strip (only the headline average).
