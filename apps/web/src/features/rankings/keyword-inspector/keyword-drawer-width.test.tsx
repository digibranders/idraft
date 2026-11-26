import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

/**
 * The keyword drawer is 640 px by default and can be dragged to 960 px. jsdom has no layout, so these tests read what
 * decides the width in code: nothing inside the card holds a pixel width of its own, the metric strip shares the row,
 * and each chart follows its element through the browser's resize observer, the way a drag of the handle moves it.
 */

interface FakeChart {
  resize: Mock;
}
const charts = vi.hoisted(() => ({ byNode: new Map<HTMLElement, FakeChart>() }));
// jsdom has no canvas: the instance is a stand-in, the colour helpers stay the real ones
vi.mock('echarts/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('echarts/core')>()),
  init: (node: HTMLElement): FakeChart & { setOption: Mock; dispose: Mock } => {
    const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
    charts.byNode.set(node, chart);
    return chart;
  },
  connect: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

interface Watch {
  target: Element;
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
}
const watches: Watch[] = [];
/** Every box is 1600 px wide when first watched (the wide table), and a test can resize any of them afterwards. */
class RecordingResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    watches.push({ target, callback: this.callback, observer: this as unknown as ResizeObserver });
    this.callback(
      [{ target, contentRect: { width: 1600, height: 640 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

const USER = 'drawer-width-user';
/** A `w-`, `min-w-` or `max-w-` class that sets a size; `w-full`, `min-w-0` and the like leave the box to its parent. */
const FIXED_WIDTH_CLASS = /(^|\s)(?:min-|max-)?w-(?!(?:0|full|none|auto|fit)(?:\s|$))/;

beforeEach(() => {
  stubWideScreen();
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  watches.length = 0;
  charts.byNode.clear();
});
afterEach(() => {
  writeInspectorWidth(USER, null);
  restoreWideScreen();
});

/** The canvases drawn inside the drawer, once both cards (rank history, searches by month) have loaded them. */
async function chartsIn(drawer: HTMLElement): Promise<HTMLElement[]> {
  await waitFor(() => expect([...charts.byNode.keys()].filter((node) => drawer.contains(node))).toHaveLength(2));
  return [...charts.byNode.keys()].filter((node) => drawer.contains(node));
}

describe.each([640, 960])('The keyword drawer at %i px', (width) => {
  it('holds no pixel width of its own: the strip shares the row and the charts follow the card', async () => {
    writeInspectorWidth(USER, width);
    const { user } = renderWithProviders(
      <InspectorWidthUserContext value={USER}>{as('viewer')}</InspectorWidthUserContext>,
    );
    const grid = await loadedGrid();
    const header = within(grid)
      .getAllByRole('rowheader')
      .find((cell) => cell.querySelector('.truncate')?.textContent === 'seo agency');
    if (header === undefined) throw new Error('No row for seo agency');
    await user.click(header);
    const drawer = await screen.findByRole('complementary', { name: 'seo agency' });
    expect(drawer.style.width).toBe(`${String(width)}px`);

    // Volume, difficulty and CPC share the whole row, however wide the card is
    const strip = within(drawer).getByRole('group', { name: 'Metrics for this keyword' });
    expect(strip.querySelector('dl')?.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');

    for (const canvas of await chartsIn(drawer)) {
      // The canvas takes its width from its box and only its height is set
      expect(canvas).toHaveClass('w-full');
      expect(canvas.style.width).toBe('');
      expect(canvas.style.minWidth).toBe('');
      expect(canvas.style.maxWidth).toBe('');
      // Nothing between the canvas and the card fixes a width either
      for (let node = canvas.parentElement; node !== null && node !== drawer; node = node.parentElement) {
        expect([node.style.width, node.style.minWidth, node.style.maxWidth]).toEqual(['', '', '']);
        expect(node.className).not.toMatch(FIXED_WIDTH_CLASS);
      }
      // A drag of the handle changes the card's width: the chart reads its box again
      const chart = charts.byNode.get(canvas);
      const watch = watches.find((entry) => entry.target === canvas);
      if (chart === undefined || watch === undefined) throw new Error('The chart does not watch its box');
      chart.resize.mockClear();
      act(() => {
        watch.callback(
          [{ target: canvas, contentRect: { width: width - 66, height: 180 } } as unknown as ResizeObserverEntry],
          watch.observer,
        );
      });
      expect(chart.resize).toHaveBeenCalledOnce();
    }
  }, 30_000);
});
