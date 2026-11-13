import { act, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { delay, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import CollectionStatusCard from './collection-status-card';
import { run, schedule } from './model/activity-fixtures';
import type { CardDrill } from '../engines/use-card-seams';
import type { Run, Schedule } from '@/lib/api/types';
import { setAiSeeded } from '@/mocks/ai-seed';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';

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

const RUNS = `${PROJECT}/runs`;
const SCHEDULES = `${PROJECT}/schedules`;
const TYPE = 'activity.collection_status';

// Fynix keeps Berlin time, one hour ahead of UTC in November
const FINISHED = run({ n: 1, createdAt: '2026-11-12T00:10:00Z', completedAt: '2026-11-12T01:10:00Z' });
const WEEKLY = [schedule({ n: 1, weekday: 1, nextRunAt: '2026-11-16T19:30:00Z' })];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  stopRecording();
  seam.drill = null;
  setAiSeeded(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function serve({ runs, schedules = WEEKLY }: { runs: readonly Run[]; schedules?: readonly Schedule[] }): void {
  serveList(RUNS, runs);
  serveList(SCHEDULES, schedules);
}

const render = (options: Parameters<typeof renderActivityCard>[2] = {}): ReturnType<typeof renderActivityCard> =>
  renderActivityCard(TYPE, CollectionStatusCard, options);
const card = (): Promise<HTMLElement> => screen.findByRole('heading', { name: 'Collection status' });

describe('the collection status card', () => {
  it('shows a skeleton at the frame height while the runs load, under its title', async () => {
    server.use(http.get(RUNS, async () => delay('infinite')));
    render();
    await card();
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.querySelector('[data-slot="skeleton"]')?.parentElement).toHaveStyle({ height: '180px' });
  });

  it('shows the newest finished run with its counts, its status and the next run', async () => {
    serve({ runs: [FINISHED] });
    render();
    expect(await screen.findByText('AI prompts, Nov 12, 02:10')).toBeInTheDocument();
    expect(screen.getByText('238 of 250 answers asked collected, 12 failed')).toBeInTheDocument();
    expect(screen.getByText('Completed with errors')).toBeInTheDocument();
    expect(screen.getByText('Next run: Nov 16, 20:30')).toBeInTheDocument();
  });

  it('asks the newest 10 runs of the AI workload, and the schedules once for the card', async () => {
    const seen = recordRequests();
    serve({ runs: [FINISHED] });
    render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    const runs = seen.filter((url) => url.pathname.endsWith('/runs'));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.searchParams.get('filter[workload_in]')).toBe('ai_prompt');
    expect(runs[0]?.searchParams.get('limit')).toBe('10');
    expect(seen.filter((url) => url.pathname.endsWith('/schedules'))).toHaveLength(1);
  });

  it('shows a run under way as Collecting with its counts, beside the last finished run', async () => {
    serve({
      runs: [
        run({
          n: 2,
          status: 'running',
          createdAt: '2026-11-12T11:00:00Z',
          completedAt: null,
          succeeded: 90,
          failed: 0,
        }),
        FINISHED,
      ],
    });
    render();
    expect(await screen.findByText('Collecting: 90 of 250')).toBeInTheDocument();
    expect(screen.getByText('238 of 250 answers asked collected, 12 failed')).toBeInTheDocument();
  });

  it('says every AI schedule is paused, and not that none is scheduled', async () => {
    serve({ runs: [FINISHED], schedules: [schedule({ n: 1, active: false })] });
    render();
    expect(await screen.findByText('All AI schedules are paused')).toBeInTheDocument();
    expect(screen.queryByText('No AI run is scheduled')).not.toBeInTheDocument();
  });

  it('says no AI run is scheduled for a project with no schedule', async () => {
    serve({ runs: [FINISHED], schedules: [] });
    render();
    expect(await screen.findByText('No AI run is scheduled')).toBeInTheDocument();
    expect(screen.queryByText('All AI schedules are paused')).not.toBeInTheDocument();
  });

  it('shows n/a for the next run when the schedules could not be read, and keeps the rest', async () => {
    serveList(RUNS, [FINISHED]);
    server.use(http.get(SCHEDULES, () => failing('req-schedules')));
    render();
    expect(await screen.findByText('Next run: n/a')).toBeInTheDocument();
    expect(screen.getByText('238 of 250 answers asked collected, 12 failed')).toBeInTheDocument();
  });

  it('names the runs the budget blocked, with how many and the latest day', async () => {
    serve({
      runs: [
        run({
          n: 2,
          status: 'budget_blocked',
          createdAt: '2026-11-12T08:00:00Z',
          completedAt: null,
          succeeded: 0,
          failed: 0,
        }),
        FINISHED,
      ],
    });
    render();
    expect(await screen.findByText('1 run was blocked by the budget, the latest on Nov 12, 09:00')).toBeInTheDocument();
  });

  it('shows an empty state with the next run when no AI run has finished', async () => {
    serve({ runs: [] });
    render();
    expect(await screen.findByRole('heading', { name: 'No AI run has finished yet' })).toBeInTheDocument();
    expect(screen.getByText('The next run is on Nov 16, 20:30.')).toBeInTheDocument();
  });

  it('says in the empty state that every schedule is paused, and not that none is', async () => {
    serve({ runs: [], schedules: [schedule({ n: 1, active: false })] });
    render();
    expect(await screen.findByRole('heading', { name: 'No AI run has finished yet' })).toBeInTheDocument();
    expect(screen.getByText('All AI schedules are paused.')).toBeInTheDocument();
    expect(screen.queryByText('No AI run is scheduled.')).not.toBeInTheDocument();
  });

  it('is empty on Fynix, which has no AI run', async () => {
    render();
    expect(await screen.findByRole('heading', { name: 'No AI run has finished yet' })).toBeInTheDocument();
  });

  it('has real runs on the Eventus world, with the counts printed', async () => {
    setAiSeeded(true);
    render({ world: 'eventus-security' });
    expect(await screen.findByText(/^\d+ of 144 answers asked collected, \d+ failed$/)).toBeInTheDocument();
  });

  it('says the history is not available, and reads no run, for a role without access to runs', async () => {
    const seen = recordRequests();
    render({ role: 'billing' });
    expect(await screen.findByText('Run history is not available for your role')).toBeInTheDocument();
    expect(seen.filter((url) => url.pathname.endsWith('/runs'))).toEqual([]);
  });

  it('shows the error with its id and reads again on Try again', async () => {
    server.use(http.get(RUNS, () => failing('req-runs')));
    serveList(SCHEDULES, WEEKLY);
    const { user } = render();
    expect(await screen.findByText('Could not load collection status')).toBeInTheDocument();
    expect(screen.getByText(/req-runs/)).toBeInTheDocument();
    serve({ runs: [FINISHED] });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('238 of 250 answers asked collected, 12 failed')).toBeInTheDocument();
  });

  it('keeps the last figures and says so when a later read fails', async () => {
    serve({ runs: [FINISHED] });
    const { queryClient } = render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    server.use(http.get(RUNS, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(screen.getByText('238 of 250 answers asked collected, 12 failed')).toBeInTheDocument();
  });

  it('keeps the figures on screen, undimmed, while a read runs again', async () => {
    serve({ runs: [FINISHED] });
    const { queryClient } = render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    server.use(http.get(RUNS, async () => delay('infinite')));
    act(() => {
      void queryClient.refetchQueries();
    });
    expect(await screen.findByText('238 of 250 answers asked collected, 12 failed')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
  });

  it('links View runs through the drill seam', async () => {
    seam.drill = (kind) => `/digibranders/fynix/${kind}` as Route;
    serve({ runs: [FINISHED] });
    render();
    expect(await screen.findByRole('link', { name: 'View runs' })).toHaveAttribute('href', '/digibranders/fynix/runs');
  });

  it('shows no View runs link where the drill seam has no page', async () => {
    seam.drill = () => null;
    serve({ runs: [FINISHED] });
    render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    expect(screen.queryByRole('link', { name: 'View runs' })).not.toBeInTheDocument();
  });

  it('reaches View runs with the keyboard', async () => {
    seam.drill = (kind) => `/digibranders/fynix/${kind}` as Route;
    serve({ runs: [FINISHED] });
    const { user } = render();
    const link = await screen.findByRole('link', { name: 'View runs' });
    for (let step = 0; step < 15 && document.activeElement !== link; step += 1) await user.tab();
    expect(document.activeElement).toBe(link);
  });

  it('lists the same facts in the Table view', async () => {
    serve({ runs: [FINISHED] });
    const { user } = render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Collection status of the AI runs' });
    expect(within(table).getByRole('row', { name: /Answers collected/ })).toHaveTextContent('238');
    expect(within(table).getByRole('row', { name: /Answers failed/ })).toHaveTextContent('12');
    expect(within(table).getByRole('row', { name: /Answers asked/ })).toHaveTextContent('250');
  });

  it('registers its facts for the export under the layout item id', async () => {
    serve({ runs: [FINISHED] });
    const { user } = render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    const [block] = await readExport(user);
    expect(block?.id).toBe(ITEM_ID);
    expect(block?.header).toEqual(['Item', 'Value']);
    expect(block?.rows).toContainEqual(['Answers collected', 238]);
    expect(block?.rows).toContainEqual(['Answers failed', 12]);
    expect(block?.rows).toContainEqual(['Answers asked', 250]);
  });

  it('says nothing about runs to a screen reader while loading, after a failure, or without access to runs', async () => {
    const summary = (container: HTMLElement): string | undefined =>
      container.querySelector('section > p.sr-only')?.textContent;
    server.use(http.get(RUNS, async () => delay('infinite')));
    const loading = render();
    await card();
    expect(summary(loading.container)).toBe('Collection status');
    loading.unmount();
    server.use(http.get(RUNS, () => failing('req-runs')));
    const failed = render();
    await screen.findByText('Could not load collection status');
    expect(summary(failed.container)).toBe('Collection status');
    failed.unmount();
    const noAccess = render({ role: 'billing' });
    await screen.findByText('Run history is not available for your role');
    expect(summary(noAccess.container)).toBe('Collection status');
  });

  it('says to a screen reader that no run has finished only when the runs are read and there is none', async () => {
    serve({ runs: [] });
    const { container } = render();
    await screen.findByRole('heading', { name: 'No AI run has finished yet' });
    expect(container.querySelector('section > p.sr-only')?.textContent).toBe(
      'No finished AI run to report. Next run: Nov 16, 20:30.',
    );
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    seam.drill = (kind) => `/digibranders/fynix/${kind}` as Route;
    serve({ runs: [FINISHED] });
    const { container } = render({ mode: 'customize' });
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    const controls = [...container.querySelectorAll('button, a[href]')].filter(
      (element) => element.textContent !== 'Read export',
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('has no dash in what it shows, and passes axe', async () => {
    serve({ runs: [FINISHED] });
    const { container } = render();
    await screen.findByText('238 of 250 answers asked collected, 12 failed');
    expect(container.textContent).not.toMatch(DASHES);
    expect(await axe(container)).toHaveNoViolations();
  });
});
