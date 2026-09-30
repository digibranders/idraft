# 04. Spacing and Density

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: Tailwind `--spacing: 0.25rem` and named size utilities in [`globals.css`](../../apps/web/src/styles/globals.css); size tokens in [`tokens.css`](../../apps/web/src/styles/tokens.css)

## 1. Spacing scale

4 px base. Only these steps are allowed in padding, margin and gap utilities:

| Step | Utility suffix | px | Typical use |
|---|---|---|---|
| 0 | `0` | 0 | Reset |
| 0.5 | `0.5` | 2 | Icon to counter |
| 1 | `1` | 4 | Page title to meta line, gap between sidebar items, icon to label inside badges, tight inline groups |
| 1.5 | `1.5` | 6 | Icon to label in chips and tabs, between toolbar buttons |
| 2 | `2` | 8 | Icon to label in buttons, badge horizontal padding, sidebar item inset, inspector title to badges, button group gap |
| 3 | `3` | 12 | Table cell and control horizontal padding, key-value cell padding, quote box padding, sidebar icon to label, gap between top-bar controls |
| 4 | `4` | 16 | Panel padding, gap between page blocks, space between sidebar groups, gap between form fields vertically |
| 5 | `5` | 20 | Page gutter, inspector padding, metric strip cell padding, page header offset below the top bar |
| 6 | `6` | 24 | Gap between underline tab labels, dialog padding |
| 8 | `8` | 32 | Gap between major page regions, empty state padding |
| 10 | `10` | 40 | Onboarding and auth layouts only |
| 12 | `12` | 48 | Onboarding and auth layouts; the bottom reserve of a settings form with a save bar ([10-forms.md](10-forms.md) section 13.2) |

Not allowed: `7`, `9`, `11`, fractional steps other than `0.5` and `1.5`, and arbitrary values (`p-[13px]`). Lint enforces this ([26-implementation-guidelines.md](26-implementation-guidelines.md) section 9).

### 1.1 Spacing roles

Values follow [reference/visual-spec.md](reference/visual-spec.md) section 4.

| Role | Value |
|---|---|
| Page gutter (desktop, at least 1024 px) | 20 px (`px-5`) |
| Page gutter (tablet) | 16 px (`px-4`) |
| Page gutter (mobile) | 12 px (`px-3`) |
| Page header | Starts 20 px below the top bar; meta line 4 px below the title; actions right-aligned and vertically centered on the title block |
| Between page blocks (header to metric strip, strip to filter bar, panel to panel) | 16 px |
| Panel padding | 16 px; panel title row 48 px |
| Metric strip cell padding | 20 px |
| Inspector content padding | 20 px; badges 8 px below the inspector title |
| Key-value grid cell padding | 12 px |
| Quote box padding | 12 px |
| Sidebar items | 4 px apart, 8 px inset from the sidebar edge; 16 px of space between groups (no divider lines); group label 16 px above and 4 px below |
| Top-bar controls | 12 px apart, right-aligned |
| Underline tabs | 24 px between labels |
| Dialog padding | 24 px header and body, 16 px footer vertical |
| Form field vertical gap | 16 px (stacked), 12 px column gap (inline) |
| Label to control | 6 px |
| Control to helper text | 6 px |
| Button group gap | 8 px (6 px in toolbars) |
| Icon to text | 8 px in buttons and menu items, 12 px in sidebar items, 6 px in chips and tabs, 4 px in badges |

## 2. Component heights

| Element | Height | Token or utility |
|---|---|---|
| Control, default (button, input, select, combobox, date range, search field, filter button, segmented control, applied filter chip) | **36 px** | `h-control` (`--size-control`) |
| Control, small (pagination buttons, icon buttons in tables and inspectors) | **32 px** | `h-control-sm` (`--size-control-sm`) |
| Control, large (auth screens, onboarding primary action only) | 40 px | `h-control-lg` (`--size-control-lg`) |
| Checkbox | 16 px box, radius 4, inside a 24 px hit area | `size-4` in a `size-6` target |
| Radio | 16 px circle (the same size as the checkbox), inside a 24 px hit area | `size-4` in a `size-6` target |
| Switch | 36 x 20 px track, 24 px hit area | component |
| Table row, default | **40 px** | `h-row` (`--size-row`) |
| Table row, compact (Compact density setting; tables embedded in panels and inspectors) | **32 px** | `h-row-compact` (`--size-row-compact`) |
| Table header row | 40 px | `h-row-header` (`--size-row-header`) |
| Table toolbar (and the bulk bar that replaces it) | 48 px, the panel title row height (32 px controls, 8 px vertical padding) | component ([12-tables.md](12-tables.md) section 1) |
| Table footer (`TableFooter`, holds pagination in server mode) | 48 px: the range text and 32 px pagination buttons | component ([12-tables.md](12-tables.md) section 1) |
| Menu, select and combobox option row | 32 px | component ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.2, [10-forms.md](10-forms.md) section 6) |
| Menu group label row | 28 px, not focusable | component ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.2) |
| Sidebar navigation item | 32 px | `h-sidebar-item` (`--size-sidebar-item`) ([11-navigation.md](11-navigation.md) section 2) |
| Underline tab row (page and inspector) | 44 px including the 2 px indicator | `h-tab` (`--size-tab`) |
| Top bar | 52 px | `h-topbar` (`--size-topbar`) |
| Page header title block | 56 px: title 32 (`type-page-title`), 4 px gap, meta line 20 (`type-meta`); 20 px below the top bar ([23-application-patterns.md](23-application-patterns.md) section 3.2) | component |
| Metric strip | 76 px, one panel; 96 px when items carry context lines ([23-application-patterns.md](23-application-patterns.md) section 2.2) | `h-metric-strip` (`--size-metric-strip`) |
| Panel title row | 48 px | component |
| Change feed row | 36 px | component ([23-application-patterns.md](23-application-patterns.md) section 9) |
| Badge | 22 px, 8 px horizontal padding | `h-badge` (`--size-badge`) |
| Avatar | 32 px | `size-avatar` (`--size-avatar`) |
| Settings save bar | 56 px | `h-save-bar` (`--size-save-bar`) ([10-forms.md](10-forms.md) section 13.2) |
| Toast | 40 px minimum | component |
| Bar list bar | 24 px, `rounded-2xs` (2 px) | component ([15-data-visualization.md](15-data-visualization.md) section 5.1) |
| 100% stacked bar | 32 px | component ([15-data-visualization.md](15-data-visualization.md)) |
| Sparkline | 20 px tall in 40 px rows, 16 px in 32 px rows | component |

No desktop control is taller than 40 px. Touch-sized targets appear only in the mobile layout ([19-responsive-behavior.md](19-responsive-behavior.md)).

Minimum target size is 24 by 24 px (WCAG 2.5.8). Icon buttons inside 32 px rows are 24 px squares with a 14 px icon; icon buttons elsewhere are 32 px squares (`size-control-sm`).

## 3. Density modes

Two modes exist for full-page tables and lists. Controls, typography and spacing outside tables do not change with density. Tables embedded in panels and inspectors (mini tables) always use 32 px rows and do not follow the setting.

| Property | Default | Compact |
|---|---|---|
| Row height | 40 px (`h-row`) | 32 px (`h-row-compact`) |
| Header row | 40 px | 40 px |
| Cell horizontal padding | 12 px | 12 px |
| Cell vertical padding | 10 px (derived from row height and 20 px line height) | 6 px |
| Font | `type-table` 13 / 20 | `type-table` 13 / 20 |
| Secondary line in a cell | shown when the column defines one ([12-tables.md](12-tables.md) section 6) | not shown (moves to tooltip or inspector) |
| Sparkline height | 20 px | 16 px |
| Rows visible in a 900 px tall viewport (T2 with a metric strip, no tabs) | 11 | 14 |

Rows visible: 900 px minus 424 px of chrome (top bar 52, header offset 20, title block 56, metric strip 76, filter bar 36, three 16 px gaps, table toolbar 48, table header 40, table footer 48) leaves 476 px; divided by the row height that is 11 rows at 40 px and 14 rows at 32 px, the same budget as [24-page-templates.md](24-page-templates.md) section 4.

Rules:
- The density toggle lives in the table toolbar (a two-option segmented control with icons and labels "Default" and "Compact") and persists per user per table in the saved-view state ([12-tables.md](12-tables.md) section 11).
- Density changes row height only. It never changes font size.
- Tables whose rows need two lines of content (for example the discovery inbox with evidence) are designed for Default density; in Compact their second line moves to the tooltip or inspector.

## 4. Density without clutter

The techniques that create density in this system, in order of preference:

1. **Alignment** on a shared left edge and right-aligned numeric columns.
2. **Typographic hierarchy** (color step and weight) instead of boxes.
3. **Grouping by whitespace or a single divider**, not a border around each group.
4. **Progressive disclosure**: tooltip, inspector, full page ([23-application-patterns.md](23-application-patterns.md) section 1).
5. **Pinned context**: sticky header, pinned identity column, sticky filter bar.
6. **Compact filters**: triggers plus chips, never a form above a table.
7. **Sparklines** in place of mini charts.
8. **Hover actions**: row actions appear on hover and on keyboard focus of the row, with a persistent "More" menu for touch and screen readers.
9. **Expandable rows** only when the child content is a short list of the same kind of item.

Avoid: borders on every element, shrinking fonts below the scale, showing all metadata at once, a badge for every attribute, and multi-line cells in compact mode.
