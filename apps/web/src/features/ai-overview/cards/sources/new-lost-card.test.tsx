import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changePage, changeRow, diversityEngine, diversityRead } from './model/change-fixtures';
import { at, domainPage, sourcesMeta } from './model/source-fixtures';
import NewLostCard from './new-lost-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider } from '../../overview-context';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { SourceChangePage, SourceChangeRow, SourceDiversity } from '@/lib/citations/types';
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

const P = '*/api/v1/workspaces/:w/projects/:p/ai/sources';
const CHANGES = `${P}/changes`;
const DOMAINS = `${P}/domains`;
const DIVERSITY = `${P}/diversity`;
const HEADING = 'New and lost sources';
const CAPTION_NEW = 'New domains by citation units in this window';
const CAPTION_LOST = 'Lost domains by citation units in the window they were last cited';

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

const NEW_ROWS: SourceChangeRow[] = [
  changeRow({ domain: 'reddit.com', now: 14 }),
  changeRow({ domain: 'fynix.com', role: 'own', now: 9 }),
  changeRow({ domain: 'hubspot.com', role: 'competitor', now: 4, entityId: 'e-2' }),
];
const LOST_ROWS: SourceChangeRow[] = [
  changeRow({ domain: 'oldblog.net', before: 6 }),
  changeRow({ domain: 'wiki.org', before: 3 }),
];

interface World {
  newer?: SourceChangePage;
  lost?: SourceChangePage;
  /** Valid answers in the window before. */
  before?: number;
  diversity?: SourceDiversity | 'fail';
}

function serve({
  newer = changePage('new', NEW_ROWS, { total: 37 }),
  lost = changePage('lost', LOST_ROWS, { total: 5 }),
  before = 5000,
  diversity = diversityRead([diversityEngine('chatgpt_web')], { distinct: 412 }),
}: World = {}): void {
  server.use(
    http.get(CHANGES, ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.get('kind') === 'lost' ? lost : newer),
    ),
    http.get(DOMAINS, () =>
      HttpResponse.json(domainPage([], sourcesMeta({ units: 900, answers: before, engines: ['chatgpt_web'] }))),
    ),
    http.get(DIVERSITY, () => (diversity === 'fail' ? failing('req-div') : HttpResponse.json(diversity))),
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

function renderCard(
  searchParams = 'cmp=off',
  { world = 'fynix' }: { world?: OverviewWorld } = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <NewLostCard {...props} options={{}} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'sources.new_lost', Card, world }), { searchParams });
}

const toolbar = (): Promise<HTMLElement> =>
  screen.findByRole('toolbar', { name: 'Domains new or lost in this window' });
const newList = (): Promise<HTMLElement> => screen.findByRole('list', { name: CAPTION_NEW });
const lostList = (): Promise<HTMLElement> => screen.findByRole('list', { name: CAPTION_LOST });
const labelsOf = (list: HTMLElement): (string | null | undefined)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent);
// Built from code points, so this file does not contain the characters it looks for
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);
// ASCII text, where the number formatters may write a no-break space
const PRINTABLE = new RegExp(`^[\\x20-\\x7e${String.fromCharCode(0xa0)}]*$`);

describe('the new and lost sources card (CH-22, WB-OV-12)', () => {
  it('shows a skeleton at its height, then the tabs with the counts of page.total', async () => {
    server.use(
      http.get(CHANGES, async ({ request }) => {
        await delay(60);
        const kind = new URL(request.url).searchParams.get('kind') === 'lost' ? 'lost' : 'new';
        return HttpResponse.json(
          kind === 'lost' ? changePage('lost', LOST_ROWS, { total: 5 }) : changePage('new', NEW_ROWS, { total: 37 }),
        );
      }),
      http.get(DOMAINS, () => HttpResponse.json(domainPage([], sourcesMeta({ answers: 5000 })))),
      http.get(DIVERSITY, () => HttpResponse.json(diversityRead([diversityEngine('chatgpt_web')]))),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame?.querySelector('[style*="height: 280px"]')).not.toBeNull();
    const tabs = await toolbar();
    // Three rows on screen, a total of 37: the tab says 37
    expect(within(tabs).getByRole('button', { name: 'New, 37' })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: 'Lost, 5' })).toBeInTheDocument();
  });

  it('says how many domains are new as the headline, of the domains cited', async () => {
    serve();
    renderCard();
    await newList();
    expect(screen.getByText('37 new domains')).toBeInTheDocument();
    expect(screen.getByText('of 412 domains cited')).toBeInTheDocument();
  });

  it('leaves out "of N domains cited" while the domains cited are not known', async () => {
    serve({ diversity: 'fail' });
    renderCard();
    await newList();
    expect(screen.getByText('37 new domains')).toBeInTheDocument();
    expect(screen.queryByText(/domains cited/)).not.toBeInTheDocument();
  });

  it('asks one list for each kind, and the answers of the window before', async () => {
    const seen = recordRequests();
    serve();
    renderCard();
    await newList();
    const changes = seen.filter((url) => url.pathname.endsWith('/sources/changes'));
    expect(changes.map((url) => url.searchParams.get('kind')).sort()).toEqual(['lost', 'new']);
    expect(changes.every((url) => url.searchParams.get('min_support') === '2')).toBe(true);
  });

  it('lists the new domains with their units now and before, a role badge, and yours in chart-1', async () => {
    serve();
    renderCard();
    const list = await newList();
    expect(labelsOf(list)).toEqual(['reddit.com', 'fynix.com', 'hubspot.com']);
    const items = within(list).getAllByRole('listitem');
    expect(at(items, 0).querySelector('[data-slot="bar-list-value"]')).toHaveTextContent('14 units');
    expect(at(items, 0).querySelector('[data-slot="bar-list-context"]')).toHaveTextContent('14 now, 0 before');
    expect(within(at(items, 0)).getByText('Third party')).toBeInTheDocument();
    expect(within(at(items, 1)).getByText('Own')).toBeInTheDocument();
    expect(within(at(items, 2)).getByText('Competitor')).toBeInTheDocument();
    const fills = items.map((item) => item.querySelector('[data-slot="bar-list-bar"]')?.className ?? '');
    expect(at(fills, 1)).toContain('bg-chart-1');
    expect(at(fills, 0)).not.toContain('bg-chart-1');
    expect(
      within(list).getByText(/^reddit\.com, Third party: new, 14 citation units now, 0 citation units before$/),
    ).toBeInTheDocument();
  });

  it('says how many domains are not shown', async () => {
    serve();
    renderCard();
    await newList();
    expect(screen.getByText('34 more domains are not shown.')).toBeInTheDocument();
  });

  it('switches to the lost domains, drawn by the units they had before', async () => {
    serve();
    const { user } = renderCard();
    const tabs = await toolbar();
    await user.click(within(tabs).getByRole('button', { name: 'Lost, 5' }));
    const list = await lostList();
    expect(labelsOf(list)).toEqual(['oldblog.net', 'wiki.org']);
    const first = at(within(list).getAllByRole('listitem'), 0);
    expect(first.querySelector('[data-slot="bar-list-value"]')).toHaveTextContent('6 units');
    expect(first.querySelector('[data-slot="bar-list-context"]')).toHaveTextContent('0 now, 6 before');
    expect(screen.queryByRole('list', { name: CAPTION_NEW })).not.toBeInTheDocument();
    // The headline stays the count of new domains
    expect(screen.getByText('37 new domains')).toBeInTheDocument();
  });

  it('shows both lists when Both is pressed', async () => {
    serve();
    const { user } = renderCard();
    const tabs = await toolbar();
    await user.click(within(tabs).getByRole('button', { name: 'Both, 42' }));
    expect(await newList()).toBeInTheDocument();
    expect(await lostList()).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: 'Both, 42' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('operates the tabs with the keyboard, keeps one pressed, and says what it now shows', async () => {
    serve();
    const { user } = renderCard();
    const tabs = await toolbar();
    const buttons = within(tabs).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // One Tab stop: the pressed tab
    expect(buttons.map((button) => button.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    at(buttons, 1).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(at(buttons, 2));
    await user.keyboard('{Enter}');
    expect(at(buttons, 2)).toHaveAttribute('aria-pressed', 'true');
    expect(at(buttons, 1)).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('Lost domains shown, 5 domains');
    });
    expect(await lostList()).toBeInTheDocument();
  });

  it('says new sources cannot be told, and never 0 new, when the window before has no answers', async () => {
    serve({ before: 0, newer: changePage('new', [changeRow({ domain: 'a.com', now: 5 })], { total: 80 }) });
    renderCard();
    // The sentence is the headline and, as its reason, the tooltip of the disabled New tab
    const sentences = await screen.findAllByText('No answers in the window before: new sources cannot be told');
    expect(sentences.some((node) => node.tagName === 'P')).toBe(true);
    const tabs = await toolbar();
    const unknown = within(tabs).getByRole('button', { name: 'New, n/a' });
    expect(unknown).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/new domains?$/)).not.toBeInTheDocument();
    expect(screen.queryByText('a.com')).not.toBeInTheDocument();
    // The lost list still shows what the route returned
    expect(await lostList()).toBeInTheDocument();
  });

  it('says the window before could not be read, and that new sources cannot be told', async () => {
    server.use(
      http.get(CHANGES, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get('kind') === 'lost'
            ? changePage('lost', LOST_ROWS, { total: 5 })
            : changePage('new', NEW_ROWS, { total: 37 }),
        ),
      ),
      http.get(DOMAINS, () => failing('req-before')),
      http.get(DIVERSITY, () => HttpResponse.json(diversityRead([diversityEngine('chatgpt_web')]))),
    );
    renderCard();
    const sentences = await screen.findAllByText('The window before could not be read: new sources cannot be told');
    expect(sentences.some((node) => node.tagName === 'P')).toBe(true);
    expect(await screen.findByText('No comparison: the previous period could not be read')).toBeInTheDocument();
    expect(screen.queryByText(/37/)).not.toBeInTheDocument();
  });

  it('says 0 new domains, with the rule, when the window before has answers and none is new', async () => {
    serve({ newer: changePage('new', [], { total: 0 }) });
    renderCard();
    expect(await screen.findByText('0 new domains')).toBeInTheDocument();
    expect(screen.getByText('No domain is new in this window')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A domain is new when it has 2 or more citation units in this window and none in the window before.',
      ),
    ).toBeInTheDocument();
  });

  it('explains why a lost list is empty: a lost domain needs 2 windows after its last citation', async () => {
    serve({ lost: changePage('lost', [], { total: 0 }) });
    const { user } = renderCard();
    const tabs = await toolbar();
    await user.click(within(tabs).getByRole('button', { name: 'Lost, 0' }));
    expect(await screen.findByText('No domain is lost in this window')).toBeInTheDocument();
    expect(screen.getByText(/a lost domain needs 2 windows after its last citation/)).toBeInTheDocument();
  });

  it('names the window, the engines the units are pooled over, the rule and the flagged citations', async () => {
    serve();
    renderCard();
    await newList();
    expect(
      screen.getByText(/^Oct 16 to Nov 12, 2026, ChatGPT and Gemini, branded prompts left out$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Citation units are pooled over ChatGPT and Gemini/)).toBeInTheDocument();
    expect(
      screen.getByText(/^New: 2 or more citation units in this window and none in the window before\. Lost:/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Citations flagged as unresolved redirects or engine-internal links are left out.'),
    ).toBeInTheDocument();
  });

  it('links each row to the new and lost tab of the Citations page, with the scope of the card', async () => {
    serve();
    const { user } = renderCard('cmp=off&engine=chatgpt_web');
    const list = await newList();
    const link = within(list).getByRole('link', { name: /^reddit\.com, Third party/ });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('tab')).toBe('new-lost');
    expect(href.searchParams.get('kind')).toBe('new');
    expect(href.searchParams.get('engine')).toBe('chatgpt_web');
    const tabs = await toolbar();
    await user.click(within(tabs).getByRole('button', { name: 'Lost, 5' }));
    const lost = await lostList();
    const lostHref = new URL(within(lost).getAllByRole('link')[0]?.getAttribute('href') ?? '', 'http://localhost');
    expect(lostHref.searchParams.get('kind')).toBe('lost');
  });

  it('leaves a row as plain text where the Citations page cannot show the scope', async () => {
    seam.drill = () => null;
    serve();
    renderCard();
    const list = await newList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('reaches each row link with Tab in order', async () => {
    seam.drill = () => '/digibranders/fynix/ai/citations' as Route;
    serve();
    const { user } = renderCard();
    const list = await newList();
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(3);
    for (const link of links) {
      for (let step = 0; step < 20 && document.activeElement !== link; step += 1) await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });

  it('lists every row read, with its units, in the Table view', async () => {
    serve();
    const { user } = renderCard();
    await newList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION_NEW });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(at(rows, 1)).toHaveTextContent('reddit.com14 units14 now, 0 before');
  });

  it('registers both lists for the export under the layout item id, with role and units now and before', async () => {
    serve();
    renderCard();
    await newList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['Change', 'Domain', 'Role', 'Citation units now', 'Citation units before']);
    expect(block?.rows).toHaveLength(5);
    expect(at(block?.rows ?? [], 0)).toEqual(['New', 'reddit.com', 'Third party', 14, 0]);
    expect(at(block?.rows ?? [], 3)).toEqual(['Lost', 'oldblog.net', 'Third party', 0, 6]);
  });

  it('has nothing to export while the card loads or has failed', async () => {
    server.use(http.get(CHANGES, () => failing('req-x')));
    renderCard();
    await screen.findByText('Could not load new and lost sources');
    expect(sink.read().blocks).toEqual([]);
  });

  it('shows the idle state, and asks nothing, when no engine is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(CHANGES, () => {
        asked();
        return HttpResponse.json(changePage('new', []));
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
          <NewLostCard item={{ id: 'bare', type: 'sources.new_lost' }} options={{}} width="half" mode="view" live />
        </OverviewProvider>
      </PermissionProvider>,
      { searchParams: 'cmp=off' },
    );
    expect(await screen.findByText('No engine is on for this project')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says branded prompts alone cannot be read for sources, and asks nothing', async () => {
    const asked = vi.fn();
    server.use(
      http.get(CHANGES, () => {
        asked();
        return HttpResponse.json(changePage('new', []));
      }),
    );
    renderCard('cmp=off&branded=only');
    expect(await screen.findByText('Sources cannot be read for branded prompts alone')).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(CHANGES, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load new and lost sources')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await newList()).toBeInTheDocument();
  });

  it('keeps the lists and says these are the last figures read when a refetch fails', async () => {
    serve();
    const { queryClient } = renderCard();
    await newList();
    server.use(http.get(CHANGES, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: CAPTION_NEW })).toBeInTheDocument();
  });

  it('keeps the lists at full strength with the refetch bar while the lists are read again', async () => {
    serve();
    const { queryClient, container } = renderCard();
    await newList();
    server.use(
      http.get(CHANGES, async () => {
        await delay(200);
        return HttpResponse.json(changePage('new', NEW_ROWS, { total: 37 }));
      }),
    );
    void queryClient.refetchQueries({ queryKey: [] });
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(screen.getByRole('list', { name: CAPTION_NEW })).toBeInTheDocument();
    expect(container.querySelector('section')?.className ?? '').not.toMatch(/opacity/);
  });

  it('is arranged and not used in customize mode: every button and link of the card is inside an inert body', async () => {
    serve();
    const Card = (props: CardProps): ReactElement => (
      <div inert data-testid="card-body">
        <NewLostCard {...props} />
      </div>
    );
    renderWithProviders(cardInOverview({ type: 'sources.new_lost', Card }), { searchParams: 'cmp=off' });
    const body = await screen.findByTestId('card-body');
    await within(body).findByRole('list', { name: CAPTION_NEW, hidden: true });
    const targets = [...body.querySelectorAll('button, a[href]')];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.closest('[inert]')).toBe(body);
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
    const list = await newList();
    expect(list.querySelector('li > :is(a, div)')?.className.split(' ')).toContain(rowClass);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes no dash and no character beyond ASCII in what it draws', async () => {
    serve();
    const { container, user } = renderCard();
    await newList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: CAPTION_NEW });
    const text = container.textContent;
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toMatch(/ - /);
    expect(text).toMatch(PRINTABLE);
  });

  it('draws the card on the seeded Eventus world', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { world: 'eventus-security' });
    await toolbar();
    await waitFor(() => {
      expect(screen.queryByText(/^Could not load/)).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^New, / })).toBeInTheDocument();
  });
});
