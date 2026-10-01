# 12. Tables

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: `components/app/data-table/` built on TanStack Table v9 (`@tanstack/react-table` 9.x, `useTable` API, client sorting). Row windowing is computed in `lib/tables/row-window.ts`, not with TanStack Virtual, which the React Compiler cannot compile (25-component-inventory.md, deviation 124). Versions verified 2026-09-29 in `research/09-frontend-stack.md`.

Tables are the primary instrument of this product. There is exactly one table component for record lists, `DataTable`. Small read-only key-value tables (inside inspectors, chart data alternatives) use `SimpleTable` (section 15).

## 1. Anatomy

```
+----------------------------------------------------------------------------------------+
| Toolbar (48): [Search in table  /]   1,000 keywords                  [≡] [▥] [↓]       |
+----------------------------------------------------------------------------------------+
| Bulk bar (replaces toolbar when rows are selected):                                    |
| 12 selected  Select all 1,000 matching   [Add tags] [Move to group] [Export] [Delete] ✕|
+----+--------------------------+------+-----+----------------------+--------+-----------+
| [] | Keyword               ▲ | Rank |  Δ  | Ranking URL          | Volume | ...       |  header 40, sticky
+----+--------------------------+------+-----+----------------------+--------+-----------+
| [] | best crm for startups    |    3 |  ↑5 | /blog/best-crm-sta.. | 12,400 |           |  row 40
| [x]| crm software for small.. |    7 |  ↓1 | /pricing             | 33,100 |           |  selected
|▌[] | hubspot alternatives     |   14 |  ↓6 | /compare/hubspot     |  8,100 |           |  active (inspector open)
+----+--------------------------+------+-----+----------------------+--------+-----------+
| Footer (48): 1,000 keywords · Updated 12m ago                                          |
+----------------------------------------------------------------------------------------+
```

The whole table, toolbar to footer, sits inside one panel (1 px `border`, radius 8, [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md)). The header row is the only place with vertical dividers between cells; body rows have horizontal dividers only (the `|` characters in the body rows above mark column positions, not borders).

| Part | Height | Content | Notes |
|---|---|---|---|
| Toolbar | 48 px, the panel title row height (32 px `h-control-sm` controls, 8 px vertical padding) | Table search (`SearchInput` `sm`), result count ("1,000 keywords"; on table pages the count lives here, not in the filter bar), sort summary when more than one sort key is set, density toggle, column chooser, export (the saved view menu sits in the page title row, section 11) | Page filters are not here; they live in the page header filter bar ([13-filters-search.md](13-filters-search.md)) |
| Bulk bar | 48 px | Selection count, "Select all N matching", bulk actions, clear | Replaces the toolbar in place; never floats over rows |
| Header | 40 px (`h-row-header`) | Column labels, sort state, header menus, resize handles | Sticky |
| Rows | 40 px Default (`h-row`), 32 px Compact (`h-row-compact`). Embedded tables are always 32 px (section 3.1) | Cells | Virtualized above 100 rows |
| Footer | 48 px (32 px controls, 8 px vertical padding) | `TableFooter`: visible count and freshness; in server mode also `Pagination` (section 12): range text ("Showing 1 to 200 of 12,480 keywords"), previous and next buttons and a page-size menu (100, 200, 500). No page numbers | Sticky at the bottom of the table region (section 12) |

## 2. Tables versus cards

| Use a table when the user needs | Use cards only for |
|---|---|
| comparison across records | grouped conceptual summaries (for example "Collection health") |
| scanning many records | small collections under 6 objects that are not compared (integrations) |
| sorting and filtering | object previews (a SERP result, a citation preview) |
| bulk actions | genuinely spatial information (matrix quadrants) |
| more than 6 records of the same type | |

Lists of keywords, prompts, citations, domains, pages, competitors, alerts, runs, tasks, costs and candidates are always tables. A reviewer rejects a card grid of analytical records ([27-design-review-checklist.md](27-design-review-checklist.md)).

## 3. Visual rules

| Element | Rule |
|---|---|
| Container | A panel: `surface`, 1 px `border`, radius 8, no shadow. The header row and the last row are clipped to the panel radius |
| Table background | `surface` |
| Header background | `surface-subtle` |
| Header height | 40 px (`h-row-header`) in record tables at both densities; embedded tables use a 32 px header (section 3.1) |
| Header text | `type-label` (12 / 16 px, weight 400, `foreground-tertiary`); sorted column header text in `foreground` |
| Header bottom border | 1 px `border` |
| Header cell dividers | 1 px `border-subtle` vertical line between adjacent header cells, full header height. Not drawn before the first or after the last header cell |
| Row divider | 1 px `border-subtle`, horizontal only |
| Vertical cell borders in body rows | None. Vertical dividers exist only between header cells |
| Zebra striping | **Not used.** Row dividers plus hover make row tracking reliable, and zebra conflicts with hover, selected and active states |
| Hover | Row background `surface-hover` |
| Selected (checkbox) | Row background `surface-selected`; the identity cell's key text (keyword, prompt, domain) in `primary-text` |
| Active (open in inspector) | `surface-selected`, key text in `primary-text`, plus a 2 px `primary` inset bar on the left edge of the first cell |
| Focus (cell) | 2 px inset `ring` on the focused cell (`focus-ring-inset`) |
| Expanded child rows | `surface` with 24 px indent per level and a 1 px `border-subtle` left guide |
| Group header rows | `surface-subtle`, `type-body-strong`, count and aggregates |
| Pinned columns | Same background as the row; when the body is scrolled horizontally, a 1 px `border` appears on the pinned edge (no shadow) |
| Last row | No bottom divider when the table ends before the region does |
| Cell padding | 12 px horizontal; first cell 12 px left (16 px when there is no checkbox column, matching the 16 px panel padding) |
| Text | `type-table` (13 / 20 px). Table cells stay 13 px while body text elsewhere is 14 px |
| URLs and domains | `type-mono` (13 / 20 px), single line, truncated with an ellipsis (`URLCell`, section 6) |
| Truncation | Single line, end ellipsis, full value in tooltip ([22-content-formatting.md](22-content-formatting.md) section 6) |
| Numbers | `num` (tabular figures), right-aligned |
| Empty cell | A cell is never empty for an unknown or not-applicable value: `n/a` in `foreground-tertiary` when a value is expected but missing, and the specific states of section 7.3 for unknown values ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 1, rule 1) |

### 3.1 Density and embedded tables

| Table | Row height | Notes |
|---|---|---|
| Record table (`DataTable`), Default density | 40 px `h-row` | The default for every page table |
| Record table, Compact density | 32 px `h-row-compact` | The user's Compact setting, per table, stored in the saved view (section 11) |
| Embedded table: a table that is one block inside a larger panel or inside an inspector (`SimpleTable`, inspector mini tables, detail page rail tables) | 32 px `h-row-compact`, always | No density toggle. Header labels are `type-label` (12 px). The own row is `surface-selected` with its text in `primary-text` (section 15) |

The header row is 40 px in every case except embedded tables, whose header matches their 32 px rows. Density changes row height only; it never changes font size.

## 4. Alignment rules

| Content | Horizontal | Header |
|---|---|---|
| Text, identity, URLs, badges, status | Left | Left |
| Numbers, ranks, deltas, percentages, currency, counts | Right | Right |
| Dates and times in "Updated" columns | Right (tabular figures) | Right |
| Sparklines | Left | Left |
| Icon-only columns (feature icons, flags) | Left, fixed icon slots so icons align vertically across rows | Left |
| Checkbox | Center within 40 px column | Center |
| Actions | Right | none (no header text) |

A delta column sits immediately right of its value column; together they read "7 ↓1". Units are in the header ("Volume", "Cost (USD)") rather than repeated in every cell, except percentages.

## 5. Column specification

Every column declares its type through column meta. Types fix width, alignment, sort direction, cell component and responsive priority.

| Column type | Default / min / max width | Align | Default sort | Cell |
|---|---|---|---|---|
| `select` | 40 / 40 / 40 | center | none | Checkbox |
| `keyword` | 280 / 200 / 480, flex | left | A to Z | `KeywordCell` |
| `prompt` | 360 / 240 / 640, flex | left | A to Z | `PromptCell` |
| `domain` | 220 / 160 / 360 | left | A to Z | `DomainCell` |
| `url` | 260 / 180 / 480 | left | A to Z | `URLCell` |
| `rank` | 64 / 56 / 80 | right | best first (ascending) | `RankCell` |
| `rankDelta` | 56 / 48 / 72 | right | biggest improvement first | `RankDeltaCell` |
| `count` | 88 / 72 / 120 | right | high to low | `NumberCell` |
| `volume` | 88 / 72 / 120 | right | high to low | `NumberCell` |
| `rate` | 80 / 72 / 120 | right | high to low | `MetricCell` |
| `rateDelta` | 80 / 64 / 96 | right | largest detectable change | `DeltaCell` |
| `currency` | 96 / 80 / 128 | right | high to low | `CostCell` |
| `date` | 120 / 104 / 160 | right | newest first | `DateCell` |
| `sparkline` | 88 / 88 / 120 | left | not sortable | `SparklineCell` |
| `badge` | 120 / 88 / 180 | left | A to Z | `Badge` |
| `engineGroup` (3 to 4 engine sub-columns) | 72 each | right | per engine | `EngineMetricCell` |
| `status` | 120 / 96 / 180 | left | severity first | `StatusCell` |
| `features` | 140 / 112 / 220 | left | count | `SERPFeatureList` |
| `aiOverview` | 112 / 96 / 140 | left | cited first | `AIOverviewStatus` |
| `competitor` | 160 / 120 / 240 | left | best rank or rate | `CompetitorCell` |
| `actions` | 40 / 40 / 40 | right | not sortable | row "More" menu |

Identity columns (`keyword`, `prompt`, `domain`, `url`) take remaining width (flex) and are pinned left. At most one flex column per table.

A screen may set its own default width for a column within the type's minimum and maximum, so its visible set fits the width budget; screen column specifications are in [19-responsive-behavior.md](19-responsive-behavior.md) section 6 and [24-page-templates.md](24-page-templates.md) section 9. Types without a screen value use the default above.

## 6. Specialized cells

All cells are components in `components/app/cells/`. Full props are in [25-component-inventory.md](25-component-inventory.md); the rendering contract is summarized here.

| Cell | Renders | Tooltip | Special states |
|---|---|---|---|
| `KeywordCell` | Keyword text in `foreground`; optional trailing 12 px icons for target-URL mismatch and cannibalization flag | Full keyword, location and device | Branded keywords get a neutral `Branded` micro badge only in prompt-linked views |
| `PromptCell` | Prompt text single line; optional leading `PromptTypeBadge` hidden in compact mode | Full prompt text (max 320 px wide, wraps) | Core panel prompts show a 12 px lock icon when the panel is locked |
| `RankCell` | Integer rank from `formatRankCell`, `num`, right-aligned; beyond depth renders the text `>20` in `foreground-tertiary` (not a chip); accessible text from `describeRank` ("not in top 20") | "Rank 3 · Sep 29, 02:14 · depth 20" and previous rank | `NotCollected`, stale badge |
| `RankDeltaCell` | `↑5` / `↓3` / `0` / `New` / `Lost` from `formatRankChange`; tone per emphasis rule | "Improved 5 positions (from #8 to #3). Normal movement for this keyword: up to 2 positions" | Empty on first check |
| `DeltaCell` | Signed value from `formatMetricDelta` (`+5.3 pts`) with tone | Previous value, interval, method; "Within normal variation" when not detectable | `n/a` when no comparison |
| `MetricCell` | Rate `47.2%`; Default density (40 px rows) adds `612 of 1,296 obs` below in `type-label` (12 / 16 px, the only secondary style that fits under a 20 px value line in a 40 px row); Compact density and embedded tables show the rate only | `k of n`, interval, prompts, window, method link | `InsufficientData` (hatched, "Insufficient", section 7.3); `NotApplicable` ("No AIO") |
| `NumberCell` | Exact grouped integer (`12,400`) | Exact value when abbreviated elsewhere | `n/a` |
| `DomainCell` | 16 px favicon (Citations, Sources, Competitors only), registrable domain in `type-mono` `foreground`, subdomain prefix in `foreground-tertiary`; role badge for own and competitor domains | Full host, category | Unresolved redirect flag |
| `URLCell` | `type-mono` (13 / 20 px). Host (optional, hidden when the table is scoped to one domain) in `foreground-tertiary`, path in `foreground`, middle-truncated with an ellipsis; hover shows copy and open icons (24 px targets) | Full display URL; original URL on the copy action | `Not ranking` text when empty |
| `SparklineCell` | 64 x 20 px canvas line in Default density, 64 x 16 px in Compact and embedded tables; 1.5 px gray (`chart-reference`) stroke, the own row in `primary` ([15-data-visualization.md](15-data-visualization.md) section 9); ranks drawn inverted; last point dot 3 px | Mini table of last 7 values and dates | Dashed flat baseline when no data |
| `EngineCell` / `EngineMetricCell` | Per-engine value (rate or status) under a grouped header "ChatGPT · Gemini · AI Mode" | Engine class (consumer UI, SERP AI), n, interval | Engine not enabled: `n/a`; insufficient: hatched |
| `EngineStatusGlyph` (inside `EngineCell` for prompt by engine status) | One glyph per engine, centered in a fixed slot: cited is a 10 px filled `primary` circle; mentioned but not cited is a 10 px circle with a 2 px `primary` ring (`border-2`); not mentioned is a 6 px `foreground-muted` dot. A legend with the same three glyphs and their labels sits in the page filter bar ([13-filters-search.md](13-filters-search.md)). Each glyph has an accessible name ("ChatGPT: cited", "Gemini: mentioned, not cited", "AI Mode: not mentioned"); the three shapes differ, so the state never depends on color alone | Engine, state, run time, cited URL when cited | Engine not enabled: `n/a`; not yet run: `Pending` |
| `EnginePresenceSquare` (per-engine presence, for example on Citations) | An 8 px square, `rounded-2xs` (2 px): `primary` fill when present, `border` fill when absent. The squares for several engines sit in one row in engine order ([14-badges-status.md](14-badges-status.md) section 4). Each square has an accessible name ("Gemini: present", "Gemini: absent") | Engine and presence count | Engine not enabled: `n/a` |
| `StatusCell` | `StatusBadge` (text plus icon) | Detail and time | n/a |
| `CitationCell` | `CitationStatus` (`Cited #2`, `Not cited`, `No AI Overview`) | Cited URL and position | n/a |
| `CompetitorCell` | Competitor name with 8 px square swatch in its chart color, and its value (rank or rate) | Competitor domains | n/a |
| `CostCell` | `formatCurrency` with 2 or 4 decimals | Unit count and unit price | n/a |
| `DateCell` | `formatTableDateTime` in project timezone (`Sep 29, 18:32`), `foreground-tertiary` in secondary columns | Detail format with timezone, relative time | Stale badge after staleness threshold |
| `SERPFeatureList` | Up to 5 fixed-slot 16 px outline feature icons; owned features in `primary-text`, present-but-not-owned in `foreground-muted`; `+2` overflow count | List of features with owned/not owned and positions | n/a |
| `AIOverviewStatus` | `Cited #2` as a positive badge (`positive-subtle` fill, `positive-text`, optional check icon); AI Overview present but the own domain not cited: a 16 px `Check` icon in `primary-text` with the accessible name "AI Overview present, not cited"; `No AI Overview` (text only, tertiary) | Citation position, number of sources, competitors cited | `Not loaded` for legacy data |

Rules:
- Cells never fetch data. They receive values from the row.
- Cells never format numbers themselves; they call `@/lib/format`. Screen reader text is the formatter's `label` field; components never compose it.
- The API contract type `MetricCell` (from `packages/contracts`) is imported as `MetricCellValue`, because `MetricCell` is also the name of this cell component ([25-component-inventory.md](25-component-inventory.md) section 1.5).
- Hover actions inside cells (copy, open) are also reachable by keyboard when the cell has focus (Enter on the cell opens a small action menu).

## 7. States

### 7.1 Loading
- First load: real header plus 12 skeleton rows at the current density, with skeleton bars sized by column type (numbers short and right-aligned, identity long).
- Refetch after filter or sort change: previous rows stay at full opacity (dimming would drop text contrast below 4.5:1) with `aria-busy="true"`, the static 2 px `RefetchBar` under the header ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.4), and "Updating" with a 14 px spinner in the toolbar after 400 ms. No skeleton flash.
- Pagination in server mode: the next page replaces rows with skeletons only if it takes longer than 300 ms.

### 7.2 Empty and error
Defined in [17-empty-loading-error-states.md](17-empty-loading-error-states.md). The header stays visible in all empty and error states so the user sees what the table would contain. Filtered-to-zero shows the active filters and a "Clear filters" action.

### 7.3 Unknown values in cells

| State | Cell display |
|---|---|
| Beyond depth | Text `>20` from `formatRankCell` in `foreground-tertiary` (rank cells; not a chip). Tiles, the inspector and speech use "not in top 20" (`formatRankInline`, `describeRank`) |
| Insufficient data | Hatching (the `bg-insufficient` utility): 1 px diagonal lines in `border-subtle` at 45 degrees, 4 px apart, on `surface-subtle` (no opacity color). Text `Insufficient` in `foreground-tertiary`, or the observation count ("3 obs") in cells narrower than 88 px; tooltip with counts. Tiles and the inspector say "Insufficient data" |
| Not applicable | Short text in `foreground-tertiary` naming the reason (for example `No AIO`), tooltip with the full reason ("No AI Overview in window"). Never an empty cell |
| Not yet collected | `Pending` tertiary with tooltip "First check scheduled for 02:00 CEST" |
| Error for this row | 14 px `TriangleAlert` in `warning-text` with tooltip, value if any still shown |

These are the `BeyondDepth`, `InsufficientData`, `NotApplicable` and `NotCollected` components of [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8, which owns their rendering.

## 8. Sorting

| Rule | Detail |
|---|---|
| Header click | First click applies the column's default direction (section 5), second reverses, third clears (returns to the table default sort) |
| Multi-sort | Shift+click adds a secondary key (maximum 2 keys). Header shows `1` and `2` badges |
| Unknown values | Beyond-depth ranks, insufficient data and `n/a` always sort last in both directions |
| Indicator | 14 px arrow icon next to the label on sorted columns only; unsorted sortable headers show the icon on hover |
| Mode | Client-side when the full dataset (up to 10,000 rows) is loaded; server-side above 10,000 rows ([20-frontend-specification.md](../20-frontend-specification.md) section 4.8). The component API is identical |
| URL | Sort is written to the URL (`?sort=-volume,rank`) |
| Accessibility | Header is a `button` inside `th` with `aria-sort` on the primary sorted column; multi-sort is described by a visible sort summary in the table toolbar ("Sorted by Rank ascending, then Volume descending"), announced when the sort changes ([20-accessibility.md](20-accessibility.md) section 6.5) |

## 9. Keyboard and accessibility

`DataTable` renders native table elements with `role="grid"` because rows contain interactive cells, and implements the APG grid keyboard model with one tab stop (roving focus).

| Key | Action |
|---|---|
| Tab / Shift+Tab | Enter or leave the grid (focus returns to the last focused cell) |
| Arrow keys | Move cell focus |
| Home / End | First / last cell in the row |
| Ctrl+Home / Ctrl+End | First / last cell in the table (loads rows as needed) |
| Page Up / Page Down | Move by the number of fully visible rows minus one, same column |
| Enter | Open the row in the inspector (on an interactive cell: activate that control) |
| Space | Toggle row selection |
| Shift+Space | Extend selection range from the last toggled row |
| Escape | Close the cell action menu, tooltip or menu. Never clears the selection |
| `j` / `k` | Optional next / previous row when focus is in the grid (single-key shortcuts can be disabled in Settings > Preferences, WCAG 2.1.4) |
| `/` | On table pages, focus table search (when focus is not in an input). On pages without a table search, `/` opens the command palette in search mode ([13-filters-search.md](13-filters-search.md) section 7) |

The full grid keyboard map, including widget mode, Ctrl+A and Shift+F10, is in [20-accessibility.md](20-accessibility.md) section 6.3, which is binding where the two differ.

ARIA for virtualization: `aria-rowcount` on the table is the total row count including the header row (or `-1` when unknown in server mode); each rendered row has `aria-rowindex` starting at 1 for the header. Columns hidden by priority are removed from the DOM and columns are not virtualized, so `aria-colcount` and `aria-colindex` are omitted ([20-accessibility.md](20-accessibility.md) section 6.2). Selection uses `aria-selected` on rows and `aria-multiselectable="true"` on the grid.

Drag alternatives (WCAG 2.5.7): every column header menu contains "Move left", "Move right", "Pin", "Wider", "Narrower", "Fit to content". Resize handles are also keyboard-operable separators (`role="separator"`, arrow keys change width by 16 px).

## 10. Column management

| Capability | Rule |
|---|---|
| Visibility | Column chooser popover (toolbar `Columns3` icon): columns grouped by domain (Rank, Metrics, AI, GSC, Competitors); identity column cannot be hidden; "Reset to default" |
| Order | Drag in the chooser list or in the header; keyboard via "Move up/down" buttons in the chooser and header menu items |
| Resize | 8 px hit area on the header right edge; double-click fits to content; min/max from column type |
| Pinning | Identity column is always pinned left; users can pin up to 2 more columns left; the actions column is pinned right |
| Header menu | Chevron on hover or focus: Sort ascending/descending, Filter by this column (adds a filter chip to the page filter bar, the one filtering system), Move, Pin, Resize, Hide |
| Header tooltips | Every abbreviated or methodological header (Δ, SOV, AIO, Vis.) has a tooltip with the definition and a method link |
| Persistence | Column state is part of the saved view (section 11); without a saved view it persists per user per table in the API-backed default view |

## 11. Saved views

Saved views make an analytical setup reproducible and shareable.

| Stored field | Example |
|---|---|
| `filters` | `{ loc: 2840, dev: "desktop", topic: ["t_12"], rank: ["top3", "top10"] }` (URL keys and rank bucket ids from [13-filters-search.md](13-filters-search.md) section 5) |
| `sort` | `["-volume", "rank"]` |
| `columns` | visible ids in order, widths, pins |
| `density` | `compact` (values `default` and `compact`) |
| `grouping` | `null` or a column id |
| `search` | table search text (optional) |

UI: a view menu next to the page title ("View: Top 10 losses"). The menu lists workspace views, then personal views, then "Save view", "Save as new view", "Rename", "Delete", "Reset to default". When the current state differs from the saved view, the menu label shows "(edited)" and "Save" becomes available. Views are stored by the API (`core.saved_views`, [04-data-model.md](../04-data-model.md) section 11.6) and addressable by URL (`?view=<id>`); explicit URL parameters override the view's values.

Seed views per table (examples): Rankings: "Top 10 losses", "Entered top 10", "AI Overview wins", "URL changed". Prompts: "Uncited prompts", "Competitor gaps", "Low confidence". Citations: "New sources", "Competitor-only sources".

## 12. Pagination and virtualization

| Dataset size | Behavior |
|---|---|
| Up to 100 rows | Plain rendering, no virtualization |
| 101 to 10,000 rows | Full dataset loaded in 200-row pages in the background, rendered with TanStack Virtual (fixed row size per density, `estimateSize` exact, no `measureElement`, overscan 10). Client-side sort, filter and search. Footer shows "1,000 keywords" |
| Above 10,000 rows | Server-side sort, filter and pagination (cursor). Page size 200. `TableFooter` with `Pagination`: range text "Showing 1 to 200 of 48,210 keywords", previous and next buttons and a page-size menu (100, 200, 500); no page numbers. Row virtualization still applies within the page |

Pagination style ([09-buttons-controls.md](09-buttons-controls.md) section 13): the range text sits on the left of the footer in `type-meta` `num`; previous and next are 32 px square buttons (`h-control-sm`) with a 1 px `border`, radius 6, and a chevron icon; disabled at the ends. Pagination is cursor-based, so the numbered page buttons of the reference screens (with the current page in `primary-subtle` and `primary-text`) are not used.

The sticky header is CSS `position: sticky` outside the virtualized body. Horizontal scrolling happens in the table region; the identity column is pinned. Column virtualization is not used (tables have at most about 25 columns).

Column priority and responsive hiding are specified in [19-responsive-behavior.md](19-responsive-behavior.md). Hidden columns remain available in the column chooser and in the inspector.

## 13. Row interaction

| Action | Result |
|---|---|
| Click on a row (outside controls) | Opens the record in the right inspector; the row becomes active |
| Cmd/Ctrl+click or middle click | Opens the full detail page in a new tab |
| Click on the checkbox | Toggles selection (does not open the inspector) |
| Right-click | Row context menu (same items as the "More" menu) |
| "More" menu (actions column) | Open in inspector, Open full page, Copy link, domain-specific actions (Check now, Edit, Add to group), destructive actions last |
| Hover actions | Up to 2 icon actions appear at the right of the identity cell on hover or focus (for example Copy URL, Open external) |

Rows are not links (`<a>` wrapping a row breaks table semantics). Navigation is done by the row handler and the explicit "Open full page" actions.

## 14. Selection and bulk actions

- Checkbox column (40 px) with a tri-state header checkbox selecting all rows currently loaded.
- When all loaded rows are selected and more exist, the bulk bar offers "Select all 4,812 matching". Bulk actions then apply to the server-side filter scope, and the confirmation states the count.
- Maximum bulk scope: 10,000 records per action; larger scopes require an export and import workflow.
- Bulk actions are ordered: non-destructive first, destructive last and separated. Destructive bulk actions always confirm with the exact count. Any bulk action over 100 rows, reversible or not, confirms in an `AlertDialog` that names the count ([20-accessibility.md](20-accessibility.md) section 2, criterion 3.3.4).
- Selection persists across sorting and client-side filtering; server-side page changes keep selected ids; a filter change that removes selected rows from the result shows "3 selected rows are hidden by filters".

## 15. SimpleTable (read-only)

For inspector key-value lists, chart data alternatives, and small reference tables: native `table` semantics without `role="grid"`, no selection, no virtualization, `type-table`, 32 px rows (`h-row-compact`, always; section 3.1), header labels in `type-label` (12 px, tertiary) on `surface-subtle`, label column `foreground-secondary` at 40% width, values `foreground`. In a ranked mini table (for example the top results in an inspector), the own row is `surface-selected` with its text in `primary-text`. Key-value lists with fewer than 8 items inside an inspector may use a description list (`dl`) styled identically.

## 16. Grouping and expandable rows

- One grouping level at most (for example Rankings grouped by keyword group, Citations grouped by domain with pages as children).
- Group header rows show the group name, count and column aggregates where they are meaningful (sum of volume, count in top 10), never averages of rates unless the API supplies the weighted value.
- Expandable rows use `aria-expanded` on the parent row and a 14 px chevron in the identity cell; Right Arrow expands and Left Arrow collapses when the row is focused.

## 17. Export

Toolbar export menu: "Export CSV" and "Export XLSX" for the current filter scope (not only visible rows), including denominators, sample counts, interval bounds, depth and source labels. Up to 50,000 rows client-side in a Web Worker; above that, the API's asynchronous export with a toast and download link. Formula-injection protection is applied to every cell ([20-frontend-specification.md](../20-frontend-specification.md) section 4.8).

## 18. Performance budgets

| Operation | Budget (10,000 rows, 12 columns, CPU throttled 4x) |
|---|---|
| Data ready to first rows painted | under 150 ms |
| Client sort or filter | under 100 ms |
| Scrolling | no long task over 50 ms |
| Density toggle | under 100 ms |
| Memory | under 150 MB heap |

Techniques: memoized column definitions, stable row ids, canvas sparklines drawn by one shared renderer (not ECharts), no per-cell tooltips mounted until hover or focus, formatting cached per row.

## 19. Component API sketch

```tsx
<DataTable<RankRow>
  id="rankings"                      // persistence and saved-view key
  caption="Keywords"
  itemNoun={{ one: 'keyword', other: 'keywords' }}
  data={rows}                        // client mode; above 10,000 rows pass server={serverPage} instead (components never fetch)
  getRowId={(r) => r.trackedKeywordId}
  columns={[
    col.select(),
    col.keyword((r) => r.keyword, { header: 'Keyword' }),
    col.rank((r) => r.rank),         // depth comes from the rank observation
    col.rankDelta((r) => r.rankChange),
    col.url((r) => r.rankingUrl, { header: 'Ranking URL', priority: 2 }),
    col.volume((r) => r.volume),
    col.badge((r) => r.intent, { header: 'Intent', priority: 3 }),
    col.features((r) => r.features, { header: 'SERP features', priority: 3 }),
    col.aiOverview((r) => r.aio, { header: 'AI Overview' }),
    col.competitor((r) => r.topCompetitor, { header: 'Competitor', priority: 4 }),
    col.sparkline((r) => r.trend, { header: 'Trend', priority: 2 }),
    col.date((r) => r.updatedAt, { header: 'Updated', priority: 4 }),
    col.actions(rowActions, (r) => r.keyword.keyword),
  ]}
  defaultSort={['-volume']}
  onRowOpen={(row) => inspector.open({ type: 'keyword', id: row.trackedKeywordId })}
  bulkActions={keywordBulkActions}
  savedViews={savedViewSlot}
  {...tableState}                    // sort, density, search, status and empty states (25 section 7.1)
/>
```

`col.*` helpers apply the column type defaults from section 5, so screens never set widths, alignment or formatting by hand.
