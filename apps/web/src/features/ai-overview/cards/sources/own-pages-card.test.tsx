import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OwnPagesCard from './own-pages-card';
import { pagePage, pageRow } from './model/page-fixtures';
import { at, sourcesMeta } from './model/source-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider, useOverview } from '../../overview-context';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { SourcePagePage } from '@/lib/citations/types';
import { formatList } from '@/lib/format';
import { PermissionProvider } from '@/lib/permissions';
import { clearPreferences, preferenceKey } from '@/lib/preferences/storage';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { setAiSeeded } from '@/mocks/ai-seed';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { cardInOverview, overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const seam = vi.hoisted(() => ({ drill: null as CardDrill | null }));
vi.mock('../engines/use-card-seams', async (importActual) => {
  const actual = await importActual<typeof import('../engines/use-card-seams')>();
  return {
    ...actual,
    useCardDrill: (): CardDrill => {
      const real = actual.useCardDrill();
      return seam.drill ?? real;
    },
  };
});

const PAGES = '*/api/v1/workspaces/:w/projects/:p/ai/sources/pages';
const HEADING = 'Your pages AI engines cite';
const CAPTION = 'Your pages by citation units';
const ENGINES = ['chatgpt_web', 'gemini_web'] as const;

const listeners: ((info: { request: Request }) => void)[] = [];
function recordRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    seen.push(new URL(request.url));
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  seam.drill = null;
  clearPreferences();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const META = sourcesMeta({ units: 18420, answers: 6210, citing: 5100, engines: ENGINES, byRole: { own: 1032 } });

/** Three own pages on one domain: 612, 300 and 120 citation units. */
function page(): SourcePagePage {
  return pagePage(
    [
      pageRow({
        url: 'https://fynix.com/pricing?utm_source=x',
        urlId: 11,
        units: 612,
        answers: 540,
        prompts: 88,
        title: 'Pricing | Fynix',
        engines: [
          ['chatgpt_web', 301],
          ['gemini_web', 112],
        ],
      }),
      pageRow({ url: 'https://fynix.com/blog/crm-guide', urlId: 12, units: 300, answers: 250, prompts: 40 }),
      pageRow({ url: 'https://fynix.com/docs/start', urlId: 13, units: 120, answers: 100, prompts: 12 }),
    ],
    META,
  );
}

const serve = (body: SourcePagePage = page()): void => {
  server.use(http.get(PAGES, () => HttpResponse.json(body)));
};

const failing = (requestId: string): Response =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

const sink: { read: () => ExportRead } = { read: () => ({ blocks: [], loading: 0 }) };
function Reader(): ReactElement {
  const reader = useExportBlocks();
  useEffect(() => {
    sink.read = reader;
  }, [reader]);
  return <></>;
}

interface RenderOptions {
  rows?: string;
  world?: OverviewWorld;
}

function renderCard(
  searchParams = 'cmp=off',
  { rows = '8', world = 'fynix' }: RenderOptions = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <OwnPagesCard {...props} options={{ rows }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'sources.own_pages', Card, world }), { searchParams });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('list', { name: CAPTION });
const labelsOf = (list: HTMLElement): (string | null | undefined)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent);
// Built from code points, so this file does not contain the characters it looks for: figure dash, en-dash, em-dash, bar
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);

describe('the own pages card', () => {
  it('shows a skeleton at its height, then the pages by citation units, every bar chart-1', async () => {
    server.use(
      http.get(PAGES, async () => {
        await delay(60);
        return HttpResponse.json(page());
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame?.querySelector('[style*="height: 280px"]')).not.toBeNull();
    const list = await barList();
    expect(labelsOf(list)).toEqual(['/pricing', '/blog/crm-guide', '/docs/start']);
    const fills = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[data-slot="bar-list-bar"]')?.className ?? '');
    for (const fill of fills) expect(fill).toContain('bg-chart-1');
  });

  it('hides the host when your pages are on one domain, and shows it when they are on several', async () => {
    serve();
    const { unmount } = renderCard();
    expect(labelsOf(await barList())).toEqual(['/pricing', '/blog/crm-guide', '/docs/start']);
    unmount();
    const rows = page();
    serve({
      ...rows,
      data: [...rows.data, pageRow({ url: 'https://fynix.io/help', urlId: 14, units: 50, domain: 'fynix.io' })],
    });
    renderCard();
    expect(labelsOf(await barList())).toEqual([
      'fynix.com/pricing',
      'fynix.com/blog/crm-guide',
      'fynix.com/docs/start',
      'fynix.io/help',
    ]);
  });

  it('draws the units and the prompts of each page, and reads them aloud', async () => {
    serve();
    renderCard();
    const list = await barList();
    const first = at(within(list).getAllByRole('listitem'), 0);
    expect(first.querySelector('[data-slot="bar-list-value"]')).toHaveTextContent('612 units');
    expect(first.querySelector('[data-slot="bar-list-context"]')).toHaveTextContent('in 88 prompts');
    expect(within(list).getByText('/pricing: 612 citation units, in 88 prompts, in 540 answers')).toBeInTheDocument();
  });

  it('draws no percent: it shows counts only', async () => {
    serve();
    const { container } = renderCard();
    await barList();
    expect(container.textContent).not.toMatch(/%/);
  });

  it('names the window, the units and answers, and the engines the units are pooled over', async () => {
    serve();
    renderCard();
    await barList();
    const engines = formatList(['ChatGPT', 'Gemini']);
    expect(
      screen.getByText(
        `Oct 16 to Nov 12, 2026, 18,420 citation units in 6,210 answers, ${engines}, branded prompts left out`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Citation units are pooled over ${engines}`))).toBeInTheDocument();
    expect(
      screen.getByText('Citations flagged as unresolved redirects or engine-internal links are left out.'),
    ).toBeInTheDocument();
  });

  it('gives the title, the engine split and the first date in the tooltip of a page', async () => {
    serve();
    const { user } = renderCard();
    const list = await barList();
    const trigger = at(within(list).getAllByRole('listitem'), 0).firstElementChild;
    if (trigger === null) throw new Error('The row has no trigger');
    await user.hover(trigger);
    const tip = await screen.findByText(/Pricing \| Fynix/);
    expect(tip).toHaveTextContent(`By engine: ${formatList(['ChatGPT 301', 'Gemini 112'])}`);
    expect(tip).toHaveTextContent('First cited Oct 17');
    expect(tip).toHaveTextContent('https://fynix.com/pricing?utm_source=x');
  });

  it('shows the idle state, and asks nothing, when no engine is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(PAGES, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject('cleanstart')}
        >
          <OwnPagesCard
            item={{ id: 'bare', type: 'sources.own_pages' }}
            options={{ rows: '8' }}
            width="half"
            mode="view"
            live
          />
        </OverviewProvider>
      </PermissionProvider>,
      { searchParams: 'cmp=off' },
    );
    expect(await screen.findByText('No engine is on for this project')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says branded prompts alone cannot be read for sources, and asks nothing', async () => {
    const asked = vi.fn();
    server.use(
      http.get(PAGES, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    renderCard('cmp=off&branded=only');
    expect(await screen.findByText('Sources cannot be read for branded prompts alone')).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says no answer cited your pages, with a link to the Prompts page, and no zero', async () => {
    serve(pagePage([], sourcesMeta({ units: 900, answers: 40, citing: 30, engines: ENGINES, byRole: { own: 0 } })));
    renderCard();
    expect(await screen.findByText('No answer cited your pages in this window')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open prompts' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').pathname).toBe(
      '/digibranders/fynix/ai/prompts',
    );
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0 units/)).not.toBeInTheDocument();
  });

  it('has no link in that empty state where the Prompts page cannot show the scope', async () => {
    seam.drill = () => null;
    serve(pagePage([], sourcesMeta({ units: 900, answers: 40, citing: 30, engines: ENGINES, byRole: { own: 0 } })));
    renderCard();
    expect(await screen.findByText('No answer cited your pages in this window')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open prompts' })).not.toBeInTheDocument();
  });

  it('says no answer cited a source when no unit of any role was cited, and no valid answer when there is none', async () => {
    serve(pagePage([], sourcesMeta({ units: 0, answers: 40, citing: 0, engines: ENGINES, byRole: {} })));
    const { unmount } = renderCard();
    expect(await screen.findByText('No answer cited a source in this window')).toBeInTheDocument();
    unmount();
    serve(pagePage([], sourcesMeta({ units: 0, answers: 0, citing: 0, engines: ENGINES, byRole: {} })));
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(PAGES, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load your cited pages')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('keeps the rows and says these are the last figures read when a refetch fails', async () => {
    serve();
    const { queryClient } = renderCard();
    await barList();
    server.use(http.get(PAGES, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: CAPTION })).toBeInTheDocument();
  });

  it('keeps the rows at full strength with the refetch bar while a new scope is read', async () => {
    let phase: 'first' | 'changed' = 'first';
    server.use(
      http.get(PAGES, async () => {
        if (phase === 'changed') await delay(200);
        return HttpResponse.json(page());
      }),
    );
    function ScopeButton(): ReactElement {
      const { setScope } = useOverview();
      return (
        <button
          type="button"
          onClick={() => {
            phase = 'changed';
            setScope({ branded: 'included' });
          }}
        >
          Include branded
        </button>
      );
    }
    const Card = (props: CardProps): ReactElement => (
      <>
        <ScopeButton />
        <OwnPagesCard {...props} options={{ rows: '8' }} />
      </>
    );
    const { user, container } = renderWithProviders(cardInOverview({ type: 'sources.own_pages', Card }), {
      searchParams: 'cmp=off',
    });
    await barList();
    await user.click(screen.getByRole('button', { name: 'Include branded' }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(within(screen.getByRole('list', { name: CAPTION })).getAllByRole('listitem')).toHaveLength(3);
    expect(container.querySelector('section')?.className ?? '').not.toMatch(/opacity/);
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });

  it('asks the rows of its option and says how many pages are not shown', async () => {
    const seen = recordRequests();
    const all = page();
    serve({ ...all, data: all.data.slice(0, 2), page: { ...all.page, total: 9 } });
    renderCard('cmp=off', { rows: '5' });
    const list = await barList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('7 more pages are not shown.')).toBeInTheDocument();
    expect(seen.find((url) => url.pathname.endsWith('/sources/pages'))?.searchParams.get('limit')).toBe('5');
  });

  it('links each page to the source inspector on the Pages tab of Citations, own pages, with the scope', async () => {
    serve();
    renderCard('cmp=off&engine=chatgpt_web');
    const list = await barList();
    const link = within(list).getByRole('link', { name: /^\/pricing: 612 citation units/ });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('tab')).toBe('pages');
    expect(href.searchParams.get('role')).toBe('own');
    expect(href.searchParams.get('inspect')).toBe('source:11');
    expect(href.searchParams.get('engine')).toBe('chatgpt_web');
  });

  it('leaves a row as plain text where the Citations page cannot show the scope', async () => {
    seam.drill = () => null;
    serve();
    renderCard();
    const list = await barList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('reaches each row link with Tab in order, and Enter follows it', async () => {
    seam.drill = () => '/digibranders/fynix/ai/citations' as Route;
    serve();
    const { user } = renderCard();
    const list = await barList();
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      for (let step = 0; step < 20 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
    const followed = vi.fn();
    at(links, 2).addEventListener('click', (event) => {
      event.preventDefault();
      followed();
    });
    await user.keyboard('{Enter}');
    expect(followed).toHaveBeenCalledOnce();
  });

  it('shows provider text as text: a script address is no link, and a title with markup is not markup', async () => {
    const rows = page();
    serve({
      ...rows,
      data: [
        pageRow({
          url: 'javascript:alert(1)',
          urlId: 21,
          units: 30,
          title: '<img src=x onerror=alert(1)>',
          domain: 'evil.example',
        }),
        pageRow({ url: 'https://fynix.com@evil.example/', urlId: 22, units: 20, domain: 'evil.example' }),
      ],
    });
    const { container, user } = renderCard();
    const list = await barList();
    expect(labelsOf(list)).toEqual(['javascript:alert(1)', 'https://fynix.com@evil.example/']);
    const trigger = at(within(list).getAllByRole('listitem'), 0).firstElementChild;
    if (trigger === null) throw new Error('The row has no trigger');
    await user.hover(trigger);
    await screen.findByText(/<img src=x onerror=alert\(1\)>/);
    expect(container.querySelector('img')).toBeNull();
    expect(document.body.querySelector('img')).toBeNull();
    for (const anchor of document.body.querySelectorAll('a[href]')) {
      expect(anchor.getAttribute('href')).not.toMatch(/^(javascript|data|vbscript|https?):/i);
    }
  });

  it('lists the same pages with their units and prompts in the Table view', async () => {
    serve();
    const { user } = renderCard();
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(at(rows, 1)).toHaveTextContent('/pricing612 unitsin 88 prompts');
    expect(at(rows, 3)).toHaveTextContent('/docs/start120 unitsin 12 prompts');
  });

  it('registers every page for the export under the layout item id, with address, title and units by engine', async () => {
    serve();
    renderCard();
    await barList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'Page',
      'Citation units',
      'Prompts',
      'Address',
      'Title',
      'Units by engine',
      'First cited',
    ]);
    expect(block?.rows).toHaveLength(3);
    expect(at(block?.rows ?? [], 0)).toEqual([
      '/pricing',
      612,
      88,
      'https://fynix.com/pricing?utm_source=x',
      'Pricing | Fynix',
      formatList(['ChatGPT 301', 'Gemini 112']),
      '2026-10-17',
    ]);
  });

  it('has nothing to export while the card loads or has failed', async () => {
    server.use(http.get(PAGES, () => failing('req-3')));
    renderCard();
    await screen.findByText('Could not load your cited pages');
    expect(sink.read().blocks).toEqual([]);
  });

  it.each([
    ['compact', undefined, 'min-h-row-compact'],
    ['default', 'default', 'min-h-row'],
  ] as const)('passes axe in %s density, with the row height of the density', async (_name, density, rowClass) => {
    if (density !== undefined) {
      localStorage.setItem(
        preferenceKey(mockUser('admin').user_id, 'settings'),
        JSON.stringify({ tableDensity: density }),
      );
    }
    serve();
    const { container } = renderCard();
    const list = await barList();
    const box = list.querySelector('li > :is(a, div)');
    expect(box?.className.split(' ')).toContain(rowClass);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes no dash and no character beyond ASCII in what it draws', async () => {
    serve();
    const { container, user } = renderCard();
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: CAPTION });
    const text = container.textContent;
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toMatch(/ - /);
  });

  it('is arranged and not used in customize mode: every button and link of the card is inside an inert body', async () => {
    serve();
    const Card = (props: CardProps): ReactElement => (
      <div inert data-testid="card-body">
        <OwnPagesCard {...props} options={{ rows: '8' }} />
      </div>
    );
    renderWithProviders(cardInOverview({ type: 'sources.own_pages', Card }), { searchParams: 'cmp=off' });
    const body = await screen.findByTestId('card-body');
    await within(body).findByRole('list', { name: CAPTION, hidden: true });
    const targets = [...body.querySelectorAll('button, a[href]')];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.closest('[inert]')).toBe(body);
  });

  it('draws the card on the seeded Eventus world with units on every row', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { world: 'eventus-security', rows: '10' });
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toHaveTextContent(/\d+ units?/);
  });
});
