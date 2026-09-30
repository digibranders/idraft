# 08. Interaction States

Status: Accepted (design-system v2)
Last updated: 2026-09-29

## 1. State hierarchy

States are subtle but always distinguishable, and never rely on color alone. Base UI exposes state through data attributes (`data-highlighted`, `data-selected`, `data-disabled`, `data-pressed`, `data-open`, `data-checked`, `data-invalid`); components style those attributes, not JavaScript class toggles.

| State | Visual change | Mechanism |
|---|---|---|
| Normal | Base tokens | n/a |
| Hover | Background steps to `surface-hover` (or `primary-hover` for primary buttons). Cursor `pointer` only on links and clickable rows | `:hover`, `data-highlighted` in menus |
| Focus (keyboard) | 2 px `ring` outline with 2 px offset (inset for table cells and menu items). Hover styles are not applied by focus alone | `:focus-visible` |
| Selected | Rows: background `surface-selected`, key text in `primary-text`, checkbox checked. Segmented control items: `primary-subtle` fill, 1 px `primary-border` outline, `primary-text` label at weight 500 ([09-buttons-controls.md](09-buttons-controls.md) section 6). `aria-selected` or `aria-checked` | `data-selected`, `data-checked`, `aria-current` |
| Active (current location) | Navigation: `surface-selected` background, label and icon in `primary-text`, label weight 500 ([11-navigation.md](11-navigation.md) section 2). Tabs: `primary-text` label at weight 500 plus a 2 px `primary` bottom indicator that moves instantly; unselected labels are weight 400 and every tab reserves the width of its weight 500 label, so selection never changes width ([09-buttons-controls.md](09-buttons-controls.md) section 12) | `aria-current="page"`, `data-selected` |
| Pressed | Button background one step darker (`primary-hover` for primary, `surface-selected` for secondary); no scale transform | `:active`, `data-pressed` |
| Disabled | `foreground-disabled` text, `surface-disabled` fill, no hover, `cursor: not-allowed`; still focusable when a tooltip explains why | `data-disabled`, `aria-disabled` |
| Loading | Control keeps its variant colors and width; the leading icon is replaced by a 14 px (`sm`) or 16 px (`md`, `lg`) spinner, and a button without an icon keeps its label in layout at `opacity-0` under a centered spinner, so the accessible name never changes; not clickable ([09-buttons-controls.md](09-buttons-controls.md) section 2.4) | `aria-busy="true"` |
| Error | `negative-solid` 1 px border on the control, icon plus message below | `aria-invalid="true"`, `data-invalid` |
| Read-only | Normal text on `surface-subtle`, no border emphasis, not focusable as an input (value is selectable text) | `readOnly` |

Precedence when states combine: disabled > loading > error > selected > focus > hover. Focus ring is drawn on top of all other states.

## 2. Focus rules

1. Never remove an outline without a replacement. The global `:focus-visible` style applies to everything; components may switch to the inset variant (`focus-ring-inset`) inside dense containers.
2. The focus ring color is `ring` (3:1 against every surface, tested). In Windows High Contrast (forced colors), outlines switch to `CanvasText`.
3. Focus is never obscured by sticky headers, the filter bar or the docked inspector (WCAG 2.4.11): scroll containers set `scroll-padding` equal to their sticky stack height.
4. Opening an overlay moves focus into it; closing returns focus to the trigger (Base UI default behavior, verified in component tests).
5. Table focus is a single roving cell focus ([12-tables.md](12-tables.md) section 9); row hover and row focus look the same.

## 3. Hover-revealed content

- Row actions revealed on hover are also revealed when any cell in the row has focus and are always reachable through the row's "More" menu.
- Tooltips follow WCAG 1.4.13: dismissible with Escape, hoverable (pointer can move onto the tooltip), persistent until pointer or focus leaves.

## 4. Selection model

| Context | Selection |
|---|---|
| Tables | Checkbox column for multi-select; clicking a row opens the inspector (does not select); Shift+click on checkboxes selects a range; "Select all N matching" banner for bulk scope |
| Lists in popovers | Single click toggles (multi-select) or selects and closes (single-select) |
| Charts | Click on a point opens the related record in the inspector; Shift+click adds to comparison where supported |
| Text | Normal browser selection; `::selection` uses `primary-subtle` |

The row that is open in the inspector is marked as "active" (`surface-selected`, key text in `primary-text`, plus a 2 px `primary` inset left edge), distinct from checkbox selection (`surface-selected` and key text in `primary-text` without the edge, checkbox checked) ([12-tables.md](12-tables.md) section 3).

## 5. Feedback timing

| Action | Feedback |
|---|---|
| Button press | Immediate pressed state; optimistic UI where the mutation is reversible |
| Mutations under 400 ms | No spinner |
| Mutations over 400 ms | Button loading state after 400 ms (avoids flicker) |
| Background jobs (runs, imports, exports) | Inline progress component ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4). A toast when complete only for jobs the user started; scheduled runs update the freshness indicator instead ([18-notifications-alerts.md](18-notifications-alerts.md) section 3.3) |
| Switch with immediate effect | The switch position is the confirmation; no toast ([10-forms.md](10-forms.md) section 13.3) |
| Copy to clipboard | Icon swaps to a check for 1.5 s and an `aria-live` "Copied" announcement |
