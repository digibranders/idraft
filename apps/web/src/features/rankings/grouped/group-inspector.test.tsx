import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { server } from '@/test/msw';
import { fynix, rankingsAs, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

const byGroup = (): ReturnType<typeof rankingsAs> =>
  rankingsAs('editor', fynix.project_id, { opensOnDefaultView: true });

/** The figures of the drawer, label then value, one entry per fact. */
const figuresOf = (drawer: HTMLElement): string[] =>
  [...drawer.querySelectorAll('dl > div')].map((fact) => fact.textContent);

describe('The group drawer', () => {
  it('opens from the URL with the group, its keyword count and its figures, which follow the device', async () => {
    const { user } = renderWithProviders(byGroup(), { searchParams: `?inspect=group:${MOCK_GROUP_IDS.local}` });
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    await waitFor(() => expect(within(drawer).getByText('10 keywords')).toBeInTheDocument());
    expect(within(drawer).getByText('On Desktop')).toBeInTheDocument();
    const desktop = figuresOf(drawer);
    expect(desktop).toContain('Keywords10');
    expect(desktop.some((fact) => fact.startsWith('Top 3'))).toBe(true);
    expect(within(drawer).getAllByRole('button', { name: /^Open / })).toHaveLength(10);

    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    await waitFor(() => expect(within(drawer).getByText('1 keyword')).toBeInTheDocument());
    expect(within(drawer).getByText('On Mobile')).toBeInTheDocument();
    expect(figuresOf(drawer)).not.toEqual(desktop);
  });

  it('opens from the group row menu, and a keyword of it opens in the inspector', async () => {
    const { user } = renderWithProviders(byGroup());
    const tree = await screen.findByRole('treegrid', { name: 'Tracked keywords' });
    await user.click(await within(tree).findByRole('button', { name: 'Actions for Local, 10 keywords' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Open group/ }));
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    await user.click(within(drawer).getByRole('button', { name: 'Open seo agency berlin' }));
    expect(
      await screen.findByRole('complementary', { name: 'seo agency berlin' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('opens in the flat view too', async () => {
    renderWithProviders(byGroup(), { searchParams: `?view=flat&inspect=group:${MOCK_GROUP_IDS.local}` });
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    await waitFor(() => expect(within(drawer).getByText('10 keywords')).toBeInTheDocument());
  });

  it('says so when no keyword of the group is in view', async () => {
    const { user } = renderWithProviders(byGroup(), { searchParams: `?inspect=group:${MOCK_GROUP_IDS.local}` });
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    await waitFor(() => expect(within(drawer).getByText('10 keywords')).toBeInTheDocument());
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'zzzz');
    expect(await within(drawer).findByText('No keywords of this group in view')).toBeInTheDocument();
    expect(within(drawer).getByText('0 keywords')).toBeInTheDocument();
  });
});
