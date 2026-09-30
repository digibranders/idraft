# 10: Accessibility Requirements and Dense Professional UI Patterns

Research date: 2026-09-29. All URLs accessed 2026-09-29 unless stated.

Scope: design system for a dense professional analytics web app (SEO rank tracking and AI visibility): large tables, filters, charts, drawers, command palette.

Labels used:
- **VERIFIED**: read on the primary source (W3C spec, WAI page, official design-system docs, or the product's own source code) at the URL given.
- **INFERRED**: my reasoning or arithmetic from verified facts, or my application of a rule to our app.
- **UNVERIFIED**: secondary source only, or the primary page failed or did not state it.

Numbers taken from source code were read from the default branch on the access date. Source code changes; pin to a commit before copying a value into our tokens.

---

## 0. Headline findings

1. **WCAG 2.2 (W3C Recommendation, 12 December 2024) at Level AA is the compliance bar.** Text 4.5:1, large text 3:1 (large = 18pt / 24px, or 14pt / about 18.5px bold), UI components and graphical objects 3:1. Ratios are thresholds, never rounded: 4.499:1 fails. VERIFIED.
2. **Data tables are explicitly excepted from Reflow (1.4.10)** and may scroll horizontally at 320 CSS px. The table's heading, search field and pagination are not excepted and must reflow. VERIFIED.
3. **Target size (2.5.8, AA) is 24 by 24 CSS px, with a spacing exception** (a 24 px circle centred on each undersized target must not intersect another target or circle). Dense 16 px icon buttons can pass only with spacing. VERIFIED.
4. **Every drag needs a single-pointer, non-drag alternative (2.5.7, AA).** Keyboard support alone does not satisfy it. Column resize and reorder need a menu or buttons. VERIFIED (rule), INFERRED (application to columns; the Understanding doc does not mention tables).
5. **Single-key shortcuts (2.1.4, Level A) must be switchable off, remappable to a modifier, or active only on focus.** GitHub ships a "Character keys" off switch. VERIFIED.
6. **APG: use a native `<table>` for read-only data; use `role="grid"` only when cells are interactive** and you implement roving focus, arrows, Home/End, Ctrl+Home/End, Page Up/Down. For virtualised tables use `aria-rowcount` (or `-1` if unknown) plus `aria-rowindex` on every rendered row. Put `aria-sort` on one header at a time. VERIFIED.
7. **APCA is not normative anywhere in W3C.** The WCAG 3 Working Draft dated 10 September 2026 says the contrast algorithm "is yet to be determined". Use WCAG 2 ratios for compliance and APCA only as an advisory design check. VERIFIED.
8. **ECharts `aria` is off by default.** `aria.enabled: true` generates an `aria-label` description on the chart DOM; `aria.decal.show: true` adds patterns. It does not document keyboard navigation of data points, so pair each chart with a data table. VERIFIED (options), INFERRED (no keyboard support).
9. **Dense products converge on: 14 px UI text, 12 to 13 px table text, 24 / 28 / 32 / 36 / 40 px control ladder, 32 to 48 px rows, 2 px focus rings, 1 px borders instead of shadows, 4 to 8 px default radius, tabular numerals on numbers.** Carbon publishes the clearest density ladder: rows 24 / 32 / 40 / 48 / 64. VERIFIED per product in section B.

---

# Part A: Accessibility requirements

## A1. WCAG 2.2 success criteria relevant to dense data apps (VERIFIED)

Normative source: https://www.w3.org/TR/WCAG22/ (W3C Recommendation 12 December 2024; text extracted from the spec on 2026-09-29). Understanding documents: https://www.w3.org/WAI/WCAG22/Understanding/

| SC | Level | Normative requirement (condensed; key numbers exact) | What it means for our app (INFERRED unless marked) |
|---|---|---|---|
| 1.4.1 Use of Color | A | "Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element." | Rank up/down needs an arrow or sign, not just green/red. Chart series need labels, shapes, dash styles or decals. Links in table text need underline or other non-color cue. |
| 1.4.3 Contrast (Minimum) | AA | Text and images of text at least **4.5:1**. Large-scale text at least **3:1**. Exceptions: inactive UI components, pure decoration, invisible text, text in a picture with significant other content, logotypes. | Muted secondary text in tables must still reach 4.5:1. Disabled controls are exempt. |
| (definition) large scale text | n/a | "at least **18 point** or **14 point bold**". Understanding 1.4.3: 1pt = 1.333px, so 14pt and 18pt are "approximately **18.5px** and **24px**". | Our 12 to 14 px table and UI text is never "large": it always needs 4.5:1. |
| (Understanding) rounding | n/a | "the computed values should not be rounded (e.g., 4.499:1 would not meet the 4.5:1 threshold)" | Token validator must compare unrounded ratios. |
| 1.4.10 Reflow | AA | No two-dimensional scrolling at **320 CSS px** width (vertical content) or **256 CSS px** height (horizontal content), "Except for parts of the content which require two-dimensional layout". 320 px = 1280 px at 400% zoom. Note 2 lists "**data tables (not individual cells)**" and "interfaces where it is necessary to keep toolbars in view". | Rank tables may scroll horizontally inside their own container. Page chrome, filters, table title, search and pagination must reflow. Individual cell content must wrap, not force scrolling. |
| 1.4.11 Non-text Contrast | AA | **3:1** against adjacent colors for (a) visual information required to identify UI components and states, except inactive components and unmodified UA styling; (b) "Parts of graphics required to understand the content". | Input borders, checkbox outlines, toggle states, selected-row indicators, focus rings, chart lines/bars/slices all need 3:1 unless the same information is available as text (labels and values, or a data table). Gridlines do not need 3:1. Hover styling is not "required to identify". |
| 1.4.12 Text Spacing | AA | No loss of content when user sets line height **1.5x**, paragraph spacing **2x**, letter spacing **0.12x**, word spacing **0.16x** the font size. | Fixed-height rows and chips with `overflow:hidden` break this. Use min-height, allow wrap or ellipsis plus full value on focus/hover. |
| 1.4.13 Content on Hover or Focus | AA | Additional content shown on hover/focus must be **Dismissible** (without moving pointer or focus; usually Esc), **Hoverable** (pointer can move onto it), **Persistent** (stays until trigger removed, dismissed, or no longer valid). Exception: UA-controlled content such as `title` tooltips. | Chart tooltips, cell tooltips, sparkline popovers. Add an Esc handler and a hover bridge. Do not auto-hide on a timer. |
| 2.1.1 Keyboard | A | All functionality operable through a keyboard interface without specific timings, except path-dependent input. | Sorting, filtering, column show/hide, row expand, drawer open/close, chart range selection all need keyboard paths. |
| 2.1.4 Character Key Shortcuts | A | If a shortcut uses only letter, punctuation, number or symbol keys, at least one of: **Turn off**; **Remap** to include a non-printable key (Ctrl, Alt); **Active only on focus**. | Linear-style `F` for filter or `/` for search must be switchable off in settings, or scoped to focus. |
| 2.4.3 Focus Order | A | Focus order preserves meaning and operability. | Drawer opens: focus moves in; on close it returns to the invoking row. |
| 2.4.7 Focus Visible | AA | "Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible." | Never `outline:none` without a replacement. Use `:focus-visible`. |
| 2.4.11 Focus Not Obscured (Minimum) | AA (new in 2.2) | Focused component "is not entirely hidden due to author-created content". | Sticky table headers, sticky filter bars, bottom bulk-action bars and toasts must not cover the focused row. Use `scroll-padding-top/bottom` equal to sticky chrome height (sufficient technique in Understanding 2.4.11). |
| 2.4.13 Focus Appearance | AAA (new in 2.2) | Indicator area at least as large as a **2 CSS px thick perimeter** of the unfocused component, and **3:1** between the same pixels in focused and unfocused states. Shadows and glows outside the component do not count toward the perimeter. | Not required for AA. Designing to it (2 px solid ring, 3:1) is cheap and future-proof. |
| 2.5.3 Label in Name | A | Accessible name contains the visible label text. Best practice: label text first. | Icon buttons with visible text must not have a different `aria-label`. "Export CSV" button: name must contain "Export CSV". |
| 2.5.7 Dragging Movements | AA (new in 2.2) | All drag functionality achievable by a single pointer without dragging, unless essential. Understanding: keyboard equivalence alone does not satisfy it "unless that equivalent keyboard operation also provides controls that can be clicked or tapped". | Column reorder: "Move left/right" menu items. Column resize: "Resize column" dialog or +/- buttons, or double-click auto-fit plus numeric input. Chart zoom by brush: add range inputs or preset buttons. |
| 2.5.8 Target Size (Minimum) | AA (new in 2.2) | At least **24 by 24 CSS px**, except **Spacing** (24 px diameter circle centred on each undersized target does not intersect another target or circle), **Equivalent**, **Inline**, **User agent control**, **Essential**. | 16 px row-action icons must be spaced so their 24 px circles do not overlap (in practice about 24 px pitch). Understanding shows 16 px high buttons passing because of vertical spacing. Dense map pins / chart points count as "essential" presentation per Understanding. |
| 3.2.6 Consistent Help | A (new in 2.2) | Help mechanisms repeated across pages (human contact details, contact mechanism, self-help option, automated contact) appear in the same relative order. | Put the help/docs link in one fixed shell location. |
| 3.3.1 Error Identification | A | Automatically detected errors: item identified and error described in text. | Keyword import, domain input, filter value errors: inline text, not only a red border. |
| 3.3.3 Error Suggestion | AA | When suggestions are known, provide them (unless security/purpose). | "Did you mean example.com?" for malformed domains; list valid location codes. |
| 3.3.7 Redundant Entry | A (new in 2.2) | Info previously entered in the same process is auto-populated or selectable, unless essential, security, or no longer valid. | Multi-step project setup: carry domain, competitors, locations forward. |
| 4.1.2 Name, Role, Value | A | Name and role programmatically determinable; states/properties/values settable; changes notified. | Custom selects, toggles, sort buttons, expandable rows need correct roles and `aria-expanded`, `aria-sort`, `aria-selected`, `aria-checked`. |
| 4.1.3 Status Messages | AA | Status messages programmatically determinable via role or properties so AT can present them "without receiving focus". Definition covers results of an action, waiting state, progress, errors. | "1,240 keywords match", "Export started", "Refreshing ranks 40%": use `role="status"` / `aria-live="polite"`; errors that need attention `role="alert"`. |

Additional WCAG notes (VERIFIED from Understanding docs):
- **1.4.11 and focus**: "the visual focus indicator for a component *must* have sufficient contrast against the adjacent background when the component is focused" (Understanding Non-text Contrast). Border-type indicators must contrast with both adjacent colors. https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- **1.4.11 and charts**: pie slice boundaries, each data line against the background need 3:1; background gridlines do not. Alternatives: text labels and values on the chart, a following data table, borders/outlines around low-contrast fills, patterns or shapes. Same page.
- **1.4.11 input example**: a complete input border such as `#767676` "must meet 3:1". Same page.
- **2.4.11 sticky content**: cookie banners and sticky content that entirely obscure the focused item fail; fixes are `scroll-padding`, making the overlay modal, or closing on focus loss. https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- **2.5.7 examples**: sortable list with adjacent move up/down controls; task board with a popup menu to move items; slider track click. https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- **2.1.4 intent**: single-key shortcuts are "disastrous for speech users". Gmail and WordPress are cited as passing examples with disable/customise settings. https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html

Contrast checks on real tokens (INFERRED, computed with the WCAG 2 relative luminance formula):

| Token (product) | Hex on white | Ratio | Passes |
|---|---|---|---|
| Primer `fgColor-muted` | `#59636e` | 6.11:1 | 4.5 text |
| Primer `fgColor-disabled` / `borderColor-emphasis` | `#818b98` | 3.45:1 | 3:1 non-text only |
| Primer `borderColor-default` | `#d1d9e0` | 1.43:1 | Decorative dividers only; fails 1.4.11 if it is the only cue identifying an input |
| Geist gray (light, hex fallback) `#4d4d4d` | | 8.45:1 | 4.5 text |
| Geist gray (light, hex fallback) `#7d7d7d` | | 4.12:1 | 3:1 only |
| WCAG example border `#767676` | | 4.54:1 | 4.5 |
| Carbon `$focus` Blue 60 `#0f62fe` | | 5.00:1 | 3:1 focus |

Takeaway (INFERRED): the common "hairline gray input border" in dense UIs usually fails 1.4.11 on its own. Either use a darker border for form inputs (at least 3:1, e.g. Primer-emphasis class of gray) or rely on a filled field background that itself reaches 3:1 against the page.

## A2. WAI-ARIA Authoring Practices (APG) (VERIFIED)

Sources: https://www.w3.org/WAI/ARIA/apg/patterns/grid/ , /table/ , /treegrid/ , /table/examples/sortable-table/ , /practices/grid-and-table-properties/ , /combobox/ , /dialog-modal/ , /disclosure/ , /menu-button/ , /tabs/ , /tooltip/ , /listbox/

### A2.1 Table vs Grid decision

| | Table pattern | Grid pattern (data grid) |
|---|---|---|
| Use when | Static tabular data; cells not interactive | Cells are interactive or editable; many widgets inside |
| Markup | "authors are strongly encouraged to use a native HTML `table` element whenever possible" | `role="grid"`, `row`, `columnheader`, `rowheader`, `gridcell` (can be applied on an HTML table) |
| Tab stops | "All focusable elements contained in a table are included in the page tab sequence" | One tab stop; roving tabindex (or `aria-activedescendant`); arrows move between cells |
| Keyboard | None defined | See A2.2 |

Recommendation (INFERRED): rank tables where each row has one link and a few row actions should stay a native `<table>` with a sortable header button per column and row actions reachable by Tab. Switch to `role="grid"` only for the bulk-editing view (inline tag editing, cell selection), and then implement the full keyboard model. A half-implemented grid is worse than a table.

### A2.2 Data grid keyboard model

| Key | Action |
|---|---|
| Right / Left / Down / Up Arrow | Move focus one cell |
| Home / End | First / last cell in row |
| Ctrl+Home / Ctrl+End | First / last cell in grid |
| Page Down / Page Up | Move an author-determined number of rows |
| Ctrl+Space | Select column (optional) |
| Shift+Space | Select row (optional) |
| Ctrl+A | Select all cells (optional) |
| Shift+Arrow | Extend selection (optional) |
| Enter | Enter cell (edit mode or focus first widget) |
| F2 | Toggle edit mode |
| Printable character | Starts editing in editable text cell |
| Escape | Leave edit mode, restore grid navigation (may undo) |
| Tab / Shift+Tab (in edit mode) | Move among widgets in the cell |

Roles and properties: `grid`, `row`, `columnheader`, `rowheader`, `gridcell`; `aria-label`/`aria-labelledby` on the grid; `aria-multiselectable`; `aria-selected`; `aria-readonly`; `aria-sort`; `aria-rowcount`, `aria-colcount`, `aria-rowindex`, `aria-colindex`; `aria-rowspan`/`aria-colspan` (only when not using an HTML table).

### A2.3 Sorting (`aria-sort`)

- Values: `ascending`, `descending`, `other`, `none` (default). VERIFIED (Grid and Table Properties practice).
- "ARIA does not provide a way to indicate levels of sort for data sets that have multiple sort keys. Thus, there is limited value to applying aria-sort with a value other than none to more than one column." VERIFIED.
- Sortable Table example: header text wrapped in a `<button>` inside `<th>`; `aria-sort` moved to the newly sorted column; arrow glyphs in a `span` with `aria-hidden="true"` so they are not part of the button name; whole header cell clickable; a visually hidden note in the caption explains that headers are sortable. VERIFIED.
- Multi-column sort (INFERRED): set `aria-sort` on the primary key only; announce secondary keys in a `role="status"` message or visible sort summary chip.

### A2.4 Row selection

- Grid: `aria-selected="true"` on selected rows or cells; `aria-multiselectable="true"` on the grid for multi-select. In multi-select, unselected rows carry `aria-selected="false"` (treegrid wording, same practice). VERIFIED.
- Native table (INFERRED): a checkbox per row with an accessible name that includes the row key ("Select keyword best running shoes") and a header checkbox with `aria-checked="mixed"` state when partially selected. Announce "12 selected" via `role="status"`.

### A2.5 Treegrid for expandable rows

- Right Arrow on a collapsed row expands it; on an expanded row (or a row without children) moves focus to the first cell. Left Arrow on an expanded row collapses it. VERIFIED.
- `aria-expanded` on parent rows only (on the row or a cell in it); rows without children must not carry it, "because ... they would be incorrectly described to assistive technologies as parent rows". VERIFIED.
- Focus may start on the first row or first cell, depending on whether row focus is supported. VERIFIED.
- The APG treegrid page does not list `aria-level`, `aria-setsize`, `aria-posinset` in its roles section (checked in page text). Those are defined in WAI-ARIA 1.2 for `row` in a treegrid; use them when rows are virtualised so depth is announced. INFERRED (not verified against the ARIA spec in this session).
- Recommendation (INFERRED): for "keyword group > keywords" or "prompt > engine answers", prefer a native table with a disclosure button in the first cell (`aria-expanded`, `aria-controls`) over a full treegrid unless keyboard cell navigation is also needed.

### A2.6 Virtualised tables (`aria-rowcount` / `aria-rowindex`)

- Set `aria-rowcount` on the table/grid/treegrid to the total number of rows **including header rows**. "If the total number of rows is unknown, a value of -1 may be specified." VERIFIED.
- When `aria-rowcount` is used, set `aria-rowindex` on **every** rendered row, including header rows. Values: at least 1, strictly increasing, at most the total. VERIFIED.
- "WARNING! Missing or inconsistent values of aria-rowindex could have devastating effects on assistive technology behavior." VERIFIED.
- Columns: same rules with `aria-colcount` / `aria-colindex`; `aria-colindex` may sit on the row when visible columns are contiguous, otherwise on every cell. Indexes start at 1. VERIFIED.

### A2.7 Other APG patterns used in the app

| Pattern | Keyboard (essentials) | Required roles / states |
|---|---|---|
| Combobox (filters, location picker) | Down Arrow opens/moves into popup; Up Arrow (optional) to last; Esc dismisses popup (optionally clears); Enter accepts; Alt+Down opens without moving focus; Alt+Up closes. In listbox popup: arrows move and select; Home/End optional; typing returns to input. Popup and its items are excluded from the Tab sequence. | `role="combobox"` on the input; `aria-controls` to the popup; `aria-expanded`; `aria-haspopup` if popup is `grid`, `tree` or `dialog` (implicit `listbox`); DOM focus stays on combobox, `aria-activedescendant` points at the active option; `aria-selected` on the option; `aria-autocomplete` `none`/`list`/`both`. Use `aria-controls`, not ARIA 1.0 `aria-owns`. |
| Dialog (modal) | Tab and Shift+Tab cycle inside; Esc closes. Initial focus usually first focusable; for dialogs with tables/lists, focus a static element at top (`tabindex="-1"`); for destructive final steps focus the least destructive action. On close, return focus to the invoker (or logical next element if it no longer exists). Include a visible close button. | `role="dialog"`, `aria-modal="true"` (only if it truly behaves modal), `aria-labelledby` to visible title (or `aria-label`), optional `aria-describedby` (omit for structured content). |
| Disclosure | Enter and Space toggle. | `button` with `aria-expanded`; optional `aria-controls`. |
| Menu button | Enter/Space open and focus first item; Down Arrow (optional) first item; Up Arrow (optional) last item. | `button` with `aria-haspopup="menu"` (or `true`), `aria-expanded`, optional `aria-controls` to `role="menu"`. |
| Tabs | Tab enters on the active tab, next Tab goes to panel. Left/Right move (wrap); Home/End optional; Space/Enter activate if not automatic; Delete optional. "It is recommended that tabs activate automatically when they receive focus as long as their associated tab panels are displayed without noticeable latency." Horizontal tablists do not listen for Up/Down. | `tablist` (labelled), `tab` with `aria-selected` and `aria-controls`, `tabpanel` with `aria-labelledby`; `tabindex="0"` on panel if it has no focusable content; `aria-orientation="vertical"` if vertical. |
| Tooltip | Esc dismisses. Focus stays on trigger. Focus-triggered tooltip hides on blur; hover-triggered stays while pointer is over trigger or tooltip. "Tooltip widgets do not receive focus." Content with focusable elements should be a non-modal dialog. Note: APG marks this pattern "work in progress; it does not yet have task force consensus". | `role="tooltip"`; trigger has `aria-describedby` to it. |
| Listbox | Down/Up move; Home/End optional but "strongly recommended for lists with more than five options"; type-ahead "recommended for all listboxes, especially those with more than seven options". Multi-select recommended model: Space toggles, Shift+Arrows extend, Shift+Space range, Ctrl+Shift+Home/End, Ctrl+A. | `listbox`, `option`, `aria-selected`, `aria-multiselectable`, optional `aria-activedescendant`. |

## A3. Charts

### A3.1 Requirements that apply (VERIFIED)

- **1.4.1**: series and states must not be distinguished by color alone.
- **1.4.11**: each data line / bar / slice boundary needs 3:1 against adjacent colors, unless the same information is present as text (data labels with values) or in a nearby data table. Gridlines exempt.
- **1.4.13**: chart tooltips must be dismissible (Esc), hoverable, persistent.
- **2.1.1**: any function in the chart (zoom, legend toggling, series isolation) must be keyboard operable. Reading values is not a "function" in itself, but a data table satisfies access to values (INFERRED).
- **2.5.7**: brush-to-zoom needs a non-drag alternative (date inputs, presets).
- **WAI Images tutorial, complex images**: "a two-part text alternative is required": a short description identifying the image and where the long description is, plus the long description. Options: adjacent link, `figure` + `figcaption`, or `aria-describedby` (with the caveat that AT does not get headings or tables through `aria-describedby`). A data table can serve as the long description. https://www.w3.org/WAI/tutorials/images/complex/

### A3.2 Practices for our charts (INFERRED from the above)

1. Wrap every chart in `<figure>` with a visible or visually hidden `<figcaption>` summary: metric, range, trend, extremes ("Average position improved from 14.2 to 9.8 between 1 and 29 September; best 7.1 on 22 September").
2. Provide "View as table" (a real `<table>`) for every chart; for rank history this is the same data the grid already shows.
3. Encode series by color plus one more channel: line dash style, marker shape, direct end-of-line labels, or ECharts decals for area/bar fills.
4. Keep categorical palettes to what can reach 3:1 against the chart background, or add 1 px borders/outlines to fills. Carbon's categorical palette shows the problem: Purple 70 `#6929c4` is 7.74:1 on white but Cyan 50 `#1192e8` is 3.33:1 and Red 50 `#fa4d56` 3.35:1 (computed). Adjacent-series contrast is a separate check.
5. Legends as real buttons (`aria-pressed`) so series toggling is keyboard operable.
6. Use SVG renderer where possible so text is selectable and zoom stays crisp (INFERRED; not verified against ECharts docs).

### A3.3 What ECharts `aria` provides (VERIFIED)

Source: ECharts option reference source, https://github.com/apache/echarts-doc/blob/master/en/option/component/aria.md (rendered at https://echarts.apache.org/en/option.html#aria), and the handbook https://echarts.apache.org/handbook/en/best-practices/aria/

| Option | Default | Effect |
|---|---|---|
| `aria.enabled` | `false` | Master switch. Without it neither `label` nor `decal` applies. |
| `aria.label.enabled` | `true` | Auto-generates a description from title, series and data; written to the chart DOM's `aria-label`. |
| `aria.label.description` | `null` | Full custom description; replaces the generated one. Doc recommends it where the generated text "cannot convey the author's intent", e.g. dense scatter maps. |
| `aria.label.general.withTitle` | `'This is a chart about "{title}".'` | Template |
| `aria.label.general.withoutTitle` | `'This is a chart,'` | Template |
| `aria.label.series.maxCount` | `10` | Max series described |
| `aria.label.series.single.withName` | `' with type {seriesType} named {seriesName}.'` | Template |
| `aria.label.series.multiple.prefix` | `'. It consists of {seriesCount} series count.'` | Template |
| `aria.label.data.maxCount` | `10` | Max data points described per series |
| `aria.label.data.allData` / `partialData` | `'whose data is --'` / `'where the first {displayCnt} term is --'` | Templates |
| `aria.label.data.excludeDimensionId` | none | Drop dimensions from the description |
| `aria.decal.show` | `false` | Adds decal patterns as a second channel to color; needs `aria.enabled` too. Supported on line (with `areaStyle`), bar, pie, radar (with `areaStyle`), treemap, sunburst, boxplot, sankey, funnel, gauge, pictorialBar, themeRiver, custom. |
| `aria.decal.decals` | Object or Array | Per-series pattern: `symbol` (`'rect'`), `symbolSize` (`1`), `color` (`'rgba(0, 0, 0, 0.2)'`), `backgroundColor` (`null`), `dashArrayX` (`5`), `dashArrayY` (`5`), `rotation` (`0`), `maxTileWidth`/`maxTileHeight` (`512`). |

Notes:
- The handbook says decals were added in ECharts 5 and the description feature existed from ECharts 4. VERIFIED.
- The WebFetch summary of the handbook referred to `aria.show`; the option reference defines `aria.enabled`. Use `aria.enabled` and confirm against the installed version. UNVERIFIED which key the handbook text uses today.
- Neither page documents keyboard navigation between data points. INFERRED: ECharts gives a static text summary plus patterns, not an interactive accessible chart. Our data table fallback is therefore required, not optional.
- With the default `data.maxCount` of 10, a 90-day rank history would be summarised as its first 10 points. Always set `aria.label.description` from our own computed summary (INFERRED).

## A4. Motion, transparency, forced colors

| Feature | Values | Support | Guidance |
|---|---|---|---|
| `prefers-reduced-motion` | `no-preference`, `reduce` | Baseline widely available since January 2020 (MDN). VERIFIED | Scaling and panning "can be vestibular motion triggers". Under `reduce`: no animated number counters, no chart draw-in, no parallax, replace slide transitions with fades or none. WCAG 2.3.3 Animation from Interactions is AAA (not re-verified this session). |
| `prefers-reduced-transparency` | `no-preference`, `reduce` | Media Queries Level 5; MDN marks it **Experimental, not Baseline**. VERIFIED | Treat as progressive enhancement: under `reduce`, replace translucent/blurred overlays (glass headers, backdrop blur) with opaque surfaces. Default design should not depend on translucency for legibility anyway (INFERRED). |
| `forced-colors` | `none`, `active` | Baseline widely available since September 2022 (MDN). VERIFIED | Forced: `color`, `background-color`, `text-decoration-color`, `border-color`, `outline-color`, `column-rule-color`, SVG `fill`/`stroke`. Forced to none: `box-shadow`, `text-shadow`, non-URL `background-image`. System colors chosen from native semantics, "not on added ARIA roles" (a `div role=button` does not get `ButtonText`). |
| `forced-color-adjust` | `auto` (default), `none`, `preserve-parent-color` | MDN shows "Limited availability" (not Baseline) on the access date. VERIFIED | Use `none` only where author colors carry meaning (chart series swatches, heatmap cells), and then re-express them with system colors or patterns. "It should not be used to prevent user choices being respected." |

Rules for our custom components in forced colors (INFERRED from the MDN behaviour above, and matching what Grafana and Carbon do):
1. Every surface that relies on a background color or shadow for its edge (cards, popovers, menus, drawers, selected rows, chips) also gets a `1px solid transparent` border. In forced colors the border becomes visible in the system border color.
2. Focus rings: if the ring is a `box-shadow`, add `outline: 2px solid transparent` so a visible outline appears when shadows are stripped. Grafana's `getFocusStyles` does exactly this with the comment "transparent dotted outline is set to show focus when forced-colors are active" (VERIFIED, https://github.com/grafana/grafana/blob/main/packages/grafana-ui/src/themes/mixins.ts). Carbon switches its outline to `dotted` under `prefers-contrast` (VERIFIED, https://github.com/carbon-design-system/carbon/blob/main/packages/styles/scss/utilities/_focus-outline.scss).
3. Selected row / active tab / checked state: do not use background alone. Add a left bar, check icon, or `Highlight`/`HighlightText` system colors inside `@media (forced-colors: active)`.
4. Icons: use `currentColor` in SVG so they follow `CanvasText`/`ButtonText`.
5. Charts: under forced colors, series colors collapse. Keep dash styles, markers and decals, and keep the data table.

## A5. APCA and WCAG 3 status

- WCAG 3.0 is a W3C **Working Draft** dated **10 September 2026**. The text contrast requirement reads "The contrast algorithm used in WCAG 3 is yet to be determined", with `@@` placeholders for the measure at both levels, and the section is marked "Developing". VERIFIED, https://www.w3.org/TR/wcag-3.0/
- APCA is therefore **not normative in any W3C Recommendation or in the current WCAG 3 draft**. Secondary sources report that visual contrast was moved out of the WCAG 3 draft in July 2023 and that Recommendation is not expected before about 2029. UNVERIFIED (secondary: https://accessibe.com/blog/wcag-3-point-0 , http://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html ).
- I did not find any law or procurement standard that cites APCA. EN 301 549 and the ADA/Section 508 context reference WCAG 2.x. UNVERIFIED in this session (not re-fetched).

Recommendation (INFERRED):
- **Compliance bar: WCAG 2.2 AA ratios (4.5:1 text, 3:1 large text and non-text), computed unrounded, enforced by a token test in CI.**
- **APCA as advisory only**: use it to catch WCAG 2's known weaknesses in dark mode (WCAG 2 overstates contrast of mid-gray text on near-black) and for thin 12 px text. Where WCAG 2 passes but APCA reports low Lc for small text, darken the token anyway. Never ship a pair that fails WCAG 2 because APCA says it is fine.

## A6. Accessibility baseline for our design system (INFERRED, derived from A1 to A5)

| Area | Rule |
|---|---|
| Text contrast | All text tokens at least 4.5:1 on every surface they can sit on (base, raised, selected row, hover row). Disabled text exempt but still readable. |
| Non-text contrast | Input borders, checkbox/radio outlines, toggle tracks, focus ring, chart marks at least 3:1. Decorative dividers exempt. |
| Focus | 2 px solid ring, at least 3:1 against both the component and the page, via `:focus-visible`; `outline: 2px solid transparent` fallback for forced colors. Inset ring (offset -2px, as Primer and Carbon do) inside table cells so it is not clipped by `overflow:hidden`. |
| Targets | Minimum 24 x 24 px hit area for every control, including 16 px icons (pad the hit area, not the glyph). Row actions spaced at 24 px pitch or more. |
| Tables | Native `<table>` default; `grid` only for editable views. Sort via `<button>` in `<th>` with `aria-sort`. Virtualised: `aria-rowcount` + `aria-rowindex`. Horizontal scroll only inside the table container. Sticky header height added to `scroll-padding-top`. |
| Drag | Every drag (column reorder/resize, chart brush, dashboard widget move) has a click/menu alternative. |
| Shortcuts | Single-key shortcuts listed in a "Keyboard shortcuts" dialog and switchable off in settings (GitHub model). Cmd/Ctrl+K palette always on. |
| Hover content | Tooltips: Esc closes, pointer can move onto them, no auto-timeout. Info in tooltips must also be reachable by keyboard focus. |
| Status | Result counts, background job progress, export completion via `role="status"`; blocking errors via `role="alert"`. |
| Motion | Respect `prefers-reduced-motion`; no motion is required to understand data. |
| Charts | Figure + summary + data table + non-color channel; ECharts `aria.enabled` with our own `description`. |

---

# Part B: Dense professional UI patterns (study, do not copy)

All values are px unless noted. "Source" is the file or page read on 2026-09-29.

## B1. GitHub Primer (VERIFIED)

Sources:
- Tokens (built CSS, `@primer/primitives` 11.10.0): https://unpkg.com/@primer/primitives/dist/css/functional/size/size.css , .../radius.css , .../border.css , .../typography/typography.css , .../base/typography/typography.css , .../functional/themes/light.css
- Token source: https://github.com/primer/primitives/tree/main/src/tokens
- DataTable CSS: https://github.com/primer/react/blob/main/packages/react/src/DataTable/Table.module.css
- PageLayout CSS: https://github.com/primer/react/blob/main/packages/react/src/PageLayout/PageLayout.module.css

| Item | Value |
|---|---|
| Control heights | xsmall **24**, small **28**, medium **32**, large **40**, xlarge **48** |
| Control padding-inline | condensed 8, normal 12, spacious 16 (xsmall: 4 / 8 / 12) |
| Min target tokens | `control-minTarget-fine` **16**, `control-minTarget-coarse` **44** (token description: "Use minTarget values to ensure touch accessibility on coarse pointer devices") |
| Base text sizes | xs 12, sm **14** ("Default body text size for UI"), md 16, lg 20, xl 32, 2xl 40 |
| Line heights | tight 1.25, snug 1.375, normal 1.5, relaxed 1.625, loose 1.75 |
| Caption | 12 px, line-height 16; token note: "the small sizing doesn't pass accessibility requirements" for multi-line use |
| DataTable font | `--table-font-size: 0.75rem` (**12 px**), line-height 20/12 (20 px) |
| DataTable density | `cellPadding` condensed 4 / 8, normal 8 / 12, spacious 12 / 16 (block / inline) |
| DataTable row height | condensed about **29**, normal about **37**, spacious about **45** (20 px line + padding + 1 px border). INFERRED arithmetic |
| Radius | small **3** (badges, labels), medium **6** (default: buttons, inputs, cards), large **12** (dialogs), full 9999 |
| Border widths | thin 1 (default), thick 2 ("MUST use for focus rings"), thicker 4 |
| Focus | `outline: 2px solid` `borderColor.accent.emphasis`, `outline-offset: -2px` (inset) |
| Shadows | resting xsmall/small/medium (1 to 6 px blur, for buttons and cards); floating small (dropdowns, tooltips), medium (popovers, action menus), large (dialogs), xlarge (sheets). Values e.g. floating-small `0 0 0 1px #d1d9e040, 0 6px 12px -3px #25292e0a, 0 6px 18px 0 #25292e1f` |
| Neutral scale | `base.color.neutral.0` to `.13` (14 steps): 0 white, 1 `#F6F8FA`, 2 `#EFF2F5`, 3 `#E6EAEF`, 4 `#E0E6EB`, 5 `#DAE0E7`, 6 `#D1D9E0`, 7 `#C8D1DA`, 8 `#818B98`, 9 `#59636E`, 10 `#454C54`, 11 `#393F46`, 12 `#25292E`, 13 black (light theme) |
| Functional grays (light) | `fgColor-default #1f2328`, `fgColor-muted #59636e`, `bgColor-muted #f6f8fa`, `borderColor-default #d1d9e0`, `borderColor-emphasis #818b98` |
| Pane (sidebar) widths | at >= 768: small 240, medium 256, large 256; at >= 1012: small **256**, medium **296**, large **320** |
| Overlay widths | xsmall 192, small 320, medium 480, large 640, xlarge 960; heights small 256, medium 320, large 432, xlarge 600; overlay radius 6 |
| Monospace | token described as for "code, technical content, and tabular data" |

## B2. Vercel Geist (VERIFIED unless marked)

Sources: https://vercel.com/geist/colors , https://vercel.com/geist/typography , https://vercel.com/geist/materials , https://vercel.com/geist/button , and the production CSS served with those pages (three `_next/static` CSS chunks downloaded 2026-09-29).

| Item | Value |
|---|---|
| Color scales | 10 scales: backgrounds, gray, gray-alpha, blue, red, amber, green, teal, purple, pink |
| Step semantics (100 to 1000) | 100 default component bg, 200 hover bg, 300 active bg; 400 default border, 500 hover border, 600 active border; 700 to 800 high-contrast backgrounds (800 hover); 900 secondary text and icons; 1000 primary text and icons. Backgrounds: Background 1 default, Background 2 subtle differentiation |
| Gray hex fallbacks seen in CSS | light-looking set: 100 `#f2f2f2`, 200 `#ebebeb`, 300 `#e6e6e6`, 400 `#eaeaea`, 500 `#c9c9c9`, 600 `#a8a8a8`, 900 `#4d4d4d`, 1000 `#171717`; dark-looking set: 100 `#1a1a1a`, 200 `#1f1f1f`, 300 `#292929`, 400 `#2e2e2e`, 500 `#454545`, 600 `#878787`, 900 `#a0a0a0`, 1000 `#ededed`. 700 `#8f8f8f`, 800 `#7d7d7d` seen once. Primary values are in `lab()`/P3; theme assignment of each hex is INFERRED from lightness |
| Form heights | `--geist-form-small-height` = **32**, `--geist-form-height` = **36**, `--geist-form-large-height` = **40** (via `--geist-space-small/medium/large`); form font 14 px, line-height 20. Docs list button sizes tiny, small, medium (default), large but do not state pixel heights; tiny height UNVERIFIED |
| Typography classes | headings 72 to 14; buttons 16/14/12; labels 20/18/16/14/13/12 plus 14/13/12 mono; copy 24/20/18/16/14/13 plus 13 mono. Docs: "Tabular is used when conveying numbers for consistent spacing" (on text-label-13) |
| Radius | `--geist-radius` **6**, marketing 8; materials: base/small 6, medium/large 12, tooltip 6, menu 12, modal 12, fullscreen 16; popover row radius 6 |
| Focus ring | `--ds-focus-ring: 0 0 0 2px var(--ds-background-100), 0 0 0 4px var(--ds-focus-color)` (2 px gap + 2 px ring), focus color blue-700 (light) / blue-900 |
| Elevation | shadow tokens: `2xs`, `small`, `medium`, `large`, `2xl`, `menu`, `modal`, `fullscreen`, each paired with `--ds-shadow-border-base: 0 0 0 1px #00000014` (light). Materials: "surface" (base, small, medium, large) vs "floating" (tooltip, menu, modal, fullscreen) |
| Spacing | 4 px base: 8, 12, 16, 24, 32, 40, 64, 96, 128, 192, 256; `--geist-gap` 24 |

## B3. Grafana (grafana/ui and Saga) (VERIFIED)

Sources:
- Theme: https://github.com/grafana/grafana/tree/main/packages/grafana-data/src/themes (`createComponents.ts`, `createShape.ts`, `createTypography.ts`, `createSpacing.ts`, `createShadows.ts`)
- Table: https://github.com/grafana/grafana/blob/main/packages/grafana-ui/src/components/Table/TableNG/constants.ts and `utils.ts`
- Shell: `public/app/core/components/AppChrome/MegaMenu/MegaMenu.tsx`, `AppChrome/TopBar/useChromeHeaderHeight.ts`
- Drawer: `packages/grafana-ui/src/components/Drawer/Drawer.tsx`
- Focus: `packages/grafana-ui/src/themes/mixins.ts`
- Saga docs: https://grafana.com/developers/saga/about/overview/ , https://grafana.com/developers/saga/styling/border-radius/

| Item | Value |
|---|---|
| Grid unit | `gridSize = 8`; `theme.spacing(n) = n * 8` |
| Control heights | `height: { sm: 3, md: 4, lg: 6 }` grid units = **24 / 32 / 48** |
| Font size | `fontSize = 14`, `htmlFontSize = 14`; body 14/22, bodySmall 12/18; size scale xs 10, sm 12, md 14, lg 18. Code enforces "Font size and line height should be integer multiples of 2" |
| Table rows (TableNG) | cell height Sm **36**, Md **42**, Lg **48** (`MAX_CELL_HEIGHT`); default = 6 px padding x 2 + 14 x 22/14 = **34** |
| Table header | `HEADER_HEIGHT: 34`, header line-height 20 |
| Table misc | `CELL_PADDING 6`, line height 22, default column width 150, min 50, max auto 400, scrollbar 8, pagination limit 750 |
| Panel | header height 5 units = 40, padding 1 unit = 8 |
| Radius (source) | `DEFAULT_BORDER_RADIUS_SM = 4`, `MD = 6` (default), `LG = 10`; plus pill and circle |
| Radius (Saga docs) | default "**2px** and is used for most UI elements", pill 9999, circle 100%. Conflicts with source: docs appear older than code. Treat code as current. VERIFIED both, conflict noted |
| Focus | `outline: 2px dotted transparent` (for forced colors) plus `box-shadow: 0 0 0 2px <canvas>, 0 0 0 4px <accent>` (3 px in visual refresh); inset variant `inset 0 0 0 1px or 2px` |
| Shadows | z1 `0 1px 2px`, z2 `0 4px 8px`, z3 `0 13px 20px 1px` (light) / `0 8px 24px` (dark) |
| Top bar | `getChromeHeaderLevelHeight()` = **40** (48 when `unifiedNavbars` or `dashboardNewLayouts` toggles are on); up to 2 levels |
| Mega menu (docked sidebar) | `MENU_WIDTH = '320px'`; legacy `sidemenu.width: 57` |
| Drawer sizes | sm 25vw min **384**; md 50vw min **568** (default); lg 75vw min **744**; resizable |
| Horizontal drawer | default height 400 |
| Tabular numerals | `fontVariantNumeric: 'tabular-nums'` used in alerting triage and flame graph call tree |
| Saga principles | Universal, Accessible, Flexible, Coherent, Defined, Distinct |

## B4. Atlassian (reference) (VERIFIED unless marked)

Sources: https://atlassian.design/foundations/radius , https://atlassian.design/foundations/typography , https://atlassian.design/foundations/elevation , https://atlassian.design/components/button/examples , https://atlassian.design/components/navigation-system/layout/examples , compiled CSS https://unpkg.com/@atlaskit/button@25.4.3/dist/es2019/new-button/variants/shared/button-base.compiled.css

| Item | Value |
|---|---|
| Body text | `font.body` **14/20** (default "in components or where space is limited"), `font.body.small` 12/16, `font.body.large` 16/24 |
| Headings | xxlarge 32/36, xlarge 28/32, large 24/28, medium 20/24, small 16/20, xsmall 14/20, xxsmall 12/16 (bold) |
| Metric tokens | `font.metric.large` 28/32, `.medium` 24/28, `.small` 16/20 (bold): dedicated tokens for KPI numbers |
| Code | 12/20 |
| Buttons | spacing "Default ... for most use cases, `compact` for tables"; compiled CSS contains heights **32** (2rem) and **24** (1.5rem). Mapping default = 32, compact = 24 is INFERRED |
| Radius | xsmall 2 (badges, checkboxes, kbd), small 4 (labels, lozenges, tags, tooltips), medium **6** (buttons, inputs, selects, nav items), large 8 (cards, floating UI, dropdowns), xlarge 12 (modals, large containers), xxlarge 16, full 999. Focus-state radius tokens are base + 2 |
| Elevation | sunken (well/backdrop), default (flat), raised (movable cards only, surface + shadow), overlay (modals, dialogs, dropdowns; may stack) |
| Top nav | fixed height **56** |
| Side nav | default **320**, resizable min **240**, max 50% viewport; collapses to overlay below 1024 |
| Aside panel | default **365**, resizable up to 50% of content area, not below default; overlays below 1024 |
| Side nav shortcut | Ctrl+[ toggles (global, disabled by default) |
| Tabular numerals | not mentioned on typography page |

## B5. IBM Carbon (density reference) (VERIFIED)

Sources: https://carbondesignsystem.com/components/data-table/style/ , https://carbondesignsystem.com/components/UI-shell-header/style/ , https://carbondesignsystem.com/components/UI-shell-left-panel/style/ , https://carbondesignsystem.com/components/button/style/ , https://carbondesignsystem.com/components/text-input/style/ , https://carbondesignsystem.com/data-visualization/color-palettes/ , source `packages/styles/scss/utilities/_focus-outline.scss` and `components/ui-shell/side-nav/_side-nav.scss`

| Item | Value |
|---|---|
| Data table rows | xs **24**, sm **32**, md **40**, lg **48** (default), xl **64**. "Extra large row heights are only recommended if your data is expected to have two lines of content in a single row." Column header row always matches row size |
| Table type | table title 20 (`$heading-03`), column header 14 semibold (`$heading-compact-01`), row text 14 regular (`$body-compact-01`) |
| Table spacing | column padding 16; checkbox 20 x 20 |
| Toolbar | large 48 (paired with lg/xl rows), small 32 (paired with sm/xs rows); batch action bar same pairing |
| Buttons | xs 24, sm 32, md 40, lg 48 (productive and expressive), xl 64, 2xl 80 |
| Text input | sm 32, md 40, lg 48 |
| UI shell header | **48** high; header actions 48 x 48; header text 14 |
| Side nav | panel width **256** (expanded, `mini-units(32)`), rail **48** (`mini-units(6)`); link height 32; sub-item height 32 |
| Focus | `outline: 2px solid $focus; outline-offset: -2px` (inset); switches to `dotted` under `prefers-contrast`; `$focus` in White theme is Blue 60 `#0f62fe` (5.00:1 on white, computed) |
| Categorical palette | fixed order starting Purple 70 `#6929c4`, Cyan 50 `#1192e8`, Teal 70 `#005d5d`, Magenta 70 `#9f1853`, Red 50 `#fa4d56`, Red 90, Green 60, Blue 80, ... "applied in sequence strictly ... to maximize contrast between neighboring colors" |
| Radius | Carbon components are largely square-cornered. INFERRED from the component specs read; no radius page fetched |

## B6. PostHog (VERIFIED)

Sources: https://github.com/PostHog/posthog/blob/master/.interface-design/system.md ("Extracted from codebase. Source of truth for UI consistency."), https://github.com/PostHog/posthog/blob/master/frontend/src/lib/lemon-ui/LemonButton/LemonButton.scss , https://github.com/PostHog/posthog/blob/master/frontend/src/lib/lemon-ui/LemonTable/LemonTable.scss

| Item | Value |
|---|---|
| Base unit | 4; scale 4, 8, 12, 16, 24, 32; default gap 8 |
| Base font | **14**, line-height 1.5715; h1 28, h2 21, h3 16, h5 11 uppercase |
| Buttons (LemonButton) | xxsmall **20**, xsmall **26**, small **33**, medium **37** (default), large **49** (heights include a 3 px "chrome depth" 3D bottom edge) |
| Inputs (LemonInput) | xsmall 24, small 32, medium 37, large 48 |
| Table (LemonTable) | body **13 px**; header 12 px uppercase; cell padding 8; `--xs` size uses 4 px vertical padding; group header rows 40 |
| Radius | sm 4, default **6**, lg 10 (popovers, menus) |
| Focus | inputs: `box-shadow: 0 0 0 3px var(--color-bg-fill-highlight-75)` |
| Shadows | default `0 3px 0 <border-color>` (flat offset "3000" look) only for elevated cards and toasts; modal `0 16px 16px -16px rgb(0 0 0 / 35%)` |
| Nav | navbar **215**, collapsed **45**, project panel 245, side panel bar 40 |
| Disabled | opacity 0.65 |
| Tabular numerals | Tailwind `tabular-nums` (often with `font-mono`) on counts and percentages |

## B7. Sentry (VERIFIED)

Sources: https://github.com/getsentry/sentry/blob/master/static/app/utils/theme/theme.tsx , https://github.com/getsentry/sentry/tree/master/static/app/utils/theme/scraps/tokens (`size.tsx`, `typography.tsx`), https://github.com/getsentry/sentry/blob/master/static/app/views/navigation/constants.tsx

| Item | Value |
|---|---|
| Form heights | md **36** (font 14, radius lg), sm **32** (font 14, radius md), xs **28** (font 12, radius sm) |
| Font sizes | xs 11, sm 12, md **14**, lg 16, xl 20, 2xl 24, 3xl 32, 4xl 40; sans Rubik, mono Roboto Mono (mono regular weight 425) |
| Line heights | compressed 1, default 1.2, comfortable 1.4, fixed 1rem |
| Space | 2, 4, 6, 8, 12, 16, 24, 32 |
| Radius | 2xs 3, xs 4, sm 5, md 6, lg 8, xl 12, 2xl 16, full 999 |
| Border widths | md 1, lg 1.5, xl 2, 2xl 4 |
| Elevation | sm 1, md 2, lg 4, xl 6 (offsets) |
| Focus | `box-shadow: <base>, 0 0 0 2px <focus.default>` |
| Primary sidebar | **74** wide |
| Secondary sidebar | default **190**, min 150, max 450, resizable, collapse state persisted in localStorage |
| Header | **53** (52 + 1 px border); mobile top bar 40 |
| Hover intent delays | collapse 200 ms, open 250 ms, reset 300 ms |
| Tabular numerals | `font-variant-numeric: tabular-nums` in `fileSize`, `duration`, discover and performance table styles |

## B8. Datadog DRUIDS (VERIFIED, docs are public; the system is internal)

Sources: https://druids.datadoghq.com/ (home states "At this time, DRUIDS is for Datadog internal use only"), https://druids.datadoghq.com/foundations/color , https://druids.datadoghq.com/foundations/typography , blog https://www.datadoghq.com/blog/engineering/druids-the-design-system-that-powers-datadog/ (not fetched)

| Item | Value |
|---|---|
| Typefaces | Noto Sans (UI); Roboto Mono "to render codes, and in all logs tables" |
| Size / height pairs | xxs 8/16, xs 11/20, sm 12/24, md **13/28**, lg 15/36, xl 18/44, xxl 23/52 (`--font-size-*` / `--height-*`, shown in the page's "line-height" column). Whether `--height-*` doubles as control height is INFERRED |
| Weights | 400 and 600 only (600 mapped to "Bold"); 300 Thin "sparingly" |
| Color model | semantic CSS variables: `--ui-background` (+ secondary, tertiary, elevated, shade), `--ui-border`, `--ui-text` (+ secondary, tertiary, disabled, knockout), `--ui-interaction-primary`, status danger/warning/success each with base, `-contrast` (preferred for text), `-soft` (fills) |
| Notable rules | "Text and icon colors use varying levels of opacity"; status base colors "Typically best for backgrounds and other fills, not text"; disabled text "Should be reserved for semantic meanings of disabled, and not used simply to make text less prominent"; an "increased contrast mode" exists (`--ui-text-on-border` "inverts in the increased contrast mode") |

## B9. Linear (partial)

Sources: https://linear.app/now/how-we-redesigned-the-linear-ui , https://linear.app/docs/filters

| Item | Value | Status |
|---|---|---|
| Theme generation | LCH color space; themes defined by 3 variables (base color, accent color, contrast) instead of 98 per theme; high-contrast themes available | VERIFIED |
| Type | Inter Display for headings, Inter for body | VERIFIED |
| Density principle | "reduced visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements"; darker text and neutral icons in light mode | VERIFIED |
| Filters | `F` opens filter menu; each filter is a property / operator / value formula where the operator and value segments are clickable; operators is / is not / is either of / includes any, all, neither, none / before / after; AND/OR groups with nesting; filters reflected in the URL | VERIFIED |
| Control heights, row heights, sidebar width, radius | not published | UNVERIFIED |
| 2.1.4 note | `F` is a single-key shortcut; whether Linear offers an off switch was not checked | UNVERIFIED |

## B10. Stripe (partial; Stripe Apps UI toolkit only)

Sources: https://docs.stripe.com/stripe-apps/style , https://docs.stripe.com/stripe-apps/components/chip.md?app-sdk-version=9

| Item | Value | Status |
|---|---|---|
| Spacing tokens | xxsmall 2, xsmall 4, small 8, medium 16, large 24, xlarge 32, xxlarge 48 | VERIFIED |
| Layout model | "stacks" (`stack: 'x' / 'y' / 'z'`, `gap`, `alignX`, `alignY`, `distribute`), fractional widths | VERIFIED |
| Filter chips | `Chip` with `label` + `value` (string or array); `onDropdown` edits value (right side of chip); `onClose` removes; `onAddSuggestion` renders a "suggested" chip with a plus icon; `ChipList` handles wrapping and "keyboard navigation of chips using the right and left arrow keys"; required filters are non-closeable (omit callbacks) | VERIFIED |
| Font sizes, radius, control heights | tokens exist but values not stated on the page | UNVERIFIED |

## B11. Cross-product comparison

| | Primer | Geist | Grafana | Atlassian | Carbon | PostHog | Sentry | DRUIDS |
|---|---|---|---|---|---|---|---|---|
| Default UI font | 14 | 14 | 14 | 14 | 14 | 14 | 14 | 13 (md) |
| Table body font | 12 | n/a | 14 | 14 (body) | 14 | 13 | 14 (md) | 13 (INFERRED) |
| Control heights | 24/28/32/40/48 | 32/36/40 | 24/32/48 | 24/32 | 24/32/40/48/64/80 | 20/26/33/37/49 | 28/32/36 | 16 to 52 pairs |
| Default control | 32 | 36 | 32 | 32 | 40 (md) / 48 (lg) | 37 | 36 | 28 (INFERRED) |
| Row heights | ~29/37/45 (INFERRED) | n/a | 34 default; 36/42/48 | n/a | 24/32/40/48/64 | padding 8 (xs: 4) | n/a | n/a |
| Header / top bar | n/a | n/a | 40 (48 new) | 56 | 48 | n/a | 53 | n/a |
| Sidebar expanded | 256 to 320 (pane) | n/a | 320 | 320 (240 min) | 256 | 215 | 74 + 190 | n/a |
| Sidebar collapsed | n/a | n/a | hidden | overlay | 48 rail | 45 | 74 | n/a |
| Default radius | 6 | 6 | 6 (code) / 2 (docs) | 6 | ~0 (INFERRED) | 6 | 6 to 8 | n/a |
| Radius scale | 3/6/12/full | 6/12/16 | 4/6/10 | 2/4/6/8/12/16 | n/a | 4/6/10 | 3/4/5/6/8/12/16 | n/a |
| Focus ring | 2 solid, offset -2 | 2 gap + 2 ring | 2 gap + 2 ring, transparent outline | radius +2 tokens | 2 solid, offset -2 | 3 px glow | 2 ring | n/a |
| Drawer / panel | overlays 320 to 960 | n/a | 384 / 568 / 744 min | 365 aside | n/a | 245 panel | n/a | n/a |
| Gray structure | neutral 0 to 13 | gray 100 to 1000 by role | theme roles | tokens by role | Gray 10 to 100 (UNVERIFIED) | neutral-cool 800 to 950 in dark | tokens by role | semantic `--ui-*` |
| Tabular nums | mono for tabular data | "Tabular" label style | yes (some views) | metric tokens | n/a | yes | yes | mono for logs |

## B12. Command palette patterns

| Product | Trigger | Modes | Status |
|---|---|---|---|
| GitHub | Ctrl/Cmd+K, or Ctrl/Cmd+Alt/Option+K (Markdown contexts); customisable | Search/navigation default; `>` or Ctrl+Shift+K for commands; prefixes `#` issues/PRs, `@` users/orgs/repos, `/` files or repos, `!` projects; Tab on a repo narrows scope; Backspace removes scope; Ctrl+Backspace clears; Esc closes | VERIFIED https://docs.github.com/en/get-started/accessibility/github-command-palette |
| Atlassian | Ctrl+[ toggles side nav (not palette) | n/a | VERIFIED |
| Linear, Grafana, Vercel | Cmd/Ctrl+K palettes exist in product | not documented on pages read | UNVERIFIED |

Accessibility shape for our palette (INFERRED from APG): a modal dialog containing an editable combobox with a listbox popup; `aria-activedescendant` for the active result; group headings via `role="group"` + `aria-labelledby`; result count announced via `role="status"`; Esc closes and returns focus to the invoker; modifier shortcut (Cmd/Ctrl+K) so 2.1.4 does not apply; prefix characters (`>`, `#`) are typed inside the input, so they are not page-level shortcuts.

## B13. Filter chip patterns

- **Stripe**: chip = label + value; right side opens a value editor (`onDropdown`); close icon removes; "suggested" chips with a plus add a filter; arrow keys move between chips in a `ChipList`; required filters cannot be closed. VERIFIED.
- **Linear**: chip = property / operator / value; clicking the operator changes it, clicking the value shows options; AND/OR groups; state in URL; `F` opens the filter menu. VERIFIED.
- **Our chip spec (INFERRED)**: three-segment chip (property, operator, value) where operator and value are separate buttons with accessible names ("Operator: is. Change operator", "Value: United States, Germany. Edit value"); remove button named "Remove filter Country"; chip row as a toolbar with arrow-key roving focus (Stripe model) or plain Tab order; filter state in the URL; result count update announced with `role="status"`; chip height matches the small control height; minimum 24 px target on the remove icon via padding.

## B14. Principles for density without clutter

Observed across the products above (VERIFIED where a source says it; otherwise INFERRED from the numbers):

1. **One small, strict size ladder, shared by controls and rows.** Carbon pairs toolbar and batch bar size with row size (48 with lg/xl rows, 32 with sm/xs). Primer, Grafana and Carbon all expose 24 / 32 / 48 as anchor heights. VERIFIED.
2. **Density as a user or context setting, not a separate design.** Carbon row sizes, Primer `cellPadding` condensed/normal/spacious, Grafana cell height Sm/Md/Lg, PostHog `--xs` tables. Density changes padding, not font size. VERIFIED.
3. **Keep UI text at 14 and drop tables to 12 to 13 only with tabular numerals and strong contrast.** Primer tables 12, PostHog 13, DRUIDS 13 default; Carbon and Grafana stay at 14. VERIFIED values; the contrast caveat is INFERRED from 1.4.3 (no size exemption below 18.5 px bold).
4. **Borders over shadows for in-page structure; shadows only for things that float.** Atlassian: raised elevation "reserved for cards that can be moved"; Geist separates surface materials from floating materials; PostHog shadow "only for elevated cards and toasts"; Grafana panels `boxShadow: 'none'`. VERIFIED.
5. **Semantic gray roles instead of raw steps.** Geist assigns each step a job (bg / hover / active / border / text); DRUIDS exposes only semantic `--ui-*` variables; Linear derives all neutrals from 3 inputs. VERIFIED.
6. **Status colors: base for fills, a separate "contrast" variant for text.** DRUIDS says the base status color is "Typically best for backgrounds and other fills, not text" and the `-contrast` variant is "Preferred for text". VERIFIED. This is the single most useful rule for green/red rank-change text.
7. **Muted is not disabled.** DRUIDS: disabled text "Should be reserved for semantic meanings of disabled". VERIFIED.
8. **Resizable, persisted side panels with sane bounds.** Atlassian 240 min / 50% max; Sentry 150 to 450 persisted; Grafana drawers min 384 / 568 / 744. VERIFIED.
9. **Monospace or tabular figures for numbers.** Primer mono "for ... tabular data"; DRUIDS mono in logs tables; Grafana, Sentry, PostHog use `tabular-nums`; Geist "Tabular" label style; Atlassian dedicated metric tokens. VERIFIED.
10. **Focus rings do not change layout.** Primer and Carbon use inset outlines (offset -2) so rings fit inside dense cells; Geist and Grafana use box-shadow rings with a background-colored gap. VERIFIED.
11. **Reduce chrome color, not information.** Linear limited blue in chrome and darkened text for contrast while increasing navigation density. VERIFIED.

## B15. Starting values for our design system (INFERRED; to be validated in design review)

| Token area | Proposed value | Rationale |
|---|---|---|
| UI font | 14/20 | Consensus of 7 of 8 systems |
| Table font | 13/20 with `font-variant-numeric: tabular-nums` on numeric columns | Between Primer 12 and Carbon 14; PostHog and DRUIDS use 13 |
| Small / caption | 12/16, single line only | Primer note: caption sizing unsuitable for multi-line |
| Control heights | 24 (xs, in-table), 28 (sm), 32 (md, default), 40 (lg) | Primer ladder; 24 still meets 2.5.8 without spacing exception |
| Table density | compact 32, default 40, comfortable 48 row height; header row equals row height | Carbon sm/md/lg; 32 compact keeps 24 px targets inside rows |
| Top bar | 48 | Carbon 48, Grafana moving to 48 |
| Sidebar | 240 expanded (resizable 200 to 320), 48 collapsed rail | Carbon rail 48; Atlassian min 240 |
| Drawer | 480 default, resizable 384 to 50vw | Primer overlay medium 480, Grafana sm min 384 |
| Radius | 4 (chips, badges), 6 (controls, default), 8 (cards, popovers), 12 (dialogs) | Atlassian / Primer / Sentry overlap |
| Border | 1 px default; 2 px for focus and selection | Primer border widths |
| Focus | 2 px solid accent ring, offset 2 on standalone controls, inset (offset -2) in table cells; `outline: 2px solid transparent` fallback | Primer, Carbon, Grafana |
| Elevation | none for in-page cards (border only); 3 floating levels (popover, dropdown/menu, dialog) | Atlassian, Geist, PostHog |
| Gray scale | 12 steps with role mapping (bg, hover, active, 3 borders, 2 solid, 2 text) and every text step validated at 4.5:1 on each surface | Geist-style roles, Primer-style range |
| Status colors | base (fill), soft (subtle fill), contrast (text at 4.5:1) | DRUIDS |

---

## Sources (all accessed 2026-09-29)

W3C / WAI
- https://www.w3.org/TR/WCAG22/ (W3C Recommendation 12 December 2024)
- https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
- https://www.w3.org/TR/wcag-3.0/ (Working Draft 10 September 2026)
- https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- https://www.w3.org/WAI/ARIA/apg/patterns/table/
- https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/
- https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/
- https://www.w3.org/WAI/ARIA/apg/practices/grid-and-table-properties/
- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
- https://www.w3.org/WAI/ARIA/apg/patterns/listbox/
- https://www.w3.org/WAI/tutorials/images/complex/

MDN
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors
- https://developer.mozilla.org/en-US/docs/Web/CSS/forced-color-adjust

ECharts
- https://github.com/apache/echarts-doc/blob/master/en/option/component/aria.md
- https://github.com/apache/echarts-doc/blob/master/en/option/partial/decal.md
- https://echarts.apache.org/handbook/en/best-practices/aria/

Design systems and product source
- https://github.com/primer/primitives (tokens), https://unpkg.com/@primer/primitives (11.10.0 built CSS)
- https://github.com/primer/react/blob/main/packages/react/src/DataTable/Table.module.css
- https://github.com/primer/react/blob/main/packages/react/src/PageLayout/PageLayout.module.css
- https://vercel.com/geist/colors , /typography , /materials , /button (plus production CSS)
- https://github.com/grafana/grafana (paths listed in B3)
- https://grafana.com/developers/saga/about/overview/ , https://grafana.com/developers/saga/styling/border-radius/
- https://atlassian.design/foundations/radius , /typography , /elevation ; https://atlassian.design/components/button/examples ; https://atlassian.design/components/navigation-system/layout/examples
- https://unpkg.com/@atlaskit/button@25.4.3/dist/es2019/new-button/variants/shared/button-base.compiled.css
- https://carbondesignsystem.com/components/data-table/style/ , /UI-shell-header/style/ , /UI-shell-left-panel/style/ , /button/style/ , /text-input/style/ ; https://carbondesignsystem.com/data-visualization/color-palettes/
- https://github.com/carbon-design-system/carbon (focus mixin, side nav SCSS)
- https://github.com/PostHog/posthog (paths listed in B6)
- https://github.com/getsentry/sentry (paths listed in B7)
- https://druids.datadoghq.com/ , /foundations/color , /foundations/typography
- https://linear.app/now/how-we-redesigned-the-linear-ui , https://linear.app/docs/filters
- https://docs.stripe.com/stripe-apps/style , https://docs.stripe.com/stripe-apps/components/chip.md?app-sdk-version=9
- https://docs.github.com/en/get-started/accessibility/github-command-palette
- https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-user-account-settings/managing-accessibility-settings ("To disable shortcut keys that don't use modifiers keys ... deselect Character keys")

Secondary (UNVERIFIED claims only)
- https://accessibe.com/blog/wcag-3-point-0
- http://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html
