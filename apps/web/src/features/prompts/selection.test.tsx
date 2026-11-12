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
const topics = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
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
    await user.click(within(within(table).getByRole('columnheader', { name: /^Country/ })).getByText('Country'));
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

describe('selecting topics on the Topics tab', () => {
  it('has a checkbox on every topic row and one in the header', async () => {
    renderOn('viewer', '');
    const tree = await topics();
    expect(await within(tree).findByRole('checkbox', { name: 'Select SEO' })).toBeInTheDocument();
    expect(within(tree).getByRole('checkbox', { name: 'Select Content Marketing' })).toBeInTheDocument();
    expect(within(tree).getByRole('checkbox', { name: /^Select all \d+ topics loaded$/ })).toBeInTheDocument();
  });

  it('selects the prompts a topic holds, a parent with those of its topics, and says so in the bar', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select Paid Search' }));
    expect(within(bar()).getByText('1 topic selected, 2 prompts')).toBeInTheDocument();
    await user.click(within(tree).getByRole('checkbox', { name: 'Select SEO' }));
    expect(within(bar()).getByText('2 topics selected, 14 prompts')).toBeInTheDocument();
  });

  it('draws the topics below a ticked parent as ticked once it is opened, and a parent as partly ticked when one is left out', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select SEO' }));
    await user.click(within(tree).getByRole('button', { name: 'Expand SEO, 2 topics' }));
    expect(within(tree).getByRole('checkbox', { name: 'Select Technical SEO' })).toBeChecked();
    await user.click(within(tree).getByRole('checkbox', { name: 'Select Technical SEO' }));
    expect(within(tree).getByRole('checkbox', { name: 'Select SEO' })).toHaveAttribute('aria-checked', 'mixed');
    expect(within(bar()).getByText('1 topic selected, 8 prompts')).toBeInTheDocument();
  });

  it('selects the prompt rows of an open topic one by one, and counts them as prompts', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('button', { name: /^Expand Paid Search/ }));
    await user.click(
      within(tree).getByRole('checkbox', {
        name: 'Select What is the best way to manage paid search on a small budget?',
      }),
    );
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
    expect(within(tree).getByRole('checkbox', { name: 'Select Paid Search' })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('empties the choice with Clear, also the prompts of a row that is closed', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('button', { name: /^Expand Paid Search/ }));
    await user.click(
      within(tree).getByRole('checkbox', {
        name: 'Select What is the best way to manage paid search on a small budget?',
      }),
    );
    await user.click(within(tree).getByRole('button', { name: /^Collapse Paid Search/ }));
    await user.click(within(bar()).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: /^Bulk actions/ })).toBeNull();
  });

  it('selects every topic and its prompts from the header checkbox, closed rows included', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: /^Select all \d+ topics loaded$/ }));
    // SEO, Content Marketing and Paid Search: the prompts without a topic are chosen too, but are no topic
    expect(within(bar()).getByText('3 topics selected, 23 prompts')).toBeInTheDocument();
  });

  it('does not count the prompts without a topic as a topic, and counts them as prompts', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await topics();
    await user.click(await within(tree).findByRole('checkbox', { name: 'Select No topic' }));
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });
});
