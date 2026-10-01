import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TaxonomyScreen } from './taxonomy-screen';
import type { Role } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/taxonomy',
}));

const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('no fixture project');

function screenAs(role: Role, projectIds: readonly string[] | null = null): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role, { projectIds })}>
      <LeaveGuardProvider>
        <Suspense fallback={null}>
          <TaxonomyScreen workspaceId={MOCK_WORKSPACE.workspace_id} projectId={fynix?.project_id ?? ''} />
        </Suspense>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

const tree = (): Promise<HTMLElement> => screen.findByRole('tree', { name: 'Terms of Topics' });
const term = (name: string): HTMLElement => screen.getByRole('treeitem', { name });

describe('Taxonomy', () => {
  it('shows the first vocabulary as a tree, with its kind and reach', async () => {
    const { container } = renderWithProviders(screenAs('editor'));
    await tree();
    expect(term('SEO')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Topics, 6 terms, shared by every project')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('adds a term under the selected one, and shows it inside its parent', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await tree();
    await user.click(term('SEO'));
    await user.click(screen.getByRole('button', { name: 'Add under SEO' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a term under SEO' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Enterprise SEO');
    await user.click(within(dialog).getByRole('button', { name: 'Add term' }));
    expect(await screen.findByRole('treeitem', { name: 'Enterprise SEO' })).toHaveAttribute('aria-selected', 'true');
    expect(term('SEO')).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves a term to the top level', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await tree();
    await user.click(term('SEO'));
    await user.keyboard('{ArrowRight}');
    await user.click(term('Technical SEO'));
    expect(term('Technical SEO')).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Technical SEO' });
    await user.click(within(dialog).getByRole('combobox', { name: 'New place' }));
    await user.click(await screen.findByRole('option', { name: 'Top level' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(term('Technical SEO')).toHaveAttribute('aria-level', '1'));
  });

  it('deletes a term with the terms under it after saying how many go', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await tree();
    await user.click(term('Content Marketing'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the term Content Marketing?' });
    expect(within(confirm).getByText(/The 1 term under it goes too/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Delete with its terms' }));
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'Content Marketing' })).toBeNull());
  });

  it('creates a vocabulary for this project and opens it', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await tree();
    await user.click(screen.getByRole('button', { name: 'New vocabulary' }));
    const dialog = await screen.findByRole('dialog', { name: 'New vocabulary' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Markets');
    await user.click(within(dialog).getByRole('button', { name: 'Create vocabulary' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByText('No terms yet. Add one, or paste a list.')).toBeInTheDocument();
  });

  it('pastes a list of paths, creating missing parents', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await tree();
    await user.click(screen.getByRole('button', { name: 'Paste a list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Paste a list of terms' });
    await user.click(within(dialog).getByRole('textbox', { name: 'Terms' }));
    await user.paste('Analytics\nAnalytics/Attribution');
    await user.click(within(dialog).getByRole('button', { name: 'Add terms' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await screen.findByRole('treeitem', { name: 'Analytics' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('says why a move is refused when the new place is too deep', async () => {
    server.use(
      http.patch(mswPath('/api/v1/workspaces/{workspace_id}/terms/{term_id}'), ({ request }) =>
        problem(request, 'validation_failed', {
          errors: [{ location: 'body', path: 'parent_id', code: 'too_deep', message: 'Too deep' }],
        }),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await tree();
    await user.click(term('Paid Search'));
    await user.click(screen.getByRole('button', { name: 'Move to' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Paid Search' });
    await user.click(within(dialog).getByRole('combobox', { name: 'New place' }));
    await user.click(await screen.findByRole('option', { name: 'SEO' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(
      await within(dialog).findByText('A term is at most 10 levels from the top. Choose a place higher up.'),
    ).toBeInTheDocument();
  });

  it('lets a member limited to some projects change only their projects’ vocabularies', async () => {
    const { user } = renderWithProviders(screenAs('editor', [fynix.project_id]));
    await tree();
    expect(screen.getByText(/^This vocabulary is shared by every project/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add term' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Topics' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Vocabulary' }));
    await user.click(await screen.findByRole('option', { name: 'Services' }));
    expect(await screen.findByRole('button', { name: 'Add term' })).toBeInTheDocument();
    expect(screen.queryByText(/^This vocabulary is shared by every project/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New vocabulary' }));
    const dialog = await screen.findByRole('dialog', { name: 'New vocabulary' });
    expect(within(dialog).getByRole('radio', { name: /^The whole workspace/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('is read-only without taxonomy:write', async () => {
    renderWithProviders(screenAs('analyst'));
    await tree();
    expect(screen.getByText('Owners, admins and editors can change the taxonomy.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add term' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New vocabulary' })).toBeNull();
  });
});
