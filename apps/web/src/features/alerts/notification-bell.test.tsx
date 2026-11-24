import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationBell } from './notification-bell';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { resetAlertMocks } from '@/mocks/handlers/alerts';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('no fixture project');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const RULES_HREF = '/digibranders/fynix/settings/alert-rules' as Route;

beforeEach(() => {
  resetAlertMocks();
  vi.setSystemTime(new Date('2026-11-24T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

function bellAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <NotificationBell
        scope={{ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix?.project_id ?? '' }}
        timeZone="UTC"
        brandName="Fynix"
        rulesHref={RULES_HREF}
      />
    </PermissionProvider>
  );
}

describe('NotificationBell', () => {
  it('names the button with the unread count and shows it on the badge', async () => {
    renderWithProviders(bellAs('editor'));
    const button = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(button).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('lists the alerts with their evidence and links to the alert rules', async () => {
    const { user } = renderWithProviders(bellAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const list = await screen.findByRole('list', { name: 'Recent alerts' });
    expect(list).toHaveTextContent('event security guards');
    expect(list).toHaveTextContent('Rank fell from 4 to 11');
    expect(screen.getByRole('link', { name: 'Alert rules' })).toHaveAttribute('href', RULES_HREF);
  });

  it('says there are no alerts yet, with no badge', async () => {
    server.use(
      http.get(mswPath(`${P}/alert-events`), () =>
        HttpResponse.json({ data: [], page: { limit: 50, next_cursor: null, has_more: false } }),
      ),
    );
    const { user } = renderWithProviders(bellAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('No alerts yet. The next run checks every rule.')).toBeInTheDocument();
  });

  it('shows an error with a retry that reads the alerts again', async () => {
    let failing = true;
    server.use(
      http.get(mswPath(`${P}/alert-events`), () =>
        failing
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json({ data: [], page: { limit: 50, next_cursor: null, has_more: false } }),
      ),
    );
    const { user } = renderWithProviders(bellAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('The alerts could not be loaded.')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No alerts yet. The next run checks every rule.')).toBeInTheDocument();
  });

  it('acknowledges every open alert with Acknowledge all', async () => {
    const { user } = renderWithProviders(bellAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await user.click(await screen.findByRole('button', { name: 'Acknowledge all' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Acknowledge all' })).toBeNull());
  });

  it('offers a viewer the list but not Acknowledge all', async () => {
    const { user } = renderWithProviders(bellAs('viewer'));
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    expect(await screen.findByRole('list', { name: 'Recent alerts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge all' })).toBeNull();
  });

  it('reads "or more" when another page of alerts exists', async () => {
    server.use(
      http.get(mswPath(`${P}/alert-events`), () =>
        HttpResponse.json({
          data: [
            {
              id: '9',
              rule_id: '6f1c0000-0000-4000-8000-000000000003',
              subject_type: 'keyword',
              subject_id: 'k-9',
              subject_label: 'first page keyword',
              event_kind: 'rank_drop',
              severity: 'warning',
              evidence: { from_rank: 4, to_rank: 11, positions_lost: 7, positions: 5 },
              occurred_at: '2026-11-24T06:12:00.000Z',
              acknowledged_by: null,
              acknowledged_at: null,
            },
          ],
          page: { limit: 50, next_cursor: 'next', has_more: true },
        }),
      ),
    );
    renderWithProviders(bellAs('editor'));
    expect(await screen.findByRole('button', { name: 'Notifications, 1 or more unread' })).toBeInTheDocument();
    expect(screen.getByText('1+')).toBeInTheDocument();
  });
});
