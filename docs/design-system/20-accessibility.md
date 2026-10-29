# 20. Accessibility

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: [`tokens.contrast.test.ts`](../../apps/web/src/lib/design/tokens.contrast.test.ts) (contrast), `focus-ring` and forced-colors rules in [`globals.css`](../../apps/web/src/styles/globals.css), `@axe-core/playwright` in the E2E suite ([20-frontend-specification.md](../20-frontend-specification.md) section 8.4)
Research basis: [research/10-a11y-dense-ui.md](../../research/10-a11y-dense-ui.md), [research/09-frontend-stack.md](../../research/09-frontend-stack.md)

This document turns WCAG 2.2 AA into rules for the components in this design system. It extends [20-frontend-specification.md](../20-frontend-specification.md) section 4.10 and keeps every rule stated there. Where a component document ([12-tables.md](12-tables.md), [13-filters-search.md](13-filters-search.md), [15-data-visualization.md](15-data-visualization.md), [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md)) describes behavior, the accessibility requirements here are binding on it.

## 1. Compliance bar

| Item | Decision |
|---|---|
| Standard | WCAG 2.2 (W3C Recommendation, 12 December 2024), Level A and AA, every screen and every state |
| Contrast math | WCAG 2 relative luminance ratios, unrounded (4.499:1 fails 4.5:1) |
| APCA | Advisory only (section 3.4). Never a reason to ship a pair that fails WCAG 2 |
| Patterns | WAI-ARIA Authoring Practices (APG) for every composite widget; Base UI implements most of them, and we own focus styles, names, contrast and anything Base UI does not provide |
| Browsers and assistive technology | VoiceOver with Safari (macOS, iOS), NVDA with Firefox (Windows), keyboard only in Chrome, Safari and Firefox, Windows forced colors in Edge |
| Definition of done | A component or screen is not done until it passes the automated checks in section 18 and the checklist row for it in section 19 |

Accessibility is not a phase. A pull request that adds UI without meeting this document is rejected in review the same way a type error is.

## 2. WCAG 2.2 A and AA mapped to this product

| SC | Level | Rule in this product | Where it is implemented |
|---|---|---|---|
| 1.1.1 Non-text Content | A | Icon-only controls have `aria-label`. Decorative icons are `aria-hidden` (Lucide 1.x default). Favicons use `alt=""` because the domain text is always adjacent. Charts have a summary, a description and a data table (section 12). Sparklines are `role="img"` with a text summary | `Icon`, `IconButton`, `SparklineCell`, `EChart` |
| 1.2.1 to 1.2.5 Media | A, AA | The product has no audio or video content. Any future help video needs captions and a transcript before it ships | n/a |
| 1.3.1 Info and Relationships | A | Native headings (one `h1` per page), landmarks, `<table>` with `th` and `scope`, `Field` labels, `fieldset` and `legend` for grouped controls, lists as `ul`/`ol` | Shell, `DataTable`, `SimpleTable`, `Field` |
| 1.3.2 Meaningful Sequence | A | DOM order equals visual order. CSS `order` and `flex-direction: *-reverse` are not used to reorder content | Lint rule, review |
| 1.3.3 Sensory Characteristics | A | Instructions never rely on shape, color, size or position alone ("the green button", "on the right") | Copy review ([22-content-formatting.md](22-content-formatting.md)) |
| 1.3.4 Orientation | AA | Both orientations work at every width; nothing locks orientation | [19-responsive-behavior.md](19-responsive-behavior.md) |
| 1.3.5 Identify Input Purpose | AA | `autocomplete` tokens on every field that collects the user's own data (section 11.5) | Auth, profile, invite forms |
| 1.4.1 Use of Color | A | Rank changes carry an arrow (`↑5`) and metric changes a sign (`+5.3 pts`), never color alone; status carries an icon and a word; chart series carry dash style, marker shape, direct labels or decals; links inside text are underlined | `RankDeltaCell`, `DeltaCell`, `StatusBadge`, chart theme |
| 1.4.2 Audio Control | A | No audio | n/a |
| 1.4.3 Contrast (Minimum) | AA | All text tokens reach 4.5:1 on every surface they can sit on, tested in CI (section 3) | `tokens.css`, `tokens.contrast.test.ts` |
| 1.4.4 Resize Text | AA | All sizes in `rem`; root font size never changed; 200% zoom keeps full functionality (section 13.6) | `globals.css` |
| 1.4.5 Images of Text | AA | No images of text. Exported chart images are exports, not UI | n/a |
| 1.4.10 Reflow | AA | Page chrome reflows at 320 CSS px; data tables may scroll horizontally inside their region (section 13.5) | [19-responsive-behavior.md](19-responsive-behavior.md) |
| 1.4.11 Non-text Contrast | AA | Checkbox, radio and switch outlines (`border-strong`), focus ring (`ring`), meaningful icons (`foreground-muted` and up), chart marks and semantic solids reach 3:1 on every surface, tested. Text inputs and buttons use the light `border` because their label, placeholder or icon identifies them (section 3.2, rule 6) | `tokens.contrast.test.ts` |
| 1.4.12 Text Spacing | AA | No clipping when users override spacing; truncated values are always available in full (section 13.4) | Type utilities, `Truncate` |
| 1.4.13 Content on Hover or Focus | AA | Tooltips open on hover and focus, close with Escape, stay open while hovered, never time out | `Tooltip` |
| 2.1.1 Keyboard | A | Every function works from the keyboard, including sort, filter, column management, resize, selection, chart range and legend toggles | All components |
| 2.1.2 No Keyboard Trap | A | Only modal overlays contain focus, and Escape always leaves them. The DataTable is one tab stop in and one Tab out | `Dialog`, `DataTable` |
| 2.1.4 Character Key Shortcuts | A | Single-key shortcuts work only when focus is not in a text field and can be turned off (section 14) | `useShortcut` |
| 2.2.1 Timing Adjustable | A | Toasts with an action and error toasts never auto-dismiss; other toasts pause on hover and focus (section 10.5). Session expiry warns 2 minutes ahead with "Stay signed in" | `Toaster` / `toast()`, session guard |
| 2.2.2 Pause, Stop, Hide | A | Continuous motion is limited to three elements: the spinner, the live indicator and the skeleton pulse ([21-motion.md](21-motion.md) section 1). The in-app "Reduce motion" setting stops all three ([21-motion.md](21-motion.md) section 8). Tables do not auto-update under the user; new data is offered with a "Refresh" action (section 10.4) | `Spinner`, `LiveIndicator` |
| 2.3.1 Three Flashes | A | Nothing flashes. The fastest repeating animation is the 800 ms spinner rotation | [21-motion.md](21-motion.md) |
| 2.4.1 Bypass Blocks | A | "Skip to main content" link, plus "Skip to results" on table pages; landmarks (section 4.6) | Shell |
| 2.4.2 Page Titled | A | `document.title` = "{Page} · {Project} · {Product}", updated on every route change | Route metadata |
| 2.4.3 Focus Order | A | Focus order follows the visual order. Overlays take focus and return it to the trigger (section 4.3) | Base UI, `Inspector` |
| 2.4.4 Link Purpose (In Context) | A | Repeated links ("Open", "View") include the row name in their accessible name | `DataTable` row actions |
| 2.4.5 Multiple Ways | AA | Sidebar navigation, command palette search, breadcrumbs, saved views | Shell |
| 2.4.6 Headings and Labels | AA | Headings describe their section; labels describe their field; no "Details" headings without an object | Review |
| 2.4.7 Focus Visible | AA | 2 px `ring` outline on every focusable element (section 4) | `globals.css` |
| 2.4.11 Focus Not Obscured (Minimum) | AA | `scroll-padding` equal to the sticky stack; toasts and the bulk bar never cover the focused element | `--sticky-stack-height`, [19-responsive-behavior.md](19-responsive-behavior.md) |
| 2.5.1 Pointer Gestures | A | No path or multi-touch gestures are required. Swipe to dismiss (toasts, sheets) always has a button | `Toaster` / `toast()`, `Sheet` |
| 2.5.2 Pointer Cancellation | A | Actions fire on pointer up (native buttons and Base UI behavior); drags can be cancelled with Escape or by releasing outside | All controls |
| 2.5.3 Label in Name | A | The accessible name starts with the visible label ("Export CSV", not "Download data") | Review, E2E check |
| 2.5.4 Motion Actuation | A | No device motion input | n/a |
| 2.5.7 Dragging Movements | AA | Every drag has a single-pointer alternative (section 7) | Column resize, reorder, inspector resize, chart brush |
| 2.5.8 Target Size (Minimum) | AA | 24 x 24 px minimum or the spacing exception (section 8) | `IconButton`, checkboxes, chips |
| 3.1.1 Language of Page | A | `<html lang="en">` | Root layout |
| 3.1.2 Language of Parts | AA | Collected answers, prompts and fan-out queries carry `lang` from `language_code` (section 16) | `EvidenceViewer`, `PromptCell` |
| 3.2.1 On Focus | A | Focus never navigates, submits or opens overlays (tooltips are not a change of context) | Review |
| 3.2.2 On Input | A | Changing a filter updates results in place; navigation happens only on explicit activation (a menu item, a link, a submit) | `FilterBar` |
| 3.2.3 Consistent Navigation | AA | Sidebar order and top bar order are identical on every page; the date range and location controls are absent where they do not apply, and the rest keep their relative order | Shell |
| 3.2.4 Consistent Identification | AA | One icon and one label per concept ([07-icons.md](07-icons.md)); the same function has the same name on every screen | Review |
| 3.2.6 Consistent Help | A | Help menu in the same top bar position on every page; methodology links in the same slot of every metric (section 15) | Shell, `MetricLabel` |
| 3.3.1 Error Identification | A | Errors are named in text next to the field, with an icon, not only a red border | `Field.Error` |
| 3.3.2 Labels or Instructions | A | Every input has a visible label; format hints are in the description line, not in the placeholder | `Field` |
| 3.3.3 Error Suggestion | AA | Errors say how to fix the value ("Enter a domain such as example.com") and suggest a correction when one is known | Validation messages |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | Deleting or archiving data is either undoable (an Undo toast that persists until dismissed, and the action also stays reversible from its status view) or confirmed in an alert dialog that names the object and count. Bulk operations over 100 rows always confirm in an alert dialog that states the row count, even when reversible | `ConfirmDialog` (Base UI AlertDialog), bulk actions |
| 3.3.7 Redundant Entry | A | Onboarding carries domain, competitors and locations forward; imports remember the last column mapping; forms keep entered values after a validation error | Onboarding, import |
| 3.3.8 Accessible Authentication (Minimum) | AA | Password fields allow paste and password managers; TOTP accepts paste; no cognitive puzzles | Auth |
| 4.1.2 Name, Role, Value | A | Correct roles and states on every custom widget (`aria-expanded`, `aria-sort`, `aria-selected`, `aria-pressed`, `aria-checked`, `aria-invalid`) | All components |
| 4.1.3 Status Messages | AA | Result counts, job completion, copy confirmations and errors are announced through live regions without moving focus (section 10) | `Announcer`, `Toaster` / `toast()` |

## 3. Color and contrast

### 3.1 Tested tokens

Contrast is a property of the tokens, not of individual components. [`tokens.contrast.test.ts`](../../apps/web/src/lib/design/tokens.contrast.test.ts) reads `tokens.css` directly and fails CI when any pair drops below its threshold, in both themes. The tested pairs are listed in [02-color-system.md](02-color-system.md):

| Pair type | Threshold |
|---|---|
| Text tokens (`foreground`, `-secondary`, `-tertiary`, `link`, `primary-text`, semantic `-text`, `neutral-text`) on `background`, `surface`, `surface-subtle`, `surface-elevated`, `surface-hover`, `surface-selected` | 4.5:1 |
| Text on `sidebar` | 4.5:1 |
| Semantic text on its own `-subtle`; `primary-foreground` on `primary` and `primary-hover` | 4.5:1 |
| `border-strong`, `ring`, `foreground-muted` on every surface | 3:1 |
| Chart marks and semantic solids on `surface` | 3:1 |
| Categorical palette under simulated color-vision deficiencies | CIEDE2000 at least 15 (normal) and 8 (simulated) |

### 3.2 Rules for components

1. Components use only the tokens in the table. A text color that is not a tested text token cannot be used for text.
2. `foreground-muted` is never used for text, only for icons next to text and separator glyphs.
3. Opacity never creates a text color (`text-foreground/60` is banned by [02-color-system.md](02-color-system.md)).
4. `foreground-disabled` is exempt (WCAG 1.4.3 inactive components) and is used only for disabled controls, never to make active text quieter.
5. Placeholder text uses `foreground-tertiary`, which passes 4.5:1.
6. Control outlines. Checkboxes, radios and switch tracks keep a 3:1 `border-strong` outline (`#81868F`, 3.6:1 on `surface`), because the outline is the only thing that shows an unchecked box or an off switch. Text inputs, selects, secondary buttons, filter buttons and segmented controls use the light `border` (`#E3E6EA`, about 1.2:1 on `surface`). They pass 1.4.11 because the boundary is not what identifies them: a text input always has a visible label and a placeholder or leading icon, a button always has a visible label or an icon that meets 3:1, and a segmented control's segments are labelled and the selected one has a `primary-border` outline and a weight 500 label. An input with no visible label, placeholder or icon is not allowed; it would need `border-strong`. `border-subtle` is a decorative divider and is never the only visible boundary of any control.
7. Selection and current state are never shown by background color alone: selected rows also have a checked checkbox (their `primary-text` key text is a second cue, not the only one), the active inspector row has a 2 px `primary` edge, tabs have a 2 px indicator and weight 500, the active navigation item has weight 500 and `aria-current`, the selected segment has a `primary-border` outline and weight 500, and a selected `CountTabs` item is solid `primary` (5.2:1 against `surface`) with `aria-pressed` or `aria-selected`.

### 3.3 Pairs that need tests before they ship

The following are used in the design but are not yet covered by the test file. Each must be added to `tokens.contrast.test.ts` before the component that uses it merges:

| Pair | Where | Threshold |
|---|---|---|
| `foreground` on each entity highlight tint (`--chart-{n}` at 18% over `surface`) | Evidence viewer `<mark>` | 4.5:1 |
| `foreground` on `neutral-subtle` and on `warning-subtle` | Filter chips, stale badges | 4.5:1 |
| `chart-label` (`foreground-tertiary`) on `surface-subtle` | Chart panels inside wells | 4.5:1 |
| `rank-band-*`, `seq-*`, `div-*` adjacent-step and on-surface contrast | Rank distribution, heatmaps | 3:1 against `surface` for the lightest meaningful step, or a 1 px `border` outline on cells |
| `foreground` and `foreground-inverse` on each `seq-*` step used behind a printed value | Heatmap cells with labels | 4.5:1, choosing the passing text token per step |
| `foreground-inverse` and `foreground` on `chart-1` to `chart-6` and `chart-other` | Percentage labels inside 100% stacked bar segments ([15-data-visualization.md](15-data-visualization.md) section 5.2) | 4.5:1, choosing the passing text token per segment; the label is omitted when neither passes. In the light theme white fails on `chart-2` (3.4:1) and `chart-3` (3.6:1) |
| `primary-foreground` on the fill of the selected `CountTabs` count badge | Change feed and `EventTimeline` filters | 4.5:1 |
| `foreground-muted` (not-mentioned dot) and `primary` (cited and mentioned glyphs) on `surface`, `surface-hover` and `surface-selected` | `EngineStatusGlyph` ([12-tables.md](12-tables.md) section 6) | 3:1 |

### 3.4 APCA (advisory)

APCA is not normative in any W3C Recommendation, and the WCAG 3 Working Draft (10 September 2026) leaves the contrast algorithm undecided. The test suite prints an advisory APCA Lc report for every text pair. A text token at 12 to 14 px with an absolute Lc below 60 is flagged for design review, most often mid-gray text on dark surfaces where WCAG 2 overstates contrast. The response to a flag is to adjust the token so both measures improve. A WCAG 2 failure is never accepted because APCA passes.

## 4. Focus

### 4.1 Focus ring

| Property | Value |
|---|---|
| Style | `outline: 2px solid var(--ring)` via `:focus-visible` (global base style in `globals.css`) |
| Offset | `2px` on standalone controls (`focus-ring`); `-2px` inside dense containers: table cells, menu items, list rows, and all tabs (page, inspector and segmented tabs) (`focus-ring-inset`) |
| Contrast | `ring` meets 3:1 on every surface in both themes (tested) |
| Mechanism | Outline, never `box-shadow`. Outlines survive forced colors and are not clipped by `overflow: hidden` when inset |
| Forced colors | `@media (forced-colors: active) { :focus-visible { outline: 2px solid CanvasText; } }` (already in `globals.css`) |
| Mouse | `:focus-visible` only, so a mouse click on a button does not draw a ring; text inputs always show the ring when focused (browser heuristic) |

Rules:
1. `outline: none` or `outline: 0` is banned by lint unless the same rule sets a replacement outline.
2. The ring is drawn above every other state (precedence in [08-interaction-states.md](08-interaction-states.md)).
3. Focus rings are never animated ([21-motion.md](21-motion.md)).
4. A focused element with a radius gets a ring that follows the radius (outline follows `border-radius` in all supported browsers).

### 4.2 Focus is never obscured

Scroll containers set `scroll-padding-top: var(--sticky-stack-height)`. The bulk-action bar replaces the table toolbar at the top of the table ([12-tables.md](12-tables.md) section 1), so `scroll-padding-top` covers the sticky header and the bulk bar; there is no bottom bar. `--sticky-stack-height` is measured with a `ResizeObserver` on the sticky elements, so wrapping filter chips update it. Toasts render in the bottom-right corner at `--z-toast` and must not cover the focused element: when a toast's bounding box intersects the focused element, the toast stack moves to the top-right for its lifetime. The docked inspector never overlaps the table; the overlay inspector covers the right edge, and the table scrolls the focused cell into the uncovered area.

### 4.3 Focus management

| Event | Focus goes to | Returns to |
|---|---|---|
| Menu, select, popover opens | First item or the selected item (Base UI) | Trigger on close |
| Modal dialog opens | The first field of the body; the Close button when the body has no field; what the caller names with `initialFocus` (the title, for a dialog that opens on a table or list); for destructive confirmations, the least destructive button ("Cancel") | Trigger. When the trigger no longer exists (a deleted row), the screen that closes the dialog moves focus itself: the row now at the same index, else the table |
| Inspector opens (docked or overlay) | Inspector title (`h2`, `tabindex="-1"`) | Escape or the close button returns focus to the originating row cell |
| Inspector record changes (next or previous record) | Stays on the control that changed it | n/a |
| Mobile inspector sheet opens | Back button | The list row |
| Command palette opens | Search input | Previously focused element |
| Client-side route change from navigation | The page `h1` (`tabindex="-1"`); Next.js route announcer also announces the title | n/a |
| URL-only change (filter, sort, tab, pagination) | Stays where it is | n/a |
| Toast appears | Stays where it is (toasts never take focus) | n/a |
| Row removed while focused (filter or bulk action) | Cell in the same column of the row now at the same index; the last row if the index is out of range; the header if the table is empty | n/a |
| Bulk action completes and the bulk bar closes | The grid, at the last focused cell | n/a |

### 4.4 Region cycling

`F6` moves focus to the next main region in this order: sidebar navigation, top bar, main content (the page `h1`), inspector (when open), notifications. `Shift+F6` moves backwards. `F6` is a function key, not a character key, so WCAG 2.1.4 does not apply; it is still listed in the shortcuts dialog.

### 4.5 Skip links

The first focusable element on every page is "Skip to main content" (moves focus to the page `h1`). Table pages add "Skip to results" (moves focus into the DataTable at its last focused cell). Skip links are visually hidden until focused, then appear at the top-left over the top bar with `surface-elevated` and the focus ring.

### 4.6 Landmarks

| Region | Element | Name |
|---|---|---|
| Top bar | `header` (banner) | implicit |
| Sidebar and navigation drawer | `nav` | "Primary" |
| Breadcrumb | `nav` | "Breadcrumb" |
| Page content | `main` | implicit |
| Inspector | `aside` | Labelled by the inspector title |
| Toast viewport | `section` (`role="region"`) | "Notifications" |
| Filter bar (not a landmark) | `div` with `role="group"` | "Filters" |

## 5. Keyboard support per component

Base UI implements the APG keyboard models listed below. Our responsibility is to not break them (no custom `onKeyDown` that swallows keys), to provide names, and to add the behaviors marked "ours".

| Component | APG pattern | Keys | Notes |
|---|---|---|---|
| `Button`, `IconButton` | Button | Enter, Space | Native `button`. Loading state keeps the element focusable with `aria-busy="true"` and `aria-disabled="true"` |
| `Menu` (More, row actions, column options) | Menu button + menu | Enter, Space, Down Arrow open and focus the first item; Up Arrow opens and focuses the last; arrows move; Home, End; type-ahead; Enter activates; Escape closes and returns focus | Trigger has `aria-haspopup="menu"` and `aria-expanded`. Submenus open with Right Arrow, close with Left Arrow |
| `Select` | Select-only combobox with listbox | Enter, Space, Down Arrow open; arrows move; type-ahead; Enter selects and closes; Escape closes without change | Used for single choices with up to 15 options |
| `Combobox` (location, tag, entity pickers) | Editable combobox with listbox popup | Typing filters; Down Arrow opens or moves into the list; Up Arrow moves; Enter selects; Escape closes (second Escape clears the text); Alt+Down opens without moving; Alt+Up closes | DOM focus stays in the input; `aria-activedescendant` marks the active option; the popup is not in the Tab order. Result count announced (section 10) |
| Multi-select list in a popover | Listbox, multi-select | Arrows move; Space toggles; Shift+Arrow extends; Ctrl/Cmd+A selects all; Home, End; type-ahead | `aria-multiselectable="true"`, `aria-selected` on options. Used inside filter value editors |
| `Dialog` | Modal dialog | Tab and Shift+Tab cycle inside; Escape closes | `aria-modal="true"`, `aria-labelledby` title, `aria-describedby` only for a single short description |
| `ConfirmDialog` (Base UI AlertDialog) | Alert dialog | Same as dialog; Escape equals Cancel | `role="alertdialog"`; initial focus on Cancel |
| `Tabs` (page and inspector) | Tabs, automatic activation | Left and Right Arrow move and activate (wrap); Home, End | Panels render without latency; tabs that trigger a slow fetch show the panel skeleton immediately. Tabs are never vertical in this product. Page tabs that change the route path are not a tablist: they are `TabNav`, a `nav` of links with `aria-current="page"` ([09-buttons-controls.md](09-buttons-controls.md) section 12) |
| `Collapsible` (`ui/collapsible.tsx`), row expand | Disclosure | Enter, Space toggle | `aria-expanded`, `aria-controls` |
| `Tooltip` | Tooltip | Shows on focus and hover after 400 ms; Escape hides; focus stays on the trigger | `aria-describedby` on the trigger for supplementary text; icon buttons use `aria-label` equal to the tooltip text instead, not both |
| Info button (toggletip) | Disclosure opening a non-modal popover | Enter, Space open; Escape closes; Tab moves into links inside | Used for metric definitions and methodology links, because tooltips cannot contain links |
| `SegmentedControl` (single choice: density, chart or table view) and `ToggleButton` (independent toggles) | Radio group (single) or toolbar of toggle buttons (multiple) | Single: arrows move and select. Multiple: Tab to the group, arrows move, Space toggles | Single-choice segmented controls are `role="radiogroup"`; independent toggles (Patterns, legend items) are buttons with `aria-pressed` |
| `Checkbox` | Checkbox | Space | Mixed state uses `aria-checked="mixed"` |
| `Switch` | Switch | Space, Enter | `role="switch"` with `aria-checked`; label is the setting name, not "On" |
| `RadioGroup` | Radio group | Arrows move and select; Tab leaves | `fieldset` and `legend` |
| `Slider` (matrix thresholds) | Slider | Arrows by one step, Page Up and Page Down by 10 steps, Home, End | Always paired with a numeric input showing the same value; `aria-valuetext` includes the unit ("Rank threshold 10") |
| Inspector resize handle | Window splitter | Left and Right Arrow resize by 16 px, Shift+Arrow by 64 px; Home sets the 360 px minimum, End sets the maximum (640 px or less by the docking rule); Enter restores the default width | Focusable `role="separator"` with `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext="400 pixels"`, `aria-controls` the inspector (ours) |
| Command palette | Dialog containing an editable combobox with a listbox | Cmd/Ctrl+K opens; typing filters; Up and Down move; Enter runs; Escape closes | Base UI Autocomplete inside Dialog (`inline open`); groups use `role="group"` with `aria-labelledby`; result count announced |
| Filter chips row | Group of buttons | Tab moves between chip segments in DOM order; each chip's value opens its editor; Delete or Backspace on a focused chip's remove button removes the filter (ours) | Chip segments are buttons: "Topic: CRM. Edit filter", "Remove filter Topic". After removal focus moves to the next chip, else to "Add filter" |
| `DateRangePicker` | Dialog with grid (calendar) plus inputs | Text inputs accept typed dates; calendar grid arrows move by day, Page Up and Page Down by month, Home and End to week edges | Presets (7, 28 and 90 days, 12 weeks; [10-forms.md](10-forms.md) section 10.2) are buttons before the calendar. Typed input is the primary path, the calendar is an aid |
| `Toaster` / `toast()` | Status message | Toasts are not focusable except their buttons; the viewport is a named region reachable with F6 | Swipe to dismiss has a Close button |
| Sidebar navigation | Navigation list of links | Tab through links; `[` toggles collapse when single-key shortcuts are on | Collapsed rail links keep their accessible name (the label) and show it as a tooltip |
| Breadcrumb | Breadcrumb | Tab through links | Last item `aria-current="page"` |
| `DataTable` | Grid (section 6) | See section 6.3. F2 enters widget mode for the controls of a cell | Roving focus. Controls in cells (copy buttons, a link) have `tabindex="-1"` and are reached with F2, as the grid has one tab stop |
| `SimpleTable` | Table | Tab through links and buttons inside | No roving focus |

## 6. Tables

### 6.1 Semantics decision

| Table | Semantics | Why |
|---|---|---|
| `DataTable` (Rank Tracker, Prompt Explorer, Citations, Sources, Competitors, inboxes, every list of records with selection, row open or row actions) | Native `<table>` elements with `role="grid"` on the table and roving cell focus | Cells are interactive (row open, selection, links, copy, row actions). With 1,000 to 10,000 rows, putting every link and button in the Tab sequence would make the page unusable from the keyboard |
| `SimpleTable` (inspector key-value tables, chart data tables, import previews under 50 rows, methodology tables, small tables inside panels) | Plain native `<table>` with `th scope="col"` and `th scope="row"` | Read-only or nearly read-only. Screen reader table navigation works without a custom keyboard model; any link inside is a normal Tab stop |
| `DataTable` with grouping active (keyword groups, prompts by topic) | `role="treegrid"` | Group rows expand and collapse (section 6.7) |

A table that has fewer than 50 rows, no selection and at most one link per row uses `SimpleTable`. Anything else uses `DataTable`. There is no third option: a half-implemented grid is worse than a table.

Inspector key-value data is a `SimpleTable` with a visually hidden caption, a `th scope="row"` label column and a `td` value column, so screen readers announce "Search volume, 2,400" when moving by row.

### 6.2 DataTable markup

Virtualization sets CSS `display` on table parts (grid layout for absolute-positioned rows). WebKit has dropped native table semantics when `display` changes, so every part carries its explicit role and the accessibility tree does not depend on CSS.

```html
<h2 id="rt-title" class="sr-only">Keywords</h2>
<p id="rt-help" class="sr-only">
  Use arrow keys to move between cells. Enter opens the keyword. Space selects the row.
  On column headers, Enter sorts and Alt plus Down Arrow opens column options.
</p>
<table role="grid" aria-labelledby="rt-title" aria-describedby="rt-help"
       aria-rowcount="4813" aria-multiselectable="true">
  <thead role="rowgroup">
    <tr role="row" aria-rowindex="1">
      <th role="columnheader" scope="col">
        <button role="checkbox" aria-checked="mixed" aria-label="Select all 4,812 keywords" tabindex="-1"></button>
      </th>
      <th role="columnheader" scope="col" aria-sort="none">
        <button tabindex="-1">Keyword</button>
        <button tabindex="-1" aria-label="Keyword column options" aria-haspopup="menu" aria-expanded="false"></button>
      </th>
      <th role="columnheader" scope="col" aria-sort="ascending">
        <button tabindex="-1">Rank <svg aria-hidden="true"><!-- ArrowUpNarrowWide --></svg></button>
        ...
      </th>
    </tr>
  </thead>
  <tbody role="rowgroup">
    <tr role="row" aria-rowindex="2" aria-selected="false">
      <td role="gridcell"><button role="checkbox" aria-checked="false" aria-label="Select best crm for startups" tabindex="-1"></button></td>
      <th role="rowheader" scope="row" tabindex="0">best crm for startups</th>
      <td role="gridcell" tabindex="-1">4</td>
      ...
    </tr>
  </tbody>
</table>
```

Rules:
1. The identity cell of every row is `th role="rowheader"`, so moving across a row announces the keyword or prompt with each value.
2. Exactly one cell in the grid has `tabindex="0"` (the roving tab stop); every other cell and every widget inside cells has `tabindex="-1"`.
3. The grid is named by the table title (visible or visually hidden) and described by a short hint paragraph. The hint is written once per grid, not per cell.
4. Hidden columns are absent from the DOM ([19-responsive-behavior.md](19-responsive-behavior.md)). Columns are not virtualized in v1 (tables stay under 30 columns), so `aria-colcount` and `aria-colindex` are omitted. If column virtualization is ever added, both become mandatory on every row and cell.
5. Row hover and cell focus look the same on the row (`surface-hover`); the focused cell also has the inset ring ([08-interaction-states.md](08-interaction-states.md)).
6. A header's definition ("KD", "Volume" as an estimate) and a cell's reason ("Pending", "No data", a keyword's location and device) belong to the cell that holds the focus: that cell has `aria-describedby` to a hidden description outside the table, so the cell's own text stays its name, and it opens the cell's tooltip when the keyboard focuses it. A tooltip on an inner span that is never focused reaches no keyboard or screen reader user ([25 deviation 142](25-component-inventory.md)).
7. A row's name for assistive technology (its checkbox, its menu) tells rows apart that the identity text does not: a keyword tracked on both devices reads "seo agency, desktop, Germany" and "seo agency, mobile, Germany".

### 6.3 DataTable keyboard map

Navigation mode (default):

| Key | Action |
|---|---|
| Tab | Enters the grid at the last focused cell, or the first column header on first entry. The next Tab leaves the grid |
| Shift+Tab | Leaves the grid backwards |
| Right, Left Arrow | Moves one cell. Does not wrap to the next row |
| Down, Up Arrow | Moves one row in the same column. Up from the first body row moves to the header row |
| Home, End | First or last cell in the row (on Mac laptops, Fn+Left and Fn+Right) |
| Ctrl+Home, Ctrl+End | First header cell, or the last cell of the last row (scrolls and renders it) |
| Page Down, Page Up | Moves by the number of fully visible rows minus one, same column |
| Enter on a body cell without widgets | Opens the row in the inspector; focus moves to the inspector title |
| Enter or F2 on a cell with widgets (URL cell, row actions, inline editor) | Enters widget mode on that cell. As built, F2 does this for the controls marked `CELL_CONTROL` (the copy buttons and the ranking URL link of Rankings; on a Mac laptop the key is usually fn+F2), and Enter keeps opening the row on every data cell. The grid's hint mentions F2 only when a column shown has such controls ([12-tables.md](12-tables.md) section 9, "Controls in a cell") |
| Space | Toggles selection of the focused row (when selection is enabled) |
| Shift+Space | Selects the range from the selection anchor to the focused row |
| Ctrl+A (Cmd+A on Mac) | Selects every row loaded in the current filter scope; the bulk bar offers "Select all N matching" when more exist |
| Shift+F10 or the Menu key | Opens the row actions menu for the focused row |
| Enter on a column header | Sorts by that column (first activation uses the column's natural direction: ascending for rank, descending for volume and rates; next activation reverses) |
| Shift+Enter on a column header | Adds the column as the next sort key, or reverses it if it is already a key |
| Alt+Down Arrow on a column header | Opens the column options menu (sort, clear sort, hide, move left, move right, pin, resize) |
| Escape | Closes an open tooltip or menu. Never clears the selection |

Widget mode:

| Key | Action |
|---|---|
| Tab, Shift+Tab | Moves between widgets inside the cell, wrapping. Only after F2: a control that was clicked, or a click on the cell itself, is not widget mode, and Tab leaves it as it leaves any button. A window that loses focus (a link opened a new tab) does not end widget mode |
| Enter, Space | Activates the focused widget. On a link the table itself takes Space (the browser gives a link Enter alone and Space would scroll the table) and opens the link |
| Escape | Returns to navigation mode on the same cell, at once, also while the widget's tooltip is open |
| Arrow keys | Hand focus back to the grid and move on from the cell |

Printable characters have no grid meaning (no type-ahead), so the single-key shortcuts in section 14 (including `j`, `k` and the triage keys on a focused row) behave the same in the grid as elsewhere and turn off with the same switch.

Pointer equivalents: click a row opens the inspector ([08-interaction-states.md](08-interaction-states.md)); click a checkbox toggles; Shift+click a checkbox selects a range; click a header sorts; Shift+click a header adds a sort key.

### 6.4 Virtualization

TanStack Virtual renders about 30 of up to 10,000 rows. Screen readers must still know the size of the table and the position of each row.

1. `aria-rowcount` on the grid equals the total number of rows **including header rows**: 4,812 keywords plus 1 header row gives `aria-rowcount="4813"`. When grouping inserts group header rows, they are counted too.
2. When the server reports an estimated or unknown total (server mode above 10,000 rows with an approximate count), `aria-rowcount="-1"`.
3. Every rendered row, including the header row, has `aria-rowindex`. The header row is 1, the first body row is 2, and the value for a body row is its position in the full sorted and filtered list plus the number of header rows. Values strictly increase down the DOM.
4. `aria-rowindex` is set on every rendered row or on none. A partially indexed table misleads assistive technology.
5. The focused row is always rendered: the virtualizer's `rangeExtractor` adds the focused row index to the rendered range, so scrolling away with the mouse does not destroy the focused element.
6. `getItemKey` returns the row id, so focus and selection survive sorting and refetches. Focus follows the row id, not the index, except when the row is removed (section 4.3).
7. Row height is fixed per density (32 or 40 px) and `estimateSize` returns it exactly, so keyboard paging and scroll position are predictable. `overscan` is 10.
8. The sticky header is inside the scroll container and is not virtualized.
9. `aria-rowcount` and the result count announcement (section 10) change together after a filter change.

### 6.5 Sorting

1. Each sortable header is a `th` containing a `button` whose name is the column label. The sort direction icon (`ArrowUpNarrowWide` ascending, `ArrowDownWideNarrow` descending; [07-icons.md](07-icons.md) section 6) is inside the button with `aria-hidden="true"`; no text arrow glyph is used.
2. `aria-sort` sits on the `th` (`ascending`, `descending`, or `none`), never on the button. Only the primary sort key's header gets a value other than `none`; ARIA cannot express multi-level sort.
3. Multi-sort is described in text: the table toolbar shows a sort summary ("Sorted by Rank ascending, then Volume descending") that is visible and is also announced through the status region when the sort changes.
4. Non-sortable headers are plain text in the `th`, with no button.
5. Sort does not move focus. The activated header keeps focus.

### 6.6 Row selection

1. Selection state is on the row: `aria-selected="true"` or `"false"` on every row while selection is enabled; `aria-multiselectable="true"` on the grid. Tables without selection omit both.
2. Each row checkbox is named with the row identity: "Select best crm for startups". The header checkbox is named "Select all {n} {items}" and reports `aria-checked="mixed"` when some rows are selected.
3. Selection changes are announced once, debounced 250 ms so a Shift range produces one message: "12 selected".
4. When the selection covers every loaded row and more rows match, the bulk bar shows a "Select all 4,812 matching" button. Activating it announces "All 4,812 matching keywords selected. Bulk actions apply to all of them." and the bar text changes to "All 4,812 selected. Clear selection".
5. The bulk-action bar replaces the table toolbar in place (same 48 px height, [12-tables.md](12-tables.md) section 1), is a `role="group"` named "Bulk actions, 12 selected", and uses normal Tab order.
6. Selection never happens by arrowing through rows. Only Space, Shift+Space, Ctrl/Cmd+A, and checkbox activation change it.

### 6.7 Grouped rows (treegrid)

When a DataTable is grouped:
1. The table role is `treegrid`. Group rows have `aria-expanded`, `aria-level="1"`, `aria-setsize` and `aria-posinset`; child rows have `aria-level="2"` and their own set size and position. Rows without children never carry `aria-expanded`.
2. Right Arrow on a collapsed group row (focus on its first cell) expands it; on an expanded row it moves to the first child. Left Arrow on an expanded group row collapses it; on a child row it moves to the parent row.
3. The group row's first cell contains the disclosure button ("Expand CRM group, 42 keywords").

### 6.8 Mobile list

Below 768 px the table renders as a list ([19-responsive-behavior.md](19-responsive-behavior.md)).

```html
<ul aria-label="Keywords, 412 results" aria-describedby="sort-summary">
  <li aria-setsize="412" aria-posinset="1">
    <a href="?inspect=keyword:kw_123">
      <span>best crm for startups</span>
      <span><span class="sr-only">Rank</span> 4</span>
      <span>US · Desktop · /pricing</span>
      <span><span aria-hidden="true">↑2</span><span class="sr-only">improved 2 positions</span></span>
    </a>
  </li>
</ul>
```

Rules: each row is one link; its accessible name reads identity, then the primary value with its label, then context, then the delta. Virtualized list items carry `aria-setsize` and `aria-posinset`. The link opens the full-screen inspector sheet.

### 6.9 Loading and empty tables

1. During refetch the table region has `aria-busy="true"`; previous rows stay visible and navigable ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)).
2. Skeleton rows are `aria-hidden="true"`; the region announces "Loading keywords" only if loading lasts more than 2 seconds, once.
3. Empty results render a single message outside the grid ("No keywords match these filters" with "Clear filters"); the grid keeps its header row so the column structure is still announced.

## 7. Drag alternatives (WCAG 2.5.7)

Every drag has a single-pointer alternative that does not require dragging. Keyboard support alone does not satisfy 2.5.7.

| Drag interaction | Single-pointer alternative | Keyboard |
|---|---|---|
| Column resize (drag the header edge) | Column options menu, "Resize column...": popover with a number input (px, step 8, bounded by the column min and max), "Fit to content" and "Reset". Double-click on the edge fits to content | Same menu via Alt+Down Arrow on the header |
| Column reorder (drag a header) | Column options menu: "Move left", "Move right", "Move to start", "Move to end" | Same menu. Announces "Volume moved to position 4 of 9" |
| Column reorder in the column chooser | "Move up" and "Move down" buttons on each row (visible on hover and focus, always visible on touch) | Buttons, plus Alt+Up and Alt+Down on a focused row |
| Inspector resize (drag the left edge) | Inspector header menu: "Width: Default, Wide, Maximum" | Focusable window splitter (section 5) |
| Chart brush to zoom a date range | Date range inputs and presets in the filter bar; "Reset zoom" button in the chart toolbar | Same controls |
| Matrix threshold slider | Click on the slider track sets the value; numeric input beside the slider | Slider keys, numeric input |
| Card reorder in customize mode (drag the card's handle) | The card toolbar's More menu: "Move earlier", "Move later", "Move to start", "Move to end" | The handle is a button: Space picks the card up, arrow keys move it, Space drops it, Escape puts it back. Announces "Rank distribution, position 2 of 8" |
| Headline number reorder in customize mode | Remove the number and add it again at the end; the strip has at most 6 | Same handle keys as cards |
| Swipe to dismiss toasts and sheets | Close button | Escape (sheets), Close button (toasts) |

During a pointer drag, Escape cancels and restores the previous state. The resize handle itself is 8 px wide visually and in hit area; it relies on the "Equivalent" exception of 2.5.8 because the menu alternative exists.

## 8. Target size (WCAG 2.5.8)

| Element | Target | How it passes |
|---|---|---|
| Buttons and inputs | 36 px tall (`h-control`); 32 px (`h-control-sm`) for pagination and icon buttons in tables and inspectors; 40 px on auth and onboarding | Size |
| Hover actions inside table cells (copy, open) | 24 x 24 px, 14 px icon | Size; adjacent icon buttons have no overlap |
| Checkboxes and radios | 16 px box inside a 24 x 24 px label target | Size |
| Toggle switch | 36 x 20 px track inside a 24 px tall target (padding); clicking the label also toggles | Size |
| Sidebar items | 32 px tall, 4 px apart | Size |
| Pagination buttons | 32 x 32 px | Size |
| Filter chip remove button | 24 x 24 px padded target around a 12 px icon | Size |
| Badges with a tooltip | 22 px tall, at least 24 px wide via padding, or spacing: the 24 px circle around the badge does not intersect another target | Spacing |
| Inline links in text | Any | Inline exception |
| Column resize handle | 8 px | Equivalent exception (menu alternative, section 7) |
| Chart data points | Any | Essential presentation; values are available in the data table |
| Mobile layout primary actions | 44 px | Product rule, above the minimum ([19-responsive-behavior.md](19-responsive-behavior.md)) |

Hit areas are enlarged with padding or a transparent `::after`, never by scaling the icon.

## 9. Screen reader labeling rules

### 9.1 General

1. **Icon buttons:** `aria-label` equals the tooltip text and starts with a verb when it is an action ("Copy ranking URL", "Close inspector"). The icon is `aria-hidden`.
2. **Repeated controls in rows** include the row identity: "More actions for best crm for startups", "Open best crm for startups".
3. **Visible label first** (2.5.3): if a button shows "Export", its accessible name starts with "Export" ("Export CSV" is fine, "Download" is not).
4. **External links** append visually hidden "(opens in a new tab)" and show the `ExternalLink` icon. As built, the ranking URL link in a table cell has the words in its name ("Open /pricing in a new tab") and no icon, since the column has no width to spare for it ([12-tables.md](12-tables.md) section 9, "Controls in a cell").
5. **Badges with meaning** are text, not color: "Estimate", "Stale", engine names. Beyond-depth ranks are plain text, not a badge (section 9.2). A status dot always sits next to its word; a dot alone is `aria-hidden` only when the word is present.
6. **Abbreviations** that appear to save width ("obs", "pts", "vol") are rendered with an `aria-hidden` short form and a visually hidden full form, so screen readers say "observations" and "percentage points".
7. **Unknown is never zero.** A missing value shows `n/a` ([22-content-formatting.md](22-content-formatting.md) section 2, rule 5) with the accessible name "No data", an insufficient one "Insufficient data" (visible text "Insufficient" in cells, "Insufficient data" in tiles and the inspector, [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 8), never "0" or an empty cell.
8. **Decorative separators** (the middle dot, dividers) are `aria-hidden`.

### 9.2 Value formatting contract

Formatters in `@/lib/format` ([22-content-formatting.md](22-content-formatting.md)) supply both the visible string and the screen reader string. The change formatters return `{ text, label, tone }` (`RankChangeDisplay` from `formatRankChange`, `MetricDeltaDisplay` from `formatMetricDelta`); rank values pair `formatRankCell` or `formatRankInline` (visible) with `describeRank` (spoken). Cell components render them as:

```tsx
<span aria-hidden="true">{f.text}</span>
<span className="sr-only">{f.label}</span>
```

| Value | Visual | Screen reader text |
|---|---|---|
| Rank | `4` | "rank 4" (`describeRank`) |
| Rank beyond depth | `>20` text in cells (`formatRankCell`), never a chip; "not in top 20" text in tiles and the inspector (`formatRankInline`) | "not in top 20" (`describeRank`) |
| Rank change up | `↑5` | "improved 5 positions" |
| Rank change down | `↓3` | "declined 3 positions" |
| Rank change none | `0` (never a dash glyph) | "no change" |
| New in tracked depth | `New` | "entered the tracked depth" |
| Lost from tracked depth | `Lost` | "dropped out of the tracked depth" |
| Beyond depth in both checks | Empty visible text | "still beyond tracked depth" |
| First check | Empty visible text | "first check" |
| Rate | `34%` | "34%" |
| Rate with denominator | `34%` and `612 of 1,800 obs` | "34%, 612 of 1,800 observations" |
| Rate delta, not detectable | `+2 pts` in neutral | "up 2 percentage points, within normal variation" |
| Rate delta, detectable | `+2 pts` colored | "up 2 percentage points, detectable change" |
| Interval | `31% to 37%` | "95% interval, 31% to 37%" |
| Estimate | `2.4K` with `Estimate` badge | "2,400, estimated" |
| Compact number | `2.4K` | "2,400" (compact forms are expanded for speech) |
| Insufficient data | Hatched cell with `Insufficient` in cells; `Insufficient data` plus the counts line in tiles and the inspector | "Insufficient data, 3 of 4 required observations" |
| Not applicable | `No AIO` in cells; `No AI Overview in window` in tiles and the inspector | "Not applicable, no AI Overview in window" |
| AI Overview cell | `Cited #2` | "AI Overview present, cited at position 2" |
| SERP features | Icons | List named "SERP features": "Featured snippet, owned. People also ask. Video" |
| Sparkline | Line | `role="img"`, "Rank trend, last 30 checks: from 9 to 4, best 3, 2 checks not in top 20" |
| Relative time | `2h ago` | "2 hours ago" with the absolute time in the tooltip |
| Minus sign | `−3` (U+2212) | Read as "minus 3" by VoiceOver and NVDA; no extra handling |

The formatter owns `label`; components never compose screen reader strings themselves.

## 10. Live regions and status messages

### 10.1 Architecture

1. The app shell mounts two empty regions at load: a polite `role="status"` region and an assertive `role="alert"` region, both visually hidden. They exist before any message so screen readers register them.
2. Components announce through `announce(message, { politeness, key, debounceMs })` from `lib/a11y/announcer.ts`. Components never create their own ad hoc live regions, except the Toast viewport (Base UI) and form error summaries.
3. Messages with the same `key` replace each other; a newer message cancels a pending debounced one.
4. The status region is cleared 1 second after each message so the same text can be announced again later.

### 10.2 Events and messages

| Event | Example message | Politeness | Timing |
|---|---|---|---|
| Filter or search result count changes | "Showing 412 keywords" | polite | 500 ms after the last filter or query change, and only after results arrive; skipped if the count did not change |
| Filter results are empty | "No keywords match these filters" | polite | Same |
| Sort changes | "Sorted by Rank, ascending, then by Volume, descending" | polite | On change |
| Selection changes | "12 selected" | polite | 250 ms debounce |
| Select all matching | "All 4,812 matching keywords selected" | polite | On change |
| Combobox and command palette results | "8 results" | polite | 500 ms after typing stops |
| Background job completed (import, export, run, check) | "Keyword import finished: 1,184 added, 12 skipped" | polite | On completion, plus a toast |
| Background job failed | "Export failed. The file was not created. Try again." | assertive | On failure, plus a toast |
| Bulk action completed | "Tag CRM added to 12 keywords. Undo is available." | polite | Via the toast |
| Copy to clipboard | "Copied" | polite | On copy ([08-interaction-states.md](08-interaction-states.md)) |
| Column moved or hidden | "Volume moved to position 4 of 9" | polite | On change |
| Saved view applied | "View CRM keywords applied, 3 filters" | polite | On change |
| Long load | "Still loading keywords" | polite | Once, after 2 seconds |
| New data available (not auto-applied) | "New results available" | polite | Once per refresh cycle |

### 10.3 What is never announced

- Individual keystrokes, intermediate query states, or counts while the user is still typing.
- Tooltip or hover content.
- Progress ticks of a running job (the `progressbar` exposes its value for those who query it; only start and finish are announced).
- Focus movement inside the grid (the screen reader already reads the cell).
- Theme changes, density changes, sidebar collapse.
- Data refreshed in the background without a user action.

### 10.4 No updates under the user

Tables and charts do not change their rows while the user is reading them. When a run finishes and new data exists for the current view, a one-line bar appears in the table toolbar slot: "New results available. Refresh" (announced once, politely). Only an explicit refresh, a filter change or navigation replaces the data. Run and Ops screens that show progress update progress values in place, and a "Pause updates" toggle stops them (WCAG 2.2.2).

### 10.5 Toasts

1. Base UI Toast. The viewport is a region named "Notifications".
2. Success and info toasts are polite; error toasts are assertive.
3. Toasts never take focus.
4. A success or info toast without an action dismisses after 6 seconds; the timer pauses while the pointer is over it, while it or any toast has focus, and while the window is not focused.
5. A toast with an action (Undo, Retry, Open report) and every error toast stay until dismissed or the action is used.
6. Toasts are not copied to the notification center, which lists alert events and system notices only ([18-notifications-alerts.md](18-notifications-alerts.md) section 5.6). A missed toast is still recoverable: toasts with an action persist until dismissed, the result of every action is visible in place or in its status view, and async export results also appear in the notification center.

## 11. Forms

### 11.1 Structure

1. Every field uses Base UI `Field` (`Field.Root`, `Field.Label`, `Field.Control`, `Field.Description`, `Field.Error`). The label is visible and programmatically associated; the description and error are referenced by `aria-describedby` in that order.
2. Placeholders are examples, never labels or instructions.
3. Groups of related controls (radio groups, checkbox groups, date ranges) are `fieldset` with a visible `legend`.
4. Required fields are the default. Optional fields say "(optional)" in the label. Required fields also carry `aria-required="true"`.
5. Format hints are in the description line before the user types ("One domain, without https://").

### 11.2 Validation and errors

1. Format validation runs on blur once the field has been edited, and on submit for all fields. Errors never appear while the user is still typing in an untouched field.
2. An error message is text below the field with the `CircleX` icon in `negative-text`, and the control gets `aria-invalid="true"` and the `negative-solid` border. Color is never the only signal (3.3.1).
3. Messages say what to do (3.3.3): "Enter a domain such as example.com", "Did you mean acme.com?", "Choose a location from the list; 'Untied States' has no match".
4. On submit with errors: forms with up to 6 fields and one section move focus to the first invalid field; longer or multi-section forms show an error summary at the top (`tabindex="-1"`, focused, heading "Fix 2 fields to save", each item a link to its field; [10-forms.md](10-forms.md) section 18).
5. Entered values are never cleared by a validation error or a failed submit.
6. Server errors that belong to a field are attached to that field; others appear in an inline banner above the form actions with `role="alert"`.

### 11.3 Redundant entry (3.3.7)

Onboarding carries the domain, competitors and locations from step to step and shows them for confirmation instead of asking again. The keyword import remembers the last column mapping per project. A dialog that fails keeps its values when reopened in the same session.

### 11.4 Authentication (3.3.8)

Password fields allow paste and password managers (`autocomplete="current-password"` or `"new-password"`); TOTP fields accept paste (`autocomplete="one-time-code"`, `inputmode="numeric"`); no puzzles, no character-position questions.

### 11.5 Input purpose (1.3.5)

| Field | `autocomplete` |
|---|---|
| Full name | `name` |
| Email (sign in, profile, invites to self) | `email` |
| Password | `current-password` or `new-password` |
| One-time code | `one-time-code` |
| Organization name (signup) | `organization` |
| Job title (profile) | `organization-title` |
| Phone (billing contact) | `tel` |

Fields about projects (domain, competitor names, keywords) are not the user's personal data and get no `autocomplete` token; they use `autocomplete="off"` only when browser suggestions would be wrong (competitor domains).

### 11.6 Input size on touch

Text inputs in the mobile layout use a 16 px font so iOS Safari does not zoom on focus ([19-responsive-behavior.md](19-responsive-behavior.md)).

## 12. Charts

Chart design rules are in [15-data-visualization.md](15-data-visualization.md). The accessibility requirements every chart meets through the `EChart` wrapper:

### 12.1 Structure

```html
<figure aria-labelledby="c1-title" aria-describedby="c1-summary">
  <figcaption>
    <h3 id="c1-title">Average position, last 28 days</h3>
    <p id="c1-summary">Average position improved from 14.2 to 9.8 between Sep 1 and Sep 29; best 7.1 on Sep 22.</p>
  </figcaption>
  <div role="group" aria-label="Chart view">  <!-- SegmentedControl: Chart | Table, Patterns ToggleButton, legend -->
  <div role="img" aria-label="(ECharts aria description)">  <!-- chart canvas container -->
  <table>  <!-- rendered when Table view is selected -->
</figure>
```

1. **Short text alternative:** the title and a one-sentence visible summary in the `figcaption`, produced by the feature component from the data (metric, range, direction, extremes, and whether a change is within normal variation). The summary is visible to everyone, not only screen reader users.
2. **Long description:** ECharts `aria.enabled: true` with `aria.label.description` set by the wrapper to a structural description: chart type, axes and units, series count and names, and for each series the first, last, minimum and maximum values. The generated ECharts text is never used, because its default `data.maxCount` of 10 would describe a 90-day series by its first 10 points. The wrapper imports `AriaComponent` (not included by default in ECharts 6).
3. **Data table:** a "Chart / Table" toggle (single-choice segmented control) swaps the canvas for a `SimpleTable` of the same data, including n, interval bounds and depth columns, with CSV export ([20-frontend-specification.md](../20-frontend-specification.md) section 4.6). The table is the complete long description.
4. The chart canvas is not a Tab stop. Everything interactive about a chart is an HTML control: the view toggle, the Patterns toggle, legend items, range inputs, "Reset zoom".
5. Clicking a point to open a record has an equivalent in the table view (the row opens the same record).

### 12.2 Non-color encodings (1.4.1)

| Element | Encoding besides color |
|---|---|
| Own brand series (`chart-1`) | Solid line with circle markers (every series line is 2 px, so width is not a cue), always first in the legend and labeled "(you)" |
| Competitor series 2 to 6 | Marker shapes in fixed order: square, triangle, diamond, empty circle, empty diamond |
| Reference series (previous period, baselines) | Dashed line, dash pattern `[4, 4]`, `chart-reference` |
| "Other" aggregate | Dashed line, dash pattern `[8, 4]`, `chart-other` |
| Estimates | Dotted line, pattern `[1, 3]`, "Estimate" in the series name |
| Cross-engine average | Dashed, named "Equal-weight average (3 engines)" |
| Beyond-depth checks | Hollow markers inside a hatched band labeled "Not in top 20" |
| Bars, areas, stacked bars, heatmap segments | Decal patterns when the Patterns toggle is on |
| Line series with 4 or fewer series and enough width | Direct end-of-line labels |

Markers are drawn on series with 60 points or fewer; denser series rely on direct labels, the legend and the table.

### 12.3 Patterns toggle

A "Patterns" toggle button (`aria-pressed`) in every chart toolbar sets ECharts `aria.decal.show`. The choice is stored per user and applies to all charts. It turns on automatically in forced colors mode.

### 12.4 Legends

Legends are HTML, not ECharts legends. Each item is a button with `aria-pressed` that shows or hides its series and includes its swatch (an 8 px dot, the series' marker shape when markers are drawn, or a short line in its dash pattern, [15-data-visualization.md](15-data-visualization.md) section 2) and its name. Hiding a series announces "HubSpot hidden". At least one series always stays visible; the last visible item's button is `aria-disabled` with the tooltip "At least one series stays visible".

### 12.5 Tooltips

ECharts tooltips are pointer-only aids. They close with Escape, stay open while hovered (`enterable: true`), and never carry information that is not in the table view. Tooltip text is plain text or escaped HTML ([20-frontend-specification.md](../20-frontend-specification.md) section 4.6).

### 12.6 Brush alternatives

Brush zoom is available only on fine pointers and always paired with the date range control and presets. The chart toolbar shows "Reset zoom" whenever the chart is zoomed, and the current zoom range is written in the chart subtitle ("Showing Sep 8 to Sep 22").

## 13. Motion, transparency, forced colors, spacing, reflow and zoom

### 13.1 Reduced motion

All motion follows [21-motion.md](21-motion.md). Under `prefers-reduced-motion: reduce` or the in-app "Reduce motion" setting, duration tokens are 0, skeletons do not pulse, spinners and the live indicator stop, and scrolling is instant. No information is ever conveyed only by motion.

### 13.2 Reduced transparency

The design does not rely on transparency for legibility: every surface is opaque, and there is no blur or translucent chrome. The only translucent layers are the modal scrim (a backdrop behind a dialog, not a surface for text) and entity highlight tints, whose text contrast is tested (section 3.3). `prefers-reduced-transparency` therefore needs no special handling; if a translucent surface is ever proposed, it must provide an opaque alternative under that query.

### 13.3 Forced colors

Windows forced colors replaces author colors with system colors and removes `box-shadow` and non-image backgrounds. Rules:

1. **Surfaces that rely on background or shadow for their edge get a `1px solid transparent` border**: popovers, menus, selects, tooltips, dialogs, the command palette, toasts, the overlay inspector, sheets, badges, segmented control tracks, the bulk-action bar. The border becomes visible in the system border color. Surfaces that already have a real `border` need nothing.
2. **Focus** is an outline, so it survives; `globals.css` sets it to `CanvasText`.
3. **Selected rows and current items** use system colors:
   ```css
   @media (forced-colors: active) {
     [role="row"][aria-selected="true"] { background: Highlight; color: HighlightText; }
     [aria-current="page"], [role="tab"][aria-selected="true"] { outline: 1px solid CanvasText; }
     .row-active-edge { background: Highlight; }  /* 2 px active inspector row edge */
   }
   ```
4. **Icons** use `currentColor` and follow `CanvasText` or `ButtonText`.
5. **Hatched cells** (insufficient data) lose their pattern; the "Insufficient" text remains, so nothing is lost.
6. **Disabled controls** use `GrayText` automatically; do not override.
7. **`forced-color-adjust: none` is allowed only on data swatches and chart canvases**, and each use carries this comment in the CSS: `/* forced-color-adjust: none: series identity is encoded in color and matched to the legend swatch; see 20-accessibility.md section 13.3 */`. Covered elements:
   - Chart canvas containers. The chart paints an opaque `surface` background so its tested contrast holds; decals turn on automatically; dash styles and markers stay.
   - Legend swatches, entity color swatches, rank band and heatmap legend swatches, and heatmap cells.
   Nothing else may use it. Text, controls, badges and evidence highlights follow system colors (evidence highlights become `Mark` and `MarkText`, and each carries its entity label).
8. Forced colors is tested with Chromium emulation in CI (section 18) and with Windows High Contrast themes in Edge per release.

### 13.4 Text spacing (1.4.12)

The UI must lose no content when users apply line height 1.5, paragraph spacing 2x, letter spacing 0.12em and word spacing 0.16em.

1. Line heights are absolute `rem` values (20 px for 13 px and 14 px text, 16 px for 12 px table text). A 1.5 override gives 18 px for 12 px table text, which fits a 32 px row, and 19.5 px for 13 px text, which fits the same boxes, and 21 px for 14 px body text, which grows single-line controls, rows and sidebar items by 1 px through `min-height` (rule 2). Prose (14 px) goes from 22 to 21 px.
2. Controls, badges, chips and rows set `min-height`, never `height` with `overflow: hidden` on text. Where a component token uses `h-*`, the text inside is a single line that may widen, never a clipped block.
3. Widths are never fixed on text containers (labels, buttons, chips, badges). Letter spacing makes them wider; layouts tolerate that (30% longer strings, [03-typography.md](03-typography.md)).
4. Single-line truncation is the designed state for table cells, not a spacing failure: the full value is always available in the tooltip (on hover and focus) and in the inspector. Elements that truncate carry `data-truncate` so the test can exclude them.
5. Test: Playwright injects the WCAG text-spacing stylesheet on every page template and fails if any element without `data-truncate` has `scrollHeight > clientHeight` or `scrollWidth > clientWidth` while having `overflow: hidden` or `clip`.

### 13.5 Reflow (1.4.10)

At 320 CSS px (1280 px at 400% zoom):
1. Page chrome reflows with no horizontal page scroll: top bar, navigation drawer, page header, filter sheet, metric strip, forms, dialogs (full-screen sheets), inspector (full-screen sheet), prose, empty and error states.
2. Data tables are exempt and may scroll horizontally inside their region. In the mobile layout they render as list rows by default, with a "Table" option on fine-pointer devices ([19-responsive-behavior.md](19-responsive-behavior.md)).
3. The table's title, search, sort control and pagination are not exempt and reflow.
4. Cell content inside a data table wraps or truncates with a full-value tooltip; no single cell forces its own scroll.
5. Charts keep a 280 px minimum and never exceed the viewport.

### 13.6 Zoom at 200% on a 1280 px screen

1280 px at 200% is 640 CSS px, which is the mobile layout. Because this user has a fine pointer, every feature stays available ([19-responsive-behavior.md](19-responsive-behavior.md)): bulk editing, column customization and imports work in the reflowed layout. At 200% the viewport is about 400 CSS px tall; the sticky stack stays under 40% of the height, and the short-viewport rule unsticks the page header below 480 px of height. Every core flow in section 18.3 is walked at 200% per release.

## 14. Keyboard shortcuts (2.1.4)

| Shortcut | Action | Kind | Can be turned off |
|---|---|---|---|
| Cmd+K / Ctrl+K | Open command palette | Modifier | No (not covered by 2.1.4) |
| `/` | Table pages: focus the table search. Other pages: open the command palette in search mode | Single character | Yes |
| `?` | Open the keyboard shortcuts dialog | Single character | Yes |
| `[` | Collapse or expand the sidebar | Single character | Yes |
| `g` then a letter | Go to a destination ([11-navigation.md](11-navigation.md) section 7) | Sequence of single characters | Yes |
| `f` | Open the "+ Filter" field picker on table pages ([13-filters-search.md](13-filters-search.md) section 7) | Single character | Yes |
| `j`, `k` | Next or previous row or record, when focus is in the grid or the inspector ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.10) | Single character | Yes |
| `a`, `r`, `s`, `e` | Accept, reject, snooze or edit the focused row in triage inboxes ([23-application-patterns.md](23-application-patterns.md) section 10.2) | Single character | Yes |
| F6, Shift+F6 | Cycle focus between regions | Function key | No |
| Escape | Close the topmost overlay | Non-printable | No |

Rules:
1. Single-character shortcuts fire only when focus is not in an `input`, `textarea`, `select`, `[contenteditable]` or `[role="combobox"]`, when no modifier other than Shift is pressed, when no modal overlay is open, and never during IME composition (`event.isComposing`).
2. **The "Single-key shortcuts" switch in Settings > Preferences** turns all single-character and sequence shortcuts off ([11-navigation.md](11-navigation.md) section 5). Default is on. The setting is stored per user by the API, so it follows the user across devices.
3. New single-character shortcuts must be added to this table and to the shortcuts dialog, and must respect the switch through the shared `useShortcut` hook. Components never add `keydown` listeners on `document` directly.
4. Shortcuts are shown in tooltips (`Kbd` component) and in the shortcuts dialog. When the switch is off, single-key hints are hidden from tooltips.
5. Grid keys (section 6.3) are scoped to the focused grid and are not page shortcuts.

## 15. Consistent help (3.2.6)

1. **Help menu** in the top bar, immediately left of the user menu, on every page and at every width. Items in this order: "Methodology", "Keyboard shortcuts", "Documentation", "Contact support". The icon is `CircleHelp` with the name "Help"; this glyph assignment is added to [07-icons.md](07-icons.md).
2. **Metric methodology:** every metric label is followed by the same info button (`Info` icon, name "About {metric}"). Its popover always ends with the "Methodology" link as the last line ([22-content-formatting.md](22-content-formatting.md) section 10).
3. **Page methodology:** pages with metrics end their page header meta line with a "Methodology" link in the same slot.
4. **Inspector:** metric sections in the inspector use the same metric label component, so the info button is in the same place.

## 16. Language

1. `<html lang="en">` on every page.
2. Collected content in another language carries `lang` from the prompt's `language_code` (BCP 47) on its container: the evidence viewer answer, prompt text in `PromptCell` and the inspector, fan-out queries, and citation titles when the source language is known.
3. Right-to-left languages also get `dir="auto"` on the same containers so text renders in the correct direction without affecting the surrounding UI.
4. When the language is unknown, no `lang` attribute is set (the page language applies); `lang=""` and `lang="und"` are not used.
5. Keywords are shown in the language they were entered; keyword cells get `lang` when the project location's language differs from English.

## 17. Timing and sessions

1. Session expiry shows an alert dialog 2 minutes before expiry: "Your session ends in 2 minutes" with "Stay signed in" (initial focus) and "Sign out". Unsaved form input survives re-authentication.
2. No UI action has a time limit other than session expiry. The Undo toast after a reversible action persists until dismissed (section 10.5), and the action also stays reversible from its status view (for example the Rejected or Snoozed triage view, [23-application-patterns.md](23-application-patterns.md) section 10).
3. Toast timing follows section 10.5.

## 18. Testing

### 18.1 Automated (every CI run, merge-blocking)

| Check | Tooling | Scope |
|---|---|---|
| Token contrast and color-vision separation | `tokens.contrast.test.ts` (Vitest) | Every token pair in section 3, both themes |
| Component accessibility | Vitest, Testing Library, `vitest-axe` | Every primitive in `components/ui` and every composite in `components/app`, default and each state (open, invalid, disabled, loading, selected) |
| Component keyboard behavior | Testing Library `user-event` | The keyboard tables in sections 5 and 6.3, one test per row |
| Page templates | `@axe-core/playwright` with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` | Every page template (sign in, onboarding, overview, table page, detail page, prompt list and detail with evidence viewer, matrix, settings form, costs, alerts, ops, design-system preview) in light and dark themes, at 1440 and at 390 px, in states: default, inspector open, dialog open, filter popover or sheet open, empty, error |
| Grid keyboard E2E | Playwright | Rank Tracker and Prompt Explorer: full keyboard map, selection, sort, focus retention through virtualization (jump with Ctrl+End, return with Ctrl+Home) |
| Virtualization ARIA | Playwright | `aria-rowcount` equals total plus header rows; every rendered row has a strictly increasing `aria-rowindex`; focused row stays rendered after wheel scrolling |
| Reduced motion | Playwright `reducedMotion: 'reduce'` | Computed `transition-duration` is 0s on overlays, `document.getAnimations()` is empty after opening each overlay ([21-motion.md](21-motion.md)) |
| Forced colors | Playwright `forcedColors: 'active'` screenshots | Table page, dialog, menu, chart panel, filter chips: visible boundaries and focus |
| Text spacing | Playwright stylesheet injection (section 13.4) | Every template |
| Reflow and zoom | Playwright at 320 x 568 and 640 x 400 | No horizontal page scroll; core controls present |
| Label in name | Playwright script | Every button with visible text has an accessible name that starts with it |

axe findings are fixed, not suppressed. An exception requires an entry in `e2e/a11y-allowlist.ts` with the rule id, selector, reason, owner and an expiry date no more than 90 days out; expired entries fail the build. `best-practice` rules run as a non-blocking report.

### 18.2 Manual screen reader checks (every release)

| Combination | Flows |
|---|---|
| VoiceOver with Safari (current macOS) | All core flows in 18.3 |
| NVDA with Firefox (current versions, Windows) | All core flows in 18.3 |
| VoiceOver with Safari (current iOS) | Mobile list, filter sheet, inspector sheet, alerts |

For each flow the tester records whether names, roles, states, table position ("row 12 of 4,813") and announcements match this document. A flow that cannot be completed is a release blocker; wrong or missing information is a major defect fixed before the next release.

### 18.3 Core flows

1. Sign in with TOTP.
2. Onboarding: create a project, add competitors and locations.
3. Rank Tracker: apply two filters, sort by two columns, select 10 rows with the keyboard, add a tag in bulk, undo.
4. Rank Tracker: open a keyword in the inspector, read hidden columns, return to the row.
5. Keyword detail: read the rank history chart summary and its table view.
6. Prompt Explorer: filter by engine, open a prompt, read an answer in the evidence viewer with entity highlights and citations.
7. Import keywords from CSV, fix a validation error, confirm.
8. Resize a column and reorder a column without a mouse drag.
9. Create an alert rule and acknowledge an alert.
10. Command palette: find and open a saved view.

### 18.4 Keyboard-only walkthrough checklist (every release, and for every new screen)

- [ ] "Skip to main content" is the first Tab stop and works.
- [ ] Every interactive element is reachable, in visual order, and shows the focus ring.
- [ ] No focus lands on hidden, off-screen or `aria-hidden` content.
- [ ] Focus is never hidden under the sticky header, filter bar, bulk bar or toasts.
- [ ] Every overlay opens with the keyboard, traps focus if modal, closes with Escape and returns focus to its trigger.
- [ ] The DataTable is one Tab stop; the keyboard map in section 6.3 works completely.
- [ ] Sort, filter, select, bulk act, open the inspector and return, without a mouse.
- [ ] Column resize and reorder work from the column options menu.
- [ ] Inspector resize works with the separator keys and the width menu.
- [ ] Charts: the view toggle, Patterns, legend items and range controls are reachable and operable.
- [ ] Single-key shortcuts work outside inputs, do nothing inside inputs, and stop after turning the switch off.
- [ ] F6 cycles regions.
- [ ] Forms: errors are announced and focus goes to the first invalid field or the summary.
- [ ] Everything above also works at 200% zoom.

## 19. Component accessibility checklist

| Component | Semantics | Keyboard | Name, state, description | Also check |
|---|---|---|---|---|
| `Button` | Native `button`, `type` set | Enter, Space | Visible label is the name; loading: `aria-busy`, `aria-disabled` | Pressed style is not the only state for toggles (`aria-pressed`) |
| `IconButton` | Native `button` | Enter, Space | `aria-label` equals tooltip; icon `aria-hidden` | 24 px minimum target; tooltip on focus |
| `TextLink` | Native `a` with `href` | Enter | Link text describes the destination; external: "(opens in a new tab)" | Underlined at rest in running text (`variant="inline"`): the link color is below 3:1 against body text in both themes, so color alone does not mark a link (WCAG 1.4.1). A link that stands alone (`standalone`) is underlined on hover and focus |
| `Input`, `Textarea` | `Field` parts | Native | Label, description, error wired by `Field` | 16 px font in mobile layout; `autocomplete` where applicable |
| `Select` | Base UI Select | APG select | Label via `Field.Label`; value announced | Trigger shows the chosen value, not only a placeholder |
| `Combobox` | Base UI Combobox | APG combobox | `aria-activedescendant`, `aria-expanded`, result count announced | Popup not in Tab order |
| `Checkbox` | Base UI Checkbox | Space | Label; `aria-checked` including `mixed` | 24 px target; `border-strong` outline |
| `Switch` | `role="switch"` | Space, Enter | Setting name as label | Track outline 3:1 |
| `RadioGroup` | `fieldset`, radios | Arrows | `legend` names the group | |
| `SegmentedControl` (single choice), `ToggleButton` (independent) | `radiogroup` or `aria-pressed` buttons | Arrows or Tab plus Space | Group label | Selected state not by color alone (`primary-border` outline, weight 500 and fill) |
| `CountTabs` | `aria-pressed` toggle buttons (multi-select filters) or `radiogroup` (single choice) | Tab plus Space, or arrows in a radiogroup | Name includes the count ("Rank, 5 events") | Selected item is solid `primary`, a change in lightness, not hue alone |
| `Tabs` | Base UI Tabs | Arrows, Home, End | Tablist labelled; `aria-selected`; panels labelled | Overflow "More tabs" button outside the tablist |
| `Menu` | Base UI Menu | APG menu button | Trigger `aria-haspopup`, `aria-expanded`; items named | Disabled items stay focusable with `aria-disabled` and a reason |
| `Popover` | Base UI Popover, non-modal | Escape closes; focus moves in | Labelled by its heading | Returns focus to trigger |
| `Tooltip` | `role="tooltip"` | Focus shows, Escape hides | Supplementary text only | Hoverable, no timeout, never holds interactive content |
| Info button (toggletip) | Button plus popover | Enter, Space, Escape | "About {metric}" | Contains the methodology link |
| `Dialog` | Base UI Dialog, modal | Tab cycle, Escape | `aria-labelledby` title | Initial focus rule (section 4.3); full-screen sheet below 640 px |
| `ConfirmDialog` (Base UI AlertDialog) | `role="alertdialog"` | Escape equals Cancel | Title names the object and count | Initial focus on Cancel |
| `Drawer` / `Sheet` | Base UI Drawer | Escape, close button | Labelled by title | Swipe has a button alternative |
| `Inspector` | `aside`, non-modal when docked or overlaid; modal sheet on mobile | Escape closes; F6 reaches it | Labelled by the record title | Resize separator (window splitter); focus returns to the row |
| `CommandPalette` | Dialog with combobox and listbox | Cmd/Ctrl+K, arrows, Enter, Escape | Input labelled "Search or run a command"; result count announced | Groups labelled |
| `Toaster` / `toast()` | Base UI Toast in a named region | Buttons only | Polite or assertive by type | Action and error toasts never auto-dismiss; toasts are not copied to the notification center (section 10.5) |
| `Sidebar` | `nav` "Primary" | Tab; `[` toggle | `aria-current="page"` | Collapsed rail keeps names; tooltips on focus |
| `TopBar` | `header` | Tab | Switchers are menu buttons with the current value in the name | Help in a fixed position |
| `Breadcrumb` | `nav` "Breadcrumb", `ol` | Tab | Last item `aria-current="page"` | Separators `aria-hidden` |
| `PageHeader` | One `h1` | Tab | Actions named; "More actions" menu | Title never truncates |
| `FilterBar` | `role="group"` "Filters" | Tab | Triggers name their current value ("Device: Desktop"); the top-bar scope controls do the same ("Location: United States") | Count badge in the name on narrow widths |
| `FilterChip` | Group of buttons | Tab, Enter, Delete on remove | "Topic: CRM. Edit filter"; "Remove filter Topic" | Focus moves to the next chip after removal |
| `DateRangePicker` | Dialog with inputs and calendar grid | Typed input first; grid arrows | Inputs labelled "Start date", "End date" | Presets as buttons |
| `MetricStrip`, `MetricItem` | `dl` or list of groups with label and value | None (static) except info buttons | Label, value, denominator, delta read in that order with the formatter `label` | Unknown is `n/a` with the accessible name "No data", never 0 |
| `DataTable` | `table role="grid"` (or `treegrid`) with explicit roles | Section 6.3 | Grid named and described; `aria-sort`; `aria-selected`; `aria-rowcount`, `aria-rowindex` | Focused row stays rendered; scroll padding |
| `SimpleTable` | Native `table`, `caption` or `aria-labelledby` | Tab through inner links | `th scope` on headers and row labels | Scrolls inside its region when wide |
| `ColumnChooser` | Popover with checkbox list | Tab, Space, Move up and down buttons | Each checkbox named with the column; "Hidden at this width" as description | Reorder without drag |
| Column resize handle | `role="separator"` (pointer only), menu alternative | Via column options menu | "Resize Keyword column" | Escape cancels a drag |
| `BulkActionBar` | `role="group"` | Tab | "Bulk actions, 12 selected" | Replaces the toolbar in place; no focus loss |
| `RankCell` | Text | n/a | Spoken text from `describeRank` ("rank 4", "not in top 20") | Beyond depth is the text `>20`, never a chip |
| `RankDeltaCell` | Text | n/a | `label` from `formatRankChange` ("improved 5 positions") | Arrow always present for a move; `0` for no change, never a dash |
| `DeltaCell` | Text | n/a | `label` from `formatMetricDelta` | Sign always present |
| `MetricCell` | Text plus mini CI bar | n/a | Value from `formatPercent`, `k of n` from `formatSampleCount`, interval from `formatInterval` (no single formatter `label` exists for rates); CI bar `aria-hidden` | Insufficient state as text |
| `URLCell` | Link plus copy and external buttons | Widget mode | "Copy ranking URL", "Open /pricing in a new tab" | Middle truncation with full URL in tooltip |
| `SparklineCell` | `role="img"` | n/a | Summary label (section 9.2) | Canvas not focusable |
| `EngineStatusGlyph` | `role="img"` | n/a | "ChatGPT: cited", "Gemini: mentioned, not cited", "AI Mode: not mentioned" | Three different shapes (filled circle, ring, small dot), so the state is not color alone; legend in the filter bar |
| `EnginePresenceSquare` | `role="img"` | n/a | "Gemini: present", "Gemini: absent" | Present squares are `primary` (5.2:1). Absent squares are `border` (about 1.2:1): a slot placeholder in fixed engine order, not the carrier of the state; the name and tooltip carry it |
| `BarList` | List | n/a | Each item reads label, value and measure ("fieldnote.io: 17.3% share of voice") | Competitor bars in `chart-bar-neutral` (1.4:1) are acceptable only because each value is printed as text; the own bar is `chart-1` |
| `SERPFeatureList` | List | n/a | Each icon named, owned state in text | Icons not distinguished by fill alone in forced colors (text carries it) |
| `StatusBadge`, `EngineBadge`, `Badge` | Text in a styled element | n/a | The word is the meaning | Transparent border for forced colors |
| `EChart` wrapper | `figure` with `figcaption`, canvas `role="img"` | Controls only | Title, summary, ECharts `aria.label.description` | Table view, Patterns toggle, HTML legend, `forced-color-adjust: none` with comment |
| `ChartLegend` | Buttons with `aria-pressed` | Tab, Space | Series name | Last visible series cannot be hidden |
| `EvidenceViewer` | Article with headings and lists; `mark` for mentions | Tab through citation markers and toggles | `mark` labelled "Acme mention, word boundary match, confidence 0.95"; `lang` on the answer | View mode control is a radio group |
| `CitationList` | Ordered list | Tab | Markers `[n]` link both ways, named "Citation 2: g2.com" | |
| `PromptCell` | Text | n/a | Full prompt in tooltip and inspector | `lang` when not English |
| `SEOAIMatrix` | Chart wrapper plus quadrant summary table | Controls only | Quadrant counts in text | Threshold slider with numeric input |
| `Progress` | `role="progressbar"` | n/a | `aria-valuenow`, `aria-valuemax`, `aria-valuetext` ("412 of 1,000 keywords checked") | Start and finish announced, not ticks |
| `Spinner` | `role="status"` wrapper with text | n/a | Visible or hidden label ("Loading keywords") | Stops under reduced motion |
| `Skeleton` | `aria-hidden="true"` | n/a | Region `aria-busy` | No pulse under reduced motion |
| `EmptyState`, `ErrorPage` | Heading plus text plus action | Tab | Heading level fits the region | Action names the fix ("Clear filters") |
| `Banner` / inline alert | `role="status"` or `role="alert"` by severity | Tab to actions | Icon plus text | Not dismissed by timer |
| `KeyValueTable` | `SimpleTable` with row headers | n/a | Caption names the group | Container query layout |
| `Kbd` | `kbd` | n/a | Readable text ("Command K") in a visually hidden element beside the key caps, which are `aria-hidden` (an `aria-label` on a generic element is not read reliably) | Hidden when single-key shortcuts are off |
| `CopyButton` | Button | Enter, Space | "Copy {thing}"; "Copied" announced | Check icon swap is not the only confirmation |
| `DesktopOnlyNotice` | Section with heading | Tab | Names the feature | "Copy link" confirms with an announcement |
| Skip link | First `a` in `body` | Enter | "Skip to main content" | Visible on focus |
