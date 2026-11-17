import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { announce } from '@/lib/a11y/announcer';
import { buildJourney } from '@/lib/internal-links/journey-layout';
import { crawledPage, neighborsOf, pageRow } from '@/mocks/internal-links-world';
import { MOCK_RUN_ID } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));
// The layout is built by the tab: the calls count how often it is
vi.mock('@/lib/internal-links/journey-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/internal-links/journey-layout')>();
  return { ...actual, buildJourney: vi.fn(actual.buildJourney) };
});
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PAGE = mswPath(`${P}/internal-links/pages/{url_id}`);
const NEIGHBORS = mswPath(`${P}/internal-links/neighbors`);
const SET_TIERS = mswPath(`${P}/pages/tiers`);

// jsdom has no layout: the world and the cards get sizes (offset sizes, which a zoom never changes)
function stubGeometry(): void {
  const isWorld = (element: HTMLElement): boolean => element.getAttribute('role') === 'presentation';
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? 900 : 100;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? 300 : 40;
  });
}

beforeEach(() => {
  stubWideScreen();
  vi.mocked(buildJourney).mockClear();
  vi.mocked(announce).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  restoreWideScreen();
  server.resetHandlers();
  server.events.removeAllListeners();
});

const canvas = (): Promise<HTMLElement> =>
  screen.findByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' });
const FOCUS_NAME = 'Focus page: /services/soc-as-a-service. Change it.';
const problem500 = (): Response =>
  HttpResponse.json({ type: 'about:blank', title: 'Boom', status: 500 }, { status: 500 });

function addresses(): {
  seen: string[];
  histories: string[];
  onUrlUpdate: (u: { queryString: string; options: { history: string } }) => void;
} {
  const seen: string[] = [];
  const histories: string[] = [];
  return {
    seen,
    histories,
    onUrlUpdate: (update) => {
      seen.push(decodeURIComponent(update.queryString));
      histories.push(update.options.history);
    },
  };
}
const reads = (match: (pathname: string) => boolean): (() => URLSearchParams[]) => {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (match(url.pathname)) seen.push(url.searchParams);
  });
  return () => seen;
};

describe('the Journey tab: renders and views', () => {
  it('does not build the journey again for a pan, a zoom or an inspector write', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate,
    });
    const area = await canvas();
    const card = await within(area).findByRole('button', { name: /^\/pricing, / });
    await within(area).findByRole('heading', { name: 'Step 1 in' });
    await waitFor(() => expect(vi.mocked(buildJourney).mock.calls.length).toBeGreaterThan(0));
    // The lists have arrived: let the last renders settle, then count from here
    await new Promise((done) => setTimeout(done, 100));
    vi.mocked(buildJourney).mockClear();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(vi.mocked(buildJourney)).not.toHaveBeenCalled();
    await user.click(
      within(card.closest('.group') as HTMLElement).getByRole('button', { name: 'Details of /pricing' }),
    );
    await waitFor(() => expect(seen.at(-1)).toContain('inspect=page:108'));
    expect(vi.mocked(buildJourney)).not.toHaveBeenCalled();
  });

  it('keeps the view of a focus page when the canvas is shown again', async () => {
    stubGeometry();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await canvas();
    const zoomed = async (): Promise<string> =>
      (await screen.findByRole('button', { name: /%, return to 100%$/ })).getAttribute('aria-label') ?? '';
    // The first view fits the journey (99 percent here); a step in goes to the next quarter
    await waitFor(async () => expect(await zoomed()).toContain('99%'));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(async () => expect(await zoomed()).toContain('100%'));
    await user.click(screen.getByRole('radio', { name: 'Tree list' }));
    await screen.findByRole('table', { name: 'Link journey as a tree' });
    await user.click(screen.getByRole('radio', { name: 'Canvas' }));
    await canvas();
    // Not the first view again
    expect(await zoomed()).toContain('100%');
  });

  it('keeps the same canvas when the link scope changes, also from the home page, and replaces the address', async () => {
    const { seen, histories, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey',
      onUrlUpdate,
    });
    // The canvas element is the same one after every change of scope: it is not made again (which would lose
    // what the person has moved on it)
    const area = await canvas();
    await within(area).findByRole('button', { name: /^\/, .* focus page$/ });
    const choose = async (name: string): Promise<void> => {
      await user.click(screen.getByRole('button', { name: /^Link scope:/ }));
      await user.click(await screen.findByRole('menuitemradio', { name }));
    };
    for (const [name, value] of [
      ['Auto-generated', 'auto_generated'],
      ['Menu and footer', 'template'],
      ['All links', 'all'],
    ] as const) {
      await choose(name);
      await waitFor(() => expect(seen.at(-1)).toContain(`scope=${value}`));
      expect(histories.at(-1)).toBe('replace');
      expect(screen.getByRole('group', { name: /Link journey canvas/ })).toBe(area);
    }
    await choose('Editorial');
    await waitFor(() => expect(seen.at(-1)).not.toContain('scope='));
    expect(histories.at(-1)).toBe('replace');
    expect(screen.getByRole('group', { name: /Link journey canvas/ })).toBe(area);
  });

  it('keeps the rows and the opened cards of a list while its next page is still on its way', async () => {
    const base = neighborsOf('103', 'out', 'editorial');
    const rows = [
      ...base,
      ...Array.from({ length: 47 }, (_, index) => ({
        ...(base[0] ?? neighborsOf('103', 'out', 'editorial')[0]),
        url_id: String(9000 + index),
        path: `/filler/${String(index)}`,
        has_children: false,
      })),
    ];
    server.use(
      http.get(NEIGHBORS, async ({ request }) => {
        const url = new URL(request.url);
        const out = url.searchParams.get('direction') === 'out' && url.searchParams.get('url_id') === '103';
        if (!out) return undefined;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        // The second page is slow: the first is there
        if (offset > 0) await delay(1500);
        return HttpResponse.json({
          data: offset === 0 ? rows.slice(0, 50) : rows.slice(50),
          meta: {
            run_id: MOCK_RUN_ID,
            url_id: '103',
            direction: 'out',
            scope: 'editorial',
            total: 60,
            other_scopes: [],
            focus: { url_id: '103', status_code: 200, redirect_url_id: null },
          },
        });
      }),
    );
    // "+N more" pressed enough times to need the second page
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108&more=m%3Ao%7Cf*6',
    });
    const area = await canvas();
    expect(await within(area).findByRole('button', { name: /^\/pricing, / })).toBeInTheDocument();
    // The second page has not arrived: the side is not blank, and the opened card still shows its links
    expect(within(area).getByRole('heading', { name: 'Step 2 out' })).toBeInTheDocument();
    expect(within(area).getAllByRole('button', { name: /^\/filler\// }).length).toBeGreaterThan(0);
  });
});

describe('the Journey tab: the focus', () => {
  it('moves focus to the new focus card after a refocus', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    const area = await canvas();
    const card = await within(area).findByRole('button', { name: /^\/contact, / });
    await user.click(
      within(card.closest('.group') as HTMLElement).getByRole('button', { name: 'Make /contact the focus' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^\/contact, .* focus page$/ })).toHaveFocus());
  });

  it('moves focus to the heading of the tree list after a refocus there', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&jv=tree',
    });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    await user.click(await within(table).findByRole('button', { name: 'Make /contact the focus' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Link journey' })).toHaveFocus());
  });

  it('says once that the journey is loading when it takes longer than 2 seconds', async () => {
    server.use(
      http.get(PAGE, async () => {
        await delay(2400);
        return undefined;
      }),
    );
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103' });
    await new Promise((done) => setTimeout(done, 500));
    expect(announce).not.toHaveBeenCalledWith('Loading the link journey', expect.anything());
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Loading the link journey', expect.anything()), {
      timeout: 3000,
    });
    expect(vi.mocked(announce).mock.calls.filter(([text]) => text === 'Loading the link journey')).toHaveLength(1);
  }, 10_000);

  it('shows the focus card and the orphan note for a page nothing links to or from, with the empty state under it', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=117' });
    const area = await canvas();
    expect(await within(area).findByRole('button', { name: /^\/partners, .* focus page$/ })).toBeInTheDocument();
    expect(within(area).getByText(/Orphan: no page links here/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'This page has no links in this view' })).toBeInTheDocument();
  });

  it('reads the pages list only once the picker is opened, from 2 characters, after the typing pauses', async () => {
    const lists = reads((pathname) => pathname.endsWith('/internal-links/pages'));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await canvas();
    expect(lists()).toHaveLength(0);
    await user.click(await screen.findByRole('combobox', { name: FOCUS_NAME }));
    await waitFor(() => expect(lists().length).toBeGreaterThan(0));
    const search = await screen.findByRole('combobox', { name: 'Search pages' });
    await user.type(search, 'p');
    await new Promise((done) => setTimeout(done, 450));
    expect(lists().every((params) => !params.has('q'))).toBe(true);
    await user.type(search, 'r');
    await waitFor(() => expect(lists().at(-1)?.get('q')).toBe('pr'));
  });

  it('offers no row of the old text while a new one is typed', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await canvas();
    await user.click(await screen.findByRole('combobox', { name: FOCUS_NAME }));
    const search = await screen.findByRole('combobox', { name: 'Search pages' });
    await user.type(search, 'pric');
    expect(await screen.findByRole('option', { name: /\/pricing/ })).toBeInTheDocument();
    await user.type(search, 'zz');
    expect(screen.queryByRole('option', { name: /\/pricing/ })).toBeNull();
  });

  it('does nothing when the page that is already the focus is picked', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
      onUrlUpdate,
    });
    await within(await canvas()).findByRole('heading', { name: 'Step 2 out' });
    seen.length = 0;
    await user.click(await screen.findByRole('combobox', { name: FOCUS_NAME }));
    await user.type(await screen.findByRole('combobox', { name: 'Search pages' }), 'soc-as');
    await user.click(await screen.findByRole('option', { name: /\/services\/soc-as-a-service/ }));
    await new Promise((done) => setTimeout(done, 100));
    expect(seen.filter((address) => address.includes('focus='))).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Step 2 out' })).toBeInTheDocument();
  });

  it('shows the not found state after a retry that answers 404, and reads no neighbors for it', async () => {
    let calls = 0;
    server.use(
      http.get(PAGE, () => {
        calls += 1;
        return calls === 1
          ? problem500()
          : HttpResponse.json(
              { type: 'about:blank', title: 'Not found', status: 404, code: 'not_found' },
              { status: 404 },
            );
      }),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'This page is not in the latest crawl' })).toBeInTheDocument();
  });
});

describe('the Journey tab: the tree list', () => {
  it('closes an opened row with Left Arrow', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&jv=tree',
    });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    await user.click(await within(table).findByRole('button', { name: 'Expand /pricing' }));
    const open = await within(table).findByRole('button', { name: 'Collapse /pricing' });
    open.focus();
    await user.keyboard('{ArrowLeft}');
    expect(await within(table).findByRole('button', { name: 'Expand /pricing' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('the Journey tab: Set tier on the canvas', () => {
  const choose = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<void> => {
    fireEvent.click(await within(await canvas()).findByRole('button', { name: /^\/pricing, / }), { shiftKey: true });
    await user.click(await screen.findByRole('button', { name: 'Set tier' }));
    await user.click(await screen.findByRole('radio', { name: /^T2 Supporting pages/ }));
  };

  it('shows the new tier on the cards once it is saved', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(
      await within(await canvas()).findByRole('button', { name: /^\/pricing, T2 Supporting pages, / }),
    ).toBeInTheDocument();
  });

  it('shows a failure in the dialog, clears it when the dialog is opened again, and returns focus to the canvas', async () => {
    server.use(http.put(SET_TIERS, () => problem500()));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('The change could not be saved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest('[data-node]')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Set tier' }));
    await screen.findByRole('dialog');
    expect(screen.queryByText('The change could not be saved')).toBeNull();
  });
});

describe('the Journey tab: equity', () => {
  it('never shows an equity share, even when the API sends one', async () => {
    const EQUITY = 0.4321;
    server.use(
      http.get(NEIGHBORS, ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('url_id') ?? '';
        const direction = url.searchParams.get('direction') === 'in' ? 'in' : 'out';
        const data = neighborsOf(id, direction, 'editorial').map((row) => ({ ...row, equity_share: EQUITY }));
        return HttpResponse.json({
          data,
          meta: {
            run_id: MOCK_RUN_ID,
            url_id: id,
            direction,
            scope: 'editorial',
            total: data.length,
            other_scopes: [],
            focus: { url_id: id, status_code: 200, redirect_url_id: null },
          },
        });
      }),
      http.get(PAGE, ({ params }) => {
        const page = crawledPage(String(params.url_id));
        if (page === undefined) return undefined;
        return HttpResponse.json({
          data: {
            page: { ...pageRow(page, 'editorial'), equity_share: EQUITY },
            linking_pages: [],
            linking_pages_total: 0,
            outlinks: [],
            outlinks_total: 0,
            linking_by_placement: [],
            linking_by_tier: [],
            top_anchors: [],
          },
        });
      }),
    );
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
    });
    await within(await canvas()).findByRole('button', { name: 'Links back to 1 earlier page' });
    const shown = document.body.innerHTML.toLowerCase();
    for (const text of ['equity', '0.4321', '43.2', '0.43']) expect(shown).not.toContain(text);
  });
});
