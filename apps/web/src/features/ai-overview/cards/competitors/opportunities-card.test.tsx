import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OpportunitiesCard from './opportunities-card';
import { at, cell, competitor, engine, entityCells, own, promptRow, share, summaryOf } from './model/summary-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, PromptSummaryRow, PromptsSummary, SummaryEntity } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { chartSummaryText } from '@/test/chart-summary';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const flags = vi.hoisted(() => ({ drill: null as CardDrill | null, supported: false }));
vi.mock('../engines/use-card-seams', async (importActual) => {
  const actual = await importActual<typeof import('../engines/use-card-seams')>();
  return {
    ...actual,
    useCardDrill: (): CardDrill => {
      const real = actual.useCardDrill();
      return flags.drill ?? real;
    },
  };
});
vi.mock('../../drilldown/drill-links', async (importActual) => {
  const actual = await importActual<typeof import('../../drilldown/drill-links')>();
  return {
    ...actual,
    DRILL_SUPPORT: {
      ...actual.DRILL_SUPPORT,
      prompts: {
        get outcome(): boolean {
          return flags.supported;
        },
        get opportunity(): boolean {
          return flags.supported;
        },
      },
    },
  };
});

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const TITLE = 'AI opportunities';
const CAPTION = 'Prompts by condition';
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
  flags.drill = null;
  flags.supported = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface EntryInput {
  /** Valid answers. */
  answers: number;
  /** Answers naming you. */
  mine?: number;
  /** Answers naming HubSpot, Zoho. */
  named?: readonly number[];
  /** Answers that name a tracked brand. */
  naming?: number;
  mentionedOnly?: number;
  citedOnly?: number;
}

function entry(code: string, input: EntryInput): EngineSummary {
  const { answers, mine = 0, named = [0, 0], naming = answers, mentionedOnly = 0, citedOnly = 0 } = input;
  return engine(code, {
    mentioned: cell(mine, answers),
    share: share(mine, naming),
    outcomes: { mentionedOnly: cell(mentionedOnly, answers), citedOnly: cell(citedOnly, answers) },
    entities: ENTITIES.map((entity, index) =>
      entityCells(entity, cell(index === 0 ? mine : (named[index - 1] ?? 0), answers), share(0, naming)),
    ),
  });
}

const prompt = (n: number, ...engines: EngineSummary[]): PromptSummaryRow => promptRow(n, engines);

/**
 * Five prompts in scope on ChatGPT and Gemini: HubSpot is lost on 2 (one of them on both engines), Zoho on 1,
 * one names you without a citation, one cites you without naming you and names nobody, and one prompt has no
 * valid answer at all.
 */
const PROMPTS: PromptSummaryRow[] = [
  prompt(1, entry('chatgpt_web', { answers: 6, named: [3, 0] }), entry('gemini_web', { answers: 5, named: [2, 0] })),
  prompt(2, entry('chatgpt_web', { answers: 6, mine: 2, mentionedOnly: 2 })),
  prompt(3, entry('chatgpt_web', { answers: 6, naming: 4, citedOnly: 1 })),
  prompt(4, entry('chatgpt_web', { answers: 5, named: [0, 1] })),
  prompt(6, entry('chatgpt_web', { answers: 6, named: [1, 0] })),
  prompt(7, entry('chatgpt_web', { answers: 0 })),
];

const summary = (prompts: PromptSummaryRow[]): PromptsSummary => summaryOf({ entities: ENTITIES, prompts });

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

function renderCard(searchParams = 'cmp=off', rows = '4'): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <OpportunitiesCard {...props} options={{ rows }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.opportunities', Card }), { searchParams });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('list', { name: CAPTION });
const labels = (list: HTMLElement): (string | null | undefined)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent);

describe('the opportunities card', () => {
  it('counts a prompt once in a row however many engines qualify', async () => {
    serve(summary(PROMPTS));
    renderCard('cmp=off', '8');
    const list = await barList();
    // Prompt 1 is lost to HubSpot on two engines and counts once, with prompt 6: 2 of 5
    expect(within(list).getByText('Lost to HubSpot: 2 prompts, of 5 prompts')).toBeInTheDocument();
    expect(within(list).getByText('Lost to Zoho: 1 prompt, of 5 prompts')).toBeInTheDocument();
    expect(within(list).getByText('Named, not cited: 1 prompt, of 5 prompts')).toBeInTheDocument();
    expect(within(list).getByText('Cited, not named: 1 prompt, of 5 prompts')).toBeInTheDocument();
    expect(within(list).getByText('No tracked brand named: 1 prompt, of 5 prompts')).toBeInTheDocument();
    expect(
      screen.getByText('Oct 16 to Nov 12, 2026 · of 5 prompts in scope · branded prompts left out'),
    ).toBeInTheDocument();
  });

  it('counts a prompt once for named, not cited when two engines qualify', async () => {
    serve(
      summary([
        prompt(
          1,
          entry('chatgpt_web', { answers: 6, mine: 2, mentionedOnly: 2 }),
          entry('gemini_web', { answers: 5, mine: 1, mentionedOnly: 1 }),
        ),
        prompt(2, entry('chatgpt_web', { answers: 6 })),
      ]),
    );
    renderCard('cmp=off', '8');
    const list = await barList();
    expect(within(list).getByText('Named, not cited: 1 prompt, of 2 prompts')).toBeInTheDocument();
  });

  it('counts a prompt as lost only with 4 or more valid answers and with the own brand named in none', async () => {
    serve(
      summary([
        // HubSpot is named, but the prompt has 3 valid answers: too few to say it
        prompt(1, entry('chatgpt_web', { answers: 3, named: [2, 0] })),
        // HubSpot is named, but you are named too
        prompt(2, entry('chatgpt_web', { answers: 6, mine: 1, named: [3, 0] })),
        // The one that counts: 6 answers, Zoho named, you not
        prompt(3, entry('chatgpt_web', { answers: 6, named: [0, 1] })),
      ]),
    );
    renderCard('cmp=off', '8');
    const list = await barList();
    expect(within(list).getByText('Lost to Zoho: 1 prompt, of 3 prompts')).toBeInTheDocument();
    expect(within(list).queryByText(/Lost to HubSpot/)).not.toBeInTheDocument();
  });

  it('reads the prompt rows once with the comparison on, since it draws no comparison', async () => {
    const seen = recordRequests();
    serve(summary(PROMPTS));
    renderCard('');
    await barList();
    expect(summaries(seen)).toHaveLength(1);
  });

  it('sorts the rows by count and cuts them at the rows option', async () => {
    serve(summary(PROMPTS));
    const { user } = renderCard('cmp=off', '4');
    const list = await barList();
    expect(labels(list)).toEqual(['Lost to HubSpot', 'Named, not cited', 'Cited, not named', 'Lost to Zoho']);
    expect(screen.getByText('1 more row is in the Table view.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });

  it('uses none of the words opportunity, should, because or score in a row', async () => {
    serve(summary(PROMPTS));
    renderCard('cmp=off', '8');
    const list = await barList();
    expect(list.textContent).not.toMatch(/opportunit|should|because|score/i);
  });

  it('names the engines in scope, and counts only those', async () => {
    serve(summary(PROMPTS));
    renderCard('cmp=off&engine=gemini_web');
    const list = await barList();
    expect(screen.getByText('Engines in scope: Gemini.')).toBeInTheDocument();
    expect(within(list).getByText('Lost to HubSpot: 1 prompt, of 1 prompt')).toBeInTheDocument();
  });

  it('counts the prompts that the outcome cells of the same read select', async () => {
    const seen: PromptsSummary[] = [];
    server.events.on('response:mocked', async ({ request, response }) => {
      if (new URL(request.url).pathname.endsWith('/ai/prompts-summary')) {
        const body = (await response.clone().json()) as { data: PromptsSummary };
        seen.push(body.data);
      }
    });
    renderCard('cmp=off', '8');
    const list = await barList();
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    server.events.removeAllListeners();
    const [fetched] = seen;
    const inScope = (fetched?.prompts ?? []).filter((row) =>
      row.engines.some((entryOf) => entryOf.mentioned.denominator >= 1),
    );
    const count = (pick: (entryOf: EngineSummary) => number): number =>
      inScope.filter((row) => row.engines.some((entryOf) => entryOf.mentioned.denominator >= 1 && pick(entryOf) >= 1))
        .length;
    const named = count((entryOf) => entryOf.outcomes.mentioned_only.numerator);
    const cited = count((entryOf) => entryOf.outcomes.cited_only.numerator);
    const total = inScope.length;
    expect(total).toBeGreaterThan(0);
    const pluralOf = (n: number): string => `${String(n)} ${n === 1 ? 'prompt' : 'prompts'}`;
    expect(within(list).getByText(`Named, not cited: ${pluralOf(named)}, of ${pluralOf(total)}`)).toBeInTheDocument();
    expect(within(list).getByText(`Cited, not named: ${pluralOf(cited)}, of ${pluralOf(total)}`)).toBeInTheDocument();
  });

  it('is plain text while the Prompts page cannot filter by the condition', async () => {
    serve(summary(PROMPTS));
    renderCard('cmp=off', '8');
    const list = await barList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('links each row to the Prompts page with its condition once that page can filter', async () => {
    flags.supported = true;
    const asked: string[] = [];
    flags.drill = (kind, extra) => {
      asked.push(`${kind} ${extra?.outcome ?? '-'} ${extra?.opportunity ?? '-'}`);
      return '/digibranders/fynix/ai/prompts' as Route;
    };
    serve(summary(PROMPTS));
    renderCard('cmp=off', '8');
    const list = await barList();
    expect(within(list).getAllByRole('link')).toHaveLength(5);
    expect(asked).toEqual(
      expect.arrayContaining([
        'prompts mentioned_only -',
        'prompts cited_only -',
        'prompts - nobody_named',
        `prompts - lost_to:${at(ENTITIES, 1).entity_id}`,
      ]),
    );
  });

  it('shows a skeleton at its height while loading', async () => {
    server.use(
      http.get(SUMMARY, async () => {
        await delay(60);
        return HttpResponse.json({ data: summary(PROMPTS) });
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: TITLE });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame?.querySelector('[style*="height: 240px"]')).not.toBeNull();
    expect(await barList()).toBeInTheDocument();
  });

  it('shows Retry for a failed read, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load AI opportunities')).toBeInTheDocument();
    serve(summary(PROMPTS));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('tells assistive technology no figure when no engine is asked or the read failed, and the figures otherwise', async () => {
    serve(summary(PROMPTS));
    const none = renderCard('cmp=off&engine=google_ai_mode');
    const off = chartSummaryText(await screen.findByRole('heading', { level: 2, name: TITLE }));
    expect(off).toBe('');
    expect(off).not.toMatch(/\d|no prompt/i);
    none.unmount();
    server.use(http.get(SUMMARY, () => failing('req-1')));
    const failed = renderCard();
    await screen.findByText('Could not load AI opportunities');
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: TITLE }))).not.toMatch(/\d/);
    failed.unmount();
    serve(summary(PROMPTS));
    renderCard();
    await barList();
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: TITLE }))).toMatch(
      /^Prompts by condition, of \d+ prompts in scope: /,
    );
  });

  it('says there is no valid answer when no prompt has one in scope', async () => {
    serve(summary([prompt(1, entry('chatgpt_web', { answers: 0 }))]));
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
  });

  it('registers the rows it shows for the export under the layout item id, with a status', async () => {
    serve(summary(PROMPTS));
    renderCard('cmp=off', '4');
    await barList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Condition', 'Prompts', 'Of prompts in scope', 'Status']);
    expect(block?.rows).toHaveLength(5);
    expect(block?.rows[0]).toEqual(['Lost to HubSpot', '2 prompts', 'of 5 prompts', 'Read']);
  });

  it('passes axe when ready', async () => {
    serve(summary(PROMPTS));
    const { container } = renderCard();
    await barList();
    expect(await axe(container)).toHaveNoViolations();
  });
});
