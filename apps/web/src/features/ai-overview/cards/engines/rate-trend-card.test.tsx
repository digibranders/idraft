import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineCells, promptRow, summaryOf, week } from './engines-fixtures';
import RateTrendCard from './rate-trend-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { useOverview } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const TOKENS: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

const built = vi.hoisted(() => ({ options: new Map<string, Record<string, unknown>>() }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option, height }: { option: (tokens: ChartTokens) => Record<string, unknown>; height: number }) => {
    const drawn = option(TOKENS);
    const first = (drawn.series as { id: string }[])[0];
    if (first !== undefined) built.options.set(first.id, drawn);
    return <div data-testid="echart-canvas" data-height={height} />;
  },
}));

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const TYPE = 'ai.rate_trend_by_engine';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const PREVIOUS_TO = '2026-10-15';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

beforeEach(() => {
  built.options.clear();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (card: ReactElement = cardInOverview({ type: TYPE, Card: RateTrendCard, width: 'two_thirds' })) =>
  renderWithProviders(card, { searchParams: WINDOW });

/** Reads the tooltip the first panel of ChatGPT would draw at a week: its words, as a string. */
function tipAt(id: string, index: number): string {
  const option = built.options.get(id);
  const tooltip = option?.tooltip as { formatter: (params: unknown) => string };
  return tooltip.formatter([{ dataIndex: index }]);
}

describe('the rate trend card', () => {
  it('shows ChatGPT and Gemini and no AI Mode (off in the project)', async () => {
    render();
    expect(await screen.findByRole('heading', { name: 'Mention rate by engine' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Gemini' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'AI Mode' })).not.toBeInTheDocument();
  });

  it('the Table view lists weeks with value, k of n and the prompts for each engine, and equals the tooltip words', async () => {
    const { user } = render();
    await screen.findByRole('img', { name: 'ChatGPT' });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Mention rate by engine' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Week', 'ChatGPT', 'Gemini']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // A week without answers is a gap in the chart and "No data" in the table, never 0
    const cells = rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
    const at = cells.findIndex((text) => text !== 'No data');
    expect(at).toBeGreaterThanOrEqual(0);
    const words = cells[at] ?? '';
    // R1: a percent only beside its answers
    expect(words).toMatch(/^\d+(\.\d)?%, \d+ of \d+ answers/);
    expect(words).toMatch(/\d+ prompts?, each counts once/);
    expect(words).not.toMatch(/^0(\.0)?%/);
    // The same words are in the tooltip of that week; the box shows for the panel the pointer is over
    await user.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.pointerEnter(screen.getByRole('img', { name: 'ChatGPT' }).closest('figure') as HTMLElement);
    expect(tipAt('chatgpt_web', at)).toContain(words);
  });

  it('says in the tooltip and the Table view that a point pools several weeks', async () => {
    const { user } = render();
    await screen.findByRole('img', { name: 'ChatGPT' });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Mention rate by engine' });
    expect(within(table).getAllByText(/pooled over \d weeks/).length).toBeGreaterThan(0);
  });

  it('keeps its height while it loads', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async () => {
        await gate;
        return undefined;
      }),
    );
    render();
    const title = await screen.findByRole('heading', { name: 'Mention rate by engine' });
    const section = title.closest('section');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section?.querySelector('div[style*="height: 140px"]')).not.toBeNull();
    release();
    expect(await screen.findByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
  });

  it('shows Retry and the error id when the summary fails, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-trend')));
    const { user } = render();
    expect(await screen.findByText('Could not load Mention rate by engine')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-trend')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
  });

  it('shows the stale notice and keeps the panels when a later read fails', async () => {
    const { queryClient } = render();
    await screen.findByRole('img', { name: 'ChatGPT' });
    server.use(http.get(SUMMARY, () => failing('req-late')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
  });

  it('with fewer than 2 weeks of answers says so, with the next run', async () => {
    server.use(
      http.get(SUMMARY, () =>
        HttpResponse.json({
          data: summaryOf(
            [
              promptRow('p1', [
                engineCells('chatgpt_web', { series: [week('2026-11-09', { mentioned: [3, 4] })] }),
                engineCells('gemini_web', { series: [week('2026-11-09', { mentioned: [2, 4] })] }),
              ]),
            ],
            { codes: ['chatgpt_web', 'gemini_web'] },
          ),
        }),
      ),
      http.get('*/api/v1/workspaces/:w/projects/:p/schedules', () =>
        HttpResponse.json({
          data: [{ is_active: true, next_run_at: '2026-11-16T02:00:00Z' }],
          page: { limit: 100, next_cursor: null },
        }),
      ),
    );
    const { container } = render();
    expect(await screen.findByText('Trends need at least 2 weeks')).toBeInTheDocument();
    expect(
      await screen.findByText(/Prompts are asked on Mondays and Thursdays\. The next answers arrive .+\./),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('describes each panel by a sentence with its latest week and its words', async () => {
    render();
    const panel = await screen.findByRole('img', { name: 'ChatGPT' });
    const describedBy = panel.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const sentence = document.getElementById(describedBy ?? '')?.textContent ?? '';
    // "Nov 9: 34%, 81 of 238 answers, ...": the week, then the percent beside its answers
    expect(sentence).toMatch(/^[A-Z][a-z]{2} \d+: \d+(\.\d)?%, \d+ of \d+ answers/);
  });

  describe('with the previous window read slowly', () => {
    const ids = (): string[] =>
      ((built.options.get('chatgpt_web')?.series ?? []) as { id: string }[]).map((series) => series.id);
    const summary = (): string => document.querySelector('p.sr-only')?.textContent ?? '';

    /** The card with a control that changes the scope, as a person does with the scope bar. */
    function WithScope(props: CardProps): ReactElement {
      const { setScope } = useOverview();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setScope({ branded: 'included' });
            }}
          >
            Include branded
          </button>
          <RateTrendCard {...props} />
        </>
      );
    }

    /** The previous window is slow to answer; the current one answers at once. `reached` says it was asked. */
    function holdPrevious(): { release: () => void; reached: Promise<void> } {
      let release: () => void = () => undefined;
      let reach: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        reach = resolve;
      });
      server.use(
        http.get(SUMMARY, async ({ request }) => {
          if (new URL(request.url).searchParams.get('to') === PREVIOUS_TO) {
            reach();
            await gate;
          }
          return undefined;
        }),
      );
      return { release, reached };
    }

    it('uses the previous window only while the two reads are paired: on a scope change none is drawn, and no change is said, until the previous window answers', async () => {
      const { user } = render(cardInOverview({ type: TYPE, Card: WithScope, width: 'two_thirds' }));
      await screen.findByRole('img', { name: 'ChatGPT' });
      await waitFor(() => {
        expect(ids()).toContain('chatgpt_web:previous');
      });
      expect(summary()).toContain('against the previous window');

      const { release } = holdPrevious();
      await user.click(screen.getByRole('button', { name: 'Include branded' }));
      // The current window of the new scope is here and the previous one is the last scope's: no change between them
      await waitFor(() => {
        expect(ids()).not.toContain('chatgpt_web:previous');
      });
      expect(summary()).not.toContain('against the previous window');
      // The panels themselves stay
      expect(screen.getByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();

      release();
      await waitFor(() => {
        expect(ids()).toContain('chatgpt_web:previous');
      });
      expect(summary()).toContain('against the previous window');
    });

    it('keeps the previous window drawn while the same scope is read again', async () => {
      const { queryClient } = render();
      await screen.findByRole('img', { name: 'ChatGPT' });
      await waitFor(() => {
        expect(ids()).toContain('chatgpt_web:previous');
      });

      const { release, reached } = holdPrevious();
      void queryClient.invalidateQueries();
      // A refetch of the same scope (a refocus) is still this scope's data: nothing the person sees is taken away
      await reached;
      expect(ids()).toContain('chatgpt_web:previous');
      expect(summary()).toContain('against the previous window');

      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ids()).toContain('chatgpt_web:previous');
      expect(summary()).toContain('against the previous window');
    });
  });

  it('names the window, the prompts and the branded choice in the meta line', async () => {
    render();
    await screen.findByRole('img', { name: 'ChatGPT' });
    const title = screen.getByRole('heading', { name: 'Mention rate by engine' });
    const meta = title.closest('section')?.querySelector('p.type-meta')?.textContent ?? '';
    expect(meta).toContain('Oct 16 to Nov 12, 2026');
    expect(meta).toMatch(/\d+ prompts?, [\d,]+ valid answers/);
    expect(meta).toContain('branded prompts left out');
    expect(meta).toContain('each prompt counts once');
  });

  it('writes the pooling and the interval into the footnote, and the comparison when it is drawn', async () => {
    render();
    await screen.findByRole('img', { name: 'ChatGPT' });
    const title = screen.getByRole('heading', { name: 'Mention rate by engine' });
    const section = title.closest('section') as HTMLElement;
    expect(section).toHaveTextContent('Each point pools the answers of up to 4 weeks');
    expect(section).toHaveTextContent('Bands are 95% intervals');
    expect(section).toHaveTextContent('That mean can sit outside the interval of the pooled answers.');
    await waitFor(() => {
      expect(section).toHaveTextContent('The dashed line is the previous window');
    });
  });

  it('registers its Table view as an export block under the layout item id, with empty values and a status', async () => {
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <RateTrendCard {...props} />
        </ExportProvider>
      );
    }
    render(cardInOverview({ type: TYPE, Card: Wrapped, width: 'two_thirds' }));
    await screen.findByRole('img', { name: 'ChatGPT' });
    const [block] = read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toContain('value_percent');
    expect(block?.rows.length).toBeGreaterThan(0);
    for (const row of block?.rows ?? []) {
      const status = row[row.length - 1];
      // An unknown value is empty with a status, never 0
      if (status !== 'ok') expect(row[2]).toBeNull();
    }
  });

  it('axe finds no violation', async () => {
    const { user, container } = render();
    await screen.findByRole('img', { name: 'ChatGPT' });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
