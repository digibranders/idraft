import { act, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDecimal, formatInteger, formatPercent } from '@/lib/format';
import { internalLinksKeys } from '@/lib/internal-links/queries';
import type { LinkScope } from '@/lib/internal-links/scopes';
import type { TierFlow } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS, tierFlow } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

// The file save needs a browser; the test reads what the tab hands it
const saved = vi.hoisted(() => ({ blob: null as Blob | null, name: '' }));
vi.mock('@/lib/csv/csv-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csv/csv-write')>();
  return {
    ...actual,
    downloadBlob: (blob: Blob, name: string): void => {
      saved.blob = blob;
      saved.name = name;
    },
  };
});

const FLOW = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-flow');
/** An equity share the API sends and the tab must never show. */
const EQUITY = 0.4321;
const SCOPE_WORDS: readonly (readonly [LinkScope, string])[] = [
  ['editorial', 'editorial'],
  ['auto_generated', 'auto-generated'],
  ['template', 'menu and footer'],
  ['all', 'all links'],
];

beforeEach(() => {
  saved.blob = null;
  saved.name = '';
});
afterEach(() => document.documentElement.classList.remove('dark'));

const open = (query = '?tab=flow'): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: query });

const matrix = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Links between tiers' });
const answerWith = (change: (flow: TierFlow) => TierFlow): void =>
  server.use(http.get(FLOW, () => HttpResponse.json({ data: change(tierFlow('editorial')) })));
const queryOf = (href: string | null): URLSearchParams => new URLSearchParams((href ?? '').split('?')[1]);
const exportMenu = async (user: ReturnType<typeof open>['user']): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: 'Export' }));
  return screen.findByRole('menuitem', { name: 'Export this tab (CSV)' });
};

describe('the Tier flow tab (spec 7.6)', () => {
  it('shows each tier with its pages, share and depth, and Untiered as its own row and column', async () => {
    open();
    const strip = await screen.findByRole('list', { name: 'Pages by tier' });
    const flow = tierFlow('editorial');
    const items = within(strip).getAllByRole('listitem');
    expect(items).toHaveLength(flow.tiers.length);
    const total = flow.tiers.reduce((sum, stat) => sum + stat.pages, 0);
    flow.tiers.forEach((stat, index) => {
      const item = items[index];
      expect(item).toHaveTextContent(`${formatInteger(stat.pages)} ${stat.pages === 1 ? 'page' : 'pages'}`);
      expect(item).toHaveTextContent(formatPercent(stat.pages / total));
      expect(item).toHaveTextContent(
        stat.average_depth === null ? 'depth n/a' : `average depth ${formatDecimal(stat.average_depth, 1)}`,
      );
    });
    const table = await matrix();
    expect(within(table).getByRole('rowheader', { name: 'Untiered' })).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader', { name: /^To / })).toHaveLength(flow.tiers.length);
  });

  it('says depth n/a for a tier no page of which can be reached', async () => {
    answerWith((flow) => ({ ...flow, tiers: flow.tiers.map((stat) => ({ ...stat, average_depth: null })) }));
    open();
    const strip = await screen.findByRole('list', { name: 'Pages by tier' });
    for (const item of within(strip).getAllByRole('listitem')) expect(item).toHaveTextContent('depth n/a');
  });

  it('adds up each row in its Total cell', async () => {
    open();
    const table = await matrix();
    const flow = tierFlow('editorial');
    const rows = within(table).getAllByRole('row').slice(1);
    flow.tiers.forEach((from, index) => {
      const sum = flow.cells
        .filter((cell) => (cell.from_tier?.tier_id ?? null) === (from.tier?.tier_id ?? null))
        .reduce((total, cell) => total + cell.links, 0);
      const cells = within(rows[index] as HTMLElement).getAllByRole('cell');
      expect(cells.at(-1)).toHaveTextContent(new RegExp(`^${formatInteger(sum)}$`));
    });
  });

  it('names a cell with its numbers in words and shows the number', async () => {
    open();
    const table = await matrix();
    const flow = tierFlow('editorial');
    const cell = flow.cells.find(
      (candidate) => candidate.links > 0 && candidate.from_tier !== null && candidate.to_tier !== null,
    );
    expect(cell).toBeDefined();
    const name = new RegExp(
      `^${String(cell?.links)} links? \\(editorial\\) from ${cell?.from_tier?.code ?? ''} .* to ${cell?.to_tier?.code ?? ''} .*, show them$`,
    );
    const link = await within(table).findByRole('link', { name });
    expect(link).toHaveTextContent(String(cell?.links));
  });

  it.each(SCOPE_WORDS)('reads right in the %s scope', async (scope, word) => {
    open(`?tab=flow&scope=${scope}`);
    const table = await matrix();
    const names = within(table)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? '');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(new RegExp(`^\\d+ links? \\(${word}\\) from .+ to .+, show them$`));
      expect(name).not.toMatch(/links links/);
    }
    // Nothing may reach T1 in a scope: the sentence then says so, in the same words for the scope
    expect(
      screen.getByText(
        new RegExp(
          ` send \\d+ links? to T1 \\(${word}\\)\\.$|^No pages in other tiers link to T1 pages \\(${word}\\)\\.$`,
        ),
      ),
    ).toBeInTheDocument();
  });

  it('makes a cell with no links plain text, not a link', async () => {
    open();
    const table = await matrix();
    const flow = tierFlow('editorial');
    const linked = flow.cells.filter((cell) => cell.links > 0).length;
    expect(within(table).getAllByRole('link')).toHaveLength(linked);
    const empty = flow.cells.length - linked;
    expect(empty).toBeGreaterThan(0);
    expect(within(table).getAllByText(/^No links \(editorial\) from /)).toHaveLength(empty);
  });

  it('links each cell to the Links tab filtered to the pair, keeping the scope', async () => {
    open('?tab=flow&scope=all');
    const table = await matrix();
    const href = within(table).getAllByRole('link')[0]?.getAttribute('href') ?? '';
    expect(href).toContain('/seo/internal-links?');
    const query = queryOf(href);
    expect(query.get('tab')).toBe('links');
    expect(query.get('scope')).toBe('all');
    expect(query.get('stier')).toMatch(/^(none|[0-9a-f-]{36})$/);
    expect(query.get('ttier')).toMatch(/^(none|[0-9a-f-]{36})$/);
  });

  it('leaves the scope out of the address of a cell in the editorial scope', async () => {
    open();
    const table = await matrix();
    expect(queryOf(within(table).getAllByRole('link')[0]?.getAttribute('href') ?? '').has('scope')).toBe(false);
  });

  it('writes none for the Untiered row and the Untiered column', async () => {
    answerWith((flow) => ({
      ...flow,
      cells: flow.cells.map((cell) => ({
        ...cell,
        links: cell.from_tier === null || cell.to_tier === null ? 3 : cell.links,
      })),
    }));
    open();
    const table = await matrix();
    const untieredRow = within(within(table).getByRole('rowheader', { name: 'Untiered' }).closest('tr') as HTMLElement);
    const fromUntiered = untieredRow.getAllByRole('link').map((link) => queryOf(link.getAttribute('href')));
    expect(fromUntiered.length).toBeGreaterThan(0);
    for (const query of fromUntiered) expect(query.get('stier')).toBe('none');
    const both = within(table).getByRole('link', { name: /^3 links \(editorial\) from Untiered to Untiered/ });
    expect(queryOf(both.getAttribute('href')).get('stier')).toBe('none');
    expect(queryOf(both.getAttribute('href')).get('ttier')).toBe('none');
  });

  it('reads the strongest sender to T1 in a sentence under the strip', async () => {
    open();
    await matrix();
    expect(screen.getByText(/ send \d+ links? to T1 \(editorial\)\./)).toBeInTheDocument();
  });

  it('names the higher tier when two tiers send the same number of links to T1', async () => {
    answerWith((flow) => {
      const [top, second] = flow.tiers.map((stat) => stat.tier);
      return {
        ...flow,
        // The Untiered cell comes first, then the tiers from the lowest up: order must not decide
        cells: [...flow.cells]
          .reverse()
          .map((cell) =>
            cell.to_tier?.tier_id === top?.tier_id && cell.from_tier?.tier_id !== top?.tier_id
              ? { ...cell, links: 5 }
              : cell,
          ),
        tiers: flow.tiers.map((stat) => ({ ...stat, average_depth: second === stat.tier ? 1 : stat.average_depth })),
      };
    });
    open();
    await matrix();
    const flow = tierFlow('editorial');
    const second = flow.tiers[1]?.tier;
    expect(
      screen.getByText(`${second?.name ?? ''} (${second?.code ?? ''}) send 5 links to T1 (editorial).`),
    ).toBeInTheDocument();
  });

  it('never shows an equity share, in text, titles or names', async () => {
    answerWith((flow) => ({ ...flow, tiers: flow.tiers.map((stat) => ({ ...stat, equity_share: EQUITY })) }));
    const { container } = open();
    await matrix();
    expect(container).not.toHaveTextContent(/equity/i);
    expect(container).not.toHaveTextContent('43.2');
    expect(container).not.toHaveTextContent('0.4321');
    for (const element of container.querySelectorAll('[title], [aria-label]')) {
      const text = `${element.getAttribute('title') ?? ''} ${element.getAttribute('aria-label') ?? ''}`;
      expect(text).not.toMatch(/equity|43\.2|0\.4321/i);
    }
  });

  it('shows a failed read with Try again, and reads again on the press', async () => {
    let calls = 0;
    server.use(
      http.get(FLOW, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ type: 'about:blank', title: 'Failed', status: 500, code: 'internal' }, { status: 500 })
          : HttpResponse.json({ data: tierFlow('editorial') });
      }),
    );
    const { user } = open();
    expect(await screen.findByText('The tier flow could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await matrix();
    expect(calls).toBeGreaterThan(1);
  });

  it('keeps the numbers and says they may be out of date when a later read fails', async () => {
    const { user, queryClient } = open();
    await matrix();
    server.use(
      http.get(FLOW, () => HttpResponse.json({ type: 'about:blank', title: 'Failed', status: 500 }, { status: 500 })),
    );
    await act(() =>
      queryClient.invalidateQueries({
        queryKey:
          internalLinksKeys({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id })[0] ?? [],
      }),
    );
    expect(await screen.findByText(/could not be refreshed/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Links between tiers' })).toBeInTheDocument();
    server.use(http.get(FLOW, () => HttpResponse.json({ data: tierFlow('editorial') })));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument());
  });

  it('says so, with a link to the tier settings, when the workspace has no tiers', async () => {
    answerWith((flow) => ({ ...flow, tiers: [], cells: [] }));
    open();
    expect(await screen.findByText('No tiers to compare yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit page tiers' })).toHaveAttribute(
      'href',
      `/${MOCK_WORKSPACE.slug}/settings/tiers`,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so when no page is in a tier', async () => {
    answerWith((flow) => ({ ...flow, tiers: flow.tiers.map((stat) => ({ ...stat, pages: 0 })), cells: [] }));
    open();
    expect(await screen.findByText('No pages are in a tier yet')).toBeInTheDocument();
  });

  it('keeps the matrix on screen and says a tier change is being worked out when the read is stale', async () => {
    answerWith((flow) => ({ ...flow, stale: true }));
    open();
    await matrix();
    expect(screen.getByText('The tier flow is being worked out again after a tier change.')).toBeInTheDocument();
  });

  it('shows no numbers of the old scope while the new scope is read, and reads like the new one after', async () => {
    server.use(
      http.get(FLOW, async ({ request }) => {
        const scope = new URL(request.url).searchParams.get('scope');
        if (scope === 'all') await delay(150);
        return HttpResponse.json({ data: tierFlow(scope === 'all' ? 'all' : 'editorial') });
      }),
    );
    const { user } = open();
    await matrix();
    await user.click(screen.getByRole('button', { name: 'Link scope: Editorial' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All links' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('table', { name: 'Links between tiers' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\(editorial\)/)).not.toBeInTheDocument();
    // The export of the old scope is withdrawn with its numbers
    expect(await exportMenu(user)).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    const table = await matrix();
    const names = within(table)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? '');
    expect(names.every((name) => name.includes('(all links)'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Link scope: All links' })).toBeInTheDocument();
  });

  it('exports the matrix as a CSV named for the scope', async () => {
    const { user } = open('?tab=flow&scope=all');
    await matrix();
    await user.click(await exportMenu(user));
    await waitFor(() => expect(saved.blob).not.toBeNull());
    expect(saved.name).toBe('internal-links-tier-flow-all.csv');
    const blob = saved.blob;
    if (blob === null) throw new Error('No file was saved');
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => resolve(String(reader.result));
      reader.onerror = (): void => reject(new Error('The CSV could not be read'));
      reader.readAsText(blob);
    });
    const flow = tierFlow('all');
    const lines = text
      .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '')
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(flow.tiers.length + 1);
    expect(lines[0]).toBe(
      [
        'From',
        ...flow.tiers.map((stat) => `To ${stat.tier === null ? 'Untiered' : `${stat.tier.code} ${stat.tier.name}`}`),
        'Total',
      ].join(','),
    );
    expect(lines[1]?.split(',').at(-1)).toBe(
      String(
        flow.cells
          .filter((cell) => cell.from_tier?.tier_id === flow.tiers[0]?.tier?.tier_id)
          .reduce((sum, cell) => sum + cell.links, 0),
      ),
    );
    expect(text).not.toMatch(/equity/i);
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = open();
    await matrix();
    expect(await axe(container)).toHaveNoViolations();
  });
});
