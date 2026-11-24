import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportsScreen } from './reports-screen';
import { copyText } from '@/lib/dom/clipboard';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('@/lib/dom/clipboard', () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));

afterEach(() => {
  server.events.removeAllListeners();
  vi.mocked(copyText).mockClear();
});

function screenAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <ReportsScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        projectId={EVENTUS.project_id}
        project={{ name: 'Eventus Security' }}
        timeZone="UTC"
      />
    </PermissionProvider>
  );
}

const render = (role: Role): ProvidedRender => renderWithProviders(screenAs(role));

describe('Reports: links', () => {
  it('starts empty, makes a link, shows its address once with a Copy button and lists it without the token', async () => {
    const { user } = render('editor');
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New link' }));
    expect(screen.getByRole('combobox', { name: /Link works for/ })).toHaveTextContent('30 days');
    await user.click(screen.getByRole('button', { name: 'Make link' }));

    const address = await screen.findByText(/\/public\/reports\/[0-9a-f]{48}$/);
    expect(screen.getByText(/it is shown only once/)).toBeInTheDocument();
    const text = address.textContent ?? '';
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(copyText).toHaveBeenCalledWith(text);
    expect(screen.getByRole('button', { name: 'Open report' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    const table = await screen.findByRole('table', { name: 'Report links' });
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(table.textContent).not.toContain(text.split('/').pop());
  });

  it('revokes an active link after one question, and the row then has no button', async () => {
    const { user } = render('editor');
    await user.click(await screen.findByRole('button', { name: 'New link' }));
    await user.click(screen.getByRole('button', { name: 'Make link' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await user.click(await screen.findByRole('button', { name: /Revoke the link made on/ }));

    expect(screen.getByText(/Anyone who opens it afterwards finds nothing/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(screen.getByText('Revoked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it('lets a viewer read the lists but not change anything', async () => {
    renderWithProviders(screenAs('viewer'));
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add schedule' })).not.toBeInTheDocument();
    expect(screen.getByText(/Your role cannot make or revoke links/)).toBeInTheDocument();
  });
});

describe('Reports: scheduled emails', () => {
  it('refuses a bad address in words, then adds the schedule with clean recipients', async () => {
    const { user } = render('editor');
    await user.click(await screen.findByRole('button', { name: 'Add schedule' }));
    const recipients = screen.getByRole('textbox', { name: 'Recipients' });

    await user.type(recipients, 'anita@client.com bad');
    await user.click(screen.getByRole('button', { name: 'Add schedule', hidden: false }));
    expect(await screen.findByText('“bad” is not an email address.')).toBeInTheDocument();

    await user.clear(recipients);
    await user.type(recipients, 'Anita@Client.com{enter}ops@client.com');
    await user.click(screen.getByRole('button', { name: 'Add schedule' }));

    const table = await screen.findByRole('table', { name: 'Scheduled emails' });
    expect(within(table).getByText('anita@client.com')).toBeInTheDocument();
    expect(within(table).getByText('ops@client.com')).toBeInTheDocument();
    expect(within(table).getByText('Weekly, on Monday')).toBeInTheDocument();
    expect(within(table).getByText('Running')).toBeInTheDocument();
  });

  it('pauses, resumes and deletes a schedule', async () => {
    const { user } = render('editor');
    await user.click(await screen.findByRole('button', { name: 'Add schedule' }));
    await user.type(screen.getByRole('textbox', { name: 'Recipients' }), 'anita@client.com');
    await user.click(screen.getByRole('button', { name: 'Add schedule' }));
    const table = await screen.findByRole('table', { name: 'Scheduled emails' });

    await user.click(within(table).getByRole('button', { name: 'Pause' }));
    expect(await within(table).findByText('Paused', { selector: 'span' })).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Resume' }));
    expect(await within(table).findByText('Running')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete schedule' }));
    expect(await screen.findByText(/No scheduled emails/)).toBeInTheDocument();
  });
});
