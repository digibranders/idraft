import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HISTORY_RUN_IDS, setLinksScenario } from '@/mocks/internal-links-world';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const DROPPED = HISTORY_RUN_IDS[4] ?? '';

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

function pageReads(): () => URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/internal-links/pages')) seen.push(url.searchParams);
  });
  return () => seen;
}

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Pages' });
const rowOf = async (path: string): Promise<HTMLElement> =>
  within(await grid()).findByRole('row', { name: new RegExp(path.replaceAll('/', '\\/')) });

/** The columns turned on in the address: the page and the ones named. */
const cols = (...ids: string[]): string => `?cols=${['page', ...ids].join(',')}`;

describe('the columns that read the extras of a row', () => {
  it('asks for the changes with the default columns, and for more parts as the chooser turns columns on', async () => {
    const reads = pageReads();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await rowOf('/pricing');
    expect(reads()[0]?.get('include')).toBe('changes');
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Average rank' }));
    await waitFor(() => expect(reads().some((read) => read.get('include') === 'changes,keywords')).toBe(true));
    await user.click(await screen.findByRole('checkbox', { name: 'AI citations' }));
    await waitFor(() =>
      expect(reads().some((read) => read.get('include') === 'changes,keywords,citations')).toBe(true),
    );
    // Link strength and equity are not offered
    expect(screen.queryByRole('checkbox', { name: /equity|strength/i })).toBeNull();
  });

  it('shows the change of a page, and sorts by it on the server', async () => {
    const reads = pageReads();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?q=services%2Fvapt',
    });
    const row = await rowOf('/services/vapt');
    // The mock crawl gained one editorial link to it
    await waitFor(async () => expect(await rowOf('/services/vapt')).toHaveTextContent('+1'));
    expect(row).not.toHaveTextContent(/equity/i);
    await user.click(within(await grid()).getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(reads().some((read) => read.get('sort') === '-change')).toBe(true));
  });

  it('shows rank, citations and anchors for a page, and Search Console clicks', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `${cols('keywords', 'rank', 'citations', 'anchors', 'matches', 'clicks')}&q=soc-vs-mdr`,
    });
    const row = await rowOf('/blog/soc-vs-mdr');
    await waitFor(() => expect(row).toHaveTextContent('640'));
    expect(row).toHaveTextContent(/anchors?, \d+% generic/);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });

  it('says there is no earlier crawl for a first crawl, and Updating while the comparison is worked out', async () => {
    setLinksScenario({ firstCrawl: true });
    const first = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?q=pricing' });
    const row = await rowOf('/pricing');
    await waitFor(() => expect(row).toHaveTextContent('n/a'));
    expect(row).not.toHaveTextContent(/unchanged/i);
    first.unmount();
    setLinksScenario({ firstCrawl: false, enrich: 'running' });
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?q=pricing' });
    await waitFor(async () => expect(await rowOf('/pricing')).toHaveTextContent('Updating'));
  });

  it('says Syncing while Search Console is pending and Not connected without it', async () => {
    setLinksScenario({ gsc: 'pending' });
    const pending = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `${cols('clicks')}&q=pricing`,
    });
    await waitFor(async () => expect(await rowOf('/pricing')).toHaveTextContent('Syncing'));
    pending.unmount();
    setLinksScenario({ gsc: 'not_connected' });
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `${cols('clicks')}&q=pricing` });
    await waitFor(async () => expect(await rowOf('/pricing')).toHaveTextContent('Not connected'));
  });

  it('shows Not stored for the anchors of a crawl whose links were dropped', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `${cols('anchors', 'matches')}&run=${DROPPED}&q=pricing`,
    });
    await waitFor(async () => expect(await rowOf('/pricing')).toHaveTextContent('Not stored'));
  });
});

describe('the flag and the worklists of slice 2', () => {
  it('sends the generic anchors flag from the flag filter', async () => {
    const reads = pageReads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?flag=generic_anchors' });
    await grid();
    await waitFor(() => expect(reads().some((read) => read.get('filter[flags]') === 'generic_anchors')).toBe(true));
  });

  it('shows the two new chips with their counts, and sets the view from them', async () => {
    const reads = pageReads();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const lost = await screen.findByRole('button', { name: /^Lost links to T1 and T2 \d+$/ });
    expect(await screen.findByRole('button', { name: /^T1 pages linking out to weak pages \d+$/ })).toBeInTheDocument();
    await user.click(lost);
    expect(lost).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(reads().some((read) => read.get('filter[worklist]') === 'lost_links_top')).toBe(true));
  });

  it('opens on the worklist named in the address', async () => {
    const reads = pageReads();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?view=weak_outlinks' });
    await grid();
    await waitFor(() => expect(reads().some((read) => read.get('filter[worklist]') === 'weak_outlinks')).toBe(true));
  });

  it('offers no weak outlinks chip for a crawl whose links were dropped', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${DROPPED}` });
    await screen.findByRole('button', { name: /^Lost links to T1 and T2 \d+$/ });
    expect(screen.queryByRole('button', { name: /weak pages/ })).toBeNull();
  });
});

describe('accessibility of the new columns', () => {
  it.each(['light', 'dark'])('has no axe violations with every column on, in the %s theme', async (theme) => {
    const { axe } = await import('@/test/axe');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: cols('change', 'keywords', 'rank', 'citations', 'anchors', 'matches', 'clicks', 'impressions'),
    });
    await rowOf('/pricing');
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.classList.remove('dark');
  });
});
