import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FanoutTopCard from './fanout-top-card';
import { fanoutMeta, fanoutPage, fanoutRow } from './model/fanout-fixtures';
import { at } from './model/source-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider, useOverview } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import { HOSTILE_TITLES, MARKER } from '@/components/app/cells/xss-fixtures';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import type { Schemas } from '@/lib/api/types';
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

const FANOUT = '*/api/v1/workspaces/:w/projects/:p/ai/fanout-queries';
const HEADING = 'What ChatGPT searched';
const CAPTION = 'Searches ChatGPT ran, by the answers that ran them';

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
const fanoutReads = (seen: readonly URL[]): URL[] => seen.filter((url) => url.pathname.endsWith('/fanout-queries'));

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  clearPreferences();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FIVE_DOMAINS = [
  ['g2.com', 'third_party', 31],
  ['fynix.com', 'own', 9],
  ['capterra.com', 'third_party', 8],
  ['hubspot.com', 'competitor', 6],
  ['forbes.com', 'third_party', 4],
] as const;

/** Five queries over 96 valid answers, 80 of which ran a search; ChatGPT is the only engine that shows them. */
function page(over: Parameters<typeof fanoutMeta>[0] = {}): Schemas['FanoutQueryPage'] {
  return fanoutPage(
    [
      fanoutRow({ text: 'best crm for startups', observations: 14, prompts: 3, cited: FIVE_DOMAINS }),
      fanoutRow({
        text: 'crm pricing comparison',
        observations: 11,
        cited: [
          ['g2.com', 'third_party', 20],
          ['capterra.com', 'third_party', 12],
        ],
      }),
      fanoutRow({ text: 'hubspot alternatives', observations: 9, cited: [['hubspot.com', 'competitor', 14]] }),
      fanoutRow({ text: 'crm for small teams reviews', observations: 6, prompts: 1 }),
      fanoutRow({ text: 'zoho vs pipedrive', observations: 3 }),
    ],
    fanoutMeta(over),
  );
}

const serve = (body: Schemas['FanoutQueryPage']): void => {
  server.use(http.get(FANOUT, () => HttpResponse.json(body)));
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
  { rows = '5', world = 'fynix' }: RenderOptions = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <FanoutTopCard {...props} options={{ rows }} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.fanout_top', Card, world }), { searchParams });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('list', { name: CAPTION });
const labelsOf = (list: HTMLElement): (string | null | undefined)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent);
// Built from code points, so this file does not contain the characters it looks for: figure dash, en-dash, em-dash, bar
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);

describe('the fan-out card', () => {
  it('shows a skeleton at its height, then the searches by the answers that ran them', async () => {
    server.use(
      http.get(FANOUT, async () => {
        await delay(60);
        return HttpResponse.json(page());
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame?.querySelector('[style*="height: 240px"]')).not.toBeNull();
    const list = await barList();
    expect(labelsOf(list)).toEqual([
      'best crm for startups',
      'crm pricing comparison',
      'hubspot alternatives',
      'crm for small teams reviews',
      'zoho vs pipedrive',
    ]);
  });

  it('writes how many answers issued each search, of meta.answers, beside every percent', async () => {
    serve(page());
    renderCard();
    const list = await barList();
    expect(
      within(list).getByText(
        'best crm for startups, 14.6% of answers, issued in 14 of 96 answers, 3 prompts, own domain cited',
      ),
    ).toBeInTheDocument();
    expect(
      within(list).getByText('crm pricing comparison, 11.5% of answers, issued in 11 of 96 answers, 3 prompts'),
    ).toBeInTheDocument();
    const items = within(list).getAllByRole('listitem');
    for (const item of items) {
      expect(item.querySelector('[data-slot="bar-list-value"]')).toHaveTextContent(/\d%/);
      expect(item.querySelector('[data-slot="bar-list-context"]')).toHaveTextContent(/^issued in \d+ of 96 answers$/);
    }
  });

  it('takes the share over every valid answer in scope, not over the answers that ran a search', async () => {
    serve(page({ answers: 96, withFanout: 80 }));
    renderCard();
    const list = await barList();
    // 14 of 96 is 14.6%; 14 of 80 would be 17.5%
    expect(within(list).getAllByText('14.6%').length).toBeGreaterThan(0);
    expect(within(list).queryByText('17.5%')).not.toBeInTheDocument();
  });

  it('marks a search whose answers cited a domain of yours with the words, and no other', async () => {
    serve(page());
    renderCard();
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(within(at(items, 0)).getByText('Own domain cited')).toBeInTheDocument();
    for (const index of [1, 2, 3, 4]) expect(within(at(items, index)).queryByText('Own domain cited')).toBeNull();
    // The words carry it: no bar is drawn in the colour of your brand
    for (const item of items) {
      expect(item.querySelector('[data-slot="bar-list-bar"]')?.className ?? '').not.toContain('bg-chart-1');
    }
  });

  it('names the window, the answers and the engines, and what the figures leave out', async () => {
    serve(page({ truncated: 6 }));
    renderCard();
    await barList();
    expect(
      screen.getByText('Oct 16 to Nov 12, 2026, 96 answers, ChatGPT, branded prompts left out'),
    ).toBeInTheDocument();
    expect(screen.getByText('80 of 96 answers ran at least one search.')).toBeInTheDocument();
    expect(
      screen.getByText(
        `Fan-out is not exposed by ${formatList(['Gemini', 'AI Mode'])}, so nothing is counted for them.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '6 answers have a stored list shorter than the searches it ran, so some searches are not counted.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Searches run by fewer than 2 answers are not listed.')).toBeInTheDocument();
  });

  it('says nothing of truncated lists when none is cut', async () => {
    serve(page({ truncated: 0 }));
    renderCard();
    await barList();
    expect(screen.queryByText(/stored list shorter/)).not.toBeInTheDocument();
  });

  it('gives the prompts, the five sources of the answers and the word association in the tooltip of a row', async () => {
    serve(page());
    const { user } = renderCard();
    const list = await barList();
    const trigger = at(within(list).getAllByRole('listitem'), 0).firstElementChild;
    if (trigger === null) throw new Error('The row has no trigger');
    await user.hover(trigger);
    const tip = await screen.findByText(/An association, not a link/);
    expect(tip).toHaveTextContent('On ChatGPT');
    expect(tip).toHaveTextContent('3 prompts');
    expect(tip).toHaveTextContent(
      `Sources in these answers: ${formatList(['g2.com 31 units', 'fynix.com 9 units', 'capterra.com 8 units', 'hubspot.com 6 units', 'forbes.com 4 units'])}`,
    );
  });

  it('leaves each row as plain text: the Fan-out page is not live, so there is no link', async () => {
    serve(page());
    renderCard();
    const list = await barList();
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says fan-out is not exposed, and asks nothing, when the engines asked all show no queries', async () => {
    const seen = recordRequests();
    serve(page());
    renderCard('cmp=off&engine=gemini_web');
    expect(await screen.findByText('Fan-out is not exposed by Gemini')).toBeInTheDocument();
    expect(screen.getByText(/do not show the searches they run/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(fanoutReads(seen)).toHaveLength(0);
  });

  it('says the same when the read itself names every engine in scope as one without fan-out', async () => {
    serve(
      fanoutPage([], fanoutMeta({ answers: 0, withFanout: 0, engines: [], without: ['gemini_web', 'google_ai_mode'] })),
    );
    renderCard();
    expect(
      await screen.findByText(`Fan-out is not exposed by ${formatList(['Gemini', 'AI Mode'])}`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(screen.queryByText('No valid answers in these 28 days')).not.toBeInTheDocument();
  });

  it('lists the searches of the engine that shows them and names the engine asked that does not', async () => {
    serve(page({ without: ['gemini_web'] }));
    renderCard('cmp=off&engine=chatgpt_web,gemini_web');
    await barList();
    expect(screen.getByText('Fan-out is not exposed by Gemini, so nothing is counted for them.')).toBeInTheDocument();
  });

  it('shows the idle state, and asks nothing, when no engine is on for the project', async () => {
    const seen = recordRequests();
    serve(page());
    // Cleanstart has every engine off: the page would not mount the card, so it is rendered inside the provider alone
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject('cleanstart')}
        >
          <FanoutTopCard
            item={{ id: 'bare', type: 'ai.fanout_top' }}
            options={{ rows: '5' }}
            width="half"
            mode="view"
            live
          />
        </OverviewProvider>
      </PermissionProvider>,
      { searchParams: 'cmp=off' },
    );
    expect(await screen.findByText('No engine is on for this project')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(fanoutReads(seen)).toHaveLength(0);
  });

  it('says branded prompts alone cannot be read, and asks nothing', async () => {
    const seen = recordRequests();
    serve(page());
    renderCard('cmp=off&branded=only');
    expect(await screen.findByText('Sources cannot be read for branded prompts alone')).toBeInTheDocument();
    expect(fanoutReads(seen)).toHaveLength(0);
  });

  it('says there is no valid answer when the window has none', async () => {
    serve(fanoutPage([], fanoutMeta({ answers: 0, withFanout: 0 })));
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
  });

  it('says no answer ran a search, with the answers collected, and no zero', async () => {
    serve(fanoutPage([], fanoutMeta({ answers: 40, withFanout: 0 })));
    renderCard();
    expect(await screen.findByText('No answer ran a search in this window')).toBeInTheDocument();
    expect(screen.getByText('40 answers were collected in this window, and none ran a search.')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('says no search reaches the minimum when answers ran searches and no row is listed', async () => {
    serve(fanoutPage([], fanoutMeta({ answers: 40, withFanout: 12, minSupport: 3 })));
    renderCard();
    expect(await screen.findByText('No search was run by 3 or more answers')).toBeInTheDocument();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(FANOUT, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load what ChatGPT searched')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve(page());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('keeps the rows and says these are the last figures read when a refetch fails', async () => {
    serve(page());
    const { queryClient } = renderCard();
    await barList();
    server.use(http.get(FANOUT, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: CAPTION })).toBeInTheDocument();
  });

  it('keeps the rows at full strength with the refetch bar while a new scope is read', async () => {
    let phase: 'first' | 'changed' = 'first';
    server.use(
      http.get(FANOUT, async () => {
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
        <FanoutTopCard {...props} options={{ rows: '5' }} />
      </>
    );
    const { user, container } = renderWithProviders(cardInOverview({ type: 'ai.fanout_top', Card }), {
      searchParams: 'cmp=off',
    });
    await barList();
    await user.click(screen.getByRole('button', { name: 'Include branded' }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(within(screen.getByRole('list', { name: CAPTION })).getAllByRole('listitem')).toHaveLength(5);
    expect(container.querySelector('section')?.className ?? '').not.toMatch(/opacity/);
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });

  it('shows a share over fewer than 4 answers as its answers, never as a percent', async () => {
    serve(page({ answers: 3, withFanout: 3 }));
    renderCard();
    const list = await barList();
    expect(within(list).queryByText(/\d%/)).not.toBeInTheDocument();
    expect(within(list).getAllByText('3 answers').length).toBeGreaterThan(0);
    expect(within(list).getByText('best crm for startups, too few answers for a share, 3 answers')).toBeInTheDocument();
  });

  it('asks the rows of its option, five by default, and says how many searches are not shown', async () => {
    const seen = recordRequests();
    const all = page();
    serve({ ...all, page: { ...all.page, total: 9 } });
    renderCard('cmp=off');
    await barList();
    expect(screen.getByText('4 more searches are not shown.')).toBeInTheDocument();
    expect(fanoutReads(seen)[0]?.searchParams.get('limit')).toBe('5');
  });

  it('asks ten rows when the option says ten', async () => {
    const seen = recordRequests();
    serve(page());
    renderCard('cmp=off', { rows: '10' });
    await barList();
    expect(fanoutReads(seen)[0]?.searchParams.get('limit')).toBe('10');
  });

  it.each(HOSTILE_TITLES)('draws the search text %#, as text and never as markup', async (hostile) => {
    serve(fanoutPage([fanoutRow({ text: hostile, observations: 5 })], fanoutMeta()));
    const { container } = renderCard();
    const list = await barList();
    expect(labelsOf(list)).toEqual([visibleUrlText(hostile)]);
    expect(container.querySelector('img, script, iframe, svg[onload]')).toBeNull();
    expect(Object.hasOwn(window, MARKER)).toBe(false);
    expect(container.innerHTML).not.toMatch(/<img src=x/);
  });

  it('draws a hostile domain in the tooltip as text too', async () => {
    const hostile = '<img src=x onerror="window.' + MARKER + '=1">.com';
    serve(fanoutPage([fanoutRow({ text: 'a search', observations: 5, cited: [[hostile, 'third_party', 3]] })]));
    const { user, container } = renderCard();
    const list = await barList();
    const trigger = at(within(list).getAllByRole('listitem'), 0).firstElementChild;
    if (trigger === null) throw new Error('The row has no trigger');
    await user.hover(trigger);
    await screen.findByText(/An association, not a link/);
    expect(container.querySelector('img')).toBeNull();
    expect(document.body.querySelector('img')).toBeNull();
    expect(Object.hasOwn(window, MARKER)).toBe(false);
  });

  it('reaches the Table button with Tab and shows the table with Enter', async () => {
    serve(page());
    const { user } = renderCard();
    await barList();
    const button = screen.getByRole('button', { name: 'Table' });
    for (let step = 0; step < 20 && document.activeElement !== button; step += 1) await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('table', { name: CAPTION })).toBeInTheDocument();
  });

  it('lists the same rows with their counts in the Table view', async () => {
    serve(page());
    const { user } = renderCard();
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(at(rows, 1)).toHaveTextContent('best crm for startups14.6%issued in 14 of 96 answers');
    expect(at(rows, 5)).toHaveTextContent('zoho vs pipedrive3.1%issued in 3 of 96 answers');
  });

  it('registers every row for the export under the layout item id, with engine, prompts and sources', async () => {
    serve(page());
    renderCard();
    await barList();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'Search',
      'Share of answers',
      'Answers that ran it',
      'Prompts',
      'Engine',
      'Own domain cited',
      'Sources cited with it',
    ]);
    expect(block?.rows).toHaveLength(5);
    expect(at(block?.rows ?? [], 0)).toEqual([
      'best crm for startups',
      '14.6%',
      'issued in 14 of 96 answers',
      3,
      'ChatGPT',
      'Own domain cited',
      formatList([
        'g2.com 31 units',
        'fynix.com 9 units',
        'capterra.com 8 units',
        'hubspot.com 6 units',
        'forbes.com 4 units',
      ]),
    ]);
    expect(at(block?.rows ?? [], 1)[5]).toBeNull();
  });

  it('has nothing to export while the card loads or has failed', async () => {
    server.use(http.get(FANOUT, () => failing('req-3')));
    renderCard();
    await screen.findByText('Could not load what ChatGPT searched');
    expect(sink.read().blocks).toEqual([]);
  });

  it('shows the card in customize mode with every control out of reach', async () => {
    serve(page());
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { container } = renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject('fynix')}
        >
          <div inert>
            <FanoutTopCard
              item={{ id: 'bare', type: 'ai.fanout_top' }}
              options={{ rows: '5' }}
              width="half"
              mode="customize"
              live
            />
          </div>
        </OverviewProvider>
      </PermissionProvider>,
      { searchParams: 'cmp=off' },
    );
    await barList();
    const controls = [...container.querySelectorAll('button, a[href]')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
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
    serve(page());
    const { container } = renderCard();
    const list = await barList();
    const box = list.querySelector('li > :is(a, div)');
    expect(box?.className.split(' ')).toContain(rowClass);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes no dash and no character beyond ASCII in what it draws', async () => {
    serve(page({ truncated: 6 }));
    const { container, user } = renderCard();
    await barList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: CAPTION });
    const text = container.textContent;
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toMatch(/ - /);
  });

  it('draws the card on the seeded Eventus world with a count of answers on every row', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', { world: 'eventus-security', rows: '10' });
    const list = await barList();
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item).toHaveTextContent(/%.*issued in [\d,]+ of [\d,]+ answers/);
  });
});
