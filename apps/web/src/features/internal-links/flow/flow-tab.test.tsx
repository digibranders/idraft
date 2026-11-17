import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const FLOW = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-flow');
/** An equity share the API sends and the tab must never show. */
const EQUITY = 0.4321;

afterEach(() => document.documentElement.classList.remove('dark'));

const open = (query = '?tab=flow'): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: query });

const matrix = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Links between tiers' });

describe('the Tier flow tab (spec 7.6)', () => {
  it('shows each tier with its pages and depth, and Untiered as its own row and column', async () => {
    open();
    const strip = await screen.findByRole('list', { name: 'Pages by tier' });
    const flow = tierFlow('editorial');
    expect(within(strip).getAllByRole('listitem')).toHaveLength(flow.tiers.length);
    const table = await matrix();
    expect(within(table).getByRole('rowheader', { name: 'Untiered' })).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader', { name: /^To / })).toHaveLength(flow.tiers.length);
  });

  it('names every cell with its numbers in words and shows the number', async () => {
    open();
    const table = await matrix();
    const flow = tierFlow('editorial');
    const cell = flow.cells.find(
      (candidate) => candidate.links > 0 && candidate.from_tier !== null && candidate.to_tier !== null,
    );
    expect(cell).toBeDefined();
    const name = new RegExp(
      `^${String(cell?.links)} editorial links? from ${cell?.from_tier?.code ?? ''} .* to ${cell?.to_tier?.code ?? ''} .*, show them$`,
    );
    const link = await within(table).findByRole('link', { name });
    expect(link).toHaveTextContent(String(cell?.links));
  });

  it('links each cell to the Links tab filtered to the pair, keeping the scope', async () => {
    open('?tab=flow&scope=all');
    const table = await matrix();
    const links = within(table).getAllByRole('link');
    const href = links[0]?.getAttribute('href') ?? '';
    expect(href).toContain('/seo/internal-links?');
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('tab')).toBe('links');
    expect(query.get('scope')).toBe('all');
    expect(query.get('stier')).toMatch(/^(none|[0-9a-f-]{36})$/);
    expect(query.get('ttier')).toMatch(/^(none|[0-9a-f-]{36})$/);
  });

  it('leaves the scope out of the address of a cell in the editorial scope', async () => {
    open();
    const table = await matrix();
    const href = within(table).getAllByRole('link')[0]?.getAttribute('href') ?? '';
    expect(new URLSearchParams(href.split('?')[1]).has('scope')).toBe(false);
  });

  it('reads the strongest sender to T1 in a sentence under the strip', async () => {
    open();
    await matrix();
    expect(screen.getByText(/ send \d+ editorial links? to T1\./)).toBeInTheDocument();
  });

  it('never shows an equity share, in text, titles or names', async () => {
    server.use(
      http.get(FLOW, () => {
        const flow = tierFlow('editorial');
        return HttpResponse.json({
          data: { ...flow, tiers: flow.tiers.map((stat) => ({ ...stat, equity_share: EQUITY })) },
        });
      }),
    );
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
    open();
    expect(await screen.findByText('The tier flow could not be loaded')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Try again' }).click();
    await matrix();
    expect(calls).toBeGreaterThan(1);
  });

  it('says so, with a link to the tier settings, when the workspace has no tiers', async () => {
    server.use(http.get(FLOW, () => HttpResponse.json({ data: { ...tierFlow('editorial'), tiers: [], cells: [] } })));
    open();
    expect(await screen.findByText('No tiers to compare yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit page tiers' })).toHaveAttribute(
      'href',
      `/${MOCK_WORKSPACE.slug}/settings/tiers`,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so when no page is in a tier', async () => {
    server.use(
      http.get(FLOW, () => {
        const flow = tierFlow('editorial');
        return HttpResponse.json({
          data: { ...flow, tiers: flow.tiers.map((stat) => ({ ...stat, pages: 0 })), cells: [] },
        });
      }),
    );
    open();
    expect(await screen.findByText('No pages are in a tier yet')).toBeInTheDocument();
  });

  it('keeps the matrix on screen and says a tier change is being worked out when the read is stale', async () => {
    server.use(http.get(FLOW, () => HttpResponse.json({ data: { ...tierFlow('editorial'), stale: true } })));
    open();
    await matrix();
    expect(screen.getByText('The tier flow is being worked out again after a tier change.')).toBeInTheDocument();
  });

  it('reads the project of the page', async () => {
    let project = '';
    server.use(
      http.get(FLOW, ({ request }) => {
        project = new URL(request.url).pathname;
        return HttpResponse.json({ data: tierFlow('editorial') });
      }),
    );
    open();
    await matrix();
    await waitFor(() => expect(project).toContain(EVENTUS.project_id));
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = open();
    await matrix();
    expect(await axe(container)).toHaveNoViolations();
  });
});
