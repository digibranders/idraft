import { act, screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { handlers } from '@/mocks/handlers';
import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';
const BULK_CREATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-create';
const LIST_BODY = z.object({ data: z.array(z.object({ group_id: z.string() }).loose()) });

/** Whether a request reads the flat list the pickers and the filter use, not the tree of Manage groups. */
const isFlat = (request: Request): boolean => new URL(request.url).searchParams.get('format') === 'flat';

/**
 * Holds back the flat list until `release` is called, so a form can be used before the list has loaded.
 * The tree of Manage groups is answered at once.
 */
function holdFlatList(): { release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get(mswPath(GROUPS), async ({ request }) => {
      if (isFlat(request)) await gate;
      return undefined;
    }),
  );
  return { release };
}

/**
 * The flat list as it stood before a teammate made `leftOut`, until the first group create is sent: a form
 * opened on an old list. After that the real list answers.
 */
function staleUntilCreate(leftOut: string): void {
  let created = false;
  server.use(
    http.post(mswPath(GROUPS), () => {
      created = true;
      return undefined;
    }),
    http.get(mswPath(GROUPS), async ({ request }) => {
      if (!isFlat(request) || created) return undefined;
      const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      const body = LIST_BODY.parse(await real?.json());
      return HttpResponse.json({ data: body.data.filter((group) => group.group_id !== leftOut) });
    }),
  );
}

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
    if (request.method !== 'POST' || !request.url.endsWith('/keyword-groups') || response.status !== 201) return;
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
  // A row's name goes on after the keyword: its device and location
  await user.click(screen.getByRole('checkbox', { name: new RegExp(`^Select ${keyword},`) }));
  const bar = screen.getByRole('group', { name: /Bulk actions/ });
  await user.click(within(bar).getByRole('button', { name: 'Move to group' }));
  return screen.findByRole('dialog', { name: 'Move 1 keyword' });
}

async function openAdd(user: User): Promise<HTMLElement> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'Add keywords' }));
  return screen.findByRole('dialog', { name: 'Add keywords' });
}

/** Opens the inspector of "seo agency" and its Groups and tags section for editing. */
async function openGroupsEditor(user: User): Promise<{ inspector: HTMLElement; links: ReturnType<typeof within> }> {
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
  return { inspector, links };
}

/** Types a keyword and one typed group into Add keywords. */
async function fillAdd(user: User, dialog: HTMLElement, group: string): Promise<void> {
  await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'topic cluster planner');
  await user.type(within(dialog).getByRole('combobox', { name: /^Groups/ }), `${group}{Enter}{Escape}`);
}

describe('Choosing groups in the forms', () => {
  it('creates a typed group, level by level, when bulk move is submitted', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'Blog/Guides');
    await user.click(await screen.findByRole('option', { name: 'Create group “Blog/Guides”' }));
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
    const { inspector, links } = await openGroupsEditor(user);
    await user.type(links.getByRole('combobox', { name: 'Groups' }), 'Pillar{Enter}');
    await user.keyboard('{Escape}');
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([{ name: 'Pillar', parent_id: null }]);
    const members = seen.writes.find((write) => write.route === `keyword-groups/${seen.created[0] ?? ''}/members`);
    expect(members?.body).toMatchObject({ tracked_keyword_ids: [expect.any(String)] });
  }, 20_000);

  it('shows a refused group create in the form and keeps it open', async () => {
    server.use(http.post(mswPath(GROUPS), ({ request }) => problem(request, 'duplicate')));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'Fresh');
    await user.click(await screen.findByRole('option', { name: 'Create group “Fresh”' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A group next to it already has this name.');
    expect(screen.getByRole('dialog', { name: 'Move 1 keyword' })).toBeInTheDocument();
  }, 15_000);

  it('shows a refused group create in Add keywords and keeps the form open', async () => {
    server.use(http.post(mswPath(GROUPS), ({ request }) => problem(request, 'duplicate')));
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await fillAdd(user, dialog, 'Fresh');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A group next to it already has this name.');
    expect(seen.writes.some((write) => write.route === 'tracked-keywords/bulk-create')).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Add keywords' })).toBeInTheDocument();
  }, 20_000);

  it('shows a refused group create in the inspector and keeps the edit open', async () => {
    server.use(http.post(mswPath(GROUPS), ({ request }) => problem(request, 'duplicate')));
    const { user } = renderWithProviders(as('editor'));
    const { inspector, links } = await openGroupsEditor(user);
    await user.type(links.getByRole('combobox', { name: 'Groups' }), 'Fresh{Enter}');
    await user.keyboard('{Escape}');
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    expect(await within(inspector).findByRole('alert')).toHaveTextContent('A group next to it already has this name.');
    expect(within(inspector).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  }, 20_000);

  it('does not make a group of text left in the field when Add keywords is saved', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'topic cluster planner');
    await user.type(within(dialog).getByRole('combobox', { name: /^Groups/ }), 'serv');
    // Leaving the field is what used to turn the text into a group
    await user.tab();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    expect(groupCreates(seen.writes)).toEqual([]);
    const add = seen.writes.find((write) => write.route === 'tracked-keywords/bulk-create');
    expect(add?.body).toMatchObject({ items: [{ keyword: 'topic cluster planner' }] });
    expect(JSON.stringify(add?.body)).not.toContain('group_ids');
  }, 20_000);

  it('does not make a group of text left in the field when the inspector is saved', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const { inspector, links } = await openGroupsEditor(user);
    await user.type(links.getByRole('combobox', { name: 'Groups' }), 'serv');
    // Leaving the field is what used to turn the text into a group
    await user.tab();
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(groupCreates(seen.writes)).toEqual([]);
    expect(seen.writes.filter((write) => write.route.endsWith('/members'))).toEqual([]);
  }, 20_000);

  it('files keywords in a group that exists when the list had not loaded as the form opened', async () => {
    const list = holdFlatList();
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await fillAdd(user, dialog, 'services');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    list.release();
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    expect(groupCreates(seen.writes)).toEqual([]);
    const add = seen.writes.find((write) => write.route === 'tracked-keywords/bulk-create');
    expect(add?.body).toMatchObject({ items: [{ group_ids: [MOCK_GROUP_IDS.services] }] });
  }, 20_000);

  it('says the groups are loading, or could not load, instead of that there are none', async () => {
    const list = holdFlatList();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await user.click(within(dialog).getByRole('combobox', { name: /^Groups/ }));
    expect(await screen.findByText('Loading groups')).toBeInTheDocument();
    expect(screen.queryByText(/No groups yet/)).toBeNull();
    list.release();
    await waitFor(() => expect(screen.queryByText('Loading groups')).toBeNull());
  }, 20_000);

  it('says the groups could not load instead of that there are none', async () => {
    server.use(
      http.get(mswPath(GROUPS), ({ request }) =>
        isFlat(request) ? HttpResponse.json({ title: 'Down' }, { status: 500 }) : undefined,
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await user.click(within(dialog).getByRole('combobox', { name: /^Groups/ }));
    expect(await screen.findByText('The groups could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/No groups yet/)).toBeNull();
  }, 20_000);

  it('uses the group a teammate made first when the create is refused as a duplicate', async () => {
    staleUntilCreate(MOCK_GROUP_IDS.brand);
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await fillAdd(user, dialog, 'brand');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    // One attempt, refused; the keyword is filed in the group that was there
    expect(groupCreates(seen.writes)).toHaveLength(1);
    const add = seen.writes.find((write) => write.route === 'tracked-keywords/bulk-create');
    expect(add?.body).toMatchObject({ items: [{ group_ids: [MOCK_GROUP_IDS.brand] }] });
  }, 20_000);

  it('uses the group a teammate made first when a move is saved, and says where it moved', async () => {
    staleUntilCreate(MOCK_GROUP_IDS.brand);
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'BRAND');
    await user.click(await screen.findByRole('option', { name: 'Create group “BRAND”' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await screen.findByText('1 keyword moved to Brand')).toBeInTheDocument();
    expect(seen.writes.at(-1)).toMatchObject({
      route: 'tracked-keywords/bulk-update',
      body: { add_group_ids: [MOCK_GROUP_IDS.brand] },
    });
  }, 20_000);

  it('says which group was made when a deeper level is refused, and reuses it on the next try', async () => {
    let posts = 0;
    server.use(
      http.post(mswPath(GROUPS), ({ request }) => {
        posts += 1;
        return posts === 2 ? problem(request, 'duplicate') : undefined;
      }),
    );
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await fillAdd(user, dialog, 'Blog/Guides');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A group next to it already has this name. Group Blog was created. Try again to file the keywords in it.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([
      { name: 'Blog', parent_id: null },
      { name: 'Guides', parent_id: seen.created[0] },
      { name: 'Guides', parent_id: seen.created[0] },
    ]);
  }, 25_000);

  it('says which group was made when the keywords are not added, and makes none twice on the next try', async () => {
    let writes = 0;
    server.use(
      http.post(mswPath(BULK_CREATE), ({ request }) => {
        writes += 1;
        return writes === 1 ? problem(request, 'rate_limited') : undefined;
      }),
    );
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openAdd(user);
    await fillAdd(user, dialog, 'Pillar');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Group Pillar was created. Try again to file the keywords in it.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    expect(groupCreates(seen.writes).map((write) => write.body)).toEqual([{ name: 'Pillar', parent_id: null }]);
    const adds = seen.writes.filter((write) => write.route === 'tracked-keywords/bulk-create');
    expect(adds).toHaveLength(2);
    for (const add of adds) {
      expect(add.body).toMatchObject({ items: [{ group_ids: [seen.created[0]] }] });
    }
  }, 25_000);

  it('finds a group typed with spaces around the slash, and offers no create row for it', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'services / seo audits');
    expect(await screen.findByRole('option', { name: 'Services/SEO audits' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Create group/ })).toBeNull();
  });

  it('names the group the keywords moved to as the list shows it, not as it was typed', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.type(within(dialog).getByRole('combobox', { name: 'Group' }), 'services / Fresh');
    await user.click(await screen.findByRole('option', { name: 'Create group “services/Fresh”' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await screen.findByText('1 keyword moved to Services/Fresh')).toBeInTheDocument();
  }, 20_000);

  it('explains what "No group" does in the list', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openMove(user, 'seo agency');
    await user.click(within(dialog).getByRole('combobox', { name: 'Group' }));
    const none = await screen.findByRole('option', { name: /^No group/ });
    expect(within(none).getByText('Takes the keywords out of every group')).toBeInTheDocument();
  });

  it('reads the groups again after the inspector saves, so their counts are current', async () => {
    let reads = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && request.url.includes('/keyword-groups') && isFlat(request)) reads += 1;
    });
    const { user } = renderWithProviders(as('editor'));
    const { inspector, links } = await openGroupsEditor(user);
    await user.type(links.getByRole('combobox', { name: 'Groups' }), 'Local');
    await user.click(await screen.findByRole('option', { name: 'Local' }));
    await user.keyboard('{Escape}');
    const before = reads;
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  }, 20_000);
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
    const name = within(dialog).getByRole('textbox', { name: 'Rename Local' });
    expect(name).toHaveValue('Local');
    await user.clear(name);
    await user.type(name, 'brand');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText('A group next to it already has this name.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Rename Local' })).toBeInTheDocument();
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
    expect(await within(dialog).findByText('A group name cannot contain “/”.')).toBeInTheDocument();
    expect(seen.writes).toEqual([]);
  }, 15_000);

  it('offers every group but the moved one and its subgroups, and Top level', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Services'));
    await user.click(within(dialog).getByRole('button', { name: 'Move to' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Move Services under' }));
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
    await user.click(within(dialog).getByRole('combobox', { name: 'Move Brand under' }));
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

  it('keeps the actions of a group focusable before one is chosen, each with the reason it waits', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    for (const name of ['Add subgroup', 'Rename', 'Move to', 'Delete']) {
      const button = within(dialog).getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('Select a group first');
      act(() => button.focus());
      expect(button).toHaveFocus();
      // A press does nothing
      await user.click(button);
    }
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(dialog).queryByRole('form')).toBeNull();
    await user.click(groupItem('Brand'));
    expect(within(dialog).getByRole('button', { name: 'Rename' })).not.toHaveAttribute('aria-disabled', 'true');
  }, 15_000);

  it('draws Delete as a destructive action, like the other deletes', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain('negative');
  }, 15_000);

  it('returns focus to Delete when its question is cancelled', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Brand'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Brand?' });
    // The question stacked over Manage groups passes the checks, with the dialog behind it
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveFocus();
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

  it('gives focus back to the More actions button when the dialog closes', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) ?? dialog);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage groups' })).toBeNull());
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus();
  }, 15_000);

  it('says one subgroup, not several, when a group with a single subgroup is deleted', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Local'));
    await user.click(within(dialog).getByRole('button', { name: 'Add subgroup to Local' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Maps{Enter}');
    expect(await screen.findByRole('treeitem', { name: 'Maps' })).toBeInTheDocument();
    await user.click(groupItem('Local'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Local?' });
    expect(
      within(confirm).getByText('Its subgroup is deleted too. Keywords in them stay tracked and leave these groups.'),
    ).toBeInTheDocument();
  }, 20_000);

  it('closes the open list of the Move under select on Escape, and leaves the form and the dialog', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Brand'));
    await user.click(within(dialog).getByRole('button', { name: 'Move to' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Move Brand under' }));
    expect(await screen.findAllByRole('option')).not.toHaveLength(0);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Manage groups' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Move Brand under' })).toBeInTheDocument();
  }, 15_000);

  it('names the group a rename or a move form is for', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Services'));
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(within(dialog).getByRole('form', { name: 'Rename Services' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Rename Services' })).toHaveValue('Services');
    await user.click(within(dialog).getByRole('button', { name: 'Move to' }));
    expect(within(dialog).getByRole('form', { name: 'Move Services under' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Move Services under' })).toBeInTheDocument();
  }, 15_000);

  it('closes a rename form when another group is selected, so it never points at the wrong one', async () => {
    const seen = recorder();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Services'));
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Rename Services' }), 'X');
    await user.click(groupItem('Local'));
    expect(within(dialog).queryByRole('textbox', { name: /^Rename/ })).toBeNull();
    expect(groupItem('Local')).toHaveAttribute('aria-selected', 'true');
    expect(seen.writes).toEqual([]);
  }, 15_000);

  it('closes the form of a group when that group is deleted', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    await user.click(groupItem('Brand'));
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(within(dialog).getByRole('textbox', { name: 'Rename Brand' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Brand?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete group' }));
    expect(await screen.findByText('Brand deleted')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /^Rename/ })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'Brand' })).toBeNull());
  }, 20_000);

  it('asks before closing the dialog while a form holds typed text, and not when it holds none', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    const close = (): HTMLElement => within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) ?? dialog;
    // An open form with nothing typed closes the dialog at once
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }));
    await user.click(close());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage groups' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Manage groups' }));
    const reopened = await screen.findByRole('dialog', { name: 'Manage groups' });
    await within(reopened).findByRole('tree', { name: 'Keyword groups' });
    await user.click(within(reopened).getByRole('button', { name: 'Add group' }));
    await user.type(within(reopened).getByRole('textbox', { name: 'Name' }), 'Pil');
    await user.click(within(reopened).getAllByRole('button', { name: 'Close' }).at(-1) ?? reopened);
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(within(reopened).getByRole('textbox', { name: 'Name' })).toHaveValue('Pil');
    await user.click(within(reopened).getAllByRole('button', { name: 'Close' }).at(-1) ?? reopened);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage groups' })).toBeNull());
  }, 25_000);

  it('keeps showing the tree when a later read of the groups fails', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    server.use(http.get(mswPath(GROUPS), () => HttpResponse.json({ title: 'Down' }, { status: 500 })));
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Pillar{Enter}');
    expect(await screen.findByText('Group Pillar added')).toBeInTheDocument();
    expect(within(dialog).queryByText('The groups could not be loaded.')).toBeNull();
    expect(within(dialog).getByRole('tree', { name: 'Keyword groups' })).toBeInTheDocument();
  }, 20_000);

  it('drops a deleted group from the filter in the address', async () => {
    const urls: URLSearchParams[] = [];
    const { user } = renderWithProviders(as('editor'), {
      searchParams: `grp=${MOCK_GROUP_IDS.brand}`,
      onUrlUpdate: ({ searchParams }) => urls.push(new URLSearchParams(searchParams)),
    });
    const dialog = await openManage(user);
    await within(dialog).findByRole('tree', { name: 'Keyword groups' });
    // A group that exists stays in the filter
    expect(urls.some((url) => !url.has('grp'))).toBe(false);
    await user.click(groupItem('Brand'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Delete Brand?' })).getByRole('button', {
        name: 'Delete group',
      }),
    );
    expect(await screen.findByText('Brand deleted')).toBeInTheDocument();
    await waitFor(() => expect(urls.at(-1)?.has('grp')).toBe(false));
  }, 25_000);

  it('offers no More actions to a viewer', async () => {
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
