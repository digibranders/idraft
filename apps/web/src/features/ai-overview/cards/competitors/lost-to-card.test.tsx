import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LostToCard from './lost-to-card';
import { at, cell, competitor, engine, entityCells, own, promptRow, share, summaryOf } from './model/summary-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { PromptSummaryRow, PromptsSummary, SummaryEntity } from '@/lib/api/types';
import { setAiSeeded } from '@/mocks/ai-seed';
import { axe } from '@/test/axe';
import { cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
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
const TITLE = 'Prompts lost to a competitor on ChatGPT';
const ENTITIES: SummaryEntity[] = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
const listeners: ((info: { request: Request }) => void)[] = [];
/** The URLs of the requests the server sees from now on. */
function recordRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    seen.push(new URL(request.url));
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}
const summaries = (seen: readonly URL[]): URL[] => seen.filter((url) => url.pathname.endsWith('/ai/prompts-summary'));

afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  seam.drill = null;
  setAiSeeded(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One prompt on ChatGPT: `answers` valid answers, named for you in `mine`, for each competitor in its count. */
function prompt(
  n: number,
  answers: number,
  mine: number,
  named: readonly number[],
  entities: readonly SummaryEntity[] = ENTITIES,
): PromptSummaryRow {
  return promptRow(n, [
    engine('chatgpt_web', {
      mentioned: cell(mine, answers),
      share: share(mine, Math.max(answers, 1)),
      entities: entities.map((entity, index) =>
        entityCells(
          entity,
          cell(index === 0 ? mine : (named[index - 1] ?? 0), answers),
          share(0, Math.max(answers, 1)),
        ),
      ),
    }),
  ]);
}

/** HubSpot takes 3 prompts, Zoho 2, of 5 with 4 or more answers; one more prompt has 3 answers. */
const PROMPTS: PromptSummaryRow[] = [
  prompt(1, 6, 0, [3, 0]),
  prompt(2, 6, 0, [2, 1]),
  prompt(3, 6, 2, [4, 0]),
  prompt(4, 3, 0, [2, 0]),
  prompt(5, 8, 0, [0, 1]),
  prompt(6, 5, 0, [1, 0]),
];

const summary = (prompts: PromptSummaryRow[], entities: SummaryEntity[] = ENTITIES): PromptsSummary =>
  summaryOf({ entities, prompts });

function serve(body: PromptsSummary): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: body })));
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
  { rows = '5', world = 'fynix' }: { rows?: string; world?: OverviewWorld } = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <LostToCard {...props} options={{ engine: 'chatgpt_web', rows }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.lost_to_competitor', Card, world }), { searchParams });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('list', { name: TITLE });

describe('the lost to a competitor card', () => {
  it('titles the card with the engine, not with the catalog wording of the picker', async () => {
    serve(summary(PROMPTS));
    renderCard();
    expect(await screen.findByRole('heading', { name: TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /one engine/i })).not.toBeInTheDocument();
  });

  it('reads the prompt rows once with the comparison on, since it draws no comparison', async () => {
    const seen = recordRequests();
    serve(summary(PROMPTS));
    renderCard('');
    await barList();
    expect(summaries(seen)).toHaveLength(1);
  });

  it('lists the competitors by prompts lost, each with the of N context and the denominator in the meta line', async () => {
    serve(summary(PROMPTS));
    renderCard();
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(at(items, 0)).getByText('HubSpot: 3 prompts, of 5 prompts')).toBeInTheDocument();
    expect(within(at(items, 1)).getByText('Zoho: 2 prompts, of 5 prompts')).toBeInTheDocument();
    expect(
      screen.getByText('Oct 16 to Nov 12, 2026 · of 5 prompts with 4 or more valid answers · branded prompts left out'),
    ).toBeInTheDocument();
    for (const item of items) {
      expect(item.querySelector('[data-slot="bar-list-bar"]')?.className).not.toContain('bg-chart-1');
    }
    // A full bar is every prompt with enough answers: 3 of 5 and 2 of 5
    const widths = items.map((item) => item.querySelector<HTMLElement>('[data-slot="bar-list-bar"]')?.style.width);
    expect(widths).toEqual(['60%', '40%']);
  });

  it('says valid answers in the summary sentence where it names the minimum', async () => {
    serve(summary(PROMPTS));
    renderCard();
    await barList();
    expect(
      screen.getByText(/of 5 prompts with 4 or more valid answers: HubSpot 3 prompts and Zoho 2 prompts\./),
    ).toBeInTheDocument();
  });

  it('counts the prompts with too few answers in the footnote', async () => {
    serve(summary(PROMPTS));
    renderCard();
    await barList();
    expect(screen.getByText('1 prompt has fewer than 4 valid answers and is left out.')).toBeInTheDocument();
  });

  it('says no prompt is lost, with its total, when every row is a real zero', async () => {
    serve(
      summary([prompt(1, 6, 2, [3, 0]), prompt(2, 6, 1, [0, 0]), prompt(3, 8, 3, [1, 1]), prompt(4, 5, 1, [0, 1])]),
    );
    renderCard();
    expect(await screen.findByText('No prompt is lost to a competitor on ChatGPT')).toBeInTheDocument();
    expect(
      screen.getByText('In each of the 4 prompts with 4 or more valid answers, you are named or no competitor is.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
  });

  it('says no prompt has enough valid answers when every prompt is under 4 answers', async () => {
    serve(summary([prompt(1, 3, 0, [2, 0]), prompt(2, 2, 0, [1, 0])]));
    renderCard();
    expect(await screen.findByText('No prompt has enough valid answers yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
  });

  it('says there is no valid answer when no prompt row lists the engine', async () => {
    serve(summary([]));
    renderCard();
    expect(await screen.findByText('No valid answers on ChatGPT in these 28 days')).toBeInTheDocument();
  });

  it('says no competitor is tracked when only the own brand is', async () => {
    const only = [own()];
    serve(summary([prompt(1, 6, 0, [], only)], only));
    renderCard();
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
  });

  it('says in the tooltip that a competitor is named and you are not named in any answer', async () => {
    serve(summary(PROMPTS));
    const { user } = renderCard();
    const list = await barList();
    await user.hover(at(within(list).getAllByRole('listitem'), 0).firstElementChild as HTMLElement);
    expect(
      await screen.findByText(
        'HubSpot is named and you are not named in any answer of the prompt. Only prompts with 4 or more valid answers count.',
      ),
    ).toBeInTheDocument();
  });

  it('is plain text where the drill seam has no page, which is the case for competitors today', async () => {
    serve(summary(PROMPTS));
    renderCard();
    const list = await barList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('links a row with the page the drill seam gives, and keeps the focus order of the rows', async () => {
    seam.drill = (kind, extra) => `/digibranders/fynix/${kind}?engine=${extra?.engine ?? ''}` as Route;
    serve(summary(PROMPTS));
    const { user } = renderCard();
    const list = await barList();
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(at(links, 0)).toHaveAttribute('href', '/digibranders/fynix/competitors?engine=chatgpt_web');
    for (const link of links) {
      for (let step = 0; step < 15 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });

  it('cuts the rows at the rows option, counts the rest in the Table view and lists every row there', async () => {
    const many = [own(), ...[2, 3, 4, 5, 6, 7].map((n) => competitor(n, `Rival ${String(n)}`))];
    serve(
      summary(
        [1, 2, 3, 4, 5, 6].map((n) =>
          prompt(
            n,
            6,
            0,
            [0, 0, 0, 0, 0, 0].map((_, index) => (index + 1 === n ? 1 : 0)),
            many,
          ),
        ),
        many,
      ),
    );
    const { user } = renderCard('cmp=off', { rows: '5' });
    const list = await barList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('1 more competitor is in the Table view.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
  });

  it('registers the rows it shows for the export under the layout item id, with a status', async () => {
    serve(summary(PROMPTS));
    renderCard();
    await barList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Competitor', 'Prompts lost', 'Of prompts with enough valid answers', 'Status']);
    expect(block?.rows).toEqual([
      ['HubSpot', '3 prompts', 'of 5 prompts', 'Read'],
      ['Zoho', '2 prompts', 'of 5 prompts', 'Read'],
    ]);
  });

  it('shows Retry for a failed read, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load prompts lost to a competitor')).toBeInTheDocument();
    serve(summary(PROMPTS));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('shows real rows on the Eventus world', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { rows: '10', world: 'eventus-security' });
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toHaveTextContent(/\d+ prompts?, of \d+ prompts/);
  });

  it('passes axe when ready', async () => {
    serve(summary(PROMPTS));
    const { container } = renderCard();
    await barList();
    expect(await axe(container)).toHaveNoViolations();
  });
});
