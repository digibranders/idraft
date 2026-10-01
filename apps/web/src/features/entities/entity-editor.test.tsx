import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EntityEditor } from './entity-editor';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_ENTITIES } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/entities/x',
}));

const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('no fixture project');
const entityNamed = (name: string): string => {
  const found = MOCK_ENTITIES.find((entity) => entity.canonical_name === name);
  if (!found) throw new Error(`no fixture entity ${name}`);
  return found.entity_id;
};

function editorAs(role: Role, name: string): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LeaveGuardProvider>
        <Suspense fallback={null}>
          <EntityEditor
            workspaceId={MOCK_WORKSPACE.workspace_id}
            projectId={fynix?.project_id ?? ''}
            entityId={entityNamed(name)}
            workspaceSlug="digibranders"
            projectSlug={fynix?.slug ?? ''}
          />
        </Suspense>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

describe('Entity editor', () => {
  it('shows the entity with its role, domains and aliases', async () => {
    const { container } = renderWithProviders(editorAs('editor', 'Rankforge'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Rankforge' })).toBeInTheDocument();
    expect(screen.getByText('Competitor')).toBeInTheDocument();
    expect(screen.getByText('rankforge.com')).toBeInTheDocument();
    const aliases = screen.getByRole('table', { name: 'Aliases' });
    expect(within(aliases).getByRole('rowheader', { name: 'Rankforge Capital' })).toBeInTheDocument();
    expect(within(aliases).getByText('Rules out')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('adds an alias, and shows the API refusing a pattern on the field', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Rankforge'));
    await user.click(await screen.findByRole('button', { name: 'Add alias' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add an alias to Rankforge' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Alias' }), 'RankForge HQ');
    await user.click(within(dialog).getByRole('button', { name: 'Add alias' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const aliases = screen.getByRole('table', { name: 'Aliases' });
    expect(await within(aliases).findByRole('rowheader', { name: 'RankForge HQ' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add alias' }));
    dialog = await screen.findByRole('dialog', { name: 'Add an alias to Rankforge' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Match' }));
    await user.click(await screen.findByRole('option', { name: /Regular expression/ }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Alias' }), 'rank(forge');
    await user.click(within(dialog).getByRole('button', { name: 'Add alias' }));
    expect(await within(dialog).findByText(/^This pattern cannot be used/)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Alias' })).toHaveFocus();
  });

  it('adds a domain for one path, and removes one after asking', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Rankforge'));
    await screen.findByText('rankforge.com');
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'medium.com');
    await user.click(screen.getByRole('combobox', { name: 'Counts' }));
    await user.click(await screen.findByRole('option', { name: /Pages under a path/ }));
    await user.type(screen.getByRole('textbox', { name: 'Path' }), '/rankforge');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByText('medium.com/rankforge')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove rankforge.com' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove rankforge.com from Rankforge?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('rankforge.com')).toBeNull());
  });

  it('refuses a private address before sending it', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Rankforge'));
    await screen.findByText('rankforge.com');
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'localhost');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByText('Local and private addresses cannot be tracked')).toBeInTheDocument();
  });

  it('saves the details through the save bar', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Meridian Growth'));
    await screen.findByRole('heading', { level: 2, name: 'Meridian Growth' });
    await user.click(screen.getByRole('checkbox', { name: /The name is also a common word/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
  });

  it('tests a sample answer: what counts, a common-word name near its hint, and what a negative dropped', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Rankforge'));
    const sample = await screen.findByRole('textbox', { name: 'Sample answer' });
    await user.click(sample);
    await user.paste('Fynix and the agency Northlight lead; Rankforge Capital is a fund, not Rankforge.');
    expect(await screen.findByText(/mentions count/, { selector: 'p' })).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Fynix mention/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Northlight SEO mention/)).toBeInTheDocument();
    expect(screen.getByText(/1 match dropped by a negative alias/, { selector: 'p' })).toBeInTheDocument();
  });

  it('refuses a parent that would make a loop, on the parent field', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Fynix'));
    await screen.findByRole('heading', { level: 2, name: 'Fynix' });
    await user.click(screen.getByRole('combobox', { name: /^Part of/ }));
    await user.click(await screen.findByRole('option', { name: 'Fynix Audit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('This entity already sits under the one chosen. Choose another.'),
    ).toBeInTheDocument();
  });

  it('pastes several aliases, leaving out the ones it has and the repeats', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Rankforge'));
    await user.click(await screen.findByRole('button', { name: 'Paste several' }));
    const dialog = await screen.findByRole('dialog', { name: 'Paste aliases for Rankforge' });
    await user.click(within(dialog).getByRole('textbox', { name: 'Aliases' }));
    await user.paste('rankforge\nRankforge Labs\nrankforge labs');
    expect(within(dialog).getByText('1 alias')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add aliases' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const aliases = screen.getByRole('table', { name: 'Aliases' });
    expect(await within(aliases).findAllByRole('rowheader', { name: 'Rankforge Labs' })).toHaveLength(1);
  });

  it('asks again for the same sample once an alias is added', async () => {
    const { user } = renderWithProviders(editorAs('editor', 'Rankforge'));
    const sample = await screen.findByRole('textbox', { name: 'Sample answer' });
    await user.click(sample);
    await user.paste('We hired RF Labs last year.');
    expect(await screen.findByText(/^0 mentions count/, { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add alias' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an alias to Rankforge' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Alias' }), 'RF Labs');
    await user.click(within(dialog).getByRole('button', { name: 'Add alias' }));
    expect(await screen.findByText(/^1 mention counts/, { selector: 'p' })).toBeInTheDocument();
  });

  it('is read-only without entities:write', async () => {
    renderWithProviders(editorAs('analyst', 'Rankforge'));
    expect(await screen.findByText('Owners, admins and editors can change entities.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add alias' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add domain' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  });
});
