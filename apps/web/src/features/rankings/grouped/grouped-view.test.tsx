import { screen, waitFor, within } from '@testing-library/react';
import { delay, getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { handlers } from '@/mocks/handlers';
import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mockId } from '@/mocks/mock-ids';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
  fynix,
  loadedGrid,
  rankingsAs,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const TRACKED = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords';
const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';
const LIST_BODY = z.object({
  data: z.array(
    z
      .object({
        keyword: z.object({ text: z.string() }).loose(),
        groups: z.array(z.object({ group_id: z.string() }).loose()).nullish(),
      })
      .loose(),
  ),
  page: z.record(z.string(), z.unknown()),
});

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** Rankings as the project's default view picks it: By group, since Fynix has groups. */
const byDefault = (role: 'editor' | 'viewer' = 'editor'): ReturnType<typeof rankingsAs> =>
  rankingsAs(role, fynix.project_id, { opensOnDefaultView: true });

/** The tree once its group rows have loaded. */
async function loadedTree(): Promise<HTMLElement> {
  const tree = await screen.findByRole('treegrid', { name: 'Tracked keywords' });
  await waitFor(() => expect(tree.querySelectorAll('tr[data-group-row]').length).toBeGreaterThan(0));
  return tree;
}

/** The group row whose name holds `label`. */
function groupRow(tree: HTMLElement, label: RegExp): HTMLElement {
  const row = [...tree.querySelectorAll<HTMLElement>('tr[data-group-row]')].find((candidate) =>
    label.test(within(candidate).getByRole('rowheader').textContent),
  );
  if (row === undefined) throw new Error(`No group row ${String(label)}`);
  return row;
}

/** The keyword rows the tree shows under the group of `label`, in order, by their keyword text. */
function keywordsUnder(tree: HTMLElement, label: RegExp): string[] {
  const rows = [...tree.querySelectorAll<HTMLElement>('tbody tr')];
  const start = rows.indexOf(groupRow(tree, label));
  const texts: string[] = [];
  for (const row of rows.slice(start + 1)) {
    if (row.hasAttribute('data-group-row')) break;
    const name = row.querySelector('[role="rowheader"] .truncate')?.textContent;
    if (name !== undefined && name !== null) texts.push(name);
  }
  return texts;
}

/** "seo audit" is also in Brand: a keyword listed under two groups. */
function seoAuditAlsoInBrand(): void {
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      const real = await getResponse([...handlers], request.clone());
      if (real === undefined) return undefined;
      const body = LIST_BODY.parse(await real.json());
      return HttpResponse.json({
        ...body,
        data: body.data.map((row) =>
          row.keyword.text === 'seo audit' && row.groups !== undefined && row.groups !== null
            ? {
                ...row,
                groups: [...row.groups, { group_id: MOCK_GROUP_IDS.brand, name: 'Brand', path: 'Brand' }],
              }
            : row,
        ),
      });
    }),
  );
}

describe('Keywords By group', () => {
  it('opens By group when the project has groups, and the URL view=flat shows the flat table', async () => {
    const { unmount } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    expect(screen.getByRole('radio', { name: 'By group' })).toBeChecked();
    expect(screen.queryByRole('grid', { name: 'Tracked keywords' })).toBeNull();
    expect(groupRow(tree, /SEO audits/)).toBeInTheDocument();
    unmount();

    renderWithProviders(byDefault(), { searchParams: '?view=flat' });
    const grid = await loadedGrid();
    expect(within(grid).getByRole('columnheader', { name: /^Rank/ })).toBeInTheDocument();
    expect(screen.queryByRole('treegrid')).toBeNull();
    expect(screen.getByRole('radio', { name: 'All keywords' })).toBeChecked();
  });

  it('lists each group with its count of distinct keywords, opens a group, and shows the rest of a long one', async () => {
    const { user } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    // Only the first group starts open
    const audits = groupRow(tree, /SEO audits/);
    expect(audits).toHaveAttribute('aria-expanded', 'true');
    expect(within(audits).getByRole('rowheader')).toHaveTextContent('13 keywords');
    // Content is tracked in two countries for one keyword: 11 rows, 10 keywords
    const content = groupRow(tree, /^Services \/ Content|Content/);
    expect(within(content).getByRole('rowheader')).toHaveTextContent('10 keywords');
    expect(content).toHaveAttribute('aria-expanded', 'false');
    expect(keywordsUnder(tree, /Content/)).toEqual([]);

    await user.click(within(content).getByRole('button', { name: /^Expand .*Content group, 10 keywords$/ }));
    await waitFor(() => expect(groupRow(tree, /Content/)).toHaveAttribute('aria-expanded', 'true'));
    expect(keywordsUnder(tree, /Content/)).toHaveLength(8);
    expect(keywordsUnder(tree, /Content/)).toContain('content strategy');

    // Audits shows 8 of its 13, then the rest on Show all
    expect(keywordsUnder(tree, /SEO audits/)).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    await waitFor(() => expect(keywordsUnder(tree, /SEO audits/)).toHaveLength(13));
  });

  it('shows the rest of a group from any cell of its Show all row, by click or Enter, and opens no inspector', async () => {
    /** A cell of the Show all row that holds no button: the Volume cell. */
    const emptyCell = (tree: HTMLElement): HTMLElement => {
      const button = screen.getByRole('button', { name: 'Show 5 more' });
      const row = button.closest('tr');
      const header = within(tree).getByRole('columnheader', { name: /^Volume/ });
      if (row === null || !(header instanceof HTMLTableCellElement)) throw new Error('No Show all row');
      const cell = row.cells[header.cellIndex];
      if (cell === undefined) throw new Error('No Volume cell');
      return cell;
    };
    const { user, unmount } = renderWithProviders(byDefault());
    let tree = await loadedTree();
    await user.click(emptyCell(tree));
    await waitFor(() => expect(keywordsUnder(tree, /SEO audits/)).toHaveLength(13));
    expect(screen.queryByRole('complementary')).toBeNull();
    unmount();

    renderWithProviders(byDefault());
    tree = await loadedTree();
    emptyCell(tree).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(keywordsUnder(tree, /SEO audits/)).toHaveLength(13));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('selects every keyword of a group with its checkbox, and a keyword in two groups under both', async () => {
    seoAuditAlsoInBrand();
    const { user } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    await user.click(within(groupRow(tree, /Brand/)).getByRole('button', { name: /^Expand Brand group/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Select .*SEO audits, 13 keywords$/ }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    // The keywords, the 5 behind Show all included, not the 8 rows shown
    expect(within(bar).getByText('13 selected')).toBeInTheDocument();
    // Under Brand at once, and under SEO audits once its rest shows
    expect(within(tree).getByRole('checkbox', { name: /^Select seo audit,/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    await waitFor(() => expect(within(tree).getAllByRole('checkbox', { name: /^Select seo audit,/ })).toHaveLength(2));
    const seoAudit = within(tree).getAllByRole('checkbox', { name: /^Select seo audit,/ });
    for (const box of seoAudit) expect(box).toBeChecked();
    // Brand holds one of the chosen keywords: partly selected
    expect(screen.getByRole('checkbox', { name: /^Select Brand, 5 keywords$/ })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
  });

  it('shows a group as partly selected when one of its keywords is ticked', async () => {
    const { user } = renderWithProviders(byDefault());
    await loadedTree();
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    await user.click(await screen.findByRole('checkbox', { name: /^Select seo audit,/ }));
    expect(screen.getByRole('checkbox', { name: /^Select .*SEO audits, 13 keywords$/ })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    expect(within(screen.getByRole('group', { name: /Bulk actions/ })).getByText('1 selected')).toBeInTheDocument();
  });

  it('deletes a group with the tracked keywords of both devices of every keyword', async () => {
    const seen: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'POST' || !request.url.endsWith('/bulk-delete')) return;
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.push(body));
    });
    const { user } = renderWithProviders(byDefault());
    await loadedTree();
    await user.click(screen.getByRole('checkbox', { name: /^Select Local, 10 keywords$/ }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    expect(within(bar).getByText('10 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: /^Delete \d+ keywords\?$/ });
    await user.click(within(confirm).getByRole('button', { name: /^Delete \d+ keywords$/ }));
    await waitFor(() => expect(seen).toHaveLength(1));
    const ids = z.object({ ids: z.array(z.string()) }).parse(seen[0]).ids;
    // Ten desktop keywords, and "seo agency berlin" on mobile too
    expect(ids).toHaveLength(11);
    expect(ids).toEqual(expect.arrayContaining([mockId('tracked', 1), mockId('tracked', 56)]));
  });

  it('leaves KD, Intent, SERP features, Trend and Tags out of By group, and keeps the flat columns when columns change there', async () => {
    const { user } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    const left = [/^KD/, /^Intent/, /^SERP features/, /^Trend/, /^Tags/];
    for (const name of left) expect(within(tree).queryByRole('columnheader', { name })).toBeNull();
    expect(within(tree).getByRole('columnheader', { name: /^Volume/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.queryByRole('checkbox', { name: 'KD' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'CPC (USD)' }));
    await waitFor(() => expect(within(tree).queryByRole('columnheader', { name: /^CPC/ })).toBeNull());
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('radio', { name: 'All keywords' }));
    const grid = await loadedGrid();
    for (const name of left) expect(within(grid).getByRole('columnheader', { name })).toBeInTheDocument();
    expect(within(grid).queryByRole('columnheader', { name: /^CPC/ })).toBeNull();
  });

  it('counts the groups again for the device shown', async () => {
    const { user } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    expect(within(groupRow(tree, /Local/)).getByRole('rowheader')).toHaveTextContent('10 keywords');
    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    await waitFor(() => expect(within(groupRow(tree, /Local/)).getByRole('rowheader')).toHaveTextContent('1 keyword'));
    expect(within(groupRow(tree, /SEO audits/)).getByRole('rowheader')).toHaveTextContent('1 keyword');
  });

  it('shows the flat table with By group disabled when the list is in server mode', async () => {
    answerTrackedAsMany({ total: 12_000 });
    renderWithProviders(byDefault(), { searchParams: '?view=groups' });
    await loadedGrid();
    expect(screen.queryByRole('treegrid')).toBeNull();
    expect(screen.getByRole('radio', { name: 'By group' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: 'All keywords' })).toBeChecked();
  });

  it('never shows the flat table before By group when the project has groups', async () => {
    // The groups answer comes after the keywords, so the default must wait for it
    server.use(
      http.get(mswPath(GROUPS), async ({ request }) => {
        await delay(300);
        return getResponse([...handlers], request.clone());
      }),
    );
    const flatFirst = { seen: false };
    const observer = new MutationObserver(() => {
      if (document.querySelector('table[role="grid"] [role="rowheader"]') !== null) flatFirst.seen = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    renderWithProviders(byDefault());
    await loadedTree();
    observer.disconnect();
    expect(flatFirst.seen).toBe(false);
  });

  it('opens on All keywords when the project has no groups', async () => {
    server.use(http.get(mswPath(GROUPS), () => HttpResponse.json({ data: [] })));
    renderWithProviders(byDefault());
    await loadedGrid();
    expect(screen.queryByRole('treegrid')).toBeNull();
    expect(screen.getByRole('radio', { name: 'All keywords' })).toBeChecked();
  });

  it('keeps the chosen keywords across a switch of view', async () => {
    const { user, rerender } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    const first = keywordsUnder(tree, /SEO audits/)[0] ?? '';
    await user.click(screen.getByRole('checkbox', { name: new RegExp(`^Select ${first},`) }));
    // A closed group still holds the choice, and the bulk bar stays with its count
    await user.click(screen.getByRole('button', { name: /^Collapse .*SEO audits group/ }));
    expect(within(screen.getByRole('group', { name: /Bulk actions/ })).getByText('1 selected')).toBeInTheDocument();
    // The bulk bar stands where the view switch is, so the view changes as a link or Back would change it
    rerender(rankingsAs('editor'));
    await loadedGrid();
    expect(within(screen.getByRole('group', { name: /Bulk actions/ })).getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: new RegExp(`^Select ${first},`) })).toBeChecked();
  });

  it('drops "every matching keyword" once the view changes, so an untick in By group counts', async () => {
    answerTrackedAsMany({ total: 118, pages: 2, failSecond: () => true });
    const seen: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'POST' || !request.url.endsWith('/bulk-delete')) return;
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.push(body));
    });
    const { user, rerender } = renderWithProviders(rankingsAs('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    await user.click(
      within(screen.getByRole('group', { name: /Bulk actions/ })).getByRole('button', {
        name: 'Select all 118 matching',
      }),
    );
    rerender(byDefault());
    const tree = await loadedTree();
    const first = keywordsUnder(tree, /SEO audits/)[0] ?? '';
    await user.click(screen.getByRole('checkbox', { name: new RegExp(`^Select ${first},`) }));
    rerender(rankingsAs('editor'));
    await loadedGrid();
    await user.click(
      within(screen.getByRole('group', { name: /Bulk actions/ })).getByRole('button', { name: 'Delete' }),
    );
    // The question counts the ticked rows, not the 118 that matched before the untick
    const confirm = await screen.findByRole('alertdialog', { name: /^Delete \d+ keywords\?$/ });
    expect(confirm).not.toHaveAccessibleName('Delete 118 keywords?');
    await user.click(within(confirm).getByRole('button', { name: /^Delete \d+ keywords$/ }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ ids: expect.any(Array) });
  });

  it('opens every group with a match while searching, and shows the search empty state when none is left', async () => {
    const { user } = renderWithProviders(byDefault());
    const tree = await loadedTree();
    expect(groupRow(tree, /Content/)).toHaveAttribute('aria-expanded', 'false');
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'audit');
    await waitFor(() => expect(tree.querySelectorAll('tr[data-group-row]')).toHaveLength(2));
    for (const row of tree.querySelectorAll('tr[data-group-row]')) expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(keywordsUnder(tree, /Content/)).toEqual(['content audit']);
    await user.clear(screen.getByRole('searchbox', { name: /Search/ }));
    await waitFor(() => expect(groupRow(tree, /Content/)).toHaveAttribute('aria-expanded', 'false'));
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'zzzz');
    expect(await screen.findByText('No keywords match “zzzz”')).toBeInTheDocument();
  });

  it('steps the inspector with J and K over keyword rows only', async () => {
    const { user } = renderWithProviders(byDefault('viewer'));
    const tree = await loadedTree();
    const [first, second] = keywordsUnder(tree, /SEO audits/);
    const cell = within(tree)
      .getAllByRole('rowheader')
      .find((header) => header.querySelector('.truncate')?.textContent === first);
    if (cell === undefined || first === undefined || second === undefined) {
      throw new Error('No keyword rows under SEO audits');
    }
    await user.click(cell);
    // Eight keyword rows are shown; the five group rows and the Show more row are not steps
    const inspector = await screen.findByRole('complementary', { name: first }, { timeout: 3000 });
    expect(within(inspector).getByText('1 of 8')).toBeInTheDocument();
    await user.keyboard('j');
    const next = await screen.findByRole('complementary', { name: second }, { timeout: 3000 });
    expect(within(next).getByText('2 of 8')).toBeInTheDocument();
    await user.keyboard('k');
    expect(await screen.findByRole('complementary', { name: first }, { timeout: 3000 })).toBeInTheDocument();
  });
});
