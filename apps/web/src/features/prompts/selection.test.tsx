import { screen, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (role: Role, searchParams: string): ProvidedRender =>
  renderWithProviders(promptsAs(role), { searchParams });
const prompts = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });
const topics = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Groups' });
const bar = (): HTMLElement => screen.getByRole('group', { name: /^Bulk actions/ });

describe('selecting prompts on the Prompts tab', () => {
  it('has a checkbox on every row and one in the header, as the Keywords table has', async () => {
    renderOn('viewer', '?tab=prompts');
    const table = await prompts();
    expect(await within(table).findByRole('checkbox', { name: 'Select all 23 prompts loaded' })).toBeInTheDocument();
    expect(
      within(table).getByRole('checkbox', { name: 'Select Which SEO agency is best for a SaaS startup in Germany?' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^Bulk actions/ })).toBeNull();
  });

  it('shows the bulk bar with the count once rows are ticked, keeps it through a sort, and clears it', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    const table = await prompts();
    await user.click(
      await within(table).findByRole('checkbox', {
        name: 'Select Which SEO agency is best for a SaaS startup in Germany?',
      }),
    );
    await user.click(
      within(table).getByRole('checkbox', { name: 'Select How do I run a technical SEO audit on a large site?' }),
    );
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
    await user.click(within(within(table).getByRole('columnheader', { name: /^Location/ })).getByText('Location'));
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
    await user.click(within(bar()).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: /^Bulk actions/ })).toBeNull();
  });

  it('selects every row from the header checkbox', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    const table = await prompts();
    await user.click(await within(table).findByRole('checkbox', { name: 'Select all 23 prompts loaded' }));
    expect(within(bar()).getByText('23 selected')).toBeInTheDocument();
  });
});

describe('selecting groups on the Groups tab', () => {
  it('has a checkbox on every group row and one in the header, and none on a parent that is no row', async () => {
    renderOn('viewer', '');
    const tree = await topics();
    expect(await within(tree).findByRole('checkbox', { name: 'Select Technical SEO' })).toBeInTheDocument();
    expect(within(tree).getByRole('checkbox', { name: 'Select Paid Search' })).toBeInTheDocument();
    expect(within(tree).getByRole('checkbox', { name: /^Select all \d+ groups loaded$/ })).toBeInTheDocument();
    expect(within(tree).queryByRole('checkbox', { name: 'Select SEO' })).toBeNull();
    expect(within(tree).queryByRole('checkbox', { name: 'Select No group' })).toBeNull();
  });

  it('selects the prompts a group holds and says so in the bar, each prompt once', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select Paid Search' }));
    expect(within(bar()).getByText('1 group selected · 2 prompts')).toBeInTheDocument();
    await user.click(within(tree).getByRole('checkbox', { name: 'Select Technical SEO' }));
    expect(within(bar()).getByText('2 groups selected · 6 prompts')).toBeInTheDocument();
    await user.click(within(tree).getByRole('checkbox', { name: 'Select Technical SEO' }));
    expect(within(bar()).getByText('1 group selected · 2 prompts')).toBeInTheDocument();
  });

  it('has no checkbox on the prompt rows of an open group: the group is what is chosen', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('button', { name: /^Expand Paid Search/ }));
    expect(within(tree).getByText('What is the best way to manage paid search on a small budget?')).toBeInTheDocument();
    expect(
      within(tree).queryByRole('checkbox', {
        name: 'Select What is the best way to manage paid search on a small budget?',
      }),
    ).toBeNull();
  });

  it('keeps the choice of a group that is opened and closed, and empties it with Clear', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select Paid Search' }));
    await user.click(within(tree).getByRole('button', { name: /^Expand Paid Search/ }));
    await user.click(within(tree).getByRole('button', { name: /^Collapse Paid Search/ }));
    expect(within(bar()).getByText('1 group selected · 2 prompts')).toBeInTheDocument();
    await user.click(within(bar()).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: /^Bulk actions/ })).toBeNull();
  });

  it('selects every group and its prompts from the header checkbox, closed rows included', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: /^Select all \d+ groups loaded$/ }));
    // Technical SEO, Local SEO, Blog Strategy and Paid Search: the prompts given only a parent are in no group
    expect(within(bar()).getByText('4 groups selected · 12 prompts')).toBeInTheDocument();
  });
});
