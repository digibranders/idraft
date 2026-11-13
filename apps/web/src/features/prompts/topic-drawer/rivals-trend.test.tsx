import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RivalsTrend, rivalRoles } from './rivals-trend';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import {
  competitor,
  engine,
  entityCells,
  own,
  pool,
  topicRow,
  week,
  weighted,
} from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineSummary, SummaryEntity, TopicSummaryRow } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { readChartTokens } from '@/lib/design/read-tokens';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { DRAWER_TOPIC_ID, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

// jsdom has no canvas: the option the frame gives the chart is what these tests read
const drawn = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: (tokens: ChartTokens) => Record<string, unknown> }) => {
    drawn.options.push(option(readChartTokens()));
    return <div data-testid="echart-canvas" />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const ENTITIES_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities');
const POOL = pool(4, '2026-10-05', '2026-11-01');

const TRACKED: SummaryEntity[] = [
  own('own', 'Acme'),
  competitor('beta', 'Beta'),
  competitor('gamma', 'Gamma'),
  competitor('delta', 'Delta'),
  competitor('eps', 'Epsilon'),
  competitor('zero', 'Zero'),
];
const BODY_BASE = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  entity_config_versions: [],
  prompts: [],
};

/** How many of 10 valid answers name each entity. */
type Named = Readonly<Record<string, number>>;

/** Weighted Mentioned cells over 10 answers, each entity with k of 10 valid answers naming it. */
const cellsOf = (named: Named) => Object.entries(named).map(([id, k]) => entityCells(id, weighted(k, 10, 4)));

/** An engine with a rate, its window cells and two weekly points; the second point pools when `pooled`. */
const onEngine = (code: string, windowRows: Named, first: Named, second: Named, pooled = false): EngineSummary =>
  engine(code, {
    mentioned: weighted(5, 10, 4),
    entities: cellsOf(windowRows),
    series: [
      week('2026-10-19', { mentioned: weighted(5, 10, 4), prompts: 4, entities: cellsOf(first) }),
      week('2026-10-26', {
        mentioned: weighted(5, 10, 4),
        prompts: 4,
        entities: cellsOf(second),
        ...(pooled ? { pool: POOL } : {}),
      }),
    ],
  });

const CHATGPT = onEngine(
  'chatgpt_web',
  { own: 4, beta: 8, gamma: 5, delta: 3, eps: 1, zero: 0 },
  { own: 2, beta: 6, gamma: 5, delta: 2, eps: 1, zero: 0 },
  { own: 6, beta: 9, gamma: 4, delta: 4, eps: 1, zero: 0 },
);
const GEMINI = onEngine(
  'gemini_web',
  { own: 2, beta: 2, gamma: 7, delta: 3, eps: 5, zero: 0 },
  { own: 1, beta: 1, gamma: 6, delta: 2, eps: 4, zero: 0 },
  { own: 3, beta: 3, gamma: 8, delta: 4, eps: 4, zero: 0 },
);

const rowWith = (engines: readonly EngineSummary[]): TopicSummaryRow =>
  topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, engines);
const serve = (row: TopicSummaryRow, tracked: readonly SummaryEntity[] = TRACKED): void =>
  server.use(
    http.get(SUMMARY_PATH, () => HttpResponse.json({ data: { ...BODY_BASE, entities: tracked, topics: [row] } })),
  );
/** The colours the project stored for its entities: `[id, color_index]`. */
const colours = (rows: readonly (readonly [string, number | null])[]): void =>
  server.use(
    http.get(ENTITIES_PATH, () =>
      HttpResponse.json({ data: rows.map(([id, color]) => ({ entity: { entity_id: id }, color_index: color })) }),
    ),
  );

const lastOption = (): Record<string, unknown> => drawn.options.at(-1) ?? {};
const lineIds = (): string[] =>
  ((lastOption().series ?? []) as { id?: string; type?: string }[])
    .filter((entry) => entry.type === 'line' && entry.id !== undefined && !entry.id.includes(':'))
    .map((entry) => entry.id ?? '');
const seriesOption = (id: string): { data: unknown[] } | undefined =>
  ((lastOption().series ?? []) as { id?: string; data: unknown[] }[]).find((entry) => entry.id === id);
const valuesOf = (id: string): (number | null)[] =>
  (seriesOption(id)?.data ?? []).map((point) =>
    typeof point === 'number' ? point : point === null ? null : ((point as { value: number | null }).value ?? null),
  );

beforeEach(() => {
  drawn.options.length = 0;
  // The tests send no session, which the mock of the entities answers by signing out: they say what the project stored
  colours([]);
});
afterEach(() => {
  vi.useRealTimers();
});

const renderRivals = (
  row: TopicSummaryRow = rowWith([CHATGPT]),
  options: Parameters<typeof renderDrawerPart>[1] = {},
) => {
  serve(row);
  return renderDrawerPart(<RivalsTrend />, {
    summary: summaryOf([topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4)]),
    ...options,
  });
};

describe('RivalsTrend: the own brand against the competitors named most', () => {
  it('draws the own brand and the three most mentioned competitors', async () => {
    renderRivals();
    await screen.findByTestId('echart-canvas');
    // Beta 80, Gamma 50 and Delta 30 percent: Epsilon is fourth and Zero is not named at all
    expect(lineIds()).toEqual(['own', 'beta', 'gamma', 'delta']);
    expect(valuesOf('own')).toEqual([0.2, 0.6]);
    expect(valuesOf('beta')).toEqual([0.6, 0.9]);
    expect(seriesOption('eps')).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Visibility trend against competitors' })).toBeInTheDocument();
    expect(screen.getByText('Mention rate of the own brand and the 3 most mentioned competitors')).toBeInTheDocument();
    // The legend names the own brand as such
    expect(within(screen.getByRole('list', { name: /^Series in/ })).getByText('Acme, own brand')).toBeInTheDocument();
  });

  it('never draws a competitor with no mention', async () => {
    renderRivals();
    await screen.findByTestId('echart-canvas');
    expect(lineIds()).not.toContain('zero');
    expect(lineIds()).not.toContain('eps');
  });

  it('defaults to the average of the engines and names how many took part', async () => {
    renderRivals(rowWith([CHATGPT, GEMINI]));
    await screen.findByTestId('echart-canvas');
    expect(screen.getByRole('combobox', { name: 'Engine' })).toHaveTextContent('avg of 2 engines');
    // Gamma 50 and 70 percent average 60, Beta 80 and 20 average 50, Delta 30 and 30 average 30: Epsilon (30) is no better
    expect(lineIds()).toEqual(['own', 'gamma', 'beta', 'delta']);
    const gamma = valuesOf('gamma');
    expect(gamma[0]).toBeCloseTo(0.55, 9);
    expect(gamma[1]).toBeCloseTo(0.6, 9);
  });

  it('switches to one engine', async () => {
    const { user } = renderRivals(rowWith([CHATGPT, GEMINI]));
    await screen.findByTestId('echart-canvas');
    await user.click(screen.getByRole('combobox', { name: 'Engine' }));
    await user.click(await screen.findByRole('option', { name: 'Gemini' }));
    await waitFor(() => expect(lineIds()).toEqual(['own', 'gamma', 'eps', 'delta']));
    expect(valuesOf('gamma')).toEqual([0.6, 0.8]);
    expect(screen.getByRole('combobox', { name: 'Engine' })).toHaveTextContent('Gemini');
  });

  it('offers no average with one engine, and an engine without a series is not an option', async () => {
    renderRivals(rowWith([CHATGPT, engine('gemini_web', { mentioned: weighted(5, 10, 4) })]));
    await screen.findByTestId('echart-canvas');
    // ChatGPT alone is drawn, and there is nothing to choose between
    expect(screen.queryByRole('combobox', { name: 'Engine' })).toBeNull();
    expect(lineIds()).toEqual(['own', 'beta', 'gamma', 'delta']);
  });

  it('keeps no band on an average, and a band on one engine', async () => {
    const { user } = renderRivals(rowWith([CHATGPT, GEMINI]));
    await screen.findByTestId('echart-canvas');
    expect((seriesOption('gamma:band-low')?.data ?? []).every((point) => point === null)).toBe(true);
    await user.click(screen.getByRole('combobox', { name: 'Engine' }));
    await user.click(await screen.findByRole('option', { name: 'ChatGPT' }));
    await waitFor(() => expect(seriesOption('gamma:band-low')?.data.some((point) => point !== null)).toBe(true));
  });

  it('uses the stored colour of a competitor, in the legend', async () => {
    colours([
      ['own', 1],
      ['beta', 5],
      ['gamma', 3],
      ['delta', null],
    ]);
    renderRivals();
    await screen.findByTestId('echart-canvas');
    const legend = screen.getByRole('list', { name: /^Series in/ });
    const swatch = (name: string): string =>
      within(legend).getByText(name).closest('li')?.querySelector('[aria-hidden="true"]')?.getAttribute('style') ?? '';
    await waitFor(() => expect(swatch('Beta')).toContain('--chart-5'));
    expect(swatch('Gamma')).toContain('--chart-3');
    expect(swatch('Acme, own brand')).toContain('--chart-1');
    // A competitor with no stored colour takes the first palette colour nobody holds
    expect(swatch('Delta')).toContain('--chart-2');
  });

  it('says the C-18 sentence when a plotted point is pooled', async () => {
    const plain = renderRivals();
    await screen.findByTestId('echart-canvas');
    expect(screen.queryByText(/shows the last 4 weeks together/)).toBeNull();
    plain.unmount();
    const pooled = onEngine('chatgpt_web', { own: 4, beta: 8 }, { own: 2, beta: 6 }, { own: 6, beta: 9 }, true);
    const { user } = renderRivals(rowWith([pooled]));
    expect(await screen.findByText(/shows the last 4 weeks together/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const [, , second] = within(
      screen.getByRole('table', { name: 'Visibility trend against competitors' }),
    ).getAllByRole('row');
    expect(second).toHaveTextContent('4 weeks to Oct 26');
  });

  it('shows each cell of the table form with the answers behind it', async () => {
    const { user } = renderRivals();
    await screen.findByTestId('echart-canvas');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Visibility trend against competitors' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Week', 'Acme, own brand', 'Beta', 'Gamma', 'Delta']);
    const [, first] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('20%, 2 of 10 answers, 4 prompts');
    expect(first).toHaveTextContent('60%, 6 of 10 answers, 4 prompts');
  });

  it('says no competitor is named', async () => {
    const quiet = onEngine('chatgpt_web', { own: 4, beta: 0 }, { own: 2, beta: 0 }, { own: 6, beta: 0 });
    renderRivals(rowWith([quiet]));
    expect(await screen.findByText('No competitor named')).toBeInTheDocument();
    expect(
      screen.getByText('No tracked competitor is named in the answers of this topic on the chosen engine.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
  });

  it('says there are no weekly points yet when the row has no series', async () => {
    renderRivals(rowWith([engine('chatgpt_web', { mentioned: weighted(5, 10, 4) })]));
    expect(await screen.findByText('No weekly points yet')).toBeInTheDocument();
  });

  it('says No topic is read per topic, and reads nothing for it', async () => {
    const asked: string[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json({ data: { ...BODY_BASE, entities: TRACKED, topics: [] } });
      }),
    );
    renderDrawerPart(<RivalsTrend />, {
      topicKey: NO_TOPIC,
      summary: summaryOf([topicRow(null, null, 2, [CHATGPT])], TRACKED),
    });
    expect(await screen.findByText('Read per topic')).toBeInTheDocument();
    expect(screen.getByText('Prompts without a topic have no weekly read of competitors.')).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it('shows loading, and an error with Retry that keeps the rest of the drawer', async () => {
    let fail = true;
    server.use(
      http.get(SUMMARY_PATH, () =>
        fail
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 })
          : HttpResponse.json({ data: { ...BODY_BASE, entities: TRACKED, topics: [rowWith([CHATGPT])] } }),
      ),
    );
    const { user } = renderDrawerPart(<RivalsTrend />, {
      summary: summaryOf([topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4)]),
    });
    expect(
      screen.getByRole('heading', { name: 'Visibility trend against competitors' }).closest('section'),
    ).toHaveAttribute('aria-busy', 'true');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByTestId('echart-canvas')).toBeInTheDocument();
  });

  it('keeps the chart while it refetches', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { queryClient } = renderRivals();
    await screen.findByTestId('echart-canvas');
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await gate;
        return HttpResponse.json({ data: { ...BODY_BASE, entities: TRACKED, topics: [rowWith([CHATGPT])] } });
      }),
    );
    void queryClient.invalidateQueries();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Visibility trend against competitors' }).closest('section'),
      ).toHaveAttribute('aria-busy', 'true'),
    );
    expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
    release();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Visibility trend against competitors' }).closest('section'),
      ).not.toHaveAttribute('aria-busy'),
    );
  });
});

describe('rivalRoles: the colour each line has', () => {
  const entity = (id: string, role: 'own' | 'competitor') => ({ entityId: id, role });

  it('gives the own brand chart 1 and a competitor its stored colour', () => {
    const roles = rivalRoles(
      [entity('own', 'own'), entity('beta', 'competitor'), entity('gamma', 'competitor')],
      new Map([
        ['beta', 5],
        ['gamma', 2],
      ]),
    );
    expect(roles.get('own')).toEqual({ kind: 'brand' });
    expect(roles.get('beta')).toEqual({ kind: 'palette', index: 5 });
    expect(roles.get('gamma')).toEqual({ kind: 'palette', index: 2 });
  });

  it('gives a competitor without a stored colour the first palette colour nobody holds, in order', () => {
    const roles = rivalRoles(
      [entity('own', 'own'), entity('a', 'competitor'), entity('b', 'competitor'), entity('c', 'competitor')],
      new Map([['b', 2]]),
    );
    expect(roles.get('b')).toEqual({ kind: 'palette', index: 2 });
    expect(roles.get('a')).toEqual({ kind: 'palette', index: 3 });
    expect(roles.get('c')).toEqual({ kind: 'palette', index: 4 });
  });

  it('treats a stored colour outside chart 2 to 6 as none stored', () => {
    const roles = rivalRoles(
      [entity('own', 'own'), entity('a', 'competitor'), entity('b', 'competitor')],
      new Map([
        ['a', 1],
        ['b', 9],
      ]),
    );
    expect(roles.get('a')).toEqual({ kind: 'palette', index: 2 });
    expect(roles.get('b')).toEqual({ kind: 'palette', index: 3 });
  });
});
