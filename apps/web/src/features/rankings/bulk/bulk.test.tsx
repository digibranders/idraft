import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api } from '@/lib/api/client';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  fynix,
  keywordsIn,
  loadedGrid,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const BULK_UPDATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-update';
const BULK_ARCHIVE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-archive';

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** The JSON bodies of the writes to tracked keywords, in order, with their method and path's last part. */
function writes(): { method: string; route: string; body: unknown }[] {
  const seen: { method: string; route: string; body: unknown }[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET' || !request.url.includes('/tracked-keywords')) return;
    const route = new URL(request.url).pathname.split('/').at(-1) ?? '';
    void request
      .clone()
      .text()
      .then((text) => seen.push({ method: request.method, route, body: text === '' ? null : JSON.parse(text) }));
  });
  return seen;
}

/** The query strings the screen wrote, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const changes: string[] = [];
  return {
    onUrlUpdate: (event) => changes.push(event.queryString),
    latest: () => new URLSearchParams(changes.at(-1) ?? ''),
  };
}

const TRACKED = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords';
const UPDATE_BODY = z.object({
  ids: z.array(z.string()).optional(),
  add_group_ids: z.array(z.string()).optional(),
  remove_group_ids: z.array(z.string()).optional(),
});

/** The project's keywords with their groups, as the API lists them. */
async function keywordsWithGroups(): Promise<{ text: string; groups: string[] }[]> {
  const answer = await api.GET(TRACKED, {
    params: {
      path: { workspace_id: MOCK_WORKSPACE.workspace_id, project_id: fynix.project_id },
      query: { include: ['groups'], limit: 200, 'filter[is_active]': true },
    },
  });
  return (answer.data?.data ?? []).map((row) => ({
    text: row.keyword.text,
    groups: (row.groups ?? []).map((group) => group.group_id),
  }));
}

/** The ids of the groups a keyword is in. */
const groupsOf = async (text: string): Promise<string[]> =>
  (await keywordsWithGroups()).find((row) => row.text === text)?.groups ?? [];

/** The text of an active keyword that is in no group. */
const ungroupedKeyword = async (): Promise<string | undefined> =>
  (await keywordsWithGroups()).find((row) => row.groups.length === 0)?.text;

type User = ReturnType<typeof renderWithProviders>['user'];

/** Ticks the rows of these keywords and answers the bulk bar. */
async function choose(user: User, ...keywords: string[]): Promise<HTMLElement> {
  await loadedGrid();
  // A row's name goes on after the keyword: its device and location
  for (const keyword of keywords) {
    await user.click(screen.getByRole('checkbox', { name: new RegExp(`^Select ${keyword},`) }));
  }
  return screen.getByRole('group', { name: /Bulk actions/ });
}

describe('Bulk actions', () => {
  it('sets the priority of the chosen keywords, by their ids', async () => {
    const seen = writes();
    const { user, container } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency', 'backlink checker');
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priority for 2 keywords' });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: '2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Set for 2 keywords' }));
    expect(await screen.findByText('Priority 2 set for 2 keywords')).toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({ route: 'bulk-update', body: { set: { priority: 2 } } });
    expect((seen.at(-1)?.body as { ids: string[] }).ids).toHaveLength(2);
    // The selection is spent
    await waitFor(() => expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull());
  }, 15_000);

  it('moves the chosen keywords into one group and out of the others', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Move to group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 1 keyword' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: 'Brand' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await screen.findByText('1 keyword moved to Brand')).toBeInTheDocument();
    const body = seen.at(-1)?.body as { add_group_ids: string[]; remove_group_ids?: string[] };
    expect(body.add_group_ids).toEqual([MOCK_GROUP_IDS.brand]);
    // Only the groups the keyword is in are named: the API counts every name for every keyword chosen
    const held = await groupsOf('seo agency');
    expect(held.length).toBeGreaterThan(0);
    // The project has more groups than the keyword is in: the others are not named
    expect(held.length).toBeLessThan(4);
    expect([...(body.remove_group_ids ?? [])].sort()).toEqual(held.filter((id) => id !== MOCK_GROUP_IDS.brand).sort());
    expect(body.remove_group_ids ?? []).not.toContain(MOCK_GROUP_IDS.brand);
  });

  describe('moving many keywords to a group', () => {
    const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';
    const GROUP_LIST = z.object({ data: z.array(z.record(z.string(), z.unknown())) });

    /** The project's groups made 50, as a project with a deep tree has them. */
    function fiftyGroups(): void {
      server.use(
        http.get(mswPath(GROUPS), async ({ request }) => {
          if (new URL(request.url).searchParams.get('format') !== 'flat') return undefined;
          const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
          const { data } = GROUP_LIST.parse(await real?.json());
          const [template] = data;
          if (template === undefined) throw new Error('The project has no group to copy');
          const more = Array.from({ length: 50 - data.length }, (_, at) => ({
            ...template,
            group_id: `0192d1a8-9999-7a10-8e07-${String(at).padStart(12, '0')}`,
            name: `Group ${String(at)}`,
            path: `Group ${String(at)}`,
          }));
          return HttpResponse.json({ data: [...data, ...more] });
        }),
      );
    }

    /** Answers every bulk update with what it matched, and records the bodies. */
    function recordUpdates(): { ids: number; removing: number; adding: number }[] {
      const seen: { ids: number; removing: number; adding: number }[] = [];
      server.use(
        http.post(mswPath(BULK_UPDATE), async ({ request }) => {
          const body = UPDATE_BODY.parse(await request.json());
          seen.push({
            ids: body.ids?.length ?? 0,
            removing: body.remove_group_ids?.length ?? 0,
            adding: body.add_group_ids?.length ?? 0,
          });
          return HttpResponse.json({
            data: { matched: body.ids?.length ?? 0, updated: 0, config_versions_created: 0 },
          });
        }),
      );
      return seen;
    }

    async function moveAll(user: User, group: string): Promise<void> {
      await loadedGrid();
      await waitFor(() => expect(screen.queryByText(/^Loaded /)).toBeNull(), { timeout: 20_000 });
      await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
      const bar = screen.getByRole('group', { name: /Bulk actions/ });
      await user.click(within(bar).getByRole('button', { name: 'Move to group' }));
      const dialog = await screen.findByRole('dialog', { name: /^Move \d/ });
      await user.click(within(dialog).getByRole('combobox', { name: 'Group' }));
      await user.click(await screen.findByRole('option', { name: group }));
      await user.click(within(dialog).getByRole('button', { name: /^Move \d/ }));
    }

    it('sends batches of at most 4,000 keywords when 50 groups are named and the groups of the rows are not known', async () => {
      answerTrackedAsMany({ total: 5_000, pages: 25, rowsPerPage: 200, withoutGroups: true });
      fiftyGroups();
      const updates = recordUpdates();
      const { user } = renderWithProviders(as('editor'));
      await moveAll(user, 'Brand');
      await waitFor(() => expect(updates).toHaveLength(2), { timeout: 10_000 });
      // 50 names (the group moved to and the 49 to leave) for every keyword: 4,000 keywords make 200,000 links
      expect(updates).toEqual([
        { ids: 4_000, removing: 49, adding: 1 },
        { ids: 1_000, removing: 49, adding: 1 },
      ]);
    }, 40_000);

    it('names only the groups the chosen keywords are in, so 5,000 keywords go in one request', async () => {
      answerTrackedAsMany({ total: 5_000, pages: 25, rowsPerPage: 200 });
      fiftyGroups();
      const updates = recordUpdates();
      const { user } = renderWithProviders(as('editor'));
      await moveAll(user, 'Brand');
      await waitFor(() => expect(updates).toHaveLength(1), { timeout: 10_000 });
      expect(updates[0]?.ids).toBe(5_000);
      expect(updates[0]?.adding).toBe(1);
      // The fixture keywords are in a handful of groups: those are the ones named, not all 49 others
      expect(updates[0]?.removing).toBeLessThanOrEqual(4);
    }, 40_000);
  });

  it('sends no request for a move out of groups the chosen keywords are not in', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    const ungrouped = (await ungroupedKeyword()) ?? 'no keyword';
    const bar = await choose(user, ungrouped);
    await user.click(within(bar).getByRole('button', { name: 'Move to group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 1 keyword' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: /^No group/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await screen.findByText('1 keyword taken out of their groups')).toBeInTheDocument();
    expect(seen.filter((write) => write.route === 'bulk-update')).toEqual([]);
  });

  it('takes tags off, and checks a target URL before it sets one', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    let bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Add tags' }));
    let dialog = await screen.findByRole('dialog', { name: 'Tags for 1 keyword' });
    await user.click(within(dialog).getByRole('radio', { name: 'Remove tags' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove from 1 keyword' }));
    expect(await within(dialog).findByText('Choose at least one tag')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('combobox', { name: 'Tags' }), 'SEO');
    await user.click(await screen.findByRole('option', { name: 'Topics: SEO' }));
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Remove from 1 keyword' }));
    expect(await screen.findByText('Tags removed from 1 keyword')).toBeInTheDocument();
    expect(seen.at(-1)?.body).toMatchObject({ remove_term_ids: [expect.any(String) as string] });

    bar = await choose(user, 'backlink checker');
    await user.click(within(bar).getByRole('button', { name: 'Set target URL' }));
    dialog = await screen.findByRole('dialog', { name: 'Target URL for 1 keyword' });
    const url = within(dialog).getByRole('textbox', { name: /Target URL/ });
    await user.type(url, 'fynix.io/backlinks');
    await user.click(within(dialog).getByRole('button', { name: 'Set for 1 keyword' }));
    expect(await within(dialog).findByText(/starts with http/)).toBeInTheDocument();
    await user.clear(url);
    await user.type(url, 'https://fynix.io/backlinks');
    await user.click(within(dialog).getByRole('button', { name: 'Set for 1 keyword' }));
    expect(await screen.findByText('Target URL set for 1 keyword')).toBeInTheDocument();
    expect(screen.getByText('1 configuration version started')).toBeInTheDocument();
  }, 15_000);

  it('archives at once with an undo, and deletes after asking with the count', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    let bar = await choose(user, 'seo agency', 'backlink checker');
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('2 keywords archived')).toBeInTheDocument();
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).not.toContain('seo agency'));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('2 keywords unarchived')).toBeInTheDocument();
    const archives = seen.filter((write) => write.route === 'bulk-archive').map((write) => write.body);
    expect(archives).toMatchObject([{ archive: true }, { archive: false }]);
    await waitFor(() => expect(keywordsIn(grid)).toContain('seo agency'));

    bar = await choose(user, 'seo agency', 'backlink checker');
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete 2 keywords?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete 2 keywords' }));
    expect(await screen.findByText('2 keywords deleted')).toBeInTheDocument();
    const deletes = seen.filter((write) => write.route === 'bulk-delete');
    expect(deletes).toHaveLength(1);
    expect((deletes[0]?.body as { ids: string[] }).ids).toHaveLength(2);
    await waitFor(() => expect(keywordsIn(grid)).not.toContain('backlink checker'));
  }, 20_000);

  it('sends the filters for every match, and asks before archiving or deleting them', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    let bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const deleting = await screen.findByRole('alertdialog', { name: 'Delete 12,000 keywords?' });
    await user.click(within(deleting).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Archive 12,000 keywords?' });
    await user.click(within(confirm).getByRole('button', { name: 'Archive 12,000 keywords' }));
    await waitFor(() => expect(seen.some((write) => write.route === 'bulk-archive')).toBe(true));
    expect(seen.find((write) => write.route === 'bulk-archive')?.body).toEqual({
      filter: { is_active: true },
      archive: true,
    });
    // By filter, the archive cannot be undone by the same filter: no Undo
    expect(await screen.findByText(/archived$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  }, 20_000);

  describe('when the keywords that match change before the action is sent', () => {
    const CHANGED = 'The keywords that match changed since you chose them: 11,950 now. Choose again.';

    /** Answers the count the screen reads just before it acts (the list's filters, one row) with `total()`. */
    function answerRecount(total: () => number): { reads: () => number } {
      let reads = 0;
      server.use(
        http.get(mswPath(TRACKED), ({ request }) => {
          const url = new URL(request.url);
          const filtered = [...url.searchParams.keys()].some((key) => key.startsWith('filter['));
          const isStrip = url.searchParams.has('filter[rank_is_null]') || url.searchParams.has('filter[rank_lte]');
          if (url.searchParams.get('limit') !== '1' || !filtered || isStrip) return undefined;
          reads += 1;
          return HttpResponse.json({
            data: [],
            page: { limit: 1, next_cursor: null, has_more: false, total: total() },
          });
        }),
      );
      return { reads: () => reads };
    }

    async function chooseAllMatching(user: User, total: string): Promise<HTMLElement> {
      await loadedGrid();
      await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
      const bar = screen.getByRole('group', { name: /Bulk actions/ });
      await user.click(within(bar).getByRole('button', { name: `Select all ${total} matching` }));
      return bar;
    }

    it('stops a delete of every match, says how many match now, and reads the list again instead of acting', async () => {
      const listReads = answerTrackedAsMany({ total: 12_000 });
      let matching = 12_000;
      const recount = answerRecount(() => matching);
      const seen = writes();
      const { user } = renderWithProviders(as('editor'));
      const bar = await chooseAllMatching(user, '12,000');
      await user.click(within(bar).getByRole('button', { name: 'Delete' }));
      const deleting = await screen.findByRole('alertdialog', { name: 'Delete 12,000 keywords?' });
      const readBefore = listReads.length;
      // A daily rank check moved 50 keywords out of the filter after the person chose them
      matching = 11_950;
      await user.click(within(deleting).getByRole('button', { name: 'Delete 12,000 keywords' }));
      expect(await within(deleting).findByText(CHANGED)).toBeInTheDocument();
      expect(recount.reads()).toBe(1);
      expect(seen.filter((write) => write.route === 'bulk-delete')).toHaveLength(0);
      await waitFor(() => expect(listReads.length).toBeGreaterThan(readBefore));
    }, 20_000);

    it('stops an archive of every match above 100 keywords the same way', async () => {
      answerTrackedAsMany({ total: 12_000 });
      let matching = 12_000;
      answerRecount(() => matching);
      const seen = writes();
      const { user } = renderWithProviders(as('editor'));
      const bar = await chooseAllMatching(user, '12,000');
      await user.click(within(bar).getByRole('button', { name: 'Archive' }));
      const asking = await screen.findByRole('alertdialog', { name: 'Archive 12,000 keywords?' });
      matching = 11_950;
      await user.click(within(asking).getByRole('button', { name: 'Archive 12,000 keywords' }));
      expect(await within(asking).findByText(CHANGED)).toBeInTheDocument();
      expect(seen.filter((write) => write.route === 'bulk-archive')).toHaveLength(0);
    }, 20_000);

    it('stops an archive that runs at once, without a question, and says so in a notice', async () => {
      // 60 match, 59 are on screen: "Select all 60 matching" is offered, and 60 is below the question's 100
      answerTrackedAsMany({ total: 60, pages: 1 });
      let matching = 60;
      answerRecount(() => matching);
      const seen = writes();
      const { user } = renderWithProviders(as('editor'));
      const bar = await chooseAllMatching(user, '60');
      matching = 55;
      await user.click(within(bar).getByRole('button', { name: 'Archive' }));
      expect(
        (await screen.findAllByText('The keywords that match changed since you chose them: 55 now. Choose again.'))
          .length,
      ).toBeGreaterThan(0);
      expect(seen.filter((write) => write.route === 'bulk-archive')).toHaveLength(0);
    }, 20_000);

    it('stops a change by filter too, and acts when the count is the one that was confirmed', async () => {
      answerTrackedAsMany({ total: 12_000 });
      let matching = 11_950;
      answerRecount(() => matching);
      const seen = writes();
      const { user } = renderWithProviders(as('editor'));
      const bar = await chooseAllMatching(user, '12,000');
      await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
      const dialog = await screen.findByRole('dialog', { name: 'Priority for 12,000 keywords' });
      await user.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
      await user.click(await screen.findByRole('option', { name: '2' }));
      await user.click(within(dialog).getByRole('button', { name: 'Set for 12,000 keywords' }));
      expect(await within(dialog).findByText(CHANGED)).toBeInTheDocument();
      expect(seen.filter((write) => write.route === 'bulk-update')).toHaveLength(0);
      // The count is what was confirmed again: the same press now goes through
      matching = 12_000;
      await user.click(within(dialog).getByRole('button', { name: 'Set for 12,000 keywords' }));
      await waitFor(() => expect(seen.some((write) => write.route === 'bulk-update')).toBe(true));
    }, 20_000);

    it('does nothing when the count cannot be read: nothing was deleted, and it says so', async () => {
      answerTrackedAsMany({ total: 12_000 });
      server.use(
        http.get(mswPath(TRACKED), ({ request }) => {
          const url = new URL(request.url);
          const filtered = [...url.searchParams.keys()].some((key) => key.startsWith('filter['));
          const isStrip = url.searchParams.has('filter[rank_is_null]') || url.searchParams.has('filter[rank_lte]');
          return url.searchParams.get('limit') === '1' && filtered && !isStrip
            ? problem(request, 'not_found')
            : undefined;
        }),
      );
      const seen = writes();
      const { user } = renderWithProviders(as('editor'));
      const bar = await chooseAllMatching(user, '12,000');
      await user.click(within(bar).getByRole('button', { name: 'Delete' }));
      const deleting = await screen.findByRole('alertdialog', { name: 'Delete 12,000 keywords?' });
      await user.click(within(deleting).getByRole('button', { name: 'Delete 12,000 keywords' }));
      expect(await within(deleting).findByText('The change was not made. Try again.')).toBeInTheDocument();
      expect(seen.filter((write) => write.route === 'bulk-delete')).toHaveLength(0);
    }, 20_000);

    it('does not count again for chosen keywords: their ids are what is sent', async () => {
      const recount = answerRecount(() => 1);
      const seen = writes();
      const { user } = renderWithProviders(as('editor'));
      const bar = await choose(user, 'seo agency', 'backlink checker');
      await user.click(within(bar).getByRole('button', { name: 'Delete' }));
      const deleting = await screen.findByRole('alertdialog');
      await user.click(within(deleting).getByRole('button', { name: /^Delete/ }));
      await waitFor(() => expect(seen.some((write) => write.route === 'bulk-delete')).toBe(true));
      expect(recount.reads()).toBe(0);
    }, 20_000);
  });

  it('unarchives in the Archived view, and says how many fit when the plan is full', async () => {
    server.use(
      http.post(mswPath(BULK_ARCHIVE), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 60, used: 59, requested: 2 }),
      ),
    );
    const { user } = renderWithProviders(as('editor'), { searchParams: '?archived=true' });
    const bar = await choose(user, 'seo meme', 'seo newsletter');
    await user.click(within(bar).getByRole('button', { name: 'Unarchive' }));
    // The error toast and its announcement say it
    expect(
      await screen.findAllByText('Your plan has room for 1 more active keyword (59 of 60 used); this adds 2.'),
    ).not.toHaveLength(0);
  });

  it('asks before unarchiving more than 100 keywords, with the count, and sends nothing when it is cancelled', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const seen = writes();
    const { user } = renderWithProviders(as('editor'), { searchParams: '?archived=true' });
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Unarchive' }));
    const asking = await screen.findByRole('alertdialog', { name: 'Unarchive 12,000 keywords?' });
    expect(asking).toHaveAccessibleDescription(/count against the plan/);
    await user.click(within(asking).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(seen.filter((write) => write.route === 'bulk-archive')).toHaveLength(0);
    await user.click(
      within(screen.getByRole('group', { name: /Bulk actions/ })).getByRole('button', { name: 'Unarchive' }),
    );
    const confirm = await screen.findByRole('alertdialog', { name: 'Unarchive 12,000 keywords?' });
    await user.click(within(confirm).getByRole('button', { name: 'Unarchive 12,000 keywords' }));
    await waitFor(() => expect(seen.some((write) => write.route === 'bulk-archive')).toBe(true));
    expect(seen.find((write) => write.route === 'bulk-archive')?.body).toMatchObject({ archive: false });
    expect(await screen.findByText(/unarchived$/)).toBeInTheDocument();
  }, 20_000);

  it('passes the accessibility checks in the tags and target URL dialogs and in the archive and delete questions', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    // Each opens over the table and is checked with the page behind it, then closed with its own Cancel
    const closeWith = async (dialog: HTMLElement): Promise<void> => {
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
    };
    const barNow = (): HTMLElement => screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(barNow()).getByRole('button', { name: 'Add tags' }));
    let dialog = await screen.findByRole('dialog', { name: 'Tags for 12,000 keywords' });
    expect(await axe(document.body)).toHaveNoViolations();
    await closeWith(dialog);
    await user.click(within(barNow()).getByRole('button', { name: 'Set target URL' }));
    dialog = await screen.findByRole('dialog', { name: 'Target URL for 12,000 keywords' });
    expect(await axe(document.body)).toHaveNoViolations();
    await closeWith(dialog);
    await user.click(within(barNow()).getByRole('button', { name: 'Archive' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Archive 12,000 keywords?' });
    expect(await axe(document.body)).toHaveNoViolations();
    await closeWith(dialog);
    await user.click(within(barNow()).getByRole('button', { name: 'Delete' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Delete 12,000 keywords?' });
    expect(await axe(document.body)).toHaveNoViolations();
    await closeWith(dialog);
  }, 30_000);

  it('draws Archive in the bar neutral and Delete destructive, both last', async () => {
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    const names = within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names.slice(-3)).toEqual(['Archive', 'Delete', '']);
    expect(within(bar).getByRole('button', { name: 'Archive' }).className).not.toContain('negative');
    expect(within(bar).getByRole('button', { name: 'Delete' }).className).toContain('negative');
  });

  it('says when the filters match too many keywords for one change', async () => {
    answerTrackedAsMany({ total: 25_000 });
    server.use(
      http.post(mswPath(BULK_UPDATE), ({ request }) => problem(request, 'too_many_subjects', { limit: 20_000 })),
    );
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 25,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priority for 25,000 keywords' });
    await user.click(within(dialog).getByRole('button', { name: 'Set for 25,000 keywords' }));
    expect(
      await within(dialog).findByText(
        'The filters match more than 20,000 keywords. Narrow them, or choose the keywords.',
      ),
    ).toBeInTheDocument();
  }, 15_000);

  it('drops every match when a row is unticked or the selection cleared, and never brings a selection back', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const seen = writes();
    const url = urlWrites();
    const { user } = renderWithProviders(as('editor'), { onUrlUpdate: url.onUrlUpdate });
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    let bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    // Unticking one row means the chosen rows, not every match, and never the one unticked
    await user.click(screen.getAllByRole('checkbox', { name: 'Select seo agency, desktop, United States' })[0] ?? bar);
    bar = screen.getByRole('group', { name: /Bulk actions/ });
    expect(within(bar).queryByText(/All 12,000 matching selected/)).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /^Delete/ }));
    await waitFor(() => expect(seen.some((write) => write.route === 'bulk-delete')).toBe(true));
    expect(seen.find((write) => write.route === 'bulk-delete')?.body).toHaveProperty('ids');
    // Clear with every match chosen leaves nothing chosen
    await user.click(await screen.findByRole('checkbox', { name: /^Select all/ }));
    bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull());
  }, 20_000);

  it('does not bring a selection back when the filters return to what they were', async () => {
    const { user } = renderWithProviders(as('editor'));
    await choose(user, 'seo agency');
    await user.click(screen.getByRole('radio', { name: 'Archived' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull());
    await user.click(screen.getByRole('radio', { name: 'Active' }));
    await loadedGrid();
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select seo agency, desktop, United States' })).not.toBeChecked();
  });

  it('returns focus to the grid once a dialog made its change', async () => {
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priority for 1 keyword' });
    await user.click(within(dialog).getByRole('button', { name: 'Set for 1 keyword' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Priority for 1 keyword' })).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest('[role="grid"]')).not.toBeNull());
  });

  it('offers no choosing to a member who may not change keywords', async () => {
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('checkbox', { name: 'Select seo agency, desktop, United States' })).toBeNull();
  });
});
