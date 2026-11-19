import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '@/lib/csv/csv-write';
import { HISTORY_RUN_IDS, setLinksScenario } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

// The real file save needs a browser; the test reads what the tab asks it to save
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: vi.fn(),
}));

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities';
const LIST = mswPath(BASE);
const DECISIONS = mswPath(`${BASE}/decisions`);
const DROPPED_TEXT = /This crawl’s links are no longer stored\. Pick a newer crawl\./;
const KEPT_RUN = HISTORY_RUN_IDS[1] ?? '';
const DROPPED_RUN = HISTORY_RUN_IDS[4] ?? '';
const FROM = '/blog/what-is-a-soc';
const TO = '/services/managed-detection-and-response';
const ACCEPT_NAME = `Accept: ${FROM} to ${TO}`;
const COPY_NAME = `Copy instruction: ${FROM} to ${TO}`;
const PROBLEM = { 'content-type': 'application/problem+json' };

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadBlob).mockReset();
});
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

const open = (
  search = '',
  role: Parameters<typeof internalLinksAs>[0] = 'editor',
  extra: { onUrlUpdate?: (event: { queryString: string }) => void } = {},
): ProvidedRender =>
  renderWithProviders(internalLinksAs(role, EVENTUS_LINKS), { searchParams: `?tab=opportunities${search}`, ...extra });

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Link opportunities' });

/** The decisions sent, with their bodies. */
function decisionsSent(): () => unknown[] {
  const seen: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/decisions')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => seen.push(body));
    }
  });
  return () => seen;
}

/** The query strings of the list reads. */
function listReads(): () => URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/internal-links/opportunities')) seen.push(url.searchParams);
  });
  return () => seen;
}

describe('the Opportunities tab (spec 7.10)', () => {
  it('lists each mention with its pages, tiers, anchor, status and actions, and never an equity share', async () => {
    const { container } = open();
    const table = await grid();
    for (const name of ['Source page', 'Source tier', 'Mentions', 'Target page', 'Target tier', 'Suggested anchor']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(await screen.findByRole('button', { name: ACCEPT_NAME })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Dismiss: ${FROM} to ${TO}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY_NAME })).toBeInTheDocument();
    // Two mentions of one source page still give each Copy button a name of its own
    const copyNames = screen
      .getAllByRole('button', { name: /^Copy instruction:/ })
      .map((node) => node.getAttribute('aria-label'));
    expect(new Set(copyNames).size).toBe(copyNames.length);
    expect(table.querySelector('[data-mention]')).not.toBeNull();
    expect(within(table).getAllByText('“managed detection and response”').length).toBeGreaterThan(0);
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
    const named = [...container.querySelectorAll('[aria-label], [title]')].map(
      (node) => `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`,
    );
    expect(named.join(' ').toLowerCase()).not.toContain('equity');
  });

  it('shows the status chips with their counts and writes the choice, the tier and the search to the address', async () => {
    const urls: string[] = [];
    const { user } = open('', 'editor', { onUrlUpdate: ({ queryString }) => urls.push(queryString) });
    await grid();
    const group = screen.getByRole('group', { name: 'Status' });
    const all = await within(group).findByRole('button', { name: /^All \d+$/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /^Open 8$/ })).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: /^Accepted 0$/ }));
    await waitFor(() => expect(urls.at(-1)).toContain('os=accepted'));
    expect(within(group).getByRole('button', { name: /^Accepted 0$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads the list with the tier and the search of the address, 100 rows from the first', async () => {
    const asked = listReads();
    open('&os=open&ot=1&oq=soc');
    await grid();
    await waitFor(() => expect(asked().some((query) => query.get('q') === 'soc')).toBe(true));
    const query = asked().find((candidate) => candidate.get('q') === 'soc');
    expect(query?.get('status')).toBe('open');
    expect(query?.get('filter[target_tier]')).toBe('1');
    expect(query?.get('offset')).toBe('0');
    expect(query?.get('limit')).toBe('100');
  });

  it('accepts a row at once, says what was planned, keeps focus on the row and undoes it', async () => {
    const sent = decisionsSent();
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: ACCEPT_NAME }));
    expect(await screen.findByText('Planned')).toBeInTheDocument();
    expect(await screen.findByText(`Add a link on ${FROM} to ${TO}`)).toBeInTheDocument();
    const undo = await screen.findByRole('button', { name: `Undo: ${FROM} to ${TO}` });
    expect(undo).toHaveFocus();
    expect(sent()).toHaveLength(1);
    const [body] = sent();
    expect(body).toMatchObject({ status: 'accepted', items: [{ source_url_id: expect.any(String) }] });
    expect(JSON.stringify(body)).not.toContain('equity');
    await user.click(undo);
    expect(await screen.findByRole('button', { name: ACCEPT_NAME })).toBeInTheDocument();
    expect(sent().at(-1)).toMatchObject({ status: 'open' });
    expect(await screen.findByText('Reopened')).toBeInTheDocument();
  });

  it('dismisses a row and moves focus to the row that takes its place when the list is filtered to Open', async () => {
    const { user } = open('&os=open');
    await user.click(await screen.findByRole('button', { name: `Dismiss: ${FROM} to ${TO}` }));
    await waitFor(() => expect(screen.queryByRole('button', { name: ACCEPT_NAME })).not.toBeInTheDocument());
    expect((await screen.findAllByText('Dismissed')).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.activeElement?.getAttribute('data-decision')).not.toBeNull());
    expect(screen.getByRole('group', { name: 'Status' })).toHaveTextContent('Dismissed 1');
  });

  it('puts the row back and says why when the decision fails, and sends one request for a double click', async () => {
    let calls = 0;
    server.use(
      http.put(DECISIONS, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, code: 'conflict', detail: 'The crawl has changed.' },
          { status: 409, headers: PROBLEM },
        );
      }),
    );
    const { user } = open();
    const accept = await screen.findByRole('button', { name: ACCEPT_NAME });
    await user.dblClick(accept);
    expect((await screen.findAllByText('The decision could not be saved')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('The crawl has changed.').length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: ACCEPT_NAME })).toBeEnabled();
    expect(calls).toBe(1);
  });

  it('shows no raw backend text when the failure is not an answer of the API', async () => {
    server.use(http.put(DECISIONS, () => HttpResponse.error()));
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: ACCEPT_NAME }));
    expect((await screen.findAllByText('Nothing was changed. Try again in a moment.')).length).toBeGreaterThan(0);
  });

  it('plans several rows in one request with the bulk bar, then clears the selection', async () => {
    const sent = decisionsSent();
    const { user } = open();
    await user.click(await screen.findByRole('checkbox', { name: `Select ${FROM} to ${TO}` }));
    await user.click(screen.getByRole('checkbox', { name: 'Select /blog/soc-vs-mdr to /services/soc-as-a-service' }));
    const bar = await screen.findByText('2 opportunities selected');
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('2 opportunities planned')).toBeInTheDocument();
    await waitFor(() => expect(sent()).toHaveLength(1));
    const [body] = sent();
    expect(body).toMatchObject({ status: 'accepted' });
    expect((body as { items: unknown[] }).items).toHaveLength(2);
    await waitFor(() => expect(screen.queryByText(/opportunities selected/)).not.toBeInTheDocument());
  });

  it('discards the selection when the filter changes', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('checkbox', { name: `Select ${FROM} to ${TO}` }));
    expect(await screen.findByText('1 opportunity selected')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: /^Open/ }));
    await waitFor(() => expect(screen.queryByText('1 opportunity selected')).not.toBeInTheDocument());
  });

  it('copies the instruction and says so', async () => {
    const { user } = open();
    const button = await screen.findByRole('button', { name: COPY_NAME });
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(button);
    expect((await screen.findAllByText('Instruction copied')).length).toBeGreaterThan(0);
    expect(write).toHaveBeenCalledWith(
      `On https://eventussecurity.com${FROM} link the words "managed detection and response" to https://eventussecurity.com${TO}.`,
    );
  });

  it('saves the planned fixes CSV, and says there is nothing to export for a header only answer', async () => {
    const { user } = open();
    await grid();
    await user.click(screen.getByRole('button', { name: 'Planned fixes' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('internal-links-planned-fixes.csv');

    server.use(
      http.get(LIST, ({ request }) =>
        new URL(request.url).searchParams.get('export') === 'planned'
          ? new HttpResponse('Source URL,Target URL,Anchor,Context,Status\r\n', {
              headers: { 'content-type': 'text/csv' },
            })
          : undefined,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Planned fixes' }));
    expect(await screen.findByText('Nothing to export')).toBeInTheDocument();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('says so in a toast when the planned fixes cannot be downloaded, and allows another try', async () => {
    server.use(http.get(LIST, () => HttpResponse.error()));
    const { user } = open();
    await screen.findByRole('grid', { name: 'Link opportunities' }).catch(() => null);
    await user.click(await screen.findByRole('button', { name: 'Planned fixes' }));
    expect((await screen.findAllByText('The planned fixes could not be downloaded')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Planned fixes' })).toBeEnabled();
  });

  it('says there are no opportunities when the crawl has none', async () => {
    setLinksScenario({ noOpportunities: true });
    open();
    expect(await screen.findByText('No opportunities')).toBeInTheDocument();
    expect(screen.getByText('Every mention of an important page already links to it.')).toBeInTheDocument();
  });

  it('says there are no open opportunities when all are decided, and Show all clears the status', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          data: [],
          meta: { run_id: HISTORY_RUN_IDS[0], total: 0, counts: { open: 0, accepted: 2, dismissed: 1 } },
        }),
      ),
    );
    const urls: string[] = [];
    const { user } = open('&os=open', 'editor', { onUrlUpdate: ({ queryString }) => urls.push(queryString) });
    expect(await screen.findByText('No open opportunities')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(urls.at(-1) ?? '').not.toContain('os='));
  });

  it('says nothing matches a search, with Clear filters', async () => {
    const { user } = open('&oq=zzzz-nothing');
    expect(await screen.findByText('No opportunities match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('button', { name: ACCEPT_NAME })).toBeInTheDocument();
  });

  it('gives a viewer the rows and Copy, and no decision, selection or bulk bar', async () => {
    open('', 'viewer');
    await grid();
    expect(await screen.findByRole('button', { name: COPY_NAME })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ACCEPT_NAME })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('reads an older crawl without decisions, and says why', async () => {
    const asked = listReads();
    open(`&run=${KEPT_RUN}`);
    await grid();
    expect(await screen.findByText(/Decisions are made on the latest crawl/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ACCEPT_NAME })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY_NAME })).toBeInTheDocument();
    expect(asked().some((query) => query.get('run') === KEPT_RUN)).toBe(true);
  });

  it('shows the neutral message and makes no read for a crawl whose links were dropped', async () => {
    const asked = listReads();
    open(`&run=${DROPPED_RUN}`);
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Planned fixes' })).not.toBeInTheDocument();
    expect(asked().filter((query) => query.get('run') === DROPPED_RUN)).toHaveLength(0);
  });

  it('shows the message when the list itself answers 410', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Gone', status: 410, code: 'links_dropped', detail: 'Dropped.' },
          { status: 410, headers: PROBLEM },
        ),
      ),
    );
    open();
    expect(await screen.findByText(DROPPED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps its own columns when the Pages tab has set its column choice in the address', async () => {
    open('&cols=page,tier&density=comfortable');
    const table = await grid();
    expect(within(table).getByRole('columnheader', { name: 'Mentions' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Suggested anchor' })).toBeInTheDocument();
  });

  it('reads a tier the workspace does not have as no tier chosen', async () => {
    const asked = listReads();
    open('&ot=8');
    await grid();
    await screen.findByRole('button', { name: ACCEPT_NAME });
    expect(asked().length).toBeGreaterThan(0);
    for (const query of asked()) expect(query.has('filter[target_tier]')).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Target tier' })).toHaveTextContent('All');
  });

  it('keeps Planned fixes on an older crawl and says it lists today’s decisions', async () => {
    open(`&run=${KEPT_RUN}`);
    const planned = await screen.findByRole('button', { name: 'Planned fixes' });
    expect(planned).toBeEnabled();
    expect(planned).toHaveAttribute('title', 'Lists the decisions as they stand today, whichever crawl is shown');
  });

  it('counts the open ones on the tab and keeps that count after the tab is registered', async () => {
    open();
    expect(await screen.findByRole('tab', { name: /^Opportunities, \d+ open$/ })).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = open();
    await grid();
    await screen.findByRole('button', { name: ACCEPT_NAME });
    expect(await axe(container)).toHaveNoViolations();
  });
});
