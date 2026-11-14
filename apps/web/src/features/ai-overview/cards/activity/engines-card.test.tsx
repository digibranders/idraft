import { act, screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DASHES,
  failing,
  ITEM_ID,
  PROJECT,
  readExport,
  renderActivityCard,
  serveList,
  stopRecording,
} from '@/test/ai-activity-kit';
import EnginesCard from './engines-card';
import { projectEngine, schedule } from './model/activity-fixtures';
import type { ProjectEngine, Schedule } from '@/lib/api/types';
import { setAiSeeded } from '@/mocks/ai-seed';
import { mockUser } from '@/mocks/fixtures';
import { clearPreferences, preferenceKey } from '@/lib/preferences/storage';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const ENGINES = `${PROJECT}/engines`;
const SCHEDULES = `${PROJECT}/schedules`;
const TYPE = 'ops.engines';
const TWICE_A_WEEK = [
  schedule({ n: 1, weekday: 1, nextRunAt: '2026-11-16T19:30:00Z' }),
  schedule({ n: 2, weekday: 4, nextRunAt: '2026-11-19T19:30:00Z' }),
];
const THREE: ProjectEngine[] = [
  projectEngine('chatgpt_web', { cost: '24.180000' }),
  projectEngine('gemini_web', { cost: '18.000000' }),
  projectEngine('google_ai_mode', { on: false, cost: '30.500000' }),
];

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

function serve(engines: readonly ProjectEngine[] = THREE, schedules: readonly Schedule[] = TWICE_A_WEEK): void {
  server.use(http.get(ENGINES, () => HttpResponse.json({ data: engines })));
  serveList(SCHEDULES, schedules);
}

const render = (options: Parameters<typeof renderActivityCard>[2] = {}): ReturnType<typeof renderActivityCard> =>
  renderActivityCard(TYPE, EnginesCard, options);
const table = (): Promise<HTMLElement> =>
  screen.findByRole('table', { name: 'Engines, days asked, next run and estimated cost per month' });
/** What the frame says to a screen reader about the card (its visually hidden summary). */
const summaryOf = (container: HTMLElement): string | undefined =>
  container.querySelector('section > p.sr-only')?.textContent;
const rowOf = (within_: HTMLElement, name: string): HTMLElement =>
  within(within_).getByRole('row', { name: new RegExp(`^${name}`) });

describe('the engines and schedule card', () => {
  it('shows a skeleton at the frame height while the engines load, under its title', async () => {
    server.use(http.get(ENGINES, async () => delay('infinite')));
    render();
    await screen.findByRole('heading', { name: 'Engines and schedule' });
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy?.querySelector('[data-slot="skeleton"]')?.parentElement).toHaveStyle({ height: '180px' });
  });

  it('is one row per project engine with its state, days asked, next run and estimated cost', async () => {
    serve();
    render();
    const grid = await table();
    expect(within(grid).getAllByRole('row')).toHaveLength(4);
    const chatgpt = rowOf(grid, 'ChatGPT');
    expect(chatgpt).toHaveTextContent('On');
    expect(chatgpt).toHaveTextContent('Mon and Thu');
    expect(chatgpt).toHaveTextContent('Nov 16, 20:30');
    expect(chatgpt).toHaveTextContent('$24.18 estimate');
  });

  it('shows an engine that is off as Off, not asked, with its cost labelled if on', async () => {
    serve();
    render();
    const mode = rowOf(await table(), 'Google AI Mode');
    expect(mode).toHaveTextContent('Off');
    expect(mode).toHaveTextContent('Not asked');
    expect(mode).toHaveTextContent('$30.50 if on');
    expect(mode).not.toHaveTextContent('Mon and Thu');
  });

  it('says how many engines are on in the meta line', async () => {
    serve();
    render();
    await table();
    expect(screen.getByText('2 of 3 engines on')).toBeInTheDocument();
  });

  it('shows n/a, never $0.00, for a price the book does not have', async () => {
    serve([projectEngine('chatgpt_web', { cost: null }), projectEngine('gemini_web', { on: false, cost: null })]);
    const { container } = render();
    const grid = await table();
    expect(rowOf(grid, 'ChatGPT')).toHaveTextContent('n/a');
    expect(rowOf(grid, 'Gemini')).toHaveTextContent('n/a');
    expect(container.textContent).not.toContain('$0');
  });

  it('never adds the engines up: no total row and no summed figure', async () => {
    serve();
    const { container } = render();
    const grid = await table();
    expect(within(grid).getAllByRole('row')).toHaveLength(THREE.length + 1);
    expect(grid.querySelector('tfoot')).toBeNull();
    // 24.18 + 18.00 + 30.50 and 24.18 + 18.00
    expect(container.textContent).not.toContain('$72.68');
    expect(container.textContent).not.toContain('$42.18');
  });

  it.each([
    ['daily', [schedule({ n: 1, cadence: 'daily', weekday: null })], 'Every day'],
    ['cron', [schedule({ n: 1, cadence: 'cron', weekday: null })], 'Custom schedule'],
    ['none', [], 'Not scheduled'],
    ['paused', [schedule({ n: 1, active: false })], 'Paused'],
  ] as const)('shows %s schedules as the words of the plan', async (_name, schedules, words) => {
    serve(THREE, schedules);
    render();
    expect(rowOf(await table(), 'ChatGPT')).toHaveTextContent(words);
  });

  it('shows n/a for days and next run, and says so, when the schedules could not be read', async () => {
    server.use(http.get(ENGINES, () => HttpResponse.json({ data: THREE })));
    server.use(http.get(SCHEDULES, () => failing('req-schedules')));
    render();
    const grid = await table();
    expect(rowOf(grid, 'ChatGPT')).toHaveTextContent('n/a');
    expect(screen.getByText('Schedules could not be read, so days and next runs show n/a')).toBeInTheDocument();
  });

  it('shows the error with its id and reads again on Try again', async () => {
    server.use(http.get(ENGINES, () => failing('req-engines')));
    serveList(SCHEDULES, TWICE_A_WEEK);
    const { user } = render();
    expect(await screen.findByText('Could not load engines and schedule')).toBeInTheDocument();
    expect(screen.getByText(/req-engines/)).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await table()).toBeInTheDocument();
  });

  it('keeps the rows on screen while a read runs again, and says when the last read failed', async () => {
    serve();
    const { queryClient } = render();
    await table();
    server.use(http.get(ENGINES, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(rowOf(screen.getByRole('table'), 'ChatGPT')).toBeInTheDocument();
  });

  it('says no engine is set up, with the link to the engines for a member who can turn one on', async () => {
    serve([]);
    render({ role: 'admin' });
    expect(await screen.findByRole('heading', { name: 'No engine is set up' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on engines' })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/engines'),
    );
  });

  it('sends a member who cannot turn one on to ask an admin, with no link', async () => {
    serve([]);
    render({ role: 'viewer' });
    expect(await screen.findByText(/Ask a workspace admin to turn on an engine\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Turn on engines' })).not.toBeInTheDocument();
  });

  it.each([
    ['default', { tableDensity: 'default' }],
    ['compact', {}],
  ])('keeps rows at the compact height of an embedded table in %s density', async (_name, preference) => {
    localStorage.setItem(preferenceKey(mockUser('admin').user_id, 'settings'), JSON.stringify(preference));
    serve();
    render();
    const grid = await table();
    const body = within(grid).getAllByRole('row').slice(1);
    for (const row of body) expect(row.className).toContain('h-row-compact');
  });

  it('keeps the card narrow: three columns with the state inside the engine cell and the cost second', async () => {
    serve();
    render();
    const grid = await table();
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Cost', 'Schedule']);
    const cells = within(rowOf(grid, 'ChatGPT')).getAllByRole('cell');
    // The row header holds the engine and its state; the first cell after it is the cost
    expect(within(rowOf(grid, 'ChatGPT')).getByRole('rowheader')).toHaveTextContent('ChatGPTOn');
    expect(cells[0]).toHaveTextContent('$24.18 estimate');
    expect(cells[1]).toHaveTextContent('Mon and Thu');
    expect(cells[1]).toHaveTextContent('Nov 16, 20:30');
  });

  it('shows a paused or missing schedule once, not as two equal lines', async () => {
    serve(THREE, [schedule({ n: 1, active: false })]);
    render();
    const cell = within(rowOf(await table(), 'ChatGPT')).getAllByRole('cell')[1];
    expect(cell?.textContent).toBe('Paused');
  });

  it('lists every field in its own column in the Table view', async () => {
    serve();
    const { user } = render();
    await table();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await table();
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Status', 'Days asked', 'Next run', 'Estimated cost per month']);
    expect(within(grid).getAllByRole('row')).toHaveLength(4);
    expect(rowOf(grid, 'ChatGPT')).toHaveTextContent('$24.18 estimate');
  });

  it('describes nothing it does not know to a screen reader while loading or after a failure', async () => {
    server.use(http.get(ENGINES, async () => delay('infinite')));
    const first = render();
    await screen.findByRole('heading', { name: 'Engines and schedule' });
    expect(summaryOf(first.container)).toBe('Engines and schedule');
    first.unmount();
    server.use(http.get(ENGINES, () => failing('req-engines')));
    const second = render();
    await screen.findByText('Could not load engines and schedule');
    expect(summaryOf(second.container)).toBe('Engines and schedule');
  });

  it('describes the rows to a screen reader once they are read', async () => {
    serve();
    const { container } = render();
    await table();
    expect(summaryOf(container)).toBe('2 of 3 engines are on: ChatGPT and Gemini.');
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    serve();
    const { container } = render({ mode: 'customize' });
    await table();
    const controls = [...container.querySelectorAll('button, a[href]')].filter(
      (element) => element.textContent !== 'Read export',
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('registers its rows for the export under the layout item id, with the estimate named', async () => {
    serve();
    const { user } = render();
    await table();
    const [block] = await readExport(user);
    expect(block?.id).toBe(ITEM_ID);
    expect(block?.header).toEqual(['Engine', 'Status', 'Days asked', 'Next run', 'Estimated cost per month']);
    expect(block?.rows).toHaveLength(3);
    expect(block?.rows[0]).toEqual(['ChatGPT', 'On', 'Mon and Thu', 'Nov 16, 20:30', '$24.18 estimate']);
    expect(block?.rows[2]).toEqual(['Google AI Mode', 'Off', 'Not asked', 'Not asked', '$30.50 if on']);
  });

  it('has the Eventus engines with their two weekly days', async () => {
    setAiSeeded(true);
    render({ world: 'eventus-security' });
    const grid = await table();
    expect(rowOf(grid, 'ChatGPT')).toHaveTextContent('Mon and Thu');
  });

  it('has no dash in what it shows, and passes axe', async () => {
    serve();
    const { container } = render();
    await table();
    expect(container.textContent).not.toMatch(DASHES);
    expect(await axe(container)).toHaveNoViolations();
  });
});
