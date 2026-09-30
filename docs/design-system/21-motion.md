# 21. Motion

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: motion tokens and the reduced-motion override in [`tokens.css`](../../apps/web/src/styles/tokens.css); `ease-standard` and `ease-exit` utilities in [`globals.css`](../../apps/web/src/styles/globals.css); `useReducedMotion()` in `lib/design/motion.ts` (Phase 1)

Motion in this product is feedback, not decoration. The design read in [00-design-principles.md](00-design-principles.md) sets motion at 2 of 10: an analyst working for hours should notice that something changed state, and never notice the animation itself.

## 1. Principles

1. **Motion confirms a state change the user caused.** An overlay opened, a control was pressed, a record was added. If nothing changed state, nothing moves.
2. **Never decorative.** No entrance choreography, no attention-seeking loops, no motion to make a screen feel alive.
3. **200 ms is the ceiling** for any single transition. Enter uses at most 200 ms; exit is faster than enter.
4. **Data values do not move.** Numbers change instantly (no count-up), charts draw instantly (no series entrance or morphing), table rows re-sort instantly. A moving value is a value the analyst cannot read.
5. **Only `opacity` and `transform` animate**, plus color properties on controls. Width, height, top, left, margin and padding never animate; animating layout forces reflow of 10,000-row tables and shifts content.
6. **Reduced motion removes motion, not information.** Everything motion communicates is also communicated by a static state (a visible overlay, a checked box, a "New" badge, a text label).
7. **Continuous animation is limited to three elements**: the spinner, the live indicator and the skeleton pulse, and only while their process runs or the region loads.

## 2. Tokens

Defined in `tokens.css`. Components use tokens, never literal durations or cubic-bezier values.

| Token | Value | Reduced motion | Use |
|---|---|---|---|
| `--duration-instant` | 0 ms | 0 ms | Explicit "no transition" |
| `--duration-fast` | 100 ms | 0 ms | Hover and press color changes, selection feedback, overlay exits for small popups, toast exits |
| `--duration-base` | 150 ms | 0 ms | Popovers, menus, selects, tooltips, toasts; exits of dialogs and drawers |
| `--duration-slow` | 200 ms | 0 ms | Dialogs, drawers, sheets, overlay inspector, sidebar drawer (enter) |
| `--duration-reveal` | 400 ms | 0 ms | Theme change only: the circular reveal from the `ThemeSwitch` (section 5.1) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | n/a | Enter and state changes: fast start, gentle settle |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | n/a | Exit: accelerates away, finishes quickly |

### 2.1 Token usage

| Interaction | Enter | Exit | Easing | Properties |
|---|---|---|---|---|
| Button, link, chip, icon button hover and press | 100 ms | 100 ms | standard | `background-color`, `color`, `border-color` |
| Checkbox, radio, switch state | 100 ms | 100 ms | standard | `background-color`, `border-color`; switch thumb `transform` |
| Disclosure chevron | 100 ms | 100 ms | standard | `transform: rotate()` |
| Tooltip | 150 ms | 100 ms | standard / exit | `opacity` |
| Popover, menu, select, combobox list, date picker | 150 ms | 100 ms | standard / exit | `opacity`, `transform` (4 px) |
| Toast | 150 ms | 100 ms | standard / exit | `opacity`, `transform` (8 px); stack reflow uses `transform` |
| Dialog and alert dialog | 200 ms | 150 ms | standard / exit | Dialog `opacity`, `transform` (8 px); scrim `opacity` |
| Command palette | 150 ms | 100 ms | standard / exit | `opacity`, `transform` (4 px); scrim `opacity` |
| Overlay inspector (tablet, small desktop) | 200 ms | 150 ms | standard / exit | `transform` (full width from the right edge), `opacity` |
| Docked inspector | 200 ms (content only) | 0 ms | standard | Panel content `opacity`; the column itself appears at full width instantly |
| Sidebar navigation drawer | 200 ms | 150 ms | standard / exit | `transform` (full width from the left edge); scrim `opacity` |
| Mobile sheets (filter, inspector, full-screen dialogs, bottom sheets) | 200 ms | 150 ms | standard / exit | `transform` (from the bottom edge), `opacity` |
| Determinate progress bar value | 200 ms | n/a | standard | `transform: scaleX()` |
| New-row highlight | Held 1,300 ms, fades 200 ms | n/a | exit | `background-color` (section 7.2) |
| Row hover, menu item highlight, focus ring, selection background | 0 ms | 0 ms | n/a | Instant |

Why row hover and menu highlight are instant: a pointer crossing 30 rows with a 100 ms fade leaves a visible trail, and keyboard users moving through a menu at repeat rate would see the highlight lag behind focus.

### 2.2 Tailwind defaults

Tailwind's default transition utilities (`transition`, `transition-colors`) read `--default-transition-duration` and `--default-transition-timing-function`, which are not motion tokens. `globals.css` must set them in `@theme inline` so every default transition follows the tokens and the reduced-motion override:

```css
@theme inline {
  --default-transition-duration: var(--duration-fast);
  --default-transition-timing-function: var(--ease-standard);
}
```

Banned utilities: `transition-all` (animates layout properties by accident), `animate-bounce`, `animate-ping`, `animate-pulse` (Tailwind's own; our skeleton has its own keyframes). The theme reset (`--animate-*: initial`) already removes Tailwind's animations; lint also rejects the class names.

## 3. Easing

| Curve | When |
|---|---|
| `--ease-standard` | Anything appearing or changing state in place. Most of the distance happens in the first third, so the UI feels immediate and settles without overshoot |
| `--ease-exit` | Anything leaving. It starts slowly and ends at full speed, so the element is gone quickly |
| `linear` | Only the spinner rotation and the live indicator |
| `ease-in-out` | Only the skeleton pulse |

Spring, bounce, overshoot and elastic curves are not used.

## 4. Overlays with Base UI

Base UI marks popups with `data-starting-style` on the first frame after mount and `data-ending-style` while closing, and waits for running animations (`element.getAnimations()`) before unmounting. CSS transitions are preferred over keyframes because a transition can be reversed midway when the user reopens a closing popup ([research/09-frontend-stack.md](../../research/09-frontend-stack.md)).

Rules for every overlay:
1. The resting (open) style is the normal style. `[data-starting-style]` and `[data-ending-style]` describe the hidden state.
2. Every overlay transition includes `opacity`, so Base UI detects the animation. A transition that would only use `transform` also animates opacity to `0.9999`.
3. Exit sets a shorter duration and `--ease-exit` on `[data-ending-style]`.
4. Popups translate from the side they open on, using `data-side`. Translation distance is 4 px for popups, 8 px for dialogs and toasts.
5. Transform origin for anchored popups is `var(--transform-origin)` from the Positioner.

### 4.1 Popover, menu, select, combobox list

```css
.popup {
  transform-origin: var(--transform-origin);
  transition-property: opacity, transform;
  transition-duration: var(--duration-base);
  transition-timing-function: var(--ease-standard);
}
.popup[data-starting-style],
.popup[data-ending-style] {
  opacity: 0;
}
.popup[data-side="bottom"][data-starting-style] { transform: translateY(-4px); }
.popup[data-side="top"][data-starting-style]    { transform: translateY(4px); }
.popup[data-side="right"][data-starting-style]  { transform: translateX(-4px); }
.popup[data-side="left"][data-starting-style]   { transform: translateX(4px); }
.popup[data-ending-style] {
  transition-duration: var(--duration-fast);
  transition-timing-function: var(--ease-exit);
}
```

The same in Tailwind classes on `Popover.Popup`, `Menu.Popup` and `Select.Popup`:

```tsx
className={cn(
  "origin-(--transform-origin) transition-[opacity,transform] duration-(--duration-base) ease-standard",
  "data-starting-style:opacity-0 data-ending-style:opacity-0",
  "data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=top]:data-starting-style:translate-y-1",
  "data-[side=right]:data-starting-style:-translate-x-1 data-[side=left]:data-starting-style:translate-x-1",
  "data-ending-style:duration-(--duration-fast) data-ending-style:ease-exit",
)}
```

The exit fades in place; it does not translate back, so a closing popup never appears to move toward something.

Submenus open with the same transition. Moving between items inside an open menu has no transition. `data-instant` (set by Base UI when a popup opens instantly, for example a tooltip switching between adjacent triggers) sets `transition-duration: 0ms`.

### 4.2 Tooltip

```css
.tooltip {
  transition: opacity var(--duration-base) var(--ease-standard);
}
.tooltip[data-starting-style],
.tooltip[data-ending-style] { opacity: 0; }
.tooltip[data-ending-style] {
  transition-duration: var(--duration-fast);
  transition-timing-function: var(--ease-exit);
}
.tooltip[data-instant] { transition-duration: 0ms; }
```

Opacity only. The 400 ms open delay ([07-icons.md](07-icons.md)) is a delay, not an animation, and stays under reduced motion.

### 4.3 Dialog and scrim

```css
.dialog-backdrop {
  background: var(--scrim);
  transition: opacity var(--duration-slow) var(--ease-standard);
}
.dialog-backdrop[data-starting-style],
.dialog-backdrop[data-ending-style] { opacity: 0; }
.dialog-backdrop[data-ending-style] {
  transition-duration: var(--duration-base);
  transition-timing-function: var(--ease-exit);
}

.dialog-popup {
  transition-property: opacity, transform;
  transition-duration: var(--duration-slow);
  transition-timing-function: var(--ease-standard);
}
.dialog-popup[data-starting-style] { opacity: 0; transform: translateY(8px); }
.dialog-popup[data-ending-style] {
  opacity: 0;
  transition-duration: var(--duration-base);
  transition-timing-function: var(--ease-exit);
}
```

Dialogs never scale. Alert dialogs use the same transition. The command palette uses the popup timings (150 ms enter, 100 ms exit, 4 px) because it is opened and closed many times per hour.

### 4.4 Edge-attached panels: overlay inspector, navigation drawer, sheets

Panels attached to a viewport edge travel their full width from that edge, because the motion shows where the panel lives and where it goes when dismissed. This is the only case where an element moves more than 8 px.

```css
.edge-panel {
  transition-property: transform, opacity;
  transition-duration: var(--duration-slow);
  transition-timing-function: var(--ease-standard);
}
.edge-panel[data-ending-style] {
  transition-duration: var(--duration-base);
  transition-timing-function: var(--ease-exit);
}
.edge-panel--right[data-starting-style],
.edge-panel--right[data-ending-style]  { transform: translateX(100%); opacity: 0.9999; }
.edge-panel--left[data-starting-style],
.edge-panel--left[data-ending-style]   { transform: translateX(-100%); opacity: 0.9999; }
.edge-panel--bottom[data-starting-style],
.edge-panel--bottom[data-ending-style] { transform: translateY(100%); opacity: 0.9999; }
```

Base UI Drawer swipe gestures move the panel with the finger (direct manipulation, not animation); on release it settles with the same 150 ms exit or 200 ms return.

### 4.5 Docked inspector

Docking changes the width of the main column. Animating that width would re-layout the table on every frame and shift every column, so:
1. The docked inspector appears at its full width instantly; the table narrows instantly and keeps its scroll position.
2. The inspector's content fades in: `opacity` 0 to 1 over `--duration-slow`.
3. Closing is instant.
4. Switching the record shown in an open inspector (next and previous record, clicking another row) swaps content instantly, with no fade, because users step through records quickly.
5. Resizing follows the pointer or the keyboard step with no easing.

### 4.6 Toast

```css
.toast {
  transition-property: opacity, transform;
  transition-duration: var(--duration-base);
  transition-timing-function: var(--ease-standard);
  transform: translateY(var(--toast-offset-y, 0px));
}
.toast[data-starting-style] { opacity: 0; transform: translateY(8px); }
.toast[data-ending-style] {
  opacity: 0;
  transition-duration: var(--duration-fast);
  transition-timing-function: var(--ease-exit);
}
```

When a toast leaves, the remaining toasts take their new positions. The toasts are laid out in normal flow, so they move at once; an animated restack is not built (it would need Base UI's absolutely positioned stack, which the three-row list does not use). Toasts never slide in from off-screen.

## 5. Controls

| Control | Motion |
|---|---|
| Buttons | Background and color 100 ms. Pressed state changes the background one step ([08-interaction-states.md](08-interaction-states.md)); no scale or shadow change |
| Links | Underline appears instantly on hover and focus |
| Checkbox, radio | Fill and border 100 ms; the check glyph appears instantly |
| Switch | Thumb `transform: translateX()` 100 ms, track color 100 ms |
| Disclosure and accordion | Chevron rotates 90 degrees in 100 ms. The panel opens and closes instantly; heights are never animated, because content below would slide and the reader loses their place |
| Tabs | The 2 px indicator moves to the new tab instantly; no sliding indicator |
| Segmented control, `CountTabs` | The selected item's fill, outline and label color change in 100 ms; no sliding thumb |
| Sidebar collapse (208 to 56 px) | Instant. It is a layout change of the whole page |
| Copy button | Icon swaps to a check instantly and back after 1.5 s ([08-interaction-states.md](08-interaction-states.md)); no transition |
| Focus ring | Never animated |
| Theme switch | No transition (`disableTransitionOnChange`, [01-foundations.md](01-foundations.md)) |
| Drag feedback (column header) | The dragged header follows the pointer with `shadow-drag`; the drop position indicator appears instantly; on drop, columns take their new order instantly |

### 5.1 Theme change reveal
The one decorative transition in the product, kept because a theme change repaints every surface at once and an instant flash of the whole screen is harsher than a directed reveal.

1. `ThemeSwitch` calls `document.startViewTransition()` and applies the new theme class inside its callback.
2. When the transition is ready, `document.documentElement.animate()` grows `clip-path: circle()` on `::view-transition-new(root)` from 0 to the distance to the farthest viewport corner, centred on the switch, over `--duration-reveal` with `--ease-standard`.
3. `globals.css` turns off the default cross-fade (`::view-transition-old(root), ::view-transition-new(root) { animation: none; mix-blend-mode: normal; }`).
4. Changes from the user menu or the command palette reveal from the switch when it is visible, otherwise from the account button, after the menu has closed (`--duration-base`).
5. No View Transitions API, `--duration-reveal` of 0 (reduced motion), or a change that does not flip light and dark (System resolving to the current theme): the class changes at once.

Pattern from Magic UI's Animated Theme Toggler (magicui.design), reimplemented on the motion tokens.

## 6. Charts

1. **ECharts animation is off.** The chart wrapper sets `animation: false` in the base option, and features cannot override it in v1. This covers series entrance, update morphing on filter change, and legend toggling. It also subsumes the rule for series with more than 2,000 points ([20-frontend-specification.md](../20-frontend-specification.md) section 4.6), which becomes redundant.
2. **Filter changes swap data instantly.** No cross-fade. During a refetch the previous chart stays at full opacity (no dimming, which would drop label contrast below AA), the static 2 px `RefetchBar` shows under the panel header, and after 400 ms the panel header shows the spinner with "Updating" ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) sections 3.4 and 3.5).
3. **Tooltips jump.** `tooltip.transitionDuration: 0` so the tooltip does not glide between points.
4. **Hover emphasis is instant.** `stateAnimation.duration: 0` for emphasis and blur states.
5. **Resize is instant.** `resize({ animation: { duration: 0 } })` from the `ResizeObserver`.
6. **Brush and data zoom** follow the pointer; releasing applies the range instantly.
7. **Sparklines** (canvas renderer in table cells) draw once, never animate, and redraw only when their data changes.

```ts
const baseOption: EChartsCoreOption = {
  animation: false,
  stateAnimation: { duration: 0 },
  tooltip: { transitionDuration: 0, enterable: true },
};
```

## 7. Tables and data values

### 7.1 No motion on values

- Metric values, deltas, ranks and rates change instantly when data changes. No count-up, no odometer, no flash of the changed cell.
- Sorting re-renders rows in their new order instantly. No FLIP animation.
- Filtering replaces rows instantly; previous rows stay visible until new rows arrive ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)).
- Expanding a grouped row inserts its children instantly.
- Virtualized scrolling is native scrolling; no smooth-scroll smoothing is added.

### 7.2 New-row highlight

Rows added by the user's own action (keywords added manually, an import completing while the user is on the table, an explicit "Refresh" that brings in new rows) are marked once:

1. **Always:** a "New" badge (`type-micro`, `info-subtle`) after the identity text, until the next data load or navigation. This is the durable, accessible signal, and the status announcement names the count ("24 keywords added").
2. **When motion is allowed:** the row background starts at `surface-selected`, holds for 1,300 ms, then transitions to its normal background over `--duration-slow` (200 ms) with `--ease-exit`. Total 1.5 s, once. No repeat on scroll.
3. **Under reduced motion:** no background highlight; the "New" badge alone marks the rows.
4. **Limits:** the highlight applies to at most 50 rows. A larger batch shows only the badges and the status message.
5. Rows that change value during a refresh are never highlighted.

```css
@keyframes row-new {
  0%, 86.7% { background-color: var(--surface-selected); }
  100%      { background-color: transparent; }
}
.row-new {
  animation: row-new 1500ms var(--ease-exit) 1;
}
@media (prefers-reduced-motion: reduce) { .row-new { animation: none; } }
:root[data-motion="reduced"] .row-new { animation: none; }
```

The keyframe holds the color for 86.7% of 1,500 ms (1,300 ms), and the last 200 ms is the only moving part, which keeps the transition itself within the 200 ms ceiling.

## 8. Loading and progress

### 8.1 Skeleton pulse

| Property | Value |
|---|---|
| Keyframes | `opacity` 1 at 0% and 100%, 0.6 at 50% |
| Duration | 1.5 s |
| Easing | `ease-in-out` |
| Iterations | Infinite while loading |
| Color | `surface-subtle` blocks shaped like the final content ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)) |
| Reduced motion | No pulse; static `surface-subtle` blocks at opacity 1 |

```css
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}
.skeleton { animation: skeleton-pulse 1.5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
:root[data-motion="reduced"] .skeleton { animation: none; }
```

All skeletons on a page pulse in phase (same start time), so the page reads as one loading state rather than a wave. No shimmer gradient sweeps.

### 8.2 Spinner

| Property | Value |
|---|---|
| Glyph | `LoaderCircle` ([07-icons.md](07-icons.md)) at 14 px in `sm` controls, tables, toolbars and badges; 16 px in `md` and `lg` buttons. Allowed places: [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.5 |
| Motion | `rotate` 360 degrees, 800 ms, `linear`, infinite |
| When | Only while the process runs. It is removed the moment the process ends; it never idles |
| Label | Always paired with text ("Checking", "Updating", "Running") or an accessible label |
| Delay | Shown after 400 ms for mutations ([08-interaction-states.md](08-interaction-states.md)) and refetches (next to the `RefetchBar`, [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.4), immediately for background jobs the user started |
| Reduced motion | Rotation stops; the static glyph and its text label remain |

```css
@keyframes spin { to { transform: rotate(360deg); } }
.spinner { animation: spin 800ms linear infinite; }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
:root[data-motion="reduced"] .spinner { animation: none; }
```

### 8.3 Progress bars

1. Progress bars are **determinate only**. The fill is a full-width element scaled with `transform: scaleX(value / max)` from the left, transitioning 200 ms `--ease-standard` when the value updates (progress updates arrive at the API's `Retry-After` interval, [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4.3, so the bar steps rather than crawls).
2. Indeterminate progress bars (sliding segments) are not used; an unknown duration uses the spinner with a label. The `RefetchBar` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.4) is a static 2 px bar: it appears and disappears, it never moves.
3. Under reduced motion the fill jumps to the new value.
4. A completed bar stays at 100% with its completion text; it does not flash or change color unless the job failed.

### 8.4 Live indicator

A 6 px status dot next to "Live" on screens showing a run in progress (Ops, run detail). It pulses `opacity` between 1 and 0.4 over 2 s, `linear`, infinite, only while the run is in progress. At most one live indicator per screen. Under reduced motion it is a static dot with the word "Live". The "Pause updates" toggle on those screens also stops the pulse ([20-accessibility.md](20-accessibility.md)).

## 9. Layout stability

Layout shift is forbidden. Cumulative Layout Shift budget is 0.05 at p75 ([20-frontend-specification.md](../20-frontend-specification.md) section 4.11).

1. **Skeletons match final dimensions**: row heights per density, metric strip height, chart panel height, header heights.
2. **Async regions reserve space**: charts have a fixed height before data arrives; images and favicons have fixed 16 x 16 px boxes; badges that load later occupy their slot.
3. **Nothing is inserted above the content the user is reading.** The bulk-action bar replaces the table toolbar in place; the "Select all N matching" control lives inside that bar; the "New results available" notice uses the toolbar slot; banners that appear after load are placed below the page header in a slot that exists from first render or are shown as toasts.
4. **Fonts**: Geist through `next/font` with fallback metric adjustment, so the swap does not move text.
5. **Scrollbars**: scroll containers set `scrollbar-gutter: stable`, so a scrollbar appearing does not shift columns.
6. **Loading buttons keep their width** ([08-interaction-states.md](08-interaction-states.md)).
7. **Tooltips and popovers** are portaled and positioned; they never push content.
8. **Inspector docking** narrows the table, which is a layout change the user requested; it happens once, instantly, and keeps the scroll position.

## 10. Scrolling

1. `scroll-behavior: smooth` is not set globally.
2. Keyboard-driven scrolling (focus moving to a row, cell or field) is always instant (`behavior: 'auto'`), so focus and viewport stay in sync.
3. Smooth scrolling is allowed only for explicit jump actions when motion is allowed: clicking a citation marker to reach its citation, a table of contents link in methodology pages, "Back to top". Browser default smooth duration applies.
4. Under reduced motion every programmatic scroll is instant.
5. TanStack Virtual `scrollToIndex` uses `behavior: 'auto'` always.
6. No scroll-linked effects: no parallax, no scroll-triggered reveals, no headers that animate on scroll. Sticky elements are static.

## 11. Reduced motion

### 11.1 Sources of the preference

| Source | Mechanism |
|---|---|
| Operating system | `@media (prefers-reduced-motion: reduce)` |
| In-app setting | User menu, Appearance, Motion: "System" (default), "Reduce motion". Stored per user by the API; sets `data-motion="reduced"` on `<html>` in the server render (no flash) |

The in-app setting exists because many users cannot or do not change the OS setting, and because it is the "Pause, Stop, Hide" mechanism for the spinner and live indicator (WCAG 2.2.2, [20-accessibility.md](20-accessibility.md)).

### 11.2 CSS

`tokens.css` already sets the duration tokens to 0 under the media query. It must add the same override for the in-app setting:

```css
@media (prefers-reduced-motion: reduce) {
  :root { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; --duration-reveal: 0ms; }
}
:root[data-motion="reduced"] {
  --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; --duration-reveal: 0ms;
}
```

Token-driven transitions become instant. Keyframe animations (skeleton, spinner, live indicator, new-row highlight) have fixed durations and therefore each carries its own `animation: none` rule for both selectors, as shown in sections 7 and 8. With 0 ms transitions Base UI finds no running animation and unmounts immediately.

### 11.3 JavaScript

`useReducedMotion()` in `lib/design/motion.ts` returns true when either source asks for reduced motion. It reads `window.matchMedia('(prefers-reduced-motion: reduce)')`, subscribes to its `change` event, and reads the `data-motion` attribute. Consumers:

| Consumer | Behavior when true |
|---|---|
| Programmatic scrolling (`scrollIntoView`, `scrollTo`, virtualizer) | `behavior: 'auto'` |
| ECharts wrapper | Already static (section 6); the hook is used only to keep `animation: false` if a future option is proposed |
| Toast stack | Positions change instantly |
| Drawer swipe release | Settles instantly |
| New-row highlight | Not applied; "New" badge only |

Components never call `matchMedia` for motion themselves.

### 11.4 What remains under reduced motion

- Overlays still open and close (instantly).
- Hover and pressed color changes (instant).
- Static loading states: skeleton blocks, the spinner glyph with its label, determinate progress values.
- The 400 ms tooltip delay and the 1.5 s copy confirmation (these are timing, not motion).

## 12. Prohibited motion

| Prohibited | Why |
|---|---|
| Page-load or route-change sequences (staggered fade-ins of sections, cards or rows) | Delays reading and draws attention to chrome |
| View Transitions API page transitions | Same; route changes are instant |
| Parallax and scroll-linked effects | Vestibular trigger; no information |
| Bouncing, overshoot, springs, elastic easing | Decorative; reads as playful |
| Count-up or odometer numbers | Values must be readable at all times |
| Chart entrance, morphing between datasets, animated axis changes | Data values do not move |
| Floating or hovering elements (bobbing buttons, drifting shapes) | Decorative |
| Continuous animation other than the spinner, the live indicator and the skeleton pulse (pulsing badges, glowing borders, animated gradients, shimmer sweeps, animated icons) | Constant motion in peripheral vision during long sessions |
| Scale on press, hover lift, or shadow growth on hover | Hierarchy is not shown with shadows ([06-surfaces-borders-radius.md](06-surfaces-borders-radius.md)) |
| Height and width animations (accordions, sidebar collapse, inspector docking) | Layout thrash and content shift |
| Animated focus rings | Focus must be immediate |
| Sliding tab and segmented-control indicators | Decorative |
| Autoplaying media and animated illustrations | No illustrations exist ([00-design-principles.md](00-design-principles.md)) |
| Flashing or blinking of any kind, including cells that flash on value change | WCAG 2.3.1 risk and no information |

## 13. Enforcement and testing

1. **Lint:** stylelint and the Tailwind lint rules reject literal `transition-duration`, `animation-duration` and `cubic-bezier()` values outside `tokens.css` and the four keyframes defined in `globals.css`; reject `transition-all`, `animate-bounce`, `animate-ping` and `animate-pulse`; reject `transition` on `width`, `height`, `top`, `left`, `margin` and `padding`.
2. **Playwright, reduced motion:** with `reducedMotion: 'reduce'` and separately with `data-motion="reduced"`, open each overlay type and assert that the computed `transition-duration` is `0s` and `document.getAnimations()` is empty; load a page and assert no skeleton or spinner has a running animation.
3. **Playwright, default motion:** assert that every overlay reaches its open state within 250 ms of the trigger and is removed within 200 ms of closing.
4. **Visual regression:** screenshots are taken with `animations: 'disabled'`, which also catches any animation missing its reduced-motion rule when compared with the reduced-motion run.
5. **CLS:** Lighthouse CI and RUM budgets ([20-frontend-specification.md](../20-frontend-specification.md) section 4.11).
6. **Review:** any new animation needs a stated state change it confirms, a token duration, and its reduced-motion behavior in the pull request description.

## 14. Required changes to foundation files

| File | Change |
|---|---|
| `tokens.css` | Add the `:root[data-motion="reduced"]` override (section 11.2) |
| `globals.css` | Set `--default-transition-duration` and `--default-transition-timing-function` to tokens (section 2.2); add keyframes `skeleton-pulse`, `spin`, `row-new`, `live-pulse` and matching `--animate-*` theme entries |
| `lib/design/motion.ts` | Add `useReducedMotion()` (section 11.3) |
| [20-frontend-specification.md](../20-frontend-specification.md) section 4.6 item 10 | Replace with "Chart animation is off for all charts (21-motion.md)" |
