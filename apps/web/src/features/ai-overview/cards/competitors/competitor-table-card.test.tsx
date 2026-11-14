import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CompetitorTableCard from './competitor-table-card';
import { loadingBodyHeight } from './skeletons';
import {
  at,
  cell,
  competitor,
  engine,
  entityCells,
  own,
  promptRow,
  share,
  summaryOf,
  weighted,
} from './model/summary-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, PromptsSummary, SummaryEntity } from '@/lib/api/types';
import { formatPercent, formatPointsDelta } from '@/lib/format';
import { engineRates } from '@/lib/rates/strip-model';
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
const CURRENT_FROM = '2026-10-16';
const HEADING = 'Mention rate by engine';
const SHARE_HEADING = 'Share of voice by engine';
const TABLE = 'Mention rate of each tracked brand on each engine';
const SHARE_TABLE = 'Share of voice of each tracked brand on each engine';
/** The column header, short; its full words are the header's description, the Table view's engine and the export's. */
const AVERAGE = 'Average';
const AVERAGE_FULL = 'Average of 2 engines, equal weight';

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

const THREE = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')];

/** What one engine says: `mentions` of the `valid` answers name each brand; `numerators` of `named` answers share the voice. */
interface EngineSpec {
  code: string;
  valid: number;
  mentions: readonly number[];
  named: number;
  numerators: readonly number[];
}

/** ChatGPT: you 25%, HubSpot 54%, Zoho 17% of 120 answers. Gemini: you 75%, HubSpot 50%, Zoho 10% of 20. */
const CHATGPT: EngineSpec = {
  code: 'chatgpt_web',
  valid: 120,
  mentions: [30, 65, 20],
  named: 100,
  numerators: [30, 40, 30],
};
const GEMINI: EngineSpec = { code: 'gemini_web', valid: 20, mentions: [15, 10, 2], named: 20, numerators: [10, 6, 4] };

function totalOf(
  spec: EngineSpec,
  entities: readonly SummaryEntity[] = THREE,
  skip: readonly string[] = [],
): EngineSummary {
  const rates = (k: number): number[] => [k / spec.valid];
  return engine(spec.code, {
    mentioned: weighted(spec.mentions[0] ?? 0, spec.valid, rates(spec.mentions[0] ?? 0)),
    share: share(spec.numerators[0] ?? 0, spec.named),
    entities: entities.flatMap((entity, index) =>
      skip.includes(entity.name)
        ? []
        : [
            entityCells(
              entity,
              weighted(spec.mentions[index] ?? 1, spec.valid, rates(spec.mentions[index] ?? 1)),
              share(spec.numerators[index] ?? 0, spec.named),
            ),
          ],
    ),
  });
}

function summary(
  specs: readonly EngineSpec[] = [CHATGPT, GEMINI],
  entities: readonly SummaryEntity[] = THREE,
  skip: readonly string[] = [],
): PromptsSummary {
  return summaryOf({ entities: [...entities], total: specs.map((spec) => totalOf(spec, entities, skip)) });
}

function serve(current: PromptsSummary, previous: PromptsSummary | null = null): void {
  server.use(
    http.get(SUMMARY, ({ request }) => {
      const asked = new URL(request.url).searchParams.get('from') === CURRENT_FROM ? current : (previous ?? current);
      return HttpResponse.json({ data: asked });
    }),
  );
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
    metric = 'mention',
    rows = '5',
    world = 'fynix',
    role = 'admin',
  }: { metric?: string; rows?: string; world?: OverviewWorld; role?: 'admin' | 'viewer' } = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <CompetitorTableCard {...props} options={{ metric, rows }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.competitor_table', Card, world, role }), { searchParams });
}

const table = (name: string = TABLE): Promise<HTMLElement> => screen.findByRole('table', { name });

/** The drawn label of each header; a header's description sits in a hidden node after it. */
const headers = (element: HTMLElement): string[] =>
  within(element)
    .getAllByRole('columnheader')
    .map((header) => header.firstChild?.textContent ?? '');

/** The body rows: the brand and what each other column says. */
const bodyRows = (element: HTMLElement): HTMLElement[] => within(element).getAllByRole('row').slice(1);

const brandOf = (row: HTMLElement): string => within(row).getByRole('rowheader').textContent ?? '';

/** The cell of a brand under a column, found by the header it sits under. */
function cellAt(element: HTMLElement, brand: string, column: string): HTMLElement {
  const index = headers(element).indexOf(column);
  const row = bodyRows(element).find((candidate) => brandOf(candidate).includes(brand));
  if (index < 1 || row === undefined) throw new Error(`No cell of ${brand} under ${column}`);
  return at(within(row).getAllByRole('cell'), index - 1);
}

describe('the competitor table card', () => {
  it('shows a skeleton at its height, then one row per brand with you first and one column per engine in scope', async () => {
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
    expect(frame?.querySelector(`[style*="height: ${loadingBodyHeight('ai.competitor_table')}px"]`)).not.toBeNull();

    const element = await table();
    expect(headers(element)).toEqual(['Brand', 'ChatGPT', 'Gemini', AVERAGE]);
    expect(bodyRows(element).map((row) => brandOf(row))).toEqual(['Fynix (you)', 'HubSpot', 'Zoho']);
    expect(cellAt(element, 'Fynix', 'ChatGPT')).toHaveTextContent('25%');
    expect(cellAt(element, 'HubSpot', 'ChatGPT')).toHaveTextContent('54%');
    expect(cellAt(element, 'Zoho', 'Gemini')).toHaveTextContent('10%');
  });

  it('keeps the brands after you in the order of the metric, by the equal weight mean of the engines', async () => {
    // Zoho leads on ChatGPT alone, HubSpot leads on the mean of both engines
    const chatgpt: EngineSpec = { ...CHATGPT, mentions: [30, 40, 70] };
    const gemini: EngineSpec = { ...GEMINI, mentions: [15, 18, 2] };
    serve(summary([chatgpt, gemini]));
    renderCard();
    const element = await table();
    expect(bodyRows(element).map((row) => brandOf(row))).toEqual(['Fynix (you)', 'HubSpot', 'Zoho']);
  });

  it('orders by the displayed average: a brand with a figure on one engine only does not outrank a lower full mean', async () => {
    // HubSpot has 90% on ChatGPT and nothing on Gemini (its average is n/a); Zoho has 40% on both
    const chatgpt: EngineSpec = { ...CHATGPT, mentions: [30, 108, 48] };
    const gemini: EngineSpec = { ...GEMINI, mentions: [15, 10, 8] };
    serve(
      summaryOf({
        entities: [...THREE],
        total: [totalOf(chatgpt), totalOf(gemini, THREE, ['HubSpot'])],
      }),
    );
    renderCard();
    const element = await table();
    expect(cellAt(element, 'HubSpot', AVERAGE)).toHaveTextContent('n/a');
    expect(cellAt(element, 'Zoho', AVERAGE)).toHaveTextContent('40%');
    expect(bodyRows(element).map((row) => brandOf(row))).toEqual(['Fynix (you)', 'Zoho', 'HubSpot']);
  });

  it('says in a footnote that brands after you are ordered by the Average column, and that none comes last', async () => {
    serve(summary());
    renderCard();
    await table();
    expect(
      screen.getByText('Brands after you are ordered by the Average column; a brand without an average comes last.'),
    ).toBeVisible();
  });

  it('orders by the one engine that has answers, and says it is the value in the column', async () => {
    const chatgpt: EngineSpec = { ...CHATGPT, mentions: [30, 40, 70] };
    serve(summary([chatgpt]));
    renderCard();
    const element = await table();
    expect(bodyRows(element).map((row) => brandOf(row))).toEqual(['Fynix (you)', 'Zoho', 'HubSpot']);
    expect(screen.getByText('Brands after you are ordered by the value in the column.')).toBeVisible();
    expect(screen.queryByText(/ordered by the Average column/)).not.toBeInTheDocument();
  });

  it('says below 0.1% for 1 of 2001 answers, in the table, the Table view and the export, and never 0.0%', async () => {
    const spec: EngineSpec = { ...CHATGPT, valid: 2001, mentions: [1000, 1, 600], named: 2001, numerators: [1, 1, 1] };
    serve(summary([spec]));
    const { user } = renderCard('cmp=off&engine=chatgpt_web');
    const element = await table();
    expect(cellAt(element, 'HubSpot', 'ChatGPT')).toHaveTextContent('<0.1%named in 1 of 2,001 answers');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const long = await screen.findByRole('table', { name: 'Mention rate by brand and engine, one row for each' });
    expect(long).toHaveTextContent('HubSpotChatGPT<0.1%');
    expect(document.body.innerHTML).not.toContain('0.0%');
    const [block] = sink.read().blocks;
    expect(block?.rows).toContainEqual(['HubSpot', 'ChatGPT', '<0.1%', 'named in 1 of 2,001 answers', null, 'Read']);
    expect(JSON.stringify(block?.rows)).not.toContain('0.0%');
  });

  it('prints the mention rate with its count line, and the share of voice with its denominator, as the metric option says', async () => {
    serve(summary());
    renderCard('cmp=off', { metric: 'mention' });
    const mention = await table();
    expect(cellAt(mention, 'HubSpot', 'ChatGPT')).toHaveTextContent('54%named in 65 of 120 answers');
    expect(cellAt(mention, 'HubSpot', 'Gemini')).toHaveTextContent('50%named in 10 of 20 answers');
  });

  it('prints share of voice with the answers naming a tracked brand when the metric option is share of voice', async () => {
    serve(summary());
    renderCard('cmp=off', { metric: 'share_of_voice' });
    expect(await screen.findByRole('heading', { name: SHARE_HEADING })).toBeInTheDocument();
    const element = await table(SHARE_TABLE);
    expect(cellAt(element, 'HubSpot', 'ChatGPT')).toHaveTextContent('40%of 100 answers naming a tracked brand');
    expect(cellAt(element, 'HubSpot', 'Gemini')).toHaveTextContent('30%of 20 answers naming a tracked brand');
    expect(within(element).queryByText(/named in/)).not.toBeInTheDocument();
  });

  it('labels the average column equal weight, and takes the plain mean of the engines whatever their answers', async () => {
    serve(summary());
    renderCard();
    const element = await table();
    // Fynix: 25% of 120 answers and 75% of 20: the mean is 50%, where answers weighting would say 32%
    expect(cellAt(element, 'Fynix', AVERAGE)).toHaveTextContent('50%mean of 2 engines');
    expect(cellAt(element, 'Zoho', AVERAGE)).toHaveTextContent('13%mean of 2 engines');
  });

  it('has no average column with one engine in scope', async () => {
    serve(summary());
    renderCard('cmp=off&engine=chatgpt_web');
    const element = await table();
    expect(headers(element)).toEqual(['Brand', 'ChatGPT']);
    expect(screen.queryByText(/equal weight/)).not.toBeInTheDocument();
  });

  it('draws the two engines of an engine filter with two columns and the average', async () => {
    serve(summary());
    renderCard('cmp=off&engine=chatgpt_web,gemini_web');
    expect(headers(await table())).toEqual(['Brand', 'ChatGPT', 'Gemini', AVERAGE]);
  });

  it('colours a mention change only when it is larger than normal variation', async () => {
    const before = summary([{ ...CHATGPT, mentions: [10, 66, 20] }, GEMINI]);
    serve(summary(), before);
    renderCard('');
    const element = await table();
    const you = within(cellAt(element, 'Fynix', 'ChatGPT')).getByText('+16.7 pts');
    expect(you.className).toContain('text-positive-text');
    // 65 of 120 against 66 of 120: inside normal variation
    const hubspot = within(cellAt(element, 'HubSpot', 'ChatGPT')).getByText(formatPointsDelta(65 / 120 - 66 / 120));
    expect(hubspot.className).toContain('text-foreground-secondary');
    expect(hubspot.className).not.toContain('positive');
    expect(hubspot.className).not.toContain('negative');
  });

  it('never colours a share of voice change, however large', async () => {
    const before = summary([{ ...CHATGPT, numerators: [10, 60, 30] }, GEMINI]);
    serve(summary(), before);
    renderCard('', { metric: 'share_of_voice' });
    const element = await table(SHARE_TABLE);
    const change = within(cellAt(element, 'Fynix', 'ChatGPT')).getByText('+20.0 pts');
    expect(change.className).toContain('text-foreground-secondary');
    expect(change.className).not.toContain('positive');
    expect(change.className).not.toContain('negative');
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
    const element = await table();
    expect(within(element).queryByText(/pts/)).not.toBeInTheDocument();
    expect(await screen.findByText('No comparison: the previous period could not be read')).toBeInTheDocument();
  });

  it('drops the changes of an engine whose previous window has no answer, and keeps those of the other', async () => {
    const before = summary([{ ...CHATGPT, mentions: [10, 66, 20] }]);
    serve(summary(), before);
    renderCard('');
    const element = await table();
    expect(within(cellAt(element, 'Fynix', 'ChatGPT')).getByText('+16.7 pts')).toBeInTheDocument();
    expect(within(cellAt(element, 'Fynix', 'Gemini')).queryByText(/pts/)).not.toBeInTheDocument();
  });

  it('shows no change with the comparison off, whatever the window before holds', async () => {
    serve(summary(), summary([{ ...CHATGPT, mentions: [10, 66, 20] }, GEMINI]));
    renderCard('cmp=off');
    const element = await table();
    expect(within(element).queryByText(/pts/)).not.toBeInTheDocument();
  });

  it('shows No answers, never 0, for an engine column without a valid answer', async () => {
    serve(summary([CHATGPT]));
    renderCard();
    const element = await table();
    expect(headers(element)).toEqual(['Brand', 'ChatGPT', 'Gemini']);
    for (const row of bodyRows(element)) expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('No answers');
    expect(within(element).queryByText(/0%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/equal weight/)).not.toBeInTheDocument();
  });

  it('shows n/a, never 0, for a brand the engine read has no figure for', async () => {
    serve(summary([CHATGPT, GEMINI], THREE, ['Zoho']));
    renderCard();
    const element = await table();
    expect(cellAt(element, 'Zoho', 'ChatGPT')).toHaveTextContent('n/a');
    expect(cellAt(element, 'Zoho', AVERAGE)).toHaveTextContent('n/a');
    expect(cellAt(element, 'Zoho', 'ChatGPT').textContent).not.toMatch(/0%/);
  });

  it('says too few, with the count, and prints no percent, for an engine with under 4 valid answers', async () => {
    const thin: EngineSpec = { code: 'gemini_web', valid: 3, mentions: [1, 1, 0], named: 3, numerators: [1, 1, 1] };
    serve(summary([CHATGPT, thin]));
    renderCard();
    const element = await table();
    expect(cellAt(element, 'HubSpot', 'Gemini')).toHaveTextContent('Too few3 answers, 4 needed');
    expect(cellAt(element, 'HubSpot', 'Gemini').textContent).not.toMatch(/%/);
    expect(cellAt(element, 'HubSpot', AVERAGE)).toHaveTextContent('n/a');
  });

  it('cuts the rows at the option and says how many more brands are tracked', async () => {
    const seven = [own(), ...[2, 3, 4, 5, 6, 7].map((n) => competitor(n, `Rival ${String(n)}`))];
    const spec: EngineSpec = {
      ...CHATGPT,
      mentions: [30, 70, 60, 50, 40, 20, 10],
      numerators: [30, 20, 15, 15, 10, 5, 5],
    };
    serve(summary([spec], seven));
    renderCard('cmp=off', { rows: '5' });
    const element = await table();
    expect(bodyRows(element).map((row) => brandOf(row))).toEqual([
      'Fynix (you)',
      'Rival 2',
      'Rival 3',
      'Rival 4',
      'Rival 5',
    ]);
    expect(screen.getByText('2 more tracked brands are in the Table view.')).toBeInTheDocument();
  });

  it('has a caption, column headers and a region of its own that scrolls, so a narrow screen never scrolls the page', async () => {
    serve(summary());
    renderCard();
    const element = await table();
    expect(element.querySelector('caption')).toHaveTextContent(TABLE);
    expect(within(element).getAllByRole('columnheader')).toHaveLength(4);
    expect(element.parentElement?.className).toContain('overflow-x-auto');
  });

  it('names the average column Average and carries the full equal weight words as its description', async () => {
    serve(summary());
    renderCard();
    await table();
    expect(screen.getByRole('columnheader', { name: AVERAGE, description: AVERAGE_FULL })).toBeInTheDocument();
    // The footnote keeps its sentence
    expect(screen.getByText(/The last column is the plain mean of the engines/)).toBeVisible();
  });

  it('puts the value and its change on one line, with the count on the line below', async () => {
    serve(summary(), summary([{ ...CHATGPT, mentions: [10, 66, 20] }, GEMINI]));
    renderCard('');
    const element = await table();
    const cell = cellAt(element, 'Fynix', 'ChatGPT');
    const line = within(cell).getByText('25%').parentElement as HTMLElement;
    expect(line).toContainElement(within(cell).getByText('+16.7 pts'));
    expect(line).not.toHaveTextContent(/named in/);
    expect(cell).toHaveTextContent('named in 30 of 120 answers');
  });

  it('keeps k and n visible in every value cell, never only in a tooltip', async () => {
    serve(summary());
    renderCard();
    const element = await table();
    expect(cellAt(element, 'HubSpot', 'ChatGPT')).toHaveTextContent('65 of 120');
    expect(cellAt(element, 'HubSpot', 'Gemini')).toHaveTextContent('10 of 20');
  });

  it('gives every engine, average and brand column a minimum width, so the table scrolls instead of squeezing', async () => {
    serve(summary());
    renderCard();
    const element = await table();
    for (const column of ['ChatGPT', 'Gemini', AVERAGE]) {
      expect(cellAt(element, 'HubSpot', column).firstElementChild?.className).toContain('min-w-40');
    }
    const rowHeader = within(bodyRows(element)[1] as HTMLElement).getByRole('rowheader');
    expect(rowHeader.firstElementChild?.className).toContain('min-w-36');
  });

  it('makes its scroll region a focusable, named region while the table is wider than the card', async () => {
    class Observer {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', Observer);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    try {
      serve(summary());
      renderCard();
      await table();
      expect(await screen.findByRole('region', { name: TABLE })).toHaveAttribute('tabindex', '0');
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it('shows the same mention rate as the strip for you on the same engine and scope', async () => {
    const strip = engineRates([promptRow(1, [engine('chatgpt_web', { mentioned: cell(30, 120) })])], 'chatgpt_web');
    serve(summary());
    renderCard();
    const element = await table();
    const text = formatPercent(strip.mentioned.value, { decimals: 0 });
    expect(text).toBe('25%');
    expect(cellAt(element, 'Fynix', 'ChatGPT')).toHaveTextContent(text);
  });

  it('links a competitor row through the drill seam, in focus order, and leaves you as plain text', async () => {
    seam.drill = (kind, extra) => `/digibranders/fynix/ai/${kind}?engine=${extra?.engine ?? ''}` as Route;
    serve(summary());
    const { user } = renderCard();
    const element = await table();
    const links = within(element).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['HubSpot', 'Zoho']);
    expect(within(bodyRows(element)[0] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
    for (const link of links) {
      for (let step = 0; step < 20 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });

  it('leaves every row as plain text where the drill seam has no page', async () => {
    seam.drill = () => null;
    serve(summary());
    renderCard();
    expect(within(await table()).queryByRole('link')).not.toBeInTheDocument();
  });

  it('lists every brand on every engine, with its words, in the Table view and in the export', async () => {
    const before = summary([{ ...CHATGPT, mentions: [10, 66, 20] }, GEMINI]);
    serve(summary([CHATGPT, GEMINI], THREE, ['Zoho']), before);
    const { user } = renderCard('');
    await table();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const long = await screen.findByRole('table', { name: 'Mention rate by brand and engine, one row for each' });
    expect(headers(long)).toEqual(['Brand', 'Engine', 'Mention rate', 'Answers', 'Change since the previous period']);
    // 3 brands, 2 engines and the average
    expect(bodyRows(long)).toHaveLength(9);
    expect(long).toHaveTextContent('HubSpotChatGPT54%named in 65 of 120 answers');

    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'Brand',
      'Engine',
      'Mention rate',
      'Answers',
      'Change since the previous period',
      'Status',
    ]);
    expect(block?.rows).toContainEqual([
      'HubSpot',
      'ChatGPT',
      '54%',
      'named in 65 of 120 answers',
      formatPointsDelta(65 / 120 - 66 / 120),
      'Read',
    ]);
    expect(block?.rows).toContainEqual(['Zoho', 'ChatGPT', null, null, null, 'Not available']);
    expect(block?.rows).toContainEqual(['Zoho', AVERAGE_FULL, null, null, null, 'Not available']);
    expect(JSON.stringify(block?.rows)).not.toContain('"0%"');
  });

  it('writes No answers, with no value, for an engine without a valid answer in the export', async () => {
    serve(summary([CHATGPT]));
    renderCard();
    await table();
    const [block] = sink.read().blocks;
    expect(block?.rows).toContainEqual(['HubSpot', 'Gemini', null, null, null, 'No answers']);
  });

  it('says no engine is asked, and does not wait forever, when the engine filter names an engine that is off', async () => {
    serve(summary());
    renderCard('cmp=off&engine=google_ai_mode');
    expect(await screen.findByText('No engine is asked in this scope')).toBeInTheDocument();
    expect(screen.getByText(/Turn on an engine or widen the engine filter/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: HEADING }).closest('section')).not.toHaveAttribute('aria-busy', 'true');
    // No engine, no columns: the export has no block, not a header only one
    expect(sink.read().blocks).toEqual([]);
  });

  it('says no competitor is tracked when only the own brand is, with a link to entities for an editor', async () => {
    serve(summary([CHATGPT], [own()]));
    renderCard();
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add competitors' })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/entities'),
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('tells assistive technology no figure when no engine is asked or the read failed, and the figures otherwise', async () => {
    serve(summary());
    const none = renderCard('cmp=off&engine=google_ai_mode');
    const off = chartSummaryText(await screen.findByRole('heading', { level: 2, name: HEADING }));
    expect(off).toBe('');
    expect(off).not.toMatch(/\d|no mention rate/i);
    none.unmount();
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const failed = renderCard();
    await screen.findByText('Could not load competitors by engine');
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: HEADING }))).not.toMatch(/\d/);
    failed.unmount();
    serve(summary());
    renderCard();
    await table();
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: HEADING }))).toMatch(
      /^Mention rate of \d+ tracked brands on ChatGPT and Gemini, averaged over the engines with equal weight: /,
    );
  });

  it('puts the info button in the footnote and leaves no row of its own above the table', async () => {
    serve(summary());
    renderCard();
    const grid = await table();
    const info = screen.getByRole('button', { name: 'About Mention rate' });
    expect(info.closest('div.type-meta')).toHaveTextContent('Each cell is one engine');
    // Nothing sits between the card's header and the table's own region
    expect(grid.closest('[class*="overflow-x-auto"]')?.previousElementSibling).toBeNull();
  });

  it('says there is more to scroll to only while the table is wider than its region', async () => {
    serve(summary());
    renderCard();
    await table();
    expect(screen.queryByText('Scroll sideways for more engines.')).not.toBeInTheDocument();
    cleanup();

    class Observer {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', Observer);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      renderCard();
      expect(await screen.findByText('Scroll sideways for more engines.')).toBeInTheDocument();
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it('shows Retry for a failed read, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load competitors by engine')).toBeInTheDocument();
    serve(summary());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await table()).toBeInTheDocument();
  });

  it('keeps the rows and says these are the last figures read when a refetch fails', async () => {
    serve(summary());
    const { queryClient } = renderCard();
    await table();
    server.use(http.get(SUMMARY, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: TABLE })).toBeInTheDocument();
  });

  it('asks for the totals of both windows and no prompt rows', async () => {
    const asked: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/ai/prompts-summary')) asked.push(new URL(request.url));
    });
    serve(summary());
    renderCard('');
    await table();
    server.events.removeAllListeners();
    expect(asked).toHaveLength(2);
    for (const url of asked) {
      expect(url.searchParams.get('include')).toBe('entities,total');
      expect(url.searchParams.get('rows')).toBe('none');
    }
  });

  it('draws the card on the default mock world with a value and a count on every engine cell', async () => {
    renderCard('cmp=off', { rows: '10' });
    const element = await table();
    expect(headers(element)).toEqual(['Brand', 'ChatGPT', 'Gemini', AVERAGE]);
    for (const row of bodyRows(element)) {
      for (const value of within(row).getAllByRole('cell').slice(0, 2)) {
        expect(value).toHaveTextContent(/\d+%named in [\d,]+ of [\d,]+ answers/);
      }
    }
  });

  it('shows real rows on the Eventus world', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { rows: '10', world: 'eventus-security' });
    const element = await table();
    await waitFor(() => {
      expect(bodyRows(element).length).toBeGreaterThan(1);
    });
    for (const row of bodyRows(element)) {
      expect(within(row).getAllByRole('cell')[0]).toHaveTextContent(/\d+%|n\/a|Too few|No answers/);
    }
  });

  it('passes axe when ready', async () => {
    serve(summary());
    const { container } = renderCard();
    await table();
    expect(await axe(container)).toHaveNoViolations();
  });
});
