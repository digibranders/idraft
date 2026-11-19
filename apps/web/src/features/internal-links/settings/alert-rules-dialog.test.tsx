import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AlertRulesDialog } from './alert-rules-dialog';
import { Button } from '@/components/ui/button';
import { linkSettingsQuery } from '@/lib/internal-links/queries';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const SETTINGS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings');
const PROBLEM = { 'content-type': 'application/problem+json' };

afterEach(() => {
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

function Host(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Change alert rules</Button>
      <AlertRulesDialog open={open} onOpenChange={setOpen} scope={SCOPE} tierCount={3} />
    </>
  );
}

function signIn(role: 'editor' | 'viewer'): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
}

/** The JSON bodies of the PATCH requests to the settings route, with the mock still answering. */
function patches(): unknown[] {
  const seen: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PATCH' && request.url.endsWith('/settings')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.push(body));
    }
  });
  return seen;
}

async function openDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Change alert rules' }));
  const dialog = await screen.findByRole('dialog', { name: 'Alert rules' });
  await screen.findByRole('textbox', { name: 'Lost links that raise an alert' });
  return dialog;
}

describe('AlertRulesDialog', () => {
  it('sends only the changed member, toasts, closes and feeds the settings cache', async () => {
    signIn('editor');
    const seen = patches();
    const { user, queryClient } = renderWithProviders(<Host />);
    await openDialog(user);
    const field = screen.getByRole('textbox', { name: 'Lost links that raise an alert' });
    expect(field).toHaveValue('1');
    await user.clear(field);
    await user.type(field, '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alert rules' })).toBeNull());
    expect(seen).toEqual([{ internal_links: { alerts: { threshold: 3 } } }]);
    expect(await screen.findByText('Alert rules saved')).toBeInTheDocument();
    const cached = queryClient.getQueryData(linkSettingsQuery(SCOPE).queryKey);
    expect(JSON.stringify(cached)).toContain('"threshold":3');
  });

  it('returns focus to the button that opened it', async () => {
    signIn('editor');
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alert rules' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Change alert rules' })).toHaveFocus();
  });

  it('refuses a threshold out of range before sending anything', async () => {
    signIn('editor');
    const seen = patches();
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    const field = screen.getByRole('textbox', { name: 'Lost links that raise an alert' });
    await user.clear(field);
    await user.type(field, '51');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number from 1 to 50.')).toBeInTheDocument();
    expect(seen).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Alert rules' })).toBeInTheDocument();
  });

  it('shows the reason of a 422 inline and keeps the dialog and the draft', async () => {
    signIn('editor');
    server.use(
      http.patch(SETTINGS, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'validation_failed',
            detail: '1 field is invalid.',
            errors: [
              {
                location: 'body',
                path: 'internal_links.alerts.channel',
                code: 'channel_unavailable',
                message: 'Email and Slack alerts are not available yet.',
              },
            ],
          },
          { status: 422, headers: PROBLEM },
        ),
      ),
    );
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    const field = screen.getByRole('textbox', { name: 'Lost links that raise an alert' });
    await user.clear(field);
    await user.type(field, '4');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Email and Slack alerts are not available yet.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Alert rules' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Lost links that raise an alert' })).toHaveValue('4');
  });

  it('asks before it drops a changed draft', async () => {
    signIn('editor');
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    await user.type(screen.getByRole('textbox', { name: 'Lost links that raise an alert' }), '0');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
  });

  it('keeps Save off until something changed', async () => {
    signIn('editor');
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('submits with Enter in the threshold field', async () => {
    signIn('editor');
    const seen = patches();
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    const field = screen.getByRole('textbox', { name: 'Lost links that raise an alert' });
    await user.clear(field);
    await user.type(field, '6{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alert rules' })).toBeNull());
    expect(seen).toEqual([{ internal_links: { alerts: { threshold: 6 } } }]);
  });

  it('treats an equivalent threshold as no change: Save stays off, nothing is sent', async () => {
    signIn('editor');
    const seen = patches();
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    const field = screen.getByRole('textbox', { name: 'Lost links that raise an alert' });
    await user.clear(field);
    await user.type(field, '01');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(field, '{Enter}');
    expect(seen).toHaveLength(0);
  });

  it('puts focus on the first field once the rules have loaded', async () => {
    signIn('editor');
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Alert me when links to important pages are lost' })).toHaveFocus(),
    );
  });

  it('focuses the threshold and adds a summary when Save is refused for it', async () => {
    signIn('editor');
    const { user } = renderWithProviders(<Host />);
    await openDialog(user);
    const field = screen.getByRole('textbox', { name: 'Lost links that raise an alert' });
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The alert rules were not saved. Fix the number of lost links first.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 1 to 50.')).toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it.each(['light', 'dark'])('has no axe violations in %s', async (theme) => {
    signIn('editor');
    if (theme === 'dark') document.documentElement.classList.add('dark');
    const { user } = renderWithProviders(<Host />);
    const dialog = await openDialog(user);
    expect(await axe(dialog)).toHaveNoViolations();
  });
});
