import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetMeter } from './budget-meter';
import { BudgetStatusBadge } from './budget-status-badge';
import type { CostsProject } from './cost-breakdown';
import { CostsScreen } from './costs-screen';
import type { BudgetStatus, Role } from '@/lib/api/types';
import { formatCurrency } from '@/lib/format';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { MOCK_RUNS } from '@/mocks/operations-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the chart frame is tested with a stand-in for the ECharts canvas
// It keeps the options it was given: a canvas that is handed a new one is redrawn, and loses its tooltip
const drawn = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: unknown }) => {
    drawn.options.push(option);
    return <div data-testid="echart-canvas" />;
  },
}));

const W = '/api/v1/workspaces/{workspace_id}';
const COSTS = `${W}/costs`;
const BUDGETS = `${W}/budgets/status`;

/** The fixture runs' costs sit in September 2026, the 20th and the 24th. */
const NOW = new Date('2026-09-29T12:00:00Z');
const septemberMicros = MOCK_RUNS.filter(
  (run) => run.created_at.startsWith('2026-09') && run.ending === 'completed',
).reduce((sum, run) => sum + run.calls * 12_000 + run.tasks_total * 120, 0);
const septemberUsd = septemberMicros / 1_000_000;

const projects = MOCK_PROJECTS.map((project) => ({ id: project.project_id, slug: project.slug, name: project.name }));

beforeEach(() => {
  vi.setSystemTime(NOW);
  // The popovers measure their animations
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  server.events.removeAllListeners();
});

/** The Costs page for a signed-in member of `role`, who may open `shown` projects. */
function costsAs(role: Role, shown: readonly CostsProject[] = projects): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <CostsScreen workspaceId={MOCK_WORKSPACE.workspace_id} workspaceSlug={MOCK_WORKSPACE.slug} projects={shown} />
    </PermissionProvider>
  );
}

/** The query of every request the page makes to a route, in order. */
function recordRequests(pathEnd: string): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(pathEnd)) asked.push(url.searchParams);
  });
  return asked;
}

/** The query strings the page wrote to the URL, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const writes: string[] = [];
  return {
    onUrlUpdate: (event) => writes.push(event.queryString),
    latest: () => new URLSearchParams(writes.at(-1) ?? ''),
  };
}

/** The month summary's definitions, by their term. */
function stripValue(term: string): string {
  const strip = screen.getByRole('group', { name: 'Month summary' });
  const label = within(strip).getByText(term);
  return label.closest('div')?.querySelector('dd')?.textContent ?? '';
}

describe('Costs', () => {
  it('shows the month to date, the workspace budget with its meter, and no blocked runs when there are none', async () => {
    const costs = recordRequests('/costs');
    const { container } = renderWithProviders(costsAs('admin'));
    const spent = formatCurrency(septemberUsd, { context: 'summary' });
    await waitFor(() => expect(stripValue('Month to date')).toContain(spent));
    expect(stripValue('Month to date')).toContain('Sep 1 to Sep 29, 2026');
    expect(await screen.findByRole('meter', { name: /of \$250\.00$/ })).toHaveAttribute('aria-valuemax', '100');
    expect(stripValue('Budget')).toMatch(/% of \$250\.00/);
    expect(screen.queryByText('Blocked runs')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Costs' })).toBeInTheDocument();
    expect(screen.getByText(/September 2026\. Provider days in UTC/)).toBeInTheDocument();
    // A request for the total names no grouping, and none leaves a filter out as an empty parameter
    const total = costs.find((query) => !query.has('group_by'));
    expect(total?.get('from')).toBe('2026-09-01');
    expect(total?.get('to')).toBe('2026-09-29');
    expect(costs.every((query) => [...query.keys()].every((name) => !name.startsWith('filter[')))).toBe(true);
    await screen.findByRole('row', { name: /dataforseo/ });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('counts the runs the budgets blocked', async () => {
    server.use(
      http.get(mswPath(BUDGETS), () =>
        HttpResponse.json({
          data: [
            {
              budget: {
                budget_id: '0192d1a8-0000-7000-8000-000000000001',
                project_id: null,
                workload: 'all',
                period: 'month',
                limit_usd: '100.000000',
                soft_limit_pct: 80,
                action_on_hard: 'pause',
                created_at: '2026-09-01T00:00:00Z',
              },
              spent_usd: '112.000000',
              committed_estimate_usd: '0.000000',
              pct_used: 112,
              state: 'hard_exceeded',
              blocked_runs: 2,
            },
          ],
        }),
      ),
    );
    renderWithProviders(costsAs('admin'));
    await waitFor(() => expect(stripValue('Blocked runs')).toBe('2'));
    expect(stripValue('Budget')).toBe('112.0% of $100.00');
    // The meter stops at its track, the words carry the real share
    expect(screen.getByRole('meter', { name: '112.0% of $100.00' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('names the month of the chart in its summary, and groups blocked runs by thousands', async () => {
    server.use(
      http.get(mswPath(BUDGETS), () =>
        HttpResponse.json({
          data: [
            {
              budget: {
                budget_id: '0192d1a8-0000-7000-8000-000000000001',
                project_id: null,
                workload: 'all',
                period: 'month',
                limit_usd: '100.000000',
                soft_limit_pct: 80,
                action_on_hard: 'pause',
                created_at: '2026-08-01T00:00:00Z',
              },
              spent_usd: '112.000000',
              committed_estimate_usd: '0.000000',
              pct_used: 112,
              state: 'hard_exceeded',
              blocked_runs: 1234,
            },
          ],
        }),
      ),
    );
    renderWithProviders(costsAs('admin'), { searchParams: '?month=2026-08' });
    expect(await screen.findByText(/^Spend per day in August 2026, stacked by workload\./)).toBeInTheDocument();
    expect(screen.queryByText(/this month/)).toBeNull();
    await waitFor(() => expect(stripValue('Blocked runs')).toBe('1,234'));
  });

  it('says the budget did not load in the summary, with Try again, and shows it once it does', async () => {
    let fail = true;
    server.use(
      http.get(mswPath(BUDGETS), () =>
        fail
          ? HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(costsAs('admin'));
    const strip = await screen.findByRole('group', { name: 'Month summary' });
    // Not "No budget": the month may well have one
    expect(await within(strip).findByText('Not loaded')).toBeInTheDocument();
    expect(within(strip).queryByText('No budget')).toBeNull();
    // The runs a budget blocked are as unknown as the budget
    expect(within(strip).getByText('Blocked runs')).toBeInTheDocument();
    fail = false;
    await user.click(within(strip).getByRole('button', { name: 'Try again' }));
    expect(await within(strip).findByRole('meter')).toBeInTheDocument();
    expect(within(strip).queryByText('Not loaded')).toBeNull();
    expect(within(strip).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says the providers did not load beside the filters, with Try again, and keeps a provider of the link meanwhile', async () => {
    let fail = true;
    const costs = recordRequests('/costs');
    server.use(
      http.get(mswPath(COSTS), ({ request }) => {
        const query = new URL(request.url).searchParams;
        const ofProviders = query.get('group_by') === 'provider' && !query.has('filter[provider_code]');
        return fail && ofProviders
          ? HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 })
          : undefined;
      }),
    );
    const url = urlWrites();
    const { user } = renderWithProviders(costsAs('admin'), {
      searchParams: '?provider=dataforseo',
      onUrlUpdate: url.onUrlUpdate,
    });
    const failed = (await screen.findByText('The list of providers could not be loaded.')).closest('div');
    if (failed === null) throw new Error('no failure note');
    // The link's provider is not dropped as unknown while its options cannot be known
    expect(costs.some((query) => query.get('filter[provider_code]') === 'dataforseo')).toBe(true);
    expect(url.latest().has('provider')).toBe(false);
    fail = false;
    await user.click(within(failed).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('The list of providers could not be loaded.')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Provider: dataforseo. Edit filter' })).toBeInTheDocument();
  });

  it('says so when a provider of the link has no costs in the month that is chosen', async () => {
    const url = urlWrites();
    const { user } = renderWithProviders(costsAs('admin'), {
      searchParams: '?provider=dataforseo',
      onUrlUpdate: url.onUrlUpdate,
    });
    expect(await screen.findByRole('button', { name: 'Provider: dataforseo. Edit filter' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'December 2025' }));
    // That month has no costs, so no provider: the filter is left out of the URL and the person is told
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(
      screen.getByText('Provider: the link holds a value that this page has nothing for in December 2025.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(url.latest().has('provider')).toBe(false));
  });

  it('draws spend by day as a table of every day of the month and a column per workload', async () => {
    const { user } = renderWithProviders(costsAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Spend by day, by workload' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Day', 'Keyword metrics']);
    // The header row, then Sep 1 to Sep 29: the days after today are not asked for
    expect(within(table).getAllByRole('row')).toHaveLength(30);
    const twentieth = within(table).getByRole('row', { name: /^Sep 20/ });
    expect(within(twentieth).getAllByRole('cell')[0]).not.toHaveTextContent('n/a');
    expect(screen.getByText(/^Cost sources: provider reported/)).toBeInTheDocument();
  });

  it('hands the chart the same option while its data is the same, so a hovered tooltip stays', async () => {
    drawn.options.length = 0;
    const { rerender } = renderWithProviders(costsAs('admin'));
    await screen.findByRole('row', { name: /dataforseo/ });
    await screen.findByTestId('echart-canvas');
    // Let every request of the page settle
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settled = drawn.options.at(-1);
    expect(settled).toBeDefined();
    // A render for any other reason (a query settling, a tab changing) draws the same chart
    rerender(costsAs('admin'));
    rerender(costsAs('admin'));
    expect(drawn.options.at(-1)).toBe(settled);
  });

  it('lists the workloads with their cost and share, the shares adding up to the whole', async () => {
    server.use(
      http.get(mswPath(COSTS), ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('group_by') !== 'workload') return undefined;
        return HttpResponse.json({
          data: [
            { keys: { workload: 'seo_rank' }, cost_usd: '3.000000', request_count: 30, subjects: 30 },
            { keys: { workload: 'ai_prompt' }, cost_usd: '1.000000', request_count: 10, subjects: 10 },
          ],
          meta: {
            total_cost_usd: '4.000000',
            cost_sources: {
              provider_reported: '4.000000',
              computed_from_tokens: '0.000000',
              price_book_estimate: '0.000000',
            },
          },
        });
      }),
    );
    renderWithProviders(costsAs('admin'));
    const table = await screen.findByRole('table', { name: 'By workload' });
    await waitFor(() => expect(within(table).getByRole('row', { name: /SEO rank/ })).toBeInTheDocument());
    expect(within(within(table).getByRole('row', { name: /SEO rank/ })).getAllByRole('cell')).toHaveLength(2);
    expect(within(table).getByRole('row', { name: /SEO rank/ })).toHaveTextContent('$3.0075.0%');
    expect(within(table).getByRole('row', { name: /AI prompts/ })).toHaveTextContent('$1.0025.0%');
    expect(within(table).getByRole('row', { name: /^Total/ })).toHaveTextContent('$4.00');
  });

  it('breaks the month down by provider, by project, by price and by budget', async () => {
    const { user } = renderWithProviders(costsAs('admin'));
    // By provider is the first tab
    const providers = await screen.findByRole('table', { name: 'By provider' });
    const provider = await within(providers).findByRole('row', { name: /dataforseo/ });
    expect(provider).toHaveTextContent(formatCurrency(septemberUsd));
    expect(provider).toHaveTextContent('100.0%');

    await user.click(screen.getByRole('tab', { name: 'By project' }));
    const byProject = await screen.findByRole('table', { name: 'By project' });
    const fynix = await within(byProject).findByRole('row', { name: /Fynix/ });
    expect(fynix).toHaveTextContent(formatCurrency(septemberUsd));
    // The project has budgets, so its row shows how much of one is used, and its state
    expect(within(fynix).getByRole('meter')).toBeInTheDocument();
    expect(within(fynix).getByText('Within budget')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Unit costs' }));
    const prices = await screen.findByRole('table', { name: 'Unit costs' });
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    const task = await within(prices).findAllByRole('row', { name: /keyword_overview.*task/ });
    expect(task[0]).toHaveTextContent('$0.012');
    expect(within(prices).getAllByRole('row', { name: /keyword_overview.*item/ })[0]).toHaveTextContent('$0.00012');

    await user.click(screen.getByRole('tab', { name: 'Budgets' }));
    const budgets = await screen.findByRole('table', { name: 'Budgets' });
    await waitFor(() => expect(within(budgets).getAllByRole('meter')).toHaveLength(3));
    expect(within(budgets).getByRole('row', { name: /Workspace.*All workloads/ })).toHaveTextContent('$250.00');
    expect(within(budgets).getByRole('row', { name: /Fynix.*SEO rank/ })).toHaveTextContent('$40.00');
    expect(within(budgets).getAllByText('Within budget')).toHaveLength(3);
  });

  describe('the budget of a project row', () => {
    const fynixId = projects[0]?.id ?? '';
    const projectBudgetStatus = (workload: BudgetStatus['budget']['workload'], pct: number): BudgetStatus => ({
      budget: {
        budget_id: `0192d1a8-0000-7000-8000-${String(pct).padStart(12, '0')}`,
        project_id: fynixId,
        workload,
        period: 'month',
        limit_usd: '100.000000',
        soft_limit_pct: 80,
        action_on_hard: 'pause',
        created_at: '2026-09-01T00:00:00Z',
      },
      spent_usd: String(pct),
      committed_estimate_usd: '0.000000',
      pct_used: pct,
      state: 'ok',
      blocked_runs: 0,
    });
    /** Fynix has a budget for SEO rank (10%) and one for AI prompts (70%), none for all workloads. */
    function serveFynix(): void {
      server.use(
        http.get(mswPath(BUDGETS), () =>
          HttpResponse.json({ data: [projectBudgetStatus('seo_rank', 10), projectBudgetStatus('ai_prompt', 70)] }),
        ),
        http.get(mswPath(COSTS), ({ request }) => {
          if (new URL(request.url).searchParams.get('group_by') !== 'project') return undefined;
          return HttpResponse.json({
            data: [{ keys: { project: fynixId }, cost_usd: '2.000000', request_count: 2, subjects: 2 }],
            meta: {
              total_cost_usd: '2.000000',
              cost_sources: {
                provider_reported: '2.000000',
                computed_from_tokens: '0.000000',
                price_book_estimate: '0.000000',
              },
            },
          });
        }),
      );
    }

    it('says which workload the budget is for when the project has none for all workloads', async () => {
      serveFynix();
      renderWithProviders(costsAs('admin'), { searchParams: '?tab=project' });
      const row = await within(await screen.findByRole('table', { name: 'By project' })).findByRole('row', {
        name: /Fynix/,
      });
      // The most used of its budgets, named: the meter does not pass for the project's whole budget
      await waitFor(() => expect(row).toHaveTextContent('70.0%'));
      expect(row).toHaveTextContent('AI prompts budget');
      expect(within(row).getByRole('meter')).toBeInTheDocument();
    });

    it('shows the budget of the filtered workload, and none when no budget covers the filter', async () => {
      serveFynix();
      const first = renderWithProviders(costsAs('admin'), { searchParams: '?tab=project&workload=seo_rank' });
      const covered = await within(await screen.findByRole('table', { name: 'By project' })).findByRole('row', {
        name: /Fynix/,
      });
      await waitFor(() => expect(covered).toHaveTextContent('10.0%'));
      expect(covered).toHaveTextContent('SEO rank budget');
      first.unmount();

      renderWithProviders(costsAs('admin'), { searchParams: '?tab=project&workload=discovery' });
      const table = await screen.findByRole('table', { name: 'By project' });
      const row = await within(table).findByRole('row', { name: /Fynix/ });
      await waitFor(() => expect(screen.getByRole('group', { name: 'Month summary' })).toBeInTheDocument());
      // Neither budget is for discovery, so the row says nothing of a budget
      expect(within(row).queryByRole('meter')).toBeNull();
      expect(within(table).queryByRole('columnheader', { name: 'Used' })).toBeNull();
    });
  });

  it('names a project that is no longer there, and costs that belong to none', async () => {
    server.use(
      http.get(mswPath(COSTS), ({ request }) => {
        if (new URL(request.url).searchParams.get('group_by') !== 'project') return undefined;
        return HttpResponse.json({
          data: [
            {
              keys: { project: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff' },
              cost_usd: '2.000000',
              request_count: 2,
              subjects: 2,
            },
            { keys: { project: '' }, cost_usd: '1.000000', request_count: 1, subjects: 1 },
          ],
          meta: {
            total_cost_usd: '3.000000',
            cost_sources: {
              provider_reported: '3.000000',
              computed_from_tokens: '0.000000',
              price_book_estimate: '0.000000',
            },
          },
        });
      }),
    );
    const { user } = renderWithProviders(costsAs('admin'));
    await user.click(await screen.findByRole('tab', { name: 'By project' }));
    const table = await screen.findByRole('table', { name: 'By project' });
    expect(await within(table).findByRole('row', { name: /Deleted project/ })).toHaveTextContent('66.7%');
    expect(within(table).getByRole('row', { name: /No project/ })).toHaveTextContent('33.3%');
    // Neither has a budget, so the table has no budget columns
    expect(within(table).queryByRole('columnheader', { name: 'Status' })).toBeNull();
  });

  it('names an archived project as one, in the By project table and in the Project filter, not as a deleted project', async () => {
    const [fynix, ...others] = projects;
    if (fynix === undefined) throw new Error('The fixtures have no project');
    const { user } = renderWithProviders(costsAs('admin', [{ ...fynix, archived: true }, ...others]));
    await user.click(await screen.findByRole('tab', { name: 'By project' }));
    const table = await screen.findByRole('table', { name: 'By project' });
    const row = await within(table).findByRole('row', { name: /Fynix/ });
    expect(row).toHaveTextContent('Fynix (archived)');
    expect(within(table).queryByRole('row', { name: /Deleted project/ })).toBeNull();
    // A project that is not archived is named as it is
    expect(within(table).queryByText('Cleanstart (archived)')).toBeNull();
  });

  it('offers an archived project in the Project filter by the same name', async () => {
    const [fynix, ...others] = projects;
    if (fynix === undefined) throw new Error('The fixtures have no project');
    renderWithProviders(costsAs('admin', [{ ...fynix, archived: true }, ...others]), {
      searchParams: `?project=${fynix.id}`,
    });
    expect(await screen.findByRole('button', { name: 'Project: Fynix (archived). Edit filter' })).toBeInTheDocument();
  });

  it('filters every cost request by workload and writes it to the URL', async () => {
    const costs = recordRequests('/costs');
    const url = urlWrites();
    const { user } = renderWithProviders(costsAs('admin'), { onUrlUpdate: url.onUrlUpdate });
    await user.click(await screen.findByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Workload' }));
    await user.click(await screen.findByRole('checkbox', { name: 'SEO rank' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(url.latest().get('workload')).toBe('seo_rank'));
    await waitFor(() => {
      const filtered = costs.filter((query) => query.get('filter[workload_in]') === 'seo_rank');
      // The total, by day and workload, and by workload, and the provider table
      expect(filtered.length).toBeGreaterThanOrEqual(4);
    });
    // The provider list the filter offers is not narrowed by the filters
    const unfiltered = costs.filter(
      (query) => query.get('group_by') === 'provider' && !query.has('filter[workload_in]'),
    );
    expect(unfiltered.length).toBeGreaterThanOrEqual(1);
    // The chart and both tables name the filters as the reason there is nothing
    await waitFor(() => expect(screen.getAllByText('No costs match these filters in September 2026.')).toHaveLength(3));
  });

  it('reads filters from the URL, and sends a provider and a project as their own parameters', async () => {
    const costs = recordRequests('/costs');
    const fynix = projects[0];
    renderWithProviders(costsAs('admin'), {
      searchParams: `?project=${fynix?.id ?? ''}&provider=dataforseo&workload=seo_rank,ai_prompt`,
    });
    await waitFor(() => {
      const asked = costs.find((query) => !query.has('group_by') && query.has('filter[provider_code]'));
      expect(asked?.get('filter[project_id]')).toBe(fynix?.id);
      expect(asked?.get('filter[provider_code]')).toBe('dataforseo');
      expect(asked?.get('filter[workload_in]')).toBe('seo_rank,ai_prompt');
    });
    expect(screen.getByRole('button', { name: 'Project: Fynix. Edit filter' })).toBeInTheDocument();
  });

  it('asks for another month when it is chosen, for its days and for its budgets', async () => {
    const costs = recordRequests('/costs');
    const budgets = recordRequests('/budgets/status');
    const url = urlWrites();
    const { user } = renderWithProviders(costsAs('admin'), { onUrlUpdate: url.onUrlUpdate });
    await user.click(await screen.findByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'August 2026' }));
    await waitFor(() => expect(url.latest().get('month')).toBe('2026-08'));
    await waitFor(() => expect(costs.some((query) => query.get('from') === '2026-08-01')).toBe(true));
    expect(
      costs.filter((query) => query.get('from') === '2026-08-01').every((query) => query.get('to') === '2026-08-31'),
    ).toBe(true);
    expect(budgets.some((query) => query.get('month') === '2026-08')).toBe(true);
    expect(await screen.findByText(/August 2026\. Provider days in UTC/)).toBeInTheDocument();
    // This month is the default, so choosing it again leaves `month` out of the URL
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'September 2026' }));
    await waitFor(() => expect(url.latest().has('month')).toBe(false));
  });

  it('asks for the new day when the UTC day turns under a tab left open, and again on focus after a sleep', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-09-30T23:59:55Z') });
    const costs = recordRequests('/costs');
    const budgets = recordRequests('/budgets/status');
    renderWithProviders(costsAs('admin'));
    await waitFor(() => expect(costs.some((query) => query.get('to') === '2026-09-30')).toBe(true));
    expect(costs.every((query) => query.get('from') === '2026-09-01')).toBe(true);

    // Midnight passes with the page open: the month it offers and the days it asks for move on
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(costs.some((query) => query.get('from') === '2026-10-01')).toBe(true));
    expect(
      costs.filter((query) => query.get('from') === '2026-10-01').every((query) => query.get('to') === '2026-10-01'),
    ).toBe(true);
    await waitFor(() => expect(budgets.some((query) => query.get('month') === '2026-10')).toBe(true));
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('October 2026');

    // A machine that slept through the timer asks as soon as the window is focused
    const before = costs.length;
    vi.setSystemTime(new Date('2026-10-04T08:00:00Z'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(costs.slice(before).some((query) => query.get('to') === '2026-10-04')).toBe(true));
  });

  it('keeps the current month for a month the list does not offer', async () => {
    const costs = recordRequests('/costs');
    renderWithProviders(costsAs('admin'), { searchParams: '?month=1999-01' });
    await waitFor(() => expect(costs.length).toBeGreaterThan(0));
    expect(costs.every((query) => query.get('from') === '2026-09-01')).toBe(true);
  });

  it('says a month has no costs in the chart and the tables', async () => {
    renderWithProviders(costsAs('admin'), { searchParams: '?month=2025-11' });
    await waitFor(() => expect(screen.getAllByText('No costs recorded in November 2025.')).toHaveLength(3));
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
  });

  it('keeps the page when a table fails, and tries again', async () => {
    let fail = true;
    server.use(
      http.get(mswPath(COSTS), ({ request }) => {
        if (new URL(request.url).searchParams.get('group_by') !== 'provider' || !fail) return undefined;
        return HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 });
      }),
    );
    const { user } = renderWithProviders(costsAs('admin'));
    expect(await screen.findByText('The costs could not be loaded')).toBeInTheDocument();
    // The rest of the page stays
    expect(screen.getByRole('table', { name: 'By workload' })).toBeInTheDocument();
    fail = false;
    // The provider list of the filter fails with the table, and says so beside the filters: the table's own Retry
    const tableRetry = screen
      .getAllByRole('button', { name: 'Try again' })
      .find((button) => button.closest('[role="status"]') === null);
    if (tableRetry === undefined) throw new Error('no Try again in the table');
    await user.click(tableRetry);
    expect(
      await within(await screen.findByRole('table', { name: 'By provider' })).findByRole('row', { name: /dataforseo/ }),
    ).toBeInTheDocument();
  });

  it('gives a member without costs:read the no-access state, and asks for nothing', async () => {
    const costs = recordRequests('/costs');
    const budgets = recordRequests('/budgets/status');
    const prices = recordRequests('/price-book');
    renderWithProviders(costsAs('viewer'));
    expect(await screen.findByRole('heading', { name: 'You do not have access to Costs' })).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view costs. Ask an admin of this workspace.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Overview' })).toHaveAttribute('href', '/digibranders');
    expect(screen.getByRole('heading', { level: 1, name: 'Costs' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Month summary' })).toBeNull();
    expect([...costs, ...budgets, ...prices]).toEqual([]);
  });
});

const status = (state: BudgetStatus['state']): BudgetStatus['state'] => state;

describe('BudgetMeter', () => {
  it('is a meter named for its share, with a tick at the soft limit and a fill that stays in its track', () => {
    const { container } = renderWithProviders(
      <BudgetMeter pct={64} softLimitPct={80} state="ok" size="summary" label="64.0% of $2,000.00" />,
    );
    const meter = screen.getByRole('meter', { name: '64.0% of $2,000.00' });
    expect(meter).toHaveAttribute('aria-valuenow', '64');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveClass('w-40');
    expect(container.querySelector<HTMLElement>('[style*="left: 80%"]')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('[style*="width: 64%"]')).not.toBeNull();
  });

  it('reads the real share to assistive technology when it passes the end of the track', () => {
    renderWithProviders(
      <BudgetMeter pct={112} softLimitPct={80} state="hard_exceeded" size="summary" label="112.0% of $100.00" />,
    );
    const meter = screen.getByRole('meter', { name: '112.0% of $100.00' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '112.0%');
  });

  it('turns warning from the soft limit up, and wholly warning once the limit is reached', () => {
    const soft = renderWithProviders(
      <BudgetMeter pct={90} softLimitPct={80} state={status('soft_exceeded')} size="cell" label="soft" />,
    );
    expect(screen.getByRole('meter', { name: 'soft' })).toHaveClass('w-16');
    expect(soft.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('80%');
    const warning = soft.container.querySelector<HTMLElement>('.bg-warning-solid');
    expect(warning?.style.left).toBe('80%');
    expect(warning?.style.width).toBe('10%');
    soft.unmount();
    const hard = renderWithProviders(
      <BudgetMeter pct={140} softLimitPct={80} state={status('hard_exceeded')} size="cell" label="hard" />,
    );
    expect(hard.container.querySelector<HTMLElement>('.bg-foreground-muted')?.style.width).toBe('0%');
    const whole = hard.container.querySelector<HTMLElement>('.bg-warning-solid');
    expect(whole?.style.left).toBe('0%');
    expect(whole?.style.width).toBe('100%');
  });
});

describe('BudgetStatusBadge', () => {
  it('names each state, and marks the two that need attention', () => {
    const { unmount } = renderWithProviders(<BudgetStatusBadge state="ok" />);
    expect(screen.getByText('Within budget')).toBeInTheDocument();
    unmount();
    const soft = renderWithProviders(<BudgetStatusBadge state="soft_exceeded" />);
    expect(screen.getByText('Soft limit reached')).toHaveClass('text-warning-text');
    soft.unmount();
    renderWithProviders(<BudgetStatusBadge state="hard_exceeded" />);
    expect(screen.getByText('Budget blocked')).toHaveClass('text-warning-text');
  });
});
