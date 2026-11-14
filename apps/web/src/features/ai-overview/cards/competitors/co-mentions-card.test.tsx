import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CoMentionsCard from './co-mentions-card';
import { loadingBodyHeight } from './skeletons';
import {
  at,
  competitor,
  engine,
  entityCells,
  id,
  own,
  projectEntity,
  share,
  summaryOf,
  weighted,
} from './model/summary-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardDrill } from '../engines/use-card-seams';
import { sequentialBin } from '@/components/app/chart/heat-bins';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary, Schemas, SummaryEntity } from '@/lib/api/types';
import { setAiSeeded } from '@/mocks/ai-seed';
import { axe } from '@/test/axe';
import { cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
import { chartSummaryText } from '@/test/chart-summary';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const seam = vi.hoisted(() => ({ drill: null as CardDrill | null }));
vi.mock('../engines/use-card-seams', async (importActual) => {
  const actual = await importActual<typeof import('../engines/use-card-seams')>();
  return {
    ...actual,
    useCardDrill: (): CardDrill => {
      const real = actual.useCardDrill();
      return seam.drill ?? real;
    },
  };
});

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const ENTITIES = '*/api/v1/workspaces/:w/projects/:p/entities';
const HEADING = 'Who we are named with on ChatGPT';
const GRID = 'Answers that name two brands together on ChatGPT';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
  setAiSeeded(false);
});
afterEach(() => {
  seam.drill = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Brand {
  entity: SummaryEntity;
  /** Valid answers that name it, of `trials`. */
  k: number;
  trials?: number;
  /** The rates of its prompts, whose mean is the prompt weighted value; by default the one rate `k / trials`. */
  rates?: readonly number[];
}

const FOUR: Brand[] = [
  { entity: own(), k: 30 },
  { entity: competitor(2, 'HubSpot'), k: 50 },
  { entity: competitor(3, 'Zoho'), k: 20 },
  { entity: competitor(4, 'Asana'), k: 10 },
];

const pair = (a: number, b: number, answers: number): Schemas['CoMentionPair'] => ({ a: id(a), b: id(b), answers });
/** Fynix with HubSpot 20, Fynix with Zoho 8, HubSpot with Zoho 5; nobody is named with Asana. */
const PAIRS = [pair(1, 2, 20), pair(1, 3, 8), pair(2, 3, 5)];

/** A pairs read of one engine: the `total` block gives each brand's mentions, `co_mentions` the pairs. */
function pairsRead(
  brands: Brand[] = FOUR,
  pairs: Schemas['CoMentionPair'][] = PAIRS,
  answers = 100,
  withEngine = true,
): PromptsSummary {
  const total = engine('chatgpt_web', {
    mentioned: weighted(0, answers, [0]),
    share: share(answers, answers),
    entities: brands.map((brand) => {
      const trials = brand.trials ?? answers;
      return entityCells(
        brand.entity,
        weighted(brand.k, trials, brand.rates ?? [brand.k / trials]),
        share(brand.k, answers),
      );
    }),
  });
  return summaryOf({
    entities: brands.map((brand) => brand.entity),
    total: withEngine ? [total] : [],
    coMentions: withEngine ? [{ engine_code: 'chatgpt_web', answers, pairs }] : [],
  });
}

function serve(summary: PromptsSummary): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summary })));
}

const failing = (requestId: string): Response =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

const sink: { read: () => ExportRead } = { read: () => ({ blocks: [], loading: 0 }) };
function Reader(): ReactElement {
  const reader = useExportBlocks();
  useEffect(() => {
    sink.read = reader;
  }, [reader]);
  return <></>;
}

function renderCard(
  searchParams = 'cmp=off',
  { world = 'fynix', role = 'admin' }: { world?: OverviewWorld; role?: 'admin' | 'viewer' } = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <CoMentionsCard {...props} options={{ engine: 'chatgpt_web' }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.co_mentions', Card, world, role }), { searchParams });
}

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: GRID });

/** The printed text of every data cell, row by row (the row header is not a cell). */
const printed = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent ?? ''),
    );

const cellsOf = (table: HTMLElement): HTMLElement[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('gridcell'));

describe('the co-mentions card', () => {
  it('shows a skeleton at its height, then a symmetric matrix with you first and the percent printed in every cell', async () => {
    server.use(
      http.get(SUMMARY, async () => {
        await delay(60);
        return HttpResponse.json({ data: pairsRead() });
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    // The loading body reserves what the loaded panel needs, so the skeleton before it and the card after it match
    expect(frame?.querySelector(`[style*="height: ${loadingBodyHeight('ai.co_mentions')}px"]`)).not.toBeNull();

    const table = await grid();
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.getAttribute('aria-label')),
    ).toEqual(['Fynix (you)', 'HubSpot', 'Zoho', 'Asana']);
    const text = printed(table);
    expect(text).toEqual([
      ['30%', '20%', '8%', '0%'],
      ['20%', '50%', '5%', '0%'],
      ['8%', '5%', '20%', '0%'],
      ['0%', '0%', '0%', '10%'],
    ]);
    // Symmetric: the cell under a pair and the cell over it say the same
    for (const [row, line] of text.entries()) {
      for (const [column, value] of line.entries()) expect(at(at(text, column), row)).toBe(value);
    }
  });

  it('fills each cell with the bin of the sequential scale for its percent', async () => {
    serve(pairsRead());
    renderCard();
    const cells = cellsOf(await grid());
    expect(at(at(cells, 0), 0).className).toContain(sequentialBin(0.3).fill);
    expect(at(at(cells, 1), 1).className).toContain(sequentialBin(0.5).fill);
    expect(at(at(cells, 0), 2).className).toContain(sequentialBin(0.08).fill);
    expect(at(at(cells, 0), 3).className).toContain(sequentialBin(0).fill);
  });

  it('says in a cell tooltip that the two brands are named together in k of n answers', async () => {
    const answers = 1800;
    serve(pairsRead(FOUR, [pair(1, 2, 212), pair(1, 3, 8), pair(2, 3, 5)], answers));
    renderCard();
    const table = await grid();
    // The pair is in two cells of the symmetric matrix, and both say it the same way round
    expect(
      within(table).getAllByRole('gridcell', { name: '12%: HubSpot and you named together in 212 of 1,800 answers' }),
    ).toHaveLength(2);
    expect(
      within(table).getByRole('gridcell', { name: '0.3%: Zoho and HubSpot named together in 5 of 1,800 answers' }),
    ).toHaveTextContent('0.3%');
  });

  it('draws the diagonal as the brand answers over the valid answers of the engine', async () => {
    serve(pairsRead());
    renderCard();
    const table = await grid();
    expect(within(table).getByRole('gridcell', { name: '50%: HubSpot named in 50 of 100 answers' })).toHaveTextContent(
      '50%',
    );
    expect(within(table).getByRole('gridcell', { name: '30%: Fynix named in 30 of 100 answers' })).toBeInTheDocument();
  });

  it('says below 0.1% for 1 of 2001 answers, in the cell and its tooltip, and never 0.0%', async () => {
    serve(pairsRead(FOUR, [pair(1, 2, 1)], 2001));
    renderCard();
    const table = await grid();
    const tiny = within(table).getAllByRole('gridcell', {
      name: '<0.1%: HubSpot and you named together in 1 of 2,001 answers',
    });
    expect(tiny).toHaveLength(2);
    for (const one of tiny) expect(one).toHaveTextContent('<0.1%');
    expect(table.textContent).not.toContain('0.0%');
    expect(table.innerHTML).not.toContain('0.0%');
  });

  it('draws the diagonal as the pooled k over n, not the prompt weighted mention value (D-7)', async () => {
    // Two prompts at 90% and 10% give a prompt weighted value of 50%; the answers behind it are 30 of 100
    const brands = FOUR.map((brand) =>
      brand.entity.name === 'Fynix' ? { ...brand, k: 30, rates: [0.9, 0.1] } : brand,
    );
    serve(pairsRead(brands));
    renderCard();
    const table = await grid();
    const diagonal = within(table).getByRole('gridcell', { name: '30%: Fynix named in 30 of 100 answers' });
    expect(diagonal).toHaveTextContent('30%');
    expect(diagonal.textContent).not.toMatch(/50%/);
  });

  it('prints 0% for a pair that is absent from the pairs, as a real 0 of the answers', async () => {
    serve(pairsRead());
    renderCard();
    const table = await grid();
    const zeros = within(table).getAllByRole('gridcell', {
      name: '0%: Asana and you named together in 0 of 100 answers',
    });
    expect(zeros).toHaveLength(2);
    for (const zero of zeros) expect(zero).toHaveTextContent('0%');
  });

  it('prints n/a for a diagonal whose answers are not the valid answers of the engine', async () => {
    const brands = FOUR.map((brand) => (brand.entity.name === 'HubSpot' ? { ...brand, k: 40, trials: 80 } : brand));
    serve(pairsRead(brands));
    renderCard();
    const table = await grid();
    const diagonal = within(table).getByRole('gridcell', { name: 'HubSpot: not available' });
    expect(diagonal).toHaveTextContent('n/a');
    expect(diagonal.textContent).not.toMatch(/%/);
  });

  it('prints the answer count in every cell, and no percent, when fewer than 4 valid answers were given', async () => {
    serve(
      pairsRead(
        FOUR.map((brand) => ({ ...brand, k: 1 })),
        [pair(1, 2, 1)],
        3,
      ),
    );
    renderCard();
    const table = await grid();
    const text = printed(table).flat();
    expect(text).toHaveLength(16);
    for (const value of text) expect(value).toBe('3 ans');
    expect(
      within(table).getAllByRole('gridcell', { name: 'HubSpot and you: only 3 valid answers, 4 needed' }),
    ).toHaveLength(2);
    expect(within(table).getByRole('gridcell', { name: 'Zoho: only 3 valid answers, 4 needed' })).toBeInTheDocument();
  });

  it('prints one denominator, the valid answers of the engine, in the meta line and the footnote', async () => {
    serve(pairsRead());
    renderCard();
    await grid();
    expect(
      screen.getByText('Oct 16 to Nov 12, 2026 · 100 valid answers · branded prompts left out'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Every cell is of the same 100 valid answers on ChatGPT/)).toBeInTheDocument();
    expect(await screen.findByTestId('tracked-footnote')).toHaveTextContent('Tracked brands: you and 3 competitors.');
  });

  it('keeps the top 8 brands and says how many are not drawn', async () => {
    const ten: Brand[] = [
      { entity: own(), k: 5 },
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ entity: competitor(n, `Rival ${String(n)}`), k: 50 - n })),
    ];
    serve(pairsRead(ten, []));
    renderCard();
    const table = await grid();
    const names = within(table)
      .getAllByRole('rowheader')
      .map((header) => header.getAttribute('aria-label'));
    expect(names).toHaveLength(8);
    expect(names[0]).toBe('Fynix (you)');
    expect(names).not.toContain('Rival 10');
    expect(screen.getByText(/2 tracked brands are not drawn/)).toBeInTheDocument();
  });

  it('gives every column header its full brand name, as its name and as a title for a header cut short', async () => {
    const long = [
      { entity: own(), k: 30 },
      { entity: competitor(2, 'Brightwave CRM'), k: 50 },
      { entity: competitor(3, 'Rankforge Analytics'), k: 20 },
    ];
    serve(pairsRead(long, []));
    renderCard();
    const table = await grid();
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual([
      'Brand',
      'Fynix',
      'Brightwave CRM',
      'Rankforge Analytics',
    ]);
    for (const header of headers.slice(2)) {
      expect(within(header).getByTitle(header.textContent ?? '')).toBeInTheDocument();
    }
    // The own brand's title says it is you, as its row does
    expect(within(headers[1] as HTMLElement).getByTitle('Fynix (you)')).toBeInTheDocument();
  });

  it('keeps the grid inside its own scroll region, so a narrow card scrolls it and not the page', async () => {
    serve(pairsRead());
    renderCard();
    const table = await grid();
    const region = table.closest('.overflow-x-auto');
    expect(region).not.toBeNull();
    expect(region?.parentElement?.className).toContain('min-w-0');
  });

  it('prints each cell in words in the Table view, and the csv carries the counts', async () => {
    serve(pairsRead());
    const { user } = renderCard();
    await grid();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('grid', { name: GRID });
    const hubspot = within(table)
      .getAllByRole('row')
      .find((row) => within(row).queryByRole('rowheader', { name: 'HubSpot' }) !== null);
    expect(hubspot).toHaveTextContent('20%: HubSpot and you named together in 20 of 100 answers');
    expect(hubspot).toHaveTextContent('50%: HubSpot named in 50 of 100 answers');

    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Brand', 'Fynix', 'HubSpot', 'Zoho', 'Asana']);
    expect(block?.rows).toContainEqual([
      'HubSpot',
      '20%: HubSpot and you named together in 20 of 100 answers',
      '50%: HubSpot named in 50 of 100 answers',
      '5%: HubSpot and Zoho named together in 5 of 100 answers',
      '0%: HubSpot and Asana named together in 0 of 100 answers',
    ]);
  });

  it('writes n/a, never 0, for a cell with no answers in the export', async () => {
    const brands = FOUR.map((brand) => (brand.entity.name === 'HubSpot' ? { ...brand, k: 40, trials: 80 } : brand));
    serve(pairsRead(brands));
    renderCard();
    await grid();
    const [block] = sink.read().blocks;
    const row = block?.rows.find((candidate) => candidate[0] === 'HubSpot');
    expect(row?.[2]).toBe('n/a');
  });

  it('moves across the cells with the arrow keys, from the one tab stop of the grid', async () => {
    serve(pairsRead());
    const { user } = renderCard();
    const table = await grid();
    const stops = table.querySelectorAll('[tabindex="0"]');
    expect(stops).toHaveLength(1);
    for (let step = 0; step < 12 && !table.contains(document.activeElement); step += 1) await user.tab();
    expect(table.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(stops[0]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('30%: Fynix named in 30 of 100 answers');
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName('50%: HubSpot named in 50 of 100 answers');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAccessibleName('20%: HubSpot and you named together in 20 of 100 answers');
  });

  it('links a brand row through the drill seam, and leaves plain text where there is no page', async () => {
    seam.drill = (kind, extra) => `/digibranders/fynix/ai/${kind}?engine=${extra?.engine ?? ''}` as Route;
    serve(pairsRead());
    renderCard();
    const table = await grid();
    const links = within(table).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/digibranders/fynix/ai/prompts?engine=chatgpt_web',
      '/digibranders/fynix/ai/competitors?engine=chatgpt_web',
      '/digibranders/fynix/ai/competitors?engine=chatgpt_web',
      '/digibranders/fynix/ai/competitors?engine=chatgpt_web',
    ]);
  });

  it('has no link on a brand row where the drill seam gives no page', async () => {
    seam.drill = () => null;
    serve(pairsRead());
    renderCard();
    expect(within(await grid()).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says no valid answers, and draws no zero, when the engine has no co-mention entry', async () => {
    serve(pairsRead(FOUR, [], 100, false));
    renderCard();
    expect(await screen.findByText('No valid answers on ChatGPT in these 28 days')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('says no competitor is tracked when only the own brand is', async () => {
    serve(pairsRead([{ entity: own(), k: 30 }], []));
    renderCard();
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add competitors' })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/entities'),
    );
  });

  it('says an engine outside the engine filter is not asked', async () => {
    serve(pairsRead());
    renderCard('cmp=off&engine=gemini_web');
    expect(await screen.findByText('ChatGPT is not asked in this scope')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('tells assistive technology no figure for an engine that is not asked, and the figures for one that is', async () => {
    serve(pairsRead());
    const { unmount } = renderCard('cmp=off&engine=gemini_web');
    const outside = chartSummaryText(await screen.findByRole('heading', { level: 2, name: HEADING }));
    expect(outside).toBe('');
    expect(outside).not.toMatch(/\d|too few/i);
    unmount();
    renderCard();
    await grid();
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: HEADING }))).toMatch(
      /^Brands named in the same answer as you on ChatGPT, of \d+ valid answers: /,
    );
  });

  it('shows Retry for a failed read, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load co-mentions')).toBeInTheDocument();
    serve(pairsRead());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await grid()).toBeInTheDocument();
  });

  it('keeps the grid and says these are the last figures read when a refetch fails', async () => {
    serve(pairsRead());
    const { queryClient } = renderCard();
    await grid();
    server.use(http.get(SUMMARY, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: GRID })).toBeInTheDocument();
  });

  it('asks for the pairs of one window and never for the previous one', async () => {
    const asked: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/ai/prompts-summary')) asked.push(new URL(request.url));
    });
    serve(pairsRead());
    renderCard('');
    await grid();
    server.events.removeAllListeners();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('include')).toBe('co_mentions,entities,total');
    expect(asked[0]?.searchParams.get('rows')).toBe('none');
  });

  it('draws the card on the default mock world with a number in every cell', async () => {
    renderCard();
    const table = await grid();
    const text = printed(table);
    expect(text.length).toBeGreaterThan(1);
    for (const value of text.flat()) expect(value).toMatch(/^(\d+(\.\d)?%|n\/a|\d+ ans)$/);
    for (const [row, line] of text.entries()) {
      for (const [column, value] of line.entries()) expect(at(at(text, column), row)).toBe(value);
    }
  });

  it('shows real rows on the Eventus world', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { world: 'eventus-security' });
    const table = await grid();
    expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(1);
    await waitFor(() => {
      expect(printed(table).flat().length).toBeGreaterThan(1);
    });
    for (const value of printed(table).flat()) expect(value).toMatch(/^(\d+(\.\d)?%|n\/a|\d+ ans)$/);
  });

  it('passes axe when ready', async () => {
    serve(pairsRead());
    const { container } = renderCard();
    await grid();
    expect(await axe(container)).toHaveNoViolations();
  });
});

// The entities read: a brand's colour slot and the day it joined do not change a cell
describe('the co-mentions card tracked set', () => {
  it('names the competitors added in the window in the footnote', async () => {
    const summary = pairsRead();
    serve({ ...summary, entity_config_versions: [1, 2] });
    server.use(
      http.get(ENTITIES, () =>
        HttpResponse.json({
          data: [
            projectEntity(1, 'Fynix', { role: 'own', colorIndex: 1 }),
            projectEntity(2, 'HubSpot', { colorIndex: 2, addedAt: '2026-10-21T09:00:00Z' }),
            projectEntity(3, 'Zoho', { colorIndex: 3 }),
            projectEntity(4, 'Asana', { colorIndex: 4 }),
          ],
        }),
      ),
    );
    renderCard();
    await grid();
    const note = await screen.findByTestId('tracked-footnote');
    await waitFor(() => {
      expect(note).toHaveTextContent('Added in this window: HubSpot on Oct 21.');
    });
  });
});
