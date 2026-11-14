import { act, screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DASHES,
  failing,
  ITEM_ID,
  readExport,
  recordRequests,
  renderActivityCard,
  stopRecording,
  WORKSPACE,
} from '@/test/ai-activity-kit';
import AiSpendCard from './ai-spend-card';
import { budgetStatus, type BudgetSpec } from './model/activity-fixtures';
import type { BudgetStatus } from '@/lib/api/types';
import { MOCK_PROJECTS } from '@/mocks/fixtures';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const STATUS = `${WORKSPACE}/budgets/status`;
const TYPE = 'ops.ai_spend';
const FYNIX = MOCK_PROJECTS.find((project) => project.slug === 'fynix')?.project_id ?? '';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  stopRecording();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function serve(...statuses: readonly BudgetStatus[]): void {
  server.use(http.get(STATUS, () => HttpResponse.json({ data: statuses })));
}
const mine = (spec: BudgetSpec = {}): BudgetStatus => budgetStatus({ projectId: FYNIX, ...spec });

const render = (options: Parameters<typeof renderActivityCard>[2] = {}): ReturnType<typeof renderActivityCard> =>
  renderActivityCard(TYPE, AiSpendCard, options);
const used = (text = '$12.40 of $50.00 this month (24.8%)'): Promise<HTMLElement> => screen.findByText(text);

describe('the AI spend card', () => {
  it('shows a skeleton at the frame height while the budget loads, under its title', async () => {
    server.use(http.get(STATUS, async () => delay('infinite')));
    render();
    await screen.findByRole('heading', { name: 'AI spend' });
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy?.querySelector('[data-slot="skeleton"]')?.parentElement).toHaveStyle({ height: '140px' });
  });

  it('shows what was spent of the limit, the share the API counted, and the meter that says the same', async () => {
    serve(mine());
    render();
    await used();
    const meter = screen.getByRole('meter', { name: 'AI spend this month: $12.40 of $50.00 this month (24.8%)' });
    expect(meter).toHaveAttribute('aria-valuenow', '24.8');
  });

  it('shows the share of the API even when it differs from spent over limit', async () => {
    serve(mine({ pct: 31.5 }));
    render();
    await used('$12.40 of $50.00 this month (31.5%)');
    expect(screen.queryByText(/24\.8%/)).not.toBeInTheDocument();
  });

  it('names the budget it shows: project, workspace, or all workloads', async () => {
    serve(mine({ workload: 'ai_prompt' }));
    const first = render();
    expect(await screen.findByText('Project budget, AI prompts')).toBeInTheDocument();
    first.unmount();
    serve(budgetStatus({ projectId: null, workload: 'ai_prompt' }));
    const second = render();
    expect(await screen.findByText('Workspace budget, AI prompts')).toBeInTheDocument();
    second.unmount();
    serve(budgetStatus({ projectId: null, workload: 'all' }));
    render();
    expect(await screen.findByText('Workspace budget, all workloads')).toBeInTheDocument();
  });

  it('shows one budget and never adds several up', async () => {
    serve(
      mine({ spent: '10.000000', limit: '40.000000', pct: 25 }),
      budgetStatus({ n: 2, spent: '20.000000', limit: '100.000000', pct: 20 }),
    );
    const { container } = render();
    await used('$10.00 of $40.00 this month (25.0%)');
    expect(container.textContent).not.toContain('$30.00');
    expect(container.textContent).not.toContain('$140.00');
  });

  it('names the estimate committed by runs under way apart from the spend, and only when there is one', async () => {
    serve(mine({ committed: '1.200000' }));
    const first = render();
    expect(await screen.findByText('$1.20 committed by runs under way')).toBeInTheDocument();
    first.unmount();
    serve(mine({ committed: '0.000000' }));
    render();
    await used();
    expect(screen.queryByText(/committed by runs under way/)).not.toBeInTheDocument();
  });

  it('says when the soft limit is reached and when the hard limit is, with what the hard limit does', async () => {
    serve(mine({ state: 'soft_exceeded', pct: 85 }));
    const first = render();
    expect(await screen.findByText('Soft limit reached')).toBeInTheDocument();
    first.unmount();
    serve(mine({ state: 'hard_exceeded', pct: 112, action: 'pause', blocked: 2 }));
    const second = render();
    expect(await screen.findByText('Limit reached: new runs are paused')).toBeInTheDocument();
    expect(screen.getByText('2 runs are blocked by this budget')).toBeInTheDocument();
    second.unmount();
    serve(mine({ state: 'hard_exceeded', pct: 112, action: 'alert_only' }));
    render();
    expect(await screen.findByText('Limit reached: runs continue and an alert is sent')).toBeInTheDocument();
  });

  it('draws the whole fill of the meter as a warning at the hard limit, and muted below the soft one', async () => {
    serve(mine({ state: 'hard_exceeded', pct: 112 }));
    const first = render();
    const hard = await screen.findByRole('meter');
    expect(hard.querySelector<HTMLElement>('.bg-warning-solid')?.style.width).toBe('100%');
    expect(hard.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('0%');
    first.unmount();
    serve(mine({ pct: 24.8 }));
    render();
    await used();
    const ok = screen.getByRole('meter');
    expect(ok.querySelector<HTMLElement>('.bg-warning-solid')?.style.width).toBe('0%');
    expect(ok.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('24.8%');
  });

  it('shows n/a, never $0.00, for an amount spent that is not a number', async () => {
    serve(mine({ spent: 'unknown' }));
    const { container } = render();
    await screen.findByText('n/a of $50.00 this month (24.8%)');
    expect(container.textContent).not.toContain('$0.00');
  });

  it('shows n/a for a limit that is not a number, in the line and in the Table view', async () => {
    serve(mine({ limit: 'unknown' }));
    const { container, user } = render();
    await screen.findByText('$12.40 of n/a this month (24.8%)');
    expect(container.textContent).not.toContain('$0.00');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'AI spend this month' });
    expect(within(table).getByRole('row', { name: /^Limit/ })).toHaveTextContent('n/a');
  });

  it('shows n/a in the Table view for a committed estimate that is not a number, and no line for it', async () => {
    serve(mine({ committed: 'unknown' }));
    const { user } = render();
    await used();
    expect(screen.queryByText(/committed by runs under way/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'AI spend this month' });
    expect(within(table).getByRole('row', { name: /Committed by runs under way/ })).toHaveTextContent('n/a');
  });

  it('says nothing about spend to a screen reader while loading, after a failure, or without costs:read', async () => {
    const summary = (container: HTMLElement): string | undefined =>
      container.querySelector('section > p.sr-only')?.textContent;
    server.use(http.get(STATUS, async () => delay('infinite')));
    const loading = render();
    await screen.findByRole('heading', { name: 'AI spend' });
    expect(summary(loading.container)).toBe('AI spend');
    loading.unmount();
    server.use(http.get(STATUS, () => failing('req-budget')));
    const failed = render();
    await screen.findByText('Could not load AI spend');
    expect(summary(failed.container)).toBe('AI spend');
    failed.unmount();
    const viewer = render({ role: 'viewer' });
    await screen.findByText('AI spend is not available for your role');
    expect(summary(viewer.container)).toBe('AI spend');
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    serve(mine());
    const { container } = render({ mode: 'customize' });
    await used();
    const controls = [...container.querySelectorAll('button, a[href]')].filter(
      (element) => element.textContent !== 'Read export',
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('shows every percent beside the amounts it is a share of', async () => {
    serve(mine({ state: 'soft_exceeded', pct: 85, committed: '1.200000' }));
    const { container, user } = render();
    await screen.findByRole('meter');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table');
    const percents = [...container.querySelectorAll('*')].filter(
      (element) => element.children.length === 0 && /\d%/.test(element.textContent),
    );
    expect(percents.length).toBeGreaterThan(0);
    for (const element of percents) expect(element.textContent).toMatch(/\$\d[\d,]*\.\d{2}/);
  });

  it('says no AI budget is set, and points a member who can manage budgets to Costs, as plain text', async () => {
    serve(mine({ workload: 'seo_rank' }));
    render({ role: 'admin' });
    expect(await screen.findByText('No AI budget is set')).toBeInTheDocument();
    expect(
      screen.getByText('A monthly budget shows how much of it AI collection has used. Add one under Costs.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sends a member who cannot manage budgets to ask for one', async () => {
    serve();
    render({ role: 'analyst' });
    expect(
      await screen.findByText(
        'A monthly budget shows how much of it AI collection has used. Ask a member who can manage budgets to add one.',
      ),
    ).toBeInTheDocument();
  });

  it('reads no budget and shows no spend for a viewer, who cannot read costs', async () => {
    const seen = recordRequests();
    render({ role: 'viewer' });
    expect(await screen.findByText('AI spend is not available for your role')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(seen.filter((url) => url.pathname.endsWith('/budgets/status'))).toEqual([]);
  });

  it('shows the spend to a member who can read costs but not runs', async () => {
    serve(mine());
    render({ role: 'billing' });
    await used();
  });

  it('shows the error with its id and reads again on Try again', async () => {
    server.use(http.get(STATUS, () => failing('req-budget')));
    const { user } = render();
    expect(await screen.findByText('Could not load AI spend')).toBeInTheDocument();
    expect(screen.getByText(/req-budget/)).toBeInTheDocument();
    serve(mine());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await used();
  });

  it('keeps the figures and says so when a later read fails', async () => {
    serve(mine());
    const { queryClient } = render();
    await used();
    server.use(http.get(STATUS, () => failing('req-later')));
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(screen.getByText('$12.40 of $50.00 this month (24.8%)')).toBeInTheDocument();
  });

  it('keeps the figures on screen, undimmed, while a read runs again', async () => {
    serve(mine());
    const { queryClient } = render();
    await used();
    server.use(http.get(STATUS, async () => delay('infinite')));
    act(() => {
      void queryClient.refetchQueries();
    });
    expect(await used()).toBeInTheDocument();
    expect(document.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
  });

  it('lists the facts in the Table view', async () => {
    serve(mine({ committed: '1.200000' }));
    const { user } = render();
    await used();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'AI spend this month' });
    expect(within(table).getByRole('row', { name: /Spent this month/ })).toHaveTextContent('$12.40');
    expect(within(table).getByRole('row', { name: /^Limit/ })).toHaveTextContent('$50.00');
    expect(within(table).getByRole('row', { name: /Share of the limit used/ })).toHaveTextContent(
      '24.8% ($12.40 of $50.00)',
    );
    expect(within(table).getByRole('row', { name: /Committed by runs under way/ })).toHaveTextContent('$1.20');
  });

  it('registers its facts for the export under the layout item id', async () => {
    serve(mine());
    const { user } = render();
    await used();
    const [block] = await readExport(user);
    expect(block?.id).toBe(ITEM_ID);
    expect(block?.header).toEqual(['Item', 'Value']);
    expect(block?.rows).toContainEqual(['Spent this month', '$12.40']);
    expect(block?.rows).toContainEqual(['Limit', '$50.00']);
  });

  it('has no dash in what it shows, and passes axe', async () => {
    serve(mine({ committed: '1.200000' }));
    const { container } = render();
    await used();
    expect(container.textContent).not.toMatch(DASHES);
    expect(await axe(container)).toHaveNoViolations();
  });
});
