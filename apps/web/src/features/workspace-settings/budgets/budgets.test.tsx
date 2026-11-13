import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetsScreen } from './budgets-screen';
import type { BudgetGroup } from './budget-model';
import type { BudgetStatus, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { MOCK_BUDGET_IDS } from '@/mocks/operations-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/budgets',
}));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('no fixture project');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const STATUS = `${W}/budgets/status`;
const FORECAST = `${W}/costs/forecast`;
const LIMITS = `${W}/projects/${fynix.project_id}/ai/limits`;
/** The fixture budgets and costs sit in September 2026. */
const NOW = new Date('2026-09-29T12:00:00Z');

const projects = MOCK_PROJECTS.map((project) => ({ id: project.project_id, slug: project.slug, name: project.name }));

beforeEach(() => {
  vi.setSystemTime(NOW);
  // The select and menu popups measure their animations
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  server.events.removeAllListeners();
});

interface PageOptions {
  limitsProjectId?: string | null;
  projectIds?: readonly string[] | null;
}

/** The page for a signed-in member of `role`, who may open every project unless `projectIds` limits them. */
function pageAs(
  role: Role,
  { limitsProjectId = fynix?.project_id ?? null, projectIds = null }: PageOptions = {},
): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role, { projectIds })}>
      <BudgetsScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        projects={projects}
        limitsProjectId={limitsProjectId}
      />
    </PermissionProvider>
  );
}

function statusRow(
  workload: BudgetGroup,
  over: {
    projectId?: string | null;
    limit?: string;
    spent?: string;
    pct?: number;
    state?: BudgetStatus['state'];
    blocked?: number;
    id?: string;
  } = {},
): BudgetStatus {
  return {
    budget: {
      budget_id: over.id ?? '0192d1a8-0000-7000-8000-000000000a01',
      project_id: over.projectId ?? null,
      workload,
      period: 'month',
      limit_usd: over.limit ?? '250.00',
      soft_limit_pct: 80,
      action_on_hard: 'pause',
      created_at: '2026-09-01T00:00:00Z',
    },
    spent_usd: over.spent ?? '0.000000',
    committed_estimate_usd: '0.000000',
    pct_used: over.pct ?? 0,
    state: over.state ?? 'ok',
    blocked_runs: over.blocked ?? 0,
  };
}

function serveStatus(rows: readonly BudgetStatus[]): void {
  server.use(http.get(mswPath(STATUS), () => HttpResponse.json({ data: rows })));
}

function serveLimits(prompts: { used: number; limit: number }, answers: { used: number; limit: number }): void {
  server.use(
    http.get(`*${LIMITS}`, () =>
      HttpResponse.json({
        data: { prompts, ai_observations_month: answers, manual_runs_today: { used: 0, limit: 20 } },
      }),
    ),
  );
}

function serveForecast(rows: readonly { project_id: string; estimated_cost_usd: string }[]): void {
  server.use(
    http.get(`*${FORECAST}`, () =>
      HttpResponse.json({
        data: rows.map((row) => ({
          ...row,
          workload: 'ai_prompt',
          method: 'price_book_x_schedules',
          is_estimate: true,
        })),
      }),
    ),
  );
}

/** The bodies the page sends with `method` to the budgets routes, as they arrive. */
function recordBodies(method: 'POST' | 'PATCH'): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.includes('/budgets')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
}

function recordRequests(pathEnd: string, method = 'GET'): string[] {
  const asked: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(pathEnd)) asked.push(request.url);
  });
  return asked;
}

type User = ReturnType<typeof renderWithProviders>['user'];

/** Where a meter's muted fill ends and its warning fill starts and runs, as the widths it is drawn with. */
function fillOf(meter: HTMLElement): { muted: string; warningFrom: string; warningWidth: string } {
  const [muted, warning] = Array.from(meter.querySelectorAll<HTMLElement>('div > span'));
  return {
    muted: muted?.style.width ?? '',
    warningFrom: warning?.style.left ?? '',
    warningWidth: warning?.style.width ?? '',
  };
}

const table = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Budgets' });
/** The row of a scope and group, once the list has loaded. */
async function rowOf(scope: string, group: string): Promise<HTMLElement> {
  const list = await table();
  return waitFor(() => {
    const found = within(list)
      .getAllByRole('row')
      .find((row) => {
        const cells = within(row).queryAllByRole('cell');
        return within(row).queryByRole('rowheader')?.textContent === scope && cells[0]?.textContent === group;
      });
    if (found === undefined) throw new Error(`No row for ${scope} and ${group}`);
    return found;
  });
}

async function choose(user: User, scope: HTMLElement, field: string, option: string): Promise<void> {
  await user.click(within(scope).getByRole('combobox', { name: field }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function openRowMenu(user: User, scope: string, group: string, item: string): Promise<void> {
  await user.click(await screen.findByRole('button', { name: `Actions for ${scope}, ${group}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('Budgets and usage', () => {
  it('the page lists budgets with spent, limit, percent and the amount', async () => {
    serveStatus([
      statusRow('all', { limit: '250.00', spent: '160.500000', pct: 64.2 }),
      statusRow('ai_prompt', {
        id: '0192d1a8-0000-7000-8000-000000000a02',
        projectId: fynix?.project_id ?? null,
        limit: '40.00',
        spent: '40.500000',
        pct: 101.3,
        state: 'hard_exceeded',
      }),
    ]);
    const { container } = renderWithProviders(pageAs('admin'));
    expect(screen.getByRole('heading', { level: 2, name: 'Budgets and usage' })).toBeInTheDocument();
    expect(screen.getByText('Workspace, September 2026. Months in UTC.')).toBeInTheDocument();
    const workspaceRow = await rowOf('Workspace', 'All workloads');
    expect(within(workspaceRow).getByText('$250.00')).toBeInTheDocument();
    expect(within(workspaceRow).getByText('$160.50')).toBeInTheDocument();
    expect(within(workspaceRow).getByText('64.2%')).toBeInTheDocument();
    expect(within(workspaceRow).getByRole('meter', { name: '64.2% of $250.00' })).toBeInTheDocument();
    expect(within(workspaceRow).getByText('Within budget')).toBeInTheDocument();
    const projectRow = await rowOf('Fynix', 'AI answers');
    expect(within(projectRow).getByText('$40.00')).toBeInTheDocument();
    expect(within(projectRow).getByText('101.3%')).toBeInTheDocument();
    expect(within(projectRow).getByText('Budget blocked')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the two quota meters read used of limit and are never red', async () => {
    serveLimits({ used: 72, limit: 150 }, { used: 412, limit: 2000 });
    const first = renderWithProviders(pageAs('admin'));
    expect(await screen.findByText('72 of 150')).toBeInTheDocument();
    expect(screen.getByText('412 of 2,000')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Active prompts' })).toHaveAttribute(
      'aria-valuetext',
      '72 of 150 active prompts',
    );
    expect(screen.getByRole('meter', { name: 'AI answers this month' })).toHaveAttribute(
      'aria-valuetext',
      '412 of 2,000 AI answers this month',
    );
    expect(screen.getByRole('link', { name: 'Open Topics & Prompts' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/prompts',
    );
    // Under the soft share (80 percent of the limit) the whole fill is muted
    expect(fillOf(screen.getByRole('meter', { name: 'Active prompts' }))).toEqual({
      muted: '48%',
      warningFrom: '80%',
      warningWidth: '0%',
    });
    first.unmount();
    // Over the limit the meter keeps the real figures and still carries no negative colour
    serveLimits({ used: 168, limit: 150 }, { used: 2100, limit: 2000 });
    const { container } = renderWithProviders(pageAs('admin'));
    const prompts = await screen.findByRole('meter', { name: 'Active prompts' });
    expect(screen.getByText('168 of 150')).toBeInTheDocument();
    expect(screen.getByText('2,100 of 2,000')).toBeInTheDocument();
    expect(prompts).toHaveAttribute('aria-valuetext', '168 of 150 active prompts');
    // Past the soft share the fill turns warning (never a negative colour), and stops at the track's end
    expect(fillOf(prompts)).toEqual({ muted: '80%', warningFrom: '80%', warningWidth: '20%' });
    for (const meter of screen.getAllByRole('meter', { name: /prompts|AI answers this month/ })) {
      expect(meter.innerHTML).not.toMatch(/negative|red/);
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a quota not readable says Not available and why, not 0', async () => {
    const asked = recordRequests('/ai/limits');
    // A billing member may manage budgets but cannot read the prompts and answers
    const billing = renderWithProviders(pageAs('billing'));
    expect(await screen.findAllByText('Not available')).toHaveLength(2);
    expect(
      screen.getByText('Your role cannot read prompts and answers, so these limits are not shown.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'Active prompts' })).toBeNull();
    expect(screen.queryByText(/^0 of /)).toBeNull();
    billing.unmount();
    // No project to read the limits through
    const none = renderWithProviders(pageAs('admin', { limitsProjectId: null }));
    expect(await screen.findAllByText('Not available')).toHaveLength(2);
    expect(screen.getByText('Open this page from a project to read these limits.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Topics & Prompts' })).toBeNull();
    none.unmount();
    expect(asked).toHaveLength(0);
    // A failed read is not a zero either, and offers to try again
    server.use(http.get(`*${LIMITS}`, ({ request }) => problem(request, 'internal_error')));
    renderWithProviders(pageAs('admin'));
    expect(await screen.findAllByText('Not available')).toHaveLength(2);
    expect(screen.getByText('The limits could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/^0 of /)).toBeNull();
  });

  it('no AI budget shows the empty state with Add AI budget', async () => {
    serveStatus([statusRow('seo_rank', { projectId: fynix?.project_id ?? null })]);
    renderWithProviders(pageAs('admin'));
    expect(await screen.findByRole('heading', { name: 'No AI budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add AI budget' })).toBeInTheDocument();
  });

  it('Add AI budget opens the dialog with the AI group chosen', async () => {
    serveStatus([]);
    const { user } = renderWithProviders(pageAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Add AI budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add budget' });
    expect(within(dialog).getByRole('combobox', { name: 'Group' })).toHaveTextContent('AI answers');
    expect(within(dialog).getByRole('combobox', { name: 'Scope' })).toHaveTextContent('Workspace');
    expect(within(dialog).getByRole('textbox', { name: /^Soft limit/ })).toHaveValue('80');
    expect(within(dialog).getByRole('radio', { name: /^Pause/ })).toBeChecked();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('creating a budget shows it and its meter', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(pageAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Add AI budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add budget' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Limit/ }), '300');
    await user.click(within(dialog).getByRole('button', { name: 'Add budget' }));
    // The toast that says so is a dialog too: the question is whether this one is gone
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add budget' })).toBeNull());
    expect(await screen.findByRole('heading', { name: 'AI answers budget' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'AI answers budget' });
    expect(within(card).getByRole('meter', { name: /of \$300\.00$/ })).toBeInTheDocument();
    const row = await rowOf('Workspace', 'AI answers');
    expect(within(row).getByText('$300.00')).toBeInTheDocument();
    // No scope member: the budget covers the whole workspace
    expect(bodies).toEqual([
      { workload: 'ai_prompt', limit_usd: '300.00', soft_limit_pct: 80, action_on_hard: 'pause' },
    ]);
    expect(screen.queryByRole('heading', { name: 'No AI budget' })).toBeNull();
  });

  it('a duplicate shows the field error on Scope and keeps the dialog open', async () => {
    // The fixtures hold a Fynix budget for SEO rank
    const { user } = renderWithProviders(pageAs('admin'));
    await rowOf('Fynix', 'SEO rank');
    await user.click(screen.getByRole('button', { name: 'Add budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add budget' });
    await choose(user, dialog, 'Scope', 'Fynix');
    await choose(user, dialog, 'Group', 'SEO rank');
    await user.type(within(dialog).getByRole('textbox', { name: /^Limit/ }), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Add budget' }));
    const scope = within(dialog).getByRole('combobox', { name: 'Scope' });
    await waitFor(() =>
      expect(scope).toHaveAccessibleDescription('A budget for this scope and group already exists. Edit it instead.'),
    );
    expect(screen.getByRole('dialog', { name: 'Add budget' })).toBeInTheDocument();
    // What was typed is kept
    expect(within(dialog).getByRole('textbox', { name: /^Limit/ })).toHaveValue('10');
  });

  it('refuses a limit with three places before anything is sent', async () => {
    const bodies = recordBodies('POST');
    serveStatus([]);
    const { user } = renderWithProviders(pageAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Add AI budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add budget' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Limit/ }), '10.123');
    await user.click(within(dialog).getByRole('button', { name: 'Add budget' }));
    expect(
      await within(dialog).findByText('Use dollars with at most two decimal places, such as 250.50.'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('editing changes the limit', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(pageAs('admin'));
    await rowOf('Fynix', 'SEO rank');
    await openRowMenu(user, 'Fynix', 'SEO rank', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit budget' });
    // The scope and the group are fixed once the budget exists
    expect(within(dialog).queryByRole('combobox', { name: 'Scope' })).toBeNull();
    expect(within(dialog).getByText('Fynix')).toBeInTheDocument();
    const limit = within(dialog).getByRole('textbox', { name: /^Limit/ });
    await user.clear(limit);
    await user.type(limit, '55.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit budget' })).toBeNull());
    const row = await rowOf('Fynix', 'SEO rank');
    await waitFor(() => expect(within(row).getByText('$55.50')).toBeInTheDocument());
    expect(bodies).toEqual([{ limit_usd: '55.50' }]);
  });

  it('deleting asks first and removes the row', async () => {
    const deletes = recordRequests(`/budgets/${MOCK_BUDGET_IDS.fynixRanks}`, 'DELETE');
    const { user } = renderWithProviders(pageAs('admin'));
    await rowOf('Fynix', 'SEO rank');
    await openRowMenu(user, 'Fynix', 'SEO rank', 'Delete');
    const question = await screen.findByRole('alertdialog', { name: 'Delete this budget?' });
    expect(within(question).getByText(/Spend on SEO rank in Fynix will no longer be capped/)).toBeInTheDocument();
    // Cancel leaves the budget alone
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deletes).toHaveLength(0);
    await rowOf('Fynix', 'SEO rank');
    await openRowMenu(user, 'Fynix', 'SEO rank', 'Delete');
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Delete this budget?' })).getByRole('button', {
        name: 'Delete budget',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(deletes).toHaveLength(1));
    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: 'Budgets' })).queryByText('SEO rank')).toBeNull(),
    );
    // The page's heading takes focus once the row with its menu is gone
    expect(screen.getByRole('heading', { level: 2, name: 'Budgets and usage' })).toHaveFocus();
  });

  it('a member without budgets:manage sees a read only banner and no buttons', async () => {
    for (const role of ['editor', 'analyst'] as const) {
      const { unmount } = renderWithProviders(pageAs(role));
      await rowOf('Fynix', 'SEO rank');
      expect(screen.getByText('Read only:')).toBeInTheDocument();
      expect(screen.getByText('Owners, admins and billing members can change budgets.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
      unmount();
    }
    // A billing member manages budgets without reading prompts
    renderWithProviders(pageAs('billing'));
    await rowOf('Fynix', 'SEO rank');
    expect(screen.queryByText('Read only:')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add budget' })).toBeInTheDocument();
  });

  it('a member without costs:read sees the no-access state', async () => {
    const asked = recordRequests('/budgets/status');
    renderWithProviders(pageAs('viewer'));
    expect(await screen.findByRole('heading', { name: 'You do not have access to budgets' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('forecast shows About $X, an estimate, and is absent without a price', async () => {
    serveStatus([statusRow('ai_prompt', { spent: '12.400000', pct: 4.96 })]);
    serveForecast([
      { project_id: fynix?.project_id ?? '', estimated_cost_usd: '1.500000' },
      { project_id: MOCK_PROJECTS[1]?.project_id ?? '', estimated_cost_usd: '0.750000' },
    ]);
    const first = renderWithProviders(pageAs('admin'));
    expect(await screen.findByText('About $2.25 this month (estimate from the price book)')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'AI answers budget' });
    expect(within(card).getByRole('meter', { name: '5.0% of $250.00' })).toBeInTheDocument();
    expect(within(card).getByText('$12.40 spent of $250.00')).toBeInTheDocument();
    first.unmount();
    // No project has a price: the forecast is unknown, and the card says nothing about it instead of $0.00
    serveForecast([]);
    const asked = recordRequests('/costs/forecast');
    renderWithProviders(pageAs('admin'));
    const empty = await screen.findByRole('region', { name: 'AI answers budget' });
    // The forecast line is a skeleton until its read ends: wait for the answer before saying it is absent
    await waitFor(() => expect(asked).toHaveLength(1));
    await waitFor(() => expect(empty.querySelector('[data-slot="skeleton"]')).toBeNull());
    expect(screen.queryByText(/^About /)).toBeNull();
    expect(screen.queryByText(/\$0\.00 this month/)).toBeNull();
  });

  it('loading skeleton, error with Retry that keeps the rest, stale line', async () => {
    serveLimits({ used: 72, limit: 150 }, { used: 412, limit: 2000 });
    server.use(http.get(mswPath(STATUS), async () => delay('infinite')));
    const loading = renderWithProviders(pageAs('admin'));
    await screen.findByText('72 of 150');
    expect(document.querySelector('tbody[aria-busy="true"]')).not.toBeNull();
    loading.unmount();

    // A failed first read: the error is in the table's place, the meters stay
    server.use(http.get(mswPath(STATUS), ({ request }) => problem(request, 'internal_error')));
    const failed = renderWithProviders(pageAs('admin'));
    expect(await screen.findByText('The budgets could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('72 of 150')).toBeInTheDocument();
    serveStatus([statusRow('all')]);
    await failed.user.click(screen.getByRole('button', { name: 'Try again' }));
    await rowOf('Workspace', 'All workloads');
    expect(screen.queryByText('The budgets could not be loaded')).toBeNull();
    failed.unmount();

    // A refresh that fails keeps the rows and says the figures are the last ones read
    serveStatus([statusRow('all', { limit: '250.00' })]);
    const stale = renderWithProviders(pageAs('admin'));
    await rowOf('Workspace', 'All workloads');
    server.use(http.get(mswPath(STATUS), ({ request }) => problem(request, 'internal_error')));
    await stale.queryClient.invalidateQueries({ queryKey: ['ws', MOCK_WORKSPACE.workspace_id, 'budgets'] });
    expect(
      await screen.findByText('These figures could not be refreshed. They are the last ones read.'),
    ).toBeInTheDocument();
    expect(await rowOf('Workspace', 'All workloads')).toBeInTheDocument();
  });

  it('a refresh keeps the rows on screen with the bar while it runs', async () => {
    serveStatus([statusRow('all')]);
    const { queryClient } = renderWithProviders(pageAs('admin'));
    await rowOf('Workspace', 'All workloads');
    const bar = (): Element | null => document.querySelector('[data-slot="budgets-refetch-bar"]');
    expect(bar()).toBeNull();
    server.use(
      http.get(mswPath(STATUS), async () => {
        await delay(400);
        return HttpResponse.json({ data: [statusRow('all')] });
      }),
    );
    void queryClient.invalidateQueries({ queryKey: ['ws', MOCK_WORKSPACE.workspace_id, 'budgets'] });
    await waitFor(() => expect(bar()).not.toBeNull());
    // The previous rows stay, not a skeleton
    expect(await rowOf('Workspace', 'All workloads')).toBeInTheDocument();
    expect(document.querySelector('tbody[aria-busy="true"]')).toBeNull();
    await waitFor(() => expect(bar()).toBeNull());
  });

  it('the dialog traps focus, Escape closes and returns focus to the trigger', async () => {
    serveStatus([statusRow('all')]);
    const { user } = renderWithProviders(pageAs('admin'));
    const add = await screen.findByRole('button', { name: 'Add budget' });
    await user.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'Add budget' });
    // Focus starts in the first field. jsdom runs no animation frames, so the focus guards that send Tab back in
    // are checked in the browser; here the page behind is out of reach while the dialog is open
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Scope' })).toHaveFocus());
    expect(add.closest('[inert], [aria-hidden="true"]')).not.toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add budget' })).toBeNull());
    expect(add).toHaveFocus();
  });
});
