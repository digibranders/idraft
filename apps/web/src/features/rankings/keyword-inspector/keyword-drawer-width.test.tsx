import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

/**
 * The keyword drawer is 640 px by default and can be dragged from 480 px (the least) to 960 px. jsdom has no layout, so
 * these tests read what decides the width in code: nothing inside the card holds a pixel width of its own, from the
 * metric strip to the last section, and each chart follows its element through the browser's resize observer, the way a
 * drag of the handle moves it.
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
/**
 * The `w-`, `min-w-` and `max-w-` classes of a box that set a size. `w-full`, `min-w-0` and the like leave the box to
 * its parent; a plain `w-1` to `w-16` (4 to 64 px) is the slot of an icon or a figure inside a cell, never the width of
 * a column or of the card. The tab underline takes the width of the tab it sits under, which the tab list measures. A
 * variant (`md:`, `@lg:`, `[&>td]:`) or an important mark (`!w-80`, `w-80!`) does not hide a width: the class is judged
 * by its bare name.
 */
function sizingWidthClasses(node: Element): string[] {
  const free = /^(?:(?:min-|max-)?w-(?:0|full|none|auto|fit)|w-\(--active-tab-width\))$/;
  const slot = /^w-(?:[1-9]|1[0-6])$/;
  return (node.getAttribute('class') ?? '').split(/\s+/).filter((name) => {
    const bare = name.replace(/^(?:(?:\[[^\]]*\]|[^\s:[]+):)*/, '').replace(/^!|!$/g, '');
    return /^(?:min-|max-)?w-/.test(bare) && !free.test(bare) && !slot.test(bare);
  });
}

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

describe.each([480, 640, 960])('The keyword drawer at %i px', (width) => {
  it('holds no pixel width of its own: no section fixes one and the charts follow the card', async () => {
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

    // Volume, difficulty and CPC are three equal columns of the card's width (the small strip never reads the width)
    const strip = within(drawer).getByRole('group', { name: 'Metrics for this keyword' });
    expect(strip.querySelector('dl')?.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');

    const canvases = await chartsIn(drawer);
    // Every section has drawn its content, so the scan below reads Links, Tracking, Competitors and History too
    await waitFor(() => expect(drawer.querySelector('[aria-busy="true"]')).toBeNull(), { timeout: 5000 });
    // Nothing inside the card fixes a width: the strip and its cells, every section, the charts and what is between
    // them (the card itself and its resize handle are the drawer's own)
    for (const node of drawer.querySelectorAll<HTMLElement | SVGElement>('*')) {
      if (node.closest('[role="separator"]') !== null) continue;
      expect([node.style.width, node.style.minWidth, node.style.maxWidth]).toEqual(['', '', '']);
      expect(sizingWidthClasses(node)).toEqual([]);
    }

    for (const canvas of canvases) {
      // The canvas takes its width from its box and only its height is set
      expect(canvas).toHaveClass('w-full');
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
