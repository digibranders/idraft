# 19. Responsive Behavior

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: breakpoints in [`globals.css`](../../apps/web/src/styles/globals.css) (`--breakpoint-*`); container sizes are Tailwind v4 defaults (`--container-*`, not reset); JS viewport hook `lib/design/use-viewport-class.ts` (Phase 1)

This document defines how every screen adapts from a 1920 px monitor down to a 360 px phone. Layout primitives and widths come from [05-layout-grid.md](05-layout-grid.md); this document decides what each region does at each width. Accessibility consequences (reflow, zoom, target size) are specified in [20-accessibility.md](20-accessibility.md).

## 1. Principles

1. **Desktop first, 1440 is the reference.** Every screen is designed at 1440 x 900, then checked at each class in section 2. A layout that only works at 1440 is not finished.
2. **Extra width goes to data.** Wider screens show more table columns and dock the inspector. Content is never centered in a narrow column, except prose and settings forms ([05-layout-grid.md](05-layout-grid.md)).
3. **Same product at every width.** Routes, URLs, filters, sort and saved views are identical across classes. A link copied on desktop and opened on a phone shows the same filtered view; only the presentation changes.
4. **Nothing disappears silently.** A hidden column is reachable through the inspector and the column chooser. A feature that is not offered on a phone says so and names the feature (section 11).
5. **Viewport breakpoints are for the shell; container queries are for components.** The sidebar, top bar, page header, filter bar, dialog mode and table column tiers respond to the viewport. Anything that can sit in both the page and the inspector responds to its container (section 12).
6. **The page never scrolls horizontally** at any width from 320 px up. Wide tables scroll inside their own region with the identity column pinned.
7. **Touch sizing only where touch is primary.** The desktop keeps its desktop sizes (36 px controls, 32 px table rows in Compact density, the default, 40 px rows in Comfortable density). 44 px targets apply to the mobile layout (section 10).

### 1.1 Layout class versus input mode

Two independent signals drive responsive behavior:

| Signal | Definition | Drives |
|---|---|---|
| Layout class | Viewport width in CSS px (section 2) | Shell layout, table column tiers, list vs table, dialog vs sheet |
| Touch-primary | `(pointer: coarse) and (hover: none)` | Target sizes, hover replacements, feature gating on phones (section 11) |

A desktop browser zoomed to 200% on a 1280 px screen is 640 CSS px wide. It gets the mobile layout (drawer navigation, filter sheet, list rows) but it is not touch-primary, so every feature stays available and the list can be switched to the full table. This is how the product meets WCAG 1.4.4 and 1.4.10 without shipping a reduced product to low-vision desktop users ([20-accessibility.md](20-accessibility.md)).

## 2. Viewport classes

| Class | CSS width | Tailwind range | Sidebar | Inspector | Table tiers shown | Page gutter |
|---|---|---|---|---|---|---|
| Wide desktop | 1680 and up (1680, 1920, 2560 tested) | `3xl:` and `4xl:` | Expanded 208 px | Docked, default width per inspector type (section 7) | 1 to 4 | 20 px |
| Desktop (reference) | 1440 to 1679 | `2xl:` | Expanded 208 px | Docked at the default width per inspector type; a wider stored width is narrowed by the docking rule (section 7) | 1 to 3 | 20 px |
| Small desktop | 1280 to 1439 | `xl:` | Expanded 208 px | Docked when the docking rule allows (from 1,288 px with the expanded sidebar), otherwise overlay (section 7) | 1 to 2 | 20 px |
| Tablet | 768 to 1279 | `md:` and `lg:` | Collapsed rail 56 px at 1024 to 1279; drawer at 768 to 1023 | Overlay drawer | 1 | 20 px at 1024 and up, 16 px below |
| Mobile | 360 to 767 (320 must not break) | base and `sm:` | Drawer | Full-screen sheet | List rows (section 6.7) | 12 px |

Rules:
1. Tailwind variants are min-width. Shell components write the mobile layout as the base style and add `md:`, `lg:`, `xl:`, `2xl:`, `3xl:` and `4xl:`. `max-*` variants are allowed only inside the Dialog, Sheet and Drawer primitives.
2. JavaScript decisions (column tiers, list vs table, inspector mode) use `useViewportClass()`, which evaluates `matchMedia` queries built from the same `rem` values as `globals.css`. No component reads `window.innerWidth` directly.
3. Server rendering reads the `viewport-class` cookie that the client writes on load and on resize (debounced 200 ms). On a first visit without the cookie the server uses `Sec-CH-UA-Mobile`; the table region renders its skeleton until the client confirms the class, so a phone never flashes a 14-column table.
4. Class changes at runtime (window resize, rotation, zoom) re-evaluate the shell and column tiers without a reload and without losing scroll position, focus, selection or filter state.
5. Every breakpoint is authored in `rem`, so browser zoom and default font size changes move the page across classes exactly as a narrower window would.

## 3. Application shell

### 3.1 Sidebar

| Class | State | Width | Behavior |
|---|---|---|---|
| Wide desktop, desktop, small desktop | Expanded by default | 208 px | User can collapse to the 56 px rail with the toggle at the bottom of the sidebar or `[` (single-key shortcut policy in [20-accessibility.md](20-accessibility.md)). Choice persists in a cookie |
| Tablet 1024 to 1279 | Collapsed rail by default | 56 px | Icons only; each item has a tooltip with the label and shortcut. Expanding at this width opens the full 208 px sidebar as an overlay above the content (`--z-sidebar`, no scrim). It closes on navigation, Escape, or a click outside. It does not push the content |
| Tablet 768 to 1023 | Hidden | 0 | A menu button (`Menu` icon, name "Open navigation") at the left of the top bar opens the navigation drawer |
| Mobile | Hidden | 0 | Same drawer |

Navigation drawer: width `min(280px, 100vw - 56px)`, full height, `surface` background, scrim (`--scrim`), modal (focus is trapped, Escape and scrim click close it, focus returns to the menu button). Contents match the expanded sidebar. The current page item has `aria-current="page"`. Selecting an item closes the drawer and navigates.

The collapsed rail never appears below 1024 px: a 56 px rail on a 768 px screen costs 7% of the width for icons that need tooltips, which touch devices cannot show.

### 3.2 Top bar

The top bar is 52 px at every width and always sticky. Its controls are 36 px (`h-control`), 12 px apart. Anatomy and order are in [11-navigation.md](11-navigation.md) section 4.

| Element | 1440 and up | 1280 to 1439 | 1024 to 1279 | 768 to 1023 | Mobile |
|---|---|---|---|---|---|
| Navigation menu button | Not shown | Not shown | Not shown | Shown, left | Shown, left |
| Breadcrumb | `House`, Workspace, Project, page at 1680 and up; `House`, Project, page at 1440 to 1679 (Workspace becomes the first group inside the Project menu) | `House`, Project, page | `House`, Project, page | Project switcher only; workspace is the first group inside it | Project switcher only, max width 50% of the bar, name truncated with the full name in the menu |
| Search | Field with the `⌘K` hint box: 440 px at 1680 and up, 360 px at 1440 to 1679 | Field, 240 px | Icon button "Search" | Icon button | Icon button |
| Date range | Button: `Calendar` icon, window label, chevron | Same | Same | Same | Not in the top bar: first section of the filter sheet (section 4.2) |
| Location | Button: `MapPin` icon, location name (max 180 px), chevron | Same | Same | `MapPin` icon button; its name and tooltip carry the value ("Location: United States") | Not in the top bar: a row of the filter sheet (section 4.2) |
| Alerts | Bell icon button with count badge | Same | Same | Same | Same |
| Theme | `ThemeSwitch`: 52 by 28 px light and dark switch ([11-navigation.md](11-navigation.md) section 4); the user menu has no Theme group | Moves into the user menu as a Theme group (System, Light, Dark) | User menu | User menu | User menu |
| Help | `HelpMenu`: icon button "Help" with the `CircleHelp` icon (menu) | Same | Same | Same | Same |
| User menu | Avatar button | Same | Same | Same | Same |

Rows are in visual order from left to right. On pages where date range and location do not apply (Settings, Integrations, [11-navigation.md](11-navigation.md) section 4) they are not rendered at any width.

Collapse order as the bar narrows, first to last:
1. Below 1680 px: the search field narrows from 440 to 360 px and the Workspace item moves into the Project menu.
2. Below 1440 px: the theme menu moves into the user menu and the search field narrows to 240 px.
3. Below 1280 px: the search field becomes an icon button.
4. Below 1024 px: the breadcrumb reduces to the project switcher, and the location button becomes an icon button.
5. Below 768 px: date range and location leave the top bar for the filter sheet.

Date range and location are scope that the user must see, so they keep their labels longer than any other control; notifications, help and the user menu never collapse. Within a width class, breadcrumb ancestors truncate with an ellipsis (full name in the tooltip and the menu, minimum 80 px each) before any right-side control changes; the current page truncates last. The widths assume the expanded 208 px sidebar at 1280 px and up, and a typical label for the scope buttons ("Last 28 days", "United States").

The Help button keeps the same relative position (immediately left of the user menu) at every width, which satisfies Consistent Help (WCAG 3.2.6). The search icon button and `⌘K` both open the command palette; below 640 px the palette is a full-screen sheet (section 9).

### 3.3 Page header

The page header holds the title row (title, saved-view selector, meta, actions), optional tabs, and the filter bar.

| Element | 1024 and up | 768 to 1023 | Mobile |
|---|---|---|---|
| Title | `type-page-title`, wraps to 2 lines at most, never truncates | Same | Same |
| Saved-view selector | Next to the title | Next to the title | Below the title, full width select trigger |
| Meta line (freshness, scope, Methodology link) | Right of the title or on a second line when it does not fit | Second line | Second line; items beyond the first two move into the page More menu |
| Primary action | Visible button with label | Visible button with label | Visible button with label, on the actions row below the title |
| Secondary actions | Up to 2 visible secondary buttons, the rest in a More menu ([23-application-patterns.md](23-application-patterns.md) section 3.1) | All collapse into a More menu (`Ellipsis` button named "More actions") | More menu |
| Tabs | Inline tablist, 44 px row (`--size-tab`) | Tabs that do not fit move into a trailing "More" menu button after the tablist | Same as tablet |

Rules:
1. Below 1024 px, only the primary action stays outside the More menu. The More menu lists secondary actions in the same order they appear on desktop.
2. Actions that are not offered on a touch-primary phone (section 11) stay in the More menu and open the desktop-only notice instead of being removed.
3. Tab overflow never uses horizontal scrolling or edge fades. The overflow button is outside the `tablist` and is named "More tabs"; choosing a tab from it activates that tab and moves it into the visible set, swapping out the last visible tab.

### 3.4 Sticky stack and short viewports

| Class | Sticky elements, top to bottom |
|---|---|
| 1024 and up, table pages | Top bar, page header (title row, tabs, filter bar), table header |
| 1024 and up, overview and detail pages | Top bar only |
| 768 to 1023 | Top bar, filter bar row, table header |
| Mobile | Top bar, filter row (Filters and Sort buttons, result count, 44 px) |

Short viewports: when the viewport height is below 480 CSS px (phone landscape, 400% zoom), only the top bar and the table header stay sticky. The sticky stack must never exceed 40% of the viewport height.

The stack height is measured with a `ResizeObserver` and written to `--sticky-stack-height` on the scroll container, which sets `scroll-padding-top` so a focused row is never hidden under sticky chrome (WCAG 2.4.11). The bulk bar replaces the table toolbar at the top of the table ([12-tables.md](12-tables.md) section 1); `scroll-padding-top` covers it together with the sticky table header.

## 4. Filter bar

The filter model, chip anatomy and operators are defined in [13-filters-search.md](13-filters-search.md). This section defines layout only.

| Class | Triggers | Active filter chips | Result count |
|---|---|---|---|
| 1280 and up | Screen scope triggers (compare, device, engines) inline, then screen filters, then "+ Filter". Date window and location are in the top bar (section 3.2) | Row below the triggers; chips wrap to as many rows as needed, followed by "Clear all" | In the table toolbar |
| 1024 to 1279 | Screen scope triggers inline; screen filters only through "+ Filter" | Wrap below | Table toolbar |
| 768 to 1023 | Everything behind a "Filters" button with a count badge; the date window stays visible in the top bar | Wrap below the row | Table toolbar |
| Mobile | "Filters" button with count badge and "Sort" button in the sticky filter row; the date window is the first section of the sheet and location a row in it, because they leave the top bar below 768 px | Not shown on the page; listed at the top of the sheet | In the sticky filter row, `type-meta`: "412 keywords" |

The result count column applies to table pages. On T1 overview pages, which have no table toolbar, the result count sits right-aligned in the filter bar ([23-application-patterns.md](23-application-patterns.md) section 3.1).

Chips wrap; they never scroll horizontally and never collapse into "+3 more". A long chip value truncates inside the chip at 240 px with the full value in the chip's tooltip and in its edit popover. When the chip rows change height, the sticky stack height updates (section 3.4).

### 4.1 Count badge

The badge on the "Filters" button shows the number of filters that differ from the screen's defaults (a default date window does not count). It uses `type-micro` in a `neutral-subtle` badge. The button's accessible name includes the count: "Filters, 3 active". Zero active filters hides the badge.

### 4.2 Mobile filter sheet

Below 768 px, "Filters" opens a full-height sheet (Base UI Drawer, bottom edge, height `100dvh`), modal.

```
+----------------------------------+
| Filters                     [X]  |  header 48 px, sticky
|----------------------------------|
| Active (3)              Clear all |
| [Topic: CRM  x] [Intent: ...x]   |
|----------------------------------|
| Date window          28 days  >  |  each row 44 px, opens a nested view
| Compare        previous period > |
| Location                  US  >  |
| Device               Desktop  >  |
| Intent            Commercial  >  |
| Tag                      Any  >  |
|----------------------------------|
| [ Clear all ]  [ Show 412 keywords ] |  footer 64 px, sticky
+----------------------------------+
```

Rules:
1. Changes in the sheet are staged. "Show N results" applies them and closes the sheet. The count in that button refreshes 500 ms after the last change and reads "Show 412 keywords"; while loading it keeps the previous number and adds `aria-busy="true"`.
2. Close (X), Escape, the back gesture and the browser back button discard staged changes without a confirmation. A staged set with no net change closes silently.
3. Each filter row opens a nested view inside the sheet (not a stacked second sheet) with a back button. Multi-select values are checkbox rows of 44 px; search inside long value lists is a 44 px input at the top of the nested view.
4. "Clear all" removes every filter, as on desktop; scope controls such as the date window are not reset ([13-filters-search.md](13-filters-search.md) section 2). The change stays staged until "Show N results".
5. Filter state is in the URL exactly as on desktop.

## 5. Metric strip

The metric strip is a container-query component (section 12) so it behaves the same wherever it is placed. Its layout and wrapping rules are owned by [23-application-patterns.md](23-application-patterns.md) sections 2.2 and 2.3; this section restates them. On pages (`size="md"`) it is one panel, 76 px tall, whose cells share the panel width equally (minimum 140 px each) and are split by full-height 1 px `border-subtle` dividers; `n` is the item count (3 to 6). In the inspector (`size="sm"`) it is always the key-value grid of 23 section 2.2 and does not use the rules below.

| Condition | Layout |
|---|---|
| Container width at least `n x 140 + (n - 1)` px | Single row, 76 px tall (96 px with context lines) |
| Narrower container | Two rows with `ceil(n / 2)` cells in the first row, separated by a 1 px `border-subtle` line; 153 px tall (76 + 1 + 76) |
| Viewport below 768 px | Two-column grid inside the panel, dividers between cells kept, 76 px cells (96 px with context lines) |

One-row minimums: 422 px for 3 items, 563 px for 4, 704 px for 5, 845 px for 6. In the page (sidebar expanded 208 px, 20 px gutters) the main column is 1,032 px at 1280 and 1,192 px at 1440, so a 6-item strip fits on one row at every desktop width. With the collapsed rail at 1024 px the main column is 928 px, which also fits 6 items. At 768 to 1023 px (no sidebar, 16 px gutters) the main column is 736 to 991 px: 5 items fit on one row throughout, 6 items from an 877 px viewport. Below 768 px the two-column grid applies.

Decision for mobile: **2-column grid, not a horizontally scrollable snap row.** Reasons: a snap row hides metrics off-screen that users do not scroll to; it creates a second scroll direction and a separate keyboard stop; and it would put sideways-scrolling content inside the page chrome, which WCAG 1.4.10 does not exempt. Each grid cell keeps label, value and context line; the context line truncates with its full text in the metric's tooltip and in the inspector.

## 6. Tables

Table anatomy, cell components and the column chooser are defined in [12-tables.md](12-tables.md). This section defines what is visible at each width.

### 6.1 Column priority system

Every column in every `DataTable` declares a priority from 1 to 4.

| Priority | Meaning | Visible at viewport width |
|---|---|---|
| 1 | Identity plus the primary value and its delta | Always, including the mobile list |
| 2 | Values most users compare or act on | 1280 and up |
| 3 | Context that helps interpret the row | 1440 and up |
| 4 | Detail and metadata | 1680 and up |

Rules:
1. **Tiers follow the viewport, not the table container.** Opening, closing or resizing the inspector never hides or reveals columns; the docked inspector narrows the table, which then scrolls horizontally with the identity column pinned. A table that reshuffles its columns when the user opens a record breaks the "context is preserved" principle ([00-design-principles.md](00-design-principles.md)).
2. Hidden columns are removed from the column model (TanStack column visibility), not hidden with `display: none`. This keeps the header count and grid keyboard navigation consistent with what is on screen, so `aria-colcount` is omitted ([20-accessibility.md](20-accessibility.md) section 6.2).
3. The checkbox column and the row actions column are not tiered: both are present whenever selection and row actions are available at that width.
4. The identity column is pinned left at every width and absorbs spare width up to its maximum (480 px for keywords, 640 px for prompts, [12-tables.md](12-tables.md) section 5). These are column maximums, unrelated to the inspector widths.
5. Priorities are defined per screen in the screen's column config next to the column definition, never computed from column order.
6. Width budgets below are the column's default width on that screen; column widths do not change with density. Each lies within its column type's minimum and maximum ([12-tables.md](12-tables.md) section 5). At each tier boundary the visible set must fit the content width of that viewport with the sidebar expanded and no inspector. A screen that fails this check lowers a column's priority; it does not shrink columns below their minimum.

### 6.2 Rank Tracker

Content width budget: 1,030 px at 1280, 1,190 px at 1440, 1,430 px at 1680 (viewport minus the 208 px sidebar, the two 20 px gutters and the table panel's two 1 px borders).

| Column | Priority | Default width | Notes |
|---|---|---|---|
| Keyword | 1 | 280 px (min 200, max 480) | Pinned. Location and device are in the cell tooltip, not inline chips (badge budget, [14-badges-status.md](14-badges-status.md) section 2) |
| Rank | 1 | 64 px | `RankCell`: rank number, or the text `>20` from `formatRankCell` when beyond depth (no chip); tooltip and speech say "not in top 20" |
| Δ (Change) | 1 | 56 px | `RankDeltaCell`: arrow plus positions (`↑5`, `↓3`), `0`, `New`, `Lost`, or empty on the first check |
| Ranking URL | 2 | 200 px | `URLCell`, middle truncation |
| Volume | 2 | 80 px | Estimate badge in the header |
| AI Overview | 2 | 104 px | Absent, present, cited #n |
| Trend | 2 | 96 px | 30-check sparkline |
| Intent | 3 | 96 px | Neutral chip |
| SERP Features | 3 | 120 px | Icons with accessible names |
| Competitor | 4 | 120 px per competitor | First selected competitor; further competitors are chooser-only and take priority 4 |
| Updated | 4 | 104 px | Last successful check, relative time |

Visible sets (with the 40 px checkbox and 40 px actions columns): 1280 shows Keyword, Rank, Δ, Ranking URL, Volume, AI Overview, Trend (960 px of 1,030). 1440 adds Intent and SERP Features (1,176 of 1,190). 1680 adds Competitor and Updated (1,400 of 1,430).

Columns that [20-frontend-specification.md](../20-frontend-specification.md) lists but that are not in this set (Previous, Best rank, Target URL, KD, Absolute rank, volatility, GSC columns, priority, group) are off by default at every width. When a user turns one on in the column chooser it gets priority 3, unless the user pins it (section 6.4).

### 6.3 Prompt Explorer

| Column | Priority | Default width | Notes |
|---|---|---|---|
| Prompt | 1 | 360 px (min 240, max 640) | Pinned. `PromptCell`, one line at both densities |
| Mention Rate | 1 | 112 px | `MetricCell` with its delta; the primary value of the row |
| ChatGPT | 2 | 72 px | Per-engine `EngineMetricCell` (`engineGroup` column, [12-tables.md](12-tables.md) section 5) |
| Gemini | 2 | 72 px | Per-engine `EngineMetricCell` |
| AI Mode | 2 | 72 px | Per-engine `EngineMetricCell` |
| Citation Rate | 2 | 112 px | `MetricCell` |
| Topic | 3 | 140 px | Topic path, middle truncation |
| Trend | 3 | 96 px | Sparkline with CI band omitted |
| Top Competitor | 4 | 140 px | Entity name with its color swatch |
| Updated | 4 | 104 px | Last observation time |

Visible sets (with the 40 px checkbox and 40 px actions columns): 1280 shows Prompt, Mention Rate, the three engine columns and Citation Rate (880 of 1,030). 1440 adds Topic and Trend (1,116 of 1,190). 1680 adds Top Competitor and Updated (1,360 of 1,430).

Engine columns follow the engine filter. Engines beyond the first three selected take priority 3. How rates are computed and pooled is defined in [12-tables.md](12-tables.md) and the methodology documents; responsive behavior never changes what a column means.

### 6.4 User overrides and the column chooser

1. The column chooser lists every column, grouped as in [12-tables.md](12-tables.md). Columns hidden by the current tier are listed with the note "Hidden at this width" in `type-meta` and a "Show anyway" action.
2. "Show anyway" pins the column visible at every width for this user and table (stored in the saved view state). Pinned columns add to the table width; the table scrolls horizontally inside its region.
3. A column the user hides stays hidden at every width.
4. "Reset to default" in the column chooser ([12-tables.md](12-tables.md) section 10) restores defaults and tiers.
5. The column chooser, resize and reorder are not offered on touch-primary phones (section 11).

### 6.5 Reaching hidden columns

Every field of a row is available in three places regardless of width:
1. **The inspector** shows all fields of the record, grouped, including every column hidden by tiers. The inspector is the primary way to read a hidden value.
2. **The column chooser** can bring the column back (section 6.4).
3. **Export** includes all columns regardless of visibility ([12-tables.md](12-tables.md)).

### 6.6 Tablet tables

At 768 to 1279 only priority 1 columns are shown, so in Comfortable density (the 40 px choice) the identity cell carries a secondary line:
1. The density at this width is Compact (32 px rows), the default, as at every width (owner decision of 2026-10-29). Comfortable (40 px rows) stays available in the density toggle, and a saved density choice is always respected; 32 px rows meet the 24 px target size (WCAG 2.5.8).
2. In Comfortable density the identity column shows its secondary line in `type-label` (12 / 16 px, which fits under a 16 px line in a 40 px row) with the values of the two highest priority-2 columns as text. Compact density, the default, shows one line, and the values move to the tooltip and the inspector. Rank Tracker: `US · Desktop · /pricing · 2.4K`. Prompt Explorer: `ChatGPT 38% · Gemini 25% · AI Mode 40%`.
3. On touch-primary tablets the row actions button ("More actions for {row name}") is always visible instead of appearing on hover, and icon buttons in rows are at least 32 px.

### 6.7 Mobile list rows

Below 768 px, a `DataTable` renders as a list of two-line rows. It never renders a horizontally scrolling 14-column table by default.

```
+--------------------------------------------------+
| best crm for startups                        4   |  line 1: identity (type-body-strong), primary value (type-body-strong, num)
| US · Desktop · /pricing                   ↑2    |  line 2: context (type-meta), rank change (RankDeltaCell)
+--------------------------------------------------+
| crm pricing                              >20     |
| US · Desktop · no ranking URL            Lost    |
+--------------------------------------------------+
```

| Part | Rank Tracker | Prompt Explorer |
|---|---|---|
| Line 1 left | Keyword, truncated with ellipsis | Prompt, truncated with ellipsis |
| Line 1 right | Rank (`>20` beyond depth, spoken "not in top 20") | Mention rate |
| Line 2 left | Location, device, ranking URL path | Topic, engine count ("3 engines") |
| Line 2 right | Rank change | Mention rate change |

Rules:
1. Row height is 56 px minimum (two 20 px lines, `type-body-strong` and `type-meta`, plus 8 px vertical padding), with 12 px horizontal padding and a `border-subtle` divider. The whole row is one target that opens the record in the full-screen inspector sheet.
2. Values use the same cell components and formatters as the desktop cells, so a value reads identically on both.
3. No checkbox, no inline row actions, no sparkline. The inspector has the record actions.
4. Sort is a "Sort" button in the sticky filter row that opens a sheet with a radio list of the sortable priority 1 and 2 columns and a direction control. The active sort is shown on the button: "Sort: Rank".
5. The list is virtualized with the same data source, row cache and URL state as the table. Scrolling back after closing the inspector returns to the same row.
6. Empty, loading and error states are the list equivalents of the table states ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)).
7. When the layout is mobile but the device is not touch-primary (a zoomed desktop browser), the list toolbar shows a "List / Table" segmented control. "Table" renders the full `DataTable` with all tiers the user chose, scrolling horizontally inside its region. Data tables are exempt from WCAG 1.4.10, so this is permitted; the page chrome around it still reflows.

The list's markup and screen reader behavior are defined in [20-accessibility.md](20-accessibility.md).

### 6.8 Horizontal scrolling inside tables

1. Horizontal overflow is contained in the table's scroll region; `overflow-x: auto` is on the table region, `overflow-x: clip` on the page.
2. The identity column (and the checkbox column when present) stays pinned at every width.
3. A right-edge 1 px `border` line appears on the pinned column when content scrolls under it. No gradient shadows.
4. The horizontal scrollbar is always reachable: the table region's height is bounded by the viewport, so the scrollbar is not below the fold.

## 7. Inspector

The inspector pattern is defined in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md). Responsive modes:

| Class | Mode | Width | Modality |
|---|---|---|---|
| Wide desktop 1920 and up | Docked | Stored width, default per inspector type: 440 px (`--size-inspector-wide`: prompt, citation, answer evidence), 400 px (`--size-inspector`) for every other type (keyword, page, competitor, domain, source, run, candidate) ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.2) | Non-modal |
| Wide desktop 1680 to 1919 | Docked | Stored width, default per inspector type (same as 1920) | Non-modal |
| Desktop 1440 to 1679 | Docked; a stored width wider than the space left is narrowed | See the docking rule | Non-modal |
| Small desktop 1280 to 1439 | Docked when the docking rule allows (collapsed rail, or the expanded sidebar from 1,288 px), otherwise overlay | See the docking rule | Non-modal |
| Tablet 768 to 1279 | Overlay card from the right, 12 px under the top bar and from the right and bottom edges, `shadow-inspector`, no scrim, content stays interactive | `min(stored width, 640px, 100vw - 56px)` ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.6) | Non-modal |
| Mobile | Full-screen sheet with a back button in its 48 px header | 100vw | Modal |

**Docking rule** (applies at 1280 and up). The main column must keep at least 720 px ([05-layout-grid.md](05-layout-grid.md)).

```
dockable = viewport width - sidebar width - 720
if dockable >= 360: dock at min(preferred width, dockable)
else: overlay at preferred width
```

The 360 px threshold is the inspector minimum (`--size-inspector-min`); the same rule is in [05-layout-grid.md](05-layout-grid.md).

| Viewport | Sidebar | Dockable | Result for a 400 px inspector | Result for a 440 px prompt inspector |
|---|---|---|---|---|
| 1920 | 208 | 992 | Docked 400 | Docked 440 |
| 1680 | 208 | 752 | Docked 400 | Docked 440 |
| 1440 | 208 | 512 | Docked 400 | Docked 440 |
| 1440 | 56 | 664 | Docked 400 | Docked 440 |
| 1280 | 208 | 352 | Overlay 400 | Overlay 440 |
| 1280 | 56 | 504 | Docked 400 | Docked 440 |

At the defaults, narrowing happens only between 1,288 and 1,367 px with the expanded sidebar (dockable 360 to 439 px); it matters more for users who widened the inspector toward the 640 px maximum.

Rules:
1. A docked inspector narrowed by the rule shows its own content at that width; its components respond through container queries (section 12). The user's stored width is not overwritten by automatic narrowing.
2. Resizing (drag on the left edge, or the keyboard and menu alternatives in [20-accessibility.md](20-accessibility.md)) is available when docked or overlaid, bounded 360 to 640 px (`--size-inspector-min`, `--size-inspector-max`) and by the docking rule. It is not available on the mobile sheet.
3. Changing mode (for example, rotating a tablet or resizing the window) keeps the same record open and the inspector's scroll position.
4. On mobile, the sheet's back button and the browser back button close the sheet and return to the list at the same scroll position; the record is in the URL, so the back button works without special handling.

## 8. Charts

Chart rules are in [15-data-visualization.md](15-data-visualization.md); chart heights and axis spacing are owned there (sections 2 and 6). Responsive behavior is driven by the chart panel's container width.

| Property | 768 px container and up | 480 to 767 px | Below 480 px |
|---|---|---|---|
| Plot height | Per [15-data-visualization.md](15-data-visualization.md) section 2: standard trend 240 px, Overview main trend 280 px, small multiple 140 px, matrix 480 px (min 400); inspector charts 180 px at every width | 200 px | 180 px |
| Legend | HTML legend in the chart header row, right-aligned, one line; moves below the plot when it does not fit on one line | Below the plot, wrapping | Below the plot, wrapping, one item per line when names exceed half the width |
| X axis labels | No closer than 64 px apart ([15-data-visualization.md](15-data-visualization.md) section 6) | Same | Same, first and last label always shown |
| Y axis | Title and labels | Labels only, title in the chart subtitle | Same |
| Brush and zoom | Brush on fine pointers, with range inputs and presets as the alternative | Presets and range inputs only | Same |
| Direct end-of-line labels | Shown when there are 4 series or fewer | Hidden, legend only | Hidden |

Rules:
1. Minimum chart container width is 280 px. A chart never forces horizontal page scroll; below 280 px (320 px viewport minus gutters leaves 296 px) the plot keeps 280 px and nothing else.
2. Small multiples use `grid-cols-[repeat(auto-fill,minmax(280px,1fr))]` ([05-layout-grid.md](05-layout-grid.md)) and therefore become one column below 576 px of container width. Multiples keep a shared y-axis scale when they reflow.
3. "Chart plus side list", "two equal panels" and the detail page layout (8 columns of evidence plus a 4-column right rail, [24-page-templates.md](24-page-templates.md) T3) stack below 1280 px viewport ([05-layout-grid.md](05-layout-grid.md)); the chart or evidence comes first and the rail panels follow in their order.
4. On touch-primary devices, tapping a data point shows the tooltip pinned to the point; tapping elsewhere or the tooltip's close button dismisses it. Tooltips never follow a moving finger.
5. The chart's table view ([15-data-visualization.md](15-data-visualization.md)) is a plain table that scrolls horizontally inside its region at narrow widths.
6. The SEO and AI matrix scatter is shown at 1024 px viewport and up; below 1024 px it is replaced by the quadrant summary and the table ([15-data-visualization.md](15-data-visualization.md) section 8). On touch-primary phones the replacement adds "Open on desktop for the matrix chart".
7. ECharts instances call `resize()` from a `ResizeObserver` on the panel, throttled to one call per animation frame, and never animate the resize ([21-motion.md](21-motion.md)).

## 9. Dialogs, popovers, menus and the command palette

| Component | 640 px and up | Below 640 px |
|---|---|---|
| Dialog (small, medium, large) | Centered, 400 / 560 / 720 px, top edge at 12vh, max height viewport height minus the 12vh top offset minus 48 px ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 4.2), body scrolls | Full-screen sheet: `100vw x 100dvh`, sticky 48 px header with title and close, body scrolls, sticky footer with actions |
| Alert dialog (confirmations) | Centered 400 px | Stays centered: `width: min(400px, 100vw - 32px)` |
| Popover with a list or a form (filter value editors, date range picker, column chooser) | Anchored, 280 to 360 px; the date range picker is the documented exception at 648 px ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.1) | Bottom sheet, max height 85dvh, with a drag handle and a close button |
| Menu (row actions, More menus) | Anchored, 180 to 280 px | Anchored, `max-width: min(280px, 100vw - 24px)`, items 44 px tall when touch-primary |
| Select and combobox lists | Anchored | Anchored; long lists (more than 8 options) open as a bottom sheet with a search field |
| Tooltip | Hover and focus, 400 ms delay | Not used on touch-primary devices; information that matters is in an info button ("toggletip") that opens a popover on tap |
| Command palette | Centered 640 px, max height 480 px | Full-screen sheet with the input in the header |

Footer actions in a full-screen dialog sheet: buttons share the width equally, 44 px tall, primary on the right. Destructive confirmations always use the alert dialog, never a sheet.

## 10. Touch targets

| Element | Desktop (all fine-pointer widths) | Tablet, touch-primary | Mobile layout |
|---|---|---|---|
| Buttons and inputs | 36 px (`h-control`); 32 px (`h-control-sm`) for pagination and small controls in tables and inspectors | 36 px | 44 px for primary actions, sheet footers, filter rows and form fields; 36 px for secondary inline buttons with at least 12 px spacing |
| Icon buttons | 24 px for hover actions inside cells; 32 px (`h-control-sm`) in tables, toolbars, inspectors and elsewhere | 32 px minimum | 44 px in the top bar and sheet headers |
| Table and list rows | 32 px Compact (the default) and embedded tables, 40 px Comfortable | 32 px Compact (the default), 40 px Comfortable | 56 px list rows |
| Navigation items | 32 px sidebar items, 4 px apart; 32 px square icons in the collapsed rail ([11-navigation.md](11-navigation.md) sections 2 and 3) | 40 px in the drawer | 44 px in the drawer |
| Checkboxes and radios | 16 px box in a 24 px target | 24 px target | 44 px row target (the whole option row is the label) |
| Filter chips | 36 px, remove button with a 24 px target | 36 px | Not shown (chips live in the sheet as 44 px rows) |

Rules:
1. All targets meet WCAG 2.5.8 (24 px) at every width. 44 px is the product's touch standard for the mobile layout, not a WCAG requirement, and is never applied to the fine-pointer desktop.
2. Text inputs in the mobile layout use a 16 px font size so iOS Safari does not zoom the page on focus. This needs a new composite utility `type-input-touch` (16 / 24 px, weight 400) in `globals.css`.
3. The 44 px height uses the size token `--size-control-touch` (2.75rem) in `tokens.css`, mapped to `h-control-touch` through `--spacing-control-touch` in `globals.css`.
4. Hit areas grow by padding or a transparent pseudo-element, never by scaling the visible glyph. Adjacent enlarged hit areas must not overlap.

## 11. Features not supported on phones

The mobile layout on a touch-primary device is for monitoring and simple inspection ([05-layout-grid.md](05-layout-grid.md)). These features are not offered there:

| Feature | Where the entry point lives | Message |
|---|---|---|
| Bulk editing (selection, bulk tag, move, archive, set target URL) | Table More menu | "Open on desktop for bulk editing." |
| Column customization (chooser, resize, reorder, pin) | Table More menu | "Open on desktop for column customization." |
| Imports (keyword CSV import, prompt import, mapping and validation preview) | Page More menu and the import tabs (for example SEO > Keywords > Imports, [11-navigation.md](11-navigation.md) section 1.1) | "Open on desktop for keyword import." |
| Matrix drill-down editing (threshold changes, quadrant definitions, reassigning items) | Matrix page More menu | "Open on desktop for matrix editing." |
| Entity and alias editor, panel management, alert rule builder | Settings and page More menus | "Open on desktop for alias editing." (feature named in each case) |

Rules:
1. **Gating condition:** mobile layout (below 768 px) **and** touch-primary. A fine-pointer browser at the same width (zoomed desktop, narrow window) keeps every feature. Tablets (768 px and up) keep every feature.
2. Entry points stay visible in their More menus. Choosing one opens the `DesktopOnlyNotice` in a bottom sheet instead of the feature. Routes that are desktop-only render the same notice as page content.
3. `DesktopOnlyNotice` content: `Info` icon, the message line in `type-body-strong`, one explanatory line in `type-meta` ("This needs a screen at least 768 px wide or a mouse and keyboard."), a "Copy link" button that copies the current URL (with its filters) and confirms with "Link copied", and "Close".
4. Everything else works on phones: viewing every screen, filtering, sorting, saved views (select and save), opening records, reading evidence and citations, acknowledging alerts, single-record actions in the inspector header or its More menu (for example "Check now" for one keyword).
5. A feature is added to this table only through a design-system change. "It does not fit" is not a reason; the mobile layout of that feature is designed instead.

## 12. Container queries

Components that can render in regions of different widths use Tailwind v4 container queries, not viewport breakpoints.

### 12.1 Containers

| Container | Declared on | Name |
|---|---|---|
| Main content | Content region of the page | `@container/main` |
| Inspector body | Inspector scroll container | `@container/inspector` |
| Panel | Every chart panel and bordered panel | `@container/panel` |
| Dialog body | Dialog and sheet body | `@container/dialog` |

A component that needs a container declares its own (`@container`) at its root when it can be placed anywhere; named containers are for components that must respond to a specific region.

### 12.2 Container breakpoints

Tailwind v4 default container sizes are used. `globals.css` must not reset `--container-*`; the named sizes it adds (`prose`, `form`, `dialog-*`) do not collide.

| Variant | Min width | Typical use |
|---|---|---|
| `@xs` | 320 px | Key-value rows switch from stacked to two columns |
| `@sm` | 384 px | Two-up small stats in the inspector |
| `@md` | 448 px | Citation list shows the host column |
| `@lg` | 512 px | Chart legend may sit in the header row for 2 series |
| `@xl` | 576 px | Metric strip 3-column grid; small multiples go to two columns |
| `@2xl` | 672 px | Evidence viewer side panel moves beside the answer |
| `@3xl` | 768 px | Chart legend in the header row; SEO/AI comparison row horizontal |
| `@4xl` | 896 px | Metric strip single row |

Arbitrary container values (`@min-[500px]:`) are not allowed, matching the arbitrary-value rule in [04-spacing-density.md](04-spacing-density.md).

### 12.3 Components that must use container queries

| Component | Narrow (inspector at 400 px) | Wide (page) |
|---|---|---|
| `MetricStrip` | Key-value grid (`size="sm"`, [23-application-patterns.md](23-application-patterns.md) section 2.2) | Single row when the width rule in section 5 is met, otherwise two rows |
| `KeyValueTable` | Label above value below `@xs`; two columns (label 40%) above | Two columns, label 200 px |
| `ChartFrame` | Legend below; inspector charts 180 px | Legend in header; plot height per section 8 |
| `CitationList` | Title and role chip; host on the second line | Host, role, category and `citation_kind` columns |
| `EvidenceViewer` | Entities and citations panel below the answer, collapsed into disclosures | Side panel beside the answer at `@2xl` |
| `SEOAIComparisonRow` | SEO block above AI block | SEO and AI blocks side by side at `@3xl` |
| `SERPPreview` | Title and URL only | Title, URL, snippet |
| `SimpleTable` in panels | Scrolls horizontally inside the panel | Fits |

Example:

```tsx
<section className="@container/panel rounded-lg border bg-surface">
  <header className="flex flex-col gap-2 px-4 pt-4 @3xl/panel:flex-row @3xl/panel:items-center @3xl/panel:justify-between">
    <h3 className="type-section-title">Mention rate by engine</h3>
    <ChartLegend series={series} />
  </header>
  <EChart option={option} ariaDescription={description} height={240} />
</section>
```

`EChart` takes a numeric `height` ([25-component-inventory.md](25-component-inventory.md) section 10.2); the frame passes the height for its context from section 8.

## 13. Testing matrix

### 13.1 Viewports

| Viewport (CSS px) | Class | Pointer | Required checks |
|---|---|---|---|
| 2560 x 1440 | Wide desktop | fine | Inspector docked at its type default (keyword 400, prompt 440), all tiers, no centered narrow content |
| 1920 x 1080 | Wide desktop | fine | Tiers 1 to 4, keyword inspector docked 400, prompt inspector docked 440 |
| 1680 x 1050 | Wide desktop | fine | Tier 4 boundary, prompt inspector docked 440 |
| 1440 x 900 | Desktop (reference) | fine | Visual baseline for every template, inspector docking at both defaults, narrowing of a widened inspector |
| 1280 x 800 | Small desktop | fine | Tier 2 boundary, inspector overlay with expanded sidebar, docked with collapsed |
| 1024 x 768 | Tablet landscape | coarse | Collapsed rail, overlay inspector, Compact density (Comfortable adds the secondary identity line), visible row actions |
| 768 x 1024 | Tablet portrait | coarse | Drawer navigation, date window in the top bar, filter badge |
| 390 x 844 | Mobile | coarse | List rows, filter sheet, inspector sheet, 44 px targets, desktop-only notices |
| 360 x 740 | Mobile (minimum) | coarse | Same as 390, no truncated primary values |
| 320 x 568 | Reflow floor | fine | No horizontal page scroll, all features present, List / Table switch |
| 740 x 360 | Phone landscape | coarse | Short-viewport sticky rule |
| 640 x 400 (1280 x 800 at 200%) | Zoom | fine | Full functionality, sticky stack under 40% of height |

### 13.2 Automated checks (Playwright, every template)

1. `document.scrollingElement.scrollWidth <= clientWidth` at every viewport in 13.1 (no horizontal page scroll).
2. Visible column ids equal the expected tier set for Rank Tracker and Prompt Explorer at 1280, 1440 and 1680.
3. Inspector mode (docked, overlay, sheet) and width match the docking table in section 7.
4. The focused row after keyboard navigation is fully visible below the sticky stack (bounding box check).
5. Touch-primary 390 px: every interactive element in the filter sheet, inspector sheet and list is at least 44 x 44 px, except inline text links.
6. Desktop-only entry points open `DesktopOnlyNotice` on touch-primary 390 px and open the feature on fine-pointer 390 px.
7. Visual baselines at 360, 768, 1280, 1440 and 1920 for the table page, detail page and overview templates in light and dark themes ([26-implementation-guidelines.md](26-implementation-guidelines.md)).

Browsers: Chromium and WebKit for every viewport; Firefox for 1440 and 390. Touch-primary is emulated with Playwright `hasTouch: true` and `isMobile: true`; fine-pointer narrow viewports use a desktop context with a small window.

### 13.3 Manual checks per release

1. A real iPhone (Safari) and a real Android phone (Chrome): filter sheet, list scroll restoration after closing the inspector, input focus without page zoom, rotation.
2. An iPad in both orientations: rail and drawer navigation, overlay inspector, row actions without hover.
3. Desktop Chrome at 200% and 400% zoom on a 1280 px window: every core flow completes.

## 14. Checklist for a new screen

- [ ] Designed at 1440, checked at 1280, 1024, 768 and 390.
- [ ] Every table column has a priority, and the visible set fits each tier boundary.
- [ ] The mobile list row defines its line 1 and line 2 content.
- [ ] Hidden columns are reachable in the inspector.
- [ ] Secondary page actions collapse into More below 1024 px in desktop order.
- [ ] Components used in the inspector respond to container width, not viewport width.
- [ ] Charts have a 280 px minimum and move the legend below at narrow widths.
- [ ] Any feature that is not offered on phones is in the section 11 table and shows the notice.
- [ ] No horizontal page scroll at 320 px.
