# Shared overlay drawer (the Inspector, one pattern)

Status: decided by the owner on 2026-11-26. This document records the decision and the technical choices that follow
from it. The plan is [2026-11-26-shared-overlay-drawer.md](../plans/2026-11-26-shared-overlay-drawer.md).

Paths are relative to `apps/web/` unless they start with `docs/`. Line numbers are from commit `eba2a5ea`.

## 1. Why

Every right-side detail panel in the app already goes through one component, `Inspector`
(`src/components/app/inspector/inspector.tsx`). It has three modes today: docked (takes layout space and squeezes the
table), overlay and sheet. Docking makes the table reflow each time a row is opened, gives the panel only 400 or
440 px, and needs a rule (main column keeps 720 px) that people cannot predict.

The owner wants one pattern: a non-modal overlay drawer that sits over the table, never resizes it, and can be dragged
wider. Three other sessions (Pages, Issues, Search Console and Monitoring) adopt `Inspector` now, so its name and
props stay as they are.

## 2. Decisions in one table

| Topic | Decision |
|---|---|
| Component | Keep `Inspector`, `InspectorLayout`, `useInspector`, `useInspectorStepping`. Same names, same props. One addition: `InspectorLayout` takes `boxed` for previews |
| Modes | `overlay` from 900 px viewport width, `sheet` below. The docked mode is deleted |
| Overlay | Non-modal `aside`, no scrim, `fixed`, 12 px under the top bar and from the right and bottom edges. The page behind does not reflow and keeps its scroll position. A click outside does nothing |
| Widths | Default 640 px, minimum 480 px, maximum the smaller of 960 px and 60% of the viewport, rounded down to 8 px |
| Saved width | One width per user for the whole app, in `localStorage` under `idraft.pref.<userId>.inspector-width` |
| Resize | The existing handle on the left edge. Drag, double click resets, Left and Right 16 px, Shift 64 px, Home, End, Enter resets |
| Width menu | The Default, Wide, Maximum and Reset width items are deleted. The More button hides when it has no items (the header already does this) |
| Stepping | Previous and Next buttons, J and K as today. New: ArrowUp and ArrowDown step when focus is inside the drawer (section 4.4) |
| Expand | The "Open page" button stays on the keyword drawer and is added to the prompt drawer. Other records have no full page and get no button |
| URL | Unchanged: `?inspect=<type>:<id>&itab=<tab>`, push on open, replace on step and swap, `history.back()` on close when this page pushed |
| Sheet | Below 900 px: the existing Base UI `Sheet`, full width, modal, Back button, no resize |
| Persistence | Browser-local, per user. No server store (section 4.3) |

## 3. Inventory

Condensed from the read-only inventory. Every row uses `Inspector` inside `InspectorLayout`.

| Screen | Host and drawer files (`src/features/`) | Content | Stepping and expand | URL state | Keyboard and focus | Tests |
|---|---|---|---|---|---|---|
| Keywords: keyword | `rankings/rankings-screen.tsx` (useInspector 470, inspector 769 to 826, layout 871), `rankings/keyword-inspector/keyword-inspector.tsx` (205) | One tab (Overview): metric strip, rank history chart, volume, links, tracking, competitors, history. Edit footer. More: Copy, Change depth, Archive | Hand-rolled step with the unsaved-edit guard. Expand to `/seo/keywords/[tkId]` (796) | `inspect=keyword:<id>` | DataTable (`role=grid`): `aria-current` row, focus back to the identity cell on close. Selector `aside[aria-labelledby] h2` at 521 | `rankings.test.tsx`, `keyword-inspector.test.tsx`, `src/test/rankings-harness.tsx`, `e2e/flows/rankings.spec.ts:623`, `e2e/visual/pages.spec.ts:36` |
| Keywords: group | same host, `rankings/grouped/group-inspector.tsx` (68) | Body, no tabs. More: Add keywords, Rename, Delete | None. No full page | `inspect=group:<id>` | Treegrid row. Auto-close of a deleted group replaces the URL | `group-inspector.test.tsx`, `grouped-view.test.tsx`, `group-actions.test.tsx` |
| Topics and Prompts: prompt | `prompts/prompts-screen.tsx` (620, 1299 to 1414), `prompts/prompt-inspector.tsx` (423) | Strip, tabs Latest, History, Competitors, Stats plus registry tabs. More: Archive and registry actions | Hand-rolled step. A full page exists (`/ai/prompts/[promptId]`), `pageHref` is passed but only feeds a Compare link | `inspect=prompt:<id>`, `itab`, entry key `eng` | DataTable. `prompts/add/use-add-form.ts:48` finds the drawer by `aside[aria-labelledby]` | `prompt-inspector.test.tsx`, `prompts.test.tsx`, `add/submit-flow.test.tsx`, e2e `ai-prompt-inspector.spec.ts`, `ai-prompts.spec.ts` |
| Topics and Prompts: answer | same host, `prompts/answer-inspector.tsx` (452) | Answer text, mentions. "Back to prompt" action. No More items | None | `inspect=answer:<id>` | Keeps its prompt row marked | `answer.test.tsx`, e2e `ai-evidence.spec.ts` |
| Topics and Prompts: topic | same host, `prompts/topic-inspector.tsx` (354), `topic-drawer/use-topic-header.tsx` (66) | Tabs Overview, Prompts plus registry tabs. No More items | `useInspectorStepping` over the Topics order | `inspect=topic:<key>`, `itab`, `eng` | Treegrid | `topic-drawer.test.tsx`, `topic-drawer-wiring.test.tsx`, e2e `ai-topics-by-engine.spec.ts` |
| Page control row | `prompts/prompts-controls.tsx` (27 to 31) | Reads `InspectorOverlayContext` and adds a right margin while a drawer overlays | n/a | n/a | n/a | `prompts.test.tsx` |
| Citations: cited page, gap prompt | `citations/board-screen.tsx` (131 to 212, 344), `citations/drawers/page-drawer.tsx` (97), `gap-drawer.tsx` (92). Both pass `hideMoreActions` | Two tabs each, drawer cards and a drawer table | `useInspectorStepping`. No full page | `inspect=cited-page:<id>` or `gap-prompt:<id>`, `itab`. Tab links drop the drawer | `BoardTable` has no `role=grid`, so J and K do nothing from its rows. `useFocusReturn` returns focus to the opener | `board-screen.test.tsx`, `page-drawer.test.tsx`, `gap-drawer.test.tsx`, `e2e/support/ai-citations.ts` |
| Citations: prompt | `prompts/prompt-drawer-host.tsx` (34 to 104), composed in `app/[workspace]/[project]/ai/citations/citations-route.tsx:39` | The prompt drawer without the answer viewer | `inspector.step` over `PromptOrderContext` | `inspect=prompt:<id>` | as above | `prompt-drawer-host.test.tsx` |
| Internal links: page | `internal-links/internal-links-screen.tsx` (139 to 167, 356 to 376), `internal-links/inspector/page-inspector.tsx` (337, not found 396) | Tier, extras, two neighbour lists, flags. Permanent footer: Copy URL, Visit, Open journey. No More items | `useInspectorStepping`, order from the mounted tab. No full page. Keyed by `urlId` (364), so a step remounts it | `inspect=page:<url_id>` | Opened from tables, Journey and Map canvases. The maximised map uses `z-(--z-inspector)` (`map/map-tab.tsx:357`) | `page-inspector.test.tsx`, `internal-links-screen.test.tsx`, `journey-tab*.test.tsx`, `map-tab.test.tsx`, `e2e/flows/internal-links.spec.ts:111` |
| AI Overview: competitor | `ai-overview/competitor-drawer/competitor-drawer-host.tsx` (19 to 74), `competitor-inspector.tsx` (144) | Tabs Overview, Prompts, Sources. No More items | Own step that wraps around. No full page | `inspect=competitor:<id>`, `itab` | Opened from cards. Focus returns to the card through an opener ref | `competitor-drawer.test.tsx` |
| Competitors page | `competitors/competitors-screen.tsx:302` | `InspectorLayout inspector={null}`: no drawer | n/a | n/a | n/a | n/a |
| Operations: run | `operations/runs-screen.tsx` (218 to 341), `operations/run-inspector.tsx` (113) | Body: Summary, By status, AI coverage. `moreActions: []` | Hand-rolled step. No full page route exists | `inspect=run:<id>` | DataTable | `runs.test.tsx`, `ai-run-coverage.test.tsx`, `e2e/support/runs-costs.ts:145` |
| Design-system specimens | `src/components/design-system/inspector-section.tsx:58`, `domains-feeds-section.tsx:490` | A real `Inspector` in a 480 px tall box with `overflow-hidden` | Both step | `inspect=keyword:` or `domain:` | n/a | none of their own |
| Layouts specimen | `layouts/drawer/drawer-customizer.tsx`, `layouts/customize-specimen.tsx` | `CustomizableScreen box="contents"` exists so a docked card stays sticky | n/a | n/a | n/a | `drawer-customizer.test.tsx` |

Facts checked in the code for this spec:

- The header hides the More button when `moreActions` is empty (`inspector-header.tsx:107`).
- The only width store is `src/lib/inspector/width-store.ts`, key `inspector-width:<type>`, no user id, not cleared at
  sign-out.
- `src/lib/preferences/storage.ts` gives `preferenceKey(userId, name)` = `idraft.pref.<userId>.<name>`, and
  `clearPreferences()` removes every `idraft.pref.` key at sign-out (`src/lib/session/sign-out.ts:37`).
- `write()` and `parse()` in `src/lib/preferences/preferences.ts` rebuild the `settings` record from four known
  fields. A width stored inside that record would be erased by the next preference change.
- `useMe()` works only under the `[workspace]` layout. The specimens live under `src/app/(internal)/design-system`
  and many tests render `Inspector` with no session.
- Arrow keys in `DataTable` move grid focus only. Nothing opens a row on arrow keys (`data-table.tsx`, `moveTo`).
- `DataTable` keeps the open row in view vertically (`data-table.tsx:446` to `452`) and returns focus to the row's
  identity cell when the drawer closes and focus fell to `body` (431 to 445).
- The bulk action bar is one `h-12` row with no wrapping (`bulk-action-bar.tsx:150`).
- The shell: sidebar 208 px from 1280, a 56 px rail from 1024 to 1279, a drawer below 1024
  (`src/features/shell/project-shell.tsx:170`). Page padding is 20 px from 1024 (`PAGE_CLASS`, `lg:px-5`).
- jsdom's default `innerWidth` is 1024, so tests that do not stub it stay an `aside` under the new 900 px rule.
- Playwright projects run at 1440 and 390 wide. The only 768 px viewports in e2e (`ai-controls.spec.ts:184`,
  `ai-layouts-core.spec.ts:410`) do not open a drawer.

## 4. Behaviour

### 4.1 Placement and geometry

```
maximum(viewport) = max(480, floor8(min(960, 0.6 x viewport)))     floor8: rounded down to a multiple of 8
mode              = viewport < 900 ? sheet : overlay
width             = fit(saved ?? 640, maximum)                      fit: snap to 8, clamp to 480..maximum
```

The card is `fixed`, `top: var(--size-inspector-top)` (top bar 52 plus 12), `right: 12px`, `bottom: 12px`,
`z-index: var(--z-drawer)` (70). The table area starts at sidebar plus page padding.

| Viewport | Sidebar plus padding | Maximum | Card left edge at 640 | Table strip left visible at 640 | Card left edge at maximum | Table strip at maximum |
|---|---|---|---|---|---|---|
| 900 | 0 + 16 | 536 | 352 (drawn at 536) | 336 | 352 | 336 |
| 1024 | 56 + 20 | 608 | 404 (drawn at 608) | 328 | 404 | 328 |
| 1280 x 720 | 208 + 20 | 768 | 628 | 400 | 500 | 272 |
| 1440 | 208 + 20 | 864 | 788 | 560 | 564 | 336 |
| 1537 | 208 + 20 | 920 | 885 | 657 | 605 | 377 |
| 1920 | 208 + 20 | 960 | 1268 | 1040 | 948 | 720 |

At 1280 x 720 the card is 644 px tall (64 to 708). At the default width the table keeps 400 px of 1052, and with the
sidebar that is about half the screen, which the owner intends.

The narrowest strip anywhere is 272 px, at exactly 1280 with the drawer dragged to its maximum. From 1280 to 1600 the
strip is `0.4 x viewport - 240`, which grows with the viewport. Below 1280 the sidebar is a 56 px rail or gone, and the
strip is 321 px or more.

What "the first column stays visible" means, in pixels: the selection column is 40 px, so at least 232 px of the first
data column show at every allowed width, 360 px at the default width at 1280 and 617 px at 1537. The first column is
pinned to the left edge in `DataTable` (identity column) and in `BoardTable` (`sticky left-0`), so a sideways scroll
does not move it under the card. Type minimums for comparison: keyword 200, prompt 240, URL 160.

Limit, stated on purpose: the table is not reflowed, so its first column keeps the width it had. A long keyword or
prompt is cut where the column ends, not where the card begins, and its tail can sit under the card. The drawer title
shows the full text. No cap beyond the owner's 60% is added, because 232 px is enough to recognise the row.

The open row keeps `aria-current="true"` and the active-row style (`data-active`, `bg-surface-selected`, the edge mark
in the first cell). The highlight is on the left side of the row, which stays in view.

Scrolling the active row clear of the card: not needed and not added. Vertically, `DataTable` already scrolls the open
row into view. Sideways, the pinned first column is always in the visible strip. A cell on the right that takes
keyboard focus under the card stays covered; section 10 states this and the docs are corrected to match.

### 4.2 Resize

The existing `InspectorResizeHandle` stays: `role="separator"`, `aria-orientation="vertical"`, `tabindex="0"`,
`aria-valuenow`, `aria-valuemin="480"`, `aria-valuemax` (the maximum of section 4.1), `aria-valuetext`
("640 pixels"), `aria-controls`.

- Drag: the card follows the pointer in a preview state, and the width is saved once, on release. The negative
  margin that held back the docked reflow is deleted. Nothing behind the card reflows at any point.
- Double click and Enter: back to 640 px (the saved width is removed).
- Left widens and Right narrows by 16 px, 64 px with Shift. Home goes to 480, End to the maximum.
- Widths snap to 8 px.
- The sheet has no handle.

### 4.3 Persistence

No server store fits: `PATCH /api/v1/me` takes `name` and `image` only, and the layouts API holds a closed card
document. A backend change is out of scope. The width is a convenience of one browser.

| Question | Answer |
|---|---|
| Key | `preferenceKey(userId, 'inspector-width')`, which is `idraft.pref.<userId>.inspector-width` |
| Why its own key, not a field of `settings` | `preferences.ts` rewrites `settings` from four known fields, so a field it does not know is lost. A separate key under the same prefix is per user and is cleared at sign-out by `clearPreferences()` with no new code |
| Value | A decimal integer string, for example `720` |
| Validation at read | `Number.isInteger` and 480 to 960. Anything else reads as "none", so the default applies |
| Smaller viewport | The stored value is never rewritten by a read. Placement clamps it to the viewport's maximum each render, so the width comes back on a larger screen |
| Reset | Removes the key |
| Storage blocked or full | The value is kept in memory per user until the page reloads, as today |
| Cross-tab | The store listens to the `storage` event; readers use `useSyncExternalStore` |
| No user id (design-system previews, tests) | Memory only. Nothing is written to `localStorage` |
| Legacy `inspector-width:<type>` keys | Never read. The first write removes all 14 of them |

How the user id reaches `Inspector` without a new prop: a context, `InspectorWidthUserContext` (default `null`), in
`src/lib/inspector/width-store.ts`. `ApplyPreferences` (`src/features/session/apply-preferences.tsx`), which already
reads `useMe()` and provides `SingleKeysContext` for every workspace page, provides it. This is the pattern
`SingleKeysContext` uses.

### 4.4 Keyboard

| Key | Where | What it does |
|---|---|---|
| Escape | Focus inside the drawer, no popup open | Closes. Unchanged, tooltip first, one layer per press |
| J, K | Focus inside the drawer, or in a `role=grid` or `role=treegrid` | Next, previous. Unchanged. Single-key shortcuts: off when the person turned them off |
| ArrowDown, ArrowUp | Focus inside the drawer (new) | Next, previous, when the conditions below hold |
| ArrowLeft, ArrowRight | The focused resize separator only | Resize. They never step |
| Arrow keys | The table grid | Move grid focus, as today. The drawer does not follow |

ArrowDown and ArrowUp step only when all of these hold:

1. `onStep` is passed, and the mode is overlay. The sheet has the Previous and Next buttons and J and K.
2. No modifier is held (Alt, Control, Meta, Shift), the key is not repeating, no input method is composing, and no
   inner control already handled the key (`defaultPrevented`).
3. The event target is inside the `aside` in the DOM. React delivers key events from a menu or dialog that was opened
   from the drawer through the component tree, so the handler checks DOM containment.
4. The target is not inside one of: `input`, `textarea`, `select`, `[contenteditable="true"]`, `[role="textbox"]`,
   `[role="combobox"]`, `[role="listbox"]`, `[role="menu"]`, `[role="menubar"]`, `[role="tablist"]`,
   `[role="radiogroup"]`, `[role="slider"]`, `[role="spinbutton"]`, `[role="separator"]`, `[role="grid"]`,
   `[role="treegrid"]`, `[role="tree"]`, `[aria-haspopup]`.
5. The target is not itself a scroll area: `[role="region"]` or `[role="tabpanel"]`. `InspectorBody` with a `label` is
   a focusable region so a keyboard can scroll it, and it keeps its arrow keys.
6. No list, menu or dialog is open (`[data-open]`), and no combobox is expanded. A tooltip does not block the step:
   the Previous and Next buttons show one while focused.

The handler is a React `onKeyDown` on the `aside`, so inner React handlers run first and rule 2 sees their
`preventDefault`. (The Escape listener is a native one on the `aside` and runs before React's handlers, so it cannot
be reused for this.) The `jsx-a11y` rule against key handlers on a landmark is switched off for that one line with a
reason, the way `data-table.tsx:1249` does. It calls `event.preventDefault()` and `onStep('next' | 'previous')`. Every screen that passes
`onStep` gets it with no change of its own. The hand-rolled stepping in Rankings, Runs, Prompts and the prompt host is
not refactored.

Cost, stated on purpose: with focus on the title, a button or a link, ArrowUp and ArrowDown used to scroll the drawer
body and now step. PageUp, PageDown, Space, Home and End still scroll, and the body region keeps its arrows when it
has focus.

WCAG 2.1.4 and the single-key preference (docs/design-system/20-accessibility.md section 14): 2.1.4 covers shortcuts
made of letter, punctuation, number or symbol characters. Arrow keys are not character keys, and this shortcut is
active only while the drawer has focus, which is the criterion's own exception. So the arrows do not follow the
"Single-key shortcuts" preference and are not registered through `useShortcut`. A person who turned J and K off keeps
a keyboard way to step.

Arrow keys from the grid: grid focus movement is unchanged. Having the drawer follow the grid's focused row would need
new code in `DataTable` (nothing opens a row on arrow keys today), and it would fetch a record on every row passed. It
is not done. Enter or a click on another row swaps the drawer.

### 4.5 Focus

- Opening moves focus to the title (`h2`, `tabindex="-1"`). Unchanged, and only on the first mount.
- A swap (another row clicked, or a step) keeps the same `aside` mounted where the screen keys it by project, so
  nothing closes and reopens and focus stays where it is. There is no enter or exit animation, so a swap cannot
  flicker. A swap to another kind of record (prompt to topic, prompt to answer, cited page to prompt) renders a
  different drawer component in the same slot, so the `aside` remounts and its title takes focus; the URL never loses
  `inspect` in between.
- New: when a step was made from inside the drawer and focus is on `body` once the new record's header renders (the
  focused control belonged to the old record), the drawer moves focus to its title. Without this, one step could end
  arrow and J and K stepping. Limit: a control that goes away later, after a slow section loads, is not covered.
- The Internal links page drawer is keyed by `urlId`, so a step remounts it and focus goes to the title. Stepping
  keeps working. Its screen task checks this and removes the key only if a test shows a defect.
- Closing returns focus: `DataTable` screens to the row's identity cell (existing code), Citations through
  `useFocusReturn`, the Overview competitor drawer through its opener ref. Internal links openers on the Journey and
  Map canvases have no such code; the screen task verifies what happens and fixes it only by reusing
  `src/features/citations/use-focus-return.ts` if focus is lost to `body`.
- Tab order is unchanged. Focus is not trapped. A click outside does nothing.

### 4.6 Header: expand and More

- Expand ("Open page", `Maximize2`, `onOpenPage`) is shown exactly where a full page exists.

  | Drawer | Full page | Button |
  |---|---|---|
  | Keyword | `/seo/keywords/[tkId]` | Yes, as today, through the unsaved-edit guard |
  | Prompt (Topics and Prompts) | `/ai/prompts/[promptId]` | Added: `router.push(pageHref)` when `pageHref` is passed |
  | Prompt on Citations (`PromptDrawerHost`) | same page | Added by passing `pageHref` |
  | Group, topic, answer, cited page, gap prompt, page (Internal links), competitor, run | none in the app | No button |

- The width items leave the More menu. The More button then shows only where the drawer has actions of its own:
  keyword, group, prompt. It hides for topic, answer, run, page and competitor, with no code in those drawers.
- `hideMoreActions` stays accepted and keeps its meaning (leave the More button out even when `moreActions` is
  passed). The two Citations drawers keep passing it. It is not removed in this change, because sibling sessions may
  copy those drawers.
- `type` stays required. The component no longer needs it for a width, and writes it to the card as
  `data-inspector="<type>"` so tests and styles can tell drawers apart.

### 4.7 URL state

Unchanged, `use-inspector.ts` is not edited. `inspect=<type>:<id>`, `itab`, optional entry keys. Opening pushes one
history entry, a swap or step replaces, Close goes `history.back()` when this page pushed the entry and replaces
otherwise.

### 4.8 What the page does while a drawer is open

Rule: nothing behind the card moves. The card covers the right side of the page under the top bar, including the
right end of a page header.

| Part | Today | Decision |
|---|---|---|
| Table, cards, canvases | Reflow when docked | Never reflow. They keep their width and scroll position |
| Bulk action bar (`bulk-action-bar.tsx:80` to `91`) | In overlay mode it pads its right side by the covered width and moves actions into More | Kept, now on whenever a drawer is open. One fixed-height row, so the table does not move. At 1280 with a 640 px card about 400 px remain for the count, Clear and More; its screen tasks check that |
| `PromptsControls` margin (`prompts-controls.tsx:28` to `31`) | Adds `margin-right` of 12 px plus the card width in overlay mode | Removed. With a 640 px card the row would be about 380 px wide at 1280 and about 637 px at 1537, both under its 672 px breakpoint, so it would wrap to more lines and push the table down. That is a reflow. The row keeps its full width and its right end sits under the card, like every other page header |
| `PageHeader` actions on the right | Covered in overlay mode | Covered. Top bar controls stay visible, the card starts under the top bar |
| Toasts (`toast.tsx:143`, bottom right, z 100) | Over the card's bottom right corner | Unchanged. A known overlap with the edit footer; not part of this change |

### 4.9 Boxed previews

The two design-system specimens put a real `Inspector` in a box with a fixed height. A `fixed` card would leave the
box, and its maximum would follow the viewport, not the box. The smallest change that keeps both right:

- `InspectorLayout` takes `boxed?: boolean` (default `false`). When set, its wrapper is `relative isolate`, it measures
  its own width with the `ResizeObserver` that exists today, and it provides that width through `InspectorBoxContext`.
  Without `boxed` nothing is measured.
- In a box, `Inspector` is `absolute top-3 right-3 bottom-3`, uses the box width in place of the viewport for the 60%
  rule, and does not publish an overlay edge (the bulk bar of a preview is not adjusted).
- The sheet rule still follows the real viewport.

`DrawerCustomizer` keeps `box="contents"`; the reason in its comment (a docked sticky card) is rewritten, since the
layout it wraps does not depend on it any more.

## 5. The shared API after the change

```ts
// src/components/app/inspector/inspector.tsx: unchanged props
interface InspectorProps {
  type: InspectorType;
  header: { title, lang?, typeLabel, typeNoun, positionText?, freshness?, badges?, frequentAction?,
            onOpenPage?, navigation?, moreActions?, moreButtonRef? };
  backLabel: string;          // the sheet's Back button, below 900 px
  onClose: () => void;
  onStep?: (direction: 'next' | 'previous') => void;   // J, K, and now ArrowDown, ArrowUp inside the drawer
  hideMoreActions?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

// src/components/app/inspector/inspector-layout.tsx
interface InspectorLayoutProps { children: ReactNode; inspector: ReactNode; boxed?: boolean }
export const InspectorOverlayContext: Context<number | null>;      // kept: the card's left edge, for the bulk bar
export const InspectorBoxContext: Context<{ width: number | null } | null>;   // new, replaces InspectorAreaContext
export function useViewportWidth(): number;                        // kept

// src/lib/inspector/placement.ts
export const INSPECTOR_WIDTH = { min: 480, max: 960, default: 640 } as const;
export const INSPECTOR_VIEWPORT_SHARE = 0.6;
export const SHEET_BELOW = 900;
export type InspectorMode = 'overlay' | 'sheet';
export function inspectorMaxWidth(frameWidth: number): number;
export function fitInspectorWidth(width: number, max: number): number;      // unchanged
export function inspectorPlacement(input: { viewportWidth: number; frameWidth?: number; preferred: number }): InspectorPlacement;
// removed: MIN_MAIN_COLUMN, OVERLAY_GUTTER, WIDE_TYPES, defaultInspectorWidth, the `areaWidth` input, INSPECTOR_WIDTH.wide

// src/lib/inspector/width-store.ts
export const InspectorWidthUserContext: Context<string | null>;
export function readInspectorWidth(userId: string | null): number | null;
export function writeInspectorWidth(userId: string | null, width: number | null): void;
export function subscribeInspectorWidth(listener: () => void): () => void;   // unchanged
```

What a sibling session must do: nothing, except not rely on docking. A screen that expected the table to narrow, or
read `InspectorAreaContext`, must stop.

## 6. Tokens

`src/styles/tokens.css`, mirrored in `src/styles/globals.css` and `src/lib/design/class-names.ts`:

| Token | Before | After |
|---|---|---|
| `--size-inspector` | 25rem (400) | 40rem (640), the default drawer width |
| `--size-inspector-min` | 22.5rem (360) | 30rem (480) |
| `--size-inspector-max` | 40rem (640) | 60rem (960). The 60% share is applied in code |
| `--size-inspector-wide` | 27.5rem (440) | removed, with `--spacing-inspector-wide` and the `inspector-wide` class name |
| `--size-inspector-docked`, `--size-inspector-docked-max` | docked heights | removed, with their `--spacing-*` lines and class names |
| `--size-inspector-top` | top bar plus 12 px | kept |
| `--z-inspector` (50) | docked inspector | kept, value unchanged. Its only user is the maximised Internal links map (`map-tab.tsx:357`), which must stay under the drawer (70). The comment is corrected; no rename |
| `--z-drawer` (70) | "overlay drawer (tablet, mobile)" | kept; comment: the inspector drawer, sheets, the navigation drawer |
| `--shadow-inspector` | card shadow | kept |

`w-inspector` has two users that preview drawer content at the default width
(`src/features/layouts/live-specimen.tsx:437`, `src/components/design-system/metric-parts-section.tsx:402`, both with
`max-w-full`). They become 640 px wide, which is what they show. `src/components/design-system/token-groups.ts:171` to
`172` describes the two z tokens and is corrected.

## 7. Strings

No new visible string. `inspector.resize` ("Resize inspector") and `inspector.widthValue` ("{width} pixels") stay.
Five keys lose their only reader and are deleted from `messages/en.json`: `inspector.width`, `inspector.widthDefault`,
`inspector.widthWide`, `inspector.widthMaximum`, `inspector.resetWidth`. `dataTable.resetWidth` is a different key and
stays. `docs/glossary/terms.md` needs no entry. `src/lib/glossary/glossary-words.test.ts` runs after the deletion.

## 8. Content uses the width

The drawer content is already width-driven: no pixel width is hard-coded in any drawer folder, `InspectorSection` uses
container queries, and charts draw into `ChartFrame`. What is not proven is that each drawer looks right at 640 and at
the maximum. Each screen task checks its own drawer at 640 px and at 960 px (viewport 1920, or the widest the
verifying browser allows) and fixes what fails:

| Drawer | Acceptance at 640 and at 960 |
|---|---|
| Keyword | The rank history chart fills the card width less its 16 px padding at both widths and redraws when the handle is dragged (no 400 px plot in a wider card). The metric strip cells share the full row. Mini tables run edge to edge |
| Group | Lists use the full width; no column of fixed 360 px |
| Prompt | The strip, History chart and Competitors table fill the width. The tab row shows more tabs before "More tabs" at 640 than at 480 |
| Answer | The answer text is not held to a narrow measure by a fixed width. Evidence side content may sit beside the text where `InspectorSection` allows it |
| Topic | Overview cards and the Prompts list fill the width |
| Cited page, gap prompt | `DrawerCard`s and the drawer table fill the width; table columns do not stay at their 440 px sizes with empty space on the right |
| Internal links page | The two neighbour lists and the footer buttons use the width; long URLs get the extra room before truncating |
| Competitor | The trend chart and the Prompts and Sources tables fill the width |
| Run | Summary key values and the coverage card fill the width |

The owner's note names a "Search tab". The keyword drawer in this worktree has one tab, Overview. If a Search tab lands
on `develop` before the Rankings task runs, the same check applies to it.

The comments that say "440 px" or "400 px card" in drawer files are corrected in the same tasks.

## 9. Couplings and what happens to each

| Coupling | Decision |
|---|---|
| `InspectorOverlayContext`: bulk bar | Kept, always on while a drawer is open (section 4.8) |
| `InspectorOverlayContext`: `PromptsControls` | Its use is removed (section 4.8) |
| `InspectorAreaContext`, the layout's `ResizeObserver` | Removed for pages. The observer survives only for `boxed` previews, as `InspectorBoxContext` |
| Drag preview `marginLeft` | Removed. The preview state stays, so storage is written once per drag |
| Design-system specimens | Pass `boxed` (section 4.9) |
| `aside[aria-labelledby]` selectors (`rankings-screen.tsx:521`, `prompts/add/use-add-form.ts:48`) | Valid: the drawer stays an `aside` with `aria-labelledby` |
| `role=complementary` queries (at least 29 unit and 7 e2e files) | Valid: the role is the `aside`'s own. Not touched |
| Tests that assert docked, width or placement | Rewritten: `inspector.test.tsx`, `placement.test.ts`, `width-store.test.tsx`, parts of `drawer-customizer.test.tsx`, `use-inspector-stepping.test.tsx`, `src/test/rankings-harness.tsx`, e2e comments and `e2e/flows/rankings.spec.ts:623` |
| `--z-inspector` and the maximised map | Token kept (section 6). The drawer stays above the maximised map |
| Hand-rolled stepping in Rankings, Runs, Prompts, prompt host, competitor | Left as is. Arrow stepping arrives through `onStep` |
| Citations `BoardTable` has no `role=grid` | Noted only. J and K still do nothing from its rows; arrows and J and K work inside the drawer |
| Competitors screen wraps `InspectorLayout inspector={null}` | Left as is. After this change `InspectorLayout` is two wrapper `div`s and one context when not boxed, so the wrapper costs nothing and removing it would change that page's DOM for no gain |
| Focus return on Escape | Kept where it exists; Internal links canvases verified in their task (section 4.5) |
| Scrolling the active row clear of the card | Not added (section 4.1) |
| `PageHeader` comment "so a docked inspector counts" (`page-header.tsx:102`) | Comment corrected; the container query stays |
| `CustomizableScreen box="contents"` | Kept; comments corrected |
| Visual baselines (`e2e/visual/pages.spec.ts:36`) | Will differ. Regenerated by the owner's release flow, not by this plan; the plan lists the affected shots |

## 10. Accessibility rules

1. The drawer is an `aside` named by its title through `aria-labelledby` (complementary landmark), non-modal, no focus
   trap, no scrim, reachable with F6. The sheet below 900 px is modal (Base UI Drawer).
2. The open row carries `aria-current="true"` in `DataTable`. `BoardTable` marks it with `data-active` only; that gap
   is older than this change and stays noted.
3. The resize separator follows the window splitter pattern with the values of section 4.2. Its focus ring is the
   standard `focus-ring`.
4. Keyboard stepping: section 4.4. The Previous and Next buttons stay `focusableWhenDisabled` with a label that says
   why ("First keyword in this list").
5. Escape closes one layer per press, innermost first.
6. Focus not obscured (WCAG 2.4.11): the card is opened by the person, can be closed with Escape and narrowed with the
   handle, and never covers the first column. A grid cell on the right that takes focus under the card is covered.
   `docs/design-system/20-accessibility.md` line 144 claims the table scrolls the focused cell clear; no code does
   that. The doc is corrected to say what is true, and the behaviour is listed as a later item.
7. Reduced motion: nothing animates, so there is nothing to switch off.
8. Target sizes are unchanged (32 px icon buttons, 8 px handle hit area with keyboard and double-click alternatives).
9. Colour, borders and shadow come from tokens only: `bg-background`, `border-border`, `shadow-inspector`.

## 11. Doc sections to change

| File | Sections and lines |
|---|---|
| `AI_DEVELOPMENT_UI_RULES.md` | Rule 4 "Spacing scale only" (line 12): `w-inspector` (640), remove `w-inspector-wide` |
| `DESIGN_SYSTEM.md` | Index row 05 (line 16, "inspector docking") and decision 4 (line 64, "400 px inspector (440 px ...)") |
| `docs/design-system/01-foundations.md` | z-index table, `--z-inspector` row (line 98) |
| `docs/design-system/05-layout-grid.md` | Breakpoint row 1280 (12), diagram (31), region table (64), widths table (95), section 6 "Inspector docking rules" (119 to 133), rewritten as "Inspector overlay rules" |
| `docs/design-system/06-surfaces-borders-radius.md` | Rule 4 (23) and the `shadow-inspector` row (62) |
| `docs/design-system/08-interaction-states.md` | Focus rule 3 (29) |
| `docs/design-system/12-tables.md` | Bulk bar note (315) |
| `docs/design-system/16-drawers-dialogs-popovers.md` | Header links (6), section 1.1 widths (30 to 40), 2.1 container, header row 1 and the "Open page" sentence (102 to 111), 2.2 in full (113 to 126), 2.3 tab row widths, 2.6 in full, retitled "Overlay and sheet" (164 to 191), 2.8 (231 to 240, the 768 figure), 2.10 (arrow keys), 8 (615), 9 motion rows (627 to 628), 10 tokens (644 to 645) |
| `docs/design-system/18-notifications-alerts.md` | Toast viewport row (58) |
| `docs/design-system/19-responsive-behavior.md` | Principle 2 (12), breakpoint table (34 to 36), column rule 1 (200), section 7 inspector table and docking rule (317 to 347), narrow and wide table heading (457), test matrix (488 to 492), check 3 (505) |
| `docs/design-system/20-accessibility.md` | Line 144 (obscured focus), focus table row (152), widget row for the resize handle (204), section 14 table (a row for ArrowUp and ArrowDown), component row `Inspector` (803) |
| `docs/design-system/21-motion.md` | Table row "Docked inspector" (46), section 4.5 (199 to 202), rule 8 (372), the anti-pattern row (443) |
| `docs/design-system/23-application-patterns.md` | L3 row (22), strip rows (98 to 99), frame sentences (251, 285), "In the inspector (440 px)" (395) |
| `docs/design-system/24-page-templates.md` | Lines 127, 364, 365, 532, 676, 678, 727, 735, 829, 1091 (width figures and "docked") |
| `docs/design-system/25-component-inventory.md` | Lines 1172, 2008, 2014, 4416, section 18.1 props (4885 to 4896), deviation rows 9 (5223), and one new deviation row that records this change |
| `docs/design-system/26-implementation-guidelines.md` | Size utilities table (134 to 135) |
| `docs/design-system/27-design-review-checklist.md` | Line 18 |

`docs/design-system/review-log.md` is a log and is not rewritten. `apps/web/design-preview` is not edited.

## 12. Left docked and why

Nothing stays docked. The two side panels that are not `Inspector` are not docked right panels and are left alone:

- `src/features/internal-links/map/map-card.tsx:43`: an `aside` card placed inside the map canvas, top left.
- `src/components/app/metric/statistics-panel.tsx`: rendered inside the prompt drawer's Stats tab.

The left navigation drawer below 1024 px and the mobile filters sheet are not detail panels.

## 13. Out of scope

- Pin to dock, or any docked mode.
- A width per drawer type.
- A server-side preference, or syncing the width across devices.
- An enter or exit animation. The React inspector has none today; `docs/design-system/16` section 9 describes one and
  the static preview implements one. It is a possible later item. `apps/web/design-preview` is not touched.
- New drawer content, new tabs, new drawers.
- Having the drawer follow arrow keys in the table grid.
- Scrolling a focused grid cell clear of the card.
- Giving `BoardTable` grid semantics.
- Moving toasts away from the card.
- Refactoring hand-rolled stepping onto `useInspectorStepping`.
- Removing `hideMoreActions` or the Competitors screen's wrapper.

## 14. Risks

1. A row click under a drawer with unsaved edits is more likely now that the table is not squeezed. The Rankings
   `guarded` path must stay on every route that moves the drawer; its task re-tests it.
2. Page header actions on the right are covered while a drawer is open at every viewport, not only at 1280. Accepted
   by the decision; the person closes or narrows the drawer.
3. ArrowUp and ArrowDown no longer scroll the drawer from a focused button or the title (section 4.4).
4. Tasks 1 and 2 of the plan are one unit: after task 1 the component does not compile until task 2 lands.
5. Sibling sessions build against `Inspector` while it changes. The props do not change, and the plan messages them
   as soon as task 2 is committed.
6. Visual baselines change for every shot with an open drawer.
7. A viewport from 768 to 899 px now gets the sheet. No test opens a drawer in that range today; the cleanup task
   re-checks.
8. Overview cards used to reflow beside a docked drawer and now sit under it. Their charts keep their size, which is
   the intent, but the competitor drawer covers the cards on the right.

## 15. Verification

- Unit: placement and width store (pure logic), the component tests of `Inspector`, and each screen's own tests, run
  one file at a time on one worker.
- Visual, last task: the running app in mock mode (`web-mock` in `.claude/launch.json`,
  `NEXT_PUBLIC_API_MOCKING=all`) and the `/design-system/inspector` specimen, at 1280 x 720 and 1537 wide, light and
  dark: the open row and the first column visible, no reflow on open, close, swap and resize, the saved width shared
  by every drawer, the sheet below 900.
- Whole-project `pnpm lint`, `pnpm typecheck` and `pnpm format:check` at the milestones, one `pnpm build` at the end.
  No full unit suite and no full e2e run inside the worktree.
