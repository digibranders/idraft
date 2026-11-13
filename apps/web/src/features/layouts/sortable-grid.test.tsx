import type * as DndKit from '@dnd-kit/core';
import type { Active, DragOverEvent, DragOverlayProps, Over } from '@dnd-kit/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAP_PREFIX, useDragAnnouncements, type DragAnnouncements } from './dnd';
import { LayoutGrid } from './layout-grid';
import { LayoutProvider, useLayoutScreen, type LayoutContextValue } from './layout-provider';
import { defineCards } from './registry';
import { MEDIUM_MEDIA } from './use-breakpoint';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { MEDIA } from '@/lib/dom/use-media-query';
import type * as LayoutsModule from '@/lib/layouts';
import {
  SCREENS,
  packRows,
  type Breakpoint,
  type Capabilities,
  type CardItem,
  type LayoutDocument,
} from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** What the overlay was given for `dropAnimation`, render by render. */
const overlay = vi.hoisted(() => ({ dropAnimations: new Array<unknown>() }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof DndKit>();
  const { createElement } = await import('react');
  return {
    ...original,
    DragOverlay: (props: DragOverlayProps): ReactElement => {
      overlay.dropAnimations.push(props.dropAnimation);
      return createElement(original.DragOverlay, props);
    },
  };
});

/** Card types a test takes the permission of: the person may not see them, so they are not shown but stay in the document. */
const restricted = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock('@/lib/layouts', async (importOriginal) => {
  const original = await importOriginal<typeof LayoutsModule>();
  return {
    ...original,
    cardType: (key: string) => {
      const type = original.cardType(key);
      return type !== undefined && restricted.keys.has(key) ? { ...type, permission: 'costs:read' } : type;
    },
  };
});

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const READ = mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`);
const BUILTIN = SCREENS.overview.builtin;
const BUILTIN_CARDS = BUILTIN.cards ?? [];
const BUILTIN_IDS = BUILTIN_CARDS.map((card) => card.id);
const CAPABILITIES: Capabilities = { channels: ['seo', 'ai'], permissions: [], integrations: [] };
const REGISTRY = defineCards({});

/** Row 1 is two thirds and has room for a third, row 2 is full: at wide the first row has a gap of 4 columns. */
const GAP_DOCUMENT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [
    { id: 'a', type: 'seo.rank_distribution', width: 'third' },
    { id: 'b', type: 'seo.top_movers', width: 'third' },
    { id: 'c', type: 'cross.matrix_summary', width: 'half' },
    { id: 'd', type: 'cross.unclassified', width: 'half' },
    { id: 'e', type: 'trend.visibility_mentions', width: 'full' },
  ],
};

function serve(document: LayoutDocument | null = null): void {
  server.use(
    http.get(READ, () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: document === null ? 'builtin' : 'personal',
            document,
            team_default_exists: false,
            team_document: null,
            updated_at: document === null ? null : '2026-11-10T09:12:44Z',
            updated_by:
              document === null ? null : { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' },
          },
        },
        { headers: { etag: '"e1"' } },
      ),
    ),
  );
}

function CustomizeButton(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

let latest: LayoutContextValue | null = null;
function Spy(): null {
  const value = useLayoutScreen();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const actions = (): LayoutContextValue['actions'] => {
  if (latest === null) throw new Error('the spy has not rendered');
  return latest.actions;
};
const orderOf = (): string[] => (latest?.document.cards ?? []).map((card) => card.id);

// --- the media the page is in ----------------------------------------------------------------------------------

const media: { breakpoint: Breakpoint; reduced: boolean } = { breakpoint: 'wide', reduced: false };
function stubMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === MEDIA.xl
        ? media.breakpoint === 'wide'
        : query === MEDIUM_MEDIA
          ? media.breakpoint !== 'narrow'
          : query === '(prefers-reduced-motion: reduce)'
            ? media.reduced
            : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

// --- layout: jsdom has none, so the boxes of the cards and the row gaps are laid out here -------------------------

/** Twelve columns of 70 px and eleven gaps of 16: whole pixels, and inside jsdom's 1024 px window. */
const GRID_WIDTH = 1016;
const COLUMN_GAP = 16;
const ROW_HEIGHT = 100;
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
const rights = (box: Box): number => box.left + box.width;
const centreOf = (box: Box): { x: number; y: number } => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/** The boxes of the cards (by id) and of the row gaps (`gap:<row>`), packed as the page packs them. */
function boxesOf(cards: readonly CardItem[], breakpoint: Breakpoint): Map<string, Box> {
  const column = (GRID_WIDTH - 11 * COLUMN_GAP) / 12;
  const span = (columns: number): number => columns * column + (columns - 1) * COLUMN_GAP;
  const boxes = new Map<string, Box>();
  const rows = packRows(cards, breakpoint);
  rows.forEach((row, index) => {
    const top = index * (ROW_HEIGHT + COLUMN_GAP);
    let used = 0;
    for (const placed of row) {
      boxes.set(placed.id, { left: used * (column + COLUMN_GAP), top, width: span(placed.span), height: ROW_HEIGHT });
      used += placed.span;
    }
    if (index < rows.length - 1 && used < 12) {
      boxes.set(`${GAP_PREFIX}${String(index)}`, {
        left: used * (column + COLUMN_GAP),
        top,
        width: span(12 - used),
        height: ROW_HEIGHT,
      });
    }
  });
  return boxes;
}

/** The laid out boxes, and the card being dragged (the overlay that follows the pointer is as big as it). */
const placed: { boxes: Map<string, Box>; dragging: string | null } = { boxes: new Map(), dragging: null };
const ZERO: Box = { left: 0, top: 0, width: 0, height: 0 };
function domRect({ left, top, width, height }: Box): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

/**
 * Gives every card frame and every row gap the box `boxesOf` laid out for it, and the drag overlay (which dnd-kit
 * measures, and which a browser sizes like the dragged card) the box of the dragged card; everything else stays empty.
 */
function stubCardRects(cards: readonly CardItem[], breakpoint: Breakpoint = 'wide'): void {
  placed.boxes = boxesOf(cards, breakpoint);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.getAttribute('data-layout-gap');
    const overlay = this.getAttribute('data-slot') === 'layout-drag-overlay';
    const key =
      this.getAttribute('data-layout-card') ??
      (row === null ? (overlay ? placed.dragging : null) : `${GAP_PREFIX}${row}`);
    return domRect((key === null ? undefined : placed.boxes.get(key)) ?? ZERO);
  });
}
const boxOf = (id: string): Box => {
  const box = placed.boxes.get(id);
  if (box === undefined) throw new Error(`no box for ${id}`);
  return box;
};

// --- the page --------------------------------------------------------------------------------------------------

interface MountOptions {
  /** Something else on the page, such as a shortcut. */
  extra?: ReactNode;
  columns?: 'grid' | 'one';
}

function mount({ extra, columns }: MountOptions = {}): ProvidedRender {
  latest = null;
  const view = renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider screen="overview" workspaceId={WORKSPACE} capabilities={CAPABILITIES} registry={REGISTRY}>
        <CustomizeButton />
        <Spy />
        {extra}
        <LayoutGrid label="Overview cards" columns={columns} />
      </LayoutProvider>
    </PermissionProvider>,
  );
  watchPoliteRegion();
  return view;
}

async function customize(view: ProvidedRender, layout: LayoutDocument | null = null): Promise<void> {
  const button = screen.getByRole('button', { name: 'Customize' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await view.user.click(button);
  await waitFor(() => {
    expect(latest?.mode).toBe('customize');
  });
  const cards = layout?.cards ?? BUILTIN_CARDS;
  stubCardRects(cards, media.breakpoint);
  // The page's own gap between the cells, which jsdom has no stylesheet to give the grid
  const grid = frameOf(cards[0]?.id ?? '').parentElement;
  if (grid !== null) grid.style.columnGap = `${String(COLUMN_GAP)}px`;
}

const frameOf = (id: string): HTMLElement => {
  const frame = document.querySelector<HTMLElement>(`[data-layout-card="${id}"]`);
  if (frame === null) throw new Error(`no frame for ${id}`);
  return frame;
};
const handleOf = (id: string): HTMLElement => {
  const handle = frameOf(id).querySelector<HTMLElement>('[data-part="handle"]');
  if (handle === null) throw new Error(`no handle for ${id}`);
  return handle;
};
/**
 * What the polite region said, in order. The region empties itself a second after a message, and a slow render can
 * outlast that, so a test reads what was said and not what is there now. One entry per change a screen reader would
 * see: two messages written in the same task are one entry, the last.
 */
const said: string[] = [];
let watcher: MutationObserver | null = null;
function watchPoliteRegion(): void {
  said.length = 0;
  const region = document.getElementById('live-region-polite');
  if (region === null) throw new Error('the polite region is not rendered');
  watcher = new MutationObserver(() => {
    if (region.textContent !== '') said.push(region.textContent);
  });
  watcher.observe(region, { childList: true, characterData: true, subtree: true });
}
/** The latest thing said. */
const polite = (): string => said.at(-1) ?? '';
const dndRegion = (): string => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
const dropLine = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="layout-drop-line"]');
const dragOverlay = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="layout-drag-overlay"]');

/** Picks the card up with the keyboard, the way a person does. */
async function pickUp(view: ProvidedRender, id: string): Promise<void> {
  placed.dragging = id;
  act(() => {
    handleOf(id).focus();
  });
  await view.user.keyboard(' ');
  await waitFor(() => {
    expect(handleOf(id)).toHaveAttribute('aria-pressed', 'true');
  });
}

// --- the pointer: mouse events, because the mouse sensor reads those -----------------------------------------------

const START = { x: 40, y: 10 };
/** Where the handle of a card is: its top left corner, which is where a pointer takes the card from. */
const handleSpot = (id: string): { x: number; y: number } => ({ x: boxOf(id).left + 10, y: boxOf(id).top + 10 });
/** Presses on the handle of a card, where it is; nothing is dragged yet. */
function pressOn(id: string): void {
  placed.dragging = id;
  const at = handleSpot(id);
  fireEvent.mouseDown(handleOf(id), { button: 0, clientX: at.x, clientY: at.y });
}
const moveTo = (point: { x: number; y: number }): void => {
  fireEvent.mouseMove(document, { clientX: point.x, clientY: point.y });
};
/** Takes the card by its handle and moves the pointer to `point` (two moves: the first one only starts the drag). */
function dragTo(id: string, point: { x: number; y: number }): void {
  pressOn(id);
  moveTo(point);
  moveTo(point);
}
const release = (point: { x: number; y: number }): void => {
  fireEvent.mouseUp(document, { clientX: point.x, clientY: point.y });
};
/** A point in the right half of a card, and in its left half. */
const rightHalf = (id: string): { x: number; y: number } => ({
  x: centreOf(boxOf(id)).x + 20,
  y: centreOf(boxOf(id)).y,
});
const leftHalf = (id: string): { x: number; y: number } => ({
  x: centreOf(boxOf(id)).x - 20,
  y: centreOf(boxOf(id)).y,
});

// --- touch: a real TouchEvent, with the touches jsdom cannot be given by init -------------------------------------

function touch(type: 'touchstart' | 'touchmove' | 'touchend', target: Element, at: { x: number; y: number }): void {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true });
  const point = { clientX: at.x, clientY: at.y };
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [point] });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  fireEvent(target, event);
}

beforeEach(() => {
  media.breakpoint = 'wide';
  media.reduced = false;
  overlay.dropAnimations.length = 0;
  stubMedia();
});
afterEach(async () => {
  // A drag that a failed test left going keeps its listeners on the document: end it
  fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
  // a timer dnd-kit set on the fake clock (the click blocker's removal) must run before the real clock is back
  if (vi.isFakeTimers()) vi.advanceTimersByTime(100);
  vi.useRealTimers();
  // dnd-kit takes its click blocker off the document 50 ms after a drag, and the next test clicks
  await new Promise((resolve) => setTimeout(resolve, 60));
  watcher?.disconnect();
  placed.dragging = null;
  restricted.keys.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the drag handle', () => {
  it('is a button named for the card, described by the keyboard instructions, with a tooltip of its own', async () => {
    serve();
    const view = mount();
    await customize(view);
    const handle = screen.getByRole('button', { name: 'Reorder Rank distribution' });
    expect(handle).toBe(handleOf('rank-distribution'));
    expect(handle).toHaveAttribute('data-part', 'handle');
    expect(handle).toHaveAttribute('aria-pressed', 'false');
    expect(handle).toHaveAccessibleDescription(
      'Press Space or Enter to pick up the card. Use the arrow keys to move it, Home and End to move it to the start or the end, Space or Enter to drop it, Escape to put it back.',
    );
    expect(handle).toHaveClass('touch-none', 'cursor-grab', 'size-control-sm', 'pointer-coarse:size-control-touch');
    await view.user.hover(handle);
    expect(await screen.findByText('Drag to reorder')).toBeInTheDocument();
  });

  it('is in every frame, inside the card group, and the toolbar still has the card tools', async () => {
    serve();
    const view = mount();
    await customize(view);
    expect(screen.getAllByRole('button', { name: /^Reorder / })).toHaveLength(BUILTIN_CARDS.length);
    expect(frameOf('trend').querySelector('[role="group"] [data-part="handle"]')).not.toBeNull();
  });
});

describe('moving a card with the keyboard', () => {
  it('says it is picked up, names each place as the arrow keys go, and drops it where it is', async () => {
    serve();
    const view = mount();
    await customize(view);

    await pickUp(view, 'rank-distribution');
    expect(polite()).toContain('Rank distribution picked up. Use the arrow keys to move, Space to drop');
    expect(frameOf('rank-distribution')).toHaveClass('ring-2', 'ring-primary');

    // down from a card in column 9 of row 1 is the nearest start column of row 2
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 4 of 8, row 2');
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);

    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution dropped at position 4 of 8');
    });
    expect(orderOf()).toEqual(['trend', 'matrix', 'unclassified', 'rank-distribution', ...BUILTIN_IDS.slice(4)]);
    expect(handleOf('rank-distribution')).toHaveAttribute('aria-pressed', 'false');
    expect(frameOf('rank-distribution')).not.toHaveClass('ring-2');
    // the next move starts from where the card is
    await waitFor(() => {
      expect(handleOf('rank-distribution')).toHaveFocus();
    });
    // dnd-kit's own live region never said a word
    expect(dndRegion()).toBe('');
  });

  it('says so at either end: already first and already last', async () => {
    serve();
    const view = mount();
    await customize(view);
    await pickUp(view, 'trend');
    await view.user.keyboard('{ArrowLeft}');
    await waitFor(() => {
      expect(polite()).toBe('Visibility and mention rate is already first');
    });
    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(handleOf('trend')).toHaveAttribute('aria-pressed', 'false');
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);

    await pickUp(view, 'competitors');
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(polite()).toBe('Competitors is already last');
    });
    expect(dndRegion()).toBe('');
  });

  it('puts the card back with Escape, without leaving customize mode', async () => {
    serve();
    const view = mount();
    await customize(view);
    const seen: boolean[] = [];
    const listener = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') seen.push(event.defaultPrevented);
    };
    window.addEventListener('keydown', listener);
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 3 of 8, row 2');
    });
    // The handle has focus, so its tooltip is open: it must not be the one to take the Escape
    await view.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution put back');
    });
    window.removeEventListener('keydown', listener);
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(latest?.mode).toBe('customize');
    expect(latest?.canUndo).toBe(false);
    // dnd-kit handles Escape, so a shortcut that leaves the mode (it skips a prevented key) does not
    expect(seen).toEqual([true]);
    expect(handleOf('rank-distribution')).toHaveAttribute('aria-pressed', 'false');
    expect(dndRegion()).toBe('');
  });

  it('drops the card where it is when Tab is pressed', async () => {
    serve();
    const view = mount();
    await customize(view);
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowRight}');
    await view.user.keyboard('{Tab}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution dropped at position 3 of 8');
    });
    expect(orderOf()).toEqual(['trend', 'matrix', 'rank-distribution', ...BUILTIN_IDS.slice(3)]);
    expect(handleOf('rank-distribution')).toHaveAttribute('aria-pressed', 'false');
  });

  it('goes to the start with Home and to the end with End', async () => {
    serve();
    const view = mount();
    await customize(view);
    await pickUp(view, 'key-changes');
    await view.user.keyboard('{Home}');
    await waitFor(() => {
      expect(polite()).toBe('Key changes, position 1 of 8, row 1');
    });
    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(polite()).toBe('Key changes dropped at position 1 of 8');
    });
    expect(orderOf()[0]).toBe('key-changes');

    await pickUp(view, 'matrix');
    await view.user.keyboard('{End}');
    await waitFor(() => {
      // key changes now leads the page, so the last card is in the fifth row
      expect(polite()).toBe('SEO and AI matrix, position 8 of 8, row 5');
    });
    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(polite()).toBe('SEO and AI matrix dropped at position 8 of 8');
    });
    expect(orderOf().at(-1)).toBe('matrix');
  });

  it('keeps going from the card it is over, not from the place it was picked up', async () => {
    serve();
    const view = mount();
    await customize(view);
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 3 of 8, row 2');
    });
    await view.user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 4 of 8, row 2');
    });
    await view.user.keyboard('{ArrowLeft}{ArrowLeft}');
    await waitFor(() => {
      // back on the card it started on: its own place
      expect(polite()).toBe('Rank distribution, position 2 of 8, row 1');
    });
    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution put back');
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);
  });

  it('is one step in the undo history: one undo takes one drop back', async () => {
    serve();
    const view = mount();
    await customize(view);
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowDown}');
    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(orderOf()[3]).toBe('rank-distribution');
    });
    expect(latest?.canUndo).toBe(true);
    act(() => {
      actions().undo();
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(latest?.canUndo).toBe(false);
    expect(latest?.canRedo).toBe(true);
  });

  it('has no accessibility violations with a card picked up', async () => {
    serve();
    const view = mount();
    await customize(view);
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowDown}');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

/** WP-16's way of leaving customize mode: Escape through `useShortcut`, which skips a key that was handled. */
function DismissProbe({ onDismiss }: { onDismiss: () => void }): null {
  useShortcut('Escape', onDismiss, { kind: 'dismiss' });
  return null;
}

describe('Escape while a card is held', () => {
  it('belongs to the drag: a shortcut that leaves the mode does not run, and does when no card is held', async () => {
    serve();
    const onDismiss = vi.fn();
    const view = mount({ extra: <DismissProbe onDismiss={onDismiss} /> });
    await customize(view);
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowRight}');
    await view.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution put back');
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(latest?.mode).toBe('customize');

    // the same key with nothing held is the shortcut's again
    fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('belongs to the drag when the card is held by the pointer too', async () => {
    serve();
    const onDismiss = vi.fn();
    const view = mount({ extra: <DismissProbe onDismiss={onDismiss} /> });
    await customize(view);
    dragTo('rank-distribution', rightHalf('unclassified'));
    await waitFor(() => {
      expect(dragOverlay()).not.toBeNull();
    });
    fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution put back');
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('a card among cards the person may not see', () => {
  it('lands at its place in the whole document, not at its index among the cards shown', async () => {
    restricted.keys.add('cross.unclassified');
    serve();
    const view = mount();
    await customize(view, { schema: 1, cards: BUILTIN_CARDS.filter((card) => card.id !== 'unclassified') });
    expect(document.querySelector('[data-layout-card="unclassified"]')).toBeNull();
    await pickUp(view, 'rank-distribution');
    await view.user.keyboard('{ArrowRight}');
    await view.user.keyboard(' ');
    // after the matrix, so before key changes: past the card nobody sees, which sits between them
    await waitFor(() => {
      expect(orderOf()).toEqual(['trend', 'matrix', 'unclassified', 'rank-distribution', ...BUILTIN_IDS.slice(4)]);
    });
    expect(polite()).toBe('Rank distribution dropped at position 3 of 7');
  });
});

describe('one column (columns="one")', () => {
  it('has no row gaps', async () => {
    serve(GAP_DOCUMENT);
    const view = mount({ columns: 'one' });
    await customize(view, GAP_DOCUMENT);
    expect(document.querySelectorAll('[data-layout-gap]')).toHaveLength(0);
  });

  it('moves down to the next card and up to the previous one, whatever the widths are', async () => {
    serve(GAP_DOCUMENT);
    const view = mount({ columns: 'one' });
    await customize(view, GAP_DOCUMENT);
    stubCardRects(GAP_DOCUMENT.cards ?? [], 'narrow');
    await pickUp(view, 'a');
    // at wide this key goes to card c, in the row below
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 2 of 5, row 2');
    });
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 3 of 5, row 3');
    });
    await view.user.keyboard('{ArrowUp}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 2 of 5, row 2');
    });
    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(orderOf()).toEqual(['b', 'a', 'c', 'd', 'e']);
    });
  });

  it('still moves by the rows of the grid when it is not one column', async () => {
    serve(GAP_DOCUMENT);
    const view = mount();
    await customize(view, GAP_DOCUMENT);
    await pickUp(view, 'a');
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 3 of 5, row 2');
    });
  });
});

describe('moving a card with the pointer', () => {
  it('starts nothing for a move of 3 px', async () => {
    serve();
    const view = mount();
    await customize(view);
    const heard = said.length;
    fireEvent.mouseDown(handleOf('rank-distribution'), { button: 0, clientX: START.x, clientY: START.y });
    fireEvent.mouseMove(document, { clientX: START.x + 3, clientY: START.y });
    expect(dragOverlay()).toBeNull();
    expect(dropLine()).toBeNull();
    expect(frameOf('rank-distribution')).not.toHaveClass('opacity-50');
    fireEvent.mouseUp(document, { clientX: START.x + 3, clientY: START.y });
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(said).toHaveLength(heard);
  });

  it('shows the card at half opacity, a copy with its name and the shadow, and a 2 px line at the place the drop would take', async () => {
    serve();
    const view = mount();
    await customize(view);
    const heard = said.length;
    dragTo('rank-distribution', rightHalf('unclassified'));
    await waitFor(() => {
      expect(dropLine()).not.toBeNull();
    });
    expect(frameOf('rank-distribution')).toHaveClass('opacity-50');
    expect(frameOf('rank-distribution')).not.toHaveClass('ring-2');
    const copy = dragOverlay()?.querySelector('[data-slot="layout-drag-copy"]');
    expect(copy).toHaveClass('shadow-drag', 'bg-surface', 'rounded-lg');
    expect(copy).toHaveTextContent('Rank distribution');
    // dnd-kit measures the overlay as the dragged card, so the card fills it: what it is over is judged by the card
    expect(dragOverlay()).toHaveClass('h-full');
    expect(dragOverlay()).toHaveAttribute('aria-hidden', 'true');
    // right edge of the card it is over, plus half the 16 px between the cells, less half the line itself
    const over = boxOf('unclassified');
    const line = dropLine();
    expect(line).toHaveStyle({
      width: '2px',
      height: `${String(over.height)}px`,
      top: `${String(over.top)}px`,
      left: `${String(rights(over) + COLUMN_GAP / 2 - 1)}px`,
    });
    expect(line).toHaveClass('bg-primary', 'absolute');
    expect(line).toHaveAttribute('aria-hidden', 'true');
    // nothing has moved yet, and nothing was said about a pointer drag that is still going
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(said).toHaveLength(heard);
    release(rightHalf('unclassified'));
  });

  it('moves the line when the pointer crosses the middle of the card it is over, with no other card entered', async () => {
    serve();
    const view = mount();
    await customize(view);
    dragTo('rank-distribution', leftHalf('unclassified'));
    await waitFor(() => {
      expect(dropLine()).not.toBeNull();
    });
    const over = boxOf('unclassified');
    expect(dropLine()).toHaveStyle({ left: `${String(over.left - COLUMN_GAP / 2 - 1)}px` });
    // still over the same card: dnd-kit says nothing more about it, the moves are what the line follows
    moveTo(rightHalf('unclassified'));
    await waitFor(() => {
      expect(dropLine()).toHaveStyle({ left: `${String(rights(over) + COLUMN_GAP / 2 - 1)}px` });
    });
    release(rightHalf('unclassified'));
    await waitFor(() => {
      expect(orderOf()).toEqual(['trend', 'matrix', 'unclassified', 'rank-distribution', ...BUILTIN_IDS.slice(4)]);
    });
  });

  it('judges the place by the pointer, not by the copy that trails it from the handle at the top left of the card', async () => {
    serve();
    const view = mount();
    await customize(view);
    // the card is taken at its top left corner, so its copy sits about half a card right of and below the pointer
    dragTo('rank-distribution', rightHalf('unclassified'));
    release(rightHalf('unclassified'));
    await waitFor(() => {
      expect(orderOf()).toEqual(['trend', 'matrix', 'unclassified', 'rank-distribution', ...BUILTIN_IDS.slice(4)]);
    });
    expect(polite()).toBe('Rank distribution dropped at position 4 of 8');
  });

  it('draws the line on the left of a card when the pointer is in its left half', async () => {
    serve();
    const view = mount();
    await customize(view);
    dragTo('unclassified', leftHalf('rank-distribution'));
    await waitFor(() => {
      expect(dropLine()).not.toBeNull();
    });
    const over = boxOf('rank-distribution');
    expect(dropLine()).toHaveStyle({ left: `${String(over.left - COLUMN_GAP / 2 - 1)}px` });
    release(leftHalf('rank-distribution'));
    await waitFor(() => {
      expect(orderOf()).toEqual(['trend', 'unclassified', 'rank-distribution', 'matrix', ...BUILTIN_IDS.slice(4)]);
    });
  });

  it('drops after the card it is over when the pointer is in its right half, and says where', async () => {
    serve();
    const view = mount();
    await customize(view);
    dragTo('rank-distribution', rightHalf('unclassified'));
    release(rightHalf('unclassified'));
    await waitFor(() => {
      expect(orderOf()).toEqual(['trend', 'matrix', 'unclassified', 'rank-distribution', ...BUILTIN_IDS.slice(4)]);
    });
    expect(polite()).toBe('Rank distribution dropped at position 4 of 8');
    // and the person is where they can go on from: on the handle of the card they moved
    await waitFor(() => {
      expect(handleOf('rank-distribution')).toHaveFocus();
    });
    expect(dropLine()).toBeNull();
    expect(dragOverlay()).toBeNull();
    expect(frameOf('rank-distribution')).not.toHaveClass('opacity-50');
    expect(dndRegion()).toBe('');
    // one drop, one step of the history
    act(() => {
      actions().undo();
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(latest?.canUndo).toBe(false);
  });

  it('moves nothing and says the card is put back when it is released on its own place', async () => {
    serve();
    const view = mount();
    await customize(view);
    const own = { x: centreOf(boxOf('rank-distribution')).x + 10, y: centreOf(boxOf('rank-distribution')).y };
    dragTo('rank-distribution', own);
    await waitFor(() => {
      expect(dragOverlay()).not.toBeNull();
    });
    expect(dropLine()).toBeNull();
    release(own);
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution put back');
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(latest?.canUndo).toBe(false);
  });

  it('takes the nearest card for the place when it is released away from every card, as the preview does', async () => {
    serve();
    const view = mount();
    await customize(view);
    dragTo('rank-distribution', { x: 5000, y: 5000 });
    release({ x: 5000, y: 5000 });
    // the nearest card is the last one, and the card is to the right of it
    await waitFor(() => {
      expect(orderOf()).toEqual([...BUILTIN_IDS.filter((id) => id !== 'rank-distribution'), 'rank-distribution']);
    });
    expect(polite()).toBe('Rank distribution dropped at position 8 of 8');
  });

  it("takes the drop over the empty space of a row as the place after that row's last card", async () => {
    serve(GAP_DOCUMENT);
    const view = mount();
    await customize(view, GAP_DOCUMENT);
    const gap = document.querySelector('[data-layout-gap="0"]');
    expect(gap).not.toBeNull();
    const target = centreOf(boxOf(`${GAP_PREFIX}0`));
    dragTo('e', target);
    await waitFor(() => {
      expect(dropLine()).not.toBeNull();
    });
    // the line is after the last card of the row, card b
    expect(dropLine()).toHaveStyle({ left: `${String(rights(boxOf('b')) + COLUMN_GAP / 2 - 1)}px` });
    release(target);
    await waitFor(() => {
      expect(orderOf()).toEqual(['a', 'b', 'e', 'c', 'd']);
    });
    expect(polite()).toBe('Visibility and mention rate dropped at position 3 of 5');
  });

  it('cancels a drag with Escape and says the card is put back', async () => {
    serve();
    const view = mount();
    await customize(view);
    dragTo('rank-distribution', rightHalf('unclassified'));
    await waitFor(() => {
      expect(dragOverlay()).not.toBeNull();
    });
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution put back');
    });
    expect(orderOf()).toEqual(BUILTIN_IDS);
    expect(dropLine()).toBeNull();
  });
});

describe('moving a card by touch', () => {
  it('starts nothing when the finger moves before 200 ms are up', async () => {
    serve();
    const view = mount();
    await customize(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = handleOf('rank-distribution');
    touch('touchstart', handle, START);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // more than the 5 px the finger may drift: a scroll, not a drag
    touch('touchmove', handle, { x: START.x + 12, y: START.y });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(dragOverlay()).toBeNull();
    expect(frameOf('rank-distribution')).not.toHaveClass('opacity-50');
  });

  it('starts nothing when the finger lifts before 200 ms are up', async () => {
    serve();
    const view = mount();
    await customize(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = handleOf('rank-distribution');
    touch('touchstart', handle, START);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    touch('touchend', handle, START);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(dragOverlay()).toBeNull();
  });

  it('starts a drag once the finger has rested for 200 ms', async () => {
    serve();
    const view = mount();
    await customize(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const handle = handleOf('rank-distribution');
    touch('touchstart', handle, START);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(dragOverlay()).toBeNull();
    // a small drift is allowed
    touch('touchmove', handle, { x: START.x + 3, y: START.y });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dragOverlay()).not.toBeNull();
    expect(frameOf('rank-distribution')).toHaveClass('opacity-50');
    touch('touchend', handle, START);
    // dnd-kit takes the overlay away once its drop animation has settled, which is a promise
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(dragOverlay()).toBeNull();
    expect(frameOf('rank-distribution')).not.toHaveClass('opacity-50');
  });
});

describe('row gaps', () => {
  it('are the free columns of every row but the last, as empty cells a card can be dropped on', async () => {
    serve(GAP_DOCUMENT);
    const view = mount();
    await customize(view, GAP_DOCUMENT);
    const gaps = document.querySelectorAll('[data-layout-gap]');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveAttribute('aria-hidden', 'true');
    expect(gaps[0]).toHaveClass('col-span-4', 'border-dashed', 'border-border-strong', 'rounded-lg');
    // placed in the grid after the last card of its row
    expect(frameOf('b').nextElementSibling).toBe(gaps[0]);
  });

  it('are not there when every row is full, or when the page is one column', async () => {
    serve();
    const full = mount();
    await customize(full);
    expect(document.querySelectorAll('[data-layout-gap]')).toHaveLength(0);
    full.unmount();

    media.breakpoint = 'narrow';
    serve(GAP_DOCUMENT);
    const narrow = mount();
    await customize(narrow, GAP_DOCUMENT);
    expect(document.querySelectorAll('[data-layout-gap]')).toHaveLength(0);
  });
});

/** WP-16's number strip drags with the same words: the hook for the `numbers` zone, called the way dnd-kit calls it. */
describe('useDragAnnouncements for the numbers of a page', () => {
  let numbers: DragAnnouncements | null = null;
  function NumbersProbe(): null {
    const handlers = useDragAnnouncements('numbers');
    useEffect(() => {
      numbers = handlers;
    }, [handlers]);
    return null;
  }
  const announcer = (): DragAnnouncements => {
    if (numbers === null) throw new Error('the probe has not rendered');
    return numbers;
  };
  const activeOf = (id: string): Active => ({
    id,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  });
  const overOf = (id: string): Over => ({
    id,
    rect: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 },
    disabled: false,
    data: { current: undefined },
  });
  const moveOf = (active: string, over: string): DragOverEvent => ({
    activatorEvent: new KeyboardEvent('keydown', { code: 'ArrowRight' }),
    active: activeOf(active),
    over: overOf(over),
    collisions: null,
    delta: { x: 0, y: 0 },
  });

  it('names the number, gives its place without a row, and says dropped or put back', async () => {
    serve();
    renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <LayoutProvider screen="overview" workspaceId={WORKSPACE} capabilities={CAPABILITIES} registry={REGISTRY}>
          <NumbersProbe />
        </LayoutProvider>
      </PermissionProvider>,
    );
    watchPoliteRegion();
    const keyboard = new KeyboardEvent('keydown', { code: 'Space' });
    act(() => {
      announcer().onDragStart({ activatorEvent: keyboard, active: activeOf('top10') });
    });
    await waitFor(() => {
      expect(polite()).toBe('Top 10 picked up. Use the arrow keys to move, Space to drop, Escape to put it back.');
    });

    // the first answer is the number over itself: it does not take the pick up's place
    act(() => {
      announcer().onDragOver({ ...moveOf('top10', 'top10'), activatorEvent: keyboard });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(polite()).toMatch(/picked up/);
    act(() => {
      announcer().onDragOver(moveOf('top10', 'aio-citation'));
    });
    await waitFor(() => {
      expect(polite()).toBe('Top 10, position 3 of 6');
    });

    act(() => {
      announcer().onDragEnd(moveOf('top10', 'aio-citation'));
    });
    await waitFor(() => {
      expect(polite()).toBe('Top 10 dropped at position 3 of 6');
    });

    // an AI number is named with its engine
    act(() => {
      announcer().onDragCancel(moveOf('mention-gemini', 'visibility'));
    });
    await waitFor(() => {
      expect(polite()).toBe('Mention rate: Gemini put back');
    });
  });
});

describe('reduced motion', () => {
  it('gives the overlay no drop animation, so the card jumps, and no glide when the keyboard moves it', async () => {
    media.reduced = true;
    serve();
    const view = mount();
    await customize(view);
    expect(overlay.dropAnimations.length).toBeGreaterThan(0);
    expect(overlay.dropAnimations.at(-1)).toBeNull();
    await pickUp(view, 'rank-distribution');
    expect(dragOverlay()?.parentElement?.style.transition).toBe('none');
  });

  it('gives the overlay a drop animation of 150 ms, and the glide of dnd-kit for the keyboard, when motion is allowed', async () => {
    serve();
    const view = mount();
    await customize(view);
    expect(overlay.dropAnimations.at(-1)).toEqual({ duration: 150 });
    await pickUp(view, 'rank-distribution');
    expect(dragOverlay()?.parentElement?.style.transition).toBe('transform 250ms ease');
  });
});
