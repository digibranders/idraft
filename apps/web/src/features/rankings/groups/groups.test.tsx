import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mswPath, problem } from '@/mocks/respond';
import { server } from '@/test/msw';
import { loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

interface Write {
  method: string;
  /** The path after `/projects/{id}/`, such as `keyword-groups` or `tracked-keywords/bulk-update`. */
  route: string;
  body: unknown;
}

/**
 * The writes to groups and tracked keywords, in order, and the ids the API gave the groups it created.
 * Each write's body is read as the request starts, so the order is the order they were sent in.
 */
function recorder(): { writes: Write[]; created: string[] } {
  const writes: Write[] = [];
  const created: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const route = new URL(request.url).pathname.split('/projects/')[1]?.split('/').slice(1).join('/') ?? '';
    if (request.method === 'GET' || !/^(keyword-groups|tracked-keywords)/.test(route)) return;
    void request
      .clone()
      .text()
      .then((text) => writes.push({ method: request.method, route, body: text === '' ? null : JSON.parse(text) }));
  });
  server.events.on('response:mocked', ({ request, response }) => {
    if (request.method !== 'POST' || !request.url.endsWith('/keyword-groups')) return;
    void response
      .clone()
      .json()
      .then((answer: { data: { group_id: string } }) => created.push(answer.data.group_id));
  });
  return { writes, created };
}

const groupCreates = (writes: readonly Write[]): Write[] =>
  writes.filter((write) => write.method === 'POST' && write.route === 'keyword-groups');

type User = ReturnType<typeof renderWithProviders>['user'];

/** Ticks the rows of these keywords and opens "Move to group". */
async function openMove(user: User, keyword: string): Promise<HTMLElement> {
  await loadedGrid();
  await user.click(screen.getByRole('checkbox', { name: `Select ${keyword}` }));
  const bar = screen.getByRole('group', { name: /Bulk actions/ });
  await user.click(within(bar).getByRole('button', { name: 'Move to group' }));
  return screen.findByRole('dialog', { name: 'Move 1 keyword' });
}

async function openAdd(user: User): Promise<HTMLElement> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'Add keywords' }));
  return screen.findByRole('dialog', { name: 'Add keywords' });
}

describe('Choosing groups in the forms', () => {
  it('creates a typed group, level by level, when bulk move is submitted', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'Blog/Guides');
    await user.click(await screen.findByRole('option', { name: 'Create group "Blog/Guides"' }));
    expect(seen.writes.filter((write) => write.route === 'keyword-groups')).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await screen.findByText('1 keyword moved to Blog/Guides')).toBeInTheDocument();
    const creates = groupCreates(seen.writes);
    expect(creates.map((write) => write.body)).toEqual([
      { name: 'Blog', parent_id: null },
      { name: 'Guides', parent_id: seen.created[0] },
    ]);
    expect(seen.created).toHaveLength(2);
    const move = seen.writes.at(-1);
    expect(move?.route).toBe('tracked-keywords/bulk-update');
    expect(move?.body).toMatchObject({ add_group_ids: [seen.created[1]] });
  }, 15_000);

  it('offers no create row for a path that names a group already', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'services/seo AUDITS');
    expect(await screen.findByRole('option', { name: 'Services/SEO audits' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Create group/ })).toBeNull();
  });

  it('creates the groups typed in Add keywords when it is saved, not when they are picked', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    let dialog = await openAdd(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'topic cluster planner');
    await user.type(within(dialog).getByRole('combobox', { name: /^Groups/ }), 'Pillar{Enter}{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Remove Pillar' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    expect(groupCreates(seen.writes)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'topic cluster planner');
    await user.type(within(dialog).getByRole('combobox', { name: /^Groups/ }), 'Pillar{Enter}{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([{ name: 'Pillar', parent_id: null }]);
    const add = seen.writes.find((write) => write.route === 'tracked-keywords/bulk-create');
    expect(add?.body).toMatchObject({ items: [{ keyword: 'topic cluster planner', group_ids: [seen.created[0]] }] });
  }, 20_000);

  it('names a typed group path that cannot be made as a field error and sends nothing', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'topic cluster planner');
    await user.type(within(dialog).getByRole('combobox', { name: /^Groups/ }), 'Blog//x{Enter}{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByText('Each level of a group path needs a name.')).toBeInTheDocument();
    expect(seen.writes).toEqual([]);
  }, 15_000);

  it('creates a typed group when the inspector is saved, then files the keyword in it', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const grid = await loadedGrid();
    const cell = within(grid)
      .getAllByRole('rowheader')
      .find((header) => header.querySelector('.truncate')?.textContent === 'seo agency');
    if (cell === undefined) throw new Error('No row for seo agency');
    await user.click(cell);
    const inspector = await screen.findByRole('complementary', { name: 'seo agency' }, { timeout: 3000 });
    const links = within(
      within(inspector).getByRole('heading', { level: 3, name: 'Groups and tags' }).closest('section') ?? inspector,
    );
    await user.click(await links.findByRole('button', { name: 'Edit Groups and tags' }));
    await user.type(links.getByRole('combobox', { name: 'Groups' }), 'Pillar{Enter}');
    await user.keyboard('{Escape}');
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([{ name: 'Pillar', parent_id: null }]);
    const members = seen.writes.find((write) => write.route === `keyword-groups/${seen.created[0] ?? ''}/members`);
    expect(members?.body).toMatchObject({ tracked_keyword_ids: [expect.any(String) as string] });
  }, 20_000);

  it('shows a refused group create in the form and keeps it open', async () => {
    server.use(http.post(mswPath(GROUPS), ({ request }) => problem(request, 'duplicate')));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'Fresh');
    await user.click(await screen.findByRole('option', { name: 'Create group "Fresh"' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A group next to it already has this name.');
    expect(screen.getByRole('dialog', { name: 'Move 1 keyword' })).toBeInTheDocument();
  }, 15_000);
});
