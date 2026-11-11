import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { handlers } from '@/mocks/handlers';
import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mockId } from '@/mocks/mock-ids';
import { mswPath, problem } from '@/mocks/respond';
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

type User = ReturnType<typeof renderWithProviders>['user'];
interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** Every write the screen sends, with its body. */
function captureWrites(): Sent[] {
  const sent: Sent[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET') return;
    const entry: Sent = { method: request.method, url: request.url, body: null };
    sent.push(entry);
    void request
      .clone()
      .text()
      .then((text) => {
        entry.body = text === '' ? null : (JSON.parse(text) as unknown);
      });
  });
  return sent;
}

/** Opens the menu of the Local group row and answers its items. */
async function localMenu(user: User): Promise<HTMLElement> {
  const tree = await screen.findByRole('treegrid', { name: 'Tracked keywords' });
  await user.click(await within(tree).findByRole('button', { name: 'Actions for Local, 10 keywords' }));
  return screen.findByRole('menu');
}

const byGroup = (role: 'editor' | 'viewer' = 'editor'): ReturnType<typeof rankingsAs> =>
  rankingsAs(role, fynix.project_id, { opensOnDefaultView: true });

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const TRACKED = `${P}/tracked-keywords`;
const GROUP = `${P}/keyword-groups/{group_id}`;
const ROW = z
  .object({
    tracked_keyword_id: z.string(),
    keyword: z.object({ keyword_id: z.string(), text: z.string() }).loose(),
    groups: z.array(z.object({ group_id: z.string() }).loose()).nullish(),
  })
  .loose();
type Row = z.infer<typeof ROW>;
const LIST = z.object({ data: z.array(ROW), page: z.object({ total: z.number().nullish() }).loose() });

/** The list's rows as the mock answers them, changed by `change`; the count of the project stays the mock's. */
function answerList(change: (rows: readonly Row[]) => Row[]): void {
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      if (new URL(request.url).searchParams.get('limit') === '1') return undefined;
      const real = await getResponse([...handlers], request.clone());
      if (real === undefined) return undefined;
      const body = LIST.parse(await real.json());
      const data = change(body.data);
      const added = data.length - body.data.length;
      return HttpResponse.json({ ...body, data, page: { ...body.page, total: (body.page.total ?? 0) + added } });
    }),
  );
}

describe('Group row actions', () => {
  it('lists Open group, Check now, Add keywords, Rename group and Delete group for an editor', async () => {
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Open group'),
      expect.stringContaining('Check now'),
      expect.stringContaining('Add keywords'),
      expect.stringContaining('Rename group'),
      expect.stringContaining('Delete group'),
    ]);
  });

  it('offers a viewer only what changes nothing', async () => {
    const { user } = renderWithProviders(byGroup('viewer'));
    const menu = await localMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: /Rename group/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Delete group/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Add keywords/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Open group/ })).toBeInTheDocument();
  });

  it('checks the group with the tracked keywords of both devices of every keyword', async () => {
    const sent = captureWrites();
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Check now/ }));
    await waitFor(() => expect(sent.find((entry) => entry.url.endsWith('/seo/check-now'))?.body).toBeTruthy());
    const body = z
      .object({ tracked_keyword_ids: z.array(z.string()) })
      .parse(sent.find((entry) => entry.url.endsWith('/seo/check-now'))?.body);
    // Ten desktop keywords, and "seo agency berlin" on mobile too
    expect(body.tracked_keyword_ids).toHaveLength(11);
    expect(body.tracked_keyword_ids).toEqual(expect.arrayContaining([mockId('tracked', 1), mockId('tracked', 56)]));
  });

  it('opens Add keywords with the group chosen', async () => {
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Add keywords/ }));
    const dialog = await screen.findByRole('dialog', { name: /Add keywords/ });
    expect(within(dialog).getByRole('button', { name: 'Remove Local' })).toBeInTheDocument();
  });

  it('renames the group with its new name', async () => {
    const sent = captureWrites();
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Rename group/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename Local' });
    const field = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(field);
    await user.type(field, 'Local SEO');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(sent.find((entry) => entry.method === 'PATCH')?.body).toEqual({ name: 'Local SEO' }));
    expect(sent.find((entry) => entry.method === 'PATCH')?.url).toContain(`/keyword-groups/${MOCK_GROUP_IDS.local}`);
    expect(await screen.findByText('Group renamed to Local SEO')).toBeInTheDocument();
    // Focus goes back to the table, not to the page
    const tree = screen.getByRole('treegrid', { name: 'Tracked keywords' });
    await waitFor(() => expect(tree.contains(document.activeElement)).toBe(true));
  });

  it('asks before it deletes the group, in the words of Manage groups', async () => {
    const sent = captureWrites();
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Delete group/ }));
    const question = await screen.findByRole('alertdialog', { name: 'Delete Local?' });
    expect(within(question).getByText('Keywords in it stay tracked and leave the group.')).toBeInTheDocument();
    expect(sent.filter((entry) => entry.method === 'DELETE')).toHaveLength(0);
    await user.click(within(question).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(sent.filter((entry) => entry.method === 'DELETE')).toHaveLength(1));
    expect(sent.find((entry) => entry.method === 'DELETE')?.url).toContain(`/keyword-groups/${MOCK_GROUP_IDS.local}`);
  });

  it('takes a group deleted meanwhile as deleted: the question closes, the lists are read again, no error', async () => {
    server.use(http.delete(mswPath(GROUP), ({ request }) => problem(request, 'not_found')));
    const reads: string[] = [];
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Delete group/ }));
    const question = await screen.findByRole('alertdialog', { name: 'Delete Local?' });
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET') reads.push(new URL(request.url).pathname);
    });
    await user.click(within(question).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByText('Local deleted')).toBeInTheDocument();
    expect(reads.some((path) => path.endsWith('/keyword-groups'))).toBe(true);
    expect(reads.some((path) => path.endsWith('/tracked-keywords'))).toBe(true);
  });

  it('offers only Open group and Check now for "Not grouped"', async () => {
    answerList((rows) => rows.map((row) => (row.keyword.text === 'seo audit' ? { ...row, groups: [] } : row)));
    const { user } = renderWithProviders(byGroup());
    const tree = await screen.findByRole('treegrid', { name: 'Tracked keywords' });
    await user.click(await within(tree).findByRole('button', { name: /^Actions for Not grouped,/ }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining('Open group'), expect.stringContaining('Check now')]);
  });

  it('leaves Check now out without runs:trigger, and keeps it for an analyst who cannot write', async () => {
    const { user, unmount } = renderWithProviders(
      rankingsAs('editor', fynix.project_id, { opensOnDefaultView: true, withoutPermissions: ['runs:trigger'] }),
    );
    let menu = await localMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: /Check now/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Rename group/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    unmount();

    const analyst = renderWithProviders(rankingsAs('analyst', fynix.project_id, { opensOnDefaultView: true }));
    menu = await localMenu(analyst.user);
    expect(within(menu).getByRole('menuitem', { name: /Check now/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Rename group/ })).toBeNull();
  });

  it('refuses Check now for a group of more than 100 tracked keywords, in the menu and in the drawer', async () => {
    answerList((rows) => [
      ...rows,
      ...rows
        .filter((row) => row.groups?.some((group) => group.group_id === MOCK_GROUP_IDS.local) === true)
        .flatMap((row) =>
          Array.from({ length: 10 }, (_, copy) => {
            const n = 2000 + rows.indexOf(row) * 10 + copy;
            return {
              ...row,
              tracked_keyword_id: mockId('tracked', n),
              keyword: { ...row.keyword, keyword_id: mockId('keyword', n), text: `${row.keyword.text} ${String(n)}` },
            };
          }),
        ),
    ]);
    const refusal = 'Check now takes up to 100 keywords at a time.';
    const { user } = renderWithProviders(byGroup());
    const tree = await screen.findByRole('treegrid', { name: 'Tracked keywords' });
    await user.click(await within(tree).findByRole('button', { name: /^Actions for Local,/ }));
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByRole('menuitem', { name: /Check now/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent(refusal);
    await user.click(within(menu).getByRole('menuitem', { name: /Open group/ }));
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    expect(await within(drawer).findByRole('button', { name: 'Check now' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('gives a viewer a drawer without Check now and without the group writes', async () => {
    const { user } = renderWithProviders(byGroup('viewer'), {
      searchParams: `?inspect=group:${MOCK_GROUP_IDS.local}`,
    });
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    await waitFor(() => expect(within(drawer).getByText('10 keywords')).toBeInTheDocument());
    expect(within(drawer).queryByRole('button', { name: 'Check now' })).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'More actions for Local' }));
    const menu = await screen.findByRole('menu');
    for (const name of [/Add keywords/, /Rename group/, /Delete group/]) {
      expect(within(menu).queryByRole('menuitem', { name })).toBeNull();
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('closes the drawer of a group once it is deleted, and gives focus back to the table', async () => {
    const { user } = renderWithProviders(byGroup(), { searchParams: `?inspect=group:${MOCK_GROUP_IDS.local}` });
    const drawer = await screen.findByRole('complementary', { name: 'Local' });
    await user.click(within(drawer).getByRole('button', { name: 'More actions for Local' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Delete group/ }));
    const question = await screen.findByRole('alertdialog', { name: 'Delete Local?' });
    await user.click(within(question).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull(), { timeout: 3000 });
    const tree = screen.getByRole('treegrid', { name: 'Tracked keywords' });
    await waitFor(() => expect(tree.contains(document.activeElement)).toBe(true), { timeout: 3000 });
  });
});
