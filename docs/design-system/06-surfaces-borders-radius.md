# 06. Surfaces, Borders, Radius and Elevation

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Visual source: [reference/visual-spec.md](reference/visual-spec.md) sections 1, 4 and 5

## 1. Surface model

Hierarchy comes from tonal steps and 1 px hairline borders. Shadows are reserved for things that float above the page.

| Layer | Token | Examples |
|---|---|---|
| Navigation | `sidebar` | Left sidebar, one step darker than the canvas, with a hairline right edge |
| Canvas | `background` | Page background behind the page header and panels |
| Surface | `surface` | Top bar, panels (including the tables inside them), metric strip, inspector, inputs, cards |
| Subtle | `surface-subtle` | Table header row, quote boxes, code blocks, wells, skeletons |
| Elevated | `surface-elevated` + shadow | Popovers, menus, dialogs, command palette, toasts, chart tooltips |

Rules:
1. A panel on the canvas is `surface` with a 1 px `border`, radius 8 px, 16 px padding and a 48 px title row. No shadow.
2. Panels are not nested. A panel never contains another bordered panel; subdivisions use `border-subtle` dividers or `surface-subtle` wells. One exception: the inspector is a card whose body is a column of cards ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.4). Its own fill is `background`, not `surface`, so the cards inside it read the way panels do on a page.
3. Tables sit inside a panel (1 px `border`, radius 8). The table itself has no outer border; the panel provides it.
4. The top bar is `surface` with a bottom hairline and always spans the full width. The inspector is a floating card under it: `background` fill, 1 px `border`, radius 10 px, `shadow-inspector`, 12 px from the top bar and the window edges.
5. Hover and selected states change the background token (and, for selection, the key text color to `primary-text`), never the shadow. The one selection state that adds an outline is the selected segment of a segmented control (`primary-border`).

## 2. Borders

| Token | Width | Use |
|---|---|---|
| `border-subtle` | 1 px | Table row dividers, dividers inside panels, vertical dividers between table header cells, key-value grid cells, quote box outline, sidebar and top bar edges, chart gridlines (dashed, as `chart-grid`) |
| `border` | 1 px | Panel outlines, popover and chart tooltip outlines, secondary and filter button outlines, text inputs, selects and the search field, pagination buttons, segmented control group, count tab items, table header bottom, the line under an underline tab row |
| `border-strong` | 1 px | Checkboxes, radios and the off state of switches: controls identified by their outline alone, which must meet 3:1 |
| `ring` | 2 px outline, 2 px offset | Focus (never replaced by a border color change alone) |
| `negative-solid` | 1 px | Invalid form control |
| `primary-border` | 1 px | Selected segment in a segmented control, selected option cards, drop target highlight |

Text inputs, selects and the search field use the light `border`, as the reference screens show. They are not identified by their outline alone: each has a visible label (above the field, or a leading icon and placeholder in the search field) and a 2 px `ring` on focus ([20-accessibility.md](20-accessibility.md) section 6). Checkboxes, radios and switches have no other identifying cue, so they keep `border-strong`.

Table dividers: body rows have horizontal `border-subtle` dividers only. The header row (40 px, `surface-subtle`) has 1 px vertical dividers between header cells; body cells have none. Zebra striping is not used ([12-tables.md](12-tables.md) section 3).

## 3. Radius

| Token | px | Elements |
|---|---|---|
| `rounded-2xs` | 2 | Bar-list bars, 8 px engine presence squares |
| `rounded-xs` | 3 | Citation markers ("[1]") and the own-brand highlight in answer text, small swatches |
| `rounded-sm` | 4 | Badges, count badges, checkboxes, keyboard hint box (⌘K), tags, progress bars |
| `rounded-md` | 6 | Buttons (including table-inline buttons), inputs, selects, search field, filter chips, segmented controls, sidebar items, workspace monogram, menu items, tooltips, quote boxes, 100% stacked bars, option cards (radio cards) |
| `rounded-lg` | 8 | Panels (and the tables inside them), metric strip, key-value grid (outside corners), cards, popovers, menus, chart tooltips, toasts |
| `rounded-xl` | 10 | Dialogs, command palette |
| `rounded-full` | full | Avatars, switch track and thumb, slider track and thumb, status dots, engine status glyphs, radio |

There is no radius above 10 px. Pill shapes (`rounded-full` on a text element) are not used for badges or chips; they are reserved for the elements listed.

## 4. Elevation (shadows)

| Token | Light | Dark | Use |
|---|---|---|---|
| `shadow-popover` | two layers: 1 px offset with 2 px blur at 6%, and 4 px offset with 12 px blur at 8% | 1 px ring + 20 px blur | Popovers, menus, selects, tooltips, chart tooltips, date pickers |
| `shadow-dialog` | two layers: 2 px offset with 4 px blur at 6%, and 12 px offset with 32 px blur at 14% | 1 px ring + 40 px blur | Dialogs, command palette |
| `shadow-drag` | 16 px blur | ring + blur | Dragged column header or row |
| `shadow-inspector` | 2 px contact shadow + 28 px blur at 12% | 32 px blur at 50% | The inspector card, docked or overlaying. Not used by the full-screen sheet below 768 px |

Shadows are tinted with the foreground hue (never pure black). Nothing on the canvas (panels, cards, tables, metric strip) has a shadow. The inspector is the one floating surface that stays open beside the page, and it has one.

## 5. Dividers and separators

- Horizontal divider: 1 px `border-subtle`, full width of its container, margin by spacing role (usually 0 when separating regions, 4 px vertical margin inside menus, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.2).
- Vertical divider in metric strips: 1 px `border-subtle` (1 px `border` between channel groups), full height of the 76 px strip; each cell has 20 px padding ([23-application-patterns.md](23-application-patterns.md) section 2.1).
- Vertical divider in table header rows: 1 px `border-subtle` between header cells, full height of the 40 px row. Body rows have no vertical dividers.
- Vertical divider in toolbars: 1 px `border-subtle`, 24 px tall (`h-6`), 6 px horizontal space on each side ([09-buttons-controls.md](09-buttons-controls.md) section 7).
- The middle dot (`·`) separates inline metadata at most once per line; beyond two items, use separate columns or a second line.

## 6. Cards

A card is a bordered `surface` with radius 8 px and 16 px padding. It is allowed only for:
- a grouped conceptual summary that is not a list of records (for example "Collection health" in Overview),
- small collections of fewer than six objects that are not compared (integration connections),
- object previews (a SERP result preview, a citation preview),
- genuinely spatial information (the SEO/AI matrix quadrant summary).

A list of analytical records is never rendered as cards ([12-tables.md](12-tables.md) section 2).
