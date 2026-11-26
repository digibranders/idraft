import { act, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { z } from 'zod';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GapDrawer } from './gap-drawer';
import { PageDrawer } from './page-drawer';
import type { TrackedCompetitor } from '../board-reads';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { BoardScopeParams } from '@/lib/citations/board-queries';
import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { expectNoPixelWidth, sizingWidthClasses } from '@/test/drawer-width-scan';
import { mockBrowser } from '@/test/mock-api';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

/**
 * The two Citations drawers at the least width, the default and the most. jsdom has no layout, so these tests read
 * what decides the width in code: every table fills its card, a sized column sits beside a free one, the trend is
 * drawn at the width its box measures, and nothing else holds a pixel width.
 */

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const PROJECT = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const TOP = CITATIONS_FIXTURE.expected.chatgpt.pages.topOwn;
// The mock model numbers the fixture's pages from 1, in the order of `urls`
const TOP_ID = CITATIONS_FIXTURE.urls.findIndex((url) => url.role === 'own' && url.path === TOP.path) + 1;
const FIRST = CITATIONS_FIXTURE.expected.chatgpt.gaps.first;
const PROMPT_ID = CITATIONS_FIXTURE.prompts.find((prompt) => prompt.text === FIRST)?.id ?? '';
const USER = 'citations-drawer-width-user';
const SCOPE: BoardScopeParams = { runs: 4, engines: ['chatgpt_web'], term: null };
const SHARED = {
  project: PROJECT,
  scope: SCOPE,
  engines: [{ code: 'chatgpt_web' as const, label: 'ChatGPT' }],
  scopeParts: ['ChatGPT', 'All groups', 'Last 4 runs'],
  scopeText: 'ChatGPT, All groups, Last 4 runs',
  stepping: { positionText: '1 of 13', navigation: null, onStep: undefined },
  onTabChange: vi.fn(),
  onClose: vi.fn(),
};

const ENTITIES = z.array(
  z.object({
    entity: z.object({ entity_id: z.string(), canonical_name: z.string() }),
    role: z.string(),
    color_index: z.number().nullable(),
    removed_at: z.string().nullable(),
  }),
);
let tracked: readonly TrackedCompetitor[] = [];

interface Watch {
  target: Element;
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
}
const watches: Watch[] = [];
const measureOf = (target: Element, width: number): ResizeObserverEntry[] => [
  { target, contentRect: { width, height: 56 } } as unknown as ResizeObserverEntry,
];
/** Every box is 400 px wide when first watched, and a test can resize any of them afterwards. */
class RecordingResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    watches.push({ target, callback: this.callback, observer: this as unknown as ResizeObserver });
    this.callback(measureOf(target, 400), this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(async () => {
  const answer = await mockBrowser('viewer').call(
    'GET',
    `/api/v1/workspaces/${PROJECT.workspaceId}/projects/${PROJECT.projectId}/entities`,
  );
  tracked = ENTITIES.parse(answer.body.data)
    .filter((row) => row.role === 'competitor' && row.removed_at === null)
    .map((row) => ({
      id: row.entity.entity_id,
      name: row.entity.canonical_name,
      colorIndex: row.color_index,
      domain: null,
    }));
});

beforeEach(() => {
  stubWideScreen();
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  watches.length = 0;
  // jsdom has no canvas: the trend draws on a stub
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  writeInspectorWidth(USER, null);
  restoreWideScreen();
  vi.restoreAllMocks();
});

async function open(drawer: ReactElement, width: number): Promise<HTMLElement> {
  writeInspectorWidth(USER, width);
  renderWithProviders(
    <InspectorWidthUserContext value={USER}>
      <InspectorLayout inspector={drawer}>
        <main />
      </InspectorLayout>
    </InspectorWidthUserContext>,
  );
  const card = await screen.findByRole('complementary');
  expect(card.style.width).toBe(`${String(width)}px`);
  await within(card).findByRole('tab', { selected: true });
  await waitFor(() => expect(card.querySelector('[aria-busy="true"]')).toBeNull(), { timeout: 8000 });
  return card;
}

/** The trend's canvas: drawn at the width its box measured, inside a box as wide as the card's content. */
const isMeasuredCanvas = (node: Element): boolean =>
  node.tagName === 'CANVAS' &&
  node.parentElement?.matches('[role="img"].w-full') === true &&
  watches.some((watch) => watch.target === node.parentElement);

/**
 * A sized column of a table that fills its card. Beside a column with no width of its own, the free one takes the
 * room that is left (`w-full`); in the By platform grid every column is sized and the table is at least as wide as
 * the card (`min-w-full`), so the columns share what is over.
 */
function isColumnOfFillingTable(node: Element): boolean {
  if (node.tagName !== 'TH') return false;
  const table = node.closest('table');
  if (table === null) return false;
  if (table.classList.contains('min-w-full')) return true;
  const free = [...(node.parentElement?.children ?? [])].some((header) => sizingWidthClasses(header).length === 0);
  return table.classList.contains('w-full') && free;
}

function expectCardWide(card: HTMLElement): void {
  const tables = [...card.querySelectorAll('table')];
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) {
    expect(table.classList.contains('w-full') || table.classList.contains('min-w-full')).toBe(true);
  }
  expectNoPixelWidth(card, (node) => isMeasuredCanvas(node) || isColumnOfFillingTable(node));
}

describe.each([480, 640, 960])('The cited page drawer at %i px', (width) => {
  it.each(['overview', 'page-overview'])(
    'holds no pixel width of its own on its %s tab',
    async (tab) => {
      const card = await open(
        <PageDrawer {...SHARED} urlId={TOP_ID} tab={tab} onOpenPrompt={vi.fn()} timeZone="Europe/Berlin" />,
        width,
      );
      expectCardWide(card);
      if (tab === 'page-overview') {
        // The three figures share the card in equal columns, whatever its width
        expect(within(card).getByText('Last cited').closest('dl')).toHaveClass('grid', 'grid-cols-3');
        // A drag of the handle changes the card's width: the trend is drawn again at what its box measures
        const canvas = card.querySelector('canvas');
        const watch = watches.find((entry) => entry.target === canvas?.parentElement);
        if (canvas === null || watch === undefined) throw new Error('The trend does not watch its box');
        expect(canvas.style.width).toBe('400px');
        act(() => watch.callback(measureOf(watch.target, width - 66), watch.observer));
        expect(card.querySelector('canvas')?.style.width).toBe(`${String(width - 66)}px`);
      }
    },
    30_000,
  );
});

describe.each([480, 640, 960])('The gap drawer at %i px', (width) => {
  it.each(['overview', 'platforms'])(
    'holds no pixel width of its own on its %s tab',
    async (tab) => {
      const card = await open(
        <GapDrawer
          {...SHARED}
          competitors={tracked.slice(0, 3)}
          ownName="Fynix"
          promptId={PROMPT_ID}
          tab={tab}
          onOpenAnswers={vi.fn()}
        />,
        width,
      );
      expectCardWide(card);
      if (tab === 'overview') {
        // Open answers sits beside the title in a card of every drawer width (24 rem is under the least, 446 px)
        const action = within(card).getByRole('button', { name: 'Open answers' }).parentElement;
        expect(action).toHaveClass('basis-full', '@sm:basis-auto');
        // The page lists are drawn, so the scan read their rows: the address takes what the count leaves
        const address = card.querySelector('li > span.flex-1');
        expect(address).not.toBeNull();
      }
    },
    30_000,
  );
});
