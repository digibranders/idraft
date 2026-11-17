import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageTiersScreen } from './page-tiers-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { invalidField, mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { mockBrowser } from '@/test/mock-api';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/settings/tiers',
  useSearchParams: () => new URLSearchParams(),
}));

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const TIERS = mswPath('/api/v1/workspaces/{workspace_id}/page-tiers');
const TIER = mswPath('/api/v1/workspaces/{workspace_id}/page-tiers/{tier_id}');

afterEach(() => {
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

function screenAs(role: Role): React.ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <PageTiersScreen workspaceId={MOCK_WORKSPACE.workspace_id} />
    </PermissionProvider>
  );
}

describe('Page tiers settings', () => {
  it('lists the tiers with their pages and the fixed Untiered row', async () => {
    renderWithProviders(screenAs('owner'));
    const table = await screen.findByRole('table', { name: 'Page tiers' });
    expect(await within(table).findByRole('cell', { name: 'Money pages' })).toBeInTheDocument();
    expect(within(table).getByText('Always there')).toBeInTheDocument();
    expect(table.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('renames a tier and keeps its code', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Legal and utility');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('cell', { name: 'Legal and utility' })).toBeInTheDocument();
  });

  it('refuses a name of more than 60 characters before sending', async () => {
    let writes = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PATCH') writes += 1;
    });
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'x'.repeat(61));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Use 1 to 60 characters.')).toBeInTheDocument();
    expect(writes).toBe(0);
  });

  it('asks before closing a rename with changes', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' more');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
  });

  it('adds a tier through a dialog and refuses a ninth with the limit message', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Add tier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add tier' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Landing pages');
    server.use(http.post(TIERS, () => problem(new Request('http://localhost'), 'tier_limit')));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('A workspace can have up to 8 tiers.')).toBeInTheDocument();
  });

  it('makes the person choose where pages go before deleting a tier in use, and names the page count', async () => {
    const bodies: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'DELETE') bodies.push(request.url);
    });
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Delete T1 Money pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete T1?' });
    expect(within(dialog).getByText(/pages? and .* rules? use T1 Money pages\. Move them to:/)).toBeInTheDocument();
    expect(within(dialog).getByText('Codes close up: T2 becomes T1.')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Delete T1' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: 'Move pages and rules to' }));
    await user.click(await screen.findByRole('option', { name: 'Untiered' }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toContain('move_to=none');
  });

  it('shows the server answer when a tier turned out to be in use', async () => {
    // A fifth tier nothing uses, so the dialog only asks to confirm
    await mockBrowser('owner').call('POST', `${W}/page-tiers`, { name: 'Spare' });
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Delete T5 Spare' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete T5?' });
    server.use(http.delete(TIER, () => problem(new Request('http://localhost'), 'tier_in_use')));
    await user.click(within(dialog).getByRole('button', { name: 'Delete T5' }));
    expect(await within(dialog).findByText(/Pages or rules now use this tier/)).toBeInTheDocument();
  });

  it('never prints the words of an unknown server error', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' x');
    server.use(
      http.patch(TIER, () => invalidField(new Request('http://localhost'), 'name', 'weird', 'RAW BACKEND TEXT')),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The tier could not be saved. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/RAW BACKEND TEXT/)).toBeNull();
  });

  it('shows the list read-only to an editor', async () => {
    renderWithProviders(screenAs('editor'));
    await screen.findByRole('table', { name: 'Page tiers' });
    expect(screen.queryByRole('button', { name: 'Add tier' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Rename / })).toBeNull();
    expect(screen.getByText('Only owners and admins of the workspace can change the tiers.')).toBeInTheDocument();
  });

  it('disables Add tier at eight tiers and says why', async () => {
    const editor = mockBrowser('owner');
    for (let index = 0; index < 4; index += 1)
      await editor.call('POST', `${W}/page-tiers`, { name: `Extra ${String(index)}` });
    renderWithProviders(screenAs('owner'));
    const add = await screen.findByRole('button', { name: 'Add tier' });
    await waitFor(() => expect(add).toBeDisabled());
    expect(screen.getByText('A workspace can have up to 8 tiers')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(screenAs('owner'));
    await screen.findByRole('cell', { name: 'Money pages' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
