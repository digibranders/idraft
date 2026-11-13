# WP-16 detailed task plan: layouts customize UI (catalog, numbers, save bar, team default, presets, undo)

Brief: [docs/ai-visibility/work-packages/WP-16-layouts-react-customize.md](../../ai-visibility/work-packages/WP-16-layouts-react-customize.md).
Branch `ai/wp-16-layouts-customize` in the worktree `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6` (the brief names
`ai/wp-16-layouts-react-customize` in `.claude/worktrees/wp-16`; this session stays where it was given), cut from
`develop` at `6b1595c0` (WP-15 merged). Kind: web. Rows: 24 (WB-LAY-25 to 48). Contract C12a is on develop and in
`schema.ts`: no backend change, no `pnpm gen:api`. Owner requirement R-07: the same full customization as the
approved preview (`apps/web/design-preview/customize.js`, `index.html`).

Spec: [layout customization design](../specs/2026-09-30-layout-customization-design.md) sections 3, 5.1 to 5.7, 7, 8,
9.3, 11, 13, 16 and the WP-15 "As built" note at the end of section 10. Inventory: `docs/ai-visibility/inventory/web.md`
rows WB-LAY-25 to 48; `overview-and-charts.md` 9.3 to 9.7.

## 1. Scope

### 1.1 Goal

Everything a person needs to customize a screen, as generic parts in `apps/web/src/features/layouts/` that the page
packages compose: the card catalog dialog, the number strip in both modes and the number catalog, the Customize
button and badge, the layout save bar (change count, scope line, differs line, Undo, Redo, Start from, Reset, Cancel,
Save with the team default menu), the discard, confirm and conflict dialogs, the leave guard, Escape and narrow
window rules, placeholders, the per card error boundary with Retry, the Hide toast with Undo, Duplicate, presets,
the drawer one column mode and table page numbers, all seen on the live specimen and proven by one e2e spec.

### 1.2 What WP-15 already gives (read before every task, do not rebuild)

| Exists | Where | Notes for WP-16 |
|---|---|---|
| `useLayoutScreen()`: `status`, `mode`, `document`, `baseline`, `defaultDocument` (never null), `changes`, `dirty`, `canUndo`, `canRedo`, `saving`, `canCustomize`, `canManage`, `resolved` (`source`, `teamDefaultExists`, `teamDocument`, `updatedBy`, `updatedAt`), `shownCards`, `availabilityOf`, `retry` | `layout-provider.tsx` | Controls disable on `saving`. `canCustomize` is false after a failed read |
| Actions: `enter`, `exit`, `addCard`, `hideCard`, `moveCard`, `setCardWidth`, `setCardOption`, `addNumber`, `removeNumber`, `moveNumber`, `replaceDraft(document, message)`, `undo`, `redo`, `save`, `saveAnyway`, `loadRemote`, `saveTeamDefault`, `removeTeamDefault`, `focused` | same | Every action reads live state (a ref), so a kept callback works. After a 412 never call `save()`: `saveAnyway()` (personal), `saveTeamDefault()` again (team), `loadRemote()` or discard |
| `SaveOutcome`: `saved`, `unchanged`, `conflict`, `failed` | same | One write in flight; a second call gets the first one's outcome |
| History of 50 drafts, cleared on `exit` | `layout-state.ts` (`HISTORY_LIMIT`) | D-06 needs no reducer change |
| `LayoutGrid` slots: `onAddCard(index)`, `renderUnavailable(item, reason)`, `CardBoundary`, `emptyAction`, `columns="one"` | `layout-grid.tsx` | Read failure banner with Retry is built (WB-LAY-39: confirm only) |
| `CardTools` (Width, Options, Hide, More with Move items) | `card-toolbar.tsx` | Duplicate and the Hide toast are added here |
| Announcer (`layouts.core.announce.*`, `say`) | `announcements.ts` | Number edits announce nothing yet |
| dnd helpers: `useLayoutSensors`, `SILENT_ANNOUNCEMENTS`, `dropAnimationFor`, `noShift` | `dnd.ts`, `index.ts` | The number strip reuses them |
| Reduced motion jump, `scrollIntoView` honouring it | `layout-grid.tsx`, `sortable-grid.tsx` | WB-LAY-45: confirm and extend to the strip |
| Mock C12a with ETag and 412 (cookie `mock-layouts`) | `mocks/handlers/layouts.ts` (mine, WP-15) | Gains a fault cookie in T13 |
| Live specimen on the mock | `live-specimen.tsx`, route `app/(internal)/design-system/layouts-live/page.tsx` (both mine, WP-15) | WP-16 adds `customize-specimen.tsx` under the same route |

Known WP-15 limits designed around: `React.lazy` caches a failed load (T8 adds `reset` to the registry); number edits
announce nothing (T0); `optionsTip` and `moveTip` unused (T8 uses `moveTip` on More; `optionsTip` goes to the Options
trigger tooltip in T8); a key within a few ms of the pick up announcement is ignored (e2e waits for the
announcement before the next key).

### 1.3 Files

| Folder or file | Status | Tasks |
|---|---|---|
| `apps/web/src/lib/layouts/catalog.ts`, `draft.ts` (edit: `numberName`, `isNewCardType`, `duplicateCard`) | mine (WP-15 files, same session) | T0 |
| `features/layouts/` root: `layout-provider.tsx`, `layout-state.ts`, `announcements.ts`, `registry.tsx`, `card-toolbar.tsx`, `layout-grid.tsx`, `index.ts` (edit) | mine | T0, T1, T8 |
| `features/layouts/customize/` (new): `customize-controller.tsx`, `customizable-screen.tsx`, `customize-button.tsx`, `customizing-badge.tsx`, `use-leave-guard-layout.ts`, `use-undo-keys.ts` | mine (new folder, the brief's list plus this one, which holds the mode wiring) | T1, T7 |
| `features/layouts/catalog/` (new): `card-catalog-dialog.tsx`, `catalog-entries.ts`, `card-schematic.tsx` | owned by the brief | T2 |
| `features/layouts/numbers/` (new): `number-strip.tsx`, `number-cell.tsx`, `number-catalog.tsx`, `number-dnd.ts`, `number-strip-specimen-values.ts` | owned | T3, T4 |
| `features/layouts/save-bar/` (new): `layout-save-bar.tsx`, `team-default-menu.tsx`, `conflict-dialog.tsx` | owned | T5, T6 |
| `features/layouts/presets/` (new): `presets.ts`, `start-from-menu.tsx` | owned | T9 |
| `features/layouts/cards/` (new): `card-boundary.tsx`, `unavailable-card.tsx` | mine (new folder) | T8 |
| `features/layouts/drawer/` (new): `drawer-customizer.tsx` | mine (new folder) | T10 |
| `features/layouts/customize-specimen.tsx` (new) and `app/(internal)/design-system/layouts-live/page.tsx` (edit, one line) | mine | T1 onward |
| `apps/web/src/mocks/handlers/layouts.ts` and `layouts.test.ts` (edit: fault cookie) | mine (WP-15) | T13 |
| `apps/web/messages/en.json`, namespace `layouts.customize` (exists, empty) | mine | every task |
| `apps/web/e2e/flows/ai-layouts.spec.ts`, `apps/web/e2e/support/layouts.ts` (new) | owned | T12, T13 |
| Spec note: `docs/superpowers/specs/2026-09-30-layout-customization-design.md` | WP-16 As built | T14 |

Not touched: `components/ui/*`, `components/app/*` (imported only), `lib/navigation/*` (imported only),
`mocks/handlers/index.ts`, `e2e/support.ts`, every other feature folder (section 7 lists the leases),
`backend/*`, `schema.ts`, `v1.json`, tracker files, `design-preview/*`.

## 2. Parity with the approved preview

Source: `design-preview/customize.js` (C) and `index.html` (H) with `interactions.js` (I). The preview is the owner's
truth for what is seen; the spec is the truth for data rules.

### 2.1 Parity table

| # | Preview behaviour (where) | Built in | Rows |
|---|---|---|---|
| P1 | Customize toggle, `secondary`, `SlidersHorizontal`, `aria-pressed`, pressed look `border-primary-border bg-primary-subtle text-primary-text`, shown from 768 px (`hidden md:flex`) (H338, C1131) | T1 `CustomizeButton` | WB-LAY-29 |
| P2 | "Customizing" badge after the title, `h-badge bg-primary-subtle text-primary-text type-micro`, hidden in view (H334, C1133) | T1 `CustomizingBadge` | WB-LAY-30 |
| P3 | Enter: draft from the saved document, announce "Customizing {screen}. Drag cards ...", focus to the first handle when started from a closed menu (C1141 to 1154) | provider `enter` (built) plus T1 focus rule | WB-LAY-29 |
| P4 | Only one screen customizing at a time; entering another while dirty asks first (C1278) | T1 `CustomizeController` registry | WB-LAY-34 |
| P5 | Exit returns focus to the control that started it, only when focus was in the mode's controls or lost (C1158 to 1176) | T1 | WB-LAY-35 |
| P6 | Escape leaves the mode unless a popup or a dialog is open or a card is held; asks when dirty (C1308 to 1313) | T1 (`useShortcut` dismiss; the held card's Escape is `defaultPrevented` by WP-15) | WB-LAY-35 |
| P7 | Discard dialog "Discard unsaved changes?", "Your layout changes will be lost.", Keep editing (focus) and Discard changes; Keep editing puts focus on the first handle (C448, C1187, I754) | T1 (Cancel, Escape, switch screen), T7 (links, Back, Forward, guarded push, unload) | WB-LAY-34 |
| P8 | Leaving by link, Back, Forward or drawer close asks first; without changes the mode ends quietly on navigation (C1317 to 1322) | T7; drawer close via `requestExit(then)` in T10 | WB-LAY-34 |
| P9 | Window narrowed below 768 px leaves the mode only when clean (C1326 to 1331) | T1 | WB-LAY-36 |
| P10 | Catalog and confirm close with the mode and do nothing (C418, C1170) | T1 (they render only while `mode === 'customize'` and the controller owns their open state) | WB-LAY-36 |
| P11 | Card catalog dialog 720 px: title "Add card", sentence "Each card follows the page's date range, location and filters.", search field (focused), groups SEO, AI, Cross-channel, Activity in that order, empty groups left out (H1163, C349 to 430) | T2 | WB-LAY-25 |
| P12 | Entry: icon tile (schematic) 40 px, title, "New" badge when added in the last 30 days, description, reason line in `text-warning-text` when unavailable (C357 to 370) | T2 | WB-LAY-25 |
| P13 | Entry button states: Add, Add another, Added (disabled), Unavailable (disabled), Page is full (disabled); `aria-label` "Add {card}" (C371 to 391) | T2 | WB-LAY-25 |
| P14 | Search on title and description, "No cards match “{query}”" (C396 to 416) | T2 | WB-LAY-25 |
| P15 | Hidden (no permission) types never listed (C406) | T2 (`availabilityOf` state `hidden`) | WB-LAY-25 |
| P16 | Adding closes the dialog without restoring focus, adds at the clicked slot index, scrolls into view, focuses the card (C386 to 390, C810 to 818) | T2 (provider `addCard` gives the focus request; grid scrolls) | WB-LAY-25 |
| P17 | Numbers in view: label (with engine logo), value, delta, context line; a link; channel divider where SEO and AI meet; strip hidden with 0 numbers (C653 to 724) | T3 (MetricStrip groups split at every channel change; links need lease L1) | WB-LAY-26 |
| P18 | Numbers in customize: a control row above each number: handle "Reorder {number}", Remove (`X`, tip "Remove"), More "Move {number}" with the four moves; not a link; labelled group "{number} number" (C678 to 701, C966) | T3 | WB-LAY-27 |
| P19 | Number keyboard pick up, arrows, Space, Escape, focus out drops, the same words as cards (C898 to 952) | T3 (dnd-kit KeyboardSensor, `number-dnd.ts`) | WB-LAY-27 |
| P20 | Remove moves focus to the next number, else the previous, else Add number; announces "{number} removed" (C1020 to 1026) | T0 (focus request with zone) and T3 | WB-LAY-27 |
| P21 | "Add number" slot after the last number while under 6, `aria-haspopup="dialog"` (C710 to 717) | T4 | WB-LAY-28 |
| P22 | Number catalog popover 320 px "Add a headline number", "{left} of 6 places left.", SEO chips, then "AI, one engine each" with one row per metric and engine chips with logos; shown ones disabled; adding closes, announces, focuses the new number (C1087 to 1126) | T4 | WB-LAY-28 |
| P23 | Save bar pinned to the bottom, hidden in view: count ("No changes", "1 change", "{n} changes"), scope line (`hidden lg:block`), Reset to default (ghost, disabled when the draft is the default), Cancel (secondary), Save layout (primary, disabled at 0) with a chevron menu "More save options" (H551 to 562, C728 to 741) | T5 | WB-LAY-31 |
| P24 | Differs line: "Your layout differs from the team default. It applies to your view, in every project" when the saved layout is personal and a team default exists (C736) | T5 | WB-LAY-32 |
| P25 | Save: a draft equal to the default stores nothing; exit; "Layout saved" said; no toast (C1200 to 1206) | provider (built) plus T5 | WB-LAY-31 |
| P26 | Reset replaces the draft with the default, says "Layout reset to the default. Save to keep it" (C1255) | T5 (`replaceDraft`) | WB-LAY-31 |
| P27 | Team menu (owners and admins): Save as team default (`Users` icon), Remove team default (`Undo2` icon, only when one exists) (H1157, C1294 to 1305) | T6 | WB-LAY-33 |
| P28 | Confirm "Set this as the default for everyone in {workspace}?", body, "Set team default"; then toast "Team default set", "{screen} now opens with this layout for {workspace}."; the admin's personal layout goes (C1210 to 1226) | T6 | WB-LAY-33 |
| P29 | Confirm "Remove the team default?", "People in {workspace} who have not customized this page go back to the built-in layout."; dirty: keep the draft, rebase, toast "Team default removed" with "Your unsaved changes are still here."; clean: exit and toast (C1228 to 1250) | T6 (provider rebases, built) | WB-LAY-33 |
| P30 | Confirm focus returns to the menu trigger, since the item closed with its menu (C323 to 326) | T6 (`finalFocus`) | WB-LAY-33 |
| P31 | Hide announces "{card} hidden. Add it back from the catalog", focus to the neighbour (C802 to 808) | built (WP-15); T8 adds the toast with Undo (D-06) | D-06 |
| P32 | Add card slot, empty sentence, focus targets | built (WP-15) | WB-LAY-24 (built) |
| P33 | Unavailable cards kept in customize mode, skipped in view (C624 to 631) | built; T8 adds the richer placeholder | WB-LAY-37 |
| P34 | Phones: no Customize, saved layout full width | T1 (button `hidden md:inline-flex`) and grid (built); T12 proves | WB-LAY-44 |
| P35 | Reduced motion: scroll `auto`, no animation (C816) | built; T3 strip; T12 proves | WB-LAY-45 |

### 2.2 Built here but not in the preview (spec, rows or owner decisions)

| Behaviour | Source | Task |
|---|---|---|
| Save failure line "Could not save. Try again.", draft kept | spec 8, WB-LAY-40 | T5 |
| 412 dialog "This layout was changed somewhere else." with Keep mine and Load the other version | spec 8, WB-LAY-41 | T6 |
| Read failure banner, Customize disabled with a reason | spec 8, WB-LAY-39 | built; T1 disables the button |
| Per card error boundary with Retry | spec 8, WB-LAY-38 | T8 |
| Undo and Redo (save bar buttons, Ctrl or Cmd Z, Shift Ctrl or Cmd Z), Hide toast with Undo | D-06, inventory 9.6 | T1 keys, T5 buttons, T8 toast |
| Duplicate in the card More menu with the next free identity value | D-15, inventory 9.6 | T0, T8 |
| Start from menu (presets) | D-01, WB-LAY-46, inventory 9.5 and 9.6 | T9 |
| Drawer one column mode with "Customize cards", table page "Customize numbers" | spec 5.1, 5.5, WB-LAY-42, 43 | T10 (generic parts and specimen; page wiring is leased) |
| Audit entries visible | WB-LAY-48 | none on the web (section 8) |

### 2.3 Where the preview and the spec or rows disagree

| Point | Preview | Spec or row | Decision |
|---|---|---|---|
| Customize button from 768 to 1023 px | Button in the header from 768 px (`hidden md:flex`); the More menu has only Export | Spec 5.1 and WB-LAY-29: in the More menu below 1024 px | Preview wins (visible behaviour): the button shows from 768 px. `useCustomizeMenuItem()` exists anyway for table pages and drawers (where the spec puts the entry in More). Reported to the coordinator for the owner |
| Save bar | A bespoke bar with the `SaveBar` look | Spec 5.6: "reuses `SaveBar`" | `components/ui/save-bar.tsx` is a form bar (submit button, focus to the first field, Discard without asking); its shape cannot hold Reset, Cancel, the split Save, Undo, Redo and Start from. `LayoutSaveBar` copies its container classes (`sticky bottom-0 z-(--z-sticky) min-h-save-bar border-t border-border bg-surface`) and its `role="group"` naming. Spec departure recorded in T14 |
| Split Save button | Only the left half is disabled at 0 changes; the chevron stays usable | `SplitButton.disabled` disables both halves | Preview wins: the save bar composes `Button` plus `Menu` with the `SplitButton` classes, so an admin can set the current layout as the team default with no changes |
| 412 dialog shape | none | DS 25 3.34 `ConflictDialog`: 720 px, versions side by side; the component does not exist in `components/app/shell` | A layout has no readable "version" to show; `LayoutConflictDialog` is the 400 px alert shape with who saved the other version and when ("Saved by Ana Brandt, 3 minutes ago", from `resolved.updatedBy` and `updatedAt` after the 412 refetch). Initial focus on "Load the other version" (DS 3.34: focus on Reload). Recorded in T14 |
| Catalog groups for `ai_overview` | SEO, AI, Cross-channel, Activity | Inventory 9.6 proposes AI, Topics, Competitors, Sources, Activity (Proposed, not a row) | Rows win: the four `CardGroup` values. The finer grouping needs a catalog field; left to WP-33 with the owner |
| Drawer customize | Spec 15 says the preview had it; the current `index.html` has no drawer zone | Spec 5.5 | Spec wins; the specimen shows it on `inspector.keyword` at 400 px |
| "Undo: hide Top cited domains" tooltips | none | Inventory 9.6 (Proposed) | Not built: the tooltip says "Undo" with the shortcut; every undo is announced (WP-15). Follow-up F1 |
| Number links in view mode | Numbers are links | MetricStrip has no `href` | Needs lease L1 on `metric-strip.tsx`; until granted the view strip has no links and `NumberValue.href` is ignored |

## 3. Design

### 3.1 Composition (what a page writes)

```tsx
<CustomizableScreen screen="overview" workspaceId={w} workspaceName={name} capabilities={caps} registry={CARDS} presets={PRESETS}>
  <PageHeader title={t('title')} titleAddon={<CustomizingBadge />} actions={<CustomizeButton />} />
  <NumberStrip label={t('numbers')} valueOf={valueOf} status={status} />
  <CustomizableGrid label={t('cards')} />
</CustomizableScreen>
```

`CustomizableScreen` = `LayoutProvider` > `CustomizeController` > `<div data-customize-root onKeyDown={undoKeys}>` with
the children, then `LayoutSaveBar` (unless `saveBar="none"`, the drawer). `CustomizableGrid` = `LayoutGrid` with
`onAddCard` (opens the catalog), `renderUnavailable` (`UnavailableCard`), `CardBoundary` (`CardBoundary`) and
`emptyAction` (`CustomizeButton`). PageHeader has no `titleAddon` today: the page passes the badge inside its title
area (WP-33's markup) or asks for lease L6; nothing in WP-16 depends on it.

### 3.2 `CustomizeController` (T1)

Context `useCustomize()`, inside `LayoutProvider`:

| Member | Behaviour |
|---|---|
| `enter(returnFocus?: HTMLElement \| null)` | Ends another screen's clean mode first; asks when that one is dirty (module level `active` registry of controllers, as C451). Calls `actions.enter()`. Stores the return target (default: the registered Customize button) |
| `requestExit(then?: () => void)` | Clean: `actions.exit()`, focus return, `then()`. Dirty: opens the discard dialog; Discard runs exit then `then`; Keep editing focuses the first handle (card, else number, else Add slot) |
| `registerEntry(node)` | Ref callback for `CustomizeButton` (focus return target) |
| `openCatalog(index)` / catalog state | Owned here so it closes with the mode |
| `confirm` state (team set or remove), `conflict` state (`'personal' \| 'team' \| null`), `saveError` (boolean) | Owned here, read by the save bar and dialogs |
| `hideWithUndo(id)` | T8: `actions.hideCard`, toast with Undo, the toast is dismissed on the next edit or on exit |

Rules: the discard, confirm and conflict dialogs and the catalog render only while `mode === 'customize'`, so a
narrowed window or an exit closes them (P10). Escape: `useShortcut('Escape', ..., { kind: 'dismiss', enabled:
mode === 'customize' })`; the handler returns when `event.defaultPrevented` (a held card, WP-15). Narrow window:
`useMediaQuery(MEDIUM_MEDIA)` false and `!dirty` exits (effect on the change, not on mount). Focus return on exit
happens only when `document.activeElement` is `body`, inside the screen root, the save bar or a closing dialog.

### 3.3 Messages (`layouts.customize`, camelCase, curly quotes, no dashes, no "n't")

Each task adds its block; Haiku may draft, the implementer checks against the house rules (`pnpm lint` runs the
message rules). Words are taken from the preview where it has them.

| Block | Keys (value) |
|---|---|
| `mode` (T1) | `customize` "Customize", `customizeCards` "Customize cards", `customizeNumbers` "Customize numbers", `badge` "Customizing", `notLoaded` "Available once your layout has loaded", `discardTitle` "Discard unsaved changes?", `discardBody` "Your layout changes will be lost.", `keepEditing` "Keep editing", `discard` "Discard changes" |
| `catalog` (T2) | `title` "Add card", `description` "Each card follows the page’s date range, location and filters.", `search` "Search cards", `close` "Close", `groups.seo` "SEO", `groups.ai` "AI", `groups.cross` "Cross-channel", `groups.activity` "Activity", `add` "Add", `addAnother` "Add another", `added` "Added", `unavailable` "Unavailable", `pageFull` "Page is full", `addLabel` "Add {card}", `addAnotherLabel` "Add another {card}", `isNew` "New", `noMatch` "No cards match “{query}”" |
| `numbers` (T3, T4) | `strip` "{screen} numbers", `group` "{number} number", `reorder` "Reorder {number}", `remove` "Remove {number}", `removeTip` "Remove", `move` "Move {number}", `add` "Add number", `catalogTitle` "Add a headline number", `placesLeft` "{left, number} of {limit, number} places left.", `full` "{limit, number} numbers is the most a strip shows.", `seo` "SEO", `ai` "AI, one engine each", `engineChoice` "{number} {engine}", `shown` "Already shown" |
| `announce` (T0, T5, T8, T9) | `numberAdded` "{number} added", `numberRemoved` "{number} removed", `numberMoved` "{number}, position {position, number} of {total, number}", `reset` "Layout reset to the default. Save to keep it.", `preset` "{preset} applied. Save to keep it.", `duplicated` "{card} duplicated, position {position, number} of {total, number}", `teamSet` "Team default set", `teamRemoved` "Team default removed" |
| `saveBar` (T5) | `label` "Layout changes", `changes` "{count, plural, =0 {No changes} one {# change} other {# changes}}", `scope` "Applies to your view, in every project", `differs` "Your layout differs from the team default. It applies to your view, in every project", `undo` "Undo", `redo` "Redo", `reset` "Reset to default", `cancel` "Cancel", `save` "Save layout", `moreSave` "More save options", `failed` "Could not save. Try again." |
| `team` (T6) | `save` "Save as team default", `remove` "Remove team default", `setTitle` "Set this as the default for everyone in {workspace}?", `setBody` "People who have customized this page keep their own layout. Everyone else sees this one.", `setConfirm` "Set team default", `removeTitle` "Remove the team default?", `removeBody` "People in {workspace} who have not customized this page go back to the built-in layout.", `removeConfirm` "Remove team default", `cancel` "Cancel", `setToast` "Team default set", `setToastBody` "{screen} now opens with this layout for {workspace}.", `removedToast` "Team default removed", `removedKeptBody` "Your unsaved changes are still here.", `failedToast` "The team default could not be saved. Try again." |
| `conflict` (T6) | `title` "This layout was changed somewhere else.", `body` "Keep mine saves your layout over the other version. Load the other version drops your changes.", `savedBy` "Saved by {name}, {when}", `keepMine` "Keep mine", `loadOther` "Load the other version" |
| `card` (T8) | `hiddenToast` "{card} hidden", `undo` "Undo", `duplicate` "Duplicate", `duplicateNone` "Every choice is already on this page", `failed` "This card could not be shown.", `retry` "Retry", `placeholderNote` "This card shows in projects that have what it needs." |
| `presets` (T9) | `startFrom` "Start from", `builtin` "Built-in default", `team` "Team default" |

### 3.4 Checks used by every task

- TARGET: `infra/dev/heavy --lane medium --label wp16-tN-test -- bash -c 'cd apps/web && pnpm exec vitest run <paths> --maxWorkers=2'`
- LINT, TYPES, FORMAT: the same lane with `pnpm lint`, `pnpm typecheck`, `pnpm format:check` (from `apps/web`)
- BROWSER: the dev server of this worktree with `NEXT_PUBLIC_API_MOCKING=all` (reuse one already running, per the
  dev server policy), page `/design-system/layouts-live`, the task's specimen group, at 390, 768, 1024 and 1280 px,
  light and dark, Default and Compact density (Preferences, `lib/preferences`). Look for overflow, wrapped
  controls, contrast, focus rings, the keyboard path.
- Never plain `pnpm test`, `pnpm build` or `pnpm e2e` before T12; those go through the heavy lane.
- Every implementer: a fresh Sonnet subagent, tests first, file tools only (no heredocs, `sed` or scripts), one at
  a time. After each task a fresh Sonnet reviewer returns PASS or a numbered fix list.
- Commit per task `WP-16: <title>` naming only this package's files.

House rules for every file: Tailwind v4 tokens and type utilities only; `@/lib/format` for numbers and dates;
words from `messages/en.json` (`i18next/no-literal-string` covers `src/features/**`, the specimen keeps a `COPY`
table as WP-15 did); a feature may not import `components/design-system`; no em-dash or en-dash anywhere; jsdom has
no layout, `inert` or `scrollIntoView` (stub rects; Tab order and inert in the e2e).

## 4. Tasks

### T0: pure and provider additions for numbers, Duplicate and catalog dates

Files: `lib/layouts/catalog.ts`, `lib/layouts/draft.ts`, `lib/layouts/layouts.test.ts`;
`features/layouts/layout-state.ts`, `layout-provider.tsx`, `announcements.ts` and their tests;
`messages/en.json` (`layouts.customize.announce`).

Tests first:
- `layouts.test.ts`: `numberName names an SEO number by its label`, `numberName adds the engine label to an AI number`,
  `isNewCardType is true for 29 days after addedOn and false on day 30`, `duplicateCard inserts after the source with
  the next free identity value`, `duplicateCard copies width and other options`, `duplicateCard refuses a single
  use type, a full page and a type with no free identity value`.
- `layout-state.test.ts`: `a focus request keeps its zone`.
- `layout-provider.test.tsx`: `addNumber announces the number and asks focus for its handle in the numbers zone`,
  `removeNumber announces and asks focus for the next number, else the previous, else the Add number slot`,
  `moveNumber announces the new position`, `duplicateCard adds the copy after the source, announces it and focuses
  its handle`, `duplicateCard returns null when duplicateCard refuses`.

Implementation:
- `catalog.ts`: `numberName(item: NumberItem): string` (label, plus `engineLabel` for per engine metrics, the preview's
  `numberLabel`); `isNewCardType(type: CardTypeDefinition, today: string): boolean` (ISO business dates, 30 days,
  `NEW_FOR_DAYS = 30` exported).
- `draft.ts`: `duplicateCard(doc, id, newId): LayoutDocument` (same identity when `canPlace`; for a reusable type the
  first identity value no instance uses, else the doc itself; inserted at `index + 1`).
- `layout-state.ts`: `FocusRequest` gains `zone?: 'cards' | 'numbers'` (absent means cards; `CardPart` unchanged; the
  numbers zone uses `part: 'handle' | 'more'` and `id: null` for the Add number slot). `layout-grid.tsx`
  `useFocusRequests` ignores `zone === 'numbers'`.
- `layout-provider.tsx`: `addNumber`, `removeNumber`, `moveNumber` send focus requests with `zone: 'numbers'` and say
  `numberAdded`, `numberRemoved`, `numberMoved` through new announcer functions; new action `duplicateCard(id): string
  | null` (focus to the copy's handle, `duplicated`). `LayoutActions` doc comments updated.
- `announcements.ts`: `numberAdded(number)`, `numberRemoved(number)`, `numberMoved(place)`, `duplicated(place)` read
  `layouts.customize.announce`.

A11y: announcements only (polite region, key `layouts`). Rows: enablers for WB-LAY-27, 28 and D-15. Browser: none
(no UI). Commit `WP-16: number announcements, duplicate and catalog dates in the layout core`.

### T1: customize controller, CustomizableScreen, Customize button, badge, Escape, narrow window, undo keys, specimen

Files (new): `customize/customize-controller.tsx`, `customize/customizable-screen.tsx`, `customize/customize-button.tsx`,
`customize/customizing-badge.tsx`, `customize/use-undo-keys.ts`, tests beside each;
`customize-specimen.tsx` and `customize-specimen.test.tsx`; edits: `index.ts`,
`app/(internal)/design-system/layouts-live/page.tsx` (renders `<LayoutsCustomizeLive />` after `<LayoutsLive />`),
`en.json` (`mode`).

Tests first:
- `customize-controller.test.tsx`: `enter starts customize mode and remembers the return target`, `requestExit with
  no changes exits and returns focus to the Customize button`, `requestExit with changes opens the discard dialog`,
  `Keep editing keeps the draft and focuses the first handle`, `Discard exits and runs then`, `Escape leaves when
  clean`, `Escape asks when dirty`, `Escape does nothing when the event was default prevented (a held card)`,
  `Escape does nothing while a menu or dialog is open`, `a window narrowed below 768 px leaves a clean mode`,
  `a window narrowed below 768 px keeps a dirty mode and its save bar`, `entering a second screen ends a clean first
  one`, `entering a second screen while the first is dirty asks first`, `focus is not moved on exit when it is
  outside the screen`.
- `customize-button.test.tsx`: `is a toggle with aria-pressed`, `is disabled with the not loaded reason after a failed
  read`, `is disabled while saving`, `is hidden below 768 px` (class `hidden md:inline-flex`), `a second press asks
  to leave`.
- `customizing-badge.test.tsx`: `renders text Customizing only in customize mode`.
- `use-undo-keys.test.ts`: `Ctrl Z and Meta Z undo`, `Shift Ctrl Z and Shift Meta Z redo`, `keys in a text field,
  combobox or open popup do nothing`, `nothing happens in view mode or while saving`.
- `customize-specimen.test.tsx`: `renders the customize group with the Customize button` (smoke, MSW).

Implementation:
- `CustomizeController({ workspaceName, children })` per section 3.2; renders `DiscardChangesDialog`
  (`components/ui/alert-dialog`) with `mode` words. Exposes `useCustomize(): CustomizeContextValue` (throws outside).
- `CustomizableScreen(props: LayoutProviderProps & { workspaceName: string; presets?: readonly LayoutPreset[];
  saveBar?: 'end' | 'none' })`: the composition of 3.1 (the save bar slot is filled in T5; until then nothing).
- `CustomizeButton({ label?: 'customize' | 'customizeCards' | 'customizeNumbers' })`: `Button` `variant="secondary"`
  `icon={SlidersHorizontal}` `aria-pressed={mode === 'customize'}` with the preview's pressed classes through
  `aria-pressed:` variants, `className="hidden md:inline-flex"`, disabled when `!canCustomize || saving` with a
  `Tooltip` giving `notLoaded`; press: `enter(ref)` or `requestExit()`.
- `useCustomizeMenuItem(label): MenuItemDef | null`: the same toggle as a menu item for More menus (null below 768 px,
  via `useMediaQuery(MEDIUM_MEDIA)`); `enter` takes the More trigger as return target from the caller.
- `CustomizingBadge`: `Badge` (`components/ui/badge`) in the primary subtle look, text "Customizing", rendered only in
  customize mode.
- `useUndoKeys()`: returns an `onKeyDown` for the screen root; ignores typing targets (the `typingIn` rule of
  `use-shortcut.ts`, copied as a local helper, not imported if it is not exported) and open popups; calls
  `actions.undo` and `actions.redo`; `preventDefault` only when it acted.
- Specimen: `customize-specimen.tsx` (`LayoutsCustomizeLive`), a `Group` "Customize mode, live" with the real
  `CustomizableScreen` on the signed in person's first workspace (as `LiveLayout` reads it), a project select of
  that workspace (capabilities from `useLayoutCapabilities`), a header with title, badge and `CustomizeButton`, and
  `CustomizableGrid`. Later tasks add parts to this one screen. Words in a `COPY` table.

A11y: toggle state by `aria-pressed`, badge is text, focus return (P5), Escape (P6), discard focus on Keep editing.
Rows: WB-LAY-29, 30, 35, 36; WB-LAY-34 for Cancel, Escape and screen switch; WB-LAY-39 (confirm: button disabled).
Browser: the group at four widths; button hidden at 390. Commit `WP-16: customize controller, button and badge`.

### T2: card catalog dialog

Files (new): `catalog/card-catalog-dialog.tsx`, `catalog/catalog-entries.ts`, `catalog/card-schematic.tsx` and tests;
edit `customize/customizable-screen.tsx` (`CustomizableGrid` passes `onAddCard` to `openCatalog`), `index.ts`,
`en.json` (`catalog`).

Tests first:
- `catalog-entries.test.ts` (pure): `lists only active types of the screen`, `leaves out hidden types`,
  `groups in the order SEO, AI, Cross-channel, Activity and drops empty groups`, `search matches title and
  description, case blind, trimmed`, `state is add, addAnother, added, unavailable with reason, or pageFull`,
  `isNew follows isNewCardType with today`.
- `card-catalog-dialog.test.tsx`: `opens with focus in the search field`, `Escape and Close return focus to the
  opener`, `Add adds at the slot index, closes without restoring focus and the new card's handle gets focus`,
  `Added, Unavailable and Page is full buttons are disabled`, `the reason line shows for an unavailable type`,
  `the New badge shows for a type added within 30 days`, `No cards match shows the query in curly quotes`,
  `each Add button is named Add {card}`, `axe finds no violation in the open dialog`.

Implementation:
- `catalogEntries({ screen, document, availabilityOf, query, today }): CatalogGroup[]` with `CatalogEntry { type,
  state: 'add' | 'addAnother' | 'added' | 'unavailable' | 'pageFull', reason?: string, isNew: boolean }`.
  `availabilityOf` takes a `CardItem`; call it with `{ id: '', type: type.key }` (the provider's function only reads
  the type).
- `CardCatalogDialog({ open, index, onOpenChange })`: `Dialog size="lg"` (720 px), `DialogHeader` (title,
  description, close label), a search `Input` (`initialFocus`), `DialogBody` with one `section` per group (`h3`
  `type-label`) and one row per entry (preview classes: 40 px tile `bg-neutral-subtle`, `type-body-strong` title,
  `type-meta` description, `text-warning-text` reason, `Button size="sm" variant="secondary"`). Add calls
  `actions.addCard(type, index)`, then closes with `finalFocus` off (the provider's focus request wins).
- `CardSchematic({ typeKey })`: a decorative lucide icon in the tile from a key map (the preview's `CARD_ICON`:
  `ChartLine`, `ChartBar`, `ChartColumn`, `Grid2x2`, `LayoutGrid`, `Activity`, `List`, `Route`, default `Table2`).
  `shortcut: a key map, card packages add their keys with their catalog entries` as a one line comment.
- Today's date: `new Date()` formatted to an ISO business date with the house date helper of `@/lib/format` (or
  `toISOString().slice(0, 10)` if none exists); passed in, so tests fix it.

A11y: modal, focus trap and return by `Dialog`; the search field labelled; disabled buttons keep their text; the
tile `aria-hidden`. Rows: WB-LAY-25. Browser: open the catalog at 390 (full screen dialog), 768, 1024, 1280; search;
add; dark contrast of the warning line and the New badge. Commit `WP-16: card catalog dialog`.

### T3: NumberStrip in view and customize mode

Files (new): `numbers/number-strip.tsx`, `numbers/number-cell.tsx`, `numbers/number-dnd.ts` and tests; edits
`index.ts`, `customize-specimen.tsx` (strip with fixture values from `numbers/specimen-values.ts`, the preview's
`NUMBER_DATA` reduced to the overview numbers, kept out of production paths), `en.json` (`numbers`).

Tests first:
- `number-strip.test.tsx`: `view mode renders MetricStrip with one group per run of the same channel`, `zero numbers
  renders nothing in view mode`, `zero numbers in customize mode renders only the Add number slot` (slot from T4,
  stubbed until then by a `renderAddSlot` prop), `customize mode renders a labelled group per number with Reorder,
  Remove and Move`, `values are not links in customize mode`, `Remove removes and focus goes to the next number`,
  `the Move menu disables what is not possible and moves`, `controls are disabled while saving`, `loading keeps the
  labels` (MetricStrip status).
- `number-dnd.test.ts`: `the keyboard getter goes to the previous and next cell centre`, `Home and End go to the
  ends`, `the announcements use the number names`.

Implementation:
- `NumberValue = Omit<MetricStripItem, 'id' | 'label'> & { href?: string }`.
- `NumberStrip({ label, valueOf: (item: NumberItem) => NumberValue, status: MetricStripProps['status'],
  renderAddSlot? })`: view mode maps `document.numbers` to `MetricStrip size="md"` groups, a new group at every channel
  change (`numberType(metric).channel`), item label `numberName(item)` with the engine logo in `labelAddon`
  (`components/app/engine/engine-logo`). Customize mode renders its own `dl` grid in the MetricStrip `md` cell
  classes (copy the classes; columns as the preview: 2, then 3 at `@xl`, then up to 6 at `@5xl`) inside a
  `DndContext` (`useLayoutSensors(numberCoordinateGetter)`, `accessibility.announcements` from
  `useNumberAnnouncements`, `SILENT_ANNOUNCEMENTS` for the screen reader instructions as WP-15,
  `dropAnimationFor(reducedMotion)`), `SortableContext` with `horizontalListSortingStrategy`.
- `NumberCell`: control row `-mx-2 -mt-1 mb-1 flex items-center` with `DragHandle` (reused from `drag-handle.tsx`,
  label `reorder`), Remove `IconButton` (`X`, tip `removeTip`) `ml-auto`, More `Menu` with `MOVE_COMMANDS` and
  `moveTargetIndex` (as `CardTools`); `data-part="handle" | "more"`, `data-layout-number={id}`; the channel divider
  classes as MetricStrip draws them. Focus requests with `zone: 'numbers'` are handled here (as the grid does for
  cards, then `actions.focused()`).
- `number-dnd.ts`: `numberCoordinateGetter` (Left, Up: previous cell; Right, Down: next; Home, End), and
  `useNumberAnnouncements()` built on the core `pickedUp`, `dropped`, `putBack`, `first`, `last` strings and
  `numberMoved`.

A11y: each number's controls are a labelled group; handle described by `layouts.core.reorderHelp`; the strip is a
labelled region; 32 px controls, 44 px on coarse pointers (`pointer-coarse:size-control-touch`). Rows: WB-LAY-26,
27 (and WB-LAY-45 for the strip). Browser: strip at four widths in both modes, keyboard reorder, the divider in any
order, dark. Commit `WP-16: number strip in view and customize mode`.

### T4: Add number slot and number catalog

Files (new): `numbers/number-catalog.tsx` and test; edit `number-strip.tsx` (default `renderAddSlot`), `en.json`.

Tests first: `the slot shows under 6 numbers and is gone at 6`, `the popover lists the screen's SEO numbers then AI
metrics with one chip per engine in ENGINES`, `google_ai_overview is never offered`, `a number already shown is
disabled and described Already shown`, `choosing adds at the end, closes the popover without restoring focus, and
focus goes to the new number`, `the places left line counts what is left`, `axe on the open popover`.

Implementation: `AddNumberSlot` (button `aria-haspopup="dialog"`, preview classes `min-h-19 ... text-primary-text`)
as the `Popover` trigger (`components/ui/popover`, width `min` or the 320 px option it has); content: title,
`placesLeft`, `SEO` chips (`canAddNumber(draft, metric)`), `AI, one engine each` rows (`type.label` then
`ENGINES.map` chips with `EngineLogo`, `aria-label` `engineChoice`). Choose: `actions.addNumber(metric, engine)`.
Only `NUMBER_TYPES` whose `screens` include the screen. At 6 the slot is not rendered (the `full` line is the
catalog's when opened by a race at 6).

A11y: popover `role="dialog"` named by its title; chips are buttons; disabled chips keep their name plus the
description. Rows: WB-LAY-28. Browser: popover at 390 (fits, no overflow), 768, 1280, dark logos (ChatGPT inverts).
Commit `WP-16: number catalog`.

### T5: layout save bar

Files (new): `save-bar/layout-save-bar.tsx` and test; edit `customize/customizable-screen.tsx` (renders
`<LayoutSaveBar />` when `saveBar === 'end'`), `customize/customize-controller.tsx` (`saveError`), `en.json`
(`saveBar`, `announce.reset`).

Tests first: `hidden in view mode`, `shows No changes, 1 change, 3 changes`, `scope line, and the differs line when
the saved layout is personal and a team default exists`, `Save is disabled at 0 changes`, `Save saves, leaves the
mode and shows no toast`, `a failed save shows Could not save. Try again. as an alert and keeps the draft and the
mode`, `the failure line clears on the next edit`, `Reset is disabled when the draft equals the default and
replaces the draft and announces otherwise`, `Cancel asks when dirty and leaves when clean`, `Undo and Redo follow
canUndo and canRedo`, `every control is disabled while saving and Save shows its loading state`, `a conflict outcome
opens the conflict state` (state only; the dialog is T6), `the group is named by the change count`.

Implementation: `LayoutSaveBar({ variant?: 'page' | 'drawer' })`. Container classes as section 2.3 (page:
`px-3 md:px-4 lg:px-5 py-2 flex flex-wrap items-center gap-x-3 gap-y-2`; drawer: no sticky, `px-4`, for
`InspectorFooter`). Left: count (`type-body-strong`), Undo and Redo `IconButton`s (`Undo2`, `Redo2`, tooltips with
`Kbd` shortcut), scope or differs line (`hidden lg:block type-meta truncate`). Right: Start from slot (T9), Reset
(ghost), Cancel (secondary, `requestExit()`), Save (primary; members: a `Button`; `canManage`: `Button` with
`rounded-r-none` plus the team menu of T6 in the `SplitButton` classes). Save: `const outcome = await
actions.save()`; `failed` sets `saveError`; `conflict` sets `conflict = 'personal'`. The failure line is a
`FormAlert` (`components/ui/form-alert`) or `role="alert"` `type-meta text-negative-text` line above the actions.
`saving` disables every control and gives Save `loading`.

A11y: the bar is a group named by the count; the failure is an alert; focus stays on Save after a failure; after a
successful save focus goes to the Customize button (controller exit rule). Rows: WB-LAY-31, 32, 40; D-06 buttons.
Browser: the bar at 768 (wraps on two lines, nothing clipped), 1024 (scope shows), 1280, dark; a failure via the
mock fault cookie once T13 lands (until then by an MSW override in the unit test only). Commit `WP-16: layout save bar`.

### T6: team default menu, confirmations, conflict dialog

Files (new): `save-bar/team-default-menu.tsx`, `save-bar/conflict-dialog.tsx` and tests; edit `layout-save-bar.tsx`,
`customize-controller.tsx`, `en.json` (`team`, `conflict`).

Tests first:
- `team-default-menu.test.tsx`: `not rendered without layouts:manage`, `Remove is listed only when a team default
  exists`, `the chevron stays usable at 0 changes`, `Save as team default asks, then saves, exits and toasts Team
  default set with the screen and workspace`, `cancelling the confirm saves nothing and returns focus to the chevron`,
  `Remove asks, then removes; clean: exits and toasts`, `Remove when dirty keeps the mode and the draft, rebases and
  toasts with Your unsaved changes are still here.`, `a failed team write keeps the mode and toasts the failure`,
  `a team 412 opens the conflict dialog for the team write`.
- `conflict-dialog.test.tsx`: `opens on a personal 412 with focus on Load the other version`, `names who saved the
  other version and when`, `Keep mine calls saveAnyway, never save`, `Keep mine after a team 412 calls saveTeamDefault
  again`, `Load the other version calls loadRemote and closes`, `Escape closes and keeps the draft` (that is the
  discard path: the person can still Cancel), `buttons are disabled while saving`, `a second 412 on Keep mine keeps
  the dialog open`.

Implementation:
- `TeamDefaultMenu`: `Menu` trigger `IconButton` `ChevronDown` labelled `moreSave` with `-ml-px rounded-l-none
  border-l border-l-primary-hover` (the `SplitButton` look), items `save` (`Users`) and `remove` (`Undo2`, only when
  `resolved.teamDefaultExists`). Each opens `ConfirmDialog` (`tone="neutral"` for set, `destructive` for remove,
  `finalFocus` = the chevron ref) with the words of 3.3. On confirm: the draft is read when the provider writes, so
  nothing is copied here (the provider reads live state); if the mode ended while the dialog was open the dialog is
  gone (section 3.2), so nothing is written (the preview's critical defect cannot recur).
- Outcomes: `saved` then `toast({ type: 'success', ... })` (`setToast`, `setToastBody` with `definition.title` and
  `workspaceName`) or (`removedToast`, plus `removedKeptBody` when the mode stayed); `conflict` sets
  `conflict = 'team'`; `failed` toasts `failedToast` (`type: 'error'`).
- `LayoutConflictDialog`: `ConfirmDialog` cannot take two actions, so `Dialog size="sm"` with `DialogHeader` (title),
  `DialogBody` (`body`, `savedBy` with `formatRelative` or the house relative date of `@/lib/format`; left out when
  `updatedBy` is null), `DialogFooter` primary `loadOther` (`initialFocus`), secondary `keepMine`. Keep mine:
  `conflict === 'team' ? actions.saveTeamDefault() : actions.saveAnyway()`; Load: `actions.loadRemote()`.

A11y: confirm dialogs start on Cancel (ConfirmDialog), focus back to the chevron; the conflict dialog is modal with
its title as name. Rows: WB-LAY-33, 41. Browser: sign in as Tomás (admin) and Priya (editor) on the specimen; the
menu at 768 and 1280; a 412 made with two tabs. Commit `WP-16: team default menu and conflict dialog`.

### T7: leave guard for links, Back, Forward and reloads

Files (new): `customize/use-layout-leave-guard.ts` and test; edit `customize-controller.tsx`.

Tests first: `a click on an app link while dirty opens the discard dialog and does not navigate`, `Keep editing
leaves the address as it was`, `Discard exits and navigates to the link`, `a useGuardedPush navigation asks first`,
`Back while dirty opens the dialog and the address stays`, `Discard after Back goes back`, `clean: a navigation ends
the mode quietly`, `beforeunload is prevented while dirty only`, `the guard is gone after exit`.

Implementation: `useLayoutLeaveGuard(dirty)` wraps `useLeaveGuard(dirty)` (`lib/navigation/use-leave-guard`: links,
guarded push, beforeunload) and adds Back and Forward, which the App Router cannot hold: while dirty it pushes one
history entry for the same URL (`history.pushState(history.state, '', location.href)`); a `popstate` while dirty
re-pushes and opens the dialog with a pending `'back'`; Discard exits, then `history.go(-2)`; leaving the dirty state
by save or cancel calls `history.back()` once to drop the extra entry (only when it is still the top, tracked by a
marker in `history.state`). The controller's discard dialog serves both (`pending` from the guard). Clean
navigation: an effect on `usePathname()` and `useSearchParams()` changes calls `actions.exit()` when clean.
`shortcut: one extra history entry while dirty; replace with the router's own blocker when Next.js has one` as a one
line comment.

A11y: the same dialog and focus rules as T1. Rows: WB-LAY-34 (all ways out but the drawer, which is T10). Browser:
a sidebar link, Back and Forward, reload, at 1280; check the address bar after Keep editing. Commit `WP-16: leave
guard for customize mode`.

### T8: placeholders, card error boundary with Retry, Hide toast with Undo, Duplicate

Files (new): `cards/unavailable-card.tsx`, `cards/card-boundary.tsx` and tests; edits `registry.tsx` (+ test),
`card-toolbar.tsx` (+ test), `customize-controller.tsx` (`hideWithUndo`), `customizable-screen.tsx`
(`CustomizableGrid` passes `renderUnavailable` and `CardBoundary`), `en.json` (`card`).

Tests first:
- `registry.test.tsx`: `reset after a failed load makes the next render load again`, `reset after a good load keeps
  the loaded component`.
- `card-boundary.test.tsx`: `a card that throws shows This card could not be shown. with Retry`, `other cards keep
  rendering`, `Retry resets the registry entry, the query errors and renders the card again`, `a card that fails to
  load its code recovers on Retry` (the `React.lazy` cache).
- `unavailable-card.test.tsx`: `customize mode shows the card name, the reason and the note`, `view mode skips the
  card` (grid, built: assert only).
- `card-toolbar.test.tsx`: `Hide raises a toast named for the card with Undo`, `Undo on the toast brings the card back
  and focus to its handle`, `the toast goes on the next edit and on exit`, `More lists Duplicate for a reusable type`,
  `Duplicate is disabled with Every choice is already on this page when no value is free`, `Duplicate is not listed
  for a single use type`, `More has the Move tooltip and Options the Card options tooltip`.

Implementation:
- `registry.tsx`: `RegisteredCard` gains `reset(): void`. `defineCards` builds each entry with a module level holder:
  `let failed = false; let current = lazy(() => load().catch((error: unknown) => { failed = true; throw error; }))`;
  `Component` is a stable wrapper that renders `current`; `reset` swaps in a fresh `lazy` only when `failed`. Types
  stay `ComponentType<CardProps>`. The grid keeps using `registered.Component`.
- `CardBoundary({ item, children })`: a class error boundary (the house one if `components/app/status` has one;
  else a small class here) inside `QueryErrorResetBoundary`; fallback `InlineError` (`components/app/status/
  inline-error`) with `failed` and a Retry `Button` that calls `registry[item.type]?.reset()`, the query reset, and
  bumps a key.
- `UnavailableCard(item, reason)`: `type-body-strong` name (`cardName`), `type-meta` reason in
  `text-warning-text`, `placeholderNote`; it goes in the frame's `notice` (outside inert, WP-15).
- `CardTools`: Hide calls `useCustomize().hideWithUndo(item.id)`; More gains `duplicate` after a separator (shown when
  `maxInstances > 1`, `disabledReason` when `duplicateCard` would refuse), calling `actions.duplicateCard`; `Tooltip`
  `moveTip` on More and `optionsTip` on the Options trigger (`card-options-popover.tsx`).
- `hideWithUndo(id)`: if `actions.hideCard(id)`: `toastId = toast({ type: 'info', title: hiddenToast, action: {
  label: undo, onAction: actions.undo } })`; the controller remembers the post hide document (the next render's
  `document`) and calls `dismissToast(toastId)` when `document` changes again or the mode ends, so the toast's Undo
  only ever undoes the hide.

A11y: the error fallback names the card; Retry is a button; the toast action is reachable (toast region); Hide
already announces (WP-15). Rows: WB-LAY-37, 38; D-06 toast; D-15. Browser: switch the specimen's project to one with
no AI (or the AI switch) in customize mode; a fixture card that throws (specimen `COPY` card `broken`); Hide and
Undo from the toast at 1280 and 768. Commit `WP-16: placeholders, card retry, hide undo and duplicate`.

### T9: presets and the Start from menu

Files (new): `presets/presets.ts`, `presets/start-from-menu.tsx` and tests; edit `layout-save-bar.tsx` (slot),
`customizable-screen.tsx` (`presets` prop into the controller), `customize-specimen.tsx` (two fixture presets),
`index.ts`, `en.json` (`presets`, `announce.preset`).

Tests first:
- `presets.test.ts`: `definePresets keeps documents that sanitize unchanged for the screen`, `definePresets throws on
  a document that sanitizing would change` (a typo in a page's preset fails its test, not the person), `presetItems
  lists Built-in default, Team default when one exists, then the page's presets in order`.
- `start-from-menu.test.tsx`: `choosing a preset replaces the draft, counts as changes and announces it`, `choosing
  the preset the draft already shows does nothing`, `Undo restores the draft before the preset`, `no confirmation
  is asked`, `disabled while saving`, `hidden when the screen has no presets and no team default` (Built-in default
  alone equals Reset).

Implementation: `LayoutPreset { id: string; label: string; document: LayoutDocument }` (labels come from the page's
messages); `definePresets(screen, presets): readonly LayoutPreset[]` (module level, runs `sanitizeLayout` and throws
`Error('Preset <id> is not a valid <screen> layout')` when `changed`); `presetItems(resolved, screen, presets, labels)` (the labels of the built-in and team entries are the 4th argument, because they come from messages).
`StartFromMenu`: `Menu` with a `secondary` trigger of the default `Button` size (not `sm`, to match Reset and Cancel in the bar) `startFrom` (`LayoutTemplate` icon), radio items are not
used (a preset is an action); `onSelect` `actions.replaceDraft(document, t('announce.preset', { preset: label }))`.
No stored named layouts (D-01; spec section 3 keeps one layout per person per screen).

A11y: a normal menu; the announcement says what was applied and that Save keeps it. Rows: WB-LAY-46. Browser: menu
at 768 and 1280, apply each fixture preset, check rows pack without part empty rows the preset did not intend.
Commit `WP-16: presets and the Start from menu`.

### T10: drawer cards mode and table page numbers (generic parts and specimens)

Files (new): `drawer/drawer-customizer.tsx` and test; edits `customize-specimen.tsx` (a 400 px keyword drawer and a
table page header specimen), `index.ts`, `en.json` (reuses `mode.customizeCards`, `mode.customizeNumbers`).

Tests first: `DrawerCustomizer renders the grid in one column with no width control`, `Customize cards menu item
enters the mode and returns focus to the drawer More button on exit`, `the drawer save bar has the drawer variant`,
`guardClose runs close at once when clean and asks first when dirty`, `Escape in the drawer while dirty asks before
the drawer closes`, `a table page Customize numbers item enters a numbers only screen and the strip shows its
controls`, `a numbers only screen has no grid and no Add card`.

Implementation:
- `DrawerCustomizer({ screen, workspaceId, workspaceName, capabilities, registry, children })`:
  `CustomizableScreen` with `saveBar="none"`; exposes through `useDrawerCustomize()`: `menuItem`
  (`useCustomizeMenuItem('customizeCards')`), `guardClose(close: () => void): () => void` (`requestExit(close)` when
  customizing, else `close`), `saveBar` (`<LayoutSaveBar variant="drawer" />` for `InspectorFooter`), and
  `<CustomizableGrid columns="one" />`. The page passes `guardClose(onClose)` as the Inspector's `onClose` (which
  already serves the Close button, Escape and the scrim) and its `moreButtonRef` as the return target.
- Table pages: no new component; `CustomizableScreen screen="prompts"` with `NumberStrip` and
  `useCustomizeMenuItem('customizeNumbers')` for the page's More menu. The specimen uses the `overview` screen's
  numbers zone only, because `NUMBER_TYPES` lists no number for `prompts` or `citations` yet (section 7 L4).

A11y: the drawer keeps its own focus trap; the save bar is in the footer; focus returns to More. Rows: WB-LAY-42, 43
as generic parts proven on the specimens; the wiring into the real drawers and pages is leases L2 to L4. Browser:
the drawer specimen at 400 px inside 768 and 1280, the table header specimen at 768 and 1280. Commit `WP-16: drawer
cards mode and table page numbers`.

### T11: phones and reduced motion

Files: `customize-specimen.tsx`, tests in `customize-button.test.tsx`, `number-strip.test.tsx`; no new component.

Tests first: `useCustomizeMenuItem is null below 768 px`, `the number strip drop animation is off with reduced motion`,
`the catalog add scrolls with behavior auto under reduced motion` (spy on a stubbed `scrollIntoView`).

Implementation: confirm, and fix where missing: no customize control renders below 768 px (button class, menu item
null, `DrawerCustomizer` menu item null); cards are `col-span-12` below 768 (built); a dirty mode that survives a
narrow window keeps its save bar usable at 390 (wrapping, no overflow); every transition in the new parts carries
`motion-reduce:transition-none` or reads `useMediaQuery('(prefers-reduced-motion: reduce)')`.

Rows: WB-LAY-44, 45. Browser: 390 px in both themes; macOS reduced motion on, drag and add. Commit `WP-16: phones
and reduced motion in customize mode`.

### T12: e2e part 1 (persist, projects, reset, phones, reduced motion, axe)

Files (new): `apps/web/e2e/flows/ai-layouts.spec.ts`, `apps/web/e2e/support/layouts.ts` (helpers: `openCustomize`,
`customizeSpecimen(page)`, `cardOrder(page)`, `expireLayouts(context)` that clears the `mock-layouts` cookie,
`waitForAnnouncement(page, text)` on `#live-region-polite`).

Tests (on `/design-system/layouts-live`, production build, `NEXT_PUBLIC_API_MOCKING=all`, signed in with
`signIn` from `e2e/support.ts`):
1. `a saved layout persists across a reload` (hide a card, add one from the catalog, move a number, save, reload).
2. `a layout follows the person into another project` (project select of the specimen).
3. `Reset to default returns to the default and Save stores no personal layout` (the count reads No changes after
   a reload and Customize; the cookie holds no personal row for the screen).
4. `Cancel with changes asks; Keep editing keeps the address; Discard drops the draft`.
5. `Back with changes asks and the address stays` (T7).
6. `Escape leaves customize mode and focus returns to Customize`.
7. `Undo and Redo by keys and by buttons; Hide toast Undo`.
8. `the catalog: search, No cards match, Add another, Added, New badge`.
9. `numbers: keyboard reorder, Remove, Add number with an engine, 6 is the most`.
10. `no customize control at 390 px and the saved layout shows full width in order`.
11. `reduced motion: a keyboard move and an add scroll without animation` (`page.emulateMedia({ reducedMotion:
    'reduce' })`).
12. `axe finds no serious or critical violation in customize mode with the catalog, the number catalog and the
    save bar open, at 390, 768, 1024 and 1280 px, light and dark, Default and Compact` (`expectAccessible`).
13. `the Tab walk in customize mode passes the toolbars, not the card content, then the save bar`.

Run: `infra/dev/heavy --label wp16-e2e --wait 30 --max 40 -- bash -c 'cd apps/web && pnpm build && pnpm exec
playwright test e2e/flows/ai-layouts.spec.ts'` (the config serves the production test build). Rows: WB-LAY-47 (part),
WB-LAY-44, 45 proven. Commit `WP-16: layouts customize e2e, part 1`.

### T13: mock faults and e2e part 2 (team default, member, 412, unavailable, read and save failure)

Files: `apps/web/src/mocks/handlers/layouts.ts` and `layouts.test.ts` (edit); `ai-layouts.spec.ts`,
`e2e/support/layouts.ts` (edit).

Tests first (mock): `the fault cookie read makes GET answer 500 with a problem`, `the fault cookie save makes PUT and
DELETE answer 500`, `without the cookie nothing changes`, `a malformed cookie is ignored`.

Mock: cookie `mock-layouts-fault` (`read` or `save`), read with the house cookie helpers and a `z.enum`; answers
`problem(request, 'internal_error')` (or the nearest code the problem helper has). A comment states it exists for the
e2e. Test environment only, as the rest of the mock.

e2e tests:
14. `an admin sets the team default; a member who never customized sees it; Remove team default restores the
    built-in` (Tomás, then Mei in a second context).
15. `the admin's own personal layout goes when the team default is set`.
16. `a member has no team menu` (Priya: only Save layout, no chevron).
17. `Your layout differs from the team default shows for a personal layout`.
18. `412: another tab saves; Save opens the dialog; Keep mine wins after a reload` and `Load the other version shows
    the other tab's layout`.
19. `a card unavailable in a project is a placeholder in customize mode and skipped in view` (a seed project with no
    enabled engine if `src/mocks/prompt-fixtures.ts` has one; else the specimen's AI switch, said in the test name).
20. `a read failure shows the default with the banner and Customize disabled; Retry recovers` (fault `read`).
21. `a save failure shows Could not save. Try again. and keeps the draft` (fault `save`).

Run: TARGET for `src/mocks/handlers/layouts.test.ts`, then the heavy e2e command of T12. Rows: WB-LAY-47 (rest),
WB-LAY-33, 39, 40, 41 proven. Commit `WP-16: layouts customize e2e, part 2`.

### T14: As built note, WB-LAY-48 report and final checks

Files: `docs/superpowers/specs/2026-09-30-layout-customization-design.md` (a "> As built (layouts customize, WP-16,
<date>)" paragraph after the WP-15 note at the end of section 10).

The note records: the parts and the composition of section 3.1; the departures of 2.3 (button from 768 px, the
bespoke save bar, the split Save, the 400 px conflict dialog, no step names in Undo tooltips); the history entry
used for Back and Forward; the registry `reset`; the fault cookie; which rows are proven where (unit file, e2e test
number); the leases granted or still open; follow-ups F1 to F4.

Final checks, one at a time through the heavy lane (`--wait 30 --max 40`): LINT, TYPES, FORMAT (medium), then
`pnpm exec vitest run --maxWorkers=3`, `pnpm build`, the e2e spec, and `ai-layouts-core.spec.ts` again (WP-15's
flow must stay green: T0 and T8 touch its files). Then `git fetch origin && git rebase origin/develop`, the targeted
checks again, push `HEAD:develop`, report `merged`.

Report to the coordinator (WB-LAY-48): the backend writes `layout.default.set` and `layout.default.remove` (WP-11 As
built); C12a and `schema.ts` have no audit read route and the web has no audit log page, so nothing is visible yet.
The row belongs with the package that builds the workspace audit log (route plus page, with labels for the two
actions); WP-16 builds no mock for a route that is not in the contract.

## 5. Integration contract for WP-33 (Overview page)

WP-33 imports from `@/features/layouts` only:

| Export | Use |
|---|---|
| `CustomizableScreen` (`screen`, `workspaceId`, `workspaceName`, `capabilities`, `registry`, `presets?`, `saveBar?`) | Wraps the whole screen body, header included (the badge and button read its context) |
| `CustomizeButton`, `CustomizingBadge`, `useCustomizeMenuItem` | In the page header: the button in `actions`, the badge beside the title |
| `NumberStrip` (`label`, `valueOf`, `status`), `NumberValue` | The strip under the header; `valueOf` maps a `NumberItem` to the formatted value from WP-32's reads |
| `CustomizableGrid` (`label`) | The cards zone (catalog, placeholders, boundaries already wired) |
| `definePresets`, `LayoutPreset` | Module level, the five presets of inventory 9.5 for `ai_overview` |
| `defineCards`, `CardProps`, `useLayoutCapabilities`, `useLayoutScreen`, `useCustomize` | As in WP-15 |

WP-33 also adds its card types and numbers (inventory 9.3, 9.4) to `lib/layouts/catalog.ts` and regenerates
`backend/src/idraft/api/layouts/catalog.json` in the same commit (lease L5), and adds schematic keys to
`catalog/card-schematic.tsx` (same lease). It does not render `LayoutSaveBar` itself.

## 6. Order and dependencies

T0, then T1 (everything uses the controller), then T2, T3, T4 (catalogs), T5, T6 (save bar first), T7, T8, T9, T10,
T11, T12, T13, T14. T2 to T4 could swap; none run in parallel (one subagent at a time).

## 7. Lease requests (for the coordinator)

| # | File (owner) | Smallest edit | Why |
|---|---|---|---|
| L1 | `apps/web/src/components/app/metric/metric-strip.tsx` (WP-07 or the components owner) | `MetricStripItem.href?: string`: the label becomes a link with `after:absolute after:inset-0`, the cell gets `hover:bg-surface-hover has-focus-visible:focus-ring-inset` (the preview's number link) | Numbers are links in view mode (P17) |
| L2 | `apps/web/src/features/prompts/prompt-inspector.tsx` (WP-25) | Wrap the Overview tab body in `DrawerCustomizer screen="inspector.prompt"`; add `menuItem` to the header `moreActions`; pass `guardClose(onClose)`, `moreButtonRef`; put `saveBar` in `InspectorFooter` | WB-LAY-42 |
| L3 | `apps/web/src/features/prompts/topic-inspector.tsx` (WP-20) | The same edit for `inspector.topic` | WB-LAY-42 |
| L4 | `apps/web/src/features/prompts/prompts-strip.tsx` (WP-17) and the Citations strip in `apps/web/src/features/citations/` (WP-21) | Render `NumberStrip` inside `CustomizableScreen screen="prompts"` (or `citations`) and add `useCustomizeMenuItem('customizeNumbers')` to the page More menu; plus their numbers in `NUMBER_TYPES` (needs L5) and the doc 16 registry keys first | WB-LAY-43; also answers the inventory's open point on the compact Topics and Prompts header (its numbers become customizable only if WP-17 takes this) |
| L5 | `apps/web/src/lib/layouts/catalog.ts` (this package after WP-15) and the generated `backend/src/idraft/api/layouts/catalog.json` | Page packages add card types, numbers and drawer card lists for their screens, regenerating with `pnpm gen:layout-catalog` in the same commit | The drawers of L2 and L3 have no card types today (`inspector.prompt` and `inspector.topic` builtins are empty) |
| L6 (optional) | `apps/web/src/components/app/shell/page-header.tsx` | `titleAddon?: ReactNode` after the title | A clean slot for `CustomizingBadge`; WP-33 can place it without this |

## 8. Rows

| Row | Task | Proof |
|---|---|---|
| WB-LAY-25 | T2 | unit, e2e 8 |
| WB-LAY-26, 27 | T3 | unit, e2e 9 |
| WB-LAY-28 | T4 | unit, e2e 9 |
| WB-LAY-29, 30 | T1 | unit, e2e 6, 10 |
| WB-LAY-31, 32 | T5 | unit, e2e 3, 17 |
| WB-LAY-33 | T6 | unit, e2e 14 to 16 |
| WB-LAY-34 | T1, T7, T10 | unit, e2e 4, 5 |
| WB-LAY-35, 36 | T1 | unit, e2e 6 |
| WB-LAY-37, 38 | T8 | unit, e2e 19 |
| WB-LAY-39 | built (WP-15), T1 disables Customize | e2e 20 |
| WB-LAY-40 | T5 | unit, e2e 21 |
| WB-LAY-41 | T6 | unit, e2e 18 |
| WB-LAY-42, 43 | T10 (generic and specimen); page wiring by L2 to L4 | unit, specimen |
| WB-LAY-44, 45 | T11 | unit, e2e 10, 11 |
| WB-LAY-46 | T9 | unit |
| WB-LAY-47 | T12, T13 | the spec file, axe test 12 |
| WB-LAY-48 | none (report, T14) | none |

## 9. Risks

| # | Risk | Answer |
|---|---|---|
| R1 | Back and Forward guard by an extra history entry misbehaves with the App Router (double entries, Back skipping a page) | T7 tests the entry bookkeeping; e2e 5; the comment marks it as a shortcut to replace |
| R2 | `useLeaveGuard`'s registry holds one interceptor: a dirty form and a dirty layout on one page would fight | A customizable screen has no form; noted in T14 |
| R3 | The Hide toast's Undo undoing a later edit | The toast is dismissed on the next edit and on exit (T8 test) |
| R4 | A card's lazy load failing forever | `reset` in the registry (T8), tested with a rejecting `load` |
| R5 | dnd-kit KeyboardSensor attaches late; e2e keys lost | `waitForAnnouncement` before the next key (support helper) |
| R6 | Two customizable screens on one page (Overview plus an open drawer) | Module level active controller: one mode at a time (T1 tests) |
| R7 | WB-LAY-42 and 43 cannot be closed in real pages without L2 to L5 | Generic parts and specimens close the WP-16 side; the rows are reported as "parts built, wiring leased" |
| R8 | The fault cookie leaking into a real build | The mock exists only with mocking on (instrumentation and app providers gate it); the handler test asserts nothing changes without the cookie |
| R9 | The 768 to 1023 px header gets crowded on the Overview with the button visible | Preview wins (2.3); `useCustomizeMenuItem` lets WP-33 move it to More if the owner prefers the row's wording |

## 10. Follow-ups

- F1: step names in the Undo and Redo tooltips (inventory 9.6 Proposed): needs a label per history entry.
- F2: the availability reasons and catalog titles into messages when the app is translated (WP-15 F2).
- F3: `google_ai_overview` in `ENGINES` with slice 2 (WP-15 F3): the number catalog and options pick it up.
- F4: the finer catalog groups for `ai_overview` (inventory 9.6 Proposed), with the owner.
