import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
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

/** Opens Manage groups from the More actions menu, and answers the dialog. */
async function openManage(user: User): Promise<HTMLElement> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Manage groups' }));
  return screen.findByRole('dialog', { name: 'Manage groups' });
}

const groupItem = (name: string): HTMLElement => screen.getByRole('treeitem', { name });

describe('Manage groups', () => {
  it('shows the groups as a tree with the keywords in each', async () => {
    const { user, container } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    const tree = await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }));
    expect(await axe(container)).toHaveNoViolations();
    await user.keyboard('{Escape}');
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((item) => item.getAttribute('aria-level')),
    ).toEqual(['1', '1', '1']);
    expect(groupItem('Services')).toHaveAttribute('aria-expanded', 'false');
    // A count follows each name: the keywords in the group or under it
    expect(within(groupItem('Brand')).getByText(/^\d+ keywords?$|^No keywords$/)).toBeInTheDocument();
    expect(within(groupItem('Services')).getByText(/^\d+ keywords?$/)).toBeInTheDocument();
  }, 15_000);

  it('adds a group at the top level and selects it', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Pillar');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Group Pillar added')).toBeInTheDocument();
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([{ name: 'Pillar', parent_id: null }]);
    expect(await screen.findByRole('treeitem', { name: 'Pillar' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).toBeNull();
  }, 15_000);

  it('adds a subgroup under the selected group and opens the group to show it', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Local'));
    await user.click(within(dialog).getByRole('button', { name: 'Add subgroup to Local' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Maps');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('treeitem', { name: 'Maps' })).toHaveAttribute('aria-selected', 'true');
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([
      { name: 'Maps', parent_id: MOCK_GROUP_IDS.local },
    ]);
    expect(groupItem('Local')).toHaveAttribute('aria-expanded', 'true');
  }, 15_000);

  it('says when a rename takes the name of a group next to it, in any case', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Local'));
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Local');
    await user.clear(name);
    await user.type(name, 'brand');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText('A group next to it already has this name.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  }, 15_000);

  it('checks a name before it sends anything', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Blog/Guides');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText('A group name can\'t contain "/".')).toBeInTheDocument();
    expect(seen.writes).toEqual([]);
  }, 15_000);

  it('offers every group but the moved one and its subgroups, and Top level', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Services'));
    await user.click(within(dialog).getByRole('button', { name: 'Move to' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Move under' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['Top level', 'Brand', 'Local']);
  }, 15_000);

  it('moves a group under another, and shows it there', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Brand'));
    await user.click(within(dialog).getByRole('button', { name: 'Move to' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Move under' }));
    await user.click(await screen.findByRole('option', { name: 'Local' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Brand moved')).toBeInTheDocument();
    expect(seen.writes.at(-1)).toMatchObject({
      method: 'PATCH',
      route: `keyword-groups/${MOCK_GROUP_IDS.brand}`,
      body: { parent_id: MOCK_GROUP_IDS.local },
    });
    await waitFor(() => expect(groupItem('Brand')).toHaveAttribute('aria-level', '2'));
  }, 15_000);

  it('deletes a group with its subgroups after saying how many go', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Services'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Services?' });
    expect(
      within(confirm).getByText(
        'Its 2 subgroups are deleted too. Keywords in them stay tracked and leave these groups.',
      ),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Delete group and subgroups' }));
    expect(await screen.findByText('Services deleted')).toBeInTheDocument();
    expect(seen.writes.at(-1)).toMatchObject({ method: 'DELETE', route: `keyword-groups/${MOCK_GROUP_IDS.services}` });
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'Services' })).toBeNull());
  }, 15_000);

  it('closes an open form on Escape and leaves the dialog open', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Pil');
    await user.keyboard('{Escape}');
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Manage groups' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add group' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage groups' })).toBeNull());
  }, 15_000);

  it('offers no More actions to a viewer', async () => {
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
