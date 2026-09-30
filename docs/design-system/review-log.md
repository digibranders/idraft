# Design system review log

Date: 2026-09-29. Scope: `docs/design-system/` (00 to 27, adr/), `DESIGN_SYSTEM.md`, `AI_DEVELOPMENT_UI_RULES.md`, and superseded notes in `docs/20-frontend-specification.md`.

Work done:
1. Applied the resolution of every row in [25-component-inventory.md](25-component-inventory.md) section 23 (67 items) to the losing documents. No resolution contradicted a hard rule, so the inventory table is unchanged; two of its references were corrected (items 26 and 27 cited "20 §3.3.4", which is WCAG SC 3.3.4 in 20 §2).
2. Resolved the known cross-document issues: superseded notes in the older frontend spec, the notification center (380 x 560 px) and `DateRangePicker` (648 px) popover exceptions in 05 and 16, page tab maximum 6, glyph table in 07 §6, URL key table in 13 §5, token references, folder paths in 26 §2 (including `components/app/forms/`), and `label` (never `srText`) for formatter screen-reader text.
3. Full sweep for contradictory numbers, names, props, cross-references and hard-rule violations, followed by a verification pass over all 67 items.

Checks at the end: zero U+2014 and U+2013 characters in `docs/design-system`, `DESIGN_SYSTEM.md` and `AI_DEVELOPMENT_UI_RULES.md`; every relative markdown link resolves; every cited section number exists; every `--token` named in the docs exists in `tokens.css` or `globals.css`, is a Base UI runtime variable, or is a documented placeholder pattern (`--chart-{n}`, `--div-{pos|neg}-{n}`), a font variable from the `geist` package (`--font-geist-sans`, `--font-geist-mono`) or a CLI flag.

## Changes (479)

| Doc | Section | Change | Reason |
|---|---|---|---|
| AI_DEVELOPMENT_UI_RULES.md | Rule 4 | Size utilities with values, adds `w-inspector-wide` (640) | Task: root files |
| AI_DEVELOPMENT_UI_RULES.md | Rule 12 | No pie or donut charts | Task: root files |
| AI_DEVELOPMENT_UI_RULES.md | Rule 14 | Single-key shortcuts can be turned off (WCAG 2.1.4) | Task: root files (hard rule) |
| AI_DEVELOPMENT_UI_RULES.md | Rule 17 | Skeletons pulse; refetch at full opacity with static 2 px `RefetchBar` | Task: root files; Inventory #10, #11 |
| AI_DEVELOPMENT_UI_RULES.md | Rule 14 | Single-key shortcut list now points to 20 §14 (all single-character and sequence shortcuts) | 20 §14 lists more keys than j, k, a, r, s |
| DESIGN_SYSTEM.md | Ten decisions | Inspector 480 px (640 px for prompt, citation, answer evidence); ECharts animation off; no pie or donut charts | Task: root files; Inventory #35 |
| 00-design-principles.md | §2 P4 | "rows not below 32 px" scoped to `DataTable` rows (SimpleTable uses 28 px, 12 §15) | Task: numbers sweep |
| 00-design-principles.md | §5 | 14 composite type utilities (`type-page-title` to `type-kbd`) | Inventory #58 |
| 00-design-principles.md | §6 | "pie charts by default" changed to "pie and donut charts" (15 §1 rule 6) | Hard rule: no pie or donut |
| 01-foundations.md | §1 | 14 composite type utilities | Inventory #58 |
| 01-foundations.md | §3 | Theme setting: `ThemeMenu` in the top bar at 1280 px and up, user menu below (19 §3.2) | Inventory #39 |
| 02-color-system.md | §8 | Evidence highlight uses `--entity-1-highlight` to `--entity-6-highlight` tokens instead of "18% opacity" | Hard rule: tokens only |
| 02-color-system.md | `-subtle` row | Removed "selected chip" as a use of semantic `-subtle` | P1: 02 chips neutral |
| 03-typography.md | §4 | Link to 12 section 4 (alignment), center only the checkbox column | Task: broken section reference |
| 03-typography.md | §2 table | `type-micro` use: "Badges, chips, keyboard hints, counters" -> badges and tags (20 px), counters; filter chips use `type-body` (13 §2); keyboard hints use `type-kbd` | P1: 03 type-micro |
| 04-spacing-density.md | §2 | Added `TableFooter` 32 px row | Inventory #24 |
| 04-spacing-density.md | §2 | Menu item row now includes menu group label row, 28 px (cites 16 §5.2) | Inventory #57 |
| 04-spacing-density.md | §2 | Added sidebar navigation item 28 px (cites 11 §2) | Inventory #43 |
| 04-spacing-density.md | §2 | Metric strip height stated as 72 px on pages, 64 px in inspector and detail header (cites 23 §2.2) | Consistency with 23 §2.2 |
| 04-spacing-density.md | §2 | Page header row: "title row 40 px minimum" replaced by title block 44 px (title 28 plus meta 16), header totals 68 / 108 / 152 px, link to 23 §3.2 | P1: 04 page header |
| 04-spacing-density.md | §3 | Compact rows visible at 900 px: about 18 -> about 17, link to 24 §4 (comfortable stays about 14: 568 / 40) | P1: rows visible |
| 04-spacing-density.md | §1 | Step 12 usage extended to the save bar bottom reserve (10 §13.2) so the new `pb-12` does not contradict "auth and onboarding only" | Follow-on of P1: 10 `pb-20` |
| 05-layout-grid.md | §1 | Small desktop overlay rule references the main column and section 6 | Task: numbers |
| 05-layout-grid.md | §2 | Mermaid: top bar adds help and theme; inspector "480 or 640 px default by type" | Inventory #35, #40 |
| 05-layout-grid.md | §2 | Sketch metric strip height 72 (was 64 to 72) | Task: numbers (23 §2.2) |
| 05-layout-grid.md | §2.1 | Page header heights per 23 §3.2 (44 px title block, 108 or 152 px); inspector default per type | Task: numbers; Inventory #35 |
| 05-layout-grid.md | §4 | Inspector widths per 16 §2.2; exception added: notification center popover 380 px wide, up to 560 px tall | Inventory #35; Task: notification center |
| 05-layout-grid.md | §6 | Docking table rewritten to 16 §2.6 order (dock at min(preferred, space) when at least 400 px remain) | Task: numbers contradicting 16 |
| 05-layout-grid.md | §7 | Docked inspector at per-type default (was 640 px for all); column priority link now 19 §6.1 (was 12 §12) | Inventory #35; Task: broken link |
| 05-layout-grid.md | §4 | Metric strip item min 140 px (`md`), 96 px (`sm`) | 23 §2.2 |
| 05-layout-grid.md | §4 | Added exception line: `DateRangePicker` popover is 648 px wide (preset column plus two months), link to 10 §10.2 | Sweep P3, DateRangePicker width |
| 06-surfaces-borders-radius.md | §2 | Zebra link points to 12 section 3 | Task: broken section reference |
| 06-surfaces-borders-radius.md | §4 | Light `shadow-popover` and `shadow-dialog` descriptions match tokens.css layers | Task: numbers sweep (tokens.css) |
| 06-surfaces-borders-radius.md | §5 | Metric strip divider 32 px (group divider `border`); toolbar divider 24 px (`h-6`) per 09 §7 | Inventory #60 |
| 06-surfaces-borders-radius.md | §3 | `rounded-sm`: removed "table-inline controls", added "segmented control items" (09 §6 uses `rounded-sm` items); `rounded-md`: buttons note table-inline buttons, "segmented controls" -> "segmented control tracks", added option cards (radio cards) | P1: 06 radius rows |
| 06-surfaces-borders-radius.md | §3 | `rounded-lg`: removed "inspector sections" (unbordered, 16 §2.4) | P1: 06 radius rows |
| 06-surfaces-borders-radius.md | §3 | `rounded-full`: added slider track and thumb (switch thumb was already listed); closing sentence already says "the elements listed", no change | P1: 06 rounded-full |
| 06-surfaces-borders-radius.md | §5 | Menu separator margin 8 px -> 4 px vertical, link to 16 §5.2 | P1: 06 separator |
| 07-icons.md | §4 | Icon-only allow list extended to controls other docs make icon-only (previous/next, clear, metric info, show secret, stepper, help, theme, notifications) | Task: consistency sweep (16, 20, 11, 10) |
| 07-icons.md | §5 | Favicons: one allowlisted endpoint, 16 px, lazy, fixed box, `alt=""`, "Show favicons" setting, domain-first tables only | Task: favicons |
| 07-icons.md | §6 | Added `Search`, `CircleHelp`, `OctagonAlert`, `CalendarClock`, `CircleDashed`, `Hourglass`, `CircleSlash`, `GitCommitVertical`, `Circle`, `Lock`, `Check`, `Minus`, `Plus`, `Calendar`, `Eye`, `Upload`, chevron direction row; widened `X`, `CircleX`, `CircleCheck`, `Receipt` rows | Task: glyph table; Inventory #40, #59 |
| 07-icons.md | §6 | Note: EventTimeline event glyphs (18 §7) reuse concept glyphs; no glyph for "Open page" (`Maximize2` not used) | Task: glyph table; Inventory #30 |
| 08-interaction-states.md | §1 | Active tabs: `foreground` text and instant 2 px indicator; weight 500 in every state (cites 09 §12) | Inventory #5; consistency with 09 §12 |
| 08-interaction-states.md | §1 | Loading row aligned with 09 §2.4 (14 or 16 px spinner replaces leading icon; label kept at `opacity-0` when no icon) | Consistency with 09 §2.4 |
| 08-interaction-states.md | §5 | Background job toast only for user-started jobs; scheduled runs update freshness (cites 18 §3.3) | Consistency with 18 §3.3 |
| 08-interaction-states.md | §5 | Added row: immediate switch, no toast (cites 10 §13.3) | Inventory #42 |
| 09-buttons-controls.md | header | `radio.tsx` renamed to `radio-group.tsx` in the implementation file list | Inventory #51 |
| 09-buttons-controls.md | §2.6 | Reversible bulk actions on more than 100 rows confirm with the count (cites 20 §2, WCAG 3.3.4) | Inventory #27 |
| 09-buttons-controls.md | §6 | Single-choice view segmented control is `RadioGroup` (`role="radiogroup"`, `role="radio"`, `aria-checked`), not `ToggleGroup` with `aria-pressed`; added rule that `aria-pressed` is only for independent toggles | Inventory #2 |
| 09-buttons-controls.md | §8.3 | Switch success shows no toast | Inventory #42 |
| 09-buttons-controls.md | §10 | Menu popup motion: opacity plus 4 px translate, 150 ms in, 100 ms out (cites 21 §4.1) | Inventory #9 |
| 09-buttons-controls.md | §10 | Menu shortcut is `Kbd`, never plain `type-kbd` text | Inventory #57 |
| 09-buttons-controls.md | §10 | Menu group label is a 28 px row (`h-7`), not focusable (cites 16 §5.2) | Inventory #57 |
| 09-buttons-controls.md | §12 | Tab indicator: no transition, moves instantly (cites 21 §5, §12) | Inventory #5 |
| 09-buttons-controls.md | §12 | Inspector tab list fills header, equal-width segments (cites 16 §2.3) | Consistency with 16 §2.3 |
| 09-buttons-controls.md | §12 | Page tab counts only on inbox tabs (cites 11 §6) | Consistency with 11 §6 |
| 09-buttons-controls.md | §12 | Maximum page tabs 7 changed to 6 (cites 11 §6) | Inventory #3, Task |
| 09-buttons-controls.md | §12 | URL rule restated: every page tab has a URL; `?tab=` tabs use `Tabs`, path tabs use `TabNav` (cites 11 §6) | Inventory #4 |
| 09-buttons-controls.md | §12 | Manual activation replaced by automatic (`<Tabs.List activateOnFocus>`), panels render skeleton immediately (cites 20 §5) | Inventory #1 |
| 09-buttons-controls.md | §13 | Pagination lives in the 32 px `TableFooter` (no own 40 px bar); page sizes 100, 200, 500; range text "1 to 200 of 12,480", never page numbers; announcement example updated; scope stated as server-mode tables | Inventory #24 |
| 09-buttons-controls.md | §14 | Segmented (view) row: radio group semantics | Inventory #2 |
| 09-buttons-controls.md | §14 | Tabs row: automatic activation, keys "Arrows move and select, Home, End" | Inventory #1 |
| 09-buttons-controls.md | §2.3 | `subtle` examples no longer list the filter bar's "+ Filter" (it is `ghost`) | 13 §2 |
| 09-buttons-controls.md | §1 rule 3 | Inset focus ring now also names tabs and segmented control items | P1: tab focus inset |
| 09-buttons-controls.md | §2.2 | `icon` size row: 18 px (`size-icon-md`) exception for top bar icon buttons, link to 07 §2 | P1: top bar icon |
| 09-buttons-controls.md | §3 | `icon` row in the IconButton table: same 18 px top bar exception | P1: top bar icon |
| 09-buttons-controls.md | §2.9 | `import { cn } from 'cn'` -> `import { cn } from '@/lib/utils'` | P1: cn import |
| 09-buttons-controls.md | §6 | Segmented item focus `focus-ring` -> `focus-ring-inset`; item count clarified: view controls 2 to 5, form value 2 to 4 (10 §9) | P1: tab focus, option thresholds |
| 09-buttons-controls.md | §12 | Inspector (segmented) tabs focus: "Ring on the item" -> `focus-visible:focus-ring-inset` on the item | P1: tab focus inset |
| 09-buttons-controls.md | §10 | Menu shortcut: `ml-auto` -> `ml-auto pl-4` (16 px minimum gap, 16 §5.2) | P1: menu shortcut gap |
| 09-buttons-controls.md | §10 | "Menus contain actions only" -> commands or single choices (radio items, e.g. `ThemeMenu`), never inspector content or forms | P1: menu contents |
| 10-forms.md | header | Implementation split: primitives in `components/ui/` (`field.tsx`, `number-field.tsx`, `radio-group.tsx`, ...), `FormField`/`UrlInput`/`DomainInput` in `components/app/forms/`, `DateRangePicker` in `components/app/filters/`; primitives never import react-hook-form, contracts or `@/lib/format` | Inventory #50, #51 |
| 10-forms.md | §2 | `FormField` location stated; composes Field parts from `components/ui/field.tsx`; inline uses render Field parts directly | Inventory #50, #51 |
| 10-forms.md | §2 | Error icon stated as 12 px (`size-icon-xs`); 10 owns field anatomy | Inventory #17 |
| 10-forms.md | §8 | Checkbox rule names engine "Enabled" and query matching options in save-bar forms | Inventory #41 |
| 10-forms.md | §10.2 | `DateRangePicker` location `components/app/filters/` and reason | Inventory #50 |
| 10-forms.md | §11 | `NumberInput` stays in `components/ui/number-field.tsx`, receives Intl options from the caller via `format`, never imports `@/lib/format` | Inventory #50 |
| 10-forms.md | §11 | `numberInputFormat` must be added to `lib/format` with unit tests before any screen uses `NumberInput` | Inventory #54 |
| 10-forms.md | §12 | `UrlInput` and `DomainInput` live in `components/app/forms/` because they call contracts and `@/lib/format` | Inventory #50 |
| 10-forms.md | §13.2 | Save-bar form booleans are checkboxes, never switches | Inventory #41 |
| 10-forms.md | §13.3 | Explicit "no toast" on switch success | Inventory #42 |
| 10-forms.md | §17 | `SearchInput` file path stated; single search component shared with 13 §6 | Inventory #18 |
| 10-forms.md | §17 | `/` focuses table search on table pages only; on other pages opens command palette (cites 20 §14); page search shows no "/" hint; hint hidden when single-key shortcuts are off | Inventory #21 |
| 10-forms.md | §15.2 | Import is a four-step `StepperDialog` over Rank Tracker (route renders the list with the dialog open); steps Upload, Map columns, Review, Confirm; completion via `CollectionProgress` and toast | Conflict with 16 §1.1 and §4.6 |
| 10-forms.md | §6.1 | Thresholds: 2 to 4 radio or segmented; new row 5 to 6 radio group; `Select` 7 to 15; `Combobox` above 15 unchanged | P1: option thresholds |
| 10-forms.md | §6.3 | Combobox "Searching" row shown once a request has run 300 ms (debounce 250 ms unchanged) | P1: combobox searching |
| 10-forms.md | §13.2 | Save bar space: `pb-20` -> `pb-12` plus `scroll-padding-bottom` equal to the save bar height (56 px, `h-14`); no save-bar size token exists in tokens.css | P1: off-scale spacing |
| 10-forms.md | §18 | ErrorSummary: `rounded-lg ... p-3` -> region banner spec `rounded-md ... py-2 px-3`, link to 18 §4 | P1: ErrorSummary |
| 10-forms.md | §10.2 | New "Width" row: 648 px (160 px presets plus 12 + 224 + 16 + 224 + 12 calendar area), exception to 16 §5.1, bottom sheet below 768 px (19) | DateRangePicker width |
| 11-navigation.md | §1 | "11 destinations in 4 groups" replaced by the real count: 15 sidebar items in 3 sections, SEO (3) and AI Visibility (4) as labelled groups | Task: 11 internal consistency |
| 11-navigation.md | §1.1 | Integrations tabs capped "at most 6, section 6" | Task: max 6 page tabs |
| 11-navigation.md | §4 | Sketch adds Help `[?]` left of the avatar | Inventory #40 |
| 11-navigation.md | §4 | Search trigger 320 px at 1440+, 240 px at 1280 to 1439, icon button below 1280 (was 280 px, icon below 1024) | Inventory #38 |
| 11-navigation.md | §4 | Theme is `ThemeMenu` (System, Light, Dark radio menu), moves into the user menu below 1280 px (was cycling icon button) | Inventory #39 |
| 11-navigation.md | §4 | Added Help row: `HelpMenu`, `CircleHelp`, left of user menu, 4 items per 20 §15 | Inventory #40 |
| 11-navigation.md | §4 | User menu items aligned with 25 §5.8 (single-key switch, theme below 1280, reduce motion); cross-ref to 19 §3.2 added | Task: consistency with 19, 20, 25 |
| 11-navigation.md | §5 | Named the component `SettingsNav` | Task: canonical names |
| 11-navigation.md | §6 | Tab label weight 500 on every tab (per 09 §12); `?tab=` tabs use `Tabs` tablist, path tabs use `TabNav` links (was "tabs are links") | Inventory #4 |
| 11-navigation.md | §7 | Added `/` row (table pages focus search, else command palette); `[`, `/`, `?`, `g` sequences all disableable via the user menu switch, cross-ref 20 §14 | Inventory #21; Task: WCAG 2.1.4 |
| 11-navigation.md | §7 | "Skip to content" renamed "Skip to main content" with cross-ref 20 §4.5 | Task: contradiction with 20 |
| 11-navigation.md | §1.1 | Diagnostics: tab in Keyword Detail only; prompt diagnostics must not add a seventh Prompt Detail tab | Max 6 page tabs vs 24 §9.6 |
| 11-navigation.md | §3 | Collapsed-rail tooltip offset 8 px -> 6 px, link to 16 §6.1 | Sweep P3 (16 §6.1 owns tooltips) |
| 12-tables.md | §1 sketch | Footer line now "1,000 keywords · Updated 12m ago", page numbers ("1 of 5") removed | Inventory #24 |
| 12-tables.md | §1 anatomy table | Footer row names `TableFooter`; server mode `Pagination` with range text "1 to 200 of 12,480", sizes 100, 200, 500, no page numbers | Inventory #24 |
| 12-tables.md | §1 anatomy table | Toolbar row: `SearchInput` `sm`, result count lives in the table toolbar on table pages, sort summary for multi-sort | Inventory #18, #63; 20 §6.5 |
| 12-tables.md | §3 | Empty cell rule: a cell is never empty for unknown or not-applicable values (17 §1 rule 1) | Inventory #15 |
| 12-tables.md | §6 | `RankCell`: text from `formatRankCell` (`>20`, not a chip), accessible text from `describeRank` | Inventory #16, #52 |
| 12-tables.md | §6 | `MetricCell`: insufficient state is "Insufficient" (section 7.3), adds `NotApplicable` ("No AIO"), `612 of 1,296 obs` | Inventory #14, #15 |
| 12-tables.md | §6 rules | Screen reader text is the formatter `label`; contract type `MetricCell` imported as `MetricCellValue` | Inventory #52, #55 |
| 12-tables.md | §7.1 | Static 2 px `RefetchBar` (link 17 §3.4); "Updating" text without spinner; full opacity kept | Inventory #10, #11; 17 §3.5 spinner places |
| 12-tables.md | §7.3 | Beyond depth: `formatRankCell` text `>20`, "not in top 20" in tiles, inspector, speech | Inventory #16 |
| 12-tables.md | §7.3 | Insufficient: 17 §8 hatching (1 px `border-subtle` lines, 4 px apart, on `surface-subtle`), "Insufficient" or count below 88 px, "Insufficient data" in tiles and inspector | Inventory #13, #14 |
| 12-tables.md | §7.3 | Not applicable: short text ("No AIO") with tooltip, never an empty cell; note that 17 §8 owns these components | Inventory #15 |
| 12-tables.md | §8 | Multi-sort described by visible toolbar sort summary, announced (20 §6.5), not by header description | Consistency with 20 §6.5 |
| 12-tables.md | §9 | Page Up/Down moves by fully visible rows minus one (20 §6.3) | Consistency with 20 §6.3 |
| 12-tables.md | §9 | Escape closes menus and tooltips, never clears selection | Inventory #22 |
| 12-tables.md | §9 | `/` focuses table search on table pages; other pages open the command palette | Inventory #21 |
| 12-tables.md | §9 | Added pointer to 20 §6.3 as the binding full keyboard map | Inventory #22 |
| 12-tables.md | §9 | `aria-colcount`/`aria-colindex` omitted; hidden columns removed from the DOM | Inventory #23 |
| 12-tables.md | §12 | Server mode names `TableFooter` with `Pagination`, range text, no page numbers | Inventory #24 |
| 12-tables.md | §14 | Any bulk action over 100 rows confirms with the count (20 §2, 3.3.4) | Inventory #27 |
| 12-tables.md | §5 | Screens may set a column default within the type min and max; screen specs in 19 §6 and 24 §9 | 12 vs 19 vs 24 widths |
| 12-tables.md | §6 | `RankDeltaCell` tooltip "Normal movement ... ±2" -> "up to 2 positions" | Sweep P2: ranks never use signs |
| 12-tables.md | §7.1 | Refetch: "Updating" with a 14 px spinner in the toolbar after 400 ms; removed "(no spinner)" | Sweep P2: 17 §3.4 owns |
| 12-tables.md | §11 | Saved view `filters` example -> `{ loc: 2840, dev: "desktop", topic: ["t_12"], rank: ["top3", "top10"] }` with link to 13 §5 | Sweep P2: 13 §5 keys and rank bucket ids |
| 12-tables.md | §11 | "doc 04 section 11.6" -> `[04-data-model.md](../04-data-model.md)` section 11.6 (no "doc 20" style refs remained elsewhere in 12) | Sweep P2: explicit links |
| 12-tables.md | §15 | `SimpleTable` rows 28 px -> 32 px (compact default) | Sweep P2: 16 §2.4 compact tables |
| 12-tables.md | §19 | `DataTable` sketch aligned to 25 §7.1 and §7.13: added `caption`, `itemNoun`; removed `query` prop (server mode via `server`, components never fetch); accessor functions for `col.*`; removed `depth` option and `invert: true`; `col.actions(rowActions, rowName)`; Updated priority 3 -> 4; `savedViews` passed as a slot; comment pointing to the remaining required state props | Sweep P2: 25 §7.1, §7.13, 19 §6.2 |
| 13-filters-search.md | §2 | `FilterChip` radius `rounded-sm`, remove target 24 x 24 px (12 px icon) | Inventory #19 |
| 13-filters-search.md | §2 | Result count: table toolbar on table pages, filter bar on T1 | Inventory #63 |
| 13-filters-search.md | §2 | Responsive collapse now matches 19 §4 (768 to 1023 date inline plus "Filters"; sheet below 768) | Task: numbers sweep (19 §4) |
| 13-filters-search.md | §5 | Keys row points to the new key table | Task: URL keys |
| 13-filters-search.md | §5 | History row: inspector open pushes; `itab` and previous/next record replace (16 §2.7) | Inventory #37 |
| 13-filters-search.md | §5 | Added key table with meaning, history and owning doc; new keys `itab`, `stats`, `obs`, `vs`, `metric`, `status`, `by`, `quad`, `source`, `role`, `chg`, `provider`, `project`, `workload`, `events`, `notif`, `rule`, `date`, `next`; `inspect` format `?inspect=type:id` with `domain` and `source` types | Task: URL keys; Inventory #36 |
| 13-filters-search.md | §5 | Example URL uses `/<workspace>/<project>/seo/rankings` (11 §1.1) instead of `/p/...`, adds `itab` | Task: numbers sweep |
| 13-filters-search.md | §6 | Table search row: `/` on table pages | Inventory #21 |
| 13-filters-search.md | §6 | `SearchField` anatomy replaced by `SearchInput` per 10 §17: `border-strong`, `foreground-muted` icon 14/16 px, 24 px `icon-xs` clear, sizes `sm`/`md` | Inventory #18, #48 |
| 13-filters-search.md | §7 | `/`: table pages focus table search, other pages open command palette | Inventory #21 |
| 13-filters-search.md | §7 | Delete or Backspace on the chip's focused remove button removes the filter | Inventory #66 (20 §5) |
| 13-filters-search.md | §7 | Arrow keys between chips replaced by Tab / Shift+Tab between chip buttons (no roving focus) | Inventory #66 |
| 13-filters-search.md | §8 | `FilterBar` is `role="group"` named "Filters", Tab moves between chip buttons | Inventory #66 |
| 13-filters-search.md | §3 | Chip label rule explicit: enum up to 2 values then "N selected"; entity 1 name then "N selected" because names are long | Sweep P2 |
| 13-filters-search.md | §6 | Picker async search debounce 150 ms -> 250 ms, "Searching" after 300 ms, link to 10 §6.3 | Sweep P2: 10 §6.3 owns |
| 13-filters-search.md | §5 | `inspect` types add `candidate` (Discover candidate, evidence inspector, link to 24 §9.11) | Sweep P2 |
| 13-filters-search.md, 23-application-patterns.md | §5, §15 | `itab` values given as examples including `history` | Prompt inspector tabs |
| 13-filters-search.md, 23-application-patterns.md, 24-page-templates.md | §5, §15 and §1.2, §9.7 | Filter key `source` renamed `domain`; 23 §1.2 row renamed "Domain (cited registrable domain)" | Clash with inspector type `source` (cited URL), inventory #36 |
| 14-badges-status.md | §1 | Added "negative outline" row (used by `Lost` in §2) | Task: consistency sweep |
| 14-badges-status.md | §3 | `StatusBadge` queued icon `CalendarClock`; added icons for completed with errors, partial, budget blocked, cancelled (17 §4.1) | Inventory #59 |
| 14-badges-status.md | §5 | Rank change table notes empty text on first check | Formatter contract (item #53) |
| 14-badges-status.md | §5 | No change: `0`, `0 pts` or `0%`, never a dash glyph | Inventory #53 |
| 14-badges-status.md | §5 | Formatters return `{ text, label, tone }`; accessible names quoted from code `label` ("entered the tracked depth", "dropped out of the tracked depth", "first check", "up 5.3 pts"); `note` for non-detectable | Inventory #52, #53 |
| 14-badges-status.md | §6 | SERPFeatureBadge icon 14 px -> 12 px (`size-icon-xs`, 07 §2) | P1: 14 badge icon |
| 14-badges-status.md | §7 | Split counts: sidebar navigation keeps the `neutral-subtle` count badge (11 §2); tab counts are a plain `type-micro` counter in `foreground-tertiary`, no background, link to 09 §12 | P1: tab count, owner 09 |
| 15-data-visualization.md | §1 item 2 | Series lines 1.75 px, own brand 2 px | Inventory #56 |
| 15-data-visualization.md | §4 | Series line row: own brand 2 px with circle markers, marker shapes per 20 §12.2 (60 points or fewer); reference dash `[4, 3]` changed to `[4, 4]`; new rows "Other" `[8, 4]` and estimates dotted `[1, 3]` | Inventory #56 |
| 15-data-visualization.md | §4 | Chart tooltip radius 8 px changed to `rounded-md` (6 px) per 06 §3 | Task: sweep (06 owns radius) |
| 15-data-visualization.md | §11 | Non-color encodings row points to 20 §12.2 as binding and lists its encodings | Inventory #56 |
| 15-data-visualization.md | §4 | Chart tooltip padding "8 x 10 px" -> 6 px vertical, 8 px horizontal, link to 16 §6.1 | Sweep P2: 16 §6.1 owns |
| 15-data-visualization.md, 25-component-inventory.md | §7, §10.4 | Deep checks keep the series marker (no diamond) | Diamond is a competitor marker in 20 §12.2 |
| 16-drawers-dialogs-popovers.md | intro, §1 | "Side drawer (modal)" container row replaced by non-modal `StatisticsPanel` row (inspector region, 560 px, links 23 §8.6) | Inventory #29 |
| 16-drawers-dialogs-popovers.md | §1.1 | Keyword inspector tabs now Overview, SERP, AI, Timeline (History removed) | Inventory #31 |
| 16-drawers-dialogs-popovers.md | §1.1 | "Page (owned or cited URL)" became "Page (owned URL)"; "Source detail (domain)" became "Domain (registrable domain)"; new row "Source (cited URL)" | Inventory #36 |
| 16-drawers-dialogs-popovers.md | §1.1 | Metric methodology: "Statistics drawer" replaced by `StatisticsPanel` | Inventory #29 |
| 16-drawers-dialogs-popovers.md | §2.1 | Anatomy sketch tab row without History | Inventory #31 |
| 16-drawers-dialogs-popovers.md | §2.2 | 480 px row lists `domain` and `source` types; dropped "new token" note (`--size-inspector-wide` exists) | Inventory #36; Task: sweep |
| 16-drawers-dialogs-popovers.md | §2.3 | Example labels now the keyword set (Overview, SERP, AI, Timeline); automatic activation cites 20 §5 and adds "panels render their skeleton immediately" | Inventory #1, #31 |
| 16-drawers-dialogs-popovers.md | §2.4 | List cap 5 items changed to 10 rows | Inventory #34 |
| 16-drawers-dialogs-popovers.md | §2.4 | Inspector chart height "at most 160 px" changed to 180 px | Inventory #33 |
| 16-drawers-dialogs-popovers.md | §2.5 | Discard AlertDialog reference corrected from section 4.5 to 4.3 | Task: sweep (wrong section ref) |
| 16-drawers-dialogs-popovers.md | §2.6 | Inspector sheet enters from the bottom edge and swipe down closes (was swipe right), cites 21 §4.4 | Inventory #9 (21 §2.1 mobile sheets from the bottom edge) |
| 16-drawers-dialogs-popovers.md | §2.7 | URL example `itab=history` changed to `itab=serp`; `inspect` types add `domain` (registrable domain) and define `source` as a cited URL; "Eight" types became "Nine"; domain added to objects without a full page | Inventory #31, #36 |
| 16-drawers-dialogs-popovers.md | §2.10 | Tab preservation example uses SERP instead of History | Inventory #31 |
| 16-drawers-dialogs-popovers.md | §4.2 | Dialog Close button 28 px changed to 32 px `icon` button (09 §2.2) | Inventory #6 |
| 16-drawers-dialogs-popovers.md | §4.3 | Discard dialog copy from 10 §13.2: "Discard unsaved changes?", "Your changes to this competitor will be lost.", button "Discard changes" (`destructive-solid`) | Inventory #8 |
| 16-drawers-dialogs-popovers.md | §4.5 | Confirm button uses 09 §2.3 `destructive-solid` (`negative-button`, `negative-button-foreground`, `negative-button-hover`) instead of `negative-solid` plus `foreground-inverse` | Inventory #7 |
| 16-drawers-dialogs-popovers.md | §4.5 | Reversible actions: added exception that bulk operations over 100 rows confirm with the count (20 §2, 3.3.4) | Inventory #27 |
| 16-drawers-dialogs-popovers.md | §5.1 | Added notification center exception: "Exception: the notification center popover (18) is 380 px wide and up to 560 px tall.", tied to 05 §4 limits and 18 §5.2 | Task: notification center size |
| 16-drawers-dialogs-popovers.md | §5.2 | Menu shortcut hint rendered as `Kbd` (09 §11) instead of `type-kbd` text; 28 px group row kept | Inventory #57 |
| 16-drawers-dialogs-popovers.md | §6.1, §7.1 | Tooltip and command palette item shortcut hints rendered as `Kbd` (09 §11 lists tooltips and the palette as Kbd places) | Inventory #57 (same rule) |
| 16-drawers-dialogs-popovers.md | §8 | Section rewritten as "Statistics panel": non-modal `StatisticsPanel` in the inspector region per 23 §8.6 (Stats tab or 560 px region, `stats=` URL, no focus trap, no scrim); `SideDrawer` marked Later | Inventory #29 |
| 16-drawers-dialogs-popovers.md | §9 | Overlay motion table aligned with 21 §2.1 and §4: docked inspector content opacity only with instant close; overlay inspector full-width translate; sheet from the bottom; dialogs 8 px translate, palette and popups 4 px, no scale; tooltip enter 150 ms; 21 named as owner | Inventory #9 |
| 16-drawers-dialogs-popovers.md | §10 | Token note says the sizes are defined in tokens.css (they exist); `--size-drawer` annotated as `StatisticsPanel` width | Task: sweep |
| 16-drawers-dialogs-popovers.md | §11 | Component summary adds `StatisticsPanel` (content owned by 23 §8.6) and marks `SideDrawer` Later | Inventory #29 |
| 16-drawers-dialogs-popovers.md | §1.1, §2.7, §3 | Routes aligned to 11 §1.1 (`/seo/keywords/[tkId]`, `/ai/prompts/[promptId]`, `/seo/pages/[urlId]`, `/seo/rankings`, `/settings/alert-rules/[id]`); onboarding "Five steps" to nine steps | Conflict with 11 §1.1, 23 §13, 24 §9.2 |
| 16-drawers-dialogs-popovers.md | §2.1 | Footer row names the Discover `candidate` triage footer exception | 23 §4.1, 24 §9.11, 25 §18.5 |
| 16-drawers-dialogs-popovers.md | §7.2 | Palette action "Toggle theme" to "Theme: System, Light, Dark" | Inventory #39 (theme is a menu) |
| 16-drawers-dialogs-popovers.md | §1 | Tooltip row "One or two lines" -> at most three lines of text, or one mini table (up to 7 rows; chart series up to 8, 15 §10) | Sweep P2 |
| 16-drawers-dialogs-popovers.md | §6.1 | Content rule aligned with §1 (three lines or one mini table, 7 rows, chart series 8) | Sweep P2 |
| 16-drawers-dialogs-popovers.md | §1.1 | Added row "Discover candidate: Inspector 480 px; evidence panel per 24 §9.11; no full page" | Sweep P2 |
| 16-drawers-dialogs-popovers.md | §2.1 | Inspector header spacing made consistent: padding 12 px top, 16 px sides, 12 px bottom; freshness line 12 px above the tabs; tabs are the last header row (was "0 bottom, tabs on bottom edge" vs "12 px bottom padding" and "4 px above" vs "12 px below") | Sweep P2 |
| 16-drawers-dialogs-popovers.md | §2.1 | "Header actions never exceed the five listed" -> six (five plus the optional secondary button) | Sweep P2 |
| 16-drawers-dialogs-popovers.md | §2.2 | More menu adds "Width: Default, Wide, Maximum" (Default = type default, Wide = 640 px `--size-inspector-wide`, Maximum = effective maximum of §2.6) next to "Reset width" (same as Default); width table adds `candidate` to the 480 px row | Sweep P2: 20 §7, 25 §18 |
| 16-drawers-dialogs-popovers.md | §2.4 | "Show all 20" / "Show all N" -> "View all 20" / "View all N" (also in the §2.1 sketch) | Sweep P2: 23 owns wording |
| 16-drawers-dialogs-popovers.md | §2.7 | `inspect` types add `candidate`; "Nine inspector types" -> "Ten"; objects without a full page add candidate | Sweep P2 |
| 16-drawers-dialogs-popovers.md | §5.1 | Added exception: `DateRangePicker` popover (10 §10.2) is 648 px wide (preset column plus two months); "one documented exception" -> "only documented exceptions" (two) | Sweep: DateRangePicker width |
| 16-drawers-dialogs-popovers.md | §10 | Popover token row notes exceptions (notification center 380 px, `DateRangePicker` 648 px, §5.1) | Sweep: DateRangePicker width |
| 16-drawers-dialogs-popovers.md | §4 | "Estimated cost USD 4.10 per month" -> "$4.10" | Sweep P2: formatCurrency, 22 §2 |
| 16-drawers-dialogs-popovers.md, 23-application-patterns.md | §8, §8.6 | Removed "topic" from records with a Stats tab | `topic` is not an inspector type (16 §2.7) |
| 16-drawers-dialogs-popovers.md, 25-component-inventory.md | §1, §3.24 | "source domain" to "domain" in PreviewCard description | Inventory #36 naming |
| 17-empty-loading-error-states.md | header | Implementation folders changed to `components/app/status/` and `components/app/metric/` (26 §2); `FieldError` in `ui/field.tsx`, `TableErrorRow` in `app/data-table/` | Inventory #49 |
| 17-empty-loading-error-states.md | §3.1 | Skeleton animation stated as "pulse, never shimmer" with link to 21 §8.1 | Task: skeleton pulse |
| 17-empty-loading-error-states.md | §3.4 | `RefetchBar` is a static full-width 2 px `primary` bar with no travelling segment (21 §8.3) | Inventory #11 |
| 17-empty-loading-error-states.md | §3.4 | Removed 70% dimming after 400 ms; previous values keep full opacity; added "Updating" spinner after 400 ms in the table toolbar or chart panel header (matches 12 §7.1 and 21 §6) | Inventory #10; Task: sweep |
| 17-empty-loading-error-states.md | §3.5 | Spinner rotates once every 800 ms (was once per second); added allowed place 5 (refetch "Updating" after 400 ms) | Inventory #12; Task: sweep |
| 17-empty-loading-error-states.md | §5.1 | Field error icon 14 px changed to 12 px `CircleX` (`size-icon-xs`), 10 §2 named as owner | Inventory #17 |
| 17-empty-loading-error-states.md | §8 | `BeyondDepth`: cell text `>20` from `formatRankCell` (not a chip); tile and inspector text "not in top 20" from `formatRankInline`; accessible name from `describeRank` | Inventory #16 |
| 17-empty-loading-error-states.md | §2.3 | "Clear filters" in filtered-to-zero state does what "Clear all" does (keeps scope controls) | 13 §2 |
| 17-empty-loading-error-states.md | §3.5 | Spinner places: one list without a fixed count (pending buttons, CollectionProgress/FreshnessIndicator/`StatusBadge` Running, command palette server groups, combobox "Searching" row, on-demand cells, refetch "Updating"); size rule 14 px in `sm` controls, tables, toolbars, badges; 16 px in `md`/`lg` buttons | Sweep P2: 21 §8.2 |
| 17-empty-loading-error-states.md | §8 | `### 8.5` -> `### 8.1`; internal references in §5.4 and §10 updated | Sweep P2 |
| 17-empty-loading-error-states.md | §4.1, §4.2 | "USD 84.20, USD 40.00" -> "$84.20, $40.00"; "USD 1.20 / USD 0.49" -> "$1.20 / $0.49" (sketch realigned) | Sweep P2: formatCurrency |
| 18-notifications-alerts.md | header | Implementation folders: `ui/toast.tsx`; `app/shell/` for bell, center, item; `app/status/` for `Banner`, `SeverityIcon`, `EventTimeline`, `AnomalyHoldNotice`; `features/alerts/components/` for `AlertEventsTable`, `DigestView` (replaces `components/app/notify/`) | Inventory #49 |
| 18-notifications-alerts.md | §1 | Toast lifetime "Seconds" replaced by "6 s without an action; until dismissed with an action or on error" | Inventory #25 |
| 18-notifications-alerts.md | §3.2 | Success 4 s changed to 6 s; action toasts (8 s minimum) now persist until dismissed or the action is used; cites 20 §10.5; timer pause "document is hidden" changed to "window is not focused" (20 §10.5) | Inventory #25 |
| 18-notifications-alerts.md | §3.3 | Undo toast persists and the action stays reversible from its status view; added row "Setting applied immediately (auto-save switch): None" (10 §13.3) | Inventory #26, #42 |
| 18-notifications-alerts.md | §5.2 | Exception sentence also cites 16 §5.1 and states "360 px wide, 400 px tall" limits; 380 x 560 unchanged | Task: notification center size |
| 18-notifications-alerts.md | §3.3 | Copy failure documented as the one error toast for a direct user action | 09 §9.1 vs 18 §3.3 |
| 18-notifications-alerts.md | §4 | Setup checklist removed from dismissible info banners | 23 §13 (not a banner, Overview only) |
| 18-notifications-alerts.md | §7, §10 | Prompt events live in the prompt inspector History tab; prompt link uses `itab=history`; links use `/seo/rankings` and `/ai/prompts` | 23 §4.2 prompt tabs have no Timeline; 11 §1.1 routes |
| 18-notifications-alerts.md | §4 | Budget blocked banner currency -> "$84.20, $40.00" | Sweep P2 |
| 18-notifications-alerts.md | §9 | Budget soft limit copy -> "$1,600 of $2,000 used" | Sweep P2 |
| 18-notifications-alerts.md | §5.2 | Settings button -> `icon-sm` (28 px) icon button with 14 px `Settings` icon, link to 09 §3 | Sweep P2 |
| 18-notifications-alerts.md | §5.2 | "the one documented exception" -> one of two (other: `DateRangePicker` 648 px, 10 §10.2) | Sweep: DateRangePicker width (consistency with 16 §5.1) |
| 18-notifications-alerts.md | §6 | Bulk acknowledge: scope follows 12 §14 (up to 10,000); client sends requests of up to 500 events | Sweep P2 |
| 18-notifications-alerts.md | §7 | Inspector timeline latest 20 -> latest 10 (16 §2.4 cap) | Sweep P2 |
| 19-responsive-behavior.md | §2 | Inspector column: default width per inspector type (was 480, 640 at 1920+) | Inventory #35 |
| 19-responsive-behavior.md | §3.2 | Theme row names `ThemeMenu`; Help row names `HelpMenu` and `CircleHelp`; rows reordered to visual order so Help is immediately left of the user menu | Inventory #39, #40 |
| 19-responsive-behavior.md | §4 | "Reset" after chips replaced with "Clear all" | Inventory #20 |
| 19-responsive-behavior.md | §4 | Result count: table toolbar on table pages, right side of the filter bar on T1 (cross-ref 23 §3.1) | Inventory #63 |
| 19-responsive-behavior.md | §4.2 | Mobile sheet "Clear all" removes filters without resetting scope controls, per 13 §2 (was "resets to screen defaults") | Task: contradiction with 13 |
| 19-responsive-behavior.md | §6.1 | Rule 2 no longer claims `aria-colcount`; says it is omitted per 20 §6.2 | Inventory #23 (consistency) |
| 19-responsive-behavior.md | §6.1 | Rule 4 prompt identity max 560 to 640 px (12 §5) | Inventory #65 |
| 19-responsive-behavior.md | §6.2 | Keyword: location and device in the tooltip, not inline chips | Inventory #64 |
| 19-responsive-behavior.md | §6.2 | Rank 72 to 64 px, `>20` text from `formatRankCell`, no chip | Inventory #45, #16 |
| 19-responsive-behavior.md | §6.2 | Change 72 to 56 px, `RankDeltaCell` (was `DeltaCell`), values `↑5`, `↓3`, `0`, `New`, `Lost`, empty on first check | Inventory #45, #47, #53 |
| 19-responsive-behavior.md | §6.2 | `UrlCell` to `URLCell` | Inventory #48 |
| 19-responsive-behavior.md | §6.2 | Visible-set sums recomputed: 920 / 1136 / 1320 | Inventory #45 (follow-on) |
| 19-responsive-behavior.md | §6.3 | Prompt 320 (240, 560) to 360 (240, 640) | Inventory #65 |
| 19-responsive-behavior.md | §6.3 | `RateCell` to `MetricCell`; engine columns 112 to 72 px as `EngineMetricCell` (`engineGroup`, 12 §5) so the 1440 set still fits | Inventory #48, #65 (budget fit) |
| 19-responsive-behavior.md | §6.3 | Visible-set sums recomputed with checkbox column: 840 / 1076 / 1312 | Inventory #65 (follow-on) |
| 19-responsive-behavior.md | §6.4 | "Reset columns" renamed "Reset to default" per 12 §10 | Task: contradiction with 12 |
| 19-responsive-behavior.md | §6.7 | Sketch and parts table: `>20` instead of "Not in top 20", `Lost` casing, `RankDeltaCell` | Inventory #16, #47 |
| 19-responsive-behavior.md | §7 | Inspector default width per type at 1680+ (480 keyword etc., 640 prompt, citation, answer; 16 §2.2); 1920 docking row no longer says "640 default" | Inventory #35 |
| 19-responsive-behavior.md | §10 | Navigation items 28 px (32 px square in collapsed rail) | Inventory #43 |
| 19-responsive-behavior.md | §10 | Rule 3: `--size-control-touch` now exists in tokens.css (was "needs a new token") | Task: token accuracy |
| 19-responsive-behavior.md | §11 | Imports entry point references 11 §1.1 Imports tab instead of undefined `rankings/import` route | Task: routes owned by 11 |
| 19-responsive-behavior.md | §12.3 | `ChartPanel` to `ChartFrame` | Inventory #48 |
| 19-responsive-behavior.md | §13.1 | 2560 and 1920 rows: inspector docked at type default (480 keyword, 640 prompt) | Inventory #35 |
| 19-responsive-behavior.md | §6.1 to §6.3 | Competitor 88 to 120 px and Updated 96 to 104 px (were below type minimums); visible-set totals recomputed with checkbox and actions columns | 12 §5 min widths |
| 19-responsive-behavior.md | §11 | Phone single-record actions live in the inspector header or More menu, not the footer | Inventory #30 |
| 19-responsive-behavior.md | §7 | 480 px inspector type list adds `candidate` | 16 §2.2 |
| 19-responsive-behavior.md | §3.3 | Secondary actions "Visible, up to 3" -> up to 2 visible secondary buttons, rest in More (link 23 §3.1) | Sweep P3 (09, 23 §3.1) |
| 19-responsive-behavior.md | §3.4 | Removed "bottom bulk-action bar ... scroll-padding-bottom"; bulk bar replaces the toolbar at the top (12 §1), scroll-padding-top covers it with the sticky table header | Sweep P3 (12 §1) |
| 19-responsive-behavior.md | §5 | Metric strip table rewritten to 23 §2.3 rule (content-sized 140 to 280 px; one row when width >= n x 140 + (n - 1) x 49; else two rows, ceil(n/2) first; two-column grid below 768 px viewport). Recomputed sums: one-row minimums 518 / 707 / 896 / 1,085 px for 3 to 6 items; 6 items fit from a 1,341 px viewport (main column 1,024 at 1280, 1,184 at 1440); 928 px at 1024 fits 5; 736 to 991 px at 768 to 1023 fits 4 (5 from 928 px viewport) | Sweep P3 (23 §2) |
| 19-responsive-behavior.md | §6.6 | Tablet table default density Comfortable -> Compact (32 px rows meet 24 px target); Comfortable available; intro now says secondary line appears in Comfortable | Sweep P3 (hard rule: 32 px rows default) |
| 19-responsive-behavior.md | §10 | Touch targets table: tablet rows "40 px default" -> "32 px compact default, 40 px comfortable" | Sweep P3 (same) |
| 19-responsive-behavior.md | §13.1 | 1024 x 768 check: "comfortable default" -> "compact default" | Sweep P3 (same) |
| 19-responsive-behavior.md | §7 | Inspector default widths: 640 px for prompt, citation, answer evidence; 480 px for every other type incl. source and domain (link 16 §2.2) | Sweep P3 (16 §2.2) |
| 19-responsive-behavior.md | §7 | Tablet overlay width `min(stored width, 100vw - 96px)` -> `min(stored width, 720px, 100vw - 56px)` (link 16 §2.6) | Sweep P3 (16 §2.6) |
| 19-responsive-behavior.md | §8 | Chart heights defer to 15 §2 (standard 240, Overview main 280, small multiple 140, matrix 480 min 400, inspector 180 at every width); x labels no closer than 64 px (15 §6); matrix scatter replaced below 1024 px viewport (15 §8); phone 180 px rule kept | Sweep P3 (15 §2, §6, §8) |
| 19-responsive-behavior.md | §9 | Dialog max height -> top at 12vh, max height viewport minus 12vh minus 48 px (16 §4.2) | Sweep P3 (16 §4) |
| 19-responsive-behavior.md | §9 | Popover row notes the date range picker exception at 648 px (16 §5.1) | Sweep P3, DateRangePicker width |
| 19-responsive-behavior.md | §12.3 | `MetricStrip` row: narrow = two rows, wide = one row when section 5 width rule met; `ChartFrame` row: inspector charts 180 px, heights per §8 | Sweep P3 (23 §2, 15 §2) |
| 19-responsive-behavior.md | §12.3 | Code example `<ChartCanvas className=...>` -> `<EChart option ariaDescription height={240} />` plus note that `EChart` takes numeric height (25 §10.2) | Sweep P3 (25 §10.2) |
| 19-responsive-behavior.md, 20-accessibility.md | §4, §14 | "Add filter" label to "+ Filter" | 13 §2 label |
| 20-accessibility.md | §2 (1.4.1) | Ranks carry arrows, metrics carry signs; adds `RankDeltaCell` | Task: hard rule (arrows vs signs) |
| 20-accessibility.md | §2 (2.2.1) | Action toasts and error toasts never auto-dismiss | Inventory #25 |
| 20-accessibility.md | §2 (3.3.4) | Undo toast persists, action reversible from status view (was 10 s); bulk over 100 rows confirms with the row count | Inventory #26, #27 |
| 20-accessibility.md | §5 (Tabs) | Path tabs are `TabNav` links, not a tablist | Inventory #4 |
| 20-accessibility.md | §6.3 | Printable-character note now names `j`, `k` and triage keys as section 14 shortcuts under the same switch | Task: WCAG 2.1.4 consistency |
| 20-accessibility.md | §9.1 | Rule 5 drops "Not in top 20" from badges; rule 7 cells "Insufficient", tiles and inspector "Insufficient data" | Inventory #16, #14 |
| 20-accessibility.md | §9.2 | Contract: `{ text, label, tone }`, `describeRank`, `formatRankCell`, `formatRankInline`; code sample `srText` to `label` | Inventory #52 |
| 20-accessibility.md | §9.2 | Rank row "rank 4"; beyond depth `>20` text in cells, "not in top 20" in tiles and inspector | Inventory #16, #52 |
| 20-accessibility.md | §9.2 | No change `0` (no dash); New "entered the tracked depth"; Lost "dropped out of the tracked depth"; first check empty text, label "first check"; added "still beyond tracked depth" row | Inventory #53 |
| 20-accessibility.md | §9.2 | Insufficient and not-applicable rows aligned with 17 §8 (cell vs tile text, accessible names) | Inventory #14 |
| 20-accessibility.md | §9.2 | "The formatter owns `srText`" to `label` | Inventory #52 |
| 20-accessibility.md | §10.5 | Rule 4 limited to success and info toasts; rule 5 adds error toasts to persist-until-dismissed | Inventory #25 |
| 20-accessibility.md | §13.3 | Forced colors: "Insufficient" cell text remains | Inventory #14 |
| 20-accessibility.md | §14 | `/` split by page type; added `g` sequences, `f`, `j`/`k`, triage `a`/`r`/`s`/`e` rows, all disableable | Inventory #21; Task: WCAG 2.1.4 |
| 20-accessibility.md | §14 | Rule 2: switch is "Single-key shortcuts" in the user menu, covers single characters and sequences | Task: WCAG 2.1.4 consistency with 11 |
| 20-accessibility.md | §15 | Metric popover ends with the "Methodology" link (was "Read methodology"), per 22 §10 and 23 §8.1 | Task: contradiction with 22, 23, 25 |
| 20-accessibility.md | §17 | Removed "10-second Undo window"; toast persists and action stays reversible from status views | Inventory #26 |
| 20-accessibility.md | §19 | `Toast`: action and error toasts never auto-dismiss | Inventory #25 |
| 20-accessibility.md | §19 | `MetricTile` to `MetricItem`, `srText` to formatter `label` | Inventory #48, #52 |
| 20-accessibility.md | §19 | `RankCell` uses `describeRank`, `>20` text not chip; new `RankDeltaCell` row; `DeltaCell` uses `formatMetricDelta` label with sign | Inventory #16, #47, #52, #53 |
| 20-accessibility.md | §19 | `RateCell` to `MetricCell`, `UrlCell` to `URLCell`, `FeatureIconsCell` to `SERPFeatureList`, `ErrorState` to `ErrorPage` | Inventory #48 |
| 20-accessibility.md | §6.8 | Mobile list link `?keyword=kw_123` to `?inspect=keyword:kw_123` | 16 §2.7 canonical inspector URL |
| 20-accessibility.md | §10.5 | Toasts are not copied to the notification center; recovery path stated | 18 §5.6 owns notification center sources |
| 20-accessibility.md | §17 | Removed "Undo is also available from the notifications panel" | Inventory #26, 18 §5.6 |
| 20-accessibility.md | §2 (2.2.2) | Continuous motion limited to three elements: spinner, live indicator, skeleton pulse (21 §1); Reduce motion stops all three (21 §8) | Sweep P3 (21 §1) |
| 20-accessibility.md | §2 (2.2.1, 2.5.1, 3.3.4, 4.1.3) | Component column: `Toast` -> `Toaster` / `toast()`; `AlertDialog` -> `ConfirmDialog` (Base UI AlertDialog) | Sweep P3 (25 names) |
| 20-accessibility.md | §4.1 | Inset ring applies to all tabs (page, inspector and segmented) | Sweep P3 |
| 20-accessibility.md | §4.2 | Removed bottom bulk bar `scroll-padding-bottom`; bulk bar replaces toolbar at top (12 §1), scroll-padding-top covers header and bulk bar | Sweep P3 (12 §1) |
| 20-accessibility.md | §5 | `AlertDialog` -> `ConfirmDialog` (Base UI AlertDialog); `Accordion` removed, `Collapsible` (`ui/collapsible.tsx`); `ToggleGroup` -> `SegmentedControl` / `ToggleButton`; `Toast` -> `Toaster` / `toast()` | Sweep P3 (25 names) |
| 20-accessibility.md | §5 | DateRangePicker presets 7, 28 and 90 days, 12 weeks (link 10 §10.2) | Sweep P3 (10 §10) |
| 20-accessibility.md | §6.2 | Sort header markup: text arrow glyph -> `ArrowUpNarrowWide` icon (aria-hidden) | Sweep P3 (07 §6) |
| 20-accessibility.md | §6.5 | Sort direction indicator is the `ArrowUpNarrowWide` / `ArrowDownWideNarrow` icon, no text glyph | Sweep P3 (07 §6) |
| 20-accessibility.md | §11.2 | Error summary threshold "up to 5 fields" -> "up to 6 fields and one section"; heading "2 problems need fixing" -> "Fix 2 fields to save" (10 §18) | Sweep P3 (10 §18) |
| 20-accessibility.md | §12.1 | Code comment `ToggleGroup` -> `SegmentedControl`, Patterns `ToggleButton` | Sweep P3 (25 names) |
| 20-accessibility.md | §13.3 | Removed filter chips from surfaces needing a transparent border (chips have a visible 1 px `border`, 13 §2) | Sweep P3 |
| 20-accessibility.md | §19 | `Link` -> `TextLink`; `ToggleGroup` -> `SegmentedControl` / `ToggleButton`; `AlertDialog` -> `ConfirmDialog` (Base UI AlertDialog); `Toast` -> `Toaster` / `toast()`; removed "history in notifications" (toasts not copied, §10.5) | Sweep P3 (25 names, 18 §5.6) |
| 20-accessibility.md | §19 | `MetricCell` speech: value from `formatPercent`, `k of n` from `formatSampleCount`, interval from `formatInterval` | Sweep P3 (no rate `label` formatter) |
| 20-accessibility.md, 22-content-formatting.md | §9.1, §19, §2 | Missing value shows `n/a` with accessible name "No data" | 20 "No data" vs 22 and code `n/a` |
| 21-motion.md | §1 item 7, §12 | Continuous animation allowance includes the skeleton pulse (was spinner and live indicator only, which contradicted §8.1) | Task: skeleton pulse; sweep (internal contradiction) |
| 21-motion.md | §6 item 2 | Chart refetch: static 2 px `RefetchBar` under the panel header plus "Updating" spinner after 400 ms, cites 17 §3.4 and §3.5 | Inventory #10, #11 |
| 21-motion.md | §8.2 | Spinner delay row names the `RefetchBar` next to the refetch spinner, cites 17 §3.4 | Inventory #11 |
| 21-motion.md | §8.3 item 2 | States that `RefetchBar` is a static 2 px bar that never moves | Inventory #11 |
| 21-motion.md | §2, §2.1, §4.6 | Toast exit 150 ms -> 100 ms (`--duration-fast`) in the table, token usage row and CSS sketch | Sweep P2: exits faster than enters (21 §1) |
| 21-motion.md | §8.3 | Removed "polls arrive every 2 to 5 s"; progress updates arrive at the API's `Retry-After` interval (17 §4.3) | Sweep P2 |
| 21-motion.md | §8.2 | Spinner glyph size aligned with 17 §3.5 (14 px `sm` controls, tables, toolbars, badges; 16 px `md`/`lg` buttons) plus pointer to the allowed-places list | Sweep P2 (consistency with 17) |
| 22-content-formatting.md | §3 | Beyond depth: plain `>20` text in cells, never a chip; "not in top 20" in tiles, inspector, tooltips | Inventory #16 |
| 22-content-formatting.md | §3 | Added "Beyond depth in both checks: empty, 'still beyond tracked depth'" row (matches rank.ts) | Task: match code |
| 22-content-formatting.md | §4 | Durations: no formatter exists; one must be added to `lib/format` with tests before use | Inventory #54 |
| 22-content-formatting.md | §10 | `MetricInfo` content order aligned with 23 §8.1 (aggregation, "Open statistics", "Methodology" last) | Task: contradiction with 23 |
| 22-content-formatting.md | §2 | Rate change speech "up 5.3 points" -> "up 5.3 percentage points" (link 20 §9.2) | Sweep P3 (20 §9.2) |
| 22-content-formatting.md | §5 | External link icon in text links 12 px -> 14 px (07 §2 allows 12 px only in badges, chips, delta arrows); `ExternalLinkButton` 14 px `sm` / 16 px `md` (09 §9.2) | Sweep P3 |
| 22-content-formatting.md | §7 | Freshness examples -> "Last collected Sep 29, 18:30 CEST", "Stale: last collected Sep 27, 18:30 CEST" (17 §7.1) | Sweep P3 (17 §7.1) |
| 23-application-patterns.md | §1.1 | L4 trigger and rule 5 say "Open page" (inspector header text button), not "Open full page" | Inventory #30 |
| 23-application-patterns.md | §2.4 | Refetching: full opacity, no dimming, static 2 px `RefetchBar` (was 60% opacity) | Inventory #10, #11 |
| 23-application-patterns.md | §2.4 | Insufficient data tile value is "Insufficient data"; hatching per 17 §8 (was 12 §7.3); cells keep "Insufficient" | Inventory #13, #14 |
| 23-application-patterns.md | §3.1 | Result count removed from filter bar sketch; spec: table toolbar on table pages, filter bar on T1 | Inventory #63 |
| 23-application-patterns.md | §4 intro | Inspector frame widths: 480 px default, 640 px for prompt, citation and answer evidence | Inventory #35 |
| 23-application-patterns.md | §4.1 | Sketch redrawn: header row 1 with "12 of 986", "Check now", "Open page", prev/next, More, Close; badges and freshness rows; tabs in header; Timeline tab; strip as first section; footer removed | Inventory #30, #31 |
| 23-application-patterns.md | §4.1 | Header spec follows 16 §2.1: frequent action and "Open page" text button in row 1, no `Maximize2`; type label `type-meta`; title clamped to 2 lines with full text in the first section | Inventory #30, #32 |
| 23-application-patterns.md | §4.1 | Summary strip is the first section of Overview; tabs sit at the bottom of the header (16 §2.3) | Task: agree with 16 §2.1 |
| 23-application-patterns.md | §4.1 | Footer: edit mode only (16 §2.5), with the Discover triage footer as the one exception (matches 25 §18.5) | Inventory #30 |
| 23-application-patterns.md | §4.2 | Keyword tabs Overview, SERP, AI, Timeline (Events renamed); Timeline section latest 20 with "Open full timeline" | Inventory #31, #62 |
| 23-application-patterns.md | §4.2 | Object rows renamed "Domain (`domain`, registrable domain)" and "Source (`source`, cited URL)" | Inventory #36 |
| 23-application-patterns.md | §4.3 | "Open full page" renamed "Open page" | Inventory #30 |
| 23-application-patterns.md | §6.4 | Deltas list adds `RankDeltaCell` | Inventory #47 |
| 23-application-patterns.md | §7.1 | Beyond depth: `>20` in `columns` form, "not in top 20" in `inline` form | Inventory #16 |
| 23-application-patterns.md | §8.4 | Hatching per 17 §8 (1 px `border-subtle` lines on `surface-subtle`); "Insufficient" in cells, "Insufficient data" in tiles and inspector | Inventory #13, #14 |
| 23-application-patterns.md | §9.1 | `EventTimeline` follows 18 §7: 64 px date column, rows min 28 px, glyphs per 18, "Show older events" 28 px secondary, 28 px filter toolbar | Inventory #62 |
| 23-application-patterns.md | §10.1 | Promote to tracked moved from inspector footer to the inspector More menu | Inventory #30 |
| 23-application-patterns.md | §10.3 | Row removal is instant, no height collapse (21 §12) | Inventory #28 |
| 23-application-patterns.md | §10.3 | `TriageToast` has an action, so it persists until dismissed (20 §10.5); step 6 wording adjusted | Inventory #25, #26 |
| 23-application-patterns.md | §10.4 | Bulk triage over 100 rows confirms with the count (20 §2, WCAG 3.3.4); 10,000 is the max bulk scope (12 §14) | Inventory #27 |
| 23-application-patterns.md | §12.1 | `CollectionProgress` defers to 17 §4; meta line uses compact density without a bar; standard density row with 4 px bar on `surface-subtle` | Inventory #61 |
| 23-application-patterns.md | §15 | `inspect` lists all types incl. `domain` and `source` (cited URL), defined in 13 and 16 §2.7; `itab` adds `timeline`, defined in 16 §2.7 | Inventory #36, #31 |
| 23-application-patterns.md | §16 | `TriageToast` persists until dismissed; `InsufficientData` and `CollectionProgress` point to 17; `Maximize2` icon assignment removed | Inventory #25, #13, #61, #30 |
| 23-application-patterns.md | §17 | Statistics row cites 16 §8 and states `SideDrawer` moves to Later | Inventory #29 |
| 23-application-patterns.md | §4.2 | Prompt inspector History tab adds `EventTimeline` (latest 20) | Same as above |
| 23-application-patterns.md | §2.4 | Not-applicable tile uses `NotApplicable` text per 17 §8; `n/a` kept for values that do not exist for the scope | Inventory #15 |
| 23-application-patterns.md | §1.2 | Cited-domain drill-down key `source=` to `domain=` | Inventory #36, 13 §5 |
| 23-application-patterns.md | §12.1 | Completion toast only for runs the user started | 17 §4.3 scheduled runs never toast |
| 23-application-patterns.md | §1 | L3 inspector width now "480 px; 640 px for prompt, citation and answer evidence" with link to 16 §2.2 | P4: 16 §2.2 widths |
| 23-application-patterns.md | §2.4 | Loading row: real label kept, value bar 18 x 56 px, context bar 10 x 120 px (17 §3.2) | P4: 17 §3 metric strip skeleton |
| 23-application-patterns.md | §2.4 | Not yet collected tile value "First check scheduled for Sep 30, 02:00 CEST"; `Pending` is cell form only | P4: 17 §8 |
| 23-application-patterns.md | §2.7 | Delta speech "up 2.1 percentage points, within normal variation" | P4: rate delta speech |
| 23-application-patterns.md | §3.3 | T1/T3 filters reached by scrolling, Tab or "+ Filter"; `f` opens "+ Filter" on table pages only | P4: 20 §14 |
| 23-application-patterns.md | §4.1 | `SimpleTable` rows 32 px | P4: 32 px rows |
| 23-application-patterns.md | §4.2 | Keyword and prompt `EventTimeline` latest 10 events; prompt History observations table last 10, at most 4 columns, replicate in tooltip | P4: 16 §2.4 caps |
| 23-application-patterns.md | §4.3 | Alert event opens the inspector of the event's entity (18 §6), not an alert event inspector | P4: 18 §6 |
| 23-application-patterns.md | §1.1, §8.5 | "±2" replaced by "up to 2 positions" (table row and tooltip) | P4: normal movement wording |
| 23-application-patterns.md | §2.6, §7.3, §8.5, §15, §17 | "doc 20" / "doc 15" replaced by links to ../20-frontend-specification.md and ../15-seo-ai-correlation.md | P4: explicit links |
| 23-application-patterns.md | §9.1 | Inspector timeline shows latest 10 | P4: 16 §2.4 cap |
| 23-application-patterns.md | §10.2 | Triage keys only on a focused row; `j` and `k` work in the grid or the inspector (20 §14) | P4: 20 §14 |
| 23-application-patterns.md | §10.3 | Removed `⌘Z` hint from TriageToast Undo button | P4: no Cmd+Z shortcut, buttons show no inline hints |
| 23-application-patterns.md | §11.5, §16 | `BudgetStatusBadge` is a `Badge` preset (tone and icon fixed per state) | P4: Badge preset |
| 23-application-patterns.md | §12.2 | Stale example "Stale: last collected Sep 27, 18:30 CEST" (17 §7.1) | P4: 17 §7.1 |
| 23-application-patterns.md | §15 | `inspect` types add `candidate` (Discover candidate); `stats` row links 20-frontend §6 and 16 §8 | P4: candidate type, explicit links |
| 23-application-patterns.md | §17 | Table reframed as superseded statements ("Earlier: ..."), column "Resolution (current rule)"; statistics row cites 16 §8 non-modal, itab row cites 13 §5 replace | P4: §17 superseded rows |
| 23-application-patterns.md, 06-surfaces-borders-radius.md, 19-responsive-behavior.md, 25-component-inventory.md | §2.1 to §2.3, §5, §5, §9.2 | `sm` strip: item min 96 px, divider spacing 8 px, one-row rule `n x 96 + (n - 1) x 17`; "below 768 px" is the viewport | 64 px one-row inspector strip was impossible under the 140 px rule (3 items need 518 px) |
| 23-application-patterns.md, 24-page-templates.md, 05-layout-grid.md | §3.2, §5, §2 | Detail page header budget adds 20 px for the back link: 128 px, or 172 px with tabs | 16 §3 back link not budgeted |
| 23-application-patterns.md, 25-component-inventory.md | §11.5, §17.3 | Budget blocked glyph `TriangleAlert` to `Receipt` | 07 §6, 17 §4.1, 25 `StatusBadge` |
| 23-application-patterns.md, 25-component-inventory.md | §6.4, §8.5 | Version boundary on a delta uses `GitCommitVertical` (not `TriangleAlert`) | 07 §6 one meaning per glyph |
| 24-page-templates.md | §4 | T2 sketch: count moved from filter bar to toolbar; inspector tabs in header, strip as first section; footer "edit mode only" | Inventory #63, #30 |
| 24-page-templates.md | §4 | Footer region is `TableFooter` with range text and prev/next only in server mode, no page numbers; components list adds `TableFooter` | Inventory #24 |
| 24-page-templates.md | §4 | Inspector region: tabs in header, strip first section, footer edit mode only; responsive uses viewport tiers (19 §6.1) | Inventory #30, #46 |
| 24-page-templates.md | §5 | "Open page"; `ObjectHeader` renamed `DetailPageHeader` (sketch, region, components); Events "Show older events" | Inventory #48, #30, #62 |
| 24-page-templates.md | §6 | Discard dialog "Discard unsaved changes?" with "Keep editing" and "Discard changes" | Inventory #8 |
| 24-page-templates.md | §6 | Immediate switch applies with no toast | Inventory #42 |
| 24-page-templates.md | §6 | Typed confirmation only for project or workspace deletion; removing a member is a normal confirm | Inventory #44 |
| 24-page-templates.md | §7 | Query matching is a checkbox in the save-bar form | Inventory #41 |
| 24-page-templates.md | §9.1 | Shell sketch: Help in top bar; inspector header with "Check now" and "Open page"; Timeline tab above strip; footer "edit mode only"; footer without page numbers; note on More menu | Inventory #30, #31, #40, #24 |
| 24-page-templates.md | §9.1 | Top bar: search 320 px at 1440 and up, 240 px at 1280 to 1439; help menu; theme menu moves into user menu below 1280 | Inventory #38, #39, #40 |
| 24-page-templates.md | §9.1 | Inspector width note (640 px for prompt, citation, answer evidence); toasts never cover a docked inspector (18 §3.1) | Inventory #35; Task: numbers |
| 24-page-templates.md | §9.3 | Count removed from filter bar; Updated column removed from 1440 sketch | Inventory #63, #46 |
| 24-page-templates.md | §9.3 | Column priorities per 19 §6.1 and §6.2: identity 1, Volume 2, Updated 4, Competitor 4, Trend 2; `RankCell`, `RankDeltaCell`, `URLCell` named | Inventory #46, #47, #48 |
| 24-page-templates.md | §9.3 | Width resolution: tiers follow viewport; docked inspector keeps the 1440 set and scrolls horizontally; 1280, 1024 and 768 sets per tiers; overlay math per 16 §2.6 | Inventory #46 |
| 24-page-templates.md | §9.3 | Bulk Archive over 100 rows confirms with the count | Inventory #27 |
| 24-page-templates.md | §9.3 | Inspector tabs Overview, SERP, AI, Timeline | Inventory #31 |
| 24-page-templates.md | §9.4 | `DetailPageHeader`; `HeatmapChart` renamed `Heatmap`; Events latest 50 with "Show older events" | Inventory #48, #62 |
| 24-page-templates.md | §9.5 | Intro: prompt inspector docks at 504 px at 1440 (was "overlays"), per 16 §2.6 | Task: numbers contradicting 16 |
| 24-page-templates.md | §9.5 | Prompt inspector header with "Run now" and "Open page"; tabs moved above strip; count removed from filter bar | Inventory #30, #63 |
| 24-page-templates.md | §9.5 | Column priorities per 19 §6.3 (Prompt 1, engines 2, Trend 3, Top competitor 4, Updated 4); docking never changes the set; actions "Open page" | Inventory #46, #30 |
| 24-page-templates.md | §9.6 | `PageHeader` object mode renamed `DetailPageHeader` | Inventory #48 |
| 24-page-templates.md | §9.7 | Count removed from filter bar (toolbar has it) | Inventory #63 |
| 24-page-templates.md | §9.10 | `DetailPageHeader` | Inventory #48 |
| 24-page-templates.md | §9.11 | Candidate inspector: More instead of Open (no full page); count removed from filter bar; triage footer noted as the one non-edit footer | Inventory #30, #63 |
| 24-page-templates.md | §9.12 | Query matching `[x]` checkbox; region note | Inventory #41 |
| 24-page-templates.md | §9.13 | Engine Enabled column as checkboxes; form uses `Checkbox`, never switches in save-bar forms | Inventory #41 |
| 24-page-templates.md | §10 | `TopBar` lists help and theme menus; `Maximize2` icon note replaced by "Open page" text button | Inventory #40, #30 |
| 24-page-templates.md | §9.3, §9.5 | Column widths follow 19 §6.2 and §6.3 screen values; table regions subtract the 20 px gutters (1,664 / 1,424 / 1,184 / 704 / 1,024 / 928 / 736 px); totals recomputed | 19 §6 width budgets, 04 page gutter |
| 24-page-templates.md | §9.10 | External link button on Page Intelligence renamed "Visit page"; "Open page" stays the inspector full-page action | Same label for two actions |
| 24-page-templates.md | §6 | Typed confirmation uses the slug, not the name | 16 §4.5 |
| 24-page-templates.md | §3 (T1 responsive) | Phone charts 200 px, 180 px below a 480 px container (19 §8) | P4: match 19 §8 |
| 24-page-templates.md | §9.2, §9.5, §9.9 | "Doc 20 section 5.2", "Doc 20 section 5.6", "Doc 15 section 6" replaced by explicit links | P4: explicit links |
| 24-page-templates.md | §9.3 | At 1280 the main column would be 584 px (1,064 minus 480), below 720 px minimum | P4: arithmetic fix |
| 24-page-templates.md | §9.16 (Costs) | Breakdown switch uses `Tabs variant="segmented"` (panels switch, 09 §6) | P4: 09 §6 |
| 24-page-templates.md | §10 | `Banner`: one or two sentences, up to 2 actions (18 §4) | P4: 18 §4 |
| 24-page-templates.md, 25-component-inventory.md | §9.1, §5.3 | "11 destinations in 4 groups" to "15 items in 3 sections" | 11 §1 |
| 25-component-inventory.md | §23 items 26, 27 | "20 §3.3.4" corrected to "20 §2 (SC 3.3.4)" (no section 3.3.4 exists) | Broken cross-reference |
| 25-component-inventory.md | §12.1 | `EventTimeline` use: keyword inspector Timeline tab, prompt inspector History tab | Same as above |
| 25-component-inventory.md | §5.10 | Removed stale "glyph to add to 07 §6" | Inventory #40 done |
| 25-component-inventory.md | §3.23 | Popover `width` adds 'date-range' (648 px) | 10 §10.2, 16 §5.1 exception |
| 25-component-inventory.md | §1.5 | `InspectorType` adds `'candidate'` | P4: candidate type |
| 25-component-inventory.md | §2, §3.5 | `SegmentedControl` built on Base UI `RadioGroup` (`ui/radio-group.tsx`); `toggle-group.tsx` for independent toggles only; A11y line no longer claims 09 §6 uses `aria-pressed` | P4: 09 §6, inventory #2 |
| 25-component-inventory.md | §2, §11 | "17 §8.5" changed to "17 §8.1" (4 places: CollectionIssue, UncertainFootnote rows and entries) | P4: 17 renumbered |
| 25-component-inventory.md | §3.10 | `Icon` size names 'xs' 12, 'sm' 14, 'default' 16, 'md' 18, 'lg' 20 matching `size-icon-*` tokens | P4: 07 §2 and tokens |
| 25-component-inventory.md | §3.12 | Spinner places refer to the 17 §3.5 list (no count); refetch "Updating" text is an allowed place | P4: 17 §3.5 |
| 25-component-inventory.md | §3.28 (Dialog) | `DialogFooterProps.start`: step "Back" (16 §4.6) or a destructive outline action in a non-destructive dialog (09 §2.6) | P4: match 09 line 108 |
| 25-component-inventory.md | §3.30 | `ConfirmDialog`: naming note on `AlertDialog` alias | P4: AlertDialog alias |
| 25-component-inventory.md | Toast entry | Removed "each toast is also listed in the notifications panel for the session" | P4 |
| 25-component-inventory.md | Combobox entry | "Searching" row after 300 ms | P4 |
| 25-component-inventory.md | SaveBar entry | `pb-20` replaced by `pb-12` plus `scroll-padding-bottom` of the 56 px save bar (10 §13.2) | P4: match 10 |
| 25-component-inventory.md | DetailPageHeader, MetricCell, URLCell, MetricItem, Heatmap, ErrorPage, SERPFeatureList | "Also called X" changed to "Formerly called X ... (section 23, item 48)" (7 places, incl. URLCell) | P4: item 48 |
| 25-component-inventory.md | FilterBar entry | Result count announced 500 ms after the last filter change, once results arrive (20 §10.2) | P4: 20 §10.2 |
| 25-component-inventory.md | §7.11 SimpleTable | Rows 32 px | P4: 32 px rows |
| 25-component-inventory.md | RankDeltaCell | Tooltip "up to 2 positions" | P4 |
| 25-component-inventory.md | §8.5 DeltaCell | `intervalText` needs a points-interval formatter to be added to `lib/format`; A11y text is formatter `label` plus `note`, detectable-change phrase to be added to `formatMetricDelta` | P4: no text composition in cells |
| 25-component-inventory.md | §9.2 MetricItem | Not collected text per 17 §8; not applicable text per 17 §8 | P4: 17 §8 |
| 25-component-inventory.md | CollectionProgress | `taskBreakdown` adds `submit_unknown` | P4: 17 §4.1 in flight |
| 25-component-inventory.md | StatusBadge entry | "Not for" budget states now names `BudgetStatusBadge` as a `Badge` preset | P4: Badge preset |
| 25-component-inventory.md | §12.1 EventTimeline | `pageSize` 10 or 50; inspector latest 10 | P4: 16 §2.4 cap |
| 25-component-inventory.md | AlertEventsTable | "(max 500)" changed to "(sent in requests of up to 500)" | P4 |
| 25-component-inventory.md | TriageToast | Removed `⌘Z` Kbd hint | P4: no Cmd+Z shortcut |
| 25-component-inventory.md | §14.4 SERPFeatureBadge | Icon 12 px | P4 |
| 25-component-inventory.md | §17.3 BudgetStatusBadge | `Badge` preset, tone and icon fixed per state | P4 |
| 26-implementation-guidelines.md | §1 | `components/app/` row mentions forms and status | Inventory #49, #50 |
| 26-implementation-guidelines.md | §2 | `ui/` listing completed with every primitive file used in docs (spinner, icon-button, split-button, toggle-button, segmented-control, toolbar, copy-button, pagination, search-input, save-bar, calendar and others) plus `icons/custom/`; 26 names `radio-group.tsx`, `field.tsx`, `number-field.tsx` kept | Inventory #51; Task: folder list |
| 26-implementation-guidelines.md | §2 | New `app/forms/` (FormField, UrlInput, DomainInput); `app/types.ts`; status, metric, chart, shell contents completed; `lib/a11y/` and `lib/forms/` added | Inventory #49, #50; Task: folder list |
| 26-implementation-guidelines.md | §2 | Rule 1: primitives never format, receive display strings; `NumberInput` stays in `ui/number-field.tsx` and receives its format from the caller | Inventory #50 |
| 26-implementation-guidelines.md | §2 | Rule 2: import list aligned with 25 §1 (lib/a11y, contract types, next/link); only `app/forms/` imports react-hook-form and `@contracts` normalizers; `MetricCell` contract type imported as `MetricCellValue` | Inventory #50, #55 |
| 26-implementation-guidelines.md | §2 | `numberInputFormat` marked "to be added" (25 §23 item 54) | P4 |
| 26-implementation-guidelines.md | §2 | `lib/utils.ts` (`cn`) added to the lib listing | P4 |
| 26-implementation-guidelines.md | §5 | Button CVA sketch replaced by a pointer to 09 §2.9 (7 variants, `icon-xs`, base `border`); `cn` source named (`@/lib/utils`) | P4: sketch drifted from 09 |
| 27-design-review-checklist.md | §1 States | Refetch at full opacity, no dimming, static 2 px `RefetchBar` | Inventory #10, #11 |
| 27-design-review-checklist.md | §1 Responsive | Column priorities follow viewport tiers, not inspector state (19 §6.1) | Inventory #46 |
| 27-design-review-checklist.md | §3 | Oversized header fix points to 23 §3.2 height budget (was "title row 40 px") | Task: numbers |
| ADR-DS-008-right-inspector.md | Decision | Overlay condition restated per 16 §2.6 docking rule; sheet below 768 px | Task: contradiction with 16, 19 |
| ADR-DS-011-compact-density.md | Consequences | "About 18 rows" -> "About 17 rows" at 1440 x 900 | P1: rows visible |
| ADR-DS-012-url-state.md | Decision | Inspector open, page tab and saved view push; `itab` and record moves replace; cross-refs 16 §2.7 and 23 §15 | Inventory #37 |
| ../20-frontend-specification.md | header (after Related line) | Added ownership line pointing to DESIGN_SYSTEM.md and design-system/00-design-principles.md; links verified | Task: top line |
| ../20-frontend-specification.md | §2 (stack table) | Note: inspector via `?inspect=<type>:<id>` and `itab`, no intercepting routes for drawers (16 §2.7, ADR-DS-012) | Task item 1 |
| ../20-frontend-specification.md | §3.1 | Note: canonical component names (`MetricItem`, `MetricCell`, `URLCell`, `SERPFeatureList`, `ChartFrame`, `RankHistoryChart`) and folders `components/app/metric/`, `components/app/chart/` | Inventory #48, 26 §2 |
| ../20-frontend-specification.md | §3.2 (route tree) | Note: routes and page tabs owned by 11 §1.1 (`/seo/rankings`, `/ai/prompts/[promptId]`, ...); `@drawer` slots not built | Task items 1, 11 |
| ../20-frontend-specification.md | §3.2 (intercepting routes bullet) | Note: row click opens right inspector via `?inspect=`, history rules, "Open page" for full page (16 §2.7) | Task item 1 |
| ../20-frontend-specification.md | §3.3 (project layout row) | Note: sidebar groups per 11 §1.1, project switcher in sidebar, workspace in breadcrumb; `SetupChecklist` only on Overview, not a banner on every page (23 §13) | Task items 10, 11 |
| ../20-frontend-specification.md | §3.8 (skeletons) | Note: skeletons pulse (1 to 0.6 over 1.5 s), no shimmer; chart skeleton is a flat `--chart-band` block (17 §3.1, 21 §8.1) | Task item 3 |
| ../20-frontend-specification.md | §3.8 (filter changes) | Note: refetch keeps full opacity, static 2 px `RefetchBar` (17 §3.4, 21 §6) | Task item 4, Inventory #10, #11 |
| ../20-frontend-specification.md | §4.1 | Note: shell sketch historical; sidebar and top bar per 11 §1.1, §2, §4 (command palette `⌘K`, help, theme, user menu) | Task item 11 |
| ../20-frontend-specification.md | §4.2 | Note: neutral inline `FilterChip`s in `FilterBar`, "+ Filter", "Clear all" (not "Reset"), "Filters (3)" sheet below 768 px (13 §2) | Inventory #20; Task: colored filter chips |
| ../20-frontend-specification.md | §4.3 | Note: `SavedViewMenu` in title row on table pages only; no pinned saved views in the sidebar (23 §14, 11 §1) | Task: other conflicts |
| ../20-frontend-specification.md | §4.4 | Note at top: `MetricStrip` of `MetricItem`s; `MetricCard` only where 23 §2.5 allows; non-detectable deltas in `foreground-secondary`, no `~` glyph | Task item 9, Inventory #48 |
| ../20-frontend-specification.md | §4.5 | Note: cells show `>20` and "Insufficient" (or count); "not in top 20" and "Insufficient data" in tiles and inspector (22 §3, 17 §8) | Inventory #14, #16 |
| ../20-frontend-specification.md | §4.6 item 10 | Note: ECharts animation off for all charts (21 §6) | Task: chart animation; 21 §14 required change |
| ../20-frontend-specification.md | §4.7 | Formatted note: delta coloring per 02 §6 (ranks beyond normal movement, New and Lost always), no `~`, six `--chart-*` tokens with top 5 plus Other; hex values historical | Task: colors, rank/delta formatting |
| ../20-frontend-specification.md | §4.8 (after table) | Note: canonical cells (`MetricCell` without mini CI bar, `RankDeltaCell`, `URLCell`, `SERPFeatureList`), bulk bar "Select all N matching", column state in API default view not localStorage (12 §6, §10, §14) | Inventory #47, #48 |
| ../20-frontend-specification.md | §4.10 | Note: Enter opens inspector; Base UI, no Radix; `/` focuses table search on table pages, palette elsewhere; `⌘K` palette (20-accessibility §6.3, 26 §4, 25 §23 item 21) | Task item 12, Inventory #21 |
| ../20-frontend-specification.md | §5 (intro) | Note: section 5 route names predate 11 §1.1; row "drawers" and "quick views" are the right inspector (16 §1.1) | Task item 11 |
| ../20-frontend-specification.md | §5.2 | Note: Overview uses one 6-item `MetricStrip` plus chart, `QuadrantSummary`, `ChangeFeed`, tables; remaining SEO tiles relocated (24 §9.2, 23 §2) | Task item 9 |
| ../20-frontend-specification.md | §5.3 (columns) | Note: `RankDeltaCell` glyphs `↑5` `↓3` `0` `New` `Lost`, empty on first check, color beyond normal movement; `SERPFeatureList` colors; default columns per 24 §9.3; location and device in tooltip | Task: rank formatting; Inventory #47, #53, #64 |
| ../20-frontend-specification.md | §5.3 (interactions) | Note: row click opens keyword inspector (480 px), not a quick view drawer (16 §1.1) | Task item 1 |
| ../20-frontend-specification.md | §5.3.1 | Note: import is a 720 px multi-step dialog over Rank Tracker; `rankings/import` renders Rank Tracker with it open; manual add is a 560 px dialog (16 §1.1, §4.6) | Task item 2 |
| ../20-frontend-specification.md | §5.4 | Note: inspector (480 px) from lists; full page `/seo/keywords/[tkId]` with `MetricStrip` and tabs Overview, SERP snapshots, Diagnostics (16 §1.1, 24 §9.4) | Task: drawer, Tabs |
| ../20-frontend-specification.md | §5.6 (Prompt Detail sketch) | Note: 6 tabs (Overview, Answers, Citations, Competitors, Fan-out, History); Recommendation and Related keywords into Overview, Volatility and Timeline into History (24 §9.6, 11 §6) | Task item 8, Inventory #3 |
| ../20-frontend-specification.md | §5.8 | Note: descriptive quadrant labels mapped from old ones ("GEO opportunity" to "SEO strong, AI weak", etc.); x axis is log-scaled organic rank, better to the right, "Not ranking" strip (15 §8) | Task item 6 |
| ../20-frontend-specification.md | §5.9 | Note: Citations has 3 tabs; Retrieved-not-cited is a Pages scope chip; Categories and Publisher opportunities under AI Visibility > Sources (24 §9.7, 11 §1.1) | Task: Tabs, routes |
| ../20-frontend-specification.md | §5.10 | Note: "Track" opens the 560 px Add competitor dialog, not the entity editor (16 §1.1) | Task: other conflicts |
| ../20-frontend-specification.md | §5.12 | Note: status views are a toolbar `SegmentedControl`; Discover page tabs Keywords, Prompts, Opportunities (24 §9.11) | Task: Tabs |
| ../20-frontend-specification.md | §5.14 | Note: diagnostics are a tab in keyword and prompt detail, not routes, nav entries or a wide drawer (11 §1.1, 24 §9.4) | Task: drawer, routes |
| ../20-frontend-specification.md | §5.17 | Note: no sidebar entry for Alerts; bell, inspector for events, Settings > Alert rules (11 §1.1, 23 §4.3) | Task item 11 |
| ../20-frontend-specification.md | §6 | Note: non-modal `StatisticsPanel` in inspector region (560 px, `stats=`) or Stats tab; not a focus-trapped modal drawer (23 §8.6) | Task item 7, Inventory #29 |
| ../20-frontend-specification.md | §7.1 | Note: 16 px favicons from one allowlisted endpoint in domain-first tables, placeholder square, never in keyword or prompt tables (07 §5) | Task item 5 |
| ../20-frontend-specification.md | §7.3 (CSP) | Note: `img-src` must also allow the allowlisted favicon endpoint (07 §5) | Task item 5 |
| ../20-frontend-specification.md | §8.1 | Note: tests target `MetricItem`, `MetricCell`, `RankCell`, `Delta`, `RankDeltaCell` (25 §23 item 48) | Inventory #48 |
| ../20-frontend-specification.md | §8.4 | Note: keyboard tests cover `StatisticsPanel` inspector focus rules, not a focus trap (23 §8.6, 20-accessibility §4.3) | Task item 7, Inventory #29 |
| ../20-frontend-specification.md | §8.5 | Note: visual regression is CI enforcement from Phase 1 (26 §11, ADR-DS-015), not optional | Task: other conflicts |
| ../20-frontend-specification.md | §11 (G3) | Note: G3 favicon decision: `img-src` allows the favicon endpoint (07 §5) | Task item 5 |

## Interactive preview, theme switch and sidebar collapse (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| 11-navigation.md, 19-responsive-behavior.md, 01-foundations.md | 11 §4; 19 §3.2; 01 §3 | Top-bar theme control is `ThemeSwitch` (pill, sun and moon) at 1440 px and up; the user menu Theme group shows only below 1440 px; System stays in the palette and Settings | User request for a switch like Magic UI's Animated Theme Toggler; the menu showed the theme twice |
| 21-motion.md | §2, §5.1, §11.2 | `--duration-reveal` 400 ms (0 under reduced motion) and the View Transitions circular reveal | Same |
| 02-color-system.md, tokens.css, globals.css | 02 §4.1 | `--theme-switch-*` tokens, `--shadow-switch-knob`; contrast test covers both glyphs | Same; first sun value was outside sRGB |
| 25-component-inventory.md | §1, §5.9 | `ThemeSwitch` added beside `ThemeMenu` | Same |
| globals.css | variants | `rail:`, `narrow:`, `peek:` custom variants driven by `data-sidebar` and `data-sidebar-peek` on the root | Collapsible sidebar (19 §3.1) was specified but not built in the preview |
| 26-implementation-guidelines.md | §10 | Preview contents: interactions, theme switch, sidebar collapse | Documentation |
| apps/web/design-preview | index.html, charts.js, interactions.js | Menus, editors, dialogs, palette, toasts, tooltips, inspector, row menus, sorting; Collapse button and `[`; theme switch | User request to try dropdowns and other interactions |

## Filter editor Apply button (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| 13-filters-search.md | §3 | Multi-choice editors get a footer with "Clear" and "Apply" (disabled until changed); Enter applies; Escape and a click outside discard | "Applies when you close this list" was invisible behavior, and a click outside usually reads as cancel (user review) |
| 25-component-inventory.md | FilterEditor | States updated to match | Same |
| apps/web/design-preview | index.html, interactions.js | Tag, Intent and Rank editors use the new footer | Same |

## Add keywords dialog and DateRangePicker in the preview (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| apps/web/design-preview | Add keywords | Native `<select>` replaced by a `Combobox` (location, grouped countries and cities, type to filter) and a `Select` (language, defaulted from the location); example keywords removed from the textarea (they read as entered text); helper counts keywords and those already tracked; quota line in the footer; the button counts what will be added, doubled for Both | 10 §6.1 forbids native select; the dialog did not follow 10 §25.1 (user review) |
| apps/web/design-preview | Date range | Radio menu replaced by the `DateRangePicker` of 10 §10.2: presets Last 7, 28 and 90 days, Last 12 weeks and Custom, two months starting Monday, future days disabled, typed From and To validated on blur, Cancel and Apply | The preview showed presets outside the spec and no calendar (user request) |
| 02-color-system.md, tokens.css | §3 | Dark `--surface-disabled` 0.225 to 0.290 | It was darker than `--surface-elevated`, so disabled buttons on dialogs had no visible shape |
| 26-implementation-guidelines.md | §10 | Preview contents | Documentation |

Not in the preview yet from 10 §25.1: Target URL and Tags fields.

## Date window controls (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| apps/web/design-preview | Page header | Removed the 7d, 28d, 90d segmented control | It duplicated the top bar `DateRangePicker` and could disagree with it (user review) |
| reference/README.md, reference/visual-spec.md | What not to copy; §5 | The page-header period control is listed as not to copy; the style row is "Segmented control" | Same |
| 10-forms.md | §10.2 | The calendar pane opens only for "Custom range" or an applied custom window; presets-only popover is 176 px | User review: the calendar was always visible |

## Overview and Settings screens in the preview (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| apps/web/design-preview | index.html, charts.js, interactions.js | Overview (24 §9.2) and Settings (24 §9.13, General and Engines) added as views with hash routes; sidebar gains Reports, Integrations and Settings (11 §1); date range and location hide on Settings (11 §4) | User request to see both screens |
| apps/web/design-preview | interactions.js | One `Select` behavior for every `data-select` trigger; one discard confirmation shared by the Add keywords dialog and the settings forms; the generic switch handler no longer touches the theme switch | Reuse; the theme switch was picking up the form switch classes |
| 26-implementation-guidelines.md | §10 | Preview contents: the three screens and their routes | Documentation |

Preview deviations from the wireframe, on purpose: the Overview rank distribution ends with "Not in top 100" (the wireframe's "Not in top 20" row double-counted the 21 to 100 bucket), and the small multiples show the hovered day's values beside each row instead of a tooltip over the neighbouring rows.

## Account settings (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| 11-navigation.md | §4, §5 | `SettingsNav` gains a first group "Your account" (Profile, Security, Preferences) with routes, content and save behavior; the user menu is name, theme (below 1440 px), "Account settings" and "Sign out" | User review: there was no place for personal settings. The user menu named "profile" with no destination, and "own sessions" sat under Members |
| 20-frontend-specification.md | §5.19 | New row 5.19.0 Account; "own active sessions" removed from Members | Same; matches the `/me` and `auth/*` routes of 19 §2 |
| 01, 24, 25, 26 | 01 §3; 24 §6; 25 UserMenu, SettingsNav; 26 §10 | Follow the new group | Consistency |
| apps/web/design-preview | index.html, interactions.js | The three account sections, working: name and avatar, password dialog, recovery codes, session sign-out, theme, density, reduce motion, single-key shortcuts | Same |

Open points for account settings: no API route changes the sign-in email; the re-authentication dialog ("fresh session") is specified in 20 §3 but not in the preview; photo upload and leaving a workspace are not in the preview.

## Card drawer inspector (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| adr/ADR-DS-019 | new | The inspector is a floating card under the top bar with card sections; the top bar always spans the full width | Product owner chose the drawer of the first reference batch over the flush v2 column, and the docked inspector was narrowing the top bar |
| 16-drawers-dialogs-popovers.md | §2.1, §2.4, §2.6 | New anatomy (container, header rows, body), sections as cards (metric, chart, bar list, table), docking reserves the 12 px margin, table of widths recomputed | Same |
| 05, 06, 19, 23, 25, reference/visual-spec.md | frame and section rows | Follow ADR-DS-019; 06 names the inspector as the one nested-panel and the one canvas-shadow exception | Consistency |
| tokens.css | `--shadow-inspector` | Floating shadow in both themes | Same |
| apps/web/design-preview | index.html, interactions.js | Inspector rebuilt; it now sits below the top bar beside the page content; rank history shows 2 competitors with a 30 or 90 day selector; AI mentions by engine bar list; popups opened from the overlay inspector paint above it | Same; the More menu used to open behind the overlay inspector |

## Engine logos (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| adr/ADR-DS-020 | new | Engine logos beside engine names through `EngineLogo`, from `@lobehub/icons-static-svg` 1.95.1; replaces the no-logo rule | Product owner request after the card drawer |
| 07-icons.md | §1, §5 | The engine row now specifies `EngineLogo` (size, source, the monochrome OpenAI mark, the shared Google mark, where it may appear, the off switch) | Same |
| 14, 16, 25, adr/ADR-DS-004, adr/ADR-DS-019 | EngineBadge; §2.4; §15.1; Decision; Decision | Follow ADR-DS-020 | Consistency |
| apps/web/package.json | devDependencies | `@lobehub/icons-static-svg` 1.95.1 | Logo source |
| apps/web/design-preview | vendor.mjs, index.html, interactions.js | Six marks copied to `vendor/logos/`; shown in the inspector's engine list, the Overview "AI by engine" table and Settings > Engines | Same |

Open point: vendor brand guidelines are not yet checked; this is needed before public launch.

## Customizable layouts (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| superpowers/specs/2026-09-30-layout-customization-design.md | new | Design: who owns a layout, zones, the catalog, the layout document, resolution and sanitizing, customize mode, storage and API, testing | Product owner request for per-account customization; five decisions taken with the owner |
| superpowers/plans/2026-09-30-layout-customization-preview.md | new | Implementation plan for the rules, the preview and the documents | Same |
| adr/ADR-DS-021 | new | Customizable layouts from a catalog of cards | Same |
| 23-application-patterns.md | §18 (new) | What is customizable, customize mode, the card catalog, layout rules, announcements | Same |
| 24-page-templates.md | §3 | T1 describes the built-in default; its section rules bind defaults, not customized pages | Same |
| 16-drawers-dialogs-popovers.md | §2.4 | Drawer cards can be hidden, reordered and added per record type | Same |
| 20-accessibility.md | §7 | Card and headline number reordering added to the drag alternatives | WCAG 2.5.7 |
| 25-component-inventory.md | §2, §5.20 (new) | Eight layout components | Same |
| 04-data-model.md, 19-api-specification.md, 24-security.md, 20-frontend-specification.md | 04 §11.6a; 19 §3.11.5c; 24 §3.2; 20 §5.2 | `core.layouts`, five routes, the `layouts:manage` key, Overview points to the layout system | Same |
| apps/web/src/lib/layouts | new | Types, catalog, sanitize, resolve, availability, rows, draft edits; 32 unit tests | The rules are shared by the preview and, later, the app and the API's key list |
| apps/web/design-preview | index.html, customize.js, layouts-core.mjs, interactions.js, charts.js | Overview and keyword drawer render from a layout; customize mode, catalog, options, numbers, save bar, team default; six new dashboard cards and two drawer cards | Same |
| apps/web/design-preview/index.html | Overview cards | Column and quadrant breakpoints follow the card (`@container`), not the viewport | A half-width card on a wide screen is narrow |

### Code review fixes (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| apps/web/src/lib/layouts | sanitize, resolve, draft, catalog | A stored value that is not a layout document falls through to the next source; retired card types still render; reusable cards keep distinct identity values; ids are plain tokens; hostile input (deep nesting, inherited keys, `NaN` indexes, duplicate ids, a non-engine string on an SEO number) is refused; a card hidden and added back is not counted as two changes; `sameLayout` ignores ids. 47 tests (was 32) | Independent code review of the build |
| apps/web/design-preview | customize.js, interactions.js, index.html, layouts-core.mjs | A team default can no longer be written from a draft that is gone; dialogs close with the mode; leave guards cover links, Back and Forward and every way of closing the inspector; a narrowed window keeps unsaved changes; removing the team default keeps the draft; focus is managed on enter, exit and after the last item is removed; a keyboard pick-up ends when focus leaves; numbers get a Move menu and 32 px controls; a small drag over the card's own place moves nothing; `aria-disabled="true"`; the numbers strip is valid HTML; the transpile step clears its output and reports errors | Same |
| superpowers/specs/2026-09-30-layout-customization-design.md | 5.1, 5.2, 5.3, 5.6, 6.3, 9.1, 13, 15 | Behavior above written down; per-member privacy of personal layouts is enforced by the API, not by a row policy | Same, and a note from the backend schema work |
| 23-application-patterns.md | 18.2 | Card toolbar is a group; number controls; drop indicator; leaving; keyboard pick-up | Same |
| 04-data-model.md | 11.6a | Standard workspace policy, API-enforced ownership, grants to `app_api` only | Backend schema work (carried item F10) |
| apps/web/src/lib/layouts, apps/web/design-preview | draft.ts, customize.js, interactions.js | The change count is zero exactly when two layouts show the same thing; focus returns to the Save menu after a cancelled team-default confirmation; a discard question closes with the mode that asked it; a keyboard move at either end is announced; archiving the keyword open in the inspector waits for the inspector to close | Second review, of the fixes |
| superpowers/specs/2026-09-30-layout-customization-design.md, 23-application-patterns.md | 5.2, 5.6, 11, 15; 18.5 | "Add card" slot size, what Save stores when the draft equals the default, focus after Hide | Same |

Open points for customizable layouts: the five that the preview cannot show (conflict dialog, load-failure banner, save states, unavailable cards, team default in the drawer) are listed in the spec, section 15.

## Topics & Prompts page (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| adr/ADR-DS-022 | new | Topics first on the prompts page: topic rows with prompts grouped under them, a topic drawer, shared filters, the flat list as the Prompts tab | Product owner's reference screen |
| 24-page-templates.md | 9.5 | Renamed "Topics & Prompts"; Topics tab columns, strip and topic inspector; engine columns 88 px under a two-row header; type badge by container width; change on Mention rate only | Same, and what the build settled |
| 23-application-patterns.md | 4.2 | Topic inspector content | Same |
| 11-navigation.md | 1, 2, 3, 9 | Navigation item "Topics & Prompts" and its tabs | Same |
| 15-data-visualization.md | 9 | Rate sparklines draw in a window around their own values; gaps break the line | Topic trends were flat lines on a fixed 0 to 100 scale |
| 12-tables.md | 7.3 | `bg-insufficient` utility named | The hatching now exists as a utility in `globals.css` |
| 26-implementation-guidelines.md | 11 | Fourth screen, its modules, `core-modules.mjs` (was `layouts-core.mjs`) | Documentation |
| 20-frontend-specification.md | 5.6 | Superseded note | Same |
| apps/web/src/lib/stats | new | Wilson interval, rates from counts, the detectable change rule (Newcombe), panel sizing (McNemar). 12 tests against the values published in 17-statistical-methodology.md | The page shows intervals, colors changes only when detectable, and sizes the panel: those rules are tested code, not preview code |
| apps/web/src/styles/globals.css | utilities | `bg-insufficient` | InsufficientData cells |
| apps/web/design-preview | prompts*.js, index.html, interactions.js, charts.js, customize.js, core-modules.mjs | The Topics & Prompts screen. The inspector shell takes record types (keyword, prompt, topic) with their own width, tabs and order; page tabs are part of the route; sparklines take gaps; AI headline numbers on the Overview link to the page | Same |

| 11-navigation.md, adr/ADR-DS-022, 20-frontend-specification.md | 1, 2, 3; decision 10; 5.11 | The separate "Topics" sidebar item is removed: 14 items. The Topic Explorer has no destination | Product owner: one place for topics |

| 24-page-templates.md, adr/ADR-DS-022 | 9.5; decision 4 | Topics tab gains SEO visibility and Top 10 (the topic's tracked keywords), a column chooser, and an "In search" card in the topic drawer | Product owner, after the Topics item was removed |
| apps/web/design-preview | index.html, interactions.js | The project switcher lists the owner's projects (fynix.digital, cleanstart.com, eventussecurity.com, oyechats.com, firstfold.io). The sample data is still the CRM demo: keywords, prompts, competitors and the brand "Northwind" are not theirs | Product owner |

Open point from the removal of the Topics item: taxonomy term editing and influencing pages (20 section 5.11) have no home. Proposed: term editing in Settings.

Review of the page (independent, before commit), all fixed: recommendation rate now matches the Overview (18%, 15%, and "n/a" on AI Mode, where it is not classified); a fixture target that cannot be reached throws instead of leaving wrong numbers; entity rates in the topic drawer are prompt-weighted like every other topic rate; "Show in Prompts" and the "Show" action work from either tab; the drawers, Panels and Versions follow archive, undo, add and move; version dates come from the prompt, so the Versions tab, the drawer's events and the chart boundary agree; lint messages keep the line numbers of the field; rows in the topic drawer keep their cells for assistive technology; a change says in text whether it is detectable. The statistics tests now pin the Newcombe interval to exact values and to a small sample where the textbook interval gives the opposite answer.

What the preview does not show for this page: the evidence viewer, the prompt page (Prompt Detail), the prompt editor, import, the prompt generator, the statistics panel, and "Save view as". The mobile filter sheet is not built for this page: below 1024 px the filter bar keeps its chips and "+ Filter". Detectable changes use the unpaired interval on pooled counts; the paired bootstrap and the false discovery control of 17 sections 6.1 and 6.4 are the API's.

### AI Overview as the fourth engine (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| adr/ADR-DS-022 | decision 11, consequences | AI Overview is an engine on the page and the one that is not asked: read from the rank check of the linked keyword on the day of each run, counted only when Google showed one. Unit "AI Overviews". "No AIO" and "n/a" name the two reasons a prompt has none | Product owner: AI Overview everywhere engines are listed |
| 24-page-templates.md | 9.2, 9.5 | Overview: a fifth small multiple and a fourth row in "AI by engine" (average of 4 engines, 30.0%). Topics & Prompts: AI Overview column, "avg of 4", strip of Prompts and one card per engine | Same |
| adr/ADR-DS-022, 24-page-templates.md | decision 12; 9.5 | Engine cards show mention, citation and share of voice together; the Prompts card shows the topic count and drops "core, not branded" | Product owner |
| 23-application-patterns.md | 4.2 | Prompt inspector: four engine cards in two rows, Citation rate below at full width | Same |
| apps/web/src/lib/layouts/catalog.ts | `competitors.share_of_voice` | The channel option lists all four engines (was the first three) | Same |
| apps/web/design-preview | prompts*.js, index.html, charts.js, customize.js | The fixture gives every prompt AI Overview counts from their own generator, so no number of the other three engines changed (checked prompt by prompt). Totals match the Overview's AI numbers: 62 of 384 mentions (16%, +0.3 pts), 158 of 384 citations (41%, +0.5 pts), share of voice 22%. They are rank checks of linked keywords, not the 411 keywords with an AI Overview in the search cards. "Run now", the panel table and the panel sizing use the asked engines only | Same |

Independent review of this change, all addressed: the prompt-side AI Overview totals are now their own (384 checks), not a copy of the 411 keywords in the search cards; the linked keyword is named in the drawer and its status comes from the prompt's own counts; the AI Overview card quotes the overview instead of ranking the brand; a topic's tooltip names only the engines that took part; a strip rate needs four observations like every other rate; the panel total is checked against its target when the fixture is built.

Open point: 11 and 16 key AI Overview observations to tracked keywords and do not say which checks belong to a prompt. The preview takes the linked keyword's rank check on each run day (at most four in 28 days for a weekly panel), so AI Overview has the same cadence as the asked engines. The API has to confirm or replace that unit.

## Unresolved (9)

None of these is a disagreement between documents; each needs a code, token or product decision outside the documents.

| Item | Recommendation |
|---|---|
| `formatMetricDelta` (`apps/web/src/lib/format/delta.ts`) returns labels like "up 5.3 pts" and keeps "Within normal variation" in `note`; 20 §9.2, 22 §2 and 23 §2 specify speech such as "up 2 percentage points, within normal variation" and a "detectable change" phrase (25 §8.5 `DeltaCell`). | Code change with tests: expand units in `label`, add the detectability phrase, so components never compose it. |
| Formatters named in docs do not exist yet: `numberInputFormat` (10 §11), a duration formatter (22 §4), a points-interval formatter (25 §8.5 `intervalText`). | Add to `lib/format` with tests before first use (inventory #54). |
| `type-input-touch` (16 px mobile inputs, 19 §10, 20 §11.6) does not exist in `globals.css`; 00, 03 and the root files count 14 type utilities. | Add the utility and update the count to 15 in 00, 03, DESIGN_SYSTEM.md and AI_DEVELOPMENT_UI_RULES.md in the same change, or drop the requirement. |
| `lib/utils.ts` (`cn`) is named in 09 and 26 §2 but does not exist yet. | Create it when the Next.js app is scaffolded. |
| 07 §5 allows 16 px favicons from one allowlisted endpoint, but the endpoint is not chosen and `docs/24-security.md` §7.1 CSP `img-src` does not name it. | Choose the endpoint, add it to 24-security §7.1 and the CSP in `proxy.ts`. |
| Several filters in 13 §4 (Panel, Persona, Prompt type, Mention status, Citation status, Recommendation, Branded, KD, Ranking URL, Channel and others) have no URL key. | Define keys in `lib/filters/parsers.ts` and the 13 §5 key table before those filters ship. |
| Prompt diagnostics (Phase 15) have no tab slot: Prompt Detail already has the maximum 6 tabs (24 §9.6, 11 §1.1). | Decide before Phase 15 which tab merges or is replaced. |
| 11 §1.1 does not say which destinations use `?tab=` tabs (`Tabs`) and which use path tabs (`TabNav`). | Add a column to the 11 §1.1 route table. |
| `ChevronDown`, `Minus` and `Check` each carry more than one meaning (documented in 07 §6). | Accept; each control has its own accessible name. Revisit if a screen shows two meanings side by side. |

## Visual reference set (added after the reconciliation)

| Doc | Section | Change | Reason |
|---|---|---|---|
| reference/README.md | new | Seven high-fidelity reference screens (1536 x 1024 PNG), the qualities to match, and 11 known deviations where the spec wins | Premium visual calibration; the earlier "BrandLens" set was rejected (indigo accent, multicolored pills, KPI cards, donut) |
| reference/generation-brief.md | new | The exact prompts used, so more screens can be made in the same style | Reproducibility |
| DESIGN_SYSTEM.md | Documents | Adds the REF row | Discoverability |
| 24-page-templates.md | 9 | Points to the reference screens and states that wireframes win on conflict | Precedence |

## Design-system v2 visual update

| Doc | Section | Change | Reason |
|---|---|---|---|
| 00-design-principles.md | all | v2 sizing in the design read; metric strip as one 76 px panel; 15 type utilities | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 01-foundations.md | all | Foundations table at v2 values: 14 px base, 36 px controls, 40 px rows, 52 px top bar, 208 px sidebar | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 02-color-system.md | all | v2 light and dark tokens with computed hex (cobalt `#1E65E3`), neutral badge, `chart-bar-neutral`, accent-tinted selected segment and pressed `CountTabs` | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 03-typography.md | all | 14 px base, 15 composites including `type-inspector-title`, v2 sizes for every utility | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 04-spacing-density.md | all | v2 spacing roles, component heights (36, 40, 44, 52, 76, 22 px), Default and Compact densities | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 05-layout-grid.md | all | 208 px sidebar, 52 px top bar, 400 and 440 px inspector, T3 12-column right rail, 76 px metric strip | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 06-surfaces-borders-radius.md | all | v2 surfaces and borders, radius scale with `rounded-2xs`, header-cell dividers, full-height strip dividers | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 07-icons.md | all | 18 px sidebar icons, `EngineStatusGlyph` and `EnginePresenceSquare` as non-icons, `TrendingUp` and `TrendingDown` for rank moves | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 08-interaction-states.md | all | Selected state uses `surface-selected` and the accent-tinted segment | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 09-buttons-controls.md | all | 36 px buttons, accent-tinted segmented control, `CountTabs`, 44 px underline tabs, 16 px checkbox, 36 x 20 switch, cursor pagination styling | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 10-forms.md | all | 36 px inputs with the light `border`, v2 segmented style in forms, radio cards | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 11-navigation.md | all | 32 px sidebar items with 18 px icons, 16 px group spacing without lines, 52 px top bar, 44 px page tabs | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 12-tables.md | all | Tables inside a panel, 40 px header with header-cell dividers, 40 and 32 px rows, 48 px toolbar and footer, v2 cells and glyphs | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 13-filters-search.md | all | 36 px filter buttons and neutral 36 px chips, engine status legend | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 14-badges-status.md | all | 22 px badges with 8 px padding, positive badge for Cited and Owned | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 15-data-visualization.md | all | v2 chart palette, 2 px lines, dashed gridlines, `BarList`, 100% stacked bar, tooltip styling, gray sparklines | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 16-drawers-dialogs-popovers.md | all | 400 and 440 px inspector, 44 px underline inspector tabs, `Maximize2` Open page, key-value grid | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 17-empty-loading-error-states.md | all | Skeletons at v2 sizes (76 px strip, 48 px toolbar, 40 px header, 40 and 32 px rows) | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 18-notifications-alerts.md | all | Change feed and event rows in the v2 style, `CountTabs`, `RuleList` with switches | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 19-responsive-behavior.md | all | Breakpoint behavior recomputed for 208 px sidebar, 52 px top bar, 400 and 440 px inspector, 40 px rows | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 20-accessibility.md | all | Contrast and target rules for the v2 tokens and new components (`CountTabs`, `EngineStatusGlyph`, `BarList`) | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 21-motion.md | all | Motion rules for v2 components; sidebar collapse 208 to 56 px | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 22-content-formatting.md | all | Status line only; content rules unchanged | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 23-application-patterns.md | all | 76 px metric strip panel, v2 page header budget, inspector anatomy, change feed day panels, `CountTabs`, `RuleList`, `QuoteBox` | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 24-page-templates.md | all | Wireframes and budgets at v2 sizes; T2 row math (11 Default, 14 Compact); T3 right rail | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 25-component-inventory.md | all | v2 variants for every component; new `CountTabs`, `BarList`, `StackedBar100`, `ChartTooltip`, `EngineStatusGlyph`, `EnginePresenceSquare`, `QuoteBox`, `DomainChip`, `RuleList` | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 26-implementation-guidelines.md | all | Size and 15 type utilities tables at v2 values | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 27-design-review-checklist.md | all | Checklist items at v2 sizes and accent rules | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| adr/ADR-DS-018-visual-v2-reference-screens.md | new | Decision record for the v2 visual layer | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| DESIGN_SYSTEM.md, AI_DEVELOPMENT_UI_RULES.md | all | v2 character, sizes and utilities | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| apps/web/design-preview/index.html | all | Static v2 shell and component preview | v2 visual update (reference/visual-spec.md); earlier editor, summarized from the current file |
| 05, 08, 09, 10, 11, 13, 14, 16 | header | Status line `Accepted (design-system v1)` -> `Accepted (design-system v2)` | Every doc 00 to 27 on v2 |
| 11-navigation.md | §4 | Top bar rewritten: `House` root, `ChevronRight` separators, search (440 / 360 / 240 px), date range and location scope buttons, notifications, theme, help, 32 px avatar; scope hidden where it does not apply; URL keys unchanged | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 11-navigation.md | §2 | Project switcher name: 15 px 600 -> `type-subsection-title` | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 13-filters-search.md | §1, §2, §3, §4, §5 | Date range and location moved to the top bar; filter bar keeps screen scope (Compare, Device, Engine, Month) and filters; §4 table gains a Top bar column; location editor used by the top-bar control; key table notes placement | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 05-layout-grid.md | §2 | Shell mermaid and sketch: top bar scope controls, filter bar without date and location, table toolbar 40 -> 48 px, 48 px footer added | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 19-responsive-behavior.md | §3.2, §4, §4.2, §13.1 | Top bar table per width class with a collapse order (search narrows, workspace item moves into the project menu, theme moves into the user menu below 1440 px, location becomes an icon button below 1024 px, scope moves into the filter sheet below 768 px); filter bar rows and mobile sheet updated | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 23-application-patterns.md | §3.1, §3.2, §15, §16, §17 | Page header sketch without date and location; breadcrumb note; budget: 200 px with tabs and filter bar, about 130 px otherwise; `loc` placement; icon note; superseded-statement row for the scope move | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 24-page-templates.md | §3, §9.1 to §9.3, §9.5 to §9.9, §9.14, §10 | Wireframes and filter bar rows without date and location; 9.1 shell top bar with `House`, separators and scope buttons; theme moves below 1440 px | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 25-component-inventory.md | §4.18, §5.4 to §5.9, §6.1, §6.2 | `TopBar` gains `dateRange` and `location` slots and the collapse behavior; `Breadcrumb` props and styling (`House`, `ChevronRight`); `ProjectSwitcher` name `type-subsection-title`; theme menu below 1440 px; `DateRangePicker` in the top bar; `FilterBar` scopes exclude date and location; `ScopeControl` gains `icon` and async options for location | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 26-implementation-guidelines.md, 27-design-review-checklist.md | §3.1; §1 | Save bar utility row; density sentence without v1 names; checklist items for budget, top-bar scope, 48 px toolbar and footer, 32 px option rows | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 20-accessibility.md | §2, §5, §19 | Consistent Navigation note for hidden scope controls; filter chip examples use Topic instead of Location | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 07-icons.md | §4, §6 | Open page allowed as an icon-only `Maximize2` button; breadcrumb `House` (16 px, tertiary) and `ChevronRight` (14 px, muted) rows; `MapPin` for the location button; "text button, `Maximize2` not used" removed; mentioned glyph 2 px ring; presence square `rounded-2xs` | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 25-component-inventory.md | §5.5, §18.2, §3.2 | Breadcrumb separators `ChevronRight`; InspectorHeader order matches 16 §2.1 (frequent action on the context line); top-bar icon buttons are `icon` (36 px) | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 03-typography.md, 15-data-visualization.md, 16-drawers-dialogs-popovers.md, 25-component-inventory.md | 03 §2; 15 §4, §10; 16 §6.1; 25 §10.12 | Chart tooltip date and project switcher name use `type-subsection-title`; statement that a 15 px or 13 px 600 utility is missing removed | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 25-component-inventory.md | §3.5, §3.38 | Segmented labels 400 unselected, 500 selected (was "weight 500 always"), width of the 500 label reserved | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 09-buttons-controls.md, 25-component-inventory.md | 09 §8.2; 25 §4.12 | Radio 14 -> 16 px (same as the checkbox) | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 09, 10, 16, 25, 04 | 09 §10, §14; 10 §6.2, §6.3; 16 §5.2; 25 §3.25, §4.8; 04 §2 | Menu, select and combobox option rows 28 -> 32 px; combobox status rows 32 px; group label rows stay 28 px | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 10-forms.md, 25-component-inventory.md, 26-implementation-guidelines.md, 04-spacing-density.md | 10 §13.2; 25 §4.26; 26 §3.1; 04 §2 | Save bar `h-14` -> `h-save-bar` (56 px, `--size-save-bar`); reserve `pb-save-bar` | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 04-spacing-density.md, 09-buttons-controls.md | 04 §2; 09 §13 | Table toolbar and table footer 48 px | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 15-data-visualization.md, 25-component-inventory.md | 15 §5, §5.1; 25 §2, §10, §14.3, §23 | `HorizontalBarList` merged into `BarList` (`comparison` and `distribution` modes); 25 §10.7 removed and §10.8 to §10.13 renumbered to §10.7 to §10.12; summary index row removed; item 69 notes the retired name | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 04, 07, 12, 15, 25, preview | bars and squares | Bar-list bars and presence squares use `rounded-2xs` (2 px); mentioned glyph is a 2 px ring (`border-2`) | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 00, ADR-DS-011, ADR-DS-018, DESIGN_SYSTEM.md | §1; Decision; Decision; Character | "Comfortable" density wording removed; two densities only | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 26-implementation-guidelines.md | §3.1 | Removed the retired v1 row and page header size names from the density sentence | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 00-design-principles.md, 27-design-review-checklist.md, ADR-DS-018 | P1; §1; Tradeoffs | Data budget: within 200 px with tabs and a filter bar, about 130 px otherwise (matches 23 §3.2) | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 04-spacing-density.md, ADR-DS-011 | §3; Consequences | Rows visible at 1440 x 900: 424 px of chrome including the 48 px toolbar and footer, 11 Default and 14 Compact rows (was about 14 and 17), matching 24 §4 | Final v2 consistency pass (reference/visual-spec.md section 6) |
| 15, ADR-DS-009, ADR-DS-018, DESIGN_SYSTEM.md | 15 §4.2; Decision; Decision; Ten decisions | Hex values aligned with `tokens.css`: `#1E65E3`, `#175AD0`, `#DD6A21`, `#1B969C`, `#8A3C9B` | Hex computed from the OKLCH tokens (02 §1) |
| 01-foundations.md, DESIGN_SYSTEM.md | §1, §3; Ten decisions | Radius range 2 to 10 px; theme menu moves below 1440 px; filter bar and top-bar scope wording | Final v2 consistency pass (reference/visual-spec.md section 6) |
| AI_DEVELOPMENT_UI_RULES.md | rules 4, 8 | `h-save-bar` listed; date range and location belong to the `TopBar` | Final v2 consistency pass (reference/visual-spec.md section 6) |
| ADR-DS-018 | Decision | Shell bullet names the top-bar scope controls | Final v2 consistency pass (reference/visual-spec.md section 6) |
| apps/web/design-preview/index.html | top bar, filter bar, table, BarList | Breadcrumb with `House` slot and chevron separators; date range and location buttons, theme and help icon buttons in the top bar; filter bar with Compare and Device only; segmented labels 400 and 500; `rounded-2xs` bars and squares; rank change `↑3`; table search `border`; 48 px table footer; recompiled | Final v2 consistency pass (reference/visual-spec.md section 6) |
| review-log.md | Unresolved | Removed the page header size token row and the save bar token row (both resolved by the v2 tokens); count 14 -> 12 | Final v2 consistency pass (reference/visual-spec.md section 6) |

## Location scope and preview icons (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| 13-filters-search.md | 4 | Location shown on every screen that aggregates several markets (adds Pages, Page detail, Prompts, Citations and Sources, Competitors, Topics); hidden on single-market records (Keyword detail, Prompt detail) and on Discover, Reports, Costs, Settings, Integrations; "All locations" default; single-location projects still show it; city selections filter AI data to their country | Rank checks and AI observations are both collected per location (04 section 5.2) |
| 24-page-templates.md | 9.5 | Prompt Explorer shows the location control | Same |
| reference/visual-spec.md | 6 | Location row points to 13 section 4 | Same |
| 26-implementation-guidelines.md | 11 | Preview icons come from `lucide-static` 1.48.0 through `design-preview/icons.mjs`; `pnpm run preview` rebuilds | Real Lucide icons in the static preview |
| apps/web/design-preview/index.html | Shell | 34 icon slots filled with Lucide glyphs per 07 section 6; workspace crumb hidden and search 360 px below 1680 px per 19 section 3.2 | Match the reference screens |

## Responsive preview and charts (2026-09-30)

| Doc | Section | Change | Reason |
|---|---|---|---|
| apps/web/design-preview | index.html, charts.js, vendor.mjs | Rebuilt fully responsive to 19; four ECharts charts themed from tokens; interactive selection, drawer, filter sheet, account menu | Preview checked at 21 widths from 2560 to 320 px in both themes: no horizontal page scroll, 0 contrast failures |
| reference/visual-spec.md, 04, 19, 23, 25 | Metric strip | Context line moves below the value; strip is 96 px when context lines are shown, 76 px otherwise | Inline context truncated to a few letters in narrow cells and at 1440 px |
| 15-data-visualization.md | 7 | Rank guide labels outside the plot in a 52 px right margin; y labels 1, 10, 20 below 200 px plot height | Labels collided with series near rank 1 to 3 and with each other on phones |
| 14-badges-status.md | 1 | Neutral badges in table rows always have the border; on selected rows their fill switches to `surface` | Gray badges lost their edge on the pale blue selected row |
| 26-implementation-guidelines.md | 11 | Preview contents, tested widths, chart and vendor files | Documentation |
| apps/web/eslint.config.mjs | ignores | `design-preview/vendor/**` ignored | Vendored minified ECharts bundle |
| 09-buttons-controls.md | 6 | Segmented control construction: per-item borders with 1 px overlap, outer items rounded, selected item positioned above neighbours | The selected outline showed square corners at the rounded end of the group |
| apps/web/design-preview | index.html, charts.js | Window and density segmented controls rebuilt that way; segments are selectable | Same |
