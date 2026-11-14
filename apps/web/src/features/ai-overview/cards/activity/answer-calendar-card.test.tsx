import { act, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnswerCalendarCard from './answer-calendar-card';
import { dailyResponse, day, quiet, twoWeeks, type CollectionDaily } from './model/daily-fixtures';
import { sequentialBin } from '@/components/app/chart/heat-bins';
import { setAiSeeded } from '@/mocks/ai-seed';
import { mockUser } from '@/mocks/fixtures';
import { clearPreferences, preferenceKey } from '@/lib/preferences/storage';
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

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const DAILY = `${PROJECT}/ai/collection/daily`;
const TYPE = 'ops.answer_calendar';
const TITLE = 'Answer collection calendar';
const FRIDAY = 'Fri Nov 6: 742 of 750 answers valid, 6 refused, 2 errors';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  stopRecording();
  clearPreferences();
  setAiSeeded(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function serve(body: CollectionDaily = twoWeeks()): void {
  server.use(http.get(DAILY, () => HttpResponse.json(body)));
}

const render = (options: Parameters<typeof renderActivityCard>[2] = {}): ReturnType<typeof renderActivityCard> =>
  renderActivityCard(TYPE, AnswerCalendarCard, options);
const card = (): Promise<HTMLElement> => screen.findByRole('heading', { name: TITLE });
const cell = (name: string | RegExp): HTMLElement => screen.getByRole('cell', { name });
const summaryOf = (container: HTMLElement): string | undefined =>
  container.querySelector('section > p.sr-only')?.textContent;

/** Every cell of the calendar grid that has a day in it: they are the ones that carry a name. */
/** The skeleton that stands for the body of the frame while loading: the one inside a box of the frame's height. */
const LOADING_BODY = 'section[aria-busy="true"] div[style*="height"] > [data-slot="skeleton"]';
const dayCells = (): HTMLElement[] => screen.getAllByRole('cell').filter((node) => node.getAttribute('aria-label'));

describe('the answer collection calendar card (CH-20)', () => {
  it('shows a skeleton at the frame height while the days load, under its title', async () => {
    server.use(http.get(DAILY, async () => delay('infinite')));
    render();
    await card();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector(LOADING_BODY)?.parentElement).toHaveStyle({ height: '280px' });
  });

  it('reserves the engine tabs and the meta line while loading, so nothing jumps when the days arrive', async () => {
    server.use(
      http.get(DAILY, async () => {
        await delay(80);
        return HttpResponse.json(twoWeeks());
      }),
    );
    render();
    await card();
    const placeholder = document.querySelector('[data-slot="controls-placeholder"]');
    expect(placeholder).not.toBeNull();
    // Each block of the placeholder is as tall as a control; the views group is held beside it (daily-loading.test.tsx)
    expect(placeholder?.querySelector('[class*="h-control-sm"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="views-placeholder"]')).not.toBeNull();
    expect(document.querySelector('section p.type-meta')).not.toBeNull();
    const loadingBody = document.querySelector(LOADING_BODY)?.parentElement;
    const reserved = loadingBody?.style.height;
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    // The tabs take the placeholder's height, and the loaded body is held to the height the skeleton had
    expect(document.querySelector('[data-slot="controls-placeholder"]')).toBeNull();
    expect(screen.getByRole('button', { name: /^ChatGPT, / }).className).toContain('h-control-sm');
    const region = screen.getByRole('region', { name: /^Collection calendar for ChatGPT/ });
    expect(region.closest<HTMLElement>('div[style]')?.style.minHeight).toBe(reserved);
  });

  it('draws weekdays as rows and weeks as columns, for the first asked engine', async () => {
    serve();
    render();
    const grid = await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const weekdays = within(grid)
      .getAllByRole('rowheader')
      .map((header) => header.textContent);
    expect(weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const weeks = within(grid)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(weeks).toEqual(['Nov 2', 'Nov 9']);
    expect(screen.getByRole('button', { name: /^ChatGPT, / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Gemini, / })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names a day in words with its counts, as the tooltip does', async () => {
    serve();
    const { user } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const friday = cell(FRIDAY);
    await user.hover(friday);
    expect(await screen.findByText(FRIDAY)).toBeInTheDocument();
  });

  it('fills a cell by the valid answers over the scheduled ones, with the one bin function of the heat-maps', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    expect(cell(FRIDAY).className).toContain(sequentialBin(742 / 750).fill);
    expect(cell('Fri Nov 13: 0 of 750 answers valid').className).toContain(sequentialBin(0).fill);
  });

  it('shows a day with no known schedule as the surface colour and says Schedule unknown, never 0', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const unknown = cell('Tue Nov 3: Schedule unknown');
    // A dashed outline tells it from the lowest bin without colour, and the key shows the same outline
    expect(unknown.className).toContain('border-dashed');
    expect(cell(FRIDAY).className).not.toContain('border-dashed');
    expect(cell('Fri Nov 13: 0 of 750 answers valid').className).not.toContain('border-dashed');
    expect(
      within(screen.getByRole('list', { name: 'Key to the calendar' })).getByText('Schedule unknown').firstElementChild,
    ).toHaveClass('border-dashed');
    expect(unknown.className).toContain('bg-surface');
    expect(unknown.className).not.toContain('bg-seq-');
    expect(unknown).not.toHaveTextContent('0');
    expect(screen.queryByRole('cell', { name: /Nov 3: 0 of/ })).not.toBeInTheDocument();
  });

  it('keeps the answers of a day whose schedule is unknown, in words', async () => {
    serve(
      dailyResponse([day({ date: '2026-11-03', scheduled: null, complete: 9, partial: 3 })], {
        from: '2026-11-03',
        to: '2026-11-03',
      }),
    );
    render();
    expect(
      await screen.findByRole('cell', { name: 'Tue Nov 3: Schedule unknown, 12 answers collected, 12 valid' }),
    ).toBeInTheDocument();
  });

  it('writes every count of a day with the number formatter, plurals and runs blocked included', async () => {
    serve(
      dailyResponse([day({ date: '2026-11-06', scheduled: 2000, complete: 800, error: 1200, blocked: 1 })], {
        from: '2026-11-06',
        to: '2026-11-06',
      }),
    );
    render();
    expect(
      await screen.findByRole('cell', {
        name: 'Fri Nov 6: 800 of 2,000 answers valid, 1,200 errors, 1 run blocked by the budget',
      }),
    ).toBeInTheDocument();
  });

  it('marks the failures of a day with a glyph and the count of refused and error answers', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const failures = cell(FRIDAY).querySelector('[data-glyph="failure"]');
    expect(failures).not.toBeNull();
    expect(failures).toHaveTextContent('8');
    expect(cell(/^Mon Nov 2:/).querySelector('[data-glyph="failure"]')).toHaveTextContent('15');
    expect(cell(/^Mon Nov 9:/).querySelector('[data-glyph="failure"]')).toBeNull();
  });

  it('marks a run blocked by the budget with a glyph of its own and says so in the cell text, not by colour alone', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const blocked = cell('Mon Nov 9: 750 of 750 answers valid, 1 run blocked by the budget');
    expect(blocked.querySelector('[data-glyph="budget-blocked"]')).not.toBeNull();
    expect(blocked.querySelector('[data-glyph="failure"]')).toBeNull();
    expect(cell(FRIDAY).querySelector('[data-glyph="budget-blocked"]')).toBeNull();
  });

  it('explains the fills and the two glyphs in a visible key', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const key = screen.getByRole('list', { name: 'Key to the calendar' });
    expect(within(key).getByText('Refused and error answers, with their count')).toBeInTheDocument();
    expect(within(key).getByText('Run blocked by the budget')).toBeInTheDocument();
    expect(within(key).getByText('Schedule unknown')).toBeInTheDocument();
    expect(within(key).getByText('70% and up')).toBeInTheDocument();
  });

  it('gives every cell that reports valid answers the count they are valid of', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const reporting = dayCells().filter((node) => /answers valid/.test(node.getAttribute('aria-label') ?? ''));
    expect(reporting.length).toBeGreaterThanOrEqual(4);
    for (const node of reporting) {
      expect(node.getAttribute('aria-label')).toMatch(/\d[\d,]* of \d[\d,]* answers valid/);
    }
  });

  it('shows one engine at a time and never adds ChatGPT and Gemini together', async () => {
    serve();
    const { user } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    expect(screen.queryByRole('cell', { name: /440 of 500/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Gemini, / }));
    const grid = await screen.findByRole('table', { name: /^Collection calendar for Gemini/ });
    expect(
      within(grid).getByRole('cell', { name: 'Fri Nov 6: 440 of 500 answers valid, 40 refused, 20 errors' }),
    ).toBeInTheDocument();
    expect(within(grid).queryByRole('cell', { name: /742/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /1,182|1,250/ })).not.toBeInTheDocument();
    // Pressing the first engine again returns to it
    await user.click(screen.getByRole('button', { name: /^ChatGPT, / }));
    expect(await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ })).toBeInTheDocument();
  });

  it('starts on the first engine the scope asks, and asks only for that scope', async () => {
    const seen = recordRequests();
    serve();
    render({ searchParams: 'cmp=off&engine=gemini_web' });
    await screen.findByRole('table', { name: /^Collection calendar for Gemini/ });
    const asked = seen.filter((url) => url.pathname.endsWith('/ai/collection/daily'));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    expect(asked[0]?.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(asked[0]?.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves the engine filter out when every engine that is on is asked', async () => {
    const seen = recordRequests();
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const asked = seen.filter((url) => url.pathname.endsWith('/ai/collection/daily'));
    expect(asked[0]?.searchParams.has('filter[engine_code_in]')).toBe(false);
  });

  it('announces the engine shown when the engine is switched, and the tabs work from the keyboard', async () => {
    serve();
    const { user } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const chatgpt = screen.getByRole('button', { name: /^ChatGPT, / });
    for (let step = 0; step < 15 && document.activeElement !== chatgpt; step += 1) await user.tab();
    expect(document.activeElement).toBe(chatgpt);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^Gemini, / })).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByRole('table', { name: /^Collection calendar for Gemini/ });
    expect(screen.getByRole('button', { name: /^Gemini, / })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('Gemini shown, 500 answers collected');
    });
  });

  it('says in the meta line how many of the collected answers are valid, counts and no percent', async () => {
    serve();
    render();
    expect(
      await screen.findByText('Nov 2 to Nov 15, 2026, ChatGPT: 2,222 of 2,250 answers collected are valid'),
    ).toBeInTheDocument();
  });

  it('says to a screen reader what the calendar holds only once the days are read', async () => {
    server.use(http.get(DAILY, async () => delay('infinite')));
    const loading = render();
    await card();
    expect(summaryOf(loading.container)).toBe(TITLE);
    loading.unmount();
    serve();
    const ready = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    expect(summaryOf(ready.container)).toBe(
      'Calendar of ChatGPT: 4 run days, 2,222 of 2,250 answers collected are valid.',
    );
  });

  it('explains how to read it in its footnote: every answer, valid means complete or partial, engines apart', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    expect(
      screen.getByText(/Counts every answer collected, whatever the topic or country in the scope/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Valid means complete or partial/)).toBeInTheDocument();
    expect(screen.getByText(/never added up/)).toBeInTheDocument();
  });

  it('scrolls inside its own container on a narrow screen, not the page', async () => {
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const region = screen.getByRole('region', { name: /^Collection calendar for ChatGPT/ });
    expect(region.className).toContain('overflow-x-auto');
    expect(region.className).toContain('min-w-0');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it.each([
    ['default', { tableDensity: 'default' }],
    ['compact', {}],
  ])('keeps the cells at the height of an embedded grid in %s density', async (_name, preference) => {
    localStorage.setItem(preferenceKey(mockUser('admin').user_id, 'settings'), JSON.stringify(preference));
    serve();
    render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    for (const node of dayCells()) expect(node.className).toContain('h-5');
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

  it('says nothing was scheduled or collected when no day of any engine has a schedule or an answer', async () => {
    serve(
      dailyResponse([quiet('2026-11-02'), quiet('2026-11-02', 'gemini_web')], { from: '2026-11-02', to: '2026-11-02' }),
    );
    render();
    expect(await screen.findByRole('heading', { name: 'No collection in this window' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /^Collection calendar/ })).not.toBeInTheDocument();
  });

  it('keeps the engine tabs when the engine chosen was not asked in the window, so another can be chosen', async () => {
    const body = twoWeeks();
    serve({
      ...body,
      data: body.data.map((row) => (row.engine_code === 'gemini_web' ? quiet(row.date, 'gemini_web') : row)),
    });
    const { user } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    await user.click(screen.getByRole('button', { name: /^Gemini, / }));
    expect(await screen.findByRole('heading', { name: 'Gemini was not asked in this window' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^ChatGPT, / }));
    expect(await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ })).toBeInTheDocument();
  });

  it('shows an error with its request id and a retry that asks again', async () => {
    server.use(http.get(DAILY, () => failing('req-daily')));
    const { user } = render();
    expect(await screen.findByText('Could not load answer collection calendar')).toBeInTheDocument();
    expect(screen.getByText(/req-daily/)).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ })).toBeInTheDocument();
  });

  it('keeps the last figures and says so when a later read fails', async () => {
    serve();
    const { queryClient } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    server.use(http.get(DAILY, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: FRIDAY })).toBeInTheDocument();
  });

  it('keeps the grid on screen, undimmed, while a read runs again', async () => {
    serve();
    const { queryClient } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    server.use(http.get(DAILY, async () => delay('infinite')));
    act(() => {
      void queryClient.refetchQueries();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(screen.getByRole('cell', { name: FRIDAY })).toBeInTheDocument();
  });

  it('lists the run days of the engine in the Table view, with n/a where the schedule is unknown', async () => {
    serve(
      dailyResponse(
        [
          day({ date: '2026-11-03', scheduled: null, complete: 9 }),
          ...twoWeeks().data.filter((row) => row.engine_code === 'chatgpt_web' && row.date !== '2026-11-03'),
        ],
        { from: '2026-11-02', to: '2026-11-15' },
      ),
    );
    const { user } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Days collected for ChatGPT' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      'Day',
      'Scheduled',
      'Answers',
      'Valid',
      'Partial',
      'Empty',
      'Refused',
      'Error',
      'Budget-blocked runs',
    ]);
    const friday = within(table).getByRole('row', { name: /^Fri Nov 6/ });
    expect(within(friday).getByRole('rowheader')).toHaveTextContent('Fri Nov 6');
    expect(
      within(friday)
        .getAllByRole('cell')
        .map((node) => node.textContent),
    ).toEqual(['750', '750', '742', '42', '0', '6', '2', '0']);
    const unknown = within(table).getByRole('row', { name: /^Tue Nov 3/ });
    expect(within(unknown).getAllByRole('cell')[0]).toHaveTextContent('Schedule unknown');
    // A day never wraps onto three lines at half width
    expect(within(unknown).getByRole('rowheader').firstElementChild).toHaveClass('whitespace-nowrap');
    expect(within(table).queryByRole('row', { name: /^Wed Nov 4/ })).not.toBeInTheDocument();
  });

  it('registers the run days of every engine for the export under the layout item id, unknown as blank', async () => {
    serve();
    const { user } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const [block] = await readExport(user);
    expect(block?.id).toBe(ITEM_ID);
    expect(block?.header).toEqual([
      'Day',
      'Engine',
      'Scheduled',
      'Answers',
      'Valid',
      'Complete',
      'Partial',
      'Empty',
      'Refused',
      'Error',
      'Budget-blocked runs',
    ]);
    expect(block?.rows).toContainEqual(['2026-11-06', 'ChatGPT', 750, 750, 742, 700, 42, 0, 6, 2, 0]);
    expect(block?.rows).toContainEqual(['2026-11-06', 'Gemini', 500, 500, 440, 410, 30, 0, 40, 20, 0]);
    expect(block?.rows).toContainEqual(['2026-11-13', 'ChatGPT', 750, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(block?.rows.some((row) => row[0] === '2026-11-03')).toBe(false);
  });

  it('draws the collection of the seeded project from the mock API, and says nothing was collected for one with no run', async () => {
    const empty = render();
    expect(await screen.findByRole('heading', { name: 'No collection in this window' })).toBeInTheDocument();
    empty.unmount();
    setAiSeeded(true);
    render({ world: 'eventus-security' });
    const grid = await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const reporting = within(grid)
      .getAllByRole('cell')
      .filter((node) => /answers valid/.test(node.getAttribute('aria-label') ?? ''));
    expect(reporting.length).toBeGreaterThan(0);
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    serve();
    const { container } = render({ mode: 'customize' });
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    const controls = [...container.querySelectorAll('button, a[href], [tabindex="0"]')].filter(
      (element) => element.textContent !== 'Read export',
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('has no dash in what it shows, only plain characters, and passes axe', async () => {
    serve();
    const { container } = render();
    await screen.findByRole('table', { name: /^Collection calendar for ChatGPT/ });
    expect(container.textContent).not.toMatch(DASHES);
    for (const node of dayCells()) expect(node.getAttribute('aria-label')).not.toMatch(DASHES);
    expect(await axe(container)).toHaveNoViolations();
  });
});
