import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageTiersScreen } from './page-tiers-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
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
const P = `${W}/projects/${EVENTUS.project_id}`;
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

  it('asks where pages go when a tier turned out to be in use, then deletes with the choice', async () => {
    // A fifth tier nothing uses, so the dialog first only asks to confirm
    const owner = mockBrowser('owner');
    const created = await owner.call('POST', `${W}/page-tiers`, { name: 'Spare' });
    const spare = (created.body as { data: { tier_id: string } }).data.tier_id;
    const bodies: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'DELETE') bodies.push(request.url);
    });
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Delete T5 Spare' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete T5?' });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    // Someone else tags a page with it while the dialog is open
    await owner.call('PUT', `${P}/pages/tiers`, { tier_id: spare, url_ids: ['101'] });
    await user.click(within(dialog).getByRole('button', { name: 'Delete T5' }));
    expect(await within(dialog).findByText(/Pages or rules now use this tier/)).toBeInTheDocument();
    // The dialog reads the fresh list: the picker is there and the button waits for a choice
    const picker = await within(dialog).findByRole('combobox', { name: 'Move pages and rules to' });
    expect(within(dialog).getByText(/1 page and 0 rules use T5 Spare\. Move them to:/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete T5' })).toBeDisabled();
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: 'Untiered' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete T5' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).not.toContain('move_to');
    expect(bodies[1]).toContain('move_to=none');
  });

  it('says that moving to Untiered deletes the rules, and not when moving to another tier', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Delete T1 Money pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete T1?' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Move pages and rules to' }));
    await user.click(await screen.findByRole('option', { name: 'Untiered' }));
    expect(within(dialog).getByText(/rules? will be deleted/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('combobox', { name: 'Move pages and rules to' }));
    await user.click(await screen.findByRole('option', { name: /^T2/ }));
    expect(within(dialog).queryByText(/rules? will be deleted/)).toBeNull();
  });

  it('moves focus to the heading after a tier is deleted', async () => {
    await mockBrowser('owner').call('POST', `${W}/page-tiers`, { name: 'Spare' });
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Delete T5 Spare' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete T5?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete T5' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete T5?' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page tiers' })).toHaveFocus());
  });

  it('adds with Enter, and adding spaces to an unchanged name is no change to discard', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add tier' }));
    const add = await screen.findByRole('dialog', { name: 'Add tier' });
    await user.type(within(add).getByRole('textbox', { name: 'Name' }), 'Enter tier{Enter}');
    expect(await screen.findByRole('cell', { name: 'Enter tier' })).toBeInTheDocument();
  });

  it('refreshes the list when a tier is refused for the limit, so Add tier is current', async () => {
    let reads = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && request.url.endsWith('/page-tiers')) reads += 1;
    });
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Add tier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add tier' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Late');
    server.use(http.post(TIERS, () => problem(new Request('http://localhost'), 'tier_limit')));
    const before = reads;
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByText('A workspace can have up to 8 tiers.');
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });

  it('refreshes every read of the workspace after a change, so tier badges and the flow update', async () => {
    const { user, queryClient } = renderWithProviders(screenAs('owner'));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' x');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', MOCK_WORKSPACE.workspace_id] }));
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
