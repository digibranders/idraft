import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { at, domainPage, domainRow, PREVIOUS_WINDOW, sourcesMeta } from './model/source-fixtures';
import TopDomainsCard from './top-domains-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider, useOverview } from '../../overview-context';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { DomainRole, SourceDomainPage } from '@/lib/citations/types';
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

const DOMAINS = '*/api/v1/workspaces/:w/projects/:p/ai/sources/domains';
const HEADING = 'Top cited domains';
const CAPTION = 'Top cited domains by citation units';
const CURRENT_FROM = '2026-10-16';
const ENGINES = ['chatgpt_web', 'gemini_web'] as const;
const TOTAL = 18420;

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

/** Four domains of 18,420 citation units: one of yours, one competitor and two third parties. */
function page(previous = false, over: { answers?: number; valid?: number } = {}): SourceDomainPage {
  const withPrevious = (units: number) => (previous ? { previous: { units, answers: 50 } } : {});
  const common = { total: TOTAL, valid: over.valid ?? 6210 };
  return domainPage(
    [
      domainRow({
        domain: 'g2.com',
        units: 1912,
        answers: 1104,
        prompts: 211,
        engines: [
          ['chatgpt_web', 1200],
          ['gemini_web', 712],
        ],
        ...withPrevious(1640),
        ...common,
      }),
      domainRow({ domain: 'fynix.com', role: 'own', units: 1500, answers: 900, ...withPrevious(1400), ...common }),
      domainRow({ domain: 'capterra.com', units: 1300, answers: 700, ...withPrevious(1300), ...common }),
      domainRow({
        domain: 'hubspot.com',
        role: 'competitor',
        units: 900,
        answers: 500,
        entityId: 'e-2',
        ...withPrevious(1000),
        ...common,
      }),
    ],
    sourcesMeta({
      units: TOTAL,
      answers: over.answers ?? 6210,
      citing: 5100,
      engines: ENGINES,
      ...(previous ? { previousAnswers: 5000 } : {}),
    }),
    4,
  );
}

/** The window and, for the window before, its totals. */
function serve(current: SourceDomainPage, before: SourceDomainPage | null = null): void {
  server.use(
    http.get(DOMAINS, ({ request }) => {
      const from = new URL(request.url).searchParams.get('from');
      if (from === CURRENT_FROM) return HttpResponse.json(current);
      return HttpResponse.json(before ?? domainPage([], sourcesMeta({ units: TOTAL, answers: 5000 })));
    }),
  );
}

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
  role?: string;
  world?: OverviewWorld;
  member?: 'admin' | 'viewer';
}

function renderCard(
  searchParams = 'cmp=off',
  { rows = '8', role = 'all', world = 'fynix', member = 'admin' }: RenderOptions = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <TopDomainsCard {...props} options={{ rows, role }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'sources.top_domains', Card, world, role: member }), {
    searchParams,
  });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('list', { name: CAPTION });
const labelsOf = (list: HTMLElement): (string | null | undefined)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent);
// Built from code points, so this file does not contain the characters it looks for: figure dash, en-dash, em-dash, bar
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);

describe('the top cited domains card', () => {
  it('shows a skeleton at its height, then the domains by citation units with yours in chart-1', async () => {
    server.use(
      http.get(DOMAINS, async () => {
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
    expect(labelsOf(list)).toEqual(['g2.com', 'fynix.com', 'capterra.com', 'hubspot.com']);
    const fills = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[data-slot="bar-list-bar"]')?.className ?? '');
    expect(at(fills, 1)).toContain('bg-chart-1');
    for (const index of [0, 2, 3]) expect(at(fills, index)).not.toContain('bg-chart-1');
  });

  it('names the role of each domain in text, as a badge and in the accessible text', async () => {
    serve(page());
    renderCard();
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(within(at(items, 0)).getByText('Third party')).toBeInTheDocument();
    expect(within(at(items, 1)).getByText('Own')).toBeInTheDocument();
    expect(within(at(items, 3)).getByText('Competitor')).toBeInTheDocument();
  });

  it('prints the count of units and answers beside every percent', async () => {
    serve(page());
    renderCard();
    const list = await barList();
    expect(
      within(list).getByText('g2.com, Third party: 10.4% of citation units, 1,912 of 18,420 units, in 1,104 answers'),
    ).toBeInTheDocument();
    // The drawn count, not only the text read aloud
    for (const item of within(list).getAllByRole('listitem')) {
      expect(item.querySelector('[data-slot="bar-list-value"]')).toHaveTextContent(/\d%/);
      expect(item.querySelector('[data-slot="bar-list-context"]')).toHaveTextContent(/^[\d,]+ of 18,420 units$/);
    }
  });

  it('names the window, the units and answers, and the engines the units are pooled over', async () => {
    serve(page());
    renderCard();
    await barList();
    const engines = formatList(['ChatGPT', 'Gemini']);
    expect(
      screen.getByText(
        `Oct 16 to Nov 12, 2026, 18,420 citation units in 6,210 answers, ${engines}, branded prompts left out`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Citation units are pooled over ${engines}`))).toBeInTheDocument();
    expect(screen.getByText('5,100 of 6,210 answers')).toBeInTheDocument();
  });

  it('says flagged citations are left out and that domains under two units are not listed', async () => {
    serve(page());
    renderCard();
    await barList();
    expect(
      screen.getByText('Citations flagged as unresolved redirects or engine-internal links are left out.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Domains with fewer than 2 citation units are not listed.')).toBeInTheDocument();
  });

  it('gives the units of each engine in the tooltip text of a row, and the previous units', async () => {
    serve(page(true), page(true));
    const { user } = renderCard('');
    const list = await barList();
    const trigger = at(within(list).getAllByRole('listitem'), 0).firstElementChild;
    if (trigger === null) throw new Error('The row has no trigger');
    await user.hover(trigger);
    const tip = await screen.findByText(/1,912 citation units in 1,104 answers, 211 prompts/);
    expect(tip).toHaveTextContent('Previous period: 1,640 units');
    expect(tip).toHaveTextContent(`By engine: ${formatList(['ChatGPT 1,200', 'Gemini 712'])}`);
  });

  it('shows the idle state, and asks nothing, when no engine is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DOMAINS, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    // Cleanstart has every engine off: the page would not mount the card, so it is rendered inside the provider alone
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject('cleanstart')}
        >
          <TopDomainsCard
            item={{ id: 'bare', type: 'sources.top_domains' }}
            options={{ rows: '8', role: 'all' }}
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
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says branded prompts alone cannot be read for sources, and asks nothing', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DOMAINS, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    renderCard('cmp=off&branded=only');
    expect(await screen.findByText('Sources cannot be read for branded prompts alone')).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says no answer cited a source in this window, with the answers collected, and no zero', async () => {
    serve(domainPage([], sourcesMeta({ units: 0, answers: 40, citing: 0, engines: ENGINES })));
    renderCard();
    expect(await screen.findByText('No answer cited a source in this window')).toBeInTheDocument();
    expect(screen.getByText('40 answers were collected in this window, and none cited a source.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('says there is no valid answer when the window has none', async () => {
    serve(domainPage([], sourcesMeta({ units: 0, answers: 0, citing: 0, engines: ENGINES })));
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
  });

  it('says no domain reaches the minimum when units were cited but every domain is under it', async () => {
    serve(domainPage([], sourcesMeta({ units: 5, answers: 40, citing: 3, engines: ENGINES }), 0));
    renderCard();
    expect(await screen.findByText('No domain has 2 or more citation units')).toBeInTheDocument();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(DOMAINS, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load top cited domains')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve(page());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('keeps the rows and says these are the last figures read when a refetch fails', async () => {
    serve(page());
    const { queryClient } = renderCard();
    await barList();
    server.use(http.get(DOMAINS, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: CAPTION })).toBeInTheDocument();
  });

  it('keeps the rows at full strength with the refetch bar while a new scope is read', async () => {
    let phase: 'first' | 'changed' = 'first';
    server.use(
      http.get(DOMAINS, async () => {
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
        <TopDomainsCard {...props} options={{ rows: '8', role: 'all' }} />
      </>
    );
    const { user, container } = renderWithProviders(cardInOverview({ type: 'sources.top_domains', Card }), {
      searchParams: 'cmp=off',
    });
    await barList();
    await user.click(screen.getByRole('button', { name: 'Include branded' }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    const list = screen.getByRole('list', { name: CAPTION });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(container.querySelector('section')?.className ?? '').not.toMatch(/opacity/);
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });

  it('never colours the change of a share, and writes it in points beside the percent', async () => {
    serve(page(true), page(true));
    renderCard('');
    const list = await barList();
    const change = await within(list).findByText('+1.5 pts');
    expect(change.className).toContain('text-foreground-secondary');
    expect(change.className).not.toContain('positive');
    expect(change.className).not.toContain('negative');
  });

  it('drops the changes and says so when the previous period could not be read', async () => {
    server.use(
      http.get(DOMAINS, ({ request }) =>
        new URL(request.url).searchParams.get('from') === CURRENT_FROM
          ? HttpResponse.json(page(true))
          : failing('req-previous'),
      ),
    );
    renderCard('');
    const list = await barList();
    expect(within(list).queryByText(/pts/)).not.toBeInTheDocument();
    expect(await screen.findByText('No comparison: the previous period could not be read')).toBeInTheDocument();
  });

  it('drops the changes and says so when the previous period has no answers', async () => {
    const empty = page(true);
    serve({ ...empty, meta: { ...empty.meta, previous_answers: 0 } });
    renderCard('');
    const list = await barList();
    expect(within(list).queryByText(/pts/)).not.toBeInTheDocument();
    expect(await screen.findByText('No comparison: the previous period has no answers')).toBeInTheDocument();
  });

  it('asks the window before while the comparison is on, and not when it is off', async () => {
    const seen = recordRequests();
    serve(page(true), page(true));
    renderCard('');
    await barList();
    await waitFor(() => {
      expect(seen.some((url) => url.searchParams.get('from') === PREVIOUS_WINDOW.from)).toBe(true);
    });
  });

  it('does not ask for a comparison while the scope has it off', async () => {
    const seen = recordRequests();
    serve(page());
    renderCard('cmp=off');
    await barList();
    expect(seen.filter((url) => url.searchParams.has('compare'))).toHaveLength(0);
    expect(seen.some((url) => url.searchParams.get('from') === PREVIOUS_WINDOW.from)).toBe(false);
  });

  it('shows a share over fewer than 4 answers as its answers, never as a percent', async () => {
    serve(page(false, { valid: 3 }));
    renderCard();
    const list = await barList();
    expect(within(list).queryByText(/\d%/)).not.toBeInTheDocument();
    expect(within(list).getAllByText('3 answers').length).toBeGreaterThan(0);
    expect(within(list).getByText('g2.com, Third party: too few answers for a share, 3 answers')).toBeInTheDocument();
  });

  it('narrows the rows to a role but keeps the total of the scope as the denominator', async () => {
    const seen = recordRequests();
    const narrowed = page();
    serve({ ...narrowed, data: narrowed.data.filter((row) => row.domain_role === 'third_party') });
    renderCard('cmp=off', { role: 'third_party' });
    const list = await barList();
    expect(labelsOf(list)).toEqual(['g2.com', 'capterra.com']);
    expect(within(list).getAllByText(/of 18,420 units/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Oct 16 to Nov 12, 2026, 18,420 citation units in 6,210 answers/)).toBeInTheDocument();
    expect(
      seen.find((url) => url.pathname.endsWith('/sources/domains'))?.searchParams.get('filter[domain_role_in]'),
    ).toBe('third_party');
  });

  it('asks the rows of its option and says how many domains are not shown', async () => {
    const seen = recordRequests();
    const all = page();
    serve({ ...all, data: all.data.slice(0, 2), page: { ...all.page, total: 4 } });
    renderCard('cmp=off', { rows: '5' });
    const list = await barList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 more domains are not shown.')).toBeInTheDocument();
    expect(seen.find((url) => url.pathname.endsWith('/sources/domains'))?.searchParams.get('limit')).toBe('5');
  });

  it('links each row to the domain inspector of the Citations page, with the scope of the card', async () => {
    serve(page());
    renderCard('cmp=off&engine=chatgpt_web');
    const list = await barList();
    const link = within(list).getByRole('link', { name: /^g2\.com, Third party/ });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('tab')).toBe('domains');
    expect(href.searchParams.get('inspect')).toBe('domain:g2.com');
    expect(href.searchParams.get('engine')).toBe('chatgpt_web');
  });

  it('leaves a row as plain text where the Citations page cannot show the scope', async () => {
    seam.drill = () => null;
    serve(page());
    renderCard();
    const list = await barList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('reaches each row link with Tab in order, and Enter follows it', async () => {
    seam.drill = () => '/digibranders/fynix/ai/citations' as Route;
    serve(page());
    const { user } = renderCard();
    const list = await barList();
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(4);
    for (const link of links) {
      for (let step = 0; step < 20 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
    const followed = vi.fn();
    at(links, 3).addEventListener('click', (event) => {
      event.preventDefault();
      followed();
    });
    await user.keyboard('{Enter}');
    expect(followed).toHaveBeenCalledOnce();
  });

  it('lists the same rows with their counts in the Table view', async () => {
    serve(page());
    const { user } = renderCard();
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(at(rows, 1)).toHaveTextContent('g2.com10.4%1,912 of 18,420 units');
    expect(at(rows, 2)).toHaveTextContent('fynix.com8.1%1,500 of 18,420 units');
    expect(at(rows, 4)).toHaveTextContent('hubspot.com4.9%900 of 18,420 units');
  });

  it('registers every row for the export under the layout item id, with role and units by engine', async () => {
    serve(page());
    renderCard();
    await barList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Domain', 'Share of citation units', 'Citation units', 'Role', 'Units by engine']);
    expect(block?.rows).toHaveLength(4);
    expect(at(block?.rows ?? [], 0)).toEqual([
      'g2.com',
      '10.4%',
      '1,912 of 18,420 units',
      'Third party',
      formatList(['ChatGPT 1,200', 'Gemini 712']),
    ]);
    expect(at(block?.rows ?? [], 1)[3]).toBe('Own');
  });

  it('has nothing to export while the card loads or has failed', async () => {
    server.use(http.get(DOMAINS, () => failing('req-3')));
    renderCard();
    await screen.findByText('Could not load top cited domains');
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
    serve(page(true), page(true));
    const { container } = renderCard('');
    const list = await barList();
    await within(list).findByText('+1.5 pts');
    const box = list.querySelector('li > :is(a, div)');
    expect(box?.className.split(' ')).toContain(rowClass);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes no dash and no character beyond ASCII in what it draws', async () => {
    serve(page(true), page(true));
    const { container, user } = renderCard('');
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: CAPTION });
    const text = container.textContent;
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toMatch(/ - /);
  });

  it('draws the card on the seeded Eventus world with units and a count on every row', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { world: 'eventus-security', rows: '10' });
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item).toHaveTextContent(/%.*[\d,]+ of [\d,]+ units/);
  });
});

/**
 * The same four domains with role totals that add up to the 18,420 units in scope: the roles hold 3,000, 2,400 and
 * 13,020, so each role has units in domains that are not listed (40 domains in all, 4 listed).
 */
function rolePage(byRole: Partial<Record<DomainRole, number>> = { own: 3000, competitor: 2400, third_party: 13020 }) {
  const base = page();
  return {
    ...base,
    meta: sourcesMeta({ units: TOTAL, answers: 6210, citing: 5100, engines: ENGINES, byRole }),
    page: { ...base.page, total: 40 },
  };
}

const roleTitles = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('[data-slot="role-section-title"]')].map((title) => title.textContent);
const roleTotals = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('[data-slot="role-section-total"]')].map((total) => total.textContent);
const roleSection = (name: string): HTMLElement => screen.getByRole('group', { name });
const roleList = (name: string): HTMLElement =>
  within(roleSection(name)).getByRole('list', { name: `${name} domains by citation units` });
const byRoleRadio = (): HTMLElement => screen.getByRole('radio', { name: 'By role' });

async function openByRole(
  searchParams = 'cmp=off',
  options: RenderOptions = {},
): Promise<ReturnType<typeof renderCard>> {
  const view = renderCard(searchParams, options);
  await barList();
  await view.user.click(byRoleRadio());
  await screen.findByRole('group', { name: options.role === 'third_party' ? 'Third party' : 'Own' });
  return view;
}

describe('the top cited domains card, By role view', () => {
  it('offers Ranked and By role as one single-choice control in the frame, Ranked chosen first', async () => {
    serve(rolePage());
    renderCard();
    await barList();
    const group = screen.getByRole('radiogroup', { name: 'View' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-checked')),
    ).toEqual(['true', 'false']);
    expect(within(group).getByRole('radio', { name: 'Ranked' })).toBeChecked();
    expect(screen.queryByRole('group', { name: 'Own' })).not.toBeInTheDocument();
  });

  it('shows the three role sections in the order Own, Competitor, Third party, each with its role in text', async () => {
    serve(rolePage());
    const { container } = await openByRole();
    expect(roleTitles(container)).toEqual(['Own', 'Competitor', 'Third party']);
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
  });

  it('gives each role its units and share with the count of the scope, never a percent alone', async () => {
    serve(rolePage());
    const { container } = await openByRole();
    expect(roleTotals(container)).toEqual([
      '16.3% of citation units, 3,000 of 18,420 units',
      '13.0% of citation units, 2,400 of 18,420 units',
      '70.7% of citation units, 13,020 of 18,420 units',
    ]);
    for (const total of roleTotals(container)) expect(total).toMatch(/\d%.*[\d,]+ of 18,420 units/);
  });

  it('lists the domains of the Ranked view under their role, in the order of the route, with their counts', async () => {
    serve(rolePage());
    await openByRole();
    expect(labelsOf(roleList('Own'))).toEqual(['fynix.com']);
    expect(labelsOf(roleList('Competitor'))).toEqual(['hubspot.com']);
    expect(labelsOf(roleList('Third party'))).toEqual(['g2.com', 'capterra.com']);
    for (const item of within(roleList('Third party')).getAllByRole('listitem')) {
      expect(item.querySelector('[data-slot="bar-list-context"]')).toHaveTextContent(/^[\d,]+ of 18,420 units$/);
    }
  });

  it('shows a domain that matched two roles under both of them', async () => {
    const base = rolePage();
    serve({
      ...base,
      data: [
        domainRow({ domain: 'medium.com', role: 'third_party', units: 600, total: TOTAL, valid: 6210 }),
        domainRow({ domain: 'medium.com', role: 'competitor', units: 400, total: TOTAL, valid: 6210, entityId: 'e-2' }),
      ],
    });
    await openByRole();
    expect(labelsOf(roleList('Third party'))).toEqual(['medium.com']);
    expect(labelsOf(roleList('Competitor'))).toEqual(['medium.com']);
    expect(screen.queryAllByText('medium.com')).toHaveLength(2);
  });

  it('says how many units of each role are in domains that are not listed, and adds up to the total of the scope', async () => {
    serve(rolePage());
    await openByRole();
    expect(within(roleSection('Own')).getByText('1,500 units in domains not listed')).toBeInTheDocument();
    expect(within(roleSection('Competitor')).getByText('1,500 units in domains not listed')).toBeInTheDocument();
    expect(within(roleSection('Third party')).getByText('9,808 units in domains not listed')).toBeInTheDocument();
  });

  it('writes no remainder line for a role whose units are all in the listed domains', async () => {
    serve(rolePage({ own: 1500, competitor: 900, third_party: 16020 }));
    await openByRole();
    expect(within(roleSection('Own')).queryByText(/not listed/)).not.toBeInTheDocument();
    expect(within(roleSection('Competitor')).queryByText(/not listed/)).not.toBeInTheDocument();
    expect(within(roleSection('Third party')).getByText('12,808 units in domains not listed')).toBeInTheDocument();
  });

  it('says at least, and no total it cannot tell, for a role the read gives no total for', async () => {
    const base = rolePage();
    serve({
      ...base,
      meta: { ...base.meta, by_role: base.meta.by_role.filter((entry) => entry.domain_role !== 'competitor') },
    });
    const { container } = await openByRole();
    expect(roleTotals(container)[1]).toBe('At least 4.9% of citation units, 900 of 18,420 units in the domains listed');
    expect(within(roleSection('Competitor')).queryByText(/not listed/)).not.toBeInTheDocument();
  });

  it('says a role with no unit has none, and no list', async () => {
    const base = rolePage({ own: 0, competitor: 2400, third_party: 16020 });
    serve({ ...base, data: base.data.filter((row) => row.domain_role !== 'own') });
    const { container } = await openByRole();
    expect(roleTotals(container)[0]).toBe('0.0% of citation units, 0 of 18,420 units');
    expect(within(roleSection('Own')).getByText('No citation unit belongs to this role.')).toBeInTheDocument();
    expect(within(roleSection('Own')).queryByRole('list')).not.toBeInTheDocument();
  });

  it('says a role has units but no listed domain when the rows are cut', async () => {
    const base = rolePage();
    serve({ ...base, data: base.data.filter((row) => row.domain_role !== 'competitor') });
    await openByRole();
    expect(
      within(roleSection('Competitor')).getByText('No domain of this role is among the domains listed.'),
    ).toBeInTheDocument();
    expect(within(roleSection('Competitor')).getByText('2,400 units in domains not listed')).toBeInTheDocument();
  });

  it('draws chart-1 for the own domain only, and the role is words in every section and every row', async () => {
    serve(rolePage());
    const { container } = await openByRole();
    const fills = (name: string): string[] =>
      within(roleList(name))
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[data-slot="bar-list-bar"]')?.className ?? '');
    for (const fill of fills('Own')) expect(fill).toContain('bg-chart-1');
    for (const fill of [...fills('Competitor'), ...fills('Third party')]) expect(fill).not.toContain('bg-chart-1');
    expect(roleTitles(container).every((title) => title !== null && title !== '')).toBe(true);
    expect(
      within(roleList('Own')).getByText(
        'fynix.com, Own: 8.1% of citation units, 1,500 of 18,420 units, in 900 answers',
      ),
    ).toBeInTheDocument();
    expect(within(roleList('Competitor')).getByText(/^hubspot\.com, Competitor: 4\.9%/)).toBeInTheDocument();
  });

  it('keeps the total of the scope as the denominator and shows only the role asked for by the role option', async () => {
    const base = rolePage();
    serve({ ...base, data: base.data.filter((row) => row.domain_role === 'third_party') });
    const { container } = await openByRole('cmp=off', { role: 'third_party' });
    expect(roleTitles(container)).toEqual(['Third party']);
    expect(roleTotals(container)).toEqual(['70.7% of citation units, 13,020 of 18,420 units']);
    expect(labelsOf(roleList('Third party'))).toEqual(['g2.com', 'capterra.com']);
  });

  it('reads nothing more for the view: the same request, the address untouched, the same notice as Ranked', async () => {
    const seen = recordRequests();
    const compared = rolePage();
    server.use(
      http.get(DOMAINS, ({ request }) =>
        new URL(request.url).searchParams.get('from') === CURRENT_FROM
          ? HttpResponse.json({
              ...compared,
              meta: { ...compared.meta, compare_window: PREVIOUS_WINDOW, previous_answers: 5000 },
            })
          : failing('req-previous'),
      ),
    );
    const before = window.location.search;
    const { user } = renderCard('');
    await barList();
    expect(await screen.findByText('No comparison: the previous period could not be read')).toBeInTheDocument();
    const requests = seen.length;
    await user.click(byRoleRadio());
    await screen.findByRole('group', { name: 'Own' });
    expect(seen).toHaveLength(requests);
    expect(window.location.search).toBe(before);
    // The rows keep their change column, so a missing comparison is said in this view too
    expect(screen.getByText('No comparison: the previous period could not be read')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Ranked' }));
    expect(await barList()).toBeInTheDocument();
    expect(await screen.findByText('No comparison: the previous period could not be read')).toBeInTheDocument();
  });

  it('says in the By role view that the previous period has no answers, as the Ranked view does', async () => {
    const compared = rolePage();
    serve({ ...compared, meta: { ...compared.meta, compare_window: PREVIOUS_WINDOW, previous_answers: 0 } });
    const { user } = renderCard('');
    await barList();
    expect(await screen.findByText('No comparison: the previous period has no answers')).toBeInTheDocument();
    await user.click(byRoleRadio());
    await screen.findByRole('group', { name: 'Own' });
    expect(screen.getByText('No comparison: the previous period has no answers')).toBeInTheDocument();
  });

  it('draws the change of each row and no comparison notice in the By role view when the comparison is read', async () => {
    const compared = rolePage();
    serve(
      {
        ...compared,
        data: page(true).data,
        meta: { ...compared.meta, compare_window: PREVIOUS_WINDOW, previous_answers: 5000 },
      },
      page(true),
    );
    const { user } = renderCard('');
    await barList();
    await user.click(byRoleRadio());
    await screen.findByRole('group', { name: 'Own' });
    expect(await within(roleList('Third party')).findByText('+1.5 pts')).toBeInTheDocument();
    expect(screen.queryByText(/^No comparison/)).not.toBeInTheDocument();
  });

  it('announces the view that was chosen', async () => {
    serve(rolePage());
    await openByRole();
    expect(document.getElementById('live-region-polite')).toHaveTextContent('View changed to By role');
  });

  it('is operable with the keyboard: the arrow keys move and choose the view, Tab leaves', async () => {
    serve(rolePage());
    const { user } = renderCard();
    await barList();
    screen.getByRole('radio', { name: 'Ranked' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('group', { name: 'Own' })).toBeInTheDocument();
    expect(byRoleRadio()).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    expect(await barList()).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Own' })).not.toBeInTheDocument();
  });

  it('lists every domain and every remainder with its role in the Table view', async () => {
    serve(rolePage());
    const { user } = await openByRole();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Top cited domains by role' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(8);
    expect(at(rows, 0)).toHaveTextContent('RoleDomainShare of citation unitsCitation units');
    expect(at(rows, 1)).toHaveTextContent('Ownfynix.com8.1%1,500 of 18,420 units');
    expect(at(rows, 2)).toHaveTextContent('OwnDomains not listed1,500 units');
    expect(at(rows, 3)).toHaveTextContent('Competitorhubspot.com4.9%900 of 18,420 units');
    expect(at(rows, 5)).toHaveTextContent('Third partyg2.com10.4%1,912 of 18,420 units');
    expect(at(rows, 7)).toHaveTextContent('Third partyDomains not listed9,808 units');
  });

  it('registers the grouped rows for the export under the layout item id, with the remainders', async () => {
    serve(rolePage());
    await openByRole();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Role', 'Domain', 'Share of citation units', 'Citation units', 'Units by engine']);
    expect(block?.rows).toHaveLength(7);
    expect(at(block?.rows ?? [], 0)).toEqual([
      'Own',
      'fynix.com',
      '8.1%',
      '1,500 of 18,420 units',
      formatList(['ChatGPT 1,500']),
    ]);
    expect(at(block?.rows ?? [], 1)).toEqual(['Own', 'Domains not listed', null, '1,500 units', null]);
    expect(at(block?.rows ?? [], 6)).toEqual(['Third party', 'Domains not listed', null, '9,808 units', null]);
  });

  it('describes the roles in the summary, with the units and answers they are counted in', async () => {
    serve(rolePage());
    await openByRole();
    const list = formatList(['Own 16.3%', 'Competitor 13.0%', 'Third party 70.7%']);
    expect(
      screen.getByText(`Top cited domains by role, 18,420 citation units in 6,210 answers: ${list}.`),
    ).toBeInTheDocument();
  });

  it('keeps the sections at full strength with the refetch bar, and says these are the last figures when a refetch fails', async () => {
    serve(rolePage());
    const { queryClient, user } = renderCard();
    await barList();
    await user.click(byRoleRadio());
    await screen.findByRole('group', { name: 'Own' });
    server.use(http.get(DOMAINS, () => failing('req-role')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(roleSection('Third party')).toBeInTheDocument();
  });

  it('is arranged and not used in customize mode: the control and every row link are inside an inert body', async () => {
    seam.drill = () => '/digibranders/fynix/ai/citations' as Route;
    serve(rolePage());
    const Card = (props: CardProps): ReactElement => (
      <div inert data-testid="card-body">
        <TopDomainsCard {...props} options={{ rows: '8', role: 'all' }} />
      </div>
    );
    const { user } = renderWithProviders(cardInOverview({ type: 'sources.top_domains', Card }), {
      searchParams: 'cmp=off',
    });
    const body = await screen.findByTestId('card-body');
    await within(body).findByRole('list', { name: CAPTION });
    const targets = [...body.querySelectorAll('button, a[href], [role="radio"]')];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.closest('[inert]')).toBe(body);
    // The By role view adds no target outside the body either
    await user.click(within(body).getByRole('radio', { name: 'By role' }));
    await within(body).findByRole('group', { name: 'Own' });
    for (const target of body.querySelectorAll('button, a[href], [role="radio"]')) {
      expect(target.closest('[inert]')).toBe(body);
    }
    expect(document.querySelectorAll('[role="radio"]:not([inert] [role="radio"])')).toHaveLength(0);
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
    serve(rolePage());
    const { container } = await openByRole();
    const box = roleList('Own').querySelector('li > :is(a, div)');
    expect(box?.className.split(' ')).toContain(rowClass);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes no dash and no character beyond ASCII in what it draws, in the view and in the Table view', async () => {
    serve(rolePage());
    const { container, user } = await openByRole();
    expect(DASHES.test(container.textContent)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: 'Top cited domains by role' });
    expect(DASHES.test(container.textContent)).toBe(false);
    expect(container.textContent).not.toMatch(/ - /);
  });
});
