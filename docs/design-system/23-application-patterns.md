# 23. Application Patterns

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Depends on: [04-spacing-density.md](04-spacing-density.md), [05-layout-grid.md](05-layout-grid.md), [09-buttons-controls.md](09-buttons-controls.md), [11-navigation.md](11-navigation.md), [12-tables.md](12-tables.md), [13-filters-search.md](13-filters-search.md), [14-badges-status.md](14-badges-status.md), [15-data-visualization.md](15-data-visualization.md), [22-content-formatting.md](22-content-formatting.md). Product sources: [20-frontend-specification.md](../20-frontend-specification.md) sections 4 to 6, [15-seo-ai-correlation.md](../15-seo-ai-correlation.md), [16-metrics-methodology.md](../16-metrics-methodology.md), [09-rank-tracking-methodology.md](../09-rank-tracking-methodology.md), [27-cost-model.md](../27-cost-model.md) section 10.
Screens that use these patterns: [24-page-templates.md](24-page-templates.md).

A pattern is a fixed arrangement of components for a recurring job: summarizing a scope, inspecting a record, reading an AI answer, comparing two things, triaging candidates. Components (buttons, cells, badges, charts) are specified in documents 09 to 22. This document decides how they combine, so two screens that do the same job look and behave the same (P3, P10 in [00-design-principles.md](00-design-principles.md)).

Sample values in this document use the Northwind CRM demo project: 1,000 tracked keywords, 250 core prompts, three engines (ChatGPT, Gemini, AI Mode) plus AI Overview from SERP checks.

## 1. Progressive disclosure

### 1.1 The four levels

Every piece of information is assigned to the level where it **first** appears. Higher levels repeat the identity and headline values for orientation; they never hide something that a lower level showed.

| Level | Surface | Trigger | Budget | Holds |
|---|---|---|---|---|
| L1 Scan | `DataTable` row (40 px; 32 px in Compact density), `MetricStrip` item, list row | Always visible | One line per row in Compact density; at most 3 badges per row; no text below 12 px | Identity, the one or two values a user sorts by, change, freshness. Enough to decide whether to look closer |
| L2 Hover | `Tooltip` (max 320 px) on hover and keyboard focus, 400 ms delay | Pointer rest or cell focus | Text, numbers and at most one mini table (7 rows). No actions except the cell action menu (Enter on a focused cell), no charts | Exact values, denominators, intervals, dates, full text of truncated values, source labels |
| L3 Inspect | Right `Inspector` (400 px; 440 px for prompt, citation and answer evidence, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.2) | Row click, Enter on a row, chart point click | Header plus `MetricStrip` (sm), at most 5 tabs, at most one chart per tab (180 px), lists capped at 10 rows with "View all" | Everything needed to answer "what is going on with this record" without leaving the list |
| L4 Study | Full page (T3 detail template, [24-page-templates.md](24-page-templates.md)) | "Open page" in the inspector header, Cmd/Ctrl+click, direct URL | No budget beyond the page template | Full history, compare modes, snapshots, editing workflows, diagnostics |

Rules:
1. **Tooltips are never the only path.** Everything in an L2 tooltip is also in the L3 inspector. Tooltips open on keyboard focus as well as hover and follow WCAG 1.4.13 ([08-interaction-states.md](08-interaction-states.md) section 3).
2. **The inspector never requires the full page** for the question the list answers. If a user opens the full page from the inspector for more than 20% of records in a usability session, content moves from L4 to L3.
3. **Values do not change meaning across levels.** The rank in the row, the tooltip, the inspector and the page come from the same API field and the same formatter.
4. **L1 carries the denominator only when it fits.** Rates in Compact density rows (32 px) show the value; `k of n` appears as a second line in Default density (40 px), in the tooltip, and always in the inspector ([12-tables.md](12-tables.md) section 6, `MetricCell`).
5. **Links go up one level at a time.** A row opens L3; L3 offers "Open page" (L4). A row never jumps straight to L4 on a plain click.

### 1.2 Assignment by object type

| Object | L1 Scan (row) | L2 Hover (tooltip) | L3 Inspect (inspector) | L4 Study (full page) |
|---|---|---|---|---|
| **Keyword** (tracked keyword) | Keyword text, rank, rank change, ranking URL path, volume, intent, SERP feature icons, AI Overview status, top competitor rank, 30-check sparkline, updated | Location, device, depth and check time; previous rank and normal movement (up to 2 positions); full ranking URL; volume source and month; last 7 ranks; AI Overview position and source count; feature names | Rank strip (current, best, average with `n_ranked of n_checks`, volatility); 30-day rank chart with depth band; target vs ranking URL; latest SERP features; competitor ranks (top 5); latest AI Overview; related prompts (top 3 with per-engine mention rate); last 10 events; actions | Keyword Detail: full history with deep checks, SERP snapshots and compare, feature strip, AI Overview history, related prompts with intervals, GSC panel, demand history, diagnostics |
| **Prompt** | Prompt text (one line), topic, per-engine mention rate, mention rate (equal-weight, labeled), citation rate, top competitor, trend, updated | Full prompt text; `k of n` and interval per engine; prompt type, panel, version; last observed per engine | Per-engine rate table (mention, citation, recommendation with `k of n`); latest answer (`ResponsePreview`); observation history (last 12); entities mentioned with counts; top 5 cited domains; competitors; related keywords with rank; confidence and sample | Prompt Detail: trends with CI bands, all answers with evidence and compare, citations, competitor gap (A14), recommendation and sentiment (A5, A6, A13), volatility, fan-out, versions, statistics |
| **Observation** (one answer) | Engine, date, replicate, validity status, mentioned, cited, recommended (icon plus word), structured rank, citation count | Invalid reason, reported model, run, collection time | Evidence viewer (section 5): answer with mention highlights, entity toggles, `CitationList`, facts footer | Prompt Detail, Answers tab with `obs=<id>`: compare with another observation, raw payload (`raw:read`) |
| **Domain** (cited registrable domain) | Domain with favicon, role, category, citation units (C2), source share (C1), change, observations, prompts, per-engine share, new or lost badge, trend | Full host, category source (default or override), first and last seen, `min_support`, per-engine counts | Share trend (180 px, per engine); top 10 cited pages; top 10 prompts citing it; entities co-mentioned when it is cited; SEO SOV of the domain on project keywords; category override action | Citations, Pages tab filtered to the domain (`domain=<domainId>`); publisher opportunity row when present. No dedicated domain page in V1 |
| **Page** (owned URL) | Path, keywords ranking, average rank, top 10 count, AI Overview citations, citation units per engine, GSC clicks | Full URL and title; average rank with `n`; definition of a citation unit; GSC date range | Channel strip (SEO, AI Overview, ChatGPT, Gemini, AI Mode, GSC); top 10 keywords ranking with this URL; top 10 prompts citing it; retrieved not cited (ChatGPT) | Page Intelligence: weekly trends per channel, full keyword and prompt tables, associated mentions, first-party metrics |
| **Competitor** (tracked entity) | Name with color swatch, primary domain, SEO SOV, visibility, average rank, AI SOV per engine, mention rate, recommendation rate, citation share | All domains, date added (SOV boundary), alias count | Side-by-side strip vs own brand; keyword gap counts; AI gap per engine with interval (A14); top 5 sources co-occurring with its mentions; "Ahead in both channels" count | Competitors, Comparison tab with this competitor selected: topic matrix, keyword list, source overlap (C7) |
| **Run / collection** | Workload, trigger, status, window, progress (`412 of 1,000 checks`), estimated vs actual cost, started, finished | Error kinds with counts, queue, provider | Task status breakdown, top 5 errors, cost, affected projects, freshness impact, actions (Retry failed, Cancel) | Operations, Run detail: virtualized task table with filters |
| **Cost line** (provider, workload or project row) | Name, requests, units, cost (USD), share of month, change vs last month (neutral) | Unit price, cost source (provider reported, computed from tokens, price book estimate), billing period | Daily spend chart (180 px); endpoint breakdown; top 10 subjects by cost; budget group and status | Costs page filtered to the line (`provider=`, `project=`, `workload=`); raw cost events export |

### 1.3 Moving information between levels

- Promote to a lower level (more visible) only when a user needs the value to **decide** which row to open. "Ranking URL" is L1 on Rankings because users scan for URL changes; "KD" is in the column chooser, not the default set.
- Demote when a value is only needed after the record is chosen. Search volume history is L4 because nobody chooses a keyword by its seasonality curve.
- A new column added to a default view needs a reason in the pull request that names the decision it supports. The review checklist ([27-design-review-checklist.md](27-design-review-checklist.md)) asks for it.

## 2. Summary metrics: MetricStrip

The `MetricStrip` is the only summary pattern for a scope (a page, a filtered table, an inspected record). It replaces KPI card grids ([00-design-principles.md](00-design-principles.md) section 3).

### 2.1 Anatomy

```text
+------------------------+------------------------+------------------------+------------------------+------------------------+
| SEO visibility (i)     | Top 10                 | AIO citation rate      | Mention rate ChatGPT   | Mention rate Gemini    |
| 31.4%  +1.2 pts  vol...| 301  +14  of 986 ...   | 38.2%  +0.4 pts  157...| 34%  +2.1 pts  612 ... | 29%  −0.8 pts  402 ... |
+------------------------+------------------------+------------------------+------------------------+------------------------+
```

The strip is one panel. Vertical bars are full-height dividers. Each cell has a label row and a value row; the context (denominator or variant) follows the delta on the value row and truncates first when a cell is narrow ("..." in the sketch). The full context is in the value tooltip.

| Part | Spec |
|---|---|
| Frame | One panel: `surface`, 1 px `border`, `rounded-lg` (8 px), no shadow ([06-surfaces-borders-radius.md](06-surfaces-borders-radius.md)). It is one panel, never a row of cards |
| Label row | `type-meta` (13 / 20 px, tertiary). Label comes from the metric registry (`lib/metrics/definitions.ts`), short form allowed. Optional `MetricInfo` trigger: `IconButton` `icon-xs` (24 px target, 14 px `Info` icon, `foreground-tertiary`) 4 px after the label |
| Value row | Value in `type-metric` (24 / 32 px, 600, tracking -0.02em, `num`), `foreground`. `Delta` (or `RankDelta`) inline 8 px to the right on the same baseline in `type-body-strong num`. Optional sparkline (64 x 20 px, [15-data-visualization.md](15-data-visualization.md) section 9) 12 px after the delta, only on Overview |
| Context | `type-meta` 12 px after the delta on the value baseline: the denominator or sample (`SampleCount`, section 8.3), or the variant ("volume-weighted"). At most one middle dot. Truncates with a tooltip; the value and delta never truncate |
| Divider | Full-height 1 px `border-subtle` between cells, edge to edge of the panel ([06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) section 5) |
| Group divider | Between channel groups (SEO items, then AI items): 1 px `border` instead of `border-subtle`, same size. No group heading: the labels name the channel ("SEO visibility", "Mention rate ChatGPT") |

### 2.2 Dimensions and layout

| Property | `size="md"` (pages, including detail pages) | `size="sm"` (inspector) |
|---|---|---|
| Form | One panel with cells in a row | Key-value grid: bordered cells, 1 px `border-subtle` between cells and around the grid, `rounded-lg` (8 px) outside |
| Height | 76 px (`h-metric-strip`): 12 px padding top and bottom, rows 20 + 32; 96 px when context lines are shown (rows 20 + 32 + 20) | 64 px per grid row: 12 px padding top and bottom, rows 16 + 24; 84 px when a context line (20) is shown |
| Cell padding | 20 px left and right | 12 px on all sides |
| Label | `type-meta` | `type-label` (12 / 16 px, tertiary) |
| Value | `type-metric` (24 / 32 px) with the delta inline; context line in `type-meta` on its own line below the value, truncating with a tooltip only when it exceeds the cell | `type-metric-sm` (18 / 24 px) with the delta inline; context line in `type-meta` below the value |
| Item width | Cells share the panel width equally, minimum 140 px; labels truncate with a tooltip, values never do | 3 items: 3 columns; 4 items: 2 columns |
| Item count | 3 to 6 | 3 to 4 |
| Background | `surface` (the panel) | `surface` |
| Separation from next region | 16 px gap, the gap between page blocks ([05-layout-grid.md](05-layout-grid.md)) | 16 px below, inside the first inspector section |

Cells stretch to fill the panel, so the dividers run at equal intervals and the panel has no empty tail. On very wide screens the values stay left-aligned inside their cells.

**Clickable items.** An item may link to the view that lists its members (Top 10 opens Rankings filtered to `rank=top10`). The whole cell is then a link: hover `surface-hover` on the cell, focus ring inset (`focus-ring-inset`), no underline, no chevron. Items without a destination are not focusable.

### 2.3 Wrapping

| Condition | Behavior |
|---|---|
| Container width at least `n x 140 + (n - 1)` px (`md`) | One row. A 6-item strip needs 845 px |
| Narrower (for example 6 items with the inspector docked on a small screen) | Two rows with `ceil(n / 2)` cells in the first row, separated by a 1 px `border-subtle` line; height becomes 153 px (76 + 1 + 76) |
| `sm` in the inspector | Always the grid of section 2.2; a 4-item grid in the 400 px inspector gives two cells of 180 px per row (360 px content width) |
| Viewport below 768 px | Two-column grid inside the panel, dividers between cells kept, 76 px cells (96 px with context lines) ([19-responsive-behavior.md](19-responsive-behavior.md) section 5) |

Items never reorder, truncate their value, or hide when wrapping. A strip that would need three rows has too many items: split the scope or drop metrics.

### 2.4 Item states

| State | Display |
|---|---|
| Loading | Real label kept; skeleton bars for value (24 x 64 px in `md`, 18 x 56 px in `sm`) and context (10 x 120 px) at final positions; no delta skeleton ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.2) |
| Refetching | Previous values stay at full opacity (no dimming) with `aria-busy="true"`; the static 2 px `RefetchBar` marks the region ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.4) |
| Insufficient data | Value "Insufficient data" in `type-body` `foreground-tertiary` with the hatching of [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8 behind the value only; context line keeps the counts ("3 valid obs, 4 needed"). Cells use the short "Insufficient" (section 8.4) |
| Not applicable | `NotApplicable` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8): value "No AI Overview in window" in `foreground-tertiary`; context gives the presence rate ("present in 0 of 28 checks"). `n/a` is kept for a value that does not exist for the scope (engine not in scope, not tracked) |
| Not yet collected | Value "First check scheduled for Sep 30, 02:00 CEST" in `foreground-tertiary` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8); `Pending` is the cell form only |
| Estimate | `Estimate` neutral outline badge after the label ([14-badges-status.md](14-badges-status.md) section 2) |
| Stale or collection issue | 14 px `TriangleAlert` in `warning-text` after the label, tooltip links to the run |
| Version boundary in window | 12 px boundary glyph in `foreground-muted` in the context line with count; tooltip lists component, from, to, date |
| No comparison | Delta omitted, not replaced by `0` |

### 2.5 When a MetricCard is justified

`MetricCard` is a bordered `surface` panel (8 px radius, 16 px padding) with label, `type-metric` (24 / 32 px) value, delta, context line and an optional 180 px chart. It is allowed in exactly two places:

1. **Single-metric focus on a detail page header**: when one metric is the reason the page exists (Page Intelligence shows the owned URL's channel values; a statistics panel shows one rate). At most 4 cards in one row, each for a different channel, never repeating what the strip shows.
2. **Quadrant summary**: `QuadrantSummary` on the Matrix and Overview is a 2 x 2 grid of cards because the information is spatial ([15-data-visualization.md](15-data-visualization.md) section 8).

Everything else uses the strip.

### 2.6 Anti-patterns

| Anti-pattern | Why it fails | Use instead |
|---|---|---|
| Six large KPI cards in a row, each 120 px tall with an icon | Spends 3 to 4 times the height for the same six numbers; icons add no information | `MetricStrip` (one 76 px panel) |
| Cards with colored backgrounds or colored values | Color claims a judgment the data may not support (P2) | Neutral values; `Delta` carries tone when detectable |
| A value without its denominator | Violates P5; "34%" of what? | Context line with `SampleCount` |
| Pooled AI value across engines as a headline | Hides per-engine differences ([20-frontend-specification.md](../20-frontend-specification.md) section 1, principle 5) | One item per engine, or an item labeled "Equal-weight average (3 engines)" next to per-engine items |
| Count-up animation on load | Motion without state change (P8) | Values render final |
| Strip plus cards repeating the same metrics | Redundant; two places to read one number | One strip |
| More than 6 items | Stops being scannable; wraps on common widths | Split by channel or move to a table |
| Deltas with arrows on rates | Arrows are for ranks only ([14-badges-status.md](14-badges-status.md) section 5) | Signed points (`+2.1 pts`) |

### 2.7 Accessibility

The strip is a `dl`: each item is a `div` wrapping `dt` (label) and `dd` (value, delta, context). The delta's accessible text comes from the formatter ("up 2.1 percentage points, within normal variation"). A clickable item is an `a` inside the `dd` whose name combines label and value ("Top 10: 301, open keywords").

## 3. Page header: PageHeader

### 3.1 Anatomy

```text
| Keywords  [View: Default (edited) v]                                       [Import] [Export] [...] [Add keywords]  |
| Updated 12m ago · 1,000 tracked keywords                                                                           |
|                                                                                                                    |
| Inventory    Groups    Metrics history    Imports                                                                  |
+--------------------------------------------------------------------------------------------------------------------+
|                                                                                                                    |
| [vs previous v] [Desktop v] [Topic: CRM x] [+ Filter]                                                              |
```

The line under the tabs is the tab row's 1 px `border` bottom edge. The page header itself has no border: the blocks below it follow at the 16 px page block gap.

The breadcrumb (`House` icon for the project root, then Workspace, Project and the page) is in the top bar, not in the page header, and so are the project-wide date range and location controls ([11-navigation.md](11-navigation.md) section 4). The page header starts with the title; its filter bar holds only screen-specific scope and filters ([13-filters-search.md](13-filters-search.md) section 1).

| Region | Component | Spec |
|---|---|---|
| Container | `PageHeader` | `background`, 20 px horizontal padding (page gutter), 20 px from the top bar to the title, no border, no background of its own |
| Title | `h1` in `type-page-title` (24 / 32 px, 600, tracking -0.015em) | Never truncates; wraps to 2 lines at most. Detail pages use the object name (keyword text, prompt text in quotes, URL path) |
| View menu | `SavedViewMenu` ([12-tables.md](12-tables.md) section 11) | 32 px `secondary` `sm` button 12 px right of the title, on T2, T6, Matrix and Competitors only |
| Meta line | `type-meta` (13 / 20 px, tertiary) 4 px under the title | `FreshnessIndicator` first, then one scope fact ("1,000 tracked keywords"). At most two middle dots. Detail pages add the object facts ("US · desktop · depth 20") |
| Actions | `Button` `md` (36 px) | Right-aligned, vertically centered on the title block. At most 1 `primary` + 2 `secondary` visible + a "More actions" `IconButton` (`icon`, 36 px, `Ellipsis`) holding the rest, including "Copy link". Order: secondary, secondary, More, primary (primary rightmost, [09-buttons-controls.md](09-buttons-controls.md) section 2.6) |
| Local tabs | `Tabs` `variant="underline"` or `TabNav` when tabs are routes | 44 px row (`h-tab`), 8 px below the title block; 14 px labels 24 px apart; active label `primary-text` 500 with a 2 px `primary` underline; 1 px `border` along the bottom of the row. At most 6 tabs, nouns of 1 to 2 words, counts only on inboxes ([11-navigation.md](11-navigation.md) section 6) |
| Filter bar | `FilterBar` ([13-filters-search.md](13-filters-search.md)) | 36 px controls, 16 px below the tabs or the title block; on pages with a metric strip, 16 px below the strip (the strip sits between the title block and the filter bar, [reference/visual-spec.md](reference/visual-spec.md) section 4). Result count in `type-meta`: in the table toolbar on table pages ([12-tables.md](12-tables.md) section 1), right-aligned in the filter bar on T1 |

### 3.2 Height budget

Data (a metric strip, chart or table) starts within **200 px** below the 52 px top bar when a page has tabs and a filter bar, and at about **130 px** otherwise (92 to 144 px), in the default state of every page (P1, [reference/visual-spec.md](reference/visual-spec.md) section 6). The numbers below are measured from the bottom edge of the top bar to the first data block. The date range and location add no height: they are in the top bar.

| Header composition | Calculation | Data starts at |
|---|---|---|
| Title block only (settings, and every page whose first block is the metric strip) | 20 + 56 (title 32 + 4 + meta 20) + 16 | 92 px |
| Title block and filter bar (no strip) | 20 + 56 + 16 + 36 + 16 | 144 px |
| Title block, tabs and filter bar | 20 + 56 + 8 + 44 + 16 + 36 + 16 | 196 px |
| Detail page (`DetailPageHeader`): back link line above the title | 20 (`type-meta` line) + 4 gap added to the rows above | 116 px, or 168 px with a filter bar |
| Each additional line of wrapped filter chips | 8 + 36 | +44 px |

A page whose default state exceeds 200 px fails review. Chips a user adds may wrap past the budget; that height is the user's choice. The mobile header is specified in [19-responsive-behavior.md](19-responsive-behavior.md).

### 3.3 Sticky behavior

| Page type | Header behavior |
|---|---|
| T2 Data table, T6 Discovery | The whole header stack (title, tabs, metric strip, filter bar) stays in place because the table body is the scroll container. The table header sticks under it |
| T1 Overview, T3 Detail | Header scrolls away with the page. Only the top bar sticks. Filters are reachable by scrolling up, with Tab, or with the "+ Filter" button (`f` opens "+ Filter" on table pages only, [20-accessibility.md](20-accessibility.md) section 14) |
| T4 Settings, T5 Integration | Header scrolls with the page; the settings local navigation is sticky; the save bar sticks to the bottom of the form column when the form is dirty |
| Inspector | Its own header (section 4.1) sticks inside the inspector scroll |

### 3.4 What never goes in the page header

KPI values (they go in the strip below), help paragraphs (use `MetricInfo` or an empty state), more than one primary, destructive actions (they live in "More actions" below a separator or in settings), per-row actions, and a second filter row.

## 4. Inspector content patterns

The inspector frame (docking, width 400 px default and 440 px for prompt, citation and answer evidence, 360 to 640 px, overlay rules) is defined in [05-layout-grid.md](05-layout-grid.md) section 6 and [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2. This section defines what goes inside it.

### 4.1 Shared anatomy

```text
| best crm for startups                    [^] [v] [...] [⤢] [x] |
| [US · Desktop] [Depth 20]                                      |
| Keyword · 12 of 986 · Updated 12m ago              [Check now] |
| Overview     SERP     AI     Timeline                          |
+================================================================+
| +---------------------------+---------------------------+      |
| | Rank                      | Best rank                 |      |
| | 3  ↑5                     | 2                         |      |
| +---------------------------+---------------------------+      |
| | Average rank              | Volume                    |      |
| | 4.6                       | 8,100                     |      |
| | 28 of 28 checks           |                           |      |
| +---------------------------+---------------------------+      |
|                                                                |
| Rank history, 30 days                                   (i)    |
| (chart 180 px, depth band)                                     |
+----------------------------------------------------------------+
| Ranking URL                                                    |
| /blog/best-crm-startups       Target: /pricing   Mismatch      |
+----------------------------------------------------------------+
| Competitor ranks                              View all 8       |
| HubSpot     1   ↑1                                             |
| Pipedrive   5   ↓2                                             |
```

`[⤢]` is the expand button ("Open page"). The double line is the bottom edge of the tab row.

| Part | Spec |
|---|---|
| Frame | A floating card under the top bar: `background` fill, 1 px `border`, radius 10 px, `shadow-inspector`, 12 px from the top bar and the window edges, 16 px padding ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2) |
| Header | `InspectorHeader`, sticky, anatomy per [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1. Row 1: object name as `h2` in `type-inspector-title` (18 / 26 px, 600), clamped to 2 lines (when clamped, the full text is the first line of the first section); at the top right, 32 px `IconButton`s (`icon-sm`): Previous record (`ChevronUp`, `k`), Next record (`ChevronDown`, `j`), More actions, Expand ("Open page", `Maximize2`, tooltip "Open page"), Close (`X`, Escape). Row 2: status badges (at most 4), 8 px below the title. Row 3: object type, position counter ("12 of 986") and `FreshnessIndicator` in `type-meta`, with the object's most frequent command right-aligned as a 32 px `secondary` `sm` button when it has one (keyword "Check now", prompt "Run now") |
| Summary | 3 metric cards in a row (label, value in `type-metric-sm`, then a delta or context line), the first row of the Overview tab ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.4). A fourth value goes into a card's note line |
| Tabs | `Tabs` `variant="underline"` at the bottom of the header: 44 px row, 14 px labels 24 px apart, active label `primary-text` 500 with a 2 px `primary` underline, 1 px `border` along the bottom. At most 5 tabs, labels of 1 to 2 words, first tab "Overview" ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.3). Omitted when the object has one section group |
| Section | `InspectorSection`: a `surface` card (1 px `border`, radius 8 px) with a 48 px header (16 px icon, `type-subsection-title` title, at most one control at the right: "View all", a `Select` or a badge) and its content; cards are 12 px apart and never nested ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.4) |
| Lists | `SimpleTable` (32 px rows, section 4.4) capped at 10 rows |
| Chart | `ChartFrame` without border (inspector variant), 180 px, one per tab |
| Footer | Edit mode only ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.5): sticky bottom, "Cancel" and "Save", at most one `primary`. The one exception is the triage footer of the Discover evidence panel (Reject, Snooze, Accept; section 10). Object commands (Check now, Open page) never go in a footer |

Keyboard: `j` and `k` move to the next and previous row of the underlying table and update the inspector in place (single-key policy, [12-tables.md](12-tables.md) section 9). Escape closes and returns focus to the row. The inspector is a `complementary` landmark named by the object ("Keyword: best crm for startups").

### 4.2 Content per object type

| Object | Header meta | Strip (sm) | Tabs | Sections by tab |
|---|---|---|---|---|
| **Keyword** | Location · device · depth; freshness | Rank with `RankDelta`, Best rank, Average rank (`n_ranked of n_checks`), Volume | Overview, SERP, AI, Timeline | **Overview**: rank history chart; ranking URL vs target; competitor ranks (top 5); tags and group. **SERP**: latest SERP features (`SERPFeatureList` expanded with labels); top 10 results of the latest check (position, host, role). **AI**: `SEOAIStatus` inline (section 7); AI Overview last 10 checks; related prompts (top 3) with per-engine mention rate and `k of n`. **Timeline**: `EventTimeline`, latest 10 events, then "Open full timeline" ([18-notifications-alerts.md](18-notifications-alerts.md) section 7) |
| **Prompt** (440 px) | Topic · type · panel · version; freshness | Mention rate per engine (3 items) plus Citation rate (equal-weight, labeled) | Latest, History, Citations, Competitors, Stats | **Latest**: `ResponsePreview` per engine (latest valid observation), "Open evidence" per engine. **History**: observations table (last 10, at most 4 columns: date and engine, mentioned, cited, recommended; replicate in the tooltip); per-engine trend chart with CI band; `EventTimeline`, latest 10 events, then "Open full timeline" (prompt event links use `itab=history`, [18-notifications-alerts.md](18-notifications-alerts.md) section 10). **Citations**: top 5 domains and top 5 pages with counts. **Competitors**: mention and recommendation per entity per engine; related keywords with rank and AI Overview status. **Stats**: confidence and sample per engine (section 8), link to statistics panel |
| **Domain** (`domain`, registrable domain) | Category · role; freshness | Citation units, Source share, Observations, Prompts | Overview, Pages, Prompts | **Overview**: share trend per engine; per-engine breakdown table; entities co-mentioned when cited; SEO SOV of the domain on project keywords. **Pages**: top 10 cited pages. **Prompts**: top 10 prompts citing the domain with engine |
| **Page** (owned URL) | Title (escaped) · host; freshness | Keywords ranking, Average rank, AIO citations, GSC clicks (labeled GSC) | SEO, AI, First-party | **SEO**: keywords ranking with this URL (top 10: keyword, rank, change); target coverage. **AI**: citation units per engine; prompts citing (top 10); retrieved not cited (ChatGPT). **First-party**: GSC clicks, impressions, average position (labeled); GA4 AI referral sessions with both classifiers side by side |
| **Competitor** | Primary domain · added date | SEO SOV (them vs us), Visibility, AI SOV ChatGPT, AI SOV Gemini | Overview, Keywords, Sources | **Overview**: side-by-side table (metric, them, us, gap) per channel; AI gap per engine with interval (A14). **Keywords**: gap counts (they lead, we lead, only they rank, only we rank); top 10 keywords where they are ahead in both channels. **Sources**: top 5 domains co-occurring with their mentions; source overlap (C7) |
| **Source** (`source`, cited URL, third-party or own) | Host · category; first seen, last seen | Citation units, Observations, Prompts, Engines | Overview, Prompts, Answers | **Overview**: title (escaped), host, citation trend; engines citing it. **Prompts**: prompts citing it with engine. **Answers**: last 10 observations citing it, each opening the evidence viewer with the citation marker focused |

### 4.3 Inspector or full page

| Use the inspector when | Use a full page when |
|---|---|
| The user came from a list and will return to it (triage, scanning losses) | The object is the destination (shared link to a keyword, a report reference) |
| The content fits the L3 budget | The job needs compare modes, long history, editing with validation, or more than 5 sections |
| Width of 360 to 640 px is enough | The content needs 1,000 px or more (SERP snapshot compare, answer compare, small multiples of 3 engines) |

Examples:

| Object | Inspector (L3) | Full page (L4) |
|---|---|---|
| Keyword | From Rankings, Matrix, Topic and Page tables | `/seo/keywords/[tkId]` from "Open page", alerts and shared links |
| Prompt | From Prompts, Citations (Prompts tab), Competitors | `/ai/prompts/[promptId]` |
| Observation | Inside the prompt inspector (Latest, History tabs) | Prompt Detail, Answers tab (`obs=`); compare only here |
| Domain | From Citations and Sources tables | None in V1; drill-down is the Pages tab filtered to the domain |
| Page | From Pages and keyword inspector links | `/seo/pages/[urlId]` Page Intelligence |
| Competitor | From Competitors tables and Overview | Competitors, Comparison tab with the competitor selected |
| Run | From Operations runs and `CollectionProgress` | Operations run detail |
| Alert event | The inspector of the event's entity, with the event highlighted in its Timeline tab ([18-notifications-alerts.md](18-notifications-alerts.md) section 6) | None |

### 4.4 Inspector visuals

The parts that appear inside inspector sections, as the reference screens show them ([reference/visual-spec.md](reference/visual-spec.md) section 5).

```text
| AI Overview                               [✓ Cited · source 2 of 5] |
| +-----------------------------------------------------------------+ |
| | "Northwind is a popular CRM for startups, offering a clean      | |
| | interface and fast setup..."                                    | |
| +-----------------------------------------------------------------+ |
| [techradar.com] [forbes.com] [nerdwallet.com] [+2]                  |
|                                                                     |
| Top 5 results                                                       |
| #   Domain            Title                                         |
| 1   hubspot.com       The best CRM software in 2026                 |
| 3   northwind.com     Northwind: CRM for startups          (own row) |
```

| Part | Spec |
|---|---|
| Key-value grid | `MetricStrip` `size="sm"` (section 2.2): 1 px `border-subtle` between cells and around the grid, `rounded-lg` (8 px) outside, 12 px cell padding, label (`type-label`) above value (`type-metric-sm`). Text values such as a ranking URL use `type-body` in `link` color |
| Mini table | `SimpleTable` ([25-component-inventory.md](25-component-inventory.md) section 7.11): 32 px rows (`h-row-compact`), header labels in `type-label` without a header fill, `border-subtle` row dividers, numbers right-aligned `num`. The own row (own domain, own brand) is `surface-selected` with its key text in `primary-text` |
| `QuoteBox` | An excerpt of collected text (AI Overview, answer snippet): `surface-subtle` fill, 1 px `border-subtle`, `rounded-md` (6 px), 12 px padding, `type-table` (13 / 20 px) in typographic quotes, clamped to 4 lines with an ellipsis. Escaped text only (section 5.6). A positive "Cited · source 2 of 5" badge with a check icon sits right-aligned on the section title row when the own domain is cited |
| `DomainChip` | Cited sources under a quote or answer: neutral badge style (22 px, `neutral-subtle`, `neutral-text`, `rounded-sm`, 8 px horizontal padding), registrable domain as text, 8 px apart. At most 3 chips, then a "+2" overflow chip in the same style that opens the full list. Each chip is a link to the domain inspector |

## 5. Evidence viewer

The evidence viewer shows one AI answer with every extracted fact traceable to its text. Product rules are in [20-frontend-specification.md](../20-frontend-specification.md) section 4.9; this section restates them as design-system components.

### 5.1 Components

| Component | Role |
|---|---|
| `ResponsePreview` | Compact summary of one observation for lists and the inspector "Latest" tab: header line, first 6 lines of `EvidenceText` with highlights (line-clamped with an ellipsis, no fade), mention summary, citation count, "Open evidence" link |
| `EvidenceText` | The answer body rendered from extractor blocks (`h3`, `p`, `li`, table rows) as React elements only, with `EvidenceHighlight` marks and `CitationMarker` buttons |
| `EvidenceHighlight` | `<mark>` for one entity mention span |
| `CitationMarker` | Inline citation button `[n]` linked to the `CitationList` item |
| `EntityToggleList` | Checkbox list of entities found in the answer, each with color swatch and span count; toggles highlights per entity |
| `CitationList` | Ordered list of the answer's citations |
| `FactsFooter` | Extracted facts and derivation versions for this observation |
| `AnswerViewMode` | `SegmentedControl` `sm`: Evidence (default), Formatted, Raw. Raw shows only with `raw:read` |

### 5.2 Layout

In the inspector (440 px), everything stacks:

```text
| ChatGPT · Sep 22, 01:14 CEST · replicate 2 of 3 · Valid          |
| Prompt v3: "What is the best CRM for a 20-person startup?"       |
| [Evidence] [Formatted] [Raw]                                     |
+------------------------------------------------------------------+
| Entities   [x] Northwind (own) 3  [x] HubSpot 2  [x] Pipedrive 1 |
+------------------------------------------------------------------+
| Top options                                                      |
| 1. {Northwind} is a solid pick for small teams because... [1]    |
| 2. {HubSpot} offers a free tier with... [2][3]                   |
| 3. {Pipedrive} focuses on pipeline management... [4]             |
+------------------------------------------------------------------+
| Citations (4)                                                    |
| 1  northwind.com/pricing        Own        Vendor site           |
| 2  g2.com/categories/crm        Third party Review site          |
| 5  Ad: sponsored listing        Excluded from metrics            |
+------------------------------------------------------------------+
| Mentioned   Yes           Cited        Yes                       |
| Recommended Yes (0.85)    Structured   1 of 3                    |
| Extractor   v4            Entity cfg   v12                       |
```

Curly braces mark highlighted mentions in these sketches; `[n]` is a citation marker.

On the Prompt Detail Answers tab, the text takes `minmax(0, 1fr)` and a 360 px side column holds `EntityToggleList` and `CitationList` ("chart plus side list" layout, [05-layout-grid.md](05-layout-grid.md) section 3). `FactsFooter` spans the full width below.

| Part | Spec |
|---|---|
| Header line | `EngineBadge`, collection time (`formatDetailDateTime`), replicate, validity `StatusBadge` (`Valid`, or `Invalid` with reason, which greys the text and states "Excluded from metrics") |
| Prompt line | Prompt version and text in `type-body` `foreground-secondary`, in typographic quotes |
| Answer body | `type-prose` (14 / 22 px), max 720 px line length on the full page; `lang` from the prompt's `language_code` |
| Mode switch | `AnswerViewMode`; the selected mode is not persisted in the URL (Evidence is always the landing mode) |

### 5.3 Mention highlights

| Property | Spec |
|---|---|
| Color source | `project_entities.color_index` (1 to 6) mapped to `--chart-{n}`; own brand always `chart-1` ([02-color-system.md](02-color-system.md) section 8). The own brand's highlight uses the accent tints instead (next row) |
| Own brand | `primary-subtle` background behind `primary-text` at weight 500, `rounded-xs` (3 px), padding 0 2 px, no left border. It is the only highlight with colored text |
| Background (competitors and other entities) | Entity color at 18% (`--entity-{n}-highlight`, defined once in `tokens.css` per theme as `color-mix(in oklch, var(--chart-{n}) 18%, transparent)`) |
| Left border | 2 px solid `--chart-{n}`; `box-decoration-break: clone` so each wrapped line fragment keeps the border |
| Text (competitors and other entities) | `foreground` (never the entity color); padding 0 2 px; no radius |
| Uncertain span | No background; 2 px **dashed** left border in the entity color; tooltip "Uncertain match, excluded from rates" |
| Product mention | Same as the parent entity; tooltip "HubSpot via Sales Hub" |
| Hover and focus label | Tooltip: entity, match type, confidence ("Northwind · word boundary match · confidence 0.95") |
| Accessible name | `aria-label` on the mark with the same text; marks are not focusable individually, the tooltip text is also in the entity list |
| Hidden entity | Toggled off in `EntityToggleList`: plain text, no mark |
| Entities beyond 6 | Share `chart-other` (dashed border) with the entity name in the label; the entity list shows them all |

### 5.4 Citation markers and CitationList

| Element | Spec |
|---|---|
| `CitationMarker` | Inline `[n]` in `type-micro`, `primary-text` on `primary-subtle`, `rounded-xs` (3 px), padding 0 2 px, a `button`. Inline targets in text are exempt from the 24 px minimum (WCAG 2.5.8 inline exception). Activating scrolls the `CitationList` item into view and marks it `surface-selected` until another marker is used |
| `CitationList` item | Index (`num`), title (escaped, 2 lines then ellipsis, `type-body`), host always visible (`type-meta`, registrable domain in `foreground-secondary`), role badge (neutral subtle: Own, Competitor, Third party), category in `type-meta`, `CopyButton` (original URL) and `ExternalLinkButton` on hover and focus |
| Reverse link | "Show in answer" in the item's menu highlights all its markers |
| Ads and sponsored | `Ad` neutral outline badge, row text in `foreground-tertiary`, "Excluded from metrics" |
| Flags | `unresolved_redirect` and `engine_internal` as 14 px `TriangleAlert` in `warning-text` with tooltip; they are excluded from C1 to C9 by default |

### 5.5 FactsFooter

A `surface-subtle` well (no border) with a two-column description list in `type-meta` labels and `type-body` values: mentioned, cited, recommended (with confidence and method: rule or model), structured rank ("1 of 3"), sentiment class, prominence, extractor version, entity config version, derivation id. It is the link between a rate and its evidence: every fact here is what the rollups counted.

### 5.6 Untrusted content rules

Collected text (answers, titles, snippets, URLs) is hostile input ([20-frontend-specification.md](../20-frontend-specification.md) section 7.1).

1. Evidence mode renders React text children only. No `dangerouslySetInnerHTML` anywhere.
2. Formatted mode uses `SafeMarkdown` (sanitized, raw HTML disabled, unsafe schemes stripped), without highlights.
3. Raw mode is escaped text in `type-mono` on `surface-subtle`, fetched on open.
4. Links in answers and citations render through `ExternalLink` only when the scheme is `http` or `https`; the host is always shown next to the (attacker-controlled) title.
5. No images, iframes or embeds from collected content. Domain icons follow the `DomainCell` rule ([12-tables.md](12-tables.md) section 6).
6. Collected strings in chart tooltips are escaped with `encodeHTML`.
7. Copy actions copy the original value; displayed values are normalized with `displayUrl`.

## 6. Comparison patterns

### 6.1 Entity comparison table

Compares the own brand and up to five competitors across topics for one metric at a time.

```text
| Metric [Mention rate v]        Engine scope: ChatGPT (filter bar)                    5 topics           |
+------------------------+------------+------------+------------+------------+------------+---------------+
| Topic                  |   Northwind|     HubSpot|   Pipedrive|        Zoho|  Freshsales|  Gap vs leader|
+------------------------+------------+------------+------------+------------+------------+---------------+
| CRM for startups       |       47.2%|       58.1%|       22.4%|       18.0%|        9.3%|      −10.9 pts|
| CRM pricing            |       31.0%|       29.5%|       12.2%|Insufficient|         n/a|          0 pts|
| Sales pipeline         |       22.8%|       41.6%|       44.0%|       12.5%|        6.1%|      −21.2 pts|
```

| Rule | Spec |
|---|---|
| Structure | `DataTable`. Rows are topics (or keyword groups, or engines); columns are entities in stored color order, own brand first and pinned after the identity column |
| Column header | Entity name with its 8 px color swatch (the same swatch as `CompetitorCell`) |
| Metric switcher | `MetricSwitcher` in the table toolbar (left): a `Select` listing metrics grouped by channel. AI: Mention rate (A1), Citation rate (A2), Recommendation rate (A5), Share of voice (A7). SEO: Visibility (volume-weighted), Average rank, Share of voice (SEO). Selection writes `metric=` to the URL |
| Engine | AI metrics use the engine scope control in the filter bar. One engine at a time in this table; comparing engines uses the prompt or engine views |
| Cells | `MetricCell` for rates, `RankCell` for average rank (with `n_ranked` in tooltip), `NumberCell` for counts. Unknown states from [12-tables.md](12-tables.md) section 7.3 |
| Emphasis | The highest value in each row (lowest for rank) is weight 500. No color, no shading, no icons. Header tooltip: "Highest value in row. Differences can be within normal variation" |
| Gap column | "Gap vs leader" for the own brand: `DeltaCell` from the API's A14 comparison (paired interval), colored only when detectable; `0 pts` when own brand leads |
| Limits | Six entity columns (palette limit). More competitors: the column chooser picks which five show |
| Sort | By any entity column or by gap |

### 6.2 SEOAIComparisonRow

The row model for tables that put SEO and AI measurements of one keyword side by side (Matrix table, Topic keyword lists, keyword lists inside Page Intelligence). Columns follow [15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 3 and never merge channels.

| Column group | Columns (type) | Notes |
|---|---|---|
| Identity | Keyword (`keyword`), Volume (`volume`) | "Other device" micro badge when the link resolved to the other device |
| SEO | Organic rank (`rank`), Change (`rankDelta`), AI Overview (`aiOverview`) | AI Overview sits in SEO because it is measured in the same SERP check |
| AI | ChatGPT, Gemini, AI Mode (`engineGroup` of the selected AI metric) | Each cell `k of n` in tooltip; insufficient under 4 valid observations |
| Context | Owned page cited (`url`), Competitor leader SEO and AI (`competitor`), Condition (`OpportunityStatus`, section 7.3), Quadrant (`badge`, neutral) | |

Column groups render a 24 px group header row above the 40 px column headers (`type-micro`, `foreground-tertiary`, left-aligned over the group, on the same `surface-subtle` fill). Group headers are the only place this table shows channel names. Body rows have no vertical borders; the header rows keep the 1 px dividers between header cells ([12-tables.md](12-tables.md)).

### 6.3 Side-by-side answers: AnswerCompare

Compares two observations of the same prompt (for example the latest answer vs the last one that mentioned the own brand). Available on Prompt Detail (Answers tab, select two rows, "Compare") and in prompt diagnostics. Not available in the inspector (needs at least 1,000 px).

```text
| A: ChatGPT · Sep 22, 01:14 · rep 2 · Valid             | B: ChatGPT · Aug 25, 01:09 · rep 1 · Valid             |
| Mentioned No · Cited No · Top-3 list: no               | Mentioned Yes · Cited Yes · Top-3 list: 1 of 3         |
+-----------------------------------------------------------------------------------------------------------------+
| Only in B: Northwind (mention), northwind.com/pricing (citation) · In both: HubSpot, Pipedrive, g2.com          |
+--------------------------------------------------------+--------------------------------------------------------+
| 1. {HubSpot} offers a free tier... [1]                 | 1. {Northwind} is a solid pick for... [1]              |
| 2. {Pipedrive} focuses on pipeline... [2]              | 2. {HubSpot} offers a free tier... [2]                 |
+--------------------------------------------------------+--------------------------------------------------------+
| Citations: 1 g2.com  2 capterra.com                    | Citations: 1 northwind.com/pricing  2 g2.com           |
```

Curly braces mark highlighted mentions in these sketches.

| Rule | Spec |
|---|---|
| Layout | Two equal columns (`grid-cols-2 gap-4`), each a full `EvidenceText` with shared `EntityToggleList` above both |
| Difference summary | One line above the texts: entities and citation hosts that appear only in A, only in B, in both. Computed from facts, not from text diffing |
| Scroll | Columns scroll independently; "Sync scroll" `ToggleButton` (off by default) |
| URL | `obs=<idA>&vs=<idB>`; Back returns to single view |
| Choosing B | Default B is "latest observation where own brand was mentioned" when A has no mention; the picker lists observations with engine, date and facts |

### 6.4 Period comparison

| Element | Rule |
|---|---|
| Control | `CompareSelect` scope control in the filter bar: None, Previous period (default), Same period last year, Custom |
| Deltas | Every value with a comparison shows `Delta`, `DeltaCell`, `RankDelta` or `RankDeltaCell` from `MetricComparison` (`current`, `previous`, `delta`). Tone only when `is_detectable` is true (rates) or beyond normal movement (single-keyword ranks). `is_detectable: null` renders neutral |
| Tooltip | Previous value, both periods as ranges ("Aug 4 to Aug 31"), interval of the change, method ("Paired, same 243 prompts" or "Unpaired, Newcombe; may understate uncertainty") |
| Tables | Column chooser option "Show previous values" expands a value column into Current, Previous and Change |
| Charts | Previous period as a dashed `chart-reference` series aligned by day offset, named "Previous period" in the legend |
| Version boundary between periods | 12 px `GitCommitVertical` in `foreground-muted` on the delta ([07-icons.md](07-icons.md) section 6) with tooltip "Extractor changed on Sep 14; periods use different versions"; the statistics panel offers the recompute action |
| Wording | "Detectable change" or "Within normal variation". Never "significant", "trending", "surging" |

## 7. SEO and AI status

### 7.1 SEOAIStatus

A compact, fixed arrangement of three measurements for one keyword or page: organic rank, AI Overview status and per-engine AI presence as text. It gives cross-channel context in tables that are about something else (topic keyword lists, page keyword lists, the keyword inspector) without merging channels.

Forms:

| Form | Where | Rendering |
|---|---|---|
| `columns` | `DataTable` column group "SEO and AI" | Five sub-columns under a 24 px group header: Rank (56 px), AIO (96 px), ChatGPT (72 px), Gemini (72 px), AI Mode (72 px). Engines in fixed order and only those in scope |
| `inline` | Inspector sections, detail headers, tooltips | One line in `type-body`: `Rank 7 · AIO cited #2 · ChatGPT 47%, Gemini 12%, AI Mode n/a` |

Example rows (`columns` form):

```text
Keyword                     Rank   AIO          ChatGPT   Gemini   AI Mode
best crm for startups          3   Cited #2         47%      12%       n/a
crm pricing                  >20   Not cited        31%    3 obs       22%
crm for small business         7   No AIO       Pending      18%        9%
```

Slot states:

| Slot | State | Display | Tooltip |
|---|---|---|---|
| Rank | Ranked | `7` (`RankCell`) | Check time, depth, previous rank |
| | Beyond depth | `>20` in `foreground-tertiary` (`columns` form); "not in top 20" in the `inline` form | "Not in top 20 on Sep 29" |
| | Not tracked in this location | `n/a` | "Not tracked for United States, desktop" |
| | Pending | `Pending` | First check time |
| AIO | Cited | `Cited #2` (positive outline badge, own domain only) | Citation position, sources, competitors cited |
| | Present, not cited | `Not cited` (neutral outline) | Sources cited instead (top 3) |
| | No AI Overview | `No AIO` (text, `foreground-tertiary`) | Presence rate in window ("AIO in 0 of 28 checks") |
| | Not loaded | `Not loaded` | "AI Overview content not fetched for this check" |
| Engine | Rate | `47%` (headline rounding rule, [22-content-formatting.md](22-content-formatting.md) section 2) | Metric, `k of n`, interval, linked prompts count |
| | Insufficient | Hatched cell with `3 obs` in `foreground-tertiary` | "Insufficient data: 3 valid observations, 4 needed" |
| | Engine not in scope or not enabled | `n/a` | Reason |
| | No linked prompts | `n/a` | "No linked prompts. Link prompts in Keyword Detail" |
| | Pending | `Pending` | Next collection |

Semantics:
1. The engine value is the metric chosen by the page's AI metric (default Mention rate, A1) over **linked active prompts**, prompt-weighted ([15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 3).
2. The three slots are never combined into a score, color or quadrant. Quadrant is a separate column where the page needs it.
3. No slot is colored by its value except the `Cited #n` badge (a defensible own-domain fact, [14-badges-status.md](14-badges-status.md) section 2). Rank change is not part of this component.
4. Sorting a `columns` group sorts by the sub-column clicked.

### 7.2 Where it appears

Topic Explorer keyword lists, Page Intelligence keyword table, keyword inspector (AI tab, `inline`), Prompt inspector related keywords (`inline` per keyword), and the Matrix tooltip. The Matrix table itself uses the full `SEOAIComparisonRow` (section 6.2).

### 7.3 OpportunityStatus

`OpportunityStatus` names a **condition** a keyword, page or prompt meets, using one rule from [15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 5. It is a label on evidence, never a verdict.

| Label | Rule (defaults, thresholds from the matrix settings) | Applies to |
|---|---|---|
| Top 3, not cited in AIO | Organic rank 1 to 3; AI Overview present; own domain not cited | Keyword |
| Top 10, no AI mentions | Rank 10 or better; AI presence 0 on every selected engine with at least 4 valid observations each | Keyword |
| Cited, weak rank | Own URL has at least 2 citation units in window; best organic rank above 20 or not ranking | Page, keyword |
| Ranks, page not cited | Owned URL in top 10 for at least one keyword; 0 citation units across engines; linked topics have at least 20 observations | Page |
| Competitor ahead in both | A tracked competitor ranks better and has higher AI SOV on linked prompts | Keyword |
| AIO present, not ranking | AI Overview in at least 50% of checks; own domain beyond depth | Keyword |
| Near threshold | Rank or AI presence inside the middle band of either axis | Keyword |

| Rule | Spec |
|---|---|
| Visual | `Badge` neutral outline, no icon, at most one per row (the first matching rule in table order above) |
| Evidence | Clicking or pressing Enter opens a popover (360 px): rule in plain words with the thresholds, the values that met it (with `k of n`), links to the evidence (keyword inspector, AI Overview history, prompt), and a separate line "Typical next step (hypothesis)" from [15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 4.1 |
| Wording | Labels describe observed conditions. Not allowed: "opportunity", "quick win", "losing", "because", "due to", "driving", "should" |
| Color | Never semantic. A condition is not good or bad by itself |
| Sorting | By volume represented, descending |

## 8. Statistics and methodology

### 8.1 MetricInfo

The `MetricInfo` popover ([22-content-formatting.md](22-content-formatting.md) section 10) explains meaning; the value tooltip shows numbers. Trigger: `IconButton` `icon-xs` with 14 px `Info` icon, 4 px after the label, in metric strip labels, column headers (inside the header menu area, not overlapping the sort button), chart titles and inspector section titles. Popover 360 px, content in this fixed order: definition (one sentence), formula in words, denominator and sample for the current view, aggregation (prompt-weighted), method version, "Open statistics" (AI rates only), "Methodology" link last.

### 8.2 ConfidenceIndicator

Shows the 95% interval of a rate as text with an optional mini interval bar.

```text
Text form:        31% to 37%
Bar form:         |------====●=====-------------------|      scale 0% to 60% (shared per column)
                  ^ 1 px axis line    ^ 2 px interval   ^ 6 px point
```

| Part | Spec |
|---|---|
| Text | `formatInterval` in `type-meta num` ("31% to 37%") |
| Bar size | 48 x 12 px, vertically centered in the cell or line |
| Axis line | 1 px `border-strong` across the full width, representing the shared scale. No filled background track: a filled track adds a gray block to every row and competes with the interval |
| Interval segment | 2 px tall, `foreground-secondary`, from low to high |
| Point | 6 px circle, `foreground`, at the estimate |
| Scale | Shared per column or per chart (0% to a nice ceiling of the largest upper bound), so rows are comparable. The scale is stated in the column header tooltip |
| Insufficient | No bar; `InsufficientData` instead |
| Where | Inspector rate tables, Prompt Detail rate table, statistics panel, Default density rate columns when the user enables "Show intervals" in the column menu. Not in Compact density rows |
| Accessible name | "95% interval 31% to 37%" |

### 8.3 SampleCount

`SampleCount` renders `formatSampleCount` in `type-meta num`: "612 of 1,296 obs", "28 of 28 checks", "250 prompts". It is the context line of rate items in the strip, the second line of `MetricCell` in Default density (40 px rows), and a column in inspector rate tables. The noun is always present ("obs", "checks", "prompts", "keywords").

### 8.4 InsufficientData

`InsufficientData` is the one rendering of "below the minimum sample" ([20-frontend-specification.md](../20-frontend-specification.md) section 4.5): hatching of 1 px diagonal lines in `border-subtle` at 45 degrees, 4 px apart, on `surface-subtle` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8); text "Insufficient" in cells (or the observation count in cells narrower than 88 px) and "Insufficient data" in tiles and the inspector; tooltip "3 valid observations; 4 needed". It never renders as 0, never as a gray empty cell, and sorts last.

### 8.5 Detectable change labeling

| Context | Detectable | Not detectable |
|---|---|---|
| `Delta` in strips and cells | Semantic tone by polarity, signed points | `foreground-secondary`, signed points |
| Tooltip | "Detectable change: 95% interval of the change excludes 0 (paired, 243 prompts)" | "Within normal variation: 95% interval −1.1 to +4.6 pts" |
| Change feeds and mover lists | Included; `Detectable` neutral outline badge where mixed lists exist | Excluded from Key changes; shown in full mover lists without badge |
| Single-keyword ranks | Tone when beyond normal movement; tooltip "Normal movement for this keyword: up to 2 positions" | Neutral arrow and number |
| Copy | "ChatGPT mention rate increased 5.3 pts (detectable)" | "ChatGPT mention rate changed +1.8 pts, within normal variation" |

Claims name the sample: "in 34% of responses to our 250 tracked prompts", never "34% of AI answers about CRM" ([20-frontend-specification.md](../20-frontend-specification.md) section 6).

### 8.6 Statistics panel placement

The statistics content of [20-frontend-specification.md](../20-frontend-specification.md) section 6 (estimate, uncertainty, period comparison, movers, version boundaries, panel sizing) renders as `StatisticsPanel` in one of two placements:

| Opened from | Placement | URL |
|---|---|---|
| A record's rate inside the inspector (prompt) | The inspector's "Stats" tab | `itab=stats` |
| A page-level metric: strip item, rate column header, chart "Statistics" action | The inspector region at 560 px, replacing an open record inspector; its header has "Back to <record>" when one was open | `stats=<metric>:<engine>`; closing removes it and restores `inspect` |

The panel is non-modal like every inspector (the page stays interactive and the user can change filters while reading it). It is not a focus-trapped dialog.

## 9. Timelines and activity feeds

### 9.1 EventTimeline

A vertical list of dated events for one object: keyword events ([09-rank-tracking-methodology.md](../09-rank-tracking-methodology.md) section 4.1), prompt versions and panel membership, integration syncs, run history.

Structure, markup, glyphs and filters are owned by [18-notifications-alerts.md](18-notifications-alerts.md) section 7; this summary follows it.

| Part | Spec |
|---|---|
| Date column | 64 px, `type-meta num` (13 px tabular, tertiary); the date shows on the first event of a day only (`Sep 29`). On full pages the events are grouped into day panels instead (section 9.3) |
| Event row | The feed row of section 9.3: 36 px, 16 px glyph by event type ([18-notifications-alerts.md](18-notifications-alerts.md) section 7), sentence in `type-body` using the change copy of [22-content-formatting.md](22-content-formatting.md) section 7 ("Ranking URL changed: /pricing → /blog/crm-pricing"), right-aligned source link in `type-meta` to the evidence |
| Version boundaries | Same row with the `GitCommitVertical` glyph ("Extractor v3 → v4") |
| Paging | Latest 50 events, then "Show older events" (32 px `secondary` `sm` button) loads 50 more. The inspector shows the latest 10 with "Open full timeline" |
| Filter | `CountTabs` above the list (section 9.3): "All events" and one toggle per event type present, each with its count. `md` (36 px) on full pages, `sm` (32 px) in the inspector |

### 9.2 ChangeFeed ("Key changes" on Overview)

| Rule | Spec |
|---|---|
| Items | At most 8, then "View all 23 changes" linking to the Alerts events view filtered to the window |
| Inclusion | SEO events aggregated by type ("Entered top 10: 14 keywords"); AI changes only when detectable and surviving the BH filter; collection issues affecting the window |
| Grouping | By severity, then newest first within a group. Groups: **Needs attention** (collection failures or partial data in window, budget blocked runs, lost top 10 aggregates, detectable declines), **Changes** (detectable improvements, entered top 10, new sources, competitor overtakes), **Notices** (version boundaries, competitor added, anomaly hold) |
| Frame | One panel (`surface`, 1 px `border`, radius 8) with a 48 px title row "Key changes" in `type-section-title` |
| Group header | 36 px row: group name in `type-subsection-title` (14 / 20 px, 600) plus the count in `type-meta` ("Needs attention · 3"), no icon |
| Item | The feed row of section 9.3 (36 px): glyph slot, sentence with values through the formatters, `Delta` or `RankDelta` where a single value changed, time right-aligned in `type-meta` |
| Link | Every item links to its evidence: an aggregate opens the filtered table (Rankings with `rank=top10&chg=entered`), a single-record change opens that record's inspector |
| Anomaly hold | One notice line for held days, not one per event |
| Empty | "No detectable changes in the last 28 days" with the window, not a blank panel |

### 9.3 Feed rows, day panels and CountTabs

The visual form of every event list: `EventTimeline` on detail pages and in the inspector, `ChangeFeed`, and the Alerts events view ([18-notifications-alerts.md](18-notifications-alerts.md)). It follows reference screen 6 ([reference/visual-spec.md](reference/visual-spec.md) section 5). The screen's standalone "Changes" page is not part of V1.

```text
[All events 23] [Rank moves 12] [URL changes 4] [AI Overview 5] [Versions 2]

+--------------------------------------------------------------------------------------------------------+
| Today · 7 events                                                                                       |
+--------------------------------------------------------------------------------------------------------+
| 06:12  ↗  best crm for startups improved from 5 to 3            [Rank move]   SERP check    View      |
| 05:40  ▢  northwind.com/pricing cited in AI Overview            [AI Overview] SERP check    View      |
| 02:14  ◇  Extractor v3 → v4                                      [Version]     System        View      |
+--------------------------------------------------------------------------------------------------------+
```

`[All events 23]` is the pressed `CountTabs` item. In the sketch, `↗` stands for a rank-move glyph and the other symbols for gray glyphs.

| Part | Spec |
|---|---|
| Day panel | Full pages group events by day: one panel per day (`surface`, 1 px `border`, radius 8, 16 px between panels). Header row "Today · 7 events": the day in `type-subsection-title` (14 / 20 px, 600) and the count in `type-meta`, 48 px (the panel title row). The inspector timeline uses the date column of section 9.1 instead of panels |
| Row | 36 px, 16 px horizontal padding, `border-subtle` dividers between rows. Hover `surface-hover` when the row links to evidence |
| Time | `type-meta num` (13 px tabular, tertiary) |
| Glyph | 16 px icon from [18-notifications-alerts.md](18-notifications-alerts.md) section 7. Rank moves: `positive-text` or `negative-text` only when the move is beyond normal movement (detectability rule, [14-badges-status.md](14-badges-status.md) section 5); every other glyph and every undetectable move in `foreground-tertiary` |
| Sentence | `type-body`. Entity names (keyword, domain, competitor) at weight 500; links in `primary-text`. Values through the formatters |
| Type badge | Neutral `Badge` (22 px) naming the event type ("Rank move", "AI Overview") |
| Source | `type-meta`: the collection that produced the event ("SERP check", "ChatGPT run") |
| View link | Right-aligned `TextLink` "View" in `primary-text`, opening the evidence (inspector or filtered table). Its accessible name includes the event ("View: best crm for startups improved from 5 to 3") |
| `CountTabs` | The event-type filter: a row of separate bordered items (1 px `border`, `rounded-md`, `surface`, 8 px apart), each a label in `type-body` and a count in a neutral `Badge`. Pressed item: solid `primary` fill, `primary-foreground` label at 500, count badge on `primary-hover` with `primary-foreground` text. "All events" is pressed when no type is selected; several types can be pressed (URL `events=`, [18-notifications-alerts.md](18-notifications-alerts.md) section 7). A `Toolbar` of toggle buttons (`aria-pressed`), one Tab stop, Left and Right arrows move; each accessible name includes the count ("Rank moves, 12") |

### 9.4 RuleList

A list of standing rules with an on/off switch, used for alert rules in Settings > Alerts ([18-notifications-alerts.md](18-notifications-alerts.md)). The right-hand "Alert rules" column of reference screen 6 is its visual source; in V1 it lives in Settings, not beside a feed.

| Part | Spec |
|---|---|
| Frame | One panel (`surface`, 1 px `border`, radius 8). Title row 48 px with the title in `type-inspector-title` (18 / 26 px) when the list is a page's right column, `type-section-title` inside a settings form |
| Row | 16 px padding, `border-subtle` dividers. 16 px icon in `foreground-tertiary` (rule type, [07-icons.md](07-icons.md)), 12 px gap, then the title in `type-subsection-title` (14 / 20 px, 600) above the description in `type-meta` (13 / 20 px, tertiary), then a `Switch` (36 x 20 px) right-aligned and vertically centered |
| Title | A link to the rule editor; the switch is a separate control |
| Switch | Enables or pauses the rule and saves immediately ([10-forms.md](10-forms.md) `Switch` rules). Its accessible name is the rule title ("Rank dropped out of top 10") |

## 10. Bulk actions and triage

Discovery inboxes (keyword candidates, prompt candidates, competitor candidates) share one triage pattern built on `DataTable` selection ([12-tables.md](12-tables.md) section 14).

### 10.1 Actions

| Action | Single row | Bulk | Reversible | Confirmation |
|---|---|---|---|---|
| Accept | `a` on focused row, or row hover action | Bulk bar "Accept" | Yes | None; undo toast |
| Reject (never suggest again) | `r` | "Reject" | Yes (undo, or from Rejected) | None; undo toast |
| Snooze 30 days | `s` | "Snooze" | Yes | None; undo toast |
| Edit text (prompt candidates) | `e` opens inline edit | n/a | Yes | Enter saves, Escape cancels |
| Promote to tracked, Add to core | Inspector More menu ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1) | Bulk bar | No: creates tracked objects and cost | Dialog with count, quota impact and daily cost estimate |

### 10.2 Single-key policy

Triage keys (`a`, `r`, `s`, `e`) work only when focus is on a row in the grid and not in a text input; `j` and `k` work when focus is in the grid or the inspector ([20-accessibility.md](20-accessibility.md) section 14). They are listed in the keyboard help (`?`), shown as `Kbd` in the row action tooltips, and turned off together with all single-key shortcuts in Settings > Preferences (WCAG 2.1.4). `g` sequences keep priority: after `g`, the next key is read as a navigation target for 1 second.

### 10.3 Optimistic updates and undo

1. The row leaves the current status view immediately, with no height animation (height animations are prohibited, [21-motion.md](21-motion.md) section 12). Tab and status counts update in the same frame.
2. Focus moves to the next row in the same column; at the end of the list, to the previous row.
3. A polite live region announces "Accepted crm pricing tool. Undo available."
4. The API request is sent immediately. Undo sends the reverse change.
5. The toast (360 px) reads "Accepted 1 keyword" or "Rejected 12 keywords" with an "Undo" button. Because it has an action, it stays until dismissed or the action is used ([20-accessibility.md](20-accessibility.md) section 10.5). At most 3 toasts stack; a new triage action of the same kind merges into the existing toast ("Accepted 3 keywords").
6. After the toast is dismissed, the action is still reversible from the Accepted, Snoozed or Rejected status view (WCAG 2.2.1).
7. On failure, the row returns to its original position with a 14 px `TriangleAlert` and a toast "Could not accept crm pricing tool. Try again." Focus does not jump back.

### 10.4 Bulk scope

Bulk bar per [12-tables.md](12-tables.md) section 14: selected count, "Select all 1,240 matching", actions ordered Accept, Snooze, Reject, then non-triage actions (Assign group, Tags, Topic). Bulk triage of up to 100 rows needs no confirmation because it is reversible; the toast names the count. Over 100 rows, the action confirms in an `AlertDialog` that names the count ("Reject 1,240 keyword candidates?"), per [20-accessibility.md](20-accessibility.md) section 2 (WCAG 3.3.4). The maximum bulk scope is 10,000 records per action ([12-tables.md](12-tables.md) section 14).

## 11. Cost UI

Cost screens report operations. Tone is a meter reading, not a finance dashboard: no hero dollar figures, no gauges, no donut charts, no green for "savings", no red for spending ([02-color-system.md](02-color-system.md) section 6: cost changes are never colored).

### 11.1 CostSummary

A `MetricStrip` preset for the Costs page header region and the workspace settings budget page.

```text
+----------------------------+----------------------------+----------------------------+----------------------------+
| Month to date              | Projected month end (i)    | Budget                     | Blocked runs               |
| $1,284.10  Sep 1 to Sep 29 | $1,910.00  Estimate  act...| 64%  [=======   :  ]       | 1  AI prompts, Northwind...|
+----------------------------+----------------------------+----------------------------+----------------------------+
```

In the sketch, `=` is the meter fill and `:` the soft limit marker at 80%. The strip is the panel of section 2 (96 px, because the items carry context lines); the context sits on the line below the value.

| Item | Content |
|---|---|
| Month to date | Provider-reported actual cost (`formatCurrency`); context: date range in workspace timezone |
| Projected month end | `Estimate` badge; context "actual plus planned runs"; `MetricInfo` states the method from [27-cost-model.md](../27-cost-model.md) section 10.3 |
| Budget | Share of budget ("64% of $2,000.00" in the value tooltip and accessible name) with `BudgetMeter` in the context position below the value (the item is 96 px like the others) |
| Blocked runs | Count of `budget_blocked` runs this month; links to Operations filtered to them; omitted when 0 |

### 11.2 BudgetMeter

Decision: the meter **has a track, drawn as a 1 px outline**, not a filled background.

| Part | Spec |
|---|---|
| Size | 6 px tall; 160 px wide in the summary, 64 px in table cells |
| Track | 1 px `border-strong` outline, `rounded-sm` (the progress bar radius), transparent inside |
| Fill | `foreground-muted` up to the soft limit; `warning-solid` from the soft limit up; the whole fill `warning-solid` once the hard limit is reached |
| Soft limit marker | 2 px wide, 10 px tall tick in `foreground-secondary` at the soft limit (default 80%), extending 2 px above and below the bar |
| Projection | Not drawn in the bar; stated in text next to it ("projected 96%") |
| Over 100% | Fill stops at the track end; text shows the real share ("112%") |

Why an outline track: a meter without a track has no visible 100%, so 64% has no reference and a short fill reads as a small number. A filled gray track gives that reference but puts a gray block in every table row, which competes with data and repeats across a spend table. The 1 px outline gives the extent with minimal ink, and `border-strong` meets 3:1 against surfaces so the extent is perceivable (WCAG 1.4.11). The text value is always present, so the meter is never the only carrier of the number.

### 11.3 Tables

**Provider breakdown** (Costs page, "By provider" tab):

| Column | Type | Notes |
|---|---|---|
| Provider | text | DataForSEO, OpenAI, Perplexity, DigitalOcean (fixed infrastructure as its own row) |
| Endpoints | count | Tooltip lists the top 3 |
| Requests | count | |
| Units | count | Pages, tasks, tokens (unit named in tooltip) |
| Cost (USD) | currency | Sort default |
| Share | rate | Of the month's total |
| vs last month | relative change | Neutral always (`+12.4%`) |
| Cost source | badge | `Provider reported`, `Computed from tokens`, `Price book estimate` (neutral outline) |

**Project spend** (Costs page, "By project" tab): Project, Budget (currency), Month to date, Projected (Estimate), `BudgetMeter` cell (64 px) with share, Status (`BudgetStatusBadge`), Top workload, Cost per tracked keyword, Cost per prompt.

### 11.4 Unit metrics

Unit costs answer "what does one unit of tracking cost" and are shown as a `SimpleTable` on the Costs page and in the onboarding estimate panel:

| Unit | Example value | Definition |
|---|---|---|
| Cost per SERP check | $0.0012 | Depth 20, desktop, standard queue (2 pages) |
| Cost per AI observation | $0.0012 | One task on ChatGPT, Gemini or AI Mode, standard queue |
| Cost per tracked keyword per month | $0.062 | Daily depth 20 plus weekly depth 100, month-to-date cost divided by tracked keywords |
| Cost per prompt per month | $0.047 | Weekly, 3 engines, 3 replicates |

Each row names its basis in `type-meta` and links to [27-cost-model.md](../27-cost-model.md) through `MetricInfo`. Values use 4 decimals below one cent.

### 11.5 Budget status badges

`BudgetStatusBadge` is a `Badge` preset (tone and icon fixed per budget state):

| Status | Badge | When |
|---|---|---|
| Within budget | neutral subtle, no icon | Below soft limit |
| Soft limit reached | warning subtle, `TriangleAlert` | At or above soft limit, below hard limit |
| Budget blocked | warning subtle, `Receipt` ([07-icons.md](07-icons.md) section 6) | Hard limit reached; new runs for the budget group are blocked |
| No budget | neutral outline | No limit configured |

Copy: "Soft limit reached: 84% of $2,000.00", "Budget blocked: new AI prompt runs paused until Oct 1 or until the limit is raised". No exclamation marks, no "overspend".

## 12. Collection progress and freshness

### 12.1 CollectionProgress

Shows a running collection that affects the current page. The component, its densities, states and copy are specified in [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4 and [22-content-formatting.md](22-content-formatting.md) section 7; this section only places it.

| Placement | Rendering |
|---|---|
| Page header meta line | Compact density: replaces the freshness text while a run for this page's data runs: `LoaderCircle` 14 px, "Running: 412 of 1,000 checks", link "View run". No bar in the meta line |
| Status line under the page header | Standard density with the 4 px progress bar (`rounded-sm`, track `surface-subtle`, done segment `primary`) per [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4.2 |
| Table rows | Rows not yet collected in this run keep their last values; rows never collected show `Pending` |
| Completion | Runs the user started: toast "Collection completed: 1,000 checks" or "Completed with errors: 12 failed" with "View run". Scheduled runs never toast ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4.3) |
| New data | The meta line shows "New data available" with a `link` button "Show new data". The page does not refresh itself, so rows do not move under the pointer (P8) |

### 12.2 Freshness in headers

| Page | Meta line |
|---|---|
| Single-channel pages | `FreshnessIndicator` ("Updated 12m ago") |
| Overview and cross-channel pages (Matrix, Competitors, Page Intelligence) | One value per channel: "SEO updated 2h ago · AI updated Sep 28, 02:10" |
| Workspace pages (Costs, Operations) | "Workspace timezone Europe/Berlin · Updated 5m ago" |
| Stale data | `FreshnessIndicator` stale state (`warning-text`, `Clock`, "Stale: last collected Sep 27, 18:30 CEST", [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 7.1) linking to the run |

## 13. Setup checklist

`SetupChecklist` appears only on Overview, above the metric strip, until the project's onboarding steps ([20-frontend-specification.md](../20-frontend-specification.md) section 5.1) are complete.

| State | Rendering |
|---|---|
| Collapsed (default after first visit) | One 40 px bar: `type-body-strong` "Setup: 4 of 9 steps complete", a 64 px progress bar, "Continue setup" (`secondary` `sm`), "Show steps" (`ghost` `sm`) |
| Expanded | List of 9 rows at 32 px: status glyph (`CircleCheck` in `positive-text` done, empty 14 px circle outline in `foreground-muted` to do), step name, one fact in `type-meta` ("240 keywords"), action link for incomplete steps ("Add prompts") |
| Complete | Bar reads "Setup complete" with "Dismiss" (`ghost` `sm`). Dismissal is permanent for the project; Settings > General has "Show setup checklist" |

Before completion it cannot be dismissed. Other pages do not show a banner; their empty states name the missing step ("No prompts yet. Add prompts to start AI tracking."). The checklist is not a card grid and has no illustration.

## 14. Saved views

The mechanics are in [12-tables.md](12-tables.md) section 11. Usage rules:

| Rule | Spec |
|---|---|
| Where | T2 tables (Rankings, Prompts, Citations, Sources, Pages), T6 inboxes, Matrix, Competitors comparison. Not on Overview, detail pages or settings |
| Control | `SavedViewMenu` in the page header title row, right of the title. The table toolbar does not repeat it |
| Label | "View: Default" or the view name; "(edited)" when state differs; chips that differ from the view carry the 6 px `primary` dot ([13-filters-search.md](13-filters-search.md) section 9) |
| Seeds | Each table ships its seed views (Rankings: "Top 10 losses", "Entered top 10", "AI Overview wins", "URL changed"; Prompts: "Uncited prompts", "Competitor gaps", "Low confidence"; Citations: "New sources", "Competitor-only sources"; Matrix: "Rank 1 to 3 without AIO citation", "Cited despite weak rankings") |
| Scope | Stores filters, sort, columns, density, grouping, table search. Does not store the inspector or date window unless the view was saved with "Include date window" |
| Missing references | A view whose filter references a deleted object shows a warning chip "1 filter no longer exists" and ignores it |

## 15. URL state

Everything a user would want to share or reload is in the URL ([13-filters-search.md](13-filters-search.md) section 5). Summary of keys, including keys this document adds:

| Key | Meaning | History | Defined in |
|---|---|---|---|
| `from`, `to`, `win`, `cmp` | Date window and comparison | replace | 13 |
| `dev`, `loc`, `eng` | Scope controls (location in the top bar; device and engines in the filter bar) | replace | 13 |
| `topic`, `grp`, `tag`, `intent`, `rank`, `feat`, `aio`, `vol` | Filters | replace | 13 |
| `q` | Table search | replace | 13 |
| `sort` | Sort keys | replace | 12, 13 |
| `view` | Saved view id | push | 12 |
| `tab` | Page tab (query-param tabs only; route tabs use the path) | push | 09, 13 |
| `inspect` | Open inspector: `<type>:<id>` (`keyword:9f2c`, `prompt:71ab`, `domain:4410`). Types: `keyword`, `prompt`, `citation`, `answer`, `page`, `competitor`, `domain` (registrable domain), `source` (cited URL), `run`, `candidate` (Discover candidate) | push on open, replace when moving with `j` and `k` | 13, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.7 |
| `itab` | Inspector tab slug of the open type (for example `serp`, `ai`, `timeline`, `history`, `stats`) | replace | [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.7 |
| `stats` | Page-level statistics panel: `<metric>:<engine>` | push | [20-frontend-specification.md](../20-frontend-specification.md) section 6, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 8 |
| `obs`, `vs` | Observation shown in the evidence viewer, and the comparison observation | push | this document (new) |
| `metric` | Metric switcher value (`ai.mention_rate`) | replace | this document (new) |
| `status` | Triage status view (`new`, `accepted`, `snoozed`, `rejected`) | push | this document (new) |
| `by` | Table grouping column | replace | this document (new) |
| `quad`, `domain`, `role`, `chg`, `provider`, `project`, `workload` | Filter keys for Matrix quadrant, cited domain, domain role, change type (`entered`, `lost`, `improved`, `declined`) and cost dimensions | replace | this document (new filter keys for [13-filters-search.md](13-filters-search.md) section 5) |

Rules:
1. Back closes the inspector before it leaves the page, because `inspect` is pushed and moving between records replaces.
2. Inspector tab and grouping use replace so tab clicks do not fill the history.
3. Opening a URL with `inspect` renders the list and the inspector together; the row scrolls into view and is marked active.
4. Opening an inspector URL for an object that no longer matches the filters still opens it, with a notice "This keyword is hidden by the current filters".
5. The new keys are added to `lib/filters/parsers.ts` with the same validation rule: invalid values are dropped with a notice, the parser never throws.

## 16. New components introduced

For the inventory in [25-component-inventory.md](25-component-inventory.md). Components named in earlier documents but first specified here are marked "specified here".

| Component | Purpose | Section |
|---|---|---|
| `PageHeader` | Title block, meta line, view menu, actions, tabs and filter bar slot with the height budget | 3 |
| `MetricStrip` (specified here) | Summary of 3 to 6 metrics: `md` one 76 px panel with full-height dividers, `sm` a key-value grid in the inspector | 2 |
| `MetricCard` | Single-metric panel for detail headers and quadrant summaries only | 2.5 |
| `InspectorHeader` | Sticky inspector header: type, navigation, name, meta, actions | 4.1 |
| `InspectorSection` | Titled section inside an inspector with "View all" link | 4.1 |
| `ResponsePreview` (specified here) | Compact summary of one AI answer | 5.1 |
| `EvidenceText` | Safe rendering of an answer with highlights and citation markers | 5.1 |
| `EvidenceHighlight` | Entity mention mark (own brand: `primary-subtle` behind `primary-text` 500; others: 18% tint, 2 px border) | 5.3 |
| `QuoteBox` | Bordered excerpt of collected text in inspector sections | 4.4 |
| `DomainChip` | Neutral chip for a cited domain, with a "+N" overflow chip | 4.4 |
| `CitationMarker` | Inline citation button (`primary-text` on `primary-subtle`) linked to the list | 5.4 |
| `EntityToggleList` | Per-entity highlight toggles with counts | 5.1 |
| `CitationList` (specified here) | Ordered, escaped list of an answer's citations | 5.4 |
| `FactsFooter` | Extracted facts and derivation versions of an observation | 5.5 |
| `AnswerViewMode` | Evidence, Formatted, Raw segmented switch | 5.1 |
| `AnswerCompare` | Two observations side by side with a difference summary | 6.3 |
| `MetricSwitcher` | Select of registry metrics grouped by channel for comparison tables and charts | 6.1 |
| `SEOAIStatus` (specified here) | Rank, AI Overview and per-engine AI values in `columns` or `inline` form | 7.1 |
| `OpportunityStatus` | Neutral label for a documented cross-channel condition, with evidence popover | 7.3 |
| `ConfidenceIndicator` | Interval text with optional 48 x 12 px interval bar | 8.2 |
| `SampleCount` | "612 of 1,296 obs" formatter component | 8.3 |
| `InsufficientData` | Hatched "Insufficient" (cells) or "Insufficient data" (tiles, inspector) rendering with counts; specified in [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8 | 8.4 |
| `StatisticsPanel` | Statistics content in the inspector region or inspector tab | 8.6 |
| `EventTimeline` | Dated event list grouped by day | 9.1 |
| `ChangeFeed` | Key changes list grouped by severity, max 8 items | 9.2 |
| `CountTabs` | Event-type filter: bordered toggle items with counts, pressed item in solid `primary` | 9.3 |
| `RuleList` | Panel of standing rules with title, description and an on/off switch | 9.4 |
| `TriageToast` | Undo toast for triage and reversible bulk actions (persists until dismissed, merging) | 10.3 |
| `CostSummary` | `MetricStrip` preset for spend, projection, budget, blocked runs | 11.1 |
| `BudgetMeter` | 6 px outline-track meter with soft limit marker | 11.2 |
| `BudgetStatusBadge` | `Badge` preset for budget states (tone and icon fixed per state) | 11.5 |
| `CollectionProgress` | Running collection state; specified in [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4, placed here | 12.1 |
| `SetupChecklist` | Compact onboarding checklist on Overview | 13 |
| `SavedViewMenu` (specified here) | Saved view menu button in the page title row | 14 |

New tokens required: `--entity-1-highlight` to `--entity-6-highlight` and `--entity-other-highlight` (section 5.3), both themes, with contrast tests for `foreground` on each tint.

Icon assignments this document relies on, recorded in [07-icons.md](07-icons.md) section 6: previous and next record `ChevronUp` and `ChevronDown`; setup step not done `Circle`; inspector "Open page" `Maximize2` (an icon button with the tooltip "Open page", as in reference screens 2 and 4; section 4.1).

## 17. Decisions that refine other documents

Each row records an earlier statement that no longer applies; the Resolution column is the current rule.

| Superseded statement | Where it appeared | Resolution (current rule) |
|---|---|---|
| Earlier: the statistics drawer was a focus-trapped modal | [20-frontend-specification.md](../20-frontend-specification.md) section 6 | Non-modal `StatisticsPanel` in the inspector region (section 8.6, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 8), consistent with P6. The modal `SideDrawer` moves to Later |
| Earlier: the saved view control sat in the table toolbar | [12-tables.md](12-tables.md) section 1 sketch vs section 11 | Title row only (section 14) |
| Earlier: a setup checklist banner on every project page | [20-frontend-specification.md](../20-frontend-specification.md) section 3.3 | Overview only; empty states elsewhere (section 13) |
| Earlier: inspector tab changes pushed history | [13-filters-search.md](13-filters-search.md) section 5 (now corrected there) | `itab` and record moves use replace ([13-filters-search.md](13-filters-search.md) section 5, section 15 here) |
| Earlier: Overview showed 12 SEO tiles and an AI tile per engine | [20-frontend-specification.md](../20-frontend-specification.md) section 5.2 | One strip of 6 plus tables ([24-page-templates.md](24-page-templates.md) T1) |
| Earlier: inspector tabs were a 28 px segmented control | [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.3 | 44 px underline tabs at the bottom of the inspector header (section 4.1), as in reference screens 2 and 4 |
| Earlier: the date window and location were controls in the filter bar | [13-filters-search.md](13-filters-search.md) sections 1 and 2 (now corrected there) | Project-wide scope controls in the top bar, hidden where they do not apply; screen-specific scope and filters stay in the filter bar; URL keys unchanged ([11-navigation.md](11-navigation.md) section 4, [reference/visual-spec.md](reference/visual-spec.md) section 6) |
| Earlier: "Open page" was a text button in the inspector header | [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1 | 32 px expand icon button (`Maximize2`, tooltip "Open page") next to Close (section 4.1) |
| Earlier: the metric strip had no frame, 72 px (`md`) or 64 px (`sm`) | [04-spacing-density.md](04-spacing-density.md) section 2, [00-design-principles.md](00-design-principles.md) section 3 | One 76 px panel with full-height dividers (`md`) and a key-value grid in the inspector (`sm`) (section 2) |

## 18. Customizable layouts

People choose which cards and headline numbers they see. The full design is the [layout customization spec](../superpowers/specs/2026-09-30-layout-customization-design.md); the decision is [ADR-DS-021](adr/ADR-DS-021-customizable-layouts.md). This section is the interface contract.

### 18.1 What is customizable

| Place | Zone | What a person can do |
|---|---|---|
| Dashboard pages (T1: Overview, AI Visibility Overview) | `cards` | Hide, add from the catalog, reorder, set a width (one third, half, two thirds, full), set a card's options. Up to 12 cards |
| Dashboard and table pages | `numbers` (the `MetricStrip`) | Remove, add, reorder. 0 to 6. An AI number is always for one engine |
| Record inspector, Overview tab | `cards` | Hide, add, reorder. One column, no widths |

Not customizable: the sidebar, the top bar, page headers, filter bars, the inspector's header and tabs, the Costs page. Table columns have their own chooser ([12-tables.md](12-tables.md) section 10).

A layout belongs to a person and a workspace, and is the same in every project. An owner or admin can save a team default; people who have not customized see it. The order is: personal layout, else team default, else the built-in default of [24-page-templates.md](24-page-templates.md).

### 18.2 Customize mode

| Part | Spec |
|---|---|
| Entry | `CustomizeButton`: `secondary` with `SlidersHorizontal`, in the page header actions of a dashboard page; "Customize numbers" in the More menu of a table page; "Customize cards" in the inspector's More menu. Shown from 768 px. The button is a toggle (`aria-pressed`); pressed it uses `primary-subtle`, `primary-border` and `primary-text` |
| Page state | A "Customizing" badge (`primary-subtle`, `primary-text`) beside the page title. Cards keep their real data; their content is `inert` |
| Card frame | In customize mode each card sits in a frame: 4 px padding, `surface-subtle` fill, 1 px dashed `border-strong` outline, radius 8 px. A picked-up card has a 2 px `primary` ring |
| Card toolbar | 36 px row above the card, a labelled `role="group"` (each control is a tab stop): drag handle (`GripVertical`, 32 px ghost, named "Reorder {card}" with the keyboard instructions as its description), then right-aligned: Width (`Select` `sm`, only the widths the card type allows; not in the inspector), Options (`Settings2`, only on card types with options; opens a popover of radio groups that apply at once), Hide (`EyeOff`, tooltip "Hide card. Add it back from the catalog"), More (`EllipsisVertical`: Move earlier, Move later, Move to start, Move to end) |
| Drop indicator | A 2 px `primary` line, midway in the gap, on the side of the card the dragged card will land; the dragged card is at 50% opacity. No line shows, and nothing moves, while the pointer is over the dragged card's own place |
| Add slot | After the last card: a dashed `border-strong` box, 120 px tall (64 px in the inspector), "Add card" in `primary-text` with `Plus`, and "Opens the card catalog" in `type-meta`. It takes the free third of the last row when there is one, otherwise half a row. Not shown at 12 cards |
| Numbers | Each number gets a 32 px control row above it, like a card: drag handle at the left, then Remove (`X`) and More (`EllipsisVertical`: Move earlier, Move later, Move to start, Move to end) at the right. The number is not a link while customizing. After the last number, an "Add number" cell opens a popover: SEO numbers as chips, then each AI metric with one chip per engine (with its `EngineLogo`). Chips already shown are disabled. The strip draws its stronger divider wherever SEO and AI numbers meet |
| Save bar | `SaveBar`, pinned to the bottom: the change count ("3 changes", "No changes"), the scope sentence "Applies to your view, in every project" (from 1024 px), then "Reset to default" (`ghost`), "Cancel" (`secondary`) and "Save layout" (`primary`), which is disabled with no changes. Owners and admins get a menu on the Save button: "Save as team default" and, when one exists, "Remove team default"; both confirm in an AlertDialog |
| Leaving | Cancel, Escape, the Customize button, navigation (links, Back and Forward) and closing the inspector (button, scrim, Escape) all leave the mode; with unsaved changes they first open "Discard unsaved changes?" ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 4.3). Focus returns to the control that started the mode. Saving shows no toast: the page is the confirmation. Below 768 px the mode ends when there is nothing to save; unsaved changes keep it open with its save bar |
| Keyboard pick-up | Space on a handle picks the item up (2 px `primary` ring, `aria-pressed`), arrows move it, Space drops it, Escape puts it back. Focus leaving the handle, or any pointer edit, drops it in place and announces the position |

### 18.3 Card catalog

`CardCatalogDialog`: a 720 px dialog titled "Add card" with a search field and the card types grouped SEO, AI, Cross-channel and Activity. Each entry is a 40 px icon tile (`neutral-subtle`), the card's name with a "New" badge for 30 days after release, one sentence on what the card answers, and a 32 px button: "Add", "Add another" (reusable types), "Added" (disabled), "Page is full" (disabled at 12 cards) or "Unavailable" (disabled, with the reason in `warning-text` under the description). Card types the person has no permission for are not listed. Adding closes the dialog, appends the card, scrolls it into view and focuses its handle.

### 18.4 Layout rules

| Rule | Spec |
|---|---|
| Grid | 12 columns from 768 px. One third is 4 columns (6 at 768 to 1279 px), half is 6, two thirds is 8 (12 at 768 to 1279 px), full is 12. Below 768 px every card is full width |
| Flow | Cards flow in order and wrap when they do not fit. A row that is not full stays not full: the page never stretches a card past the width the person chose |
| Heights | Set by the card type, never by the person. Cards in one row share the tallest height |
| Container queries | A card adapts to its own width, not the viewport's: columns and secondary text hide by `@container` size, because a half-width card on a wide screen is still narrow |
| Unavailable cards | A card the project cannot show (a channel is off) is skipped in normal view and the grid closes up. In customize mode it shows as a placeholder with the reason. The layout is not changed |
| New card types | Appear in the catalog. They are never inserted into a team default or a personal layout |

### 18.5 Announcements

One polite live region reports each change: "Top movers added, position 9 of 9", "Rank distribution hidden. Add it back from the catalog", "Top movers, position 2 of 10", "Top movers picked up. Use the arrow keys to move, Space to drop, Escape to put it back", "Layout saved". After a move, focus stays on the moved card's handle. After hide, focus goes to the next card's handle, to the previous card's when the hidden one was last, or to "Add card" when none is left. A keyboard move at either end is answered too: "Rank distribution is already first".

