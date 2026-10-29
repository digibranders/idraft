# 15. Data Visualization

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Library: Apache ECharts 6.1 (verified 2026-09-29) through an in-house wrapper; sparklines use a shared canvas renderer. Palettes: [02-color-system.md](02-color-system.md) section 7 and section 4.2 of this document; values from [reference/visual-spec.md](reference/visual-spec.md) section 2.3.

## 1. Principles

1. **Quiet by default.** No chart backgrounds, no gradients, no shadows, no glow, no 3D, no entrance animations. Gridlines are horizontal only, 1 px dashed and faint.
2. **The data is the loudest element.** Series lines are 2 px; the own brand stands out by `chart-1`, circle markers and its first place in the legend. Axes and gridlines use the lightest tokens that still read.
3. **Honest scales.** Rates start at 0. Ranks are inverted so better is up. Unknown values are gaps or hatched bands, never zeros.
4. **Every chart has a text and table alternative** ([20-accessibility.md](20-accessibility.md)).
5. **Charts are for trends and distributions; tables are for lookup.** A chart that answers "what is the value for X" should be a table.
6. **No pie or donut charts in V1.** Parts-of-whole questions in this product (outcome mix, source share, rank distribution) are answered by 100% stacked bars or ranked horizontal bars, which compare better across time and entities.

## 2. ChartFrame

Every chart renders inside `ChartFrame`:

```
+-------------------------------------------------------------------------------------------+
| Mention rate by engine  ● ChatGPT ● Gemini ● AI Mode  [Series v] [Table] [Patterns] [···] |  title row 48, legend top right
| Last 28 days · 250 prompts · 1 version boundary                                           |  meta line
|                                                                                           |
|   chart canvas (height by context)                                                        |
|                                                                                           |
| ● ChatGPT 47.2%   ● Gemini 38.9%   ● AI Mode 29.4%   -- Previous period                   |  or: legend below, with values
| Method: prompt-weighted, 95% Wilson intervals. Excludes branded prompts. (i)              |  footnote
+-------------------------------------------------------------------------------------------+
```

| Part | Spec |
|---|---|
| Container | Panel: `surface`, 1 px `border`, 8 px radius, 16 px padding, no shadow. Inside an inspector: no border, 0 horizontal padding |
| Title | `type-section-title` (16 / 24 px, 600) in the 48 px panel title row; inside an inspector or a detail page rail `type-subsection-title` (14 / 20 px, 600). States the metric and the split ("by engine", "vs competitors") |
| Meta line | `type-meta` (13 / 20 px, tertiary): window, sample size, version boundary count |
| Legend | Rendered in React, not by ECharts, in `type-label` (12 px, tertiary). Two placements: at the top right of the panel title row with names only, or below the chart when it shows current values. Swatch: an 8 px filled dot in the series color; a series drawn with markers shows its 8 px marker shape instead ([20-accessibility.md](20-accessibility.md) section 12.2); reference, Other and estimate series show a 12 x 2 px line swatch in their dash pattern. Clicking a legend item toggles the series; hidden series keep their color slot. Hidden when there is only one series |
| Actions | `Table` toggle (swaps canvas for a `SimpleTable` with the same data including n and interval columns), `Patterns` toggle (ECharts decal), overflow menu: Download PNG (light theme), Download CSV, Copy link |
| Footnote | `type-meta`: method and filters that change interpretation, with an info button opening the methodology popover |
| Heights | Overview main trend 280 px; standard trend 240 px; inspector chart 180 px; small multiple 140 px; matrix 480 px (min 400) |

## 3. ECharts integration

| Aspect | Rule |
|---|---|
| Wrapper | `components/app/chart/echart.tsx`: creates the instance on a div, observes size with `ResizeObserver`, calls `dispose()` on unmount, applies the design-system theme, forwards events. `echarts-for-react` is not used (the wrapper is about 100 lines and avoids lifecycle mismatches with React 19) |
| Imports | Tree-shaken from `echarts/core`: `LineChart`, `BarChart`, `ScatterChart`, `HeatmapChart`, `CustomChart`; `GridComponent`, `TooltipComponent`, `MarkLineComponent`, `MarkAreaComponent`, `DataZoomComponent` (inside zoom only), `VisualMapComponent`, `DatasetComponent`, `AriaComponent`; `CanvasRenderer`. Legend and title components are not imported (React renders them) |
| Loading | Chart modules load with `next/dynamic` and `ssr: false`; the frame renders a skeleton of the final height meanwhile |
| Theme | Built at runtime from tokens (`lib/design/read-tokens.ts`) and applied with ECharts 6 `setTheme()` on theme change; no reload |
| Renderer | Canvas for all charts. SVG only for static exports where vector output is requested |
| Animation | `animation: false` for every chart, including data updates ([21-motion.md](21-motion.md)): data changes redraw instantly |
| Layout | Set `grid.outerBoundsMode: 'none'` and explicit grid padding so layouts do not shift between ECharts 6 versions; padding: left 40 px (fits 4-digit labels), right 16 px, top 8 px, bottom 24 px |
| Escaping | Tooltip formatters return plain text or escape every collected string with `echarts.format.encodeHTML` ([20-frontend-specification.md](../20-frontend-specification.md) section 4.6) |

## 4. Chart theme

| Element | Light | Dark |
|---|---|---|
| Background | transparent (panel surface shows through) | transparent |
| Axis label | 12 px Geist Sans (`type-label` metrics), `chart-label` (`foreground-tertiary`), tabular figures. Y labels on the left, dates below the x axis | same token |
| Axis line | x axis only, 1 px `chart-axis` | same |
| Y axis line | none | none |
| Ticks | none | none |
| Split lines (gridlines) | horizontal only, 1 px dashed, `chart-grid` (the `border-subtle` value) | same |
| Series line | 2 px for every series. Own brand (`chart-1`) solid with circle markers; other series with the marker shapes of [20-accessibility.md](20-accessibility.md) section 12.2. Round joins. Markers are drawn on series with 60 points or fewer; denser series show a 6 px symbol on hover (emphasis) and for isolated points | same |
| Reference series (previous period, baselines, averages) | 2 px dashed, pattern `[4, 4]`, `chart-reference` | same |
| "All" and "Other" aggregates | 2 px dashed, pattern `[8, 4]`, `chart-other` | same |
| Estimates | 2 px dotted, pattern `[1, 3]`, "Estimate" in the series name | same |
| Area | Not used for single lines. Stacked areas at 85% opacity with 1 px `surface` separators | same |
| Bars | Max width 24 px, 2 px gap within groups, radius 2 (top corners only for vertical bars). `BarList` and 100% stacked bars have their own specs (sections 5.1 and 5.2) | same |
| Crosshair | 1 px vertical line `border-strong` | same |
| Tooltip | `surface-elevated`, 1 px `border`, `shadow-popover`, radius 8 (`rounded-lg`: a chart tooltip holds several rows and takes the popover radius, not the 6 px text tooltip radius of [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) section 3), padding as in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 6.1. Date title in `type-subsection-title` (14 / 20 px, weight 600) in `foreground`; one row per series: 8 px dot in the series color, name in `type-table` `foreground-secondary`, value right-aligned in `type-table` `num` `foreground` (section 10) | same tokens |
| CI band | Series color at 12% opacity (`chart-band` for neutral) | 18% opacity |
| Depth band | `rank-band-none` with 45 degree hatching (decal) and label "Not in top 20" | same |
| Version boundary | 1 px dashed vertical line `foreground-muted`, label at top in `type-micro` ("Extractor v4") | same |

Series colors are assigned by role, never by position in a data array: own brand `chart-1`, competitors by stored color index, engines by fixed engine order ([14-badges-status.md](14-badges-status.md) section 4).

### 4.1 Series limits

| Situation | Strategy |
|---|---|
| 1 to 6 series | Categorical palette |
| 7 or more entities | Top 5 by the chart's metric plus "Other" (dashed `chart-other`), with a "Show all" action that switches to small multiples |
| One series of interest among many | Highlight pattern: the focus series in `chart-1`, others at 1 px `chart-reference` without legend entries |
| Many time series of the same kind (for example 40 keywords' ranks) | Small multiples, not one tangled chart |

### 4.2 Categorical palette

The order is fixed. Series 1 is always the own brand. Token values live in `tokens.css` and [02-color-system.md](02-color-system.md) section 7.1; they come from [reference/visual-spec.md](reference/visual-spec.md) section 2.3.

| Token | Series | Light | Dark |
|---|---|---|---|
| `chart-1` | Own brand (cobalt, same as `primary` in light) | `#1E65E3` | `#6A9CF8` |
| `chart-2` | Orange | `#DD6A21` | `#F59A55` |
| `chart-3` | Teal | `#1B969C` | `#5CC9CF` |
| `chart-4` | Plum | `#8A3C9B` | `#AD71BF` |
| `chart-5` | Olive | `#6D6111` | `#94873E` |
| `chart-6` | Rose | `#B84379` | `#ED83B4` |
| `chart-other` | "All" and "Other" aggregates | `#6B7280` | `#8E949C` |
| `chart-bar-neutral` | Competitor bars in a `BarList` (section 5.1) | `#D5D8DE` | `#3A3E44` |

**Color-vision note.** Olive (`chart-5`) is darker than the reference screens show (`#6D6111` instead of `#857829`), and the dark plum and olive are slightly darker than the screens too. At the screen values, orange and olive are indistinguishable for red-green color vision (CIEDE2000 distance 1.3 against a required minimum of 8 in `tokens.contrast.test.ts`). Do not "correct" these values back to the screens.

## 5. Chart types

| Type | Use in this product | Rules |
|---|---|---|
| Line | Trends: visibility, mention rate, citation rate, rank history, cost over time | Time on x; gaps for missing data (`connectNulls: false`) |
| Line with CI band | AI rates over time | Band shows the 95% interval; points with insufficient data are hollow 5 px circles without band |
| Stacked area | Composition over time only when the total is meaningful (SERP feature presence counts, rank band distribution) | Max 6 layers; order fixed from best to worst band |
| Grouped bar | Compare a few entities or engines per category (mention rate by topic for 3 engines) | Max 4 bars per group; categories sorted by the primary series |
| 100% stacked bar | Parts of a whole: four-outcome mix (mentioned and cited, mentioned only, cited only, neither), rank band distribution per week, source share by category. The replacement for pie and donut charts | Section 5.2. Always shows the segment labels in tooltip with counts; horizontal for single-entity views |
| Horizontal bar (`BarList`) | Ranked lists with values: share of voice, top cited domains, top competitors; one-snapshot categorical distributions such as rank buckets | Section 5.1; max 15 bars, then "Show all" opens the table |
| Scatter | SEO/AI matrix, correlation views | Section 8 |
| Heatmap | Topic x engine rates, SERP feature presence per day, prompt x week mention | Sequential palette for rates, diverging for changes; cell values in tooltip; cell text only when cells are at least 36 px wide |
| Rank distribution | Count of keywords per rank band per date | Stacked bars using `rank-band-*` in fixed order, unranked hatched on top |
| Small multiples | Per-engine or per-competitor trends | Shared axes and scales; synced crosshair via `echarts.connect`; 140 px tall each |
| Sparkline | In tables and the metric strip | Section 9 |
| Source/citation graph | Post-MVP (Phase 13): ECharts graph or chord series | Requires its own design review before use |

### 5.1 BarList

`BarList` ([25-component-inventory.md](25-component-inventory.md) section 10.10) draws horizontal bars as HTML in two modes: `comparison` for ranked comparisons of the own brand with competitors or domains (share of voice, top cited domains, top competitors), and `distribution` for one-snapshot categorical distributions (rank buckets, workload spend).

| Part | Spec |
|---|---|
| Label column | Left, `type-body` in `foreground`; the own domain in weight 600. Long labels truncate with an ellipsis and show the full value in a tooltip |
| Bar | 24 px tall, `rounded-2xs` (2 px), starting at a shared zero line. Own brand bar `chart-1`; every other entity `chart-bar-neutral`. Bar length is proportional to the value on a scale shared by all rows |
| Value | Directly after the end of each bar, 13 px `type-meta` (`foreground-tertiary`) with `num` |
| Rows | One per entity, sorted by value (largest first) unless the list has a fixed order such as rank buckets |
| Distribution mode | Lists that show a scale rather than entities (rank buckets) use their scale colors (`rank-band-*`, "Not in top 20" hatched, `chart-other` for a category without a scale color) instead of `chart-1` and `chart-bar-neutral` |
| Accessibility | A list (`ul`) with each item's accessible text "fieldnote.io: 17.3% share of voice". The neutral bars are 1.4:1 against the panel, below the 3:1 of 1.4.11, which is acceptable only because every bar carries its value as text and its label names it; never drop the value text |

### 5.2 100% stacked bar

| Part | Spec |
|---|---|
| Bar | 32 px tall, radius 6 on the outer corners only, full panel content width |
| Segments | Separated by 1 px gaps that show the panel `surface`. Colors follow the chart palette order (section 4.2); `chart-1` only for the own brand, never for a category |
| Labels inside segments | The percentage, 12 px weight 500 (`type-micro`) with `num`, drawn only in segments of 6% or more. The label color is chosen per segment so the pair meets 4.5:1: `foreground-inverse` (white in the light theme) where it passes, otherwise `foreground`. In the light theme white fails on `chart-2` orange (3.4:1) and `chart-3` teal (3.6:1), so those segments use `foreground`. If neither passes, the label is omitted; the legend table carries the value |
| Legend table | Below the bar: a `SimpleTable` with one row per segment: 8 px swatch, name, count and percentage (`num`, left aligned like every table column). It carries every value, so no segment depends on its inside label |
| Tooltip | Segment name, count, percentage and denominator |

Dual y-axes are not used. When two measures must be compared over time (organic rank and AI citation rate), use stacked small multiples with a shared x axis.

## 6. Axes and scales

| Measure | Scale |
|---|---|
| Rates (0 to 1) | Linear, starts at 0%. Upper bound: nice ceiling of the maximum of values and interval upper bounds, at least 10%, at most 100%. Axis labels without decimals |
| Counts, volume, cost | Linear, starts at 0, compact labels (`12.4K`) |
| Ranks | Inverted linear, 1 at top, bottom = maximum depth shown (20 by default, 100 when deep checks are shown). Labeled "Rank (1 = best)" |
| Changes (deltas) | Linear, symmetric around 0, 0 line in `border-strong` |
| Time | Business dates in project timezone; label format `Sep 29`; year added on the first tick of each year; weekly data labeled by week start |

Tick count: about 5 on y, and x labels no closer than 64 px apart.

## 7. Rank visualization

Rank has inverted semantics (1 is best). Every rank chart follows these rules:

1. **Inverted y axis** (rank 1 at the top) so improvement goes up, matching the `↑` arrow convention.
2. **Guide lines at 3, 10 and 20** (1 px dashed `chart-axis`, one step darker than the dashed `chart-grid` gridlines so the guides stay distinguishable) labeled "Top 3", "Top 10", "Top 20" at the right edge in `type-label`, outside the plot in a 52 px right grid margin so they never collide with series near rank 1 to 3. Y axis labels are 1, 3, 10 and 20; below 200 px of plot height they are 1, 10 and 20 (1 and 3 would overlap), and the Top 3 guide still marks rank 3. Colored rank bands behind the line are not used in history charts (too loud); rank-band colors are for distribution charts.
3. **Depth band.** Below the depth of each check, a hatched band labeled "Not in top 20". When depth changes over time (daily top 20, weekly top 100), the band boundary steps accordingly. Beyond-depth checks are hollow markers inside the band; the line breaks there and never runs into the band.
4. **Deep checks** keep the marker shape of their series (diamonds belong to competitor series, [20-accessibility.md](20-accessibility.md) section 12.2); they are identified by position below rank 20 and a "Deep check" line in the tooltip. "Show deep checks" extends the axis to 100.
5. **Competitors** on the same chart use their entity colors; organic and absolute rank may share the axis, absolute as dashed and named in the legend.
6. **Events** (URL changed, entered top 10, AI Overview appeared) render as 8 px glyphs on a strip under the x axis with tooltips; toggled from the legend.

```
Rank (1 = best)
  1 ┤
  3 ┤ - - - - - - - - - - - - - - - - - - - - - - - - - - -  Top 3
    │                         ╭──╮
    │           ╭─────────────╯  ╰────●
 10 ┤ - - - - -╱- - - - - - - - - - - - - - - - - - - - - -  Top 10
    │  ●──────╯
 20 ┤ - - - - - - - - - - - - - - - - - - - - - - - - - - -  Top 20
    │▨▨▨▨▨▨▨▨▨▨▨▨▨ Not in top 20 ▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨
    └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──
     Sep 1  Sep 5  Sep 9  Sep 13 Sep 17 Sep 21 Sep 25 Sep 29
         ◆ URL changed            ◆ AI Overview appeared
```

## 8. SEO and AI Matrix (signature chart)

The matrix compares organic ranking strength with AI visibility for keywords (or clusters) without inventing a combined score ([15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 4).

| Element | Spec |
|---|---|
| X axis | Organic rank, **better to the right**: log-scaled ticks at 100, 50, 20, 10, 3, 1; label "Organic rank (better →)". A separate 48 px strip at the left edge holds "Not ranking" points (beyond depth), jittered vertically |
| Y axis | AI presence 0 to 100% (definition shown in the axis title: "AI presence: mention rate, equal-weight across ChatGPT, Gemini, AI Overview"; the metric selector can switch to citation or recommendation rate) |
| Threshold lines | Dashed 1 px `border-strong` at the configured thresholds (default rank 10 and 20, AI 10% and 50%); the middle band between the two lines on each axis is shaded `surface-subtle` and labeled "Near threshold" |
| Quadrant labels | Descriptive, not evaluative, in `type-meta` at the four outer corners: "Strong in both" (top right), "AI strong, SEO weak" (top left), "SEO strong, AI weak" (bottom right), "Weak in both" (bottom left). Labels like "Dominant" or "Opportunity" are not used on the chart because they imply causation; opportunity language appears only in the recommendations panel with its evidence |
| Points | One per keyword (or cluster). Size encodes search volume (sqrt scale, 4 to 14 px). Fill `chart-reference` at 60% with 1 px `surface` outline; the hovered or selected point uses `chart-1`. Points never use red and green by quadrant |
| Insufficient data | Points with fewer than 4 observations per engine are hollow outlines and excluded from quadrant counts (shown in a footnote count) |
| Interaction | Hover tooltip: keyword, rank, AI presence with n and interval, volume, quadrant. Click opens the keyword in the inspector. Box selection (drag) selects points; the non-drag alternative is the quadrant summary list and the table toggle (WCAG 2.5.7) |
| Companion | Above the chart, a 2 x 2 `QuadrantSummary` (the one justified card grid): count, volume represented and share per quadrant; clicking a quadrant filters the table below |
| Table below | The same rows as `SEOAIComparisonRow` in a `DataTable` (keyword, organic rank, AIO, AI Mode, ChatGPT, Gemini, owned citation, competitor leader, quadrant) |
| Responsive | Below 1024 px the scatter is replaced by the quadrant summary and table |

## 9. Sparklines

| Property | Spec |
|---|---|
| Renderer | Shared canvas renderer (`components/app/sparkline`), one draw per row, not ECharts |
| Size | 64 x 20 px (Default rows and the metric strip), 64 x 16 px (Compact rows and embedded tables) |
| Stroke | 1.5 px. Gray (`chart-reference`) by default. In tables that mix the own brand with competitors or other domains, the own or owned row is drawn in `chart-1` and every other row stays gray. Tables whose rows are all the own site (Rankings) keep every sparkline gray |
| Area | None |
| Last point | 3 px dot in the stroke color |
| Baseline | Optional 1 px dashed `chart-grid` at zero (rates, counts) |
| Ranks | Inverted (better is up); scale fixed per table (1 to 20 by default) so rows are comparable; beyond-depth points break the line |
| Rates | Drawn in a window of at least 20 points around the row's own values, so a move of a point or two stays flat and a real move shows. A week without a usable rate breaks the line, and a series that ends in a gap has no last point |
| Direction color | The line is never red or green. The adjacent delta cell carries color when warranted |
| Empty | 1 px dashed `border` line across the full width |
| Tooltip | On hover or cell focus: last 7 values with dates in a mini table |
| Accessibility | `role="img"` with an accessible name such as "Rank trend over 30 days: from 8 to 3, improving"; the full data is in the inspector |

Use sparklines for ranking history, visibility, mention rate, citation rate, traffic and cost. Never add axes, labels or legends to a sparkline.

## 10. Tooltips in charts

- Time series: one shared tooltip at the crosshair, date title (`Sep 29, 2026`, `type-subsection-title`: 14 px weight 600), then one row per visible series sorted by value (best first; for ranks, lowest first): 8 px dot, name, right-aligned value, `k of n` or interval where relevant. Styling is in section 4 (Tooltip).
- Values use `@/lib/format`, identical to tables.
- Tooltip width max 320 px; more than 8 series rows collapse to top 7 plus "and 3 more".
- Tooltips follow the pointer on desktop and are pinned (click to pin, Escape to unpin) when the user needs to read them; pinned tooltips are hoverable (WCAG 1.4.13).

## 11. Accessibility

| Requirement | Implementation |
|---|---|
| Text summary | Every `ChartFrame` has an `aria-describedby` summary sentence produced by the feature component ("ChatGPT mention rate 47.2%, up 1.1 points over 28 days, within normal variation") and passes it as ECharts `aria.label.description`, because the automatic description covers only 10 series and 10 points (verified in `research/10-a11y-dense-ui.md`) |
| Data table | `Table` toggle renders the full data with n and interval columns |
| Non-color encodings | Per [20-accessibility.md](20-accessibility.md) section 12.2 (binding): own brand 2 px with circle markers, competitor marker shapes in fixed order, reference dashed `[4, 4]`, Other dashed `[8, 4]`, estimates dotted; deep checks use diamonds; hollow markers for insufficient data; `Patterns` toggle enables ECharts decals for bars and areas |
| Keyboard | Chart canvases are not keyboard-navigable point by point (ECharts has no documented support); the table toggle and the linked table are the keyboard path. The chart container is focusable only when it offers interactions (matrix selection) |
| Contrast | Every series color `chart-1` to `chart-6` and `chart-other` meets 3:1 against the surface in both themes (tested; the lowest are orange 3.4:1 and teal 3.5:1 in light). `chart-bar-neutral` is exempt only in `BarList`, where each bar has its value as text (section 5.1). Text inside chart marks meets 4.5:1 (section 5.2) |
| Forced colors | Chart canvases use `forced-color-adjust: none` (data colors carry meaning); the frame, legend and labels follow system colors |

## 12. Performance

- Tree-shaken ECharts bundle loaded only on chart routes (budget: 170 KB gzip chunk).
- LTTB sampling (`sampling: 'lttb'`) for line series over 2,000 points; the API downsamples daily data to weekly for windows over 180 days.
- Hidden series are removed from the option, not just hidden, when there are more than 6.
- One ECharts instance per visible chart; charts below the fold mount when they enter the viewport (IntersectionObserver).
- Resize work is throttled to animation frames by the wrapper.
