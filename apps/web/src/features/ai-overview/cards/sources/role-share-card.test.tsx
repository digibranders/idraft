import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metaWithSplit, type EngineSplit } from './model/page-fixtures';
import RoleShareCard from './role-share-card';
import { domainPage, at, sourcesMeta } from './model/source-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider, useOverview } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import type { SourceDomainPage } from '@/lib/citations/types';
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

const DOMAINS = '*/api/v1/workspaces/:w/projects/:p/ai/sources/domains';
const HEADING = 'Citation share by source role and engine';
const CAPTION = 'Citation units by source role, by engine';

const ENGINES = ['chatgpt_web', 'gemini_web'] as const;
const CHATGPT: EngineSplit = {
  engine: 'chatgpt_web',
  own: [300, 120],
  competitor: [600, 200],
  thirdParty: [1100, 300],
};
const GEMINI: EngineSplit = { engine: 'gemini_web', own: [112, 60], competitor: [188, 70], thirdParty: [400, 90] };
const SILENT: EngineSplit = { engine: 'gemini_web', own: [0, 0], competitor: [0, 0], thirdParty: [0, 0] };
const THIN: EngineSplit = { engine: 'gemini_web', own: [3, 1], competitor: [2, 1], thirdParty: [1, 1] };

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
  clearPreferences();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const split = (...engines: EngineSplit[]): SourceDomainPage =>
  domainPage([], metaWithSplit(engines, { answers: 400 }), 0);
const serve = (body: SourceDomainPage = split(CHATGPT, GEMINI)): void => {
  server.use(http.get(DOMAINS, () => HttpResponse.json(body)));
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

function renderCard(searchParams = 'cmp=off', world: OverviewWorld = 'fynix'): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <RoleShareCard {...props} />
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.citation_share_by_domain_type', Card, world }), {
    searchParams,
  });
}

const engineRows = (): Promise<HTMLElement[]> =>
  screen.findByRole('list', { name: CAPTION }).then((list) => within(list).getAllByRole('listitem'));
// Built from code points, so this file does not contain the characters it looks for: figure dash, en-dash, em-dash, bar
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);

describe('the citation share by source role card', () => {
  it('shows a skeleton at its height, then one row for each engine in the order of the catalog', async () => {
    server.use(
      http.get(DOMAINS, async () => {
        await delay(60);
        return HttpResponse.json(split(GEMINI, CHATGPT));
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame?.querySelector('[style*="height: 180px"]')).not.toBeNull();
    const rows = await engineRows();
    expect(rows).toHaveLength(2);
    expect(at(rows, 0)).toHaveTextContent(/^ChatGPT/);
    expect(at(rows, 1)).toHaveTextContent(/^Gemini/);
  });

  it('asks the split by engine with one row of domains, no comparison and the scope of the strip', async () => {
    const seen = recordRequests();
    serve();
    renderCard();
    await engineRows();
    const read = seen.find((url) => url.pathname.endsWith('/sources/domains'));
    expect(read?.searchParams.get('include')).toBe('by_role_by_engine');
    expect(read?.searchParams.get('limit')).toBe('1');
    expect(read?.searchParams.has('compare')).toBe(false);
    expect(read?.searchParams.has('filter[domain_role_in]')).toBe(false);
  });

  it('keeps the engines as separate rows, each over its own units, and never adds them', async () => {
    serve();
    renderCard();
    const rows = await engineRows();
    expect(at(rows, 0)).toHaveTextContent('of 2,000 citation units');
    expect(at(rows, 1)).toHaveTextContent('of 700 citation units');
    expect(screen.queryByText(/of 2,700/)).not.toBeInTheDocument();
  });

  it('names every role with its share and its count in the image of the bar, and in the legend', async () => {
    serve();
    renderCard();
    const image = within(at(await engineRows(), 0)).getByRole('img');
    expect(image).toHaveAttribute(
      'aria-label',
      `ChatGPT: ${formatList(['Own 15.0%, 300 of 2,000 units', 'Competitor 30.0%, 600 of 2,000 units', 'Third party 55.0%, 1,100 of 2,000 units'])}, of 2,000 citation units`,
    );
    const legend = screen.getByRole('table', { name: CAPTION });
    expect(within(legend).getByText('15.0%, 300 of 2,000 units')).toBeInTheDocument();
    expect(within(legend).getByText('26.9%, 188 of 700 units')).toBeInTheDocument();
  });

  it('draws the own segment in chart-1 and no other segment or swatch in it', async () => {
    serve();
    const { container } = renderCard();
    await engineRows();
    const fill = (selector: string): string[] =>
      [...container.querySelectorAll(selector)].map((element) => element.className);
    for (const className of fill(
      '[data-slot="share-segment"][data-segment="own"], [data-slot="share-swatch"][data-segment="own"]',
    )) {
      expect(className).toContain('bg-chart-1');
    }
    for (const role of ['competitor', 'third_party']) {
      for (const className of fill(
        `[data-slot="share-segment"][data-segment="${role}"], [data-slot="share-swatch"][data-segment="${role}"]`,
      )) {
        expect(className).not.toContain('bg-chart-1');
      }
    }
    expect(container.querySelector('[data-segment="third_party"]')?.className).toContain('bg-chart-other');
    expect(container.querySelector('[data-segment="competitor"]')?.className).toContain('bg-chart-2');
  });

  it('says an engine with no citation unit has none, with no bar and no percent', async () => {
    serve(split(CHATGPT, SILENT));
    renderCard();
    const gemini = at(await engineRows(), 1);
    expect(gemini).toHaveTextContent('No citation on this engine');
    expect(within(gemini).queryByRole('img')).not.toBeInTheDocument();
    expect(gemini).not.toHaveTextContent(/%/);
    const legend = screen.getByRole('table', { name: CAPTION });
    expect(within(legend).getAllByText('No citation on this engine').length).toBeGreaterThan(0);
    expect(within(legend).queryByText(/^0%/)).not.toBeInTheDocument();
  });

  it('says how few answers stand behind an engine, with its units, and draws no bar, when there are fewer than 4', async () => {
    serve(split(CHATGPT, THIN));
    renderCard();
    const gemini = at(await engineRows(), 1);
    expect(gemini).toHaveTextContent('3 citing answers, 6 units');
    expect(gemini).not.toHaveTextContent(/%/);
    expect(within(gemini).queryByRole('img')).not.toBeInTheDocument();
  });

  it('explains the too few mark in the footnote: fewer than 4 answers, and the count is an upper bound', async () => {
    serve(split(CHATGPT, THIN));
    renderCard();
    await engineRows();
    expect(
      screen.getByText(
        'An engine is marked too few when fewer than 4 answers cite on it. The answer count shown is an upper bound, because one answer can cite several roles.',
      ),
    ).toBeInTheDocument();
  });

  it('says the per-engine split is not available, never none and never 0%, when the read carries no split', async () => {
    server.use(
      http.get(DOMAINS, () =>
        HttpResponse.json(domainPage([], sourcesMeta({ units: 900, answers: 40, citing: 30, engines: ENGINES }), 0)),
      ),
    );
    const { container, user } = renderCard();
    const rows = await engineRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveTextContent('Per-engine split not available in this read');
    expect(container.textContent).not.toMatch(/No citation on this engine|%/);
    expect(container.querySelector('[role="img"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION });
    expect(within(table).queryByText('No citation on this engine')).not.toBeInTheDocument();
    expect(sink.read().blocks[0]?.rows[0]).toEqual(['ChatGPT', 'Own', null, null, null, 'unavailable']);
  });

  it('is arranged and not used in customize mode: every button and link of the card is inside an inert body', async () => {
    serve();
    const Card = (props: CardProps): ReactElement => (
      <div inert data-testid="card-body">
        <RoleShareCard {...props} />
      </div>
    );
    renderWithProviders(cardInOverview({ type: 'ai.citation_share_by_domain_type', Card }), {
      searchParams: 'cmp=off',
    });
    const body = await screen.findByTestId('card-body');
    await within(body).findByRole('list', { name: CAPTION, hidden: true });
    const targets = [...body.querySelectorAll('button, a[href]')];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.closest('[inert]')).toBe(body);
  });

  it('names the window, the units and answers, and the engines, and says roles only and flagged left out', async () => {
    serve();
    renderCard();
    await engineRows();
    const engines = formatList(['ChatGPT', 'Gemini']);
    expect(
      screen.getByText(
        `Oct 16 to Nov 12, 2026, 2,700 citation units in 400 answers, ${engines}, branded prompts left out`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Each bar is one engine/)).toBeInTheDocument();
    expect(screen.getByText(/Roles only/)).toBeInTheDocument();
    expect(
      screen.getByText('Citations flagged as unresolved redirects or engine-internal links are left out.'),
    ).toBeInTheDocument();
  });

  it('draws no pie, no donut and no canvas: a bar of divs', async () => {
    serve();
    const { container } = renderCard();
    await engineRows();
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg path[d*="A"], svg circle[r]:not([r="1"])')).toBeNull();
  });

  it('adds a pattern to each segment when Patterns is on', async () => {
    serve();
    const { user, container } = renderCard();
    await engineRows();
    expect(container.querySelector('[data-pattern]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Patterns' }));
    expect(container.querySelector('[data-pattern]')).not.toBeNull();
  });

  it('shows the idle state, and asks nothing, when no engine is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DOMAINS, () => {
        asked();
        return HttpResponse.json(split(CHATGPT));
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
          <RoleShareCard
            item={{ id: 'bare', type: 'ai.citation_share_by_domain_type' }}
            options={{}}
            width="half"
            mode="view"
            live
          />
        </OverviewProvider>
      </PermissionProvider>,
      { searchParams: 'cmp=off' },
    );
    expect(await screen.findByText('No engine is on for this project')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says branded prompts alone cannot be read for sources, and asks nothing', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DOMAINS, () => {
        asked();
        return HttpResponse.json(split(CHATGPT));
      }),
    );
    renderCard('cmp=off&branded=only');
    expect(await screen.findByText('Sources cannot be read for branded prompts alone')).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says no answer cited a source, and no valid answer, each with its words and no zero', async () => {
    serve(domainPage([], sourcesMeta({ units: 0, answers: 40, citing: 0, engines: ['chatgpt_web'] }), 0));
    const { unmount } = renderCard();
    expect(await screen.findByText('No answer cited a source in this window')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    unmount();
    serve(domainPage([], sourcesMeta({ units: 0, answers: 0, citing: 0, engines: ['chatgpt_web'] }), 0));
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(DOMAINS, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load citation share by source role')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await engineRows()).toHaveLength(2);
  });

  it('keeps the bars and says these are the last figures read when a refetch fails', async () => {
    serve();
    const { queryClient } = renderCard();
    await engineRows();
    server.use(http.get(DOMAINS, () => failing('req-2')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: CAPTION })).toBeInTheDocument();
  });

  it('keeps the bars at full strength with the refetch bar while a new scope is read', async () => {
    let phase: 'first' | 'changed' = 'first';
    server.use(
      http.get(DOMAINS, async () => {
        if (phase === 'changed') await delay(200);
        return HttpResponse.json(split(CHATGPT, GEMINI));
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
        <RoleShareCard {...props} />
      </>
    );
    const { user, container } = renderWithProviders(
      cardInOverview({ type: 'ai.citation_share_by_domain_type', Card }),
      { searchParams: 'cmp=off' },
    );
    await engineRows();
    await user.click(screen.getByRole('button', { name: 'Include branded' }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(within(screen.getByRole('list', { name: CAPTION })).getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('section')?.className ?? '').not.toMatch(/opacity/);
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });

  it('lists the same shares with their counts in the Table view, a row for each role', async () => {
    serve();
    const { user } = renderCard();
    await engineRows();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: CAPTION });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(at(rows, 0)).toHaveTextContent('Source roleChatGPTGemini');
    expect(at(rows, 1)).toHaveTextContent('Own15.0%, 300 of 2,000 units16.0%, 112 of 700 units');
    expect(at(rows, 3)).toHaveTextContent('Third party55.0%, 1,100 of 2,000 units57.1%, 400 of 700 units');
  });

  it('registers each engine and role for the export under the layout item id, unknown as an empty cell', async () => {
    serve(split(CHATGPT, SILENT));
    renderCard();
    await engineRows();
    const [block] = sink.read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'Engine',
      'Role',
      'Share of citation units',
      'Citation units',
      'Total citation units',
      'Status',
    ]);
    expect(block?.rows).toHaveLength(6);
    expect(at(block?.rows ?? [], 0)).toEqual(['ChatGPT', 'Own', '15.0%', 300, 2000, 'ok']);
    expect(at(block?.rows ?? [], 3)).toEqual(['Gemini', 'Own', null, null, null, 'none']);
  });

  it('has nothing to export while the card loads or has failed', async () => {
    server.use(http.get(DOMAINS, () => failing('req-3')));
    renderCard();
    await screen.findByText('Could not load citation share by source role');
    expect(sink.read().blocks).toEqual([]);
  });

  it('keeps its legend table inside a region that scrolls, so a 390 px card does not overflow', async () => {
    vi.stubGlobal('innerWidth', 390);
    serve();
    const { container } = renderCard();
    await engineRows();
    const legend = screen.getByRole('table', { name: CAPTION });
    expect(legend.closest('.overflow-x-auto')).not.toBeNull();
    expect(container.querySelector('[data-slot="share-segment"]')?.closest('.overflow-hidden')).not.toBeNull();
  });

  it('reaches Patterns and Table with Tab, and Enter switches the view', async () => {
    serve();
    const { user } = renderCard();
    await engineRows();
    const table = screen.getByRole('button', { name: 'Table' });
    for (let step = 0; step < 20 && document.activeElement !== table; step += 1) await user.tab();
    expect(document.activeElement).toBe(table);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('table', { name: CAPTION })).toBeInTheDocument();
  });

  it.each([
    ['compact', undefined, 'h-6'],
    ['default', 'default', 'h-8'],
  ] as const)('passes axe in %s density, with the bar height of the density', async (_name, density, barClass) => {
    if (density !== undefined) {
      localStorage.setItem(
        preferenceKey(mockUser('admin').user_id, 'settings'),
        JSON.stringify({ tableDensity: density }),
      );
    }
    serve();
    const { container } = renderCard();
    await engineRows();
    expect(container.querySelector('[role="img"]')?.className.split(' ')).toContain(barClass);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('writes no dash and no character beyond ASCII in what it draws', async () => {
    serve(split(CHATGPT, SILENT));
    const { container, user } = renderCard();
    await engineRows();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: CAPTION });
    const text = container.textContent;
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toMatch(/ - /);
  });

  it('draws the card on the seeded Eventus world, each engine over its own units', async () => {
    setAiSeeded(true);
    renderCard('cmp=off', 'eventus-security');
    const rows = await engineRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveTextContent(/of [\d,]+ citation units|No citation on this engine|\d+ answers?/);
    }
  });
});
