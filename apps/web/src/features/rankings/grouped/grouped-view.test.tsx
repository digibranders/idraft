import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
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

  it('archives a group with the tracked keywords of both devices of every keyword', async () => {
    const seen: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'POST' || !request.url.endsWith('/bulk-archive')) return;
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
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
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
});
