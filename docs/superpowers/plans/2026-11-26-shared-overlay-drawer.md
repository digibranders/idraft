# Shared Overlay Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every right-side detail panel is one non-modal overlay drawer that never resizes the page behind it, is 640 px wide by default, and can be dragged from 480 px to 60% of the viewport (960 px at most), with one saved width per user.

**Architecture:** The panels already share `Inspector` (`apps/web/src/components/app/inspector/`). The docked mode and everything that fed it are deleted; the overlay becomes the only desktop mode and the sheet starts below 900 px. Pure placement and storage logic changes first, then the component, then docs and previews, then one task per screen for what each screen coupled to docking. Names and props stay, so three sibling sessions adopt the component without changes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4 tokens, Base UI, nuqs, next-intl, Vitest 5 with Testing Library (jsdom), Playwright.

**Spec:** [docs/superpowers/specs/2026-11-26-shared-overlay-drawer-design.md](../specs/2026-11-26-shared-overlay-drawer-design.md). Read it before any task. Section numbers below refer to it.

---

## Rules for whoever executes this

- Work only in the worktree `.claude/worktrees/shared-drawer-121ede`, branch `claude/shared-drawer-121ede`. Never switch branches, never touch the main checkout, never edit `apps/web/design-preview`.
- One subagent at a time. Sonnet for every task; Haiku only for the plain figure swaps of task 3 step 3 and the greps of task 11 step 1. Never Opus.
- Every task ends with an independent review by a fresh Sonnet subagent that gets the diff (`git show --stat HEAD` and `git diff HEAD~1`), the spec and the checklist below. Fix what it finds, re-run the task's commands, amend nothing: add a follow-up commit `Review: <what>`.
- Edit with the Edit and Write tools. No `sed -i`, no heredocs.
- Before any `.tsx` or CSS edit, invoke the `design-taste-frontend` skill as the owner's rules require, then follow `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md`, which outrank it. Tokens only; no new colours, sizes or z-index values.
- No em-dashes or en-dashes in code comments, strings, docs or commit messages. Ranges use "to".
- No dev server, watcher or container left running. No full unit suite, no e2e run, no `./check.sh`.
- Commit after every task with the message given. No attribution lines, no push, no merge.

### Commands (run from `apps/web`)

```bash
# once, before task 1, only if apps/web/node_modules is missing (from the worktree root)
pnpm install --frozen-lockfile

# tests: named files only, one worker
pnpm vitest run --maxWorkers=1 <file> [<file> ...]

# scoped lint and format: the files the task changed
pnpm exec eslint --max-warnings 0 <files>
pnpm exec prettier --check <files>

# whole-project by nature: only at the end of tasks 2, 6, 10, 11 and 12
pnpm typecheck
pnpm lint
pnpm format:check

# once, in task 12 only
pnpm build
```

### Review checklist (every task; each task adds its own lines)

1. The diff does what the spec section named in the task says, and nothing else. No behaviour of section 13 (out of scope) crept in.
2. `Inspector`, `InspectorLayout`, `useInspector` and `useInspectorStepping` keep their names and props. `type` and `hideMoreActions` are still accepted.
3. The drawer is still an `aside` with `aria-labelledby`; no test stopped querying `role=complementary`.
4. Classes use tokens only. No arbitrary pixel values, no new z-index, no inline colour.
5. No dashes (em or en) anywhere in the diff. Visible strings come from `messages/en.json`.
6. Accessibility: focus order, Escape, labels and roles as in spec section 10.
7. Tests assert behaviour a person would notice (roles, widths, storage keys, focus), not implementation details, and each new test failed before the change.
8. No dead code: no unused export, prop, context, i18n key, token or comment about docking in the files touched.
9. The task's commands were run and their output is quoted in the handover.

---

## File structure

| File (under `apps/web/`) | Change | Task |
|---|---|---|
| `src/lib/inspector/placement.ts`, `placement.test.ts` | Widths 640, 480, 960 and 60%; `overlay` and `sheet` only; `inspectorMaxWidth` | 1 |
| `src/lib/inspector/width-store.ts`, `width-store.test.tsx` | One width per user under `idraft.pref.<userId>.inspector-width`; user context | 1 |
| `src/components/app/inspector/inspector.tsx`, `inspector-layout.tsx`, `inspector-resize-handle.tsx`, `inspector.test.tsx` | Overlay only, arrow stepping, refocus, `boxed`, no width menu | 2 |
| `src/features/session/apply-preferences.tsx`, `apply-preferences.test.tsx` | Provides the user id for the width | 2 |
| `src/styles/tokens.css`, `src/styles/globals.css`, `src/lib/design/class-names.ts`, `src/components/design-system/token-groups.ts`, `messages/en.json` | Token values, removed tokens and keys | 2 |
| `src/lib/inspector/use-inspector-stepping.test.tsx`, `src/features/layouts/drawer/drawer-customizer.test.tsx`, `src/test/rankings-harness.tsx` | Drop the docking stubs | 2 |
| Docs of spec section 11; `src/components/design-system/inspector-section.tsx`, `domains-feeds-section.tsx`; `src/features/layouts/drawer/drawer-customizer.tsx`, `customize/customizable-screen.tsx`, `customize-specimen.tsx` | Text, `boxed` previews, comments | 3 |
| `src/features/rankings/**` | Keyword and group drawers | 4, 5 |
| `src/features/prompts/**` | Prompt, answer, topic drawers, `PromptsControls`, expand | 6 |
| `src/features/citations/**` | Board and two drawers | 7 |
| `src/features/internal-links/**` | Page drawer, map comment | 8 |
| `src/features/ai-overview/competitor-drawer/**`, `src/features/competitors/competitors-screen.tsx` | Competitor drawer | 9 |
| `src/features/operations/**` | Run drawer | 10 |
| leftovers, `e2e/**` comments and one spec | Cleanup | 11 |

---

### Task 1: Placement and the width store (pure logic)

Spec sections 4.1, 4.3 and 5. After this task `inspector.tsx` does not compile and `inspector.test.tsx` fails. That is expected: task 2 follows at once and the two are never pushed apart. Run only the two test files named here.

**Files:**
- Modify: `apps/web/src/lib/inspector/placement.ts:35-58` (constants, `WIDE_TYPES`), `:76-77` (`defaultInspectorWidth`), `:86-118` (mode and placement)
- Modify: `apps/web/src/lib/inspector/placement.test.ts:26-34`, `:45-89`
- Rewrite: `apps/web/src/lib/inspector/width-store.ts`, `width-store.test.tsx`

- [ ] **Step 1: Write the failing placement tests.** In `placement.test.ts` keep the `inspect targets` block, but change the test at line 26 to assert only `parseInspectTarget` (drop its `defaultInspectorWidth` lines). Replace the `widths` and `inspectorPlacement` blocks with:

```ts
describe('widths', () => {
  it('has one default for every type: 640, from 480 to 960', () => {
    expect(INSPECTOR_WIDTH).toEqual({ min: 480, max: 960, default: 640 });
  });
  it('caps the width at 60% of the frame, on the 8 px grid, never above 960 or below 480', () => {
    expect(inspectorMaxWidth(900)).toBe(536);
    expect(inspectorMaxWidth(1024)).toBe(608);
    expect(inspectorMaxWidth(1280)).toBe(768);
    expect(inspectorMaxWidth(1537)).toBe(920);
    expect(inspectorMaxWidth(1600)).toBe(960);
    expect(inspectorMaxWidth(2560)).toBe(960);
    expect(inspectorMaxWidth(700)).toBe(480);
  });
  it('snaps to 8 px and keeps between the minimum and the maximum', () => {
    expect(fitInspectorWidth(643, 768)).toBe(640);
    expect(fitInspectorWidth(100, 768)).toBe(480);
    expect(fitInspectorWidth(2000, 768)).toBe(768);
  });
});

describe('inspectorPlacement', () => {
  it('is a sheet below 900 px and lays over the page from 900 px', () => {
    expect(inspectorPlacement({ viewportWidth: 899, preferred: 640 })).toEqual({ mode: 'sheet', width: 899, maxWidth: 899 });
    expect(inspectorPlacement({ viewportWidth: 900, preferred: 640 })).toEqual({ mode: 'overlay', width: 536, maxWidth: 536 });
  });
  it('opens at the preferred width where it fits', () => {
    expect(inspectorPlacement({ viewportWidth: 1280, preferred: 640 })).toEqual({ mode: 'overlay', width: 640, maxWidth: 768 });
    expect(inspectorPlacement({ viewportWidth: 1537, preferred: 640 })).toEqual({ mode: 'overlay', width: 640, maxWidth: 920 });
  });
  it('narrows a wider saved width to what this viewport allows', () => {
    expect(inspectorPlacement({ viewportWidth: 1280, preferred: 960 }).width).toBe(768);
    expect(inspectorPlacement({ viewportWidth: 1920, preferred: 960 }).width).toBe(960);
  });
  it('takes 60% of a boxed preview, not of the window', () => {
    expect(inspectorPlacement({ viewportWidth: 1440, frameWidth: 800, preferred: 640 })).toEqual({ mode: 'overlay', width: 480, maxWidth: 480 });
  });
});
```

Update the import list to `fitInspectorWidth, formatInspectTarget, INSPECTOR_WIDTH, inspectorMaxWidth, inspectorPlacement, parseInspectTarget`.

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run --maxWorkers=1 src/lib/inspector/placement.test.ts`. Expected: failures on `inspectorMaxWidth` (not exported) and the new numbers.

- [ ] **Step 3: Change `placement.ts`.** Keep `INSPECTOR_TYPES`, `InspectorType`, `InspectorTarget`, `parseInspectTarget`, `formatInspectTarget`, `INSPECTOR_EDGE`, `SNAP`, `MAX_ID_LENGTH`, `fitInspectorWidth` and `InspectorPlacement` as they are. Delete `MIN_MAIN_COLUMN`, `OVERLAY_GUTTER`, `WIDE_TYPES` and `defaultInspectorWidth`. Replace the rest with:

```ts
/** Widths in pixels: 640 by default, resizable from 480 to 960 and never past 60% of the viewport. */
export const INSPECTOR_WIDTH = { min: 480, max: 960, default: 640 } as const;
/** The most of the viewport, or of a boxed preview, the drawer may cover. */
export const INSPECTOR_VIEWPORT_SHARE = 0.6;
/** Below this viewport width the inspector is a full-width sheet. */
export const SHEET_BELOW = 900;

/** The widest the drawer may be in a frame this wide, on the 8 px grid. */
export function inspectorMaxWidth(frameWidth: number): number {
  const share = Math.min(INSPECTOR_WIDTH.max, frameWidth * INSPECTOR_VIEWPORT_SHARE);
  return Math.max(INSPECTOR_WIDTH.min, Math.floor(share / SNAP) * SNAP);
}

export type InspectorMode = 'overlay' | 'sheet';

/**
 * Where the inspector goes: a sheet below 900 px, otherwise a card over the page at the preferred width, kept to
 * what the frame allows. `frameWidth` is the viewport unless the inspector sits in a boxed preview.
 */
export function inspectorPlacement({
  viewportWidth,
  frameWidth = viewportWidth,
  preferred,
}: {
  viewportWidth: number;
  frameWidth?: number;
  preferred: number;
}): InspectorPlacement {
  if (viewportWidth < SHEET_BELOW) return { mode: 'sheet', width: viewportWidth, maxWidth: viewportWidth };
  const maxWidth = inspectorMaxWidth(frameWidth);
  return { mode: 'overlay', width: fitInspectorWidth(preferred, maxWidth), maxWidth };
}
```

`SNAP` must be declared above `inspectorMaxWidth`. Rewrite the file's header comment to describe overlay and sheet only.

- [ ] **Step 4: Run the placement test, expect it to pass.**

- [ ] **Step 5: Write the failing width store tests.** Replace `width-store.test.tsx` with tests of these names and assertions (`afterEach`, in this order: `vi.restoreAllMocks()`, `window.localStorage.clear()`, then `writeInspectorWidth('u1', null)` and `writeInspectorWidth(null, null)`, so a width a failing storage left in the module's memory does not reach the next test):

| Test name | Assertions |
|---|---|
| `keeps one width per user under the preference prefix, and tells its readers` | after `writeInspectorWidth('u1', 720)`: `localStorage.getItem('idraft.pref.u1.inspector-width')` is `'720'`, `readInspectorWidth('u1')` is 720, `readInspectorWidth('u2')` is null, the subscribed listener ran once; after `writeInspectorWidth('u1', null)` the key is null and the read is null |
| `ignores a stored value that is not an integer from 480 to 960` | for each of `'9000'`, `'479'`, `'640.5'`, `'abc'`, `''` set under the key: `readInspectorWidth('u1')` is null |
| `leaves the stored value alone when a smaller window narrows it` | set `'960'`; `inspectorPlacement({ viewportWidth: 1280, preferred: readInspectorWidth('u1') ?? 640 }).width` is 768; the stored string is still `'960'` |
| `goes with the other preferences at sign-out` | write 720 for `u1`; `clearPreferences()`; read is null |
| `keeps the width in memory without a user id and writes nothing` | `writeInspectorWidth(null, 720)`; `readInspectorWidth(null)` is 720; `localStorage.length` is 0 |
| `holds the width in memory when storage is full but still readable` | `setItem` throws `QuotaExceededError`; write 560 for `u1`; read is 560 |
| `holds the width in memory while storage is blocked` | `setItem` and `getItem` throw `SecurityError`; write 520 for `u1`; read is 520 |
| `never reads the old per-type keys, and removes them on a write` | set `inspector-width:keyword` to `'520'`; read for `u1` is null; after `writeInspectorWidth('u1', 640)` the old key is null |
| `tells its readers about a write in another tab` | subscribe; `window.dispatchEvent(new StorageEvent('storage'))`; the listener ran once |

- [ ] **Step 6: Run it and see it fail** (`src/lib/inspector/width-store.test.tsx`).

- [ ] **Step 7: Rewrite `width-store.ts`:**

```ts
'use client';

import { createContext } from 'react';

import { INSPECTOR_TYPES, INSPECTOR_WIDTH } from './placement';
import { preferenceKey } from '@/lib/preferences/storage';

/**
 * The inspector width a person chose, one for every drawer, in `localStorage` under their user id with their other
 * preferences (16-drawers-dialogs-popovers.md section 2.2), so signing out removes it. A convenience of one browser:
 * storage may be missing, full or blocked, and then the width lasts until the page reloads.
 */

/** Whose width it is. The workspace provides the user id; without one (a preview, a test) the width stays in memory. */
export const InspectorWidthUserContext = createContext<string | null>(null);

const NAME = 'inspector-width';
const listeners = new Set<() => void>();
// Where a width lives without a user id, or when storage refused it: until the page reloads
const memory = new Map<string, number | null>();
const slotOf = (userId: string | null): string => userId ?? '';

export function readInspectorWidth(userId: string | null): number | null {
  const slot = slotOf(userId);
  if (memory.has(slot)) return memory.get(slot) ?? null;
  if (userId === null) return null;
  try {
    const stored = window.localStorage.getItem(preferenceKey(userId, NAME));
    if (stored === null || stored === '') return null;
    const width = Number(stored);
    return Number.isInteger(width) && width >= INSPECTOR_WIDTH.min && width <= INSPECTOR_WIDTH.max ? width : null;
  } catch {
    return null;
  }
}

/** Stores a width, or forgets it with `null` (a reset). */
export function writeInspectorWidth(userId: string | null, width: number | null): void {
  if (userId === null) {
    memory.set('', width);
  } else {
    try {
      if (width === null) window.localStorage.removeItem(preferenceKey(userId, NAME));
      else window.localStorage.setItem(preferenceKey(userId, NAME), String(width));
      // The widths kept per object type before there was one width: no longer read
      for (const type of INSPECTOR_TYPES) window.localStorage.removeItem(`inspector-width:${type}`);
      memory.delete(userId);
    } catch {
      // Storage is blocked or full: the width in memory serves until the page reloads
      memory.set(userId, width);
    }
  }
  for (const listener of listeners) listener();
}
```

Keep `subscribeInspectorWidth` exactly as it is today.

- [ ] **Step 8: Run both test files, expect all green.** Then `pnpm exec eslint --max-warnings 0` and `pnpm exec prettier --check` on the four files.

- [ ] **Step 9: Commit.** `git add apps/web/src/lib/inspector/placement.ts apps/web/src/lib/inspector/placement.test.ts apps/web/src/lib/inspector/width-store.ts apps/web/src/lib/inspector/width-store.test.tsx`, message `Inspector: one overlay width rule and one saved width per user`. If a commit hook rejects it because the component does not compile yet, do not bypass the hook: leave the files staged and commit them together with task 2.

- [ ] **Step 10: Review.** Checklist plus: the numbers match spec section 4.1's table; reads never write; nothing but the two modules changed.

---

### Task 2: The Inspector component, its layout, tokens and user context

Spec sections 4.1 to 4.6, 4.9, 5, 6, 7. This task ends with the shared component DONE.

**Files:**
- Modify: `apps/web/src/components/app/inspector/inspector.tsx` (whole component body, lines 56-230)
- Modify: `apps/web/src/components/app/inspector/inspector-layout.tsx:13-14`, `:42-78`
- Modify: `apps/web/src/components/app/inspector/inspector-resize-handle.tsx` (doc comments at 13-23 and 27-31 only; the logic already reads `INSPECTOR_WIDTH.min`)
- Modify: `apps/web/src/components/app/inspector/inspector-header.tsx:54` (comment: 900 px)
- Modify: `apps/web/src/features/session/apply-preferences.tsx:26-30`, `apply-preferences.test.tsx`
- Modify: `apps/web/src/styles/tokens.css:323-329`, `:366-367`; `apps/web/src/styles/globals.css:235`, `:237-238`; `apps/web/src/lib/design/class-names.ts:49`, `:51-52`; `apps/web/src/components/design-system/token-groups.ts:171-172`
- Modify: `apps/web/messages/en.json:2074-2078` (delete five keys)
- Modify tests: `apps/web/src/components/app/inspector/inspector.test.tsx`, `apps/web/src/lib/inspector/use-inspector-stepping.test.tsx:293-310`, `apps/web/src/features/layouts/drawer/drawer-customizer.test.tsx:21-44`, `:167`, `apps/web/src/test/rankings-harness.tsx:23`, `:101-116`

- [ ] **Step 1: Write the failing component tests.** In `inspector.test.tsx` delete the `AreaObserver` class and its stub, keep `innerWidth` stubs, and add a `user` option to `Harness` that wraps the tree in `<InspectorWidthUserContext value="u1">`. Replace the tests at lines 103-111, 120-134, 198-211, 219-236 and 244-254 and add the new ones:

| Test name | Assertions |
|---|---|
| `lays over the list as a named aside at 640 px, and moves focus to its title` | `innerWidth` 1440: `getByRole('complementary', { name })` has `style.width` `640px`, class contains `fixed`, not `sticky`; the title has focus; `data-inspector` is `keyword` |
| `takes no room in the layout: the list keeps its width` | the aside has no `marginLeft`; the main column `div` keeps class `flex-1` and gets no inline style |
| `is a modal sheet with a back button below 900 px` | `innerWidth` 899: no `complementary`; a `dialog` with "Back to Keywords"; no `separator` |
| `stays a card at 900 px, narrowed to 60% of the window` | `innerWidth` 900: aside width `536px` |
| `previews a drag and saves the width once, on release, for the user` | with `user`: `pointerDown` at 800, `pointerMove` to 720: width `720px`, `localStorage.getItem('idraft.pref.u1.inspector-width')` null, no `marginLeft`; `pointerUp`: the key is `'720'` |
| `resizes from the keyboard within its limits, and resets with Enter and a double click` | `innerWidth` 1280, with `user`: separator `aria-valuenow` 640, `aria-valuemin` 480, `aria-valuemax` 768; ArrowLeft gives 656; Shift+ArrowRight from 656 gives 592; End gives 768; Home gives 480; Enter removes the key and the width is 640; a double click after another ArrowLeft does the same |
| `uses one saved width for every type` | render `type="prompt"` with the key set to `'720'`: width `720px` |
| `narrows a saved width the window cannot hold, and leaves what is stored` | key `'960'`, `innerWidth` 1280: width `768px`, the key still `'960'` |
| `offers no width items, and leaves More out when it has no actions` | no `moreActions`: no button named "More actions for ..."; with one `moreActions` item: the menu holds that item only, and no "Width", "Default", "Wide", "Maximum", "Reset width" |
| `steps with ArrowDown and ArrowUp from inside the card` | focus on the title: ArrowDown calls `onStep('next')`, ArrowUp `onStep('previous')`; the same from the Close button |
| `leaves the arrows to a tab list, a text field, a scroll region and the resize handle` | add to the harness body an `input` and an `InspectorBody label`; ArrowDown on a `tab`, on the `input`, on the `region` and on the `separator` does not call `onStep` |
| `does not step with a modifier, on a held key, or from the list` | Shift+ArrowDown, a `repeat: true` event, and ArrowDown on the list's button do not call `onStep` |
| `does not step while a menu opened from the card is open` | open the More menu, ArrowDown: `onStep` not called |
| `does not step with the arrows when the drawer has no onStep` | harness without `onStep`: nothing thrown, default not prevented |
| `returns focus to the title when a step removes the focused control` | a harness whose body button belongs to the record and whose `title` state changes inside `onStep`: focus the button, ArrowDown, the button unmounts, the title has focus |
| `sits inside a boxed layout, sized by the box` | `InspectorLayout boxed` with a `ResizeObserver` stub that reports 800: class contains `absolute`, not `fixed`; width `480px` |

Keep the J and K tests (136-196), the Escape tests, `names a disabled Previous`, `leaves the More menu out when asked`, the axe test and every `InspectorSection` and `InspectorBody` test unchanged.

In `apply-preferences.test.tsx` add `provides the signed-in user id for the saved drawer width`: a child reads `use(InspectorWidthUserContext)` and renders it; expect the mock user's `user_id`.

- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run --maxWorkers=1 src/components/app/inspector/inspector.test.tsx src/features/session/apply-preferences.test.tsx`.

- [ ] **Step 3: `inspector-layout.tsx`.** Replace `InspectorAreaContext` with:

```tsx
/** A preview that keeps the inspector inside its own box gives the box's width here; `null` on a page. */
export const InspectorBoxContext = createContext<{ width: number | null } | null>(null);
```

Add `boxed?: boolean` to `InspectorLayoutProps` ("A preview with a fixed height: the inspector stays inside this box and takes its limit from the box's width. Default `false`."). In the component, run the `ResizeObserver` effect only when `boxed` (add `boxed` to its dependency list and return early when it is false), memoise the context value with `useMemo(() => (boxed ? { width } : null), [boxed, width])`, and give the outer `div` the class `cn('flex min-w-0 flex-1 items-start', boxed && 'relative isolate')`. Keep `InspectorOverlayContext`, the setter context, `useViewportWidth` and the two wrapper `div`s. Rewrite the doc comments: the layout no longer measures for docking.

- [ ] **Step 4: `inspector.tsx`.** Imports: drop `defaultInspectorWidth` and `InspectorAreaContext`; add `InspectorBoxContext`, `InspectorWidthUserContext`, `type KeyboardEvent as ReactKeyboardEvent`. Constants:

```tsx
/** Popups that own the keyboard while open. */
const OPEN_POPUPS =
  ':is([role="listbox"], [role="menu"], [role="dialog"])[data-open], [role="combobox"][aria-expanded="true"]';
/** Layers that close before the inspector does, one per Escape (16 section 2.8, rule 5). */
const OPEN_LAYERS = `[data-slot="tooltip"]:not([data-ending-style]), ${OPEN_POPUPS}`;
/** Controls that use the arrow keys themselves: there ArrowUp and ArrowDown do not step. */
const ARROW_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="spinbutton"], [role="separator"], [role="grid"], [role="treegrid"], [role="tree"], [aria-haspopup]';
/** A focused scroll area keeps its arrows, so a keyboard can scroll it. */
const SCROLL_AREAS = '[role="region"], [role="tabpanel"]';
```

Width and placement (replaces lines 82-108):

```tsx
const userId = use(InspectorWidthUserContext);
const box = use(InspectorBoxContext);
const viewportWidth = useViewportWidth();
const stored = useSyncExternalStore(
  subscribeInspectorWidth,
  () => readInspectorWidth(userId),
  () => null,
);
const [preview, setPreview] = useState<number | null>(null);
const { mode, width, maxWidth } = inspectorPlacement({
  viewportWidth,
  frameWidth: box?.width ?? viewportWidth,
  preferred: stored ?? INSPECTOR_WIDTH.default,
});
// While a drag runs the card is drawn at the preview width; the width is saved once, on release
const drawn = preview === null ? width : fitInspectorWidth(preview, maxWidth);
const setWidth = (next: number | null): void => writeInspectorWidth(userId, next);

// The card covers the right side of the page: a bar of the list's actions keeps clear of where it begins
const setOverlay = use(InspectorOverlaySetterContext);
const overlayLeft = mode === 'overlay' && box === null ? viewportWidth - INSPECTOR_EDGE - drawn : null;
```

Keep the `setOverlay` effect, the focus-on-open effect and the Escape effect as they are. Stepping (replaces 141-150):

```tsx
// A step made from inside the card may remove the control that had focus: the title takes it then, so the
// next key still reaches the card
const steppedInside = useRef(false);
useEffect(() => {
  if (!steppedInside.current) return;
  steppedInside.current = false;
  if (document.activeElement === document.body) title.current?.focus({ preventScroll: true });
}, [header.title, header.positionText]);
// J and K work from the list or the inspector, not from elsewhere on the page (16 section 2.10)
const stepFromHere = (direction: 'next' | 'previous'): void => {
  const active = document.activeElement;
  const inside = active !== null && aside.current?.contains(active) === true;
  const inGrid = active !== null && active.closest('[role="grid"], [role="treegrid"]') !== null;
  if (!inside && !inGrid) return;
  steppedInside.current = inside;
  onStep?.(direction);
};
useShortcut('j', () => stepFromHere('next'), { kind: 'single-key', enabled: onStep !== undefined });
useShortcut('k', () => stepFromHere('previous'), { kind: 'single-key', enabled: onStep !== undefined });
// ArrowDown and ArrowUp step from inside the card, wherever no control uses them itself. They are not
// character keys and act only while the card has focus, so the single-key preference does not cover them
// (20-accessibility.md section 14)
const onArrowKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
  if (onStep === undefined || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
  if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  // A menu or dialog opened from the card is outside it in the page, and its keys still arrive here
  if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return;
  if (target.closest(ARROW_OWNERS) !== null || target.matches(SCROLL_AREAS)) return;
  if (document.querySelector(OPEN_POPUPS) !== null) return;
  event.preventDefault();
  steppedInside.current = true;
  onStep(event.key === 'ArrowDown' ? 'next' : 'previous');
};
```

Delete `widthOptions`, `checkedWidth` and `widthItems` (152-173). The header's `moreActions` becomes `hideMoreActions ? [] : (header.moreActions ?? [])`. The `aside`:

```tsx
// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The arrow keys step the record this landmark shows, as its Previous and Next buttons do
<aside
  ref={aside}
  id={asideId}
  aria-labelledby={titleId}
  data-inspector={type}
  style={{ width: drawn }}
  onKeyDown={onArrowKey}
  className={cn(
    FRAME,
    // Over the page, which stays usable and keeps its layout: no scrim. In a boxed preview, inside the box
    box === null ? 'fixed top-inspector-top right-3 bottom-3 z-(--z-drawer)' : 'absolute top-3 right-3 bottom-3 z-(--z-drawer)',
  )}
>
```

The children of the `aside` (content wrapper and `InspectorResizeHandle`) stay. Update the doc comments on `InspectorProps` (`backLabel`: below 900 px; `onStep`: J, K and the arrow keys; `hideMoreActions`: "Leaves out the More actions button even when the drawer passes actions. Default `false`.") and the component comment (overlay from 900 px, sheet below, one saved width).

- [ ] **Step 5: `inspector-resize-handle.tsx`.** Comments only: `onReset` is "Back to the default width", the component comment no longer mentions a reflow on release.

- [ ] **Step 6: `apply-preferences.tsx`.** Wrap the existing providers: `<InspectorWidthUserContext value={user.user_id}>` outermost, import from `@/lib/inspector/width-store`. Extend the doc comment with "and whose saved drawer width applies".

- [ ] **Step 7: Tokens.** `tokens.css`: `--size-inspector: 40rem; /* 640px default inspector drawer */`, `--size-inspector-min: 30rem; /* 480px */`, `--size-inspector-max: 60rem; /* 960px; never more than 60% of the viewport (lib/inspector/placement) */`; delete the `-wide`, `-docked` and `-docked-max` lines; `--z-inspector: 50; /* the maximised Internal links map: under the inspector drawer */`; `--z-drawer: 70; /* inspector drawer, sheets, navigation drawer */`. `globals.css`: delete lines 235, 237 and 238. `class-names.ts`: delete `'inspector-wide'`, `'inspector-docked'`, `'inspector-docked-max'`. `token-groups.ts:171-172`: `{ name: 'inspector', use: 'Maximised map panel, under the drawer' }`, `{ name: 'drawer', use: 'Inspector drawer, sheets, navigation drawer' }`. Then `grep -rn "inspector-wide\|inspector-docked" apps/web/src` must print nothing.

- [ ] **Step 8: Strings.** Delete `width`, `widthDefault`, `widthWide`, `widthMaximum`, `resetWidth` from the `inspector` block of `messages/en.json`. `grep -rn "widthDefault\|widthWide\|widthMaximum\|'resetWidth'\|t('width')" apps/web/src` must show only `dataTable` hits.

- [ ] **Step 9: Tests that stubbed docking.** `use-inspector-stepping.test.tsx:293-310` and `drawer-customizer.test.tsx:21-44`: remove the `AreaObserver` stub if the file passes without it (jsdom may still need a `ResizeObserver`; then keep a plain stub and rename it so it does not speak of an area). `drawer-customizer.test.tsx:167`: rename the test to say the customizer keeps its own box out of the layout, drop "docked" and "sticky" from the name and assert what still holds (`display: contents`). `rankings-harness.tsx`: keep `WideResizeObserver` (the table columns need it), correct the comments at 23 and near 101 so they no longer mention a docked inspector.

- [ ] **Step 10: Run.**

```bash
pnpm vitest run --maxWorkers=1 src/components/app/inspector/inspector.test.tsx src/components/app/inspector/use-inspector.test.tsx src/lib/inspector/placement.test.ts src/lib/inspector/width-store.test.tsx src/lib/inspector/use-inspector-stepping.test.tsx src/features/session/apply-preferences.test.tsx src/features/layouts/drawer/drawer-customizer.test.tsx src/lib/glossary/glossary-words.test.ts src/lib/utils.test.ts
pnpm vitest run --maxWorkers=1 src/components/app/data-table/data-table.test.tsx -t "inspector"
pnpm typecheck
pnpm lint
pnpm format:check
```

Then the consumers, so no screen is left red without anyone knowing: `grep -rlE "components/app/inspector|complementary" src --include="*.test.tsx"` lists them; run that list in one command with `--maxWorkers=1` (about 40 files, one run, not the full suite). A failure in a screen's file that comes from a docking assumption is not fixed here: record the file and test name in the handover for that screen's task (4 to 10). A failure caused by a defect in the shared component is fixed here.

Expected: all green in the first two commands. `pnpm typecheck` may still fail in `src/features/prompts/prompts-controls.tsx` only if an export it imports was removed; none is, so a failure there is a mistake in this task.

- [ ] **Step 11: Commit.** `git add` the files listed above, message `Inspector: always an overlay drawer, resizable, arrow keys step, one saved width`.

- [ ] **Step 12: Review.** Checklist plus: the props of `InspectorProps` are byte-for-byte the same names and types as before; `use-inspector.ts` is untouched; arrow stepping follows the six conditions of spec 4.4; the sheet path is unchanged except for the threshold; no `sticky`, `marginLeft`, `h-inspector-docked` or `z-(--z-inspector)` remains in `inspector.tsx`.

- [ ] **Step 13 (orchestrator, not a subagent): tell the sibling sessions.** Load `SendMessage` with ToolSearch and send this text to each of `local_a66f80e5-4bd6-4590-b723-952387339666` (Pages), `local_925dd015-c92a-4018-900f-2bb38649f61e` (Search Console and Monitoring) and `local_a12d6350-9d1a-4dbd-9104-5a5679461aa3` (Issues), with the commit hash filled in:

> The shared drawer is ready on branch `claude/shared-drawer-121ede`, commit `<hash>` (not yet on `develop`). Component: `Inspector` in `apps/web/src/components/app/inspector/inspector.tsx`, inside `InspectorLayout` (`inspector-layout.tsx`), with `useInspector` (`use-inspector.ts`, URL `?inspect=<type>:<id>&itab=`) and `useInspectorStepping` (`apps/web/src/lib/inspector/use-inspector-stepping.ts`). Props are unchanged: `type`, `header` (`title`, `typeLabel`, `typeNoun`, `positionText`, `freshness`, `badges`, `frequentAction`, `onOpenPage`, `navigation`, `moreActions`, `moreButtonRef`), `backLabel`, `onClose`, `onStep`, `hideMoreActions`, `footer`, `children`. What changed: it is always a non-modal overlay card (no docked mode), 640 px by default, user-resizable from 480 px to 60% of the viewport (960 px at most), one saved width for every drawer, a sheet below 900 px. The page behind never reflows, so do not rely on the table getting narrower and do not read `InspectorAreaContext` (removed). Pass `onStep` and you get J, K, ArrowUp and ArrowDown stepping. Pass `onOpenPage` only if your record has a full page. Mark the open row with `activeRowId` on `DataTable`. Spec: `docs/superpowers/specs/2026-11-26-shared-overlay-drawer-design.md` on that branch.

---

### Task 3: Docs, design-system previews, glossary check

Spec sections 4.9, 7, 11.

**Files:**
- Modify: every doc section listed in spec section 11 (17 files)
- Modify: `apps/web/src/components/design-system/inspector-section.tsx:58-59`, `:181`; `domains-feeds-section.tsx` (the `InspectorLayout` near line 505 and its note)
- Modify: `apps/web/src/features/layouts/drawer/drawer-customizer.tsx:28-31`, `apps/web/src/features/layouts/customize/customizable-screen.tsx:21-22`, `apps/web/src/features/layouts/customize-specimen.tsx:53`, `:71`

- [ ] **Step 1: Previews.** In both specimens pass `boxed` to `InspectorLayout`. Rewrite the note at `inspector-section.tsx:181`: the inspector lays over the list from 900 px, is a sheet below, resizes from its left edge between 480 px and 60% of the window, and steps with J, K and the arrow keys. In `customize-specimen.tsx` the hand-built card (`w-100`, line 71 comment) stays 400 px: change the comments so they do not claim it equals `INSPECTOR_WIDTH.default`, or switch the class to `w-inspector max-w-full` if the specimen still fits its frame at 640 px (check by reading the surrounding layout; prefer the comment fix when unsure). Correct the "docked" comments in `drawer-customizer.tsx` and `customizable-screen.tsx`: `box="contents"` keeps the customizer's wrapper out of the layout row.
- [ ] **Step 2: `docs/design-system/16-drawers-dialogs-popovers.md`.** Rewrite 2.2 (one default 640, min 480, max 60% and 960, the handle, one saved width under `idraft.pref.<userId>.inspector-width`, no menu items), 2.6 as "Overlay and sheet" with the geometry table of spec 4.1 and a two-row mode table (overlay, sheet below 900), 2.1 (container sentence without "docked"; "Open page" is a header icon button shown where a full page exists; width options removed), 2.8 (900), 2.10 (add the arrow rule of spec 4.4 in five lines), 1.1 width figures, 8, 9 (one row: the overlay inspector has no enter or exit motion today) and 10 (token values). Add an "As built (2026-11-26)" note that links to the spec.
- [ ] **Step 3: The other docs.** Sonnet rewrites the sections that state a rule: `05-layout-grid.md` section 6, `19-responsive-behavior.md` section 7, `21-motion.md` section 4.5 and `20-accessibility.md` line 144 and section 14. Haiku is enough for the rest, which are figure swaps. For each file and line of spec section 11, replace the docking statement or the 400, 440, 360 or 768 figure with the new rule. Use these fixed phrases so the docs agree: "640 px by default, 480 px to 60% of the viewport (960 px at most)", "lays over the page and never resizes it", "a full-width sheet below 900 px", "one saved width per user". In `20-accessibility.md` line 144 write what is true: the card never covers the first column; a focused cell under the card stays covered until the drawer is closed or narrowed. Add the row "ArrowDown, ArrowUp: next or previous record, when focus is in the inspector and no control there uses the arrows. Non-character keys. Cannot be turned off" to its section 14 table. In `25-component-inventory.md` add one deviation row for this change at the end of the deviation table and correct section 18.1's props (`mode: 'overlay' | 'sheet'`, no `widthPx` per type).
- [ ] **Step 4: Glossary.** No new string exists, so `docs/glossary/terms.md` is not edited. Confirm with `grep -n "docked\|Docked" apps/web/messages/en.json` (expect nothing) and run the glossary test.
- [ ] **Step 5: Run.** `pnpm vitest run --maxWorkers=1 src/lib/glossary/glossary-words.test.ts src/features/layouts/drawer/drawer-customizer.test.tsx`, scoped eslint and prettier on the changed `.tsx` files, and a dash check on the lines this task added: `git diff -U0 HEAD | LC_ALL=C grep -n $'^+.*\xe2\x80[\x93\x94]'` must print nothing.
- [ ] **Step 6: Commit.** Message `Design system: the inspector is an overlay drawer, docs and previews`.
- [ ] **Step 7: Review.** Checklist plus: `grep -rniE "dock" docs/design-system --include="*.md" -l` lists only `review-log.md` and lines that say the docked mode was removed; every figure matches spec sections 4.1 and 6; the previews render inside their boxes (read the class list; the visual check is task 12).

---

### Tasks 4 to 10: one screen each

Every screen task has the same shape. The steps below are written once; each task then lists its files, its own checks and its acceptance.

- [ ] **Step A: Read** the host and drawer files of the task and the spec rows for it (sections 3, 4.5, 4.6, 4.8, 8, 9).
- [ ] **Step B: Write failing tests first** for the task's listed behaviours, in the screen's existing test file, using its harness. Run that file and see the new tests fail (or, where the behaviour already holds, say so in the handover and keep the test as a regression test).
- [ ] **Step C: Fix** what the tests and the content check show. Remove comments and test names that speak of docking, 400 px or 440 px in the task's files.
- [ ] **Step D: Content at 640 and at 960.** Read every section component of the drawer for width assumptions: fixed `w-*` or `max-w-*` classes, numeric `width` props on charts, `grid-cols-*` chosen for a 400 px card, container queries whose first step is above 640 px, table column widths. Make each use the card's width (container queries on `InspectorSection`, `w-full`, `ChartFrame` width from its container). Record in the handover, per section, "fills at 640 and 960" or what was changed. The pixel check in a browser is task 12; this step is by reading and by unit test where a width is computed in code.
- [ ] **Step E: Run** the task's test files one worker, scoped eslint and prettier on changed files.
- [ ] **Step F: Commit** with the task's message.
- [ ] **Step G: Review** with the checklist plus the task's lines, and "the drawer's unsaved-edit, stepping, focus-return and URL behaviour is the same as before the task, shown by tests that were already there and still pass".

#### Task 4: Rankings, the keyword drawer

**Files:** `apps/web/src/features/rankings/rankings-screen.tsx` (470-500, 521, 769-826, 871, 1007-1008), `apps/web/src/features/rankings/keyword-inspector/*.tsx`, tests `rankings.test.tsx`, `keyword-inspector/keyword-inspector.test.tsx`.

**Failing tests first (in `rankings.test.tsx` unless noted):**
- `opens a keyword over the table without narrowing it`: after a row click the `complementary` exists with class `fixed`, and the grid's region keeps the inline width or class it had before the click.
- `swaps the drawer when another row is clicked, with one aside throughout`: keep a reference to the `complementary` element, click another row, the same element is still in the document with the new title, and the new row has `aria-current="true"`.
- `asks before a row click replaces a drawer with unsaved edits`: start an edit, click another row, the discard dialog opens and the drawer still shows the first keyword. (If an equal test exists, extend it to the row-click path.)
- `ArrowDown in the drawer goes to the next keyword and keeps "N of M"`: focus the title, ArrowDown, the context line reads the next position; through the guard when editing.
- `keyword-inspector.test.tsx`: `keeps Open page in the header`: the button named "Open page" is present.

**Content (step D):** `rank-history-section.tsx` (`useRankHistoryChart(..., { height: 180 })`, `ChartFrame` at 63-72): confirm the plot takes the frame's width and redraws on resize; if the chart caches a width, key it on the container width. `demand-section.tsx`, `links-section.tsx`, `competitors-section.tsx`, `history-section.tsx`, `tracking-section.tsx`: mini tables edge to edge, no fixed column sum of 360 px.

**Also:** `rankings-screen.tsx:521` selector `aside[aria-labelledby] h2` stays valid: leave it, add no new DOM query. Bulk bar: with a drawer open and rows selected, the bar keeps one row (existing `data-table.test.tsx` covers the padding; add nothing here).

**Run:** `pnpm vitest run --maxWorkers=1 src/features/rankings/rankings.test.tsx src/features/rankings/keyword-inspector/keyword-inspector.test.tsx`

**Commit:** `Keywords: the keyword drawer lays over the table and uses its width`

**Review adds:** every path that moves the drawer still goes through `guarded` (row click, step, Open page, Close, open group, `showKeyword`).

#### Task 5: Rankings, the group drawer

**Files:** `apps/web/src/features/rankings/grouped/group-inspector.tsx` (68), `grouped-view.tsx`, tests `grouped/group-inspector.test.tsx`, `grouped/grouped-view.test.tsx`, `grouped/group-actions.test.tsx`.

**Failing tests first:**
- `group-inspector.test.tsx`: `keeps its More menu with the group's own actions only`: the menu lists Add keywords, Rename group, Delete group and no width item.
- `grouped-view.test.tsx`: `keeps the group row marked while its drawer is open` (`aria-current` on the treegrid row) and `closing a deleted group's drawer does not add a history entry` (existing behaviour, keep green).
- `has no Open page button` (no full page for a group).

**Content:** the keyword list of the group uses the full width; `positionText` (a keyword count) stays.

**Run:** the three test files. **Commit:** `Keywords: the group drawer as an overlay`

#### Task 6: Topics and Prompts

**Files:** `apps/web/src/features/prompts/prompts-controls.tsx:1-31`, `prompts-screen.tsx` (620-711, 1299-1414), `prompt-inspector.tsx` (93, 121, 373, 402-423), `answer-inspector.tsx` (448-520), `topic-inspector.tsx` (143, 354), `topic-drawer/use-topic-header.tsx`, `prompt-drawer-host.tsx` (34-104), `inspector-*.tsx`, `add/use-add-form.ts:44-81`; tests `prompts.test.tsx`, `prompt-inspector.test.tsx`, `prompt-drawer-host.test.tsx`, `answer.test.tsx`, `topic-drawer.test.tsx`, `topic-drawer-wiring.test.tsx:399`, `add/submit-flow.test.tsx`.

**Failing tests first:**
- `prompts.test.tsx`: `keeps the control row at full width while a drawer is open`: wrap as the page does, open a prompt, the `[data-slot="prompts-controls"]` container's parent has no `margin-right` style.
- `prompt-inspector.test.tsx`: `opens the prompt's page from the header when it has one`: with `pageHref`, a button "Open page" exists and pushes the route; without `pageHref`, no such button.
- `prompt-drawer-host.test.tsx`: `offers Open page for a prompt opened on another screen`.
- `topic-drawer.test.tsx` and `answer.test.tsx`: `has no More button now that width is not a menu item`.
- `prompts.test.tsx`: `goes from a prompt to its topic and back with a drawer open throughout`: the prompt, answer and topic drawers are three components in one slot (`prompts-screen.tsx:1414`), so the `aside` remounts on a change of type; do not assert element identity. Assert what a person sees: after each swap there is one `complementary` named by the new title, that title has focus, and `inspect` was never absent from the URL (no close between them). And `ArrowDown steps through the topic's prompts when the prompt was opened from a topic`.
- `submit-flow.test.tsx` stays green unchanged (the `aside[aria-labelledby]` lookup).

**Implementation notes:**
- `prompts-controls.tsx`: delete the `InspectorOverlayContext` and `useViewportWidth` imports, the `overlayLeft`, `viewport` and `clear` lines and the `style={clear}` prop. Rewrite the doc comment: the row follows its own width through container queries; a drawer lays over its right end and the row does not change.
- `prompt-inspector.tsx`: the file has no router today. Add `const router = useRouter()` (`next/navigation`, as `rankings-screen.tsx` does for its `onOpenPage` at 796) and, in the header object, `onOpenPage: pageHref === undefined ? undefined : () => router.push(pageHref)`. Keep `compareHref={pageHref}`.
- `prompt-drawer-host.tsx`: it receives only `workspaceId`, `projectId` and `timeZone` (line 34). Add two required props, `workspaceSlug` and `projectSlug`, pass `pageHref={promptPath(workspaceSlug, projectSlug, target.id)}` (`promptPath` from `src/lib/routes/paths.ts:39`) to `PromptInspector`, and pass the slugs from its one composer, `src/app/[workspace]/[project]/ai/citations/citations-route.tsx:39`, which sits under both route params (read how it gets `workspaceId` and take the slugs the same way). Update `prompt-drawer-host.test.tsx` renders for the two props.
- `topic-drawer-wiring.test.tsx:399`: the comment "a docked drawer leaves with Close" becomes "the card leaves with Close".
- Correct the "440 px" comments at `prompt-inspector.tsx:97` and `topic-inspector.tsx:143`.

**Content:** `InspectorStrip`, `inspector-competitors.tsx` (table and its `SegmentedControl`), `inspector-stats.tsx` (`StatisticsPanel placement="inspector-tab"`), History chart, the answer text block and evidence side content, the topic's Overview cards and Prompts list. The tab row: with `overflowLabel`, more tabs fit at 640 px; assert in `prompt-inspector.test.tsx` only if the existing overflow test can be driven by a stubbed row width.

**Run:** the seven test files, then `pnpm typecheck && pnpm lint && pnpm format:check` (milestone). **Commit:** `Topics and Prompts: drawers as overlays, the control row stays put, Open page on a prompt`

**Review adds:** `PromptsControls` no longer imports anything from the inspector; the `eng` entry key behaviour on close is unchanged (tests in `use-inspector.test.tsx` and `topic-drawer-wiring.test.tsx` still pass).

#### Task 7: Citations

**Files:** `apps/web/src/features/citations/board-screen.tsx` (131-221, 344), `drawers/page-drawer.tsx` (97-131), `drawers/gap-drawer.tsx` (92-131), `drawers/drawer-parts.tsx`, `use-focus-return.ts`; tests `board-screen.test.tsx`, `drawers/page-drawer.test.tsx`, `drawers/gap-drawer.test.tsx`, `use-focus-return.test.tsx`.

**Failing tests first:**
- `board-screen.test.tsx`: `keeps one width when a cited page gives way to a prompt and to a gap prompt`: set `idraft.pref.<user>.inspector-width` to `720` through the harness's user, open a cited page, then "Open answers", the `complementary` width is `720px` both times (wrap in `InspectorWidthUserContext` if the harness has no session).
- `board-screen.test.tsx`: `ArrowDown inside the page drawer steps to the next cited page`, and `J from a row of the board does nothing` (documents the `BoardTable` limit; no fix).
- `page-drawer.test.tsx`, `gap-drawer.test.tsx`: the existing "no More button" tests stay green. Keep `hideMoreActions` on both drawers.
- `returns focus to the row's button on Escape` (existing `useFocusReturn` path, keep green).

**Content:** `DrawerCard`s and the drawer table in `drawer-parts.tsx`: columns share the card width, no leftover space at 960 px.

**Run:** the four test files. **Commit:** `Citations: the two drawers as overlays at the shared width`

#### Task 8: Internal links

**Files:** `apps/web/src/features/internal-links/internal-links-screen.tsx` (139-167, 356-392), `inspector/page-inspector.tsx` (116-126, 337-420), `inspector/neighbor-section.tsx`, `inspector/extras-sections.tsx`, `map/map-tab.tsx:258-266`, `:357`; tests `inspector/page-inspector.test.tsx`, `internal-links-screen.test.tsx`, `journey/journey-tab.test.tsx`, `map/map-tab.test.tsx`.

**Failing tests first:**
- `internal-links-screen.test.tsx`: `steps with ArrowDown and keeps focus in the drawer after the step` (the drawer is keyed by `urlId` at line 364 and remounts: after ArrowDown the new title has focus and a second ArrowDown steps again).
- `internal-links-screen.test.tsx`: `closing a drawer opened from a table returns focus to its row`.
- `journey-tab.test.tsx`: `closing a drawer opened from the journey list returns focus to the item that opened it`. If it fails, fix by reusing `src/features/citations/use-focus-return.ts` in the screen (move the hook to `src/lib/inspector/use-focus-return.ts` only if importing across features breaks the import rules; then update Citations' import in the same commit). Do the same for the Map card's "details" button.
- `map-tab.test.tsx`: `the maximised map stays under the drawer`: the maximised panel's class holds `z-(--z-inspector)` and the open drawer `z-(--z-drawer)`.
- `page-inspector.test.tsx`: `has no More button`, `keeps its footer with Copy URL, Visit and Open journey`.

**Implementation notes:** do not remove `key={inspected.urlId}` unless the focus test proves a defect that only removing it fixes. `map-tab.tsx:357` keeps the token; add a one-line comment that the map sits under the drawer on purpose.

**Content:** the two neighbour lists and long URLs use the width; the footer's three buttons fit one row at 480 px (the minimum) without wrapping.

**Run:** the four test files. **Commit:** `Internal links: the page drawer as an overlay, focus back to its opener`

#### Task 9: AI Overview competitor drawer, and the Competitors screen

**Files:** `apps/web/src/features/ai-overview/competitor-drawer/competitor-drawer-host.tsx` (19-74), `competitor-inspector.tsx` (43, 71-85, 99-188), `overview-tab.tsx`, `prompts-tab.tsx`, `sources-tab.tsx`, `drawer-card.tsx`; `apps/web/src/features/competitors/competitors-screen.tsx:302`; test `competitor-drawer.test.tsx`.

**Failing tests first:**
- `opens over the cards without changing their layout`: the card grid's container keeps its class and has no inline width after the drawer opens.
- `ArrowDown wraps from the last competitor to the first` (its own wrap-around `step`), and `the arrows do not step inside the Prompts tab's segmented control`.
- `has no More button`, `returns focus to the card that opened it on Escape` (existing, keep green).

**Implementation notes:** `competitors-screen.tsx:302` keeps `InspectorLayout inspector={null}`; add a one-line comment: the page column's wrapper, no drawer on this page. Correct the "440 px" comment at `competitor-inspector.tsx:43`.

**Content:** the trend chart and both tables fill the width.

**Run:** `pnpm vitest run --maxWorkers=1 src/features/ai-overview/competitor-drawer/competitor-drawer.test.tsx`. **Commit:** `AI Overview: the competitor drawer as an overlay`

#### Task 10: Operations, the run drawer

**Files:** `apps/web/src/features/operations/runs-screen.tsx` (213-238, 311-341, 445-446), `run-inspector.tsx` (113-135), `ai-run-coverage.tsx`; tests `runs.test.tsx`, `ai-run-coverage.test.tsx`.

**Failing tests first:**
- `has no More button` (its `moreActions: []` and no width items).
- `opens a run over the table without narrowing it` and `ArrowDown steps to the next run and keeps "N of M"`.
- `choosing another month closes the drawer in the same URL write` (existing, keep green).

**Content:** Summary key values (`KeyValues`) and the coverage card fill the width; two columns of key values from the container query where `InspectorSection` allows it, never a fixed 360 px block.

**Run:** the two test files, then `pnpm typecheck && pnpm lint && pnpm format:check` (milestone). **Commit:** `Operations: the run drawer as an overlay`

---

### Task 11: Cross-cutting cleanup

- [ ] **Step 1: Dead code and words.** Each grep must come back empty or with hits explained in the handover:

```bash
grep -rnE "InspectorAreaContext|defaultInspectorWidth|WIDE_TYPES|MIN_MAIN_COLUMN|OVERLAY_GUTTER|inspector-wide|inspector-docked|h-inspector-docked|INSPECTOR_WIDTH\.wide" apps/web/src apps/web/e2e
grep -rniE "docked|docks |beside the (table|list)" apps/web/src apps/web/e2e --include="*.ts" --include="*.tsx"
grep -rnE "inspector\.(width|widthDefault|widthWide|widthMaximum|resetWidth)" apps/web/src apps/web/messages
grep -rnE "inspector-width:" apps/web/src apps/web/e2e
grep -rnE "(400|440|360) px" apps/web/src/features apps/web/src/components/app/inspector
```

The second grep's hits in comments and test names are rewritten (`page-header.tsx:102`, `e2e/support/runs-costs.ts:145`, `e2e/support/ai-citations.ts:43-45`, `e2e/flows/internal-links.spec.ts:111`, `e2e/visual/pages.spec.ts:36-44`). The one allowed `inspector-width:` hit is the legacy removal in `width-store.ts` and its test.
- [ ] **Step 2: e2e that assumed a mode.** Read, do not run: `e2e/flows/rankings.spec.ts:623-660` (bulk bar at 1280): it already describes the overlay; update its numbers only if it asserts a 400 px card. Any spec that opens a drawer at a viewport from 768 to 899 px now gets the sheet: `grep -rnE "width: (7[6-9][0-9]|8[0-9][0-9])" apps/web/e2e` and check each hit opens no drawer (today: `ai-controls.spec.ts:184` and `ai-layouts-core.spec.ts:410`, neither does). List the visual shots that will differ (`e2e/visual/pages.spec.ts`: every shot with an open drawer) in the handover for the owner; do not regenerate baselines.
- [ ] **Step 2b: e2e clicks under the card.** The card now covers the right 640 px under the top bar at 1440 (x 788 to 1428), where a docked card left everything clickable. Read every spec and support file that opens a drawer (`grep -rlE "complementary|inspect=" apps/web/e2e`) and list each action taken while a drawer is open on a row menu, a right-hand column, a page header action or the Prompts control row. Fix a hit only when the fix is to close the drawer first or to click the first column; list the rest for the owner with file and line. e2e does not run in the worktree.
- [ ] **Step 2c: Every consumer test once more.** Re-run the list of task 2 step 10 (`grep -rlE "components/app/inspector|complementary" src --include="*.test.tsx"`) in one command on one worker. Expected: all green now that every screen task is done.
- [ ] **Step 3: `role=complementary` queries.** `grep -rln "complementary" apps/web/src apps/web/e2e | wc -l` now, against `git grep -l complementary eba2a5ea -- apps/web/src apps/web/e2e | wc -l` for the commit the branch started from. The count must not drop.
- [ ] **Step 4: Unused exports.** `useViewportWidth` and `InspectorOverlayContext` must each still have a consumer outside `inspector.tsx`; `InspectorOverlayContext` has the bulk bar. If `useViewportWidth` is now used only by `inspector.tsx`, stop exporting it.
- [ ] **Step 5: Run.** `pnpm vitest run --maxWorkers=1 src/components/app/inspector/inspector.test.tsx src/components/app/shell/page-header.test.tsx` (the second only if it exists), then `pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 6: Commit.** `Inspector: remove what only docking needed`
- [ ] **Step 7: Review.** Checklist plus: every grep of step 1 re-run by the reviewer.

---

### Task 12: Visual verification and the final checks

No code is planned here; defects found go back as fix commits with a test.

- [ ] **Step 1: Server.** Follow the owner's dev server policy: first `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'` and reuse a server only if its working directory is this worktree. Otherwise start the mock app with the preview tool, configuration `web-mock` of `.claude/launch.json` (`NEXT_PUBLIC_API_MOCKING=all`, port 3000). If port 3000 is taken, never kill the process: start the same command on a free port (`pnpm --dir apps/web dev --port 3003` with `NEXT_PUBLIC_API_MOCKING=all`) and do not commit a launch.json change. Sign in with the mock user the e2e support files use (`apps/web/e2e/support`); never type real credentials.
- [ ] **Step 2: The matrix.** With the browser pane, at 1280 x 720 and 1537 x 864, light and dark (`resize_window` with `colorScheme`), on each screen (Keywords list and By group, Topics and Prompts both tabs, Citations both tabs, Internal links Pages, Journey and Map, AI Overview, Operations runs) and on `/design-system/inspector`:

| Check | Pass when |
|---|---|
| No reflow | A screenshot before and after opening shows the table columns, cards and page header at the same x positions; `window.scrollY` and the grid's `scrollTop` are unchanged |
| First column | The open row is highlighted and at least 232 px of its first data column is visible at the maximum width (measure the card's `getBoundingClientRect().left` against the first cell's left: 628 and 500 at 1280, 885 and 605 at 1537) |
| Swap and step | Clicking another row, Next, J and ArrowDown change the title and "N of M" in the same card; Escape closes and focus returns to the row |
| Resize | Drag to the minimum and maximum; double click resets to 640; the keyboard on the handle works; reload keeps the width; another screen's drawer opens at the same width; `localStorage` holds one `idraft.pref.<id>.inspector-width` key and no `inspector-width:` key |
| Clamp | Save the maximum at 1537, resize the window to 1280: the card is 768 px and the stored value is unchanged; back at 1537 it is 920 px again |
| Sheet | At 899 px wide the drawer is a full-width sheet with a Back button and no handle; at 900 px it is a card |
| Content | Each drawer at 640 px and at its widest: the checks of spec section 8 |
| Page under the card | Bulk bar with rows selected keeps one row and shows the count, Clear and More, also in the worst case (1280 wide, drawer at its 768 px maximum, a 272 px strip); the Prompts control row does not move when a drawer opens |
| Previews | The design-system specimens keep the card inside their box |
| Maximised map | With the Internal links map maximised, the drawer opens above it |

Record a pass or fail per cell in the handover. Not verifiable here, say so plainly: real data volumes (10,000 rows), screens whose mock handlers return no rows, the sibling sessions' new drawers, toast overlap with the edit footer, and the visual regression baselines.
- [ ] **Step 3: Stop the server** and confirm with `lsof` that nothing of this worktree listens.
- [ ] **Step 4: Final checks, once.** From `apps/web`: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`. Then the drawer-related test files of tasks 1 to 10 once more, one worker, in one command. No full `pnpm test`: the full run happens in the main checkout on `develop` after the merge.
- [ ] **Step 5: Free the space.** Delete `apps/web/.next` and any screenshots or temp files this task made. Leave `node_modules` if the branch still needs work; delete it otherwise. The worktree itself is removed after the merge by the session that created it, with `git worktree remove` and no `--force`.
- [ ] **Step 6: Commit** any fix as `Inspector: <what the check found>`, and hand over: the matrix, the checks run with their results, the list of visual baselines to regenerate, and what was not verified.
- [ ] **Step 7: Review.** Checklist plus: the matrix has no empty cell; every "fail" has a fix commit with a test or an explicit note for the owner.

---

## Risks

1. Tasks 1 and 2 are one unit. Between them the component does not compile; nothing is pushed in that state.
2. Sibling sessions build drawers while this lands. Props do not change; the message in task 2 step 13 tells them the one thing to stop relying on.
3. ArrowUp and ArrowDown now step from a focused button or the title in a drawer and no longer scroll it. The focusable body region and PageUp, PageDown, Space keep scrolling. If the owner rejects this trade, delete the `onKeyDown` on the `aside` and its tests; nothing else depends on it.
4. A drawer with unsaved edits sits over a fully interactive table. Task 4's review re-checks every guarded path.
5. Page header actions on the right are covered while a drawer is open, at every width. Accepted in the spec.
6. The `urlId` key on the Internal links drawer remounts it on each step. Task 8 tests that stepping survives.
7. The boxed preview is the only user of the layout's `ResizeObserver`; a preview narrower than 800 px shows the card at its 480 px minimum over most of the box.
8. Visual baselines for every shot with an open drawer change. They are regenerated in the release flow, not here.
9. A global git hook path is configured on this machine. If it runs checks that fail on task 1 alone, tasks 1 and 2 share one commit.

## Left docked and why

Nothing. Checked against the inventory: the map selection card (`src/features/internal-links/map/map-card.tsx:43`) is placed inside the map canvas, and `StatisticsPanel` renders inside the prompt drawer's Stats tab. Neither is a docked right panel, and neither changes.

## Self-review

- Spec coverage: placement and geometry (task 1, 2, 12), resize (2, 12), persistence (1, 2), keyboard and focus (2, 4 to 10), header and More (2, 5, 6, 8 to 10), URL state (untouched, regression tests in 4 to 10), page under the card (6, 12), boxed previews (2, 3, 12), tokens and strings (2), content width (4 to 10, 12), docs (3), cleanup (11).
- Names used across tasks: `inspectorMaxWidth`, `inspectorPlacement({ viewportWidth, frameWidth, preferred })`, `INSPECTOR_WIDTH`, `SHEET_BELOW`, `readInspectorWidth(userId)`, `writeInspectorWidth(userId, width)`, `InspectorWidthUserContext`, `InspectorBoxContext`, `InspectorLayout boxed`, `data-inspector`.
