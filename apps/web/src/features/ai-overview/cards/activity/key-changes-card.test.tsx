import { act, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import KeyChangesCard from './key-changes-card';
import { run, schedule } from './model/activity-fixtures';
import { dailyResponse, day } from './model/daily-fixtures';
import { engineCells, promptRow, summaryOf } from '../engines/engines-fixtures';
import { changePage, changeRow } from '../sources/model/change-fixtures';
import { domainPage, sourcesMeta } from '../sources/model/source-fixtures';
import type { CardDrill } from '../engines/use-card-seams';
import { announce } from '@/lib/a11y/announcer';
import type { PromptsSummary, Run } from '@/lib/api/types';
import { MINUS } from '@/lib/format';
import {
  DASHES,
  failing,
  ITEM_ID,
  PROJECT,
  readExport,
  recordRequests,
  renderActivityCard,
  serveList,
  stopRecording,
} from '@/test/ai-activity-kit';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
// The real announcer, watched: the part speaks through it and never through a live region of its own
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

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

const TYPE = 'activity.key_changes';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const PREVIOUS_TO = '2026-10-15';
const SUMMARY = `${PROJECT}/ai/prompts-summary`;
const RUNS = `${PROJECT}/runs`;
const SCHEDULES = `${PROJECT}/schedules`;
const DAILY = `${PROJECT}/ai/collection/daily`;
const CHANGES = `${PROJECT}/ai/sources/changes`;
const DOMAINS = `${PROJECT}/ai/sources/domains`;
const CODES = ['chatgpt_web', 'gemini_web'] as const;

const STEADY: readonly [number, number] = [400, 1000];
// 700 of 1,800 against 575 of 1,800 is a rise beyond normal variation, and the other way round a fall
const HIGH: readonly [number, number] = [700, 1800];
const LOW: readonly [number, number] = [575, 1800];

const windowOf = (
  chatgptMention: readonly [number, number],
  chatgptCited: readonly [number, number],
  geminiMention: readonly [number, number] = STEADY,
): PromptsSummary =>
  summaryOf(
    [
      promptRow('p1', [
        engineCells('chatgpt_web', { mentioned: chatgptMention, cited: chatgptCited }),
        engineCells('gemini_web', { mentioned: geminiMention, cited: [0, geminiMention[1]] }),
      ]),
    ],
    { codes: CODES },
  );

/** ChatGPT mention rose and ChatGPT citation fell, both beyond normal variation. */
const MOVED = { now: windowOf(HIGH, LOW), before: windowOf(LOW, HIGH) };
const QUIET = { now: windowOf([404, 1000], [400, 1000]), before: windowOf([400, 1000], [404, 1000]) };

// Fynix keeps Berlin time, one hour ahead of UTC in November
const FINISHED = run({ n: 1, createdAt: '2026-11-12T00:10:00Z', completedAt: '2026-11-12T01:10:00Z' });

interface World {
  summaries?: { now: PromptsSummary; before: PromptsSummary };
  runs?: readonly Run[];
  daily?: ReturnType<typeof dailyResponse> | 'fail' | 'none';
  /** Domains new in the window; `null` fails the read. */
  newSources?: number | null;
  /** Valid answers in the window before, for the new sources. */
  beforeAnswers?: number;
}

function serve({
  summaries = MOVED,
  runs = [FINISHED],
  daily = 'none',
  newSources = 37,
  beforeAnswers = 5000,
}: World = {}): void {
  server.use(
    http.get(SUMMARY, ({ request }) =>
      HttpResponse.json({
        data: new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? summaries.before : summaries.now,
      }),
    ),
    http.get(CHANGES, () =>
      newSources === null
        ? failing('req-changes')
        : HttpResponse.json(changePage('new', [changeRow({ domain: 'reddit.com', now: 14 })], { total: newSources })),
    ),
    http.get(DOMAINS, () =>
      HttpResponse.json(domainPage([], sourcesMeta({ units: 900, answers: beforeAnswers, engines: ['chatgpt_web'] }))),
    ),
    http.get(DAILY, () =>
      daily === 'fail'
        ? failing('req-daily')
        : HttpResponse.json(daily === 'none' ? dailyResponse([], { from: '2026-10-16', to: '2026-11-12' }) : daily),
    ),
  );
  serveList(RUNS, runs);
  serveList(SCHEDULES, [schedule({ n: 1 })]);
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  stopRecording();
  seam.drill = null;
  window.history.replaceState({}, '', '/');
  vi.mocked(announce).mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (options: Parameters<typeof renderActivityCard>[2] = {}): ReturnType<typeof renderActivityCard> =>
  renderActivityCard(TYPE, KeyChangesCard, { searchParams: WINDOW, ...options });

// The counts come first on a row, so a line that is cut keeps them; the export has the whole change in words
const RISE = '700 of 1,800 answers mention you on ChatGPT (38.9%), was 575 of 1,800 (31.9%)';
const FALL = '575 of 1,800 answers cite you on ChatGPT (31.9%), was 700 of 1,800 (38.9%)';
const FALL_FULL = 'ChatGPT citation rate fell to 31.9% (575 of 1,800 answers), from 38.9% (700 of 1,800 answers)';
const NEW_SOURCES = 'New sources: 37 domains';
const RUN_ERRORS = '12 of 250 answers failed in the AI run, Nov 12, 02:10';

const feed = (): Promise<HTMLElement> => screen.findByRole('heading', { name: 'Key changes' });
// A row is an item with a time; a row whose page cannot show the scope has no link
const rowsOf = (): HTMLElement[] =>
  screen.getAllByRole('listitem').filter((item) => item.querySelector('time') !== null);
const rowText = (text: string): HTMLElement => {
  const row = rowsOf().find((item) => item.textContent?.includes(text));
  if (row === undefined) throw new Error(`No row says "${text}"`);
  return row;
};

describe('the key changes card', () => {
  it('shows a skeleton under its title while the reads load', async () => {
    server.use(http.get(SUMMARY, async () => delay('infinite')));
    render();
    await feed();
    const busy = document.querySelector('section[aria-busy="true"]');
    expect(busy?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('draws the ChangeFeed alone, with no chart frame around it', async () => {
    serve();
    const { container } = render();
    await screen.findByText(RISE);
    expect(container.querySelectorAll('section')).toHaveLength(1);
    expect(container.querySelector('[data-slot="chart-frame"]')).toBeNull();
  });

  it('lists a detectable fall under Needs attention and a rise, with the new sources, under Changes', async () => {
    serve();
    render();
    await screen.findByText(RISE);
    const groups = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(groups).toEqual(['Needs attention', 'Changes', 'Notices']);
    const needs = screen.getByRole('list', { name: 'Needs attention' });
    const changes = screen.getByRole('list', { name: 'Changes' });
    const notices = screen.getByRole('list', { name: 'Notices' });
    expect(within(needs).getByText(FALL)).toBeInTheDocument();
    expect(within(changes).getByText(RISE)).toBeInTheDocument();
    expect(within(changes).getByText(NEW_SOURCES)).toBeInTheDocument();
    expect(within(notices).getByText(RUN_ERRORS)).toBeInTheDocument();
  });

  it('puts a count beside each group heading', async () => {
    serve();
    render();
    await screen.findByText(RISE);
    expect(screen.getByRole('heading', { name: 'Needs attention' }).nextElementSibling).toHaveTextContent('1 change');
    expect(screen.getByRole('heading', { name: 'Changes' }).nextElementSibling).toHaveTextContent('2 changes');
    expect(screen.getByRole('heading', { name: 'Notices' }).nextElementSibling).toHaveTextContent('1 change');
  });

  it('writes every percent with its count, and the change in points on the row', async () => {
    serve();
    render();
    await screen.findByText(RISE);
    const row = rowText(RISE);
    expect(row).toHaveTextContent('+6.9 pts');
    // Both percents of the row follow their count: "575 of 1,800 ... (31.9%)" and "was 700 of 1,800 (38.9%)"
    expect(FALL.match(/[\d,]+ of [\d,]+[^(]*\(\d+\.\d%\)/g)).toHaveLength(2);
    expect(rowText(FALL)).toHaveTextContent(`${MINUS}6.9 pts`);
  });

  it('never makes a row of a move within normal variation, and says so when nothing else is listed', async () => {
    serve({ summaries: QUIET, runs: [], newSources: 0 });
    render();
    expect(await screen.findByRole('heading', { name: 'No detectable changes in these 28 days' })).toBeInTheDocument();
    expect(screen.getByText('Changes within normal variation are left out.')).toBeInTheDocument();
    expect(screen.queryByText(/fell|rose/)).not.toBeInTheDocument();
  });

  it('is no row when no domain is new', async () => {
    serve({ newSources: 0 });
    render();
    await screen.findByText(RISE);
    expect(screen.queryByText(/New sources/)).not.toBeInTheDocument();
  });

  it('holds the changes with the comparison off: only the collection notices, and it says why', async () => {
    serve();
    render({ searchParams: `${WINDOW}&cmp=off` });
    await screen.findByText(RUN_ERRORS);
    expect(
      screen.getByText(/Changes are not compared for this window: the comparison with the window before is off/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/fell|rose/)).not.toBeInTheDocument();
    expect(screen.queryByText(NEW_SOURCES)).not.toBeInTheDocument();
    expect(rowsOf()).toHaveLength(1);
  });

  it('holds the changes when the window before has no valid answers', async () => {
    serve({ summaries: { now: MOVED.now, before: windowOf([0, 0], [0, 0], [0, 0]) } });
    render();
    await screen.findByText(RUN_ERRORS);
    expect(screen.getByText(/the window before has no valid answers/)).toBeInTheDocument();
    expect(screen.queryByText(/fell|rose/)).not.toBeInTheDocument();
  });

  it('is no "0 new" row when the window before has no answers: it says new sources were not checked', async () => {
    serve({ beforeAnswers: 0 });
    render();
    await screen.findByText(RISE);
    expect(screen.queryByText(/New sources/)).not.toBeInTheDocument();
    expect(screen.getByText('Not checked: new sources')).toBeInTheDocument();
  });

  it('lists the budget-blocked runs and the latest day with refused or failed answers of each engine', async () => {
    serve({
      runs: [run({ n: 2, status: 'budget_blocked', createdAt: '2026-11-12T08:00:00Z', completedAt: null }), FINISHED],
      daily: dailyResponse(
        [
          day({ date: '2026-11-06', complete: 742, refused: 6, error: 2 }),
          day({ date: '2026-11-06', engine: 'gemini_web', scheduled: 500, complete: 440, refused: 40, error: 20 }),
        ],
        { from: '2026-10-16', to: '2026-11-12' },
      ),
    });
    render();
    await screen.findByText('1 AI run blocked by the budget, the latest Nov 12, 09:00');
    expect(
      screen.getByText('8 of 750 ChatGPT answers refused or failed on Nov 6 (6 refused, 2 errors)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('60 of 500 Gemini answers refused or failed on Nov 6 (40 refused, 20 errors)'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Needs attention' })).getByText(/blocked by the budget/),
    ).toBeInTheDocument();
  });

  it('shows 5 rows or 8 as the Rows option says, most urgent first', async () => {
    const many = {
      runs: [run({ n: 2, status: 'budget_blocked', createdAt: '2026-11-12T08:00:00Z', completedAt: null }), FINISHED],
      daily: dailyResponse([day({ date: '2026-11-06', complete: 742, refused: 6, error: 2 })], {
        from: '2026-10-16',
        to: '2026-11-12',
      }),
    };
    serve(many);
    const five = render({ options: { rows: '5' } });
    await screen.findByText(RISE);
    expect(rowsOf()).toHaveLength(5);
    expect(rowsOf()[0]).toHaveTextContent(/blocked by the budget/);
    // The cut keeps the most urgent rows: the oldest notice is the one left out, and the card says so
    expect(screen.queryByText(/refused or failed on Nov 6/)).not.toBeInTheDocument();
    expect(screen.getByText('1 more change is not shown, and the export lists every row')).toBeInTheDocument();
    const [block] = await readExport(five.user);
    expect(block?.rows).toHaveLength(6);
    five.unmount();
    serve(many);
    render({ options: { rows: '8' } });
    await screen.findByText(RISE);
    expect(rowsOf()).toHaveLength(6);
    expect(screen.queryByText(/more changes? (is|are) not shown/)).not.toBeInTheDocument();
  });

  it('says which part could not be checked and shows the others when one read fails', async () => {
    serve({ daily: 'fail' });
    render();
    expect(await screen.findByText(RISE)).toBeInTheDocument();
    expect(screen.getByText('Not checked: collection by day')).toBeInTheDocument();
    expect(screen.getByText(RUN_ERRORS)).toBeInTheDocument();
  });

  it('says the changes since the window before were not checked when that window cannot be read', async () => {
    serve();
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('to') === PREVIOUS_TO
          ? failing('req-before')
          : HttpResponse.json({ data: MOVED.now }),
      ),
    );
    render();
    await screen.findByText(RUN_ERRORS);
    expect(screen.getByText('Not checked: changes since the window before')).toBeInTheDocument();
    expect(screen.queryByText(/fell|rose/)).not.toBeInTheDocument();
  });

  it('shows the error with its id and reads again on Try again when nothing could be read', async () => {
    server.use(
      http.get(SUMMARY, () => failing('req-summary')),
      http.get(RUNS, () => failing('req-runs')),
      http.get(DAILY, () => failing('req-daily')),
      http.get(CHANGES, () => failing('req-changes')),
    );
    const { user } = render();
    expect(await screen.findByText('Could not load key changes')).toBeInTheDocument();
    expect(screen.getByText(/req-summary/)).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(RISE)).toBeInTheDocument();
  });

  it('names a failed read in the same notice that says the figures are stale', async () => {
    serve({ daily: 'fail' });
    const { queryClient } = render();
    await screen.findByText('Not checked: collection by day');
    server.use(http.get(RUNS, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(
      await screen.findByText('Stale: these are the last figures read. Not checked: collection by day'),
    ).toBeInTheDocument();
  });

  it('asks for one list of changes, the new domains, and not for the lost ones', async () => {
    const seen = recordRequests();
    serve();
    render();
    await screen.findByText(RISE);
    const asked = seen.filter((url) => url.pathname.endsWith('/ai/sources/changes'));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('kind')).toBe('new');
    expect(asked[0]?.searchParams.get('limit')).toBe('1');
  });

  it('lists no run made after the last day of a past window, blocked or not', async () => {
    serve({
      summaries: QUIET,
      newSources: 0,
      runs: [run({ n: 2, status: 'budget_blocked', createdAt: '2026-11-12T08:00:00Z', completedAt: null }), FINISHED],
    });
    render({ searchParams: 'from=2026-10-01&to=2026-10-14' });
    expect(await screen.findByRole('heading', { name: 'No detectable changes in these 14 days' })).toBeInTheDocument();
    expect(screen.queryByText(/AI run/)).not.toBeInTheDocument();
  });

  it('says no engine is asked, and that changes are not compared, when the engine filter names none that is on', async () => {
    serve();
    render({ searchParams: `${WINDOW}&engine=google_ai_mode` });
    expect(
      await screen.findByText(
        'Changes are not compared: no engine is asked. Turn on an engine, or choose one that is on.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mention you|cite you/)).not.toBeInTheDocument();
  });

  it('keeps the rows and says so when a later read fails', async () => {
    serve();
    const { queryClient } = render();
    await screen.findByText(RUN_ERRORS);
    server.use(http.get(RUNS, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(screen.getByText(RUN_ERRORS)).toBeInTheDocument();
    expect(screen.getByText(RISE)).toBeInTheDocument();
  });

  it('keeps the rows on screen while a read runs again, with the static refetch bar', async () => {
    serve();
    const { queryClient } = render();
    await screen.findByText(RISE);
    server.use(http.get(RUNS, async () => delay('infinite')));
    act(() => {
      void queryClient.refetchQueries();
    });
    expect(await screen.findByText(RISE)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="feed-refetch-bar"]')).not.toBeNull();
  });

  it('announces a row that arrives later, and not the first load', async () => {
    serve({ newSources: 0 });
    const { queryClient } = render();
    await screen.findByText(RISE);
    expect(announce).not.toHaveBeenCalled();
    serve({ newSources: 37 });
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await screen.findByText(NEW_SOURCES);
    expect(announce).toHaveBeenCalledWith('1 new change', { key: 'change-feed' });
  });

  it('links each row through the drill seam, and a new source row to the New and lost list', async () => {
    seam.drill = (kind, extra) =>
      `/digibranders/fynix/${kind}${extra?.engine === undefined ? '' : `?engine=${extra.engine}&metric=${extra.metric ?? ''}`}` as Route;
    serve();
    render();
    await screen.findByText(RISE);
    expect(rowText(RISE).querySelector('a')).toHaveAttribute(
      'href',
      '/digibranders/fynix/prompts?engine=chatgpt_web&metric=mention',
    );
    expect(rowText(FALL).querySelector('a')).toHaveAttribute(
      'href',
      '/digibranders/fynix/prompts?engine=chatgpt_web&metric=citation',
    );
    expect(rowText(RUN_ERRORS).querySelector('a')).toHaveAttribute('href', '/digibranders/fynix/runs');
    expect(rowText(NEW_SOURCES).querySelector('a')).toHaveAttribute(
      'href',
      '/digibranders/fynix/citations?tab=new-lost&kind=new',
    );
  });

  it('shows a row whose page cannot show the scope as plain text, with no link', async () => {
    seam.drill = () => null;
    serve();
    render();
    await screen.findByText(RISE);
    expect(rowsOf().length).toBeGreaterThan(0);
    for (const row of rowsOf()) expect(row.querySelector('a')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links only the rows whose destination can show the scope, and leaves the others plain', async () => {
    seam.drill = (kind) => (kind === 'runs' ? null : (`/digibranders/fynix/${kind}` as Route));
    serve();
    render();
    await screen.findByText(RISE);
    expect(rowText(RISE).querySelector('a')).toHaveAttribute('href', '/digibranders/fynix/prompts');
    expect(rowText(RUN_ERRORS).querySelector('a')).toBeNull();
  });

  it('dates a row about the whole window by the window, and a run by its own time', async () => {
    serve();
    render();
    await screen.findByText(RISE);
    expect(rowText(RISE).querySelector('time')).toHaveTextContent('28 days');
    expect(rowText(NEW_SOURCES).querySelector('time')).toHaveTextContent('28 days');
    // The exact moment stays in the datetime: the start of the window's last day in Berlin
    expect(rowText(RISE).querySelector('time')).toHaveAttribute('datetime', '2026-11-11T23:00:00.000Z');
    expect(rowText(RISE)).not.toHaveTextContent('just now');
    // The run finished at 02:10 Berlin time, 10 hours before the clock of the test
    expect(rowText(RUN_ERRORS).querySelector('time')).toHaveTextContent('10h ago');
  });

  it('reaches every row with the keyboard', async () => {
    seam.drill = (kind) => `/digibranders/fynix/${kind}` as Route;
    serve();
    const { user } = render();
    await screen.findByText(RISE);
    const links = rowsOf().map((row) => row.querySelector('a'));
    for (const link of links) {
      for (let step = 0; step < 30 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });

  it('makes no request for run history, and makes no run row, for a role without access to runs', async () => {
    const seen = recordRequests();
    serve();
    render({ role: 'billing', searchParams: WINDOW });
    expect(
      await screen.findByText('Not checked: collection runs (run history is not available for your role)'),
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(seen.filter((url) => url.pathname.endsWith('/runs'))).toEqual([]);
    expect(screen.queryByText(RUN_ERRORS)).not.toBeInTheDocument();
  });

  it('registers its rows for the export under the layout item id, in the order the feed draws them', async () => {
    serve();
    const { user } = render();
    await screen.findByText(RISE);
    const [block] = await readExport(user);
    expect(block?.id).toBe(ITEM_ID);
    expect(block?.header).toEqual(['Group', 'Change', 'Engine', 'Count', 'Out of', 'When']);
    expect(block?.rows.map((row) => row[0])).toEqual(['Needs attention', 'Changes', 'Changes', 'Notices']);
    // The export says the whole change in words, and dates a window row by its last day, not by a time of day
    expect(block?.rows).toContainEqual(['Needs attention', FALL_FULL, 'ChatGPT', 575, 1800, '2026-11-12']);
    expect(block?.rows).toContainEqual(['Changes', NEW_SOURCES, null, 37, null, '2026-11-12']);
    expect(block?.rows.find((row) => row[0] === 'Notices')?.[5]).toBe('2026-11-12T01:10:00Z');
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    seam.drill = (kind) => `/digibranders/fynix/${kind}` as Route;
    serve();
    const { container } = render({ mode: 'customize' });
    await screen.findByText(RISE);
    const controls = [...container.querySelectorAll('button, a[href]')].filter(
      (element) => element.textContent !== 'Read export',
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('has no dash in what it shows, and passes axe', async () => {
    serve();
    const { container } = render();
    await screen.findByText(RISE);
    expect(container.textContent).not.toMatch(DASHES);
    expect(await axe(container)).toHaveNoViolations();
  });
});
