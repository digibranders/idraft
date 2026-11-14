import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  at,
  cell,
  competitor,
  engine,
  entityCells,
  own,
  projectEntity,
  promptRow,
  share,
  summaryOf,
  weighted,
} from './model/summary-fixtures';
import ShareOfVoiceCard from './share-of-voice-card';
import { loadingBodyHeight } from './skeletons';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { useOverview } from '../../overview-context';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, PromptsSummary, SummaryEntity } from '@/lib/api/types';
import { formatPercent } from '@/lib/format';
import { engineRates } from '@/lib/rates/strip-model';
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
const CURRENT_FROM = '2026-10-16';
/** The heading is the engine title, never the catalog wording of the engine picker. */
const HEADING = 'Share of voice on ChatGPT';
const TITLE = 'Share of voice on ChatGPT';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  seam.drill = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The answers that name each brand of `THREE`, of the valid answers. */
const MENTIONS = [30, 65, 30];

/** One engine total: `numerators` of the tracked brands over `answers` that name one, `valid` answers in all. */
function totalOf(entities: readonly SummaryEntity[], numerators: readonly number[], answers: number, valid = 120) {
  const cells = entities.map((entity, index) =>
    entityCells(entity, weighted(MENTIONS[index] ?? 10, valid, [0.3, 0.2]), share(numerators[index] ?? 0, answers)),
  );
  const ownNumerator = numerators[0] ?? 0;
  return engine('chatgpt_web', {
    mentioned: weighted(30, valid, [0.3, 0.2]),
    share: share(ownNumerator, answers),
    entities: cells,
  });
}

const THREE = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')];

/** You 25, HubSpot 50, Zoho 25 of 100 answers naming a tracked brand. */
function summary(
  over: { versions?: number[]; total?: EngineSummary[]; entities?: SummaryEntity[] } = {},
): PromptsSummary {
  const entities = over.entities ?? THREE;
  return summaryOf({
    entities,
    total: over.total ?? [totalOf(entities, [25, 50, 25], 100)],
    versions: over.versions ?? [1],
  });
}

function serve(current: PromptsSummary, previous: PromptsSummary | null = null): void {
  server.use(
    http.get(SUMMARY, ({ request }) => {
      const asked = new URL(request.url).searchParams.get('from') === CURRENT_FROM ? current : (previous ?? current);
      return HttpResponse.json({ data: asked });
    }),
  );
}

function serveEntities(rows: ReturnType<typeof projectEntity>[]): void {
  server.use(http.get(ENTITIES, () => HttpResponse.json({ data: rows })));
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
  {
    rows = '5',
    world = 'fynix',
    role = 'admin',
  }: { rows?: string; world?: OverviewWorld; role?: 'admin' | 'viewer' } = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <ShareOfVoiceCard {...props} options={{ engine: 'chatgpt_web', rows }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.share_of_voice', Card, world, role }), { searchParams });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('list', { name: TITLE });

describe('the share of voice card', () => {
  it('shows a skeleton at its height, then the entities ranked by share of voice with you in chart-1', async () => {
    server.use(
      http.get(SUMMARY, async () => {
        await delay(60);
        return HttpResponse.json({ data: summary() });
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    // The loading body reserves what the loaded panel needs, so the skeleton before it and the card after it match
    expect(frame?.querySelector(`[style*="height: ${loadingBodyHeight('ai.share_of_voice')}px"]`)).not.toBeNull();
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('HubSpot'),
      expect.stringContaining('Fynix'),
      expect.stringContaining('Zoho'),
    ]);
    const fills = items.map((item) => item.querySelector('[data-slot="bar-list-bar"]')?.className ?? '');
    expect(at(fills, 1)).toContain('bg-chart-1');
    expect(at(fills, 0)).not.toContain('bg-chart-1');
    expect(at(fills, 2)).not.toContain('bg-chart-1');
  });

  it('prints every row percent with the count of answers it is named in, and the denominator in the meta line', async () => {
    serve(summary());
    renderCard();
    const list = await barList();
    expect(within(list).getByText('HubSpot: 50% share of voice, named in 65 of 120 answers')).toBeInTheDocument();
    expect(within(list).getByText('Fynix: 25% share of voice, named in 30 of 120 answers')).toBeInTheDocument();
    expect(
      screen.getByText('Oct 16 to Nov 12, 2026 · of 100 answers naming a tracked brand · branded prompts left out'),
    ).toBeInTheDocument();
  });

  it('names the tracked set and the days competitors were added in the footnote', async () => {
    serve(summary({ versions: [1, 2] }));
    serveEntities([
      projectEntity(1, 'Fynix', { role: 'own', colorIndex: 1 }),
      projectEntity(2, 'HubSpot', { colorIndex: 2, addedAt: '2026-10-21T09:00:00Z' }),
      projectEntity(3, 'Zoho', { colorIndex: 3, addedAt: '2026-01-05T09:00:00Z' }),
    ]);
    renderCard();
    await barList();
    const note = await screen.findByTestId('tracked-footnote');
    expect(note).toHaveTextContent('Tracked brands: you and 2 competitors.');
    await waitFor(() => {
      expect(note).toHaveTextContent('Added in this window: HubSpot on Oct 21.');
    });
  });

  it('says the tracked set changed when the set changed and no day is known', async () => {
    serve(summary({ versions: [1, 2] }));
    serveEntities([]);
    renderCard();
    await barList();
    expect(await screen.findByTestId('tracked-footnote')).toHaveTextContent('The tracked set changed in this window');
  });

  it('shows the too few sentence with the count when fewer than 4 answers name a tracked brand', async () => {
    serve(summary({ total: [totalOf(THREE, [1, 1, 1], 3)] }));
    renderCard();
    expect(await screen.findByText('Too few answers name a tracked brand (3)')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
  });

  it('says there is no valid answer, and draws no zero, when the summary does not list the engine', async () => {
    serve(summary({ total: [] }));
    renderCard();
    expect(await screen.findByText('No valid answers on ChatGPT in these 28 days')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('says an engine outside the engine filter is not asked', async () => {
    serve(summary());
    renderCard('cmp=off&engine=gemini_web');
    expect(await screen.findByText('ChatGPT is not asked in this scope')).toBeInTheDocument();
    expect(screen.getByText(/outside the engine filter/)).toBeInTheDocument();
  });

  it('tells assistive technology no figure for an engine that is not asked, and the figures for one that is', async () => {
    serve(summary());
    const { unmount } = renderCard('cmp=off&engine=gemini_web');
    const outside = chartSummaryText(await screen.findByRole('heading', { level: 2, name: HEADING }));
    expect(outside).toBe('');
    expect(outside).not.toMatch(/\d|too few/i);
    unmount();
    renderCard();
    await barList();
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: HEADING }))).toMatch(
      /^Share of voice on ChatGPT, of 100 answers that name a tracked brand: HubSpot 50%/,
    );
  });

  it('is not mounted by the page for an engine that is off, which says so itself', async () => {
    renderCard('cmp=off', { world: 'cleanstart' });
    expect(await screen.findByText('1 card of this layout is not available in this project.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: HEADING })).not.toBeInTheDocument();
  });

  it('says no competitor is tracked when only the own brand is, with a link to entities for an editor', async () => {
    const only = [own()];
    serve(summaryOf({ entities: only, total: [totalOf(only, [100], 100)] }));
    renderCard();
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add competitors' })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/entities'),
    );
  });

  it('gives a viewer the sentence to ask an editor and no link when no competitor is tracked', async () => {
    const only = [own()];
    serve(summaryOf({ entities: only, total: [totalOf(only, [100], 100)] }));
    renderCard('cmp=off', { role: 'viewer' });
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add competitors' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask a member who can edit entities/)).toBeInTheDocument();
  });

  it('never colours a share change, and shows none when the previous window has no answers', async () => {
    const before = summary({ total: [totalOf(THREE, [20, 55, 25], 100)] });
    serve(summary(), before);
    renderCard('');
    const list = await barList();
    const change = await within(list).findByText('+5.0 pts');
    expect(change.className).toContain('text-foreground-secondary');
    expect(change.className).not.toContain('positive');
    expect(change.className).not.toContain('negative');
  });

  it('drops the changes and says so when the previous window has no answer on the engine', async () => {
    serve(summary(), summary({ total: [] }));
    renderCard('');
    const list = await barList();
    expect(within(list).queryByText(/pts/)).not.toBeInTheDocument();
    expect(await screen.findByText('No comparison: the previous period has no answers')).toBeInTheDocument();
  });

  it('drops the changes and says so when the previous window could not be read', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('from') === CURRENT_FROM
          ? HttpResponse.json({ data: summary() })
          : failing('req-previous'),
      ),
    );
    renderCard('');
    const list = await barList();
    expect(within(list).queryByText(/pts/)).not.toBeInTheDocument();
    expect(await screen.findByText('No comparison: the previous period could not be read')).toBeInTheDocument();
  });

  it('shows no number, never 0, for a tracked brand with no cell, in the Table view and in the export', async () => {
    const cells = [
      entityCells(THREE[0] as SummaryEntity, weighted(30, 120, [0.3, 0.2]), share(25, 100)),
      entityCells(THREE[1] as SummaryEntity, weighted(65, 120, [0.3, 0.2]), share(75, 100)),
    ];
    const chatgpt = engine('chatgpt_web', {
      mentioned: weighted(30, 120, [0.3, 0.2]),
      share: share(25, 100),
      entities: cells,
    });
    serve(summaryOf({ entities: THREE, total: [chatgpt] }));
    const { user } = renderCard();
    const list = await barList();
    expect(within(list).getByText('Zoho: share of voice not available')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    const zoho = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Zoho'));
    expect(zoho).toHaveTextContent('ZohoNo data');
    expect(zoho?.textContent).not.toMatch(/0%/);
    const [block] = sink.read().blocks;
    expect(block?.rows).toContainEqual(['Zoho', null, null, 'Not available']);
  });

  it('sums the shares and the answers over the prompt rows when the read has no total block', async () => {
    const pair = [own(), competitor(2, 'HubSpot')];
    /** One prompt: `own` and `rival` of its `answers` naming a tracked brand, the answers also valid answers. */
    const rowOf = (n: number, mine: number, rival: number, answers: number) =>
      promptRow(n, [
        engine('chatgpt_web', {
          mentioned: cell(mine, answers),
          share: share(mine + rival, answers),
          entities: [
            entityCells(pair[0] as SummaryEntity, cell(mine, answers), share(mine, answers)),
            entityCells(pair[1] as SummaryEntity, cell(rival, answers), share(rival, answers)),
          ],
        }),
      ]);
    // 5 of 10 and 9 of 90: the mean of the two prompt shares is 30%, the sum over the sum is 14 of 100
    serve(summaryOf({ entities: pair, prompts: [rowOf(1, 5, 5, 10), rowOf(2, 9, 81, 90)] }));
    renderCard();
    const list = await barList();
    expect(within(list).getByText('Fynix: 14% share of voice, named in 14 of 100 answers')).toBeInTheDocument();
    expect(within(list).getByText('HubSpot: 86% share of voice, named in 86 of 100 answers')).toBeInTheDocument();
    expect(
      screen.getByText('Oct 16 to Nov 12, 2026 · of 100 answers naming a tracked brand · branded prompts left out'),
    ).toBeInTheDocument();
  });

  it('draws no change while the previous read is still of the scope before a scope change', async () => {
    const before = summary({ total: [totalOf(THREE, [20, 55, 25], 100)] });
    const after = summary({ total: [totalOf(THREE, [40, 35, 25], 100)] });
    const afterBefore = summary({ total: [totalOf(THREE, [30, 45, 25], 100)] });
    let phase: 'first' | 'changed' = 'first';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        const current = new URL(request.url).searchParams.get('from') === CURRENT_FROM;
        if (current) return HttpResponse.json({ data: phase === 'first' ? summary() : after });
        // The previous window of the new scope answers late
        if (phase === 'changed') await gate;
        return HttpResponse.json({ data: phase === 'first' ? before : afterBefore });
      }),
    );
    function ScopeButton(): ReactElement {
      const { setScope } = useOverview();
      return (
        <button
          type="button"
          onClick={() => {
            phase = 'changed';
            setScope({ branded: 'included' });
          }}
        >
          Include branded
        </button>
      );
    }
    const Card = (props: CardProps): ReactElement => (
      <>
        <ScopeButton />
        <ShareOfVoiceCard {...props} options={{ engine: 'chatgpt_web', rows: '5' }} />
      </>
    );
    const { user } = renderWithProviders(cardInOverview({ type: 'ai.share_of_voice', Card }), { searchParams: '' });
    const list = await barList();
    expect(await within(list).findByText('+5.0 pts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Include branded' }));
    // The new current read is in, the previous one still holds the old scope: no change against it
    expect(await screen.findByText(/branded prompts included/)).toBeInTheDocument();
    expect(within(await barList()).queryByText(/pts/)).not.toBeInTheDocument();

    release();
    expect(await within(await barList()).findByText('+10.0 pts')).toBeInTheDocument();
  });

  it('lists the same rows with their counts in the Table view', async () => {
    serve(summary());
    const { user } = renderCard();
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(at(rows, 1)).toHaveTextContent('HubSpot50%named in 65 of 120 answers');
    expect(at(rows, 2)).toHaveTextContent('Fynix25%named in 30 of 120 answers');
  });

  it('shows Retry for a failed read, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load share of voice')).toBeInTheDocument();
    serve(summary());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('keeps the rows and says these are the last figures read when a refetch fails', async () => {
    serve(summary());
    const { queryClient } = renderCard();
    await barList();
    server.use(http.get(SUMMARY, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: TITLE })).toBeInTheDocument();
  });

  it('shows the own brand below the top rows when it ranks lower, and counts the rest in the Table view', async () => {
    const seven = [own(), ...[2, 3, 4, 5, 6, 7].map((n) => competitor(n, `Rival ${String(n)}`))];
    serve(summary({ entities: seven, total: [totalOf(seven, [3, 30, 25, 20, 10, 6, 6], 100)] }));
    renderCard('cmp=off', { rows: '5' });
    const list = await barList();
    const labels = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent);
    expect(labels).toEqual(['Rival 2', 'Rival 3', 'Rival 4', 'Rival 5', 'Rival 6', 'Fynix']);
    expect(screen.getByText('1 more tracked brand is in the Table view.')).toBeInTheDocument();
  });

  it('links a row through the drill seam and keeps the focus order of the rows', async () => {
    seam.drill = (kind, extra) => `/digibranders/fynix/ai/${kind}?engine=${extra?.engine ?? ''}` as Route;
    serve(summary());
    const { user } = renderCard();
    const list = await barList();
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      for (let step = 0; step < 15 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });

  it('leaves a row as plain text where the drill seam has no page', async () => {
    seam.drill = () => null;
    serve(summary());
    renderCard();
    const list = await barList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the same percent as the strip for the same engine and scope', async () => {
    const rows = [promptRow(1, [engine('chatgpt_web', { mentioned: cell(30, 120), share: share(25, 100) })])];
    const strip = engineRates(rows, 'chatgpt_web').shareOfVoice;
    serve(summary());
    renderCard();
    const list = await barList();
    const text = formatPercent(strip.value, { decimals: 0 });
    expect(text).toBe('25%');
    expect(within(list).getByText(`Fynix: ${text} share of voice, named in 30 of 120 answers`)).toBeInTheDocument();
  });

  it('registers every row for the export under the layout item id, with a status', async () => {
    serve(summary());
    renderCard();
    await barList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Brand', 'Share of voice', 'Named in', 'Status']);
    expect(block?.rows).toEqual([
      ['HubSpot', '50%', 'named in 65 of 120 answers', 'Read'],
      ['Fynix', '25%', 'named in 30 of 120 answers', 'Read'],
      ['Zoho', '25%', 'named in 30 of 120 answers', 'Read'],
    ]);
  });

  it('passes axe when ready', async () => {
    serve(summary());
    const { container } = renderCard();
    await barList();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws the card on the default mock world with a number and a count on every row', async () => {
    renderCard('cmp=off', { rows: '10' });
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item).toHaveTextContent(/%.*named in [\d,]+ of [\d,]+ answers/);
  });
});
