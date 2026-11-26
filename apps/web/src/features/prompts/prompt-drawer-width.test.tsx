import { act, screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import { PermissionProvider } from '@/lib/permissions';
import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { answerOf, DAY_MS, ENGINE_CODES, FIXTURE_PROMPTS, observationIdOf, runInstants } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';
// A topic drawer reads the entities and the tracked keywords: the harness answers both with none
import '@/test/topic-drawer-harness';

/**
 * The prompt, answer and topic drawers are 640 px by default and can be dragged from 480 px (the least) to 960 px.
 * jsdom has no layout, so these tests read what decides the width in code: nothing inside the card holds a pixel width
 * of its own on any tab, and each chart follows its element through the browser's resize observer, the way a drag of
 * the handle moves it.
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
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
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

const USER = 'prompt-drawer-width-user';
const NOW = new Date('2026-11-12T12:00:00Z');
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const prompts = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const [first] = prompts;
if (first === undefined) throw new Error('The fixture prompts are missing');
const FYNIX_ID = fynix.project_id;

/** The newest fixture answer that has sources and brands, to open in the answer viewer. */
function citedAnswerId(): string {
  for (const at of runInstants(NOW.getTime()).slice(0, 8)) {
    const day = Math.floor(at / DAY_MS);
    for (const prompt of prompts) {
      if (prompt.index === null) continue;
      const answer = answerOf(prompt.index, prompt.language_code, 'chatgpt_web', day);
      if (answer.status === 'complete' && answer.citations.length > 0 && answer.mentions.length > 0) {
        return observationIdOf(day, prompt.index, ENGINE_CODES.indexOf('chatgpt_web'));
      }
    }
  }
  throw new Error('No fixture answer has sources and brands');
}

/**
 * The `w-`, `min-w-` and `max-w-` classes of a box that set a size. `w-full`, `min-w-0` and the like leave the box to
 * its parent; a plain `w-1` to `w-16` (4 to 64 px) is the slot of an icon, a date or a figure inside a row, and
 * `min-w-1` to `min-w-24` (up to 96 px) the floor of a cell, never the width of a column or of the card. The tab underline takes the width of the tab it sits under, which the tab list
 * measures, and its hidden measuring row is as wide as its tabs (`w-max`). A variant (`md:`, `@lg:`, `[&>td]:`) or an
 * important mark (`!w-80`, `w-80!`) does not hide a width: the class is judged by its bare name. A cap that steps with
 * a container (`max-w-32 @md:max-w-48 ...`) grows with the card, so such a box is not a fixed width.
 */
function sizingWidthClasses(node: Element): string[] {
  const free = /^(?:(?:min-|max-)?w-(?:0|full|none|auto|fit|max|min)|w-\(--active-tab-width\))$/;
  const slot = /^(?:w-(?:[1-9]|1[0-6])|min-w-(?:[1-9]|1\d|2[0-4]))$/;
  const names = (node.getAttribute('class') ?? '').split(/\s+/);
  const steps = names.some((name) => /^@[^:]+:max-w-/.test(name));
  return names.filter((name) => {
    const bare = name.replace(/^(?:(?:\[[^\]]*\]|[^\s:[]+):)*/, '').replace(/^!|!$/g, '');
    if (steps && bare.startsWith('max-w-')) return false;
    return /^(?:min-|max-)?w-/.test(bare) && !free.test(bare) && !slot.test(bare);
  });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  watches.length = 0;
  charts.byNode.clear();
});
afterEach(() => {
  vi.useRealTimers();
  writeInspectorWidth(USER, null);
  restoreWideScreen();
});

function promptsAs(): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('viewer')}>
      <InspectorWidthUserContext value={USER}>
        <Suspense fallback={null}>
          <PromptsScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={{
              id: FYNIX_ID,
              slug: 'fynix',
              name: 'Fynix',
              timeZone: 'Europe/Berlin',
              defaultLanguage: 'en',
              defaultCountryIso: 'DE',
            }}
          />
        </Suspense>
      </InspectorWidthUserContext>
    </PermissionProvider>
  );
}

const inspect = (target: string, tab?: string): string =>
  `?inspect=${encodeURIComponent(target)}${tab === undefined ? '' : `&itab=${tab}`}`;

/** The drawer's content has read what it shows: no section is still loading. */
async function loaded(drawer: HTMLElement): Promise<void> {
  await waitFor(() => expect(drawer.querySelector('[aria-busy="true"]')).toBeNull(), { timeout: 8000 });
}

/**
 * Boxes whose own width is not the card's: a badge or a chip (`h-badge`) keeps to its label, a select keeps the width
 * of its words (its wrapper holds the width, a control of 176 px), and the native input behind a select, a radio or a
 * checkbox is a hidden 1 px box.
 */
function isOwnSizeControl(node: Element): boolean {
  return (
    node.matches(
      '[data-slot="badge"], .h-badge, input[aria-hidden="true"], input[type="radio"], input[type="checkbox"]',
    ) || node.querySelector(':scope > [data-slot="select"]') !== null
  );
}

/**
 * The label column (160 px), the figure column (112 px) and the trailing slot (224 px) of a bar row, from the
 * container query, have a sibling that takes all the room that is left: they are the fixed boxes of a row that fills
 * the card.
 */
function isColumnBesideFlexible(node: Element): boolean {
  return [...(node.parentElement?.children ?? [])].some(
    (sibling) => sibling !== node && /(?:^|\s)(?:[^\s:]+:)*flex-1(?:\s|$)/.test(sibling.getAttribute('class') ?? ''),
  );
}

/** Nothing inside the card fixes a width in pixels (a share of the card, as a whisker has, is fine). */
function expectNoPixelWidth(drawer: HTMLElement): void {
  for (const node of drawer.querySelectorAll<HTMLElement | SVGElement>('*')) {
    // The box is named in the result, so a failure says which one holds the width
    const box = `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''}`;
    // A cap that steps with a container only grows when a container is above it: without one it stays at its least
    if ((node.getAttribute('class') ?? '').split(/\s+/).some((name) => /^@[^:]+:max-w-/.test(name))) {
      expect({ box, container: node.closest('.\\@container') !== null }).toEqual({ box, container: true });
    }
    // The card itself and its resize handle are the drawer's own
    if (node.closest('[role="separator"]') !== null || isOwnSizeControl(node)) continue;
    const inline = [node.style.width, node.style.minWidth, node.style.maxWidth].filter(
      (value) => value !== '' && !value.endsWith('%'),
    );
    expect({ box, inline }).toEqual({ box, inline: [] });
    const classes = sizingWidthClasses(node).filter(
      (name) => !(/w-(?:28|40|56)$/.test(name) && isColumnBesideFlexible(node)),
    );
    expect({ box, classes }).toEqual({ box, classes: [] });
  }
}

/** A drag of the handle changes the card's width: every chart in the card reads its box again. */
function expectChartsFollowTheCard(drawer: HTMLElement, width: number): void {
  const canvases = [...charts.byNode.keys()].filter((node) => drawer.contains(node));
  expect(canvases.length).toBeGreaterThan(0);
  for (const canvas of canvases) {
    expect(canvas).toHaveClass('w-full');
    const chart = charts.byNode.get(canvas);
    const watch = watches.find((entry) => entry.target === canvas);
    if (chart === undefined || watch === undefined) throw new Error('The chart does not watch its box');
    chart.resize.mockClear();
    act(() => {
      watch.callback(
        [{ target: canvas, contentRect: { width: width - 32, height: 180 } } as unknown as ResizeObserverEntry],
        watch.observer,
      );
    });
    expect(chart.resize).toHaveBeenCalledOnce();
  }
}

describe.each([480, 640, 960])('The prompt drawer at %i px', (width) => {
  it.each(['latest', 'history', 'citations', 'competitors', 'stats'])(
    'holds no pixel width of its own on its %s tab',
    async (tab) => {
      writeInspectorWidth(USER, width);
      renderWithProviders(promptsAs(), {
        searchParams: inspect(`prompt:${first.prompt_id}`, tab === 'latest' ? undefined : tab),
      });
      const drawer = await screen.findByRole('complementary', { name: first.text });
      expect(drawer.style.width).toBe(`${String(width)}px`);
      await within(drawer).findByRole('tab', { selected: true });
      await loaded(drawer);
      if (tab === 'citations') {
        // The lists have drawn their rows, so the scan reads the capped identity cells
        await waitFor(() => expect(drawer.querySelector('[data-slot="domain-identity"]')).not.toBeNull());
      }
      expectNoPixelWidth(drawer);
      if (tab === 'history') {
        await waitFor(() => expect([...charts.byNode.keys()].some((node) => drawer.contains(node))).toBe(true));
        expectChartsFollowTheCard(drawer, width);
      }
    },
    30_000,
  );
});

describe.each([480, 640, 960])('The topic drawer at %i px', (width) => {
  it.each(['overview', 'prompts', 'competitors', 'related'])(
    'holds no pixel width of its own on its %s tab',
    async (tab) => {
      writeInspectorWidth(USER, width);
      renderWithProviders(promptsAs(), {
        searchParams: inspect(`topic:${MOCK_TERM_IDS.seo}`, tab === 'overview' ? undefined : tab),
      });
      const drawer = await screen.findByRole('complementary', { name: 'SEO' });
      expect(drawer.style.width).toBe(`${String(width)}px`);
      await within(drawer).findByRole('tab', { selected: true });
      await loaded(drawer);
      expectNoPixelWidth(drawer);
    },
    30_000,
  );
});

describe.each([480, 640, 960])('The answer drawer at %i px', (width) => {
  it('holds no pixel width of its own: the text, the brands and the sources use the card', async () => {
    writeInspectorWidth(USER, width);
    renderWithProviders(promptsAs(), { searchParams: inspect(`answer:${citedAnswerId()}`) });
    const drawer = await screen.findByRole('complementary', { name: /answer, / });
    expect(drawer.style.width).toBe(`${String(width)}px`);
    await within(drawer).findByRole('list', { name: 'Citations in this answer' });
    await loaded(drawer);
    expectNoPixelWidth(drawer);
  }, 30_000);
});
