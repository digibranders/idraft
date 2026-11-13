import { act, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnswerStatusCard from './answer-status-card';
import { dailyResponse, day, quiet, twoWeeks, type CollectionDaily } from './model/daily-fixtures';
import { setAiSeeded } from '@/mocks/ai-seed';
import {
  DASHES,
  failing,
  ITEM_ID,
  PROJECT,
  readExport,
  recordRequests,
  renderActivityCard,
  stopRecording,
} from '@/test/ai-activity-kit';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { drawnCategories, drawnSeries, tooltipText, type DrawnSeries } from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

const DAILY = `${PROJECT}/ai/collection/daily`;
const TYPE = 'ops.answer_status';
const TITLE = 'Answer status by engine and day';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  stopRecording();
  setAiSeeded(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function serve(body: CollectionDaily = twoWeeks()): void {
  server.use(http.get(DAILY, () => HttpResponse.json(body)));
}

const render = (options: Parameters<typeof renderActivityCard>[2] = {}): ReturnType<typeof renderActivityCard> =>
  renderActivityCard(TYPE, AnswerStatusCard, options);
const drawn = async (options: Parameters<typeof renderActivityCard>[2] = {}): Promise<ReturnType<typeof render>> => {
  const rendered = render(options);
  await screen.findByTestId('echart-canvas');
  return rendered;
};
const lineOf = (id: string): DrawnSeries => {
  const found = drawnSeries().find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No series ${id}`);
  return found;
};
/** What the chart says about itself to people who cannot see it: the paragraph its image points at. */
const spokenSummary = (): string => {
  const described = screen.getByTestId('echart-canvas').parentElement?.getAttribute('aria-describedby') ?? '';
  return document.getElementById(described)?.textContent ?? '';
};

describe('the answer status card (CH-21)', () => {
  it('shows a skeleton at the frame height while the days load, under its title', async () => {
    server.use(http.get(DAILY, async () => delay('infinite')));
    render();
    const heading = await screen.findByRole('heading', { name: TITLE });
    expect(heading.closest('section')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('[data-slot="skeleton"]')?.parentElement).toHaveStyle({ height: '240px' });
  });

  it('draws the run days of the first asked engine, as stacked bars of counts', async () => {
    serve();
    await drawn();
    expect(drawnCategories()).toEqual(['Nov 2', 'Nov 6', 'Nov 9', 'Nov 13']);
    expect(drawnSeries().map((entry) => entry.id)).toEqual(['complete', 'partial', 'empty', 'refused', 'error']);
    for (const entry of drawnSeries()) expect(entry).toMatchObject({ type: 'bar', stack: 'total' });
    expect(lineOf('complete').data).toEqual([690, 700, 750, 0]);
    expect(lineOf('partial').data).toEqual([40, 42, 0, 0]);
    expect(lineOf('empty').data).toEqual([5, 0, 0, 0]);
    expect(lineOf('refused').data).toEqual([10, 6, 0, 0]);
    expect(lineOf('error').data).toEqual([5, 2, 0, 0]);
  });

  it('stacks the five statuses to the answers of each day, valid being complete plus partial', async () => {
    serve();
    await drawn();
    const answers = [750, 750, 750, 0];
    answers.forEach((expected, index) => {
      const total = ['complete', 'partial', 'empty', 'refused', 'error'].reduce(
        (sum, id) => sum + Number(lineOf(id).data[index]),
        0,
      );
      expect(total).toBe(expected);
    });
    expect(Number(lineOf('complete').data[1]) + Number(lineOf('partial').data[1])).toBe(742);
    expect(drawnSeries().map((entry) => entry.name)).toEqual([
      'Valid, complete',
      'Valid, partial',
      'Empty',
      'Refused',
      'Error',
    ]);
  });

  it('colours valid as the reference token and the other statuses from the palette, in order', async () => {
    serve();
    await drawn();
    expect(lineOf('complete').color).toBe('#reference');
    expect(['partial', 'empty', 'refused', 'error'].map((id) => lineOf(id).color)).toEqual([
      '#c2',
      '#c3',
      '#c4',
      '#c5',
    ]);
  });

  it('offers Patterns, so the statuses are not told apart by colour alone', async () => {
    serve();
    await drawn();
    expect(screen.getByRole('button', { name: 'Patterns' })).toBeInTheDocument();
  });

  it('tells in the tooltip the counts of the day and what was scheduled', async () => {
    serve();
    await drawn();
    expect(tooltipText(1)).toBe(
      'Fri Nov 6|Valid, complete|700|Valid, partial|42|Empty|0|Refused|6|Error|2|Scheduled|750',
    );
  });

  it('names a run blocked by the budget in the tooltip of its day, and says Schedule unknown, never 0', async () => {
    serve(
      dailyResponse(
        [
          day({ date: '2026-11-06', scheduled: null, complete: 12 }),
          day({ date: '2026-11-09', scheduled: null, blocked: 1 }),
        ],
        { from: '2026-11-06', to: '2026-11-09' },
      ),
    );
    await drawn();
    expect(drawnCategories()).toEqual(['Nov 6', 'Nov 9']);
    expect(tooltipText(0)).toContain('Scheduled|Schedule unknown');
    expect(tooltipText(0)).not.toContain('Scheduled|0');
    expect(tooltipText(1)).toContain('Runs blocked by the budget|1');
  });

  it('shows one engine at a time: Gemini has its own days and ChatGPT is not added to it', async () => {
    serve();
    const { user } = await drawn();
    expect(screen.getByRole('button', { name: /^ChatGPT, / })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^Gemini, / }));
    await waitFor(() => {
      expect(drawnCategories()).toEqual(['Nov 6']);
    });
    expect(lineOf('complete').data).toEqual([410]);
    expect(lineOf('partial').data).toEqual([30]);
    expect(lineOf('refused').data).toEqual([40]);
    expect(lineOf('error').data).toEqual([20]);
    expect(tooltipText(0)).toContain('Scheduled|500');
  });

  it('starts on the first engine the scope asks', async () => {
    const seen = recordRequests();
    serve();
    await drawn({ searchParams: 'cmp=off&engine=gemini_web' });
    expect(drawnCategories()).toEqual(['Nov 6']);
    const asked = seen.filter((url) => url.pathname.endsWith('/ai/collection/daily'));
    expect(asked[0]?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
  });

  it('announces the engine shown, and the tabs work from the keyboard', async () => {
    serve();
    const { user } = await drawn();
    const chatgpt = screen.getByRole('button', { name: /^ChatGPT, / });
    for (let step = 0; step < 15 && document.activeElement !== chatgpt; step += 1) await user.tab();
    expect(document.activeElement).toBe(chatgpt);
    await user.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Gemini, / })).toHaveAttribute('aria-pressed', 'true');
    });
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('Gemini shown, 500 answers collected');
    });
  });

  it('describes the chart in words, with counts and no percent, once the days are read', async () => {
    serve();
    await drawn();
    expect(spokenSummary()).toBe(
      'Answers by status on each run day, ChatGPT: 2,222 of 2,250 answers valid, 5 empty, 16 refused, 7 errors.',
    );
  });

  it('says in the meta line how many of the collected answers are valid', async () => {
    serve();
    await drawn();
    expect(
      screen.getByText('Nov 2 to Nov 15, 2026, ChatGPT: 2,222 of 2,250 answers collected are valid'),
    ).toBeInTheDocument();
  });

  it('says no engine is asked for a project with its engines off, and asks the API for nothing', async () => {
    const seen = recordRequests();
    render({ world: 'cleanstart' });
    expect(await screen.findByRole('heading', { name: 'No engine is asked' })).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(seen.filter((url) => url.pathname.endsWith('/ai/collection/daily'))).toEqual([]);
  });

  it('says nothing was scheduled or collected when no day has a schedule or an answer', async () => {
    serve(
      dailyResponse([quiet('2026-11-02'), quiet('2026-11-02', 'gemini_web')], { from: '2026-11-02', to: '2026-11-02' }),
    );
    render();
    expect(await screen.findByRole('heading', { name: 'No collection in this window' })).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });

  it('keeps the engine tabs when the engine chosen was not asked in the window', async () => {
    const body = twoWeeks();
    serve({
      ...body,
      data: body.data.map((row) => (row.engine_code === 'gemini_web' ? quiet(row.date, 'gemini_web') : row)),
    });
    const { user } = await drawn();
    await user.click(screen.getByRole('button', { name: /^Gemini, / }));
    expect(await screen.findByRole('heading', { name: 'Gemini was not asked in this window' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^ChatGPT, / }));
    await screen.findByTestId('echart-canvas');
  });

  it('shows an error with its request id and a retry that asks again', async () => {
    server.use(http.get(DAILY, () => failing('req-status')));
    const { user } = render();
    expect(await screen.findByText('Could not load answer status')).toBeInTheDocument();
    expect(screen.getByText(/req-status/)).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('echart-canvas');
  });

  it('keeps the last figures and says so when a later read fails', async () => {
    serve();
    const { queryClient } = await drawn();
    server.use(http.get(DAILY, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
  });

  it('keeps the chart on screen, undimmed, while a read runs again', async () => {
    serve();
    const { queryClient } = await drawn();
    server.use(http.get(DAILY, async () => delay('infinite')));
    act(() => {
      void queryClient.refetchQueries();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
  });

  it('lists the same counts in the Table view', async () => {
    serve();
    const { user } = await drawn();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    const friday = within(table).getByRole('row', { name: /^Nov 6/ });
    expect(friday).toHaveTextContent('700');
    expect(friday).toHaveTextContent('42');
  });

  it('registers the run days of every engine for the export under the layout item id', async () => {
    serve();
    const { user } = await drawn();
    const [block] = await readExport(user);
    expect(block?.id).toBe(ITEM_ID);
    expect(block?.rows).toContainEqual(['2026-11-06', 'ChatGPT', 750, 750, 742, 700, 42, 0, 6, 2, 0]);
    expect(block?.rows).toContainEqual(['2026-11-06', 'Gemini', 500, 500, 440, 410, 30, 0, 40, 20, 0]);
  });

  it('draws the collection of the seeded project from the mock API, with answers on its run days', async () => {
    setAiSeeded(true);
    await drawn({ world: 'eventus-security' });
    expect(drawnCategories().length).toBeGreaterThan(0);
    const ids = ['complete', 'partial', 'empty', 'refused', 'error'];
    const totals = drawnCategories().map((_, index) =>
      ids.reduce((sum, id) => sum + Number(lineOf(id).data[index]), 0),
    );
    expect(totals.some((total) => total > 0)).toBe(true);
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    serve();
    const { container } = await drawn({ mode: 'customize' });
    const controls = [...container.querySelectorAll('button, a[href]')].filter(
      (element) => element.textContent !== 'Read export',
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('has no dash in what it shows and passes axe', async () => {
    serve();
    const { container } = await drawn();
    expect(container.textContent).not.toMatch(DASHES);
    expect(tooltipText(1)).not.toMatch(DASHES);
    expect(await axe(container)).toHaveNoViolations();
  });
});
