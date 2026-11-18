import { screen, waitFor, within } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENTUS, HISTORY_RUN_IDS, linksWorld, setLinksScenario } from '@/mocks/internal-links-world';
import type { CrawlRun } from '@/lib/internal-links/types';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// All six tabs as text, so the header is tested on its own; a test turns two off to see only the four built ones
const registry = vi.hoisted(() => ({ six: true }));
vi.mock('./tabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tabs')>();
  const entry = (id: (typeof actual.LINKS_TABS)[number]['id'], label: string): (typeof actual.LINKS_TABS)[number] => ({
    id,
    label: () => label,
    icon: FileText,
    render: () => `Panel of ${label}`,
  });
  const four = actual.defineLinksTabs([
    entry('pages', 'Pages'),
    entry('links', 'Links'),
    entry('journey', 'Journey'),
    entry('flow', 'Tier flow'),
  ]);
  const six = actual.defineLinksTabs([...four, entry('changes', 'Changes'), entry('opportunities', 'Opportunities')]);
  return {
    ...actual,
    get LINKS_TABS() {
      return registry.six ? six : four;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const OLDER = HISTORY_RUN_IDS[1] ?? '';
const FAILED = '0192e4a0-1000-7000-8000-0000000000f1';
const UNKNOWN = '0192e4a0-1000-7000-8000-0000000000ee';

beforeEach(() => stubWideScreen());
afterEach(() => {
  registry.six = true;
  server.events.removeAllListeners();
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

/** The history of the mock world plus a failed and a crawling run newer than the latest crawl. */
function seedExtraRuns(): void {
  const current = linksWorld().crawls.get(EVENTUS.project_id) ?? [];
  const template: CrawlRun | undefined = current[0];
  if (template === undefined) throw new Error('The mock world has no crawl');
  const extra = (over: Partial<CrawlRun>): CrawlRun => ({ ...template, is_latest: false, ...over });
  linksWorld().crawls.set(EVENTUS.project_id, [
    extra({
      run_id: '0192e4a0-1000-7000-8000-0000000000f2',
      state: 'crawling',
      finished_at: null,
      // Just made: the mock world lets a crawl older than a few seconds finish
      created_at: new Date().toISOString(),
    }),
    extra({ run_id: FAILED, state: 'failed', finished_at: null, created_at: '2026-11-16T03:00:00Z' }),
    ...current,
  ]);
}

const CRAWL_SHOWN = /^Crawled .+, \d+ pages?$/;

describe('the crawl picker', () => {
  it('names the crawl in scope and lists every crawl, newest first, with the reason one cannot be chosen', async () => {
    seedExtraRuns();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: CRAWL_SHOWN }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items).toHaveLength(7);
    // The latest crawl in view is the one checked
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(items[0]).toHaveAttribute('aria-disabled', 'true');
    expect(items[0]).toHaveAccessibleDescription('Crawling');
    expect(items[1]).toHaveAttribute('aria-disabled', 'true');
    expect(items[1]).toHaveAccessibleDescription('Failed');
    expect(items[2]).toHaveAccessibleDescription(/^Schedule, 18 pages$/);
    expect(items[2]).toHaveAttribute('aria-checked', 'true');
    expect(items[2]).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disables a crawl whose links were dropped only for the tabs that read links', async () => {
    const pages = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await pages.user.click(await screen.findByRole('button', { name: CRAWL_SHOWN }));
    const onPages = await screen.findAllByRole('menuitemradio');
    expect(onPages[4]).not.toHaveAttribute('aria-disabled', 'true');
    pages.unmount();
    const links = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?tab=links' });
    await links.user.click(await screen.findByRole('button', { name: CRAWL_SHOWN }));
    const onLinks = await screen.findAllByRole('menuitemradio');
    expect(onLinks[4]).toHaveAttribute('aria-disabled', 'true');
    expect(onLinks[4]).toHaveAccessibleDescription('Its links were dropped; Pages and Tier flow still work');
  });

  it('writes the chosen crawl as run, and removes it for the latest', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await user.click(await screen.findByRole('button', { name: CRAWL_SHOWN }));
    await user.click((await screen.findAllByRole('menuitemradio'))[1] ?? document.body);
    await waitFor(() => expect(writes.at(-1)).toContain(`run=${OLDER}`));
    expect(await screen.findByText('Older crawl')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: CRAWL_SHOWN }));
    await user.click((await screen.findAllByRole('menuitemradio'))[0] ?? document.body);
    await waitFor(() => expect(writes.at(-1)).not.toContain('run='));
    await waitFor(() => expect(screen.queryByText('Older crawl')).toBeNull());
  });

  it('marks an older crawl and goes back to the latest', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `?run=${OLDER}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByText('Older crawl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CRAWL_SHOWN })).toHaveTextContent(/17 pages$/);
    await user.click(screen.getByRole('button', { name: 'Back to latest' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('run='));
    expect(screen.queryByText('Older crawl')).toBeNull();
  });
});

describe('a crawl the address names that cannot be shown', () => {
  it.each([
    ['a crawl that failed', FAILED],
    ['an id that is no crawl of the project', UNKNOWN],
    ['text that is no id', 'not-an-id'],
  ])('says it was not found for %s, with the way back, and reads no tab', async (_name, run) => {
    seedExtraRuns();
    const writes: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: `?run=${run}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByRole('heading', { name: 'That crawl was not found' })).toBeInTheDocument();
    expect(screen.queryByText('Panel of Pages')).toBeNull();
    // The picker shows the latest crawl, not the crawl that was asked for
    expect(screen.getByRole('button', { name: CRAWL_SHOWN })).toHaveTextContent(/18 pages$/);
    await user.click(screen.getByRole('button', { name: 'Back to latest' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('run='));
    expect(await screen.findByText('Panel of Pages')).toBeInTheDocument();
  });
});

describe('the context line', () => {
  it('holds the key numbers, drops Pages and shows no equity', async () => {
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const line = await screen.findByRole('group', { name: 'Crawl in scope' });
    await within(line).findByText('T1 pages');
    for (const label of ['Tiered', 'T1 pages', 'T1 average depth', 'No editorial links in']) {
      expect(within(line).getByText(label)).toBeInTheDocument();
    }
    expect(within(line).queryByText('Pages')).toBeNull();
    expect(container.textContent).not.toMatch(/equity/i);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('compares with the previous crawl when the changes are worked out', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const line = await screen.findByRole('group', { name: 'Crawl in scope' });
    expect(await within(line).findByText(/^Since \d+ \w+: \d+ pages? added, \d+ pages? lost/)).toBeInTheDocument();
    expect(within(line).getByText(/^Lost editorial links to T1/)).toBeInTheDocument();
  });

  it.each([
    ['pending', { enrich: 'pending' as const }, 'Comparing with the previous crawl is being worked out.'],
    ['first_crawl', { firstCrawl: true }, 'First crawl, so there is nothing to compare with yet.'],
    ['unavailable', { enrich: 'failed' as const }, 'The comparison with the previous crawl is not available.'],
  ])('says so when the changes are %s', async (_state, scenario, text) => {
    setLinksScenario(scenario);
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const line = await screen.findByRole('group', { name: 'Crawl in scope' });
    expect(await within(line).findByText(text)).toBeInTheDocument();
    expect(within(line).queryByText(/^Lost editorial links/)).toBeNull();
  });
});

describe('the tab badges', () => {
  it('count the alert on Changes and the open ones on Opportunities, and name the tab with them', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByRole('tab', { name: /^Changes, \d+ alerts?$/ })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /^Opportunities, \d+ open$/ })).toBeInTheDocument();
  });

  it('are read only for tabs that are registered', async () => {
    registry.six = false;
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl in scope' });
    expect(screen.queryByRole('tab', { name: /Changes/ })).toBeNull();
    expect(asked.some((path) => path.endsWith('/internal-links/opportunities'))).toBe(false);
  });
});

describe('the actions', () => {
  it('stand in the order Crawl now, Export, More actions, with Export in its own button from md up', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl in scope' });
    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)
      .filter((name) => name === 'Crawl now' || name === 'Export' || name === 'More actions');
    expect(names).toEqual(['Crawl now', 'Export', 'More actions']);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Export this tab (CSV)' })).toBeNull();
  });

  it('move Export into More below md', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl in scope' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Export this tab (CSV)' })).toBeInTheDocument();
  });
});

describe('the header is accessible', () => {
  it.each(['light', 'dark'])(
    'has no axe violations in the %s theme, with an older crawl and the menu open',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container, user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
        searchParams: `?run=${OLDER}`,
      });
      await screen.findByText('Older crawl');
      await screen.findByRole('group', { name: 'Crawl in scope' });
      expect(await axe(container)).toHaveNoViolations();
      await user.click(screen.getByRole('button', { name: CRAWL_SHOWN }));
      await screen.findAllByRole('menuitemradio');
      expect(await axe(document.body)).toHaveNoViolations();
    },
  );
});
