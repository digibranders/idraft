import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutGrid } from './layout-grid';
import { LayoutProvider, useLayoutScreen, type LayoutContextValue } from './layout-provider';
import { defineCards } from './registry';
import { ResizeGrip } from './resize-grip';
import { MEDIUM_MEDIA } from './use-breakpoint';
import { MEDIA } from '@/lib/dom/use-media-query';
import { packRows, type Breakpoint, type Capabilities, type CardItem, type LayoutDocument } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const READ = mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`);
const CAPABILITIES: Capabilities = { channels: ['seo', 'ai'], permissions: [], integrations: [] };
const REGISTRY = defineCards({});

/**
 * Allowed widths: rank_distribution third and half, top_movers half and third, by_engine half, two thirds and full.
 * At wide that is 4, 6, (8), 12 columns; at medium third and half are both 6, two thirds and full both 12.
 */
const DOCUMENT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [
    { id: 'rank', type: 'seo.rank_distribution', width: 'third' },
    { id: 'movers', type: 'seo.top_movers', width: 'third' },
    { id: 'engine', type: 'ai.by_engine', width: 'full' },
  ],
};

function serve(document: LayoutDocument): void {
  server.use(
    http.get(READ, () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: 'personal',
            document,
            team_default_exists: false,
            team_document: null,
            updated_at: '2026-11-10T09:12:44Z',
            updated_by: { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' },
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

// --- the media the page is in ----------------------------------------------------------------------------------

const media = { breakpoint: 'wide' as Breakpoint };
function stubMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === MEDIA.xl ? media.breakpoint === 'wide' : query === MEDIUM_MEDIA ? media.breakpoint !== 'narrow' : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

// --- layout: jsdom has none, so the grid and the frames are laid out here ----------------------------------------

/** Twelve columns of 70 px and eleven gaps of 16: whole pixels. */
const GRID_WIDTH = 1016;
const COLUMN = 70;
const GAP = 16;
const spanPx = (columns: number): number => columns * COLUMN + (columns - 1) * GAP;

interface Box {
  left: number;
  width: number;
}
const boxes = new Map<string, Box>();
function layOut(cards: readonly CardItem[], breakpoint: Breakpoint): void {
  boxes.clear();
  for (const row of packRows(cards, breakpoint)) {
    let used = 0;
    for (const placed of row) {
      boxes.set(placed.id, { left: used * (COLUMN + GAP), width: spanPx(placed.span) });
      used += placed.span;
    }
  }
}
function domRect(left: number, width: number): DOMRect {
  return { x: left, y: 0, left, top: 0, width, height: 100, right: left + width, bottom: 100, toJSON: () => ({}) };
}

const frameOf = (id: string): HTMLElement => {
  const frame = document.querySelector<HTMLElement>(`[data-layout-card="${id}"]`);
  if (frame === null) throw new Error(`no frame for ${id}`);
  return frame;
};
const gripOf = (id: string): HTMLElement => {
  const grip = frameOf(id).querySelector<HTMLElement>('[data-part="resize"]');
  if (grip === null) throw new Error(`no grip on ${id}`);
  return grip;
};
const hasGrip = (id: string): boolean => frameOf(id).querySelector('[data-part="resize"]') !== null;
const previewOf = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="layout-resize-preview"]');

// --- pointer capture: jsdom has none ---------------------------------------------------------------------------

const capture = { set: vi.fn(), release: vi.fn(), held: false };
function stubCapture(): void {
  capture.held = false;
  capture.set = vi.fn(() => {
    capture.held = true;
  });
  capture.release = vi.fn(() => {
    capture.held = false;
  });
  Object.defineProperties(Element.prototype, {
    setPointerCapture: { configurable: true, value: capture.set },
    releasePointerCapture: { configurable: true, value: capture.release },
    hasPointerCapture: { configurable: true, value: () => capture.held },
  });
}
function unstubCapture(): void {
  Reflect.deleteProperty(Element.prototype, 'setPointerCapture');
  Reflect.deleteProperty(Element.prototype, 'releasePointerCapture');
  Reflect.deleteProperty(Element.prototype, 'hasPointerCapture');
}

// --- the page --------------------------------------------------------------------------------------------------

/** What the polite region said, in order (it empties itself, so a test reads what was said and not what is there). */
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
const widthSaid = (): string[] => said.filter((text) => text.includes(' width: '));

function mount(extra: ReactElement | null = null): ProvidedRender {
  latest = null;
  const view = renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider screen="overview" workspaceId={WORKSPACE} capabilities={CAPABILITIES} registry={REGISTRY}>
        <CustomizeButton />
        <Spy />
        {extra}
        <LayoutGrid label="Overview cards" />
      </LayoutProvider>
    </PermissionProvider>,
  );
  watchPoliteRegion();
  return view;
}

async function customize(view: ProvidedRender): Promise<void> {
  const button = screen.getByRole('button', { name: 'Customize' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await view.user.click(button);
  await waitFor(() => {
    expect(latest?.mode).toBe('customize');
  });
  layOut(DOCUMENT.cards ?? [], media.breakpoint);
  const grid = frameOf('rank').parentElement;
  if (grid === null) throw new Error('the frames have no grid');
  grid.style.columnGap = `${String(GAP)}px`;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const id = this.getAttribute('data-layout-card');
    const box = id === null ? undefined : boxes.get(id);
    if (box !== undefined) return domRect(box.left, box.width);
    return this === grid ? domRect(0, GRID_WIDTH) : domRect(0, 0);
  });
}

async function open(breakpoint: Breakpoint = 'wide', layout: LayoutDocument = DOCUMENT): Promise<ProvidedRender> {
  media.breakpoint = breakpoint;
  stubMedia();
  serve(layout);
  const view = mount();
  await customize(view);
  return view;
}

// --- the pointer -----------------------------------------------------------------------------------------------

const POINTER = 1;
const rightOf = (id: string): number => {
  const box = boxes.get(id);
  if (box === undefined) throw new Error(`no box for ${id}`);
  return box.left + box.width;
};
/** Presses on the grip of a card, at its right edge. */
function press(id: string): void {
  fireEvent.pointerDown(gripOf(id), { pointerId: POINTER, button: 0, clientX: rightOf(id), clientY: 50 });
}
/** Moves the pointer `by` pixels from where it pressed. */
function move(id: string, by: number): void {
  fireEvent.pointerMove(gripOf(id), { pointerId: POINTER, clientX: rightOf(id) + by, clientY: 50 });
}
function lift(id: string, by: number): void {
  fireEvent.pointerUp(gripOf(id), { pointerId: POINTER, clientX: rightOf(id) + by, clientY: 50 });
}
/** The pixels the pointer moves for the card's right edge to sit where `columns` columns would end. */
const toColumns = (id: string, columns: number): number => spanPx(columns) - (boxes.get(id)?.width ?? 0);

beforeEach(() => {
  stubCapture();
});
afterEach(() => {
  watcher?.disconnect();
  unstubCapture();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('where the grip is', () => {
  it('is on a card with two different widths at wide, and not on one whose widths look the same at medium', async () => {
    await open('wide');
    expect(hasGrip('rank')).toBe(true);
    expect(hasGrip('movers')).toBe(true);
    expect(hasGrip('engine')).toBe(true);
  });

  it('is not on seo.rank_distribution or seo.top_movers at medium (third and half are 6 columns), but is on ai.by_engine (6 and 12)', async () => {
    await open('medium');
    expect(hasGrip('rank')).toBe(false);
    expect(hasGrip('movers')).toBe(false);
    expect(hasGrip('engine')).toBe(true);
  });

  it('is nowhere below 768 px, where every width is the whole row', async () => {
    await open('narrow');
    expect(document.querySelector('[data-part="resize"]')).toBeNull();
  });

  it('is not rendered in view mode, and is rendered in customize mode (the same component, so the mode is what decides)', async () => {
    media.breakpoint = 'wide';
    stubMedia();
    serve(DOCUMENT);
    const view = mount(<ResizeGrip item={{ id: 'probe', type: 'seo.rank_distribution', width: 'third' }} />);
    const button = screen.getByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    expect(latest?.mode).toBe('view');
    expect(document.querySelector('[data-part="resize"]')).toBeNull();
    await view.user.click(button);
    await waitFor(() => {
      expect(document.querySelector('[data-part="resize"]')).not.toBeNull();
    });
  });

  it('is aria-hidden, has no tab stop of its own and is never reached by the Tab key', async () => {
    const view = await open();
    const grip = gripOf('rank');
    expect(grip).toHaveAttribute('aria-hidden', 'true');
    expect(grip).not.toHaveAttribute('tabindex');
    expect(grip).toHaveClass('cursor-ew-resize', 'touch-none', 'w-1');
    const total = document.querySelectorAll('button, [tabindex], input, select').length;
    for (let step = 0; step < total + 2; step += 1) {
      await view.user.tab();
      expect(document.activeElement).not.toBe(grip);
      expect(grip.contains(document.activeElement)).toBe(false);
    }
  });
});

describe('the handle', () => {
  it('shows while the pointer is over the frame, and goes when it leaves', async () => {
    const view = await open();
    expect(gripOf('rank').children).toHaveLength(0);
    await view.user.hover(frameOf('rank'));
    expect(gripOf('rank').children).toHaveLength(1);
    expect(gripOf('rank').firstElementChild).toHaveClass('w-0.5', 'bg-primary');
    await view.user.unhover(frameOf('rank'));
    expect(gripOf('rank').children).toHaveLength(0);
  });

  it('has a tooltip that says what it does', async () => {
    const view = await open();
    await view.user.hover(gripOf('rank'));
    expect(await screen.findByText('Drag to change the width')).toBeInTheDocument();
  });
});

describe('resizing', () => {
  it('takes the pointer on press, and a press on the grip goes no further (it must not start a card drag)', async () => {
    await open();
    const reached = vi.fn();
    document.addEventListener('pointerdown', reached);
    press('rank');
    document.removeEventListener('pointerdown', reached);
    expect(capture.set).toHaveBeenCalledWith(POINTER);
    expect(reached).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="layout-drag-overlay"]')).toBeNull();
  });

  it('ignores a press that is not the main button', async () => {
    await open();
    fireEvent.pointerDown(gripOf('rank'), { pointerId: POINTER, button: 2, clientX: rightOf('rank') });
    expect(capture.set).not.toHaveBeenCalled();
    expect(previewOf()).toBeNull();
  });

  it('drags top movers from a third to 7 columns, snaps to half, and changes the width once', async () => {
    await open();
    press('movers');
    move('movers', toColumns('movers', 7));
    lift('movers', toColumns('movers', 7));
    expect(latest?.document.cards?.find((card) => card.id === 'movers')?.width).toBe('half');
    await waitFor(() => {
      expect(widthSaid()).toEqual(['Top movers width: Half']);
    });
    // one change, so one undo gives the third back
    act(() => {
      latest?.actions.undo();
    });
    expect(latest?.document.cards?.find((card) => card.id === 'movers')?.width).toBe('third');
    expect(latest?.canUndo).toBe(false);
    expect(previewOf()).toBeNull();
    expect(capture.release).toHaveBeenCalledWith(POINTER);
  });

  it.each([
    ['rank', 6.4, 'half'],
    ['rank', 5, 'third'],
    ['engine', 7, 'half'],
    ['engine', 9, 'two_thirds'],
    ['engine', 11, 'full'],
  ] as const)(
    'drags %s to %s columns and the card ends up %s (the nearest allowed width, a tie the narrower)',
    async (id, columns, expected) => {
      await open();
      press(id);
      move(id, toColumns(id, columns));
      lift(id, toColumns(id, columns));
      expect(latest?.document.cards?.find((card) => card.id === id)?.width).toBe(expected);
    },
  );

  it('shows a dashed outline of the snapped width, in pixels, with its name, and nothing animates', async () => {
    await open();
    press('movers');
    // the outline is there from the press, at the width the card has
    expect(previewOf()).toHaveStyle({ width: `${String(spanPx(4))}px` });
    move('movers', toColumns('movers', 7));
    const preview = previewOf();
    expect(preview).toHaveStyle({ width: `${String(spanPx(6))}px` });
    expect(preview).toHaveClass('border-dashed', 'border-primary');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview).toHaveTextContent('Half');
    expect(preview?.className).not.toMatch(/transition|duration|animate/);
    expect(preview?.querySelector('[data-slot="layout-resize-tip"]')?.className ?? '').not.toMatch(
      /transition|animate/,
    );
    // beyond the widest allowed width it stays at that width
    move('movers', 400);
    expect(previewOf()).toHaveStyle({ width: `${String(spanPx(6))}px` });
    expect(await axe(document.body)).toHaveNoViolations();
    // the card has not changed until the pointer is lifted
    expect(latest?.document.cards?.find((card) => card.id === 'movers')?.width).toBe('third');
    lift('movers', 400);
    expect(previewOf()).toBeNull();
  });

  it('measures the grid when the press is made, so the width follows the pointer one to one', async () => {
    await open();
    press('movers');
    // 5 columns is as near 4 as it is to 6: the narrower; a little more is nearer the half
    move('movers', toColumns('movers', 5));
    expect(previewOf()).toHaveTextContent('One third');
    move('movers', toColumns('movers', 5.2));
    expect(previewOf()).toHaveTextContent('Half');
    // back where it began
    move('movers', 0);
    expect(previewOf()).toHaveTextContent('One third');
    expect(previewOf()).toHaveStyle({ width: `${String(spanPx(4))}px` });
  });
});

describe('ending without a change', () => {
  it('changes nothing when the pointer comes back to where it started, and says nothing', async () => {
    await open();
    press('movers');
    move('movers', toColumns('movers', 7));
    lift('movers', 0);
    expect(latest?.document.cards?.find((card) => card.id === 'movers')?.width).toBe('third');
    expect(latest?.canUndo).toBe(false);
    expect(widthSaid()).toEqual([]);
    expect(previewOf()).toBeNull();
  });

  it('changes nothing when a small move still snaps to the width the card has', async () => {
    await open();
    press('movers');
    lift('movers', 20);
    expect(latest?.canUndo).toBe(false);
    expect(widthSaid()).toEqual([]);
  });

  it('changes nothing for a width with the same columns as the card has at medium (full against two thirds)', async () => {
    await open('medium');
    press('engine');
    // the whole row: snapWidth names the first of the two widths with 12 columns, which is not the card's own
    move('engine', -20);
    expect(previewOf()).toHaveTextContent('Full');
    lift('engine', -20);
    expect(latest?.document.cards?.find((card) => card.id === 'engine')?.width).toBe('full');
    expect(latest?.canUndo).toBe(false);
    expect(widthSaid()).toEqual([]);
  });

  it('puts the card back on Escape: the outline goes, the later release does nothing', async () => {
    await open();
    press('movers');
    move('movers', toColumns('movers', 7));
    expect(previewOf()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(previewOf()).toBeNull();
    expect(capture.release).toHaveBeenCalledWith(POINTER);
    lift('movers', toColumns('movers', 7));
    expect(latest?.document.cards?.find((card) => card.id === 'movers')?.width).toBe('third');
    expect(latest?.canUndo).toBe(false);
    expect(widthSaid()).toEqual([]);
  });

  it('keeps Escape for itself while it is resizing, and leaves it alone otherwise', async () => {
    await open();
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    press('movers');
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(reached).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(reached).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', reached);
  });

  it('puts the card back when the pointer is cancelled', async () => {
    await open();
    press('movers');
    move('movers', toColumns('movers', 7));
    fireEvent.pointerCancel(gripOf('movers'), { pointerId: POINTER });
    expect(previewOf()).toBeNull();
    lift('movers', toColumns('movers', 7));
    expect(latest?.document.cards?.find((card) => card.id === 'movers')?.width).toBe('third');
    expect(latest?.canUndo).toBe(false);
    expect(widthSaid()).toEqual([]);
  });

  it('puts the card back when the browser takes the pointer away', async () => {
    await open();
    press('movers');
    move('movers', toColumns('movers', 7));
    fireEvent.lostPointerCapture(gripOf('movers'), { pointerId: POINTER });
    expect(previewOf()).toBeNull();
    expect(latest?.canUndo).toBe(false);
  });

  it('does not start without a measurable grid', async () => {
    await open();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => domRect(0, 0));
    press('movers');
    expect(capture.set).not.toHaveBeenCalled();
    expect(previewOf()).toBeNull();
  });
});
