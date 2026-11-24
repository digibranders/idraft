import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertRulesScreen } from './alert-rules-screen';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { resetAlertMocks } from '@/mocks/handlers/alerts';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/alert-rules',
}));

const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('no fixture project');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const NOW = new Date('2026-11-24T09:00:00Z');

beforeEach(() => {
  resetAlertMocks();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  server.events.removeAllListeners();
});

function screenAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LeaveGuardProvider>
        <Suspense fallback={null}>
          <AlertRulesScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            projectId={fynix?.project_id ?? ''}
            timeZone="UTC"
          />
        </Suspense>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

/** The bodies the screen sends with `method` to the alert routes, as they arrive. */
function recordBodies(method: 'POST' | 'PATCH'): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.includes('/alert-')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
}

/** The rules table once its rows have loaded. */
const rulesTable = async (): Promise<HTMLElement> => {
  const table = await screen.findByRole('table', { name: 'Alert rules of this project' });
  await within(table).findByText('Big keyword drops');
  return table;
};
const alertsTable = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Recent alerts of this project' });
const rowOf = async (table: HTMLElement, text: string | RegExp): Promise<HTMLElement> => {
  const row = (await within(table).findByText(text)).closest('tr');
  if (row === null) throw new Error(`No row for ${String(text)}`);
  return row;
};

describe('Settings > Alert rules', () => {
  it('lists the rules with what they apply to, and the recent alerts with a sentence of what changed', async () => {
    renderWithProviders(screenAs('editor'));
    const rules = await rulesTable();
    const rank = await rowOf(rules, 'Big keyword drops');
    expect(within(rank).getByText('Keyword rank drops by 5 positions or more')).toBeInTheDocument();
    expect(within(rank).getByText('All groups')).toBeInTheDocument();
    const lost = await rowOf(rules, 'Brand lost in an answer');
    expect(within(lost).getByText('All groups, All platforms')).toBeInTheDocument();

    const alerts = await alertsTable();
    expect(
      await within(alerts).findByText(
        'Your brand was mentioned in 3 of 5 ChatGPT answers in the previous run and in 0 of 5 in this run.',
      ),
    ).toBeInTheDocument();
    expect(within(alerts).getByText('Rank fell from 4 to 11 (7 positions).')).toBeInTheDocument();
    expect(
      within(alerts).getByText(
        'Halden Security was mentioned in 0 of 5 Gemini answers in the previous run and in 2 of 5 in this run.',
      ),
    ).toBeInTheDocument();
    expect(within(await rowOf(alerts, 'event security guards')).getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('2 alerts to acknowledge.')).toBeInTheDocument();
  });

  it('turns a rule off with a PATCH of is_active only', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    await rulesTable();
    await user.click(await screen.findByRole('switch', { name: 'Brand lost in an answer is on' }));
    await waitFor(() => expect(bodies).toEqual([{ is_active: false }]));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Brand lost in an answer is on' })).not.toBeChecked(),
    );
  });

  it('checks the name before it adds a rule, then sends the rule', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('editor'));
    await rulesTable();
    await user.click(screen.getByRole('button', { name: 'Add alert rule' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add alert rule' });
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    expect(await within(dialog).findByText('Name the rule so you can find it in the list.')).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Lost in retail');
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      name: 'Lost in retail',
      rule_type: 'ai_mention_lost',
      is_active: true,
      scope: { group_ids: [], engine_codes: [] },
      params: {},
    });
    expect(await rowOf(await rulesTable(), 'Lost in retail')).toBeInTheDocument();
  });

  it('acknowledges one alert, and every open alert with one call', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('editor'));
    const alerts = await alertsTable();
    await user.click(await within(alerts).findByRole('button', { name: 'Acknowledge alert: event security guards' }));
    await waitFor(() => expect(bodies).toEqual([{ ids: ['3'] }]));
    await waitFor(() => expect(screen.getByText('1 alert to acknowledge.')).toBeInTheDocument());
    expect(
      within(await rowOf(alerts, 'event security guards')).queryByRole('button', { name: /^Acknowledge alert/ }),
    ).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Acknowledge all' }));
    await waitFor(() => expect(bodies).toEqual([{ ids: ['3'] }, { ids: ['2'] }]));
    await waitFor(() => expect(screen.getByText('Every alert shown is acknowledged.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Acknowledge all' })).toBeNull();
  });

  it('deletes a rule after a question', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await rulesTable();
    await user.click(await screen.findByRole('button', { name: 'Actions for Big keyword drops' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete Big keyword drops?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete rule' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Alert rules of this project' })).queryByText('Big keyword drops'),
      ).toBeNull(),
    );
  });

  it('is read only for a viewer', async () => {
    renderWithProviders(screenAs('viewer'));
    const rules = await rulesTable();
    expect(screen.getByText(/Owners, admins and editors can change alert rules/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add alert rule' })).toBeNull();
    expect(within(rules).getByRole('switch', { name: 'Brand lost in an answer is on' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    await alertsTable();
    expect(screen.queryByRole('button', { name: /^Acknowledge/ })).toBeNull();
  });

  it('says so when the member may not read the alerts, and offers a retry when the server fails', async () => {
    server.use(http.get(mswPath(`${P}/alert-rules`), ({ request }) => problem(request, 'forbidden')));
    const first = renderWithProviders(screenAs('viewer'));
    expect(await screen.findByText(/You do not have permission to see the alerts of this project/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Recent alerts of this project' })).toBeNull();
    first.unmount();

    server.use(http.get(mswPath(`${P}/alert-rules`), () => HttpResponse.json({}, { status: 500 })));
    renderWithProviders(screenAs('editor'));
    expect(await screen.findByText('The alert rules could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty state with the action to add the first rule', async () => {
    server.use(
      http.get(mswPath(`${P}/alert-rules`), () =>
        HttpResponse.json({ data: [], page: { offset: 0, limit: 50, total: 0 } }),
      ),
    );
    renderWithProviders(screenAs('editor'));
    expect(await screen.findByText('No alert rules yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add alert rule' })).toBeInTheDocument();
  });
});
