# Visual Spec From the Reference Screens

Status: Accepted (design-system v2 visual layer)
Last updated: 2026-09-29

This document records what the seven reference screens in [README.md](README.md) look like, element by element, and turns each observation into one value. It is the source for the v2 visual update of the design system: tokens, type scale, sizes and component styling in documents 00 to 27 follow it.

**Scope.** It covers appearance only: color, type, size, spacing, radius, borders and component styling. Product and data rules do not change. That means the information architecture ([11-navigation.md](../11-navigation.md) section 1), when a delta is colored (detectability, [14-badges-status.md](../14-badges-status.md) section 5), denominators and sample sizes, `n/a` for unknowns, and the no-dash text rule all stay as they are.

**Hex values** are computed from the OKLCH values in `tokens.css`, which are the tested source; a few differ from the colors picked off the screens by 1 to 3 levels in one channel.

**Method.** Each screen was reviewed visually at full size and in zoomed sections. Where screens disagree (they were generated one at a time), the value used is the one most screens show, and the table names the exceptions. Pixel values are CSS px at 100% zoom on a 1536 px wide viewport; tolerance is about 2 px.

## 1. Overall character

- Light, airy, precise. White panels on a very light cool gray canvas, with a slightly darker gray sidebar.
- One vivid cobalt accent. It is brighter and more saturated than the v1 cobalt.
- Comfortable density: 14 px interface text, 36 px controls, 40 px table rows. Real data still starts about 130 px below the top bar.
- Depth comes from hairline borders and tonal steps. Only overlays (tooltips, menus) have shadows.
- Panels have an 8 px radius, controls 6 px and badges 4 px. There are no pill shapes, except the toggle switch and avatars.

## 2. Color

### 2.1 Light theme

| Role | Appearance | Token | Value |
|---|---|---|---|
| Canvas | Very light cool gray behind panels | `--background` | `#F7F8FA` |
| Sidebar | A step darker than the canvas, with a hairline right edge | `--sidebar` | `#F2F3F5` |
| Panels, top bar, inspector, inputs | Near white | `--surface` | `#FEFEFF` |
| Table header, quote boxes, wells | Same tone as the canvas | `--surface-subtle` | `#F7F8FA` |
| Row and item hover | Light gray | `--surface-hover` | `#F1F3F5` |
| Selected row, active nav item, active segment | Pale blue | `--surface-selected`, `--primary-subtle` | `#EAF1FE` |
| Panel and control outlines | Light cool gray hairline | `--border` | `#E3E6EA` |
| Row dividers, inner separators | Lighter hairline | `--border-subtle` | `#ECEEF1` |
| Checkbox and radio outlines | Medium gray (3:1) | `--border-strong` | `#81878F` |
| Primary text, values | Near black | `--foreground` | `#14171C` |
| Nav labels, body secondary | Dark gray | `--foreground-secondary` | `#3F4550` |
| Meta, labels, table headers, axis labels | Mid gray | `--foreground-tertiary` | `#626A76` |
| Accent (buttons, active tab, links, own series) | Vivid cobalt | `--primary` | `#1E65E3` |
| Accent text on tints | Slightly deeper cobalt | `--primary-text` | `#175AD0` |
| Accent outline (active segment, focus-adjacent) | Soft blue | `--primary-border` | `#B5CCF6` |
| Positive text (up arrows, gains, "+2.1 pts") | Clear green | `--positive-text` | `#197A43` |
| Positive tint (Cited, Owned badges) | Mint | `--positive-subtle` | `#E3F5EA` |
| Negative text (down arrows, losses) | Clear red | `--negative-text` | `#C8322B` |
| Neutral badge fill | Light gray | `--neutral-subtle` | `#EEF0F3` |
| Neutral badge text | Dark gray | `--neutral-text` | `#454C58` |

### 2.2 Dark theme (screen 7)

| Role | Appearance | Value |
|---|---|---|
| Sidebar | Darkest layer, near black but not black | `#0B0D10` |
| Canvas | Very dark gray | `#0F1113` |
| Panels, top bar | One step lighter | `#131518` |
| Table header | One more step | `#181A1C` |
| Selected row, active nav item | Dark blue tint | `#1A2740` |
| Borders | `#212326` inside panels, `#2C2E31` around panels | |
| Text | `#EBEDEF`, secondary `#BABEC3`, meta `#979CA2` | |
| Accent | Fill `#356DDC`; accent text, checks and own series `#7FAAFA` | |
| Positive, negative | Mint `#4CC38A`, coral `#F1707B` | |
| Neutral badge | Fill `#26292D`, text `#C4C8CD` | |
| Workspace monogram | Cobalt square with a white letter (light theme: near-black square) | |

### 2.3 Chart colors

| Series | Appearance | Light | Dark |
|---|---|---|---|
| 1, own brand | Vivid cobalt | `#1E65E3` | `#6A9CF8` |
| 2 | Warm orange | `#DD6A21` | `#F59A55` |
| 3 | Teal | `#1B969C` | `#5CC9CF` |
| 4 | Purple plum | `#8A3C9B` | `#AD71BF` |
| 5 | Olive | `#6D6111` | `#94873E` |
| 6 | Rose | `#B84379` | `#ED83B4` |
| All, Other | Mid gray | `#6B7280` | `#8E949C` |
| Competitor bars (bar lists) | Light gray | `#D5D8DE` | `#3A3E44` |

Two values are deliberately darker than the screens show. Olive (series 5) is `#6D6111` rather than `#857829`, and the dark plum and olive are slightly darker, because the screen values make orange and olive indistinguishable for red-green color vision (CIEDE2000 1.3 against a minimum of 8 in `tokens.contrast.test.ts`). The checkbox outline is a shade darker than the screens for the same reason (3:1 against tinted rows).

Lines are 2 px. Gridlines are 1 px dashed in `--border-subtle`. Legends use 8 px filled dots at the top right of the panel, or below the chart when values are shown.

## 3. Typography

Geist Sans throughout. Geist Mono for URLs, domains in dense tables, and code.

| Style | Size / line | Weight | Seen in | Utility |
|---|---|---|---|---|
| Page title | 24 / 32 | 600, tracking -0.015em | "Rankings", "Prompts", "Citations" (screens 1 and 3 show larger, 28 to 30) | `type-page-title` |
| Inspector title | 18 / 26 | 600 | "best crm for startups" in the inspector, "Alert rules" | `type-inspector-title` |
| Panel title | 16 / 24 | 600 | "Topics", "Ranking history", "AI answers" | `type-section-title` |
| Section title | 14 / 20 | 600 | "Position history (90 days)", "Sources", day headers "Today" | `type-subsection-title` |
| Body, nav, controls | 14 / 20 | 400 | Sidebar labels, buttons, inputs, tabs | `type-body` |
| Body strong | 14 / 20 | 500 | Active tab, active nav item, button labels, entity names in feeds | `type-body-strong` |
| Answer text | 14 / 22 | 400 | Latest answer in the prompt inspector | `type-prose` |
| Table cell | 13 / 20 | 400 | All table body text | `type-table` |
| Meta | 13 / 20 | 400, tertiary | Meta line under titles, times, "6h ago", metric labels | `type-meta` |
| Label | 12 / 16 | 400, tertiary | Table headers, key-value labels, legends, axis labels, group labels | `type-label` |
| Badge | 12 / 16 | 500 | "Commercial", "cited", "Ranking" | `type-micro` |
| Metric value | 24 / 32 | 600, tracking -0.02em, tabular | Metric strip values | `type-metric` |
| Key-value value | 18 / 24 | 600, tabular | Inspector key-value grid values | `type-metric-sm` |
| Mono | 13 / 20 | 400 | URLs and domains in tables | `type-mono` |
| Keyboard hint | 11 / 16 | 500 | "⌘K" | `type-kbd` |

The base font size of the application body is 14 px.

## 4. Sizes and spacing

| Element | Value | Notes |
|---|---|---|
| Viewport reference | 1536 x 1024 | Every screen |
| Sidebar width | 208 px | Screens 2, 4 to 7 (screens 1 and 3 slightly wider) |
| Sidebar item | 32 px tall, 4 px apart, 8 px inset from the sidebar edge, radius 6, 12 px icon-to-label gap, 18 px icons | |
| Sidebar group label | 12 px, tertiary, 16 px above, 4 px below | "SEO", "AI visibility" |
| Sidebar groups | Separated by 16 px of space, no divider lines | |
| Workspace switcher | 28 px near-black square monogram (radius 6), name 15 px semibold, chevron | Top of the sidebar, 12 px from the top |
| Sidebar footer | Collection status in 12 px tertiary, 16 px from the bottom | |
| Top bar | 52 px tall, `--surface` background, bottom hairline | |
| Top-bar controls | 36 px: search (360 to 440 px wide, with a ⌘K hint box), date range, location, 32 px avatar | Right-aligned, 12 px apart |
| Page gutter | 20 px left and right | |
| Page header | Title, then meta line 4 px below; 20 px from the top bar; actions right-aligned and vertically centered on the title block | |
| Gap between page blocks | 16 px | Header to metric strip, strip to filter bar, panel to panel |
| Panel | `--surface`, 1 px `--border`, radius 8, 16 px padding, title row 48 px | |
| Metric strip | One panel, 76 px tall, cells split by full-height 1 px dividers, 20 px cell padding; label on top, value below with the delta inline to its right. When cells carry a context line (sample size, denominator), it sits on its own line below the value and the strip is 96 px; this keeps it readable at every width instead of truncating to a few letters | Screens 2, 5, 7 (screens 1 and 3 show inset dividers and the delta below) |
| Default control | 36 px, radius 6 | Buttons, inputs, selects, filter buttons, segmented controls, filter chips |
| Small control | 32 px | Pagination, icon buttons in tables and inspectors |
| Large control | 40 px | Auth and onboarding only |
| Table header row | 40 px, `--surface-subtle`, 1 px vertical dividers between header cells | |
| Table row | 40 px default, 32 px for tables embedded in panels and inspectors | Screens 2 and 4 show 44, screen 7 shows 36 |
| Checkbox | 16 px, radius 4 | |
| Badge | 22 px tall, 8 px horizontal padding, radius 4 | |
| Inspector | 400 px default, 440 px for the prompt and citation inspectors. A floating card under the top bar: `--background` fill, 1 px `--border`, radius 10, `shadow-inspector`, 12 px from the top bar and the window edges; 16 px padding; sections are `--surface` cards 12 px apart | First reference batch (the topic drawer), by user decision; widths from screens 2 and 4 |
| Inspector header | Title with the command button, More (`EllipsisVertical`) and close at the top right; badges 8 px below; then the context line with previous and next; then the tabs | First reference batch |
| Tabs | 44 px tall, 14 px labels, 24 px apart; active label cobalt 500 with a 2 px cobalt underline; 1 px bottom border across the tab row | |
| Inspector metric cards | 3 separate cards in a row, 12 px apart: 1 px `--border`, radius 8, 12 px padding; label, value (18 / 24), then a delta or context line | First reference batch |
| Inspector cards | Icon and title in a 48 px header, one control at the right (select, "View all" or a badge); chart with its legend underneath; bar list with 8 px pill bars on a track; tables edge to edge | First reference batch |

## 5. Components

| Component | What the screens show |
|---|---|
| Primary button | Solid cobalt, white 14 px 500 label, optional 16 px icon on the left, 36 px, radius 6 |
| Secondary button | `--surface` fill, 1 px `--border`, dark label, optional icon |
| Icon button | 32 px, no border, gray icon; darker on hover |
| Search field | `--surface`, 1 px `--border`, 16 px search icon, placeholder in tertiary, ⌘K hint in a small gray box (radius 4) on the right |
| Filter button | Secondary button with a chevron ("Tag", "Intent", "Position") |
| Applied filter chip | `--neutral-subtle` fill, no border, 36 px, radius 6, label "Tag: crm" and a 14 px × icon |
| Segmented control | Bordered group with inner dividers; selected segment in `--primary-subtle` fill, `--primary-border` outline and `--primary-text` 500 label |
| Count tabs (feed types) | Separate bordered items with a count badge; the selected item is solid cobalt with a white label and a deeper blue count badge; others have gray count badges (screen 6) |
| Underline tabs | Section 4 |
| Checkbox | Unchecked: `--border-strong` outline. Checked: solid cobalt with a white check |
| Toggle switch | 36 x 20, cobalt track when on, white thumb |
| Pagination | "Showing 1 to 16 of 412 prompts" on the left; 32 px square page buttons with a border; the current page in pale blue with cobalt text |
| Neutral badge | `--neutral-subtle` fill, `--neutral-text` label, optional 1 px `--neutral-border` |
| Positive badge | `--positive-subtle` fill, `--positive-text` label, optional check icon ("Cited", "Owned", "Cited · source 2 of 5") |
| Metric strip | Section 4 |
| Data table | Inside a panel. Header row in `--surface-subtle` with 12 px tertiary labels and faint vertical dividers. Rows divided by `--border-subtle`. Numbers right-aligned and tabular. URLs in mono, truncated with an ellipsis. Selected row in `--surface-selected` with the key text in `--primary-text` |
| Rank change | Arrow glyph and number ("↑ 3", "↓ 2") in positive or negative text; "0" in neutral |
| Engine status glyph | Cited: 10 px filled cobalt circle. Mentioned: 10 px cobalt ring. Not mentioned: 6 px light gray dot. A legend with the same glyphs sits in the filter bar |
| Engine presence square | 8 px square, radius 2: cobalt when present, `--border` gray when absent |
| AI Overview cell | Cobalt check when present, positive "cited" badge when the own domain is cited |
| SERP feature icons | 16 px gray outline icons in a row |
| Bar list (share of voice) | Label column (own domain in 600), 24 px bars with radius 2, own bar cobalt, others light gray, value in 13 px tertiary after the bar |
| 100% stacked bar | 32 px tall, radius 6, 1 px gaps between segments, white 12 px percentage labels inside each segment of 6% or more, legend table below |
| Line chart | Section 2.3; y axis labels on the left in 12 px tertiary; x axis dates below; rank charts put 1 at the top |
| Chart tooltip | `--surface-elevated`, 1 px `--border`, radius 8, popover shadow, date in 13 px 600, rows with dot, name and right-aligned value |
| Sparkline | 1.5 px, gray; own row in cobalt |
| Quote box | `--surface-subtle` fill, 1 px `--border-subtle`, radius 6, 12 px padding, 13 px text in quotes |
| Domain chip | Neutral badge style, 22 px, for cited sources, with a "+2" overflow chip |
| Answer text | 14 / 22; the brand name highlighted with `--primary-subtle` behind `--primary-text` 500; citation markers "[1]" in `--primary-text` on `--primary-subtle`, radius 3 |
| Mini table (inspector) | 32 px rows, 12 px header labels, own row in `--surface-selected` with `--primary-text` |
| Change feed | One panel per day. Header row "Today · 7 events" (14 px 600 plus meta). 36 px rows: time (13 px tabular tertiary), 16 px icon (green or red trend icons for rank moves, gray otherwise), sentence with entity names in 500 and links in cobalt, neutral type badge, source in meta, right-aligned "View" link |
| Rule list | Panel with rows: 16 px icon, 14 px 600 title, 13 px tertiary description, toggle on the right |
| Avatar | 32 px circle; photo or initials on `--neutral-subtle` |
| Right rail layout | Detail pages use a 12-column grid: 8 columns of evidence (charts, tables) and a 4-column rail of stacked panels (AI answers, SERP features, recent changes) (screen 3) |

## 6. Decisions where the screens are silent or unsafe

| Item | Decision | Why |
|---|---|---|
| CountTabs count badge on the selected item | `primary-hover` fill with `primary-foreground` text (6.2:1) | The "deeper blue" badge in screen 6, from an existing token |
| 100% stacked bar segment labels | White where it reaches 4.5:1 on the segment; otherwise `foreground`; otherwise the label is omitted and shown in the legend table | White fails on orange and teal (3.4:1 and 3.6:1) and on every dark chart color |
| Table toolbar and table footer | 48 px, the same as the panel title row | 36 px controls need 6 px above and below |
| Change feed day header | 40 px row inside the day panel | Screen 6 proportions |
| Rank move icons in feeds | `TrendingUp` and `TrendingDown`, in positive or negative text only when the move is emphasized | Screen 6; the detectability rule still decides the color |
| Pagination in data tables | The "Showing 1 to 200 of 12,480 keywords" text and previous and next buttons (32 px, bordered). No numbered pages, because table pagination is cursor-based | Screen 4 styling; product rule unchanged |
| Hover actions inside table cells (copy, open) | 24 px icon buttons | They sit inside 32 px compact rows |
| Metric second line in table cells (`612 of 1,296 obs`) | `type-label` (12/16) under the value in Default density; tooltip only in Compact | 13/20 meta does not fit a 40 px row |
| Rank change text | "↑5" (no space) as returned by `formatRankChange` | Formatting rules are unchanged; the screens' "↑ 3" spacing is not copied |
| Date range and location controls | In the top bar, as project-wide scope. Location shows on every screen that aggregates data from several markets, and is hidden on single-market records (keyword and prompt detail, which state their market in the meta line) and on screens without a location dimension; the full list is in [13-filters-search.md](../13-filters-search.md) section 4. Screen-specific filters stay in the filter bar | Every screen shows them in the top bar |
| Breadcrumb | Leading `House` icon (16 px, tertiary) for the project root, `ChevronRight` (14 px, muted) separators, ancestors in `foreground-tertiary`, the current page in `foreground` 500 | Every screen |
| Open page (inspector header) | 32 px icon button with `Maximize2` and the tooltip "Open page", next to close (`X`) | Screen 2 |
| Project switcher name | `type-subsection-title` (14/20, 600); the screens show about 15 px, within tolerance | Keeps the type scale at 15 utilities |
| Chart tooltip date | `type-subsection-title` (14/20, 600) | Same reason |
| Segmented control label weight | 400 unselected, 500 selected, with width reserved for the 500 label so segments do not shift | Screen 1 |
| Radio | 16 px, the same as the checkbox | v2 control scale |
| Menu, select and combobox option rows | 32 px | v2 density; the screens show no menus |
| Sparkline gray | `chart-reference` | A quiet mid gray, lighter than text |
| Mentioned glyph ring | 2 px ring in the 10 px circle | No 1.5 px border utility; arbitrary values are not allowed |
| Settings save bar | 56 px (`h-save-bar`) | New token |
| "Real data starts" budget | Within 200 px below the top bar when a page has tabs and a filter bar; about 130 px otherwise | v2 sizes (23 section 3.2) |

## 7. Differences between screens and the value chosen

| Item | Screens | Chosen |
|---|---|---|
| Page title size | 24 (2, 4, 5, 6, 7), 28 to 30 (1, 3) | 24 |
| Table row height | 44 (2, 4), 38 (1), 36 (7), 30 to 32 (3, 5) | 40 default, 32 embedded |
| Metric strip dividers | Full height (2, 5, 7), inset (1, 3) | Full height |
| Metric delta position | Inline (2, 3, 5, 7), below (1) | Inline |
| "Owned" badge color | Positive (3, 5), cobalt tint (4) | Positive |
| Sidebar width | 208 (2, 4 to 7), about 224 to 229 (1, 3) | 208 |
| Inspector width | 400 (2), 440 (4) | 400 default, 440 wide |
