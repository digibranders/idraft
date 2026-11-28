import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCrawlShell } from './crawl-shell';
import { CRAWL_POLL_MS } from './crawl-reads';
import { announce } from '@/lib/a11y/announcer';
import type { CrawlRun } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { MOCK_RUN_ID } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { EVENTUS_LINKS, FYNIX_LINKS, NO_WEBSITE } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { TopBarSlotProvider } from '@/components/app/shell/top-bar-slot';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import type { InternalLinksProject } from './internal-links-screen';

vi.mock('@/lib/a11y/announcer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/a11y/announcer')>()),
  announce: vi.fn(),
}));

const CRAWLS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls');

const run = (over: Partial<CrawlRun>): CrawlRun => ({
  pages_blocked: null,
  pages: 40,
  pages_variant: null,
  run_id: MOCK_RUN_ID,
  trigger: 'schedule',
  state: 'ready',
  ceiling: 2000,
  pages_found: 40,
  pages_crawled: 40,
  sitemap_pages: 30,
  render_javascript: false,
  estimated_cost_usd: '0.300000',
  cost_usd: '0.300000',
  stop_reason: null,
  error_code: null,
  error_message: null,
  hints: [],
  is_latest: false,
  created_at: '2026-11-14T03:00:00Z',
  submitted_at: '2026-11-14T03:00:05Z',
  finished_at: '2026-11-14T03:12:00Z',
  requested_by: null,
  links_available: true,
  previous_run_id: null,
  enrich_state: 'done',
  html_reader_stale: false,
  pages_links_suspect: null,
  ...over,
});

const answerWith = (runs: readonly CrawlRun[]): void => {
  server.use(
    http.get(CRAWLS, () => HttpResponse.json({ data: runs, page: { has_more: false, limit: 50, next_cursor: null } })),
  );
};

/** A small component that calls the hook and prints what it returns. */
function Probe({ project, runId }: { project: InternalLinksProject; runId: string | null }): ReactElement {
  const shell = useCrawlShell({
    workspaceId: MOCK_WORKSPACE.workspace_id,
    workspaceSlug: MOCK_WORKSPACE.slug,
    project,
    run: runId,
  });
  return (
    <div>
      <p data-testid="kind">{shell.view.kind}</p>
      <p data-testid="in-view">{shell.inView.run ?? 'none'}</p>
      <p data-testid="unknown">{String(shell.inView.unknown)}</p>
      <div data-testid="body">{shell.stateBody}</div>
      <p data-testid="has-body">{shell.stateBody === null ? 'null' : 'node'}</p>
    </div>
  );
}

function probe(project: InternalLinksProject, runId: string | null = null): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <PermissionProvider membership={membershipFactory('editor')}>
        <Suspense fallback={null}>
          <Probe project={project} runId={runId} />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}

const OLDER = '0192e4a0-1000-7000-8000-0000000000a1';

beforeEach(() => vi.mocked(announce).mockClear());
afterEach(() => vi.useRealTimers());

describe('useCrawlShell', () => {
  it('has no state body and a ready view for a crawl that can be read', async () => {
    answerWith([run({ is_latest: true })]);
    renderWithProviders(probe(EVENTUS_LINKS));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('ready'));
    expect(screen.getByTestId('has-body')).toHaveTextContent('null');
  });

  it('draws the no website state', () => {
    renderWithProviders(probe(NO_WEBSITE));
    expect(screen.getByTestId('kind')).toHaveTextContent('no-website');
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('draws the never crawled state with Crawl now', async () => {
    answerWith([]);
    renderWithProviders(probe(FYNIX_LINKS));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('never'));
    expect(screen.getByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeInTheDocument();
  });

  it('draws the first crawl state while the first crawl runs', async () => {
    answerWith([run({ state: 'crawling', pages_found: 312, finished_at: null })]);
    renderWithProviders(probe(EVENTUS_LINKS));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('first'));
    expect(await screen.findByRole('heading', { name: 'Mapping eventussecurity.com' })).toBeInTheDocument();
  });

  it('draws the failed first crawl state with Try again', async () => {
    answerWith([run({ state: 'failed', error_code: 'site_blocked', finished_at: null })]);
    renderWithProviders(probe(EVENTUS_LINKS));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('failed-first'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('follows the run it is given, and reads the latest for an unknown one', async () => {
    answerWith([run({ is_latest: true }), run({ run_id: OLDER, created_at: '2026-11-10T03:00:00Z' })]);
    const view = renderWithProviders(probe(EVENTUS_LINKS, OLDER));
    await waitFor(() => expect(screen.getByTestId('in-view')).toHaveTextContent(OLDER));
    view.unmount();
    renderWithProviders(probe(EVENTUS_LINKS, '0192e4a0-1000-7000-8000-0000000000ee'));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('ready'));
    // The latest crawl is read as `null`, and the address is reported as unknown
    expect(screen.getByTestId('in-view')).toHaveTextContent('none');
    expect(screen.getByTestId('unknown')).toHaveTextContent('true');
  });

  it('announces the end of a crawl once', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'],
      shouldAdvanceTime: true,
    });
    const latest = run({ is_latest: true });
    const running = run({ run_id: 'c', state: 'crawling', finished_at: null, created_at: '2026-11-16T03:00:00Z' });
    answerWith([running, latest]);
    renderWithProviders(probe(EVENTUS_LINKS));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('ready'));
    answerWith([
      { ...running, state: 'ready', is_latest: true, pages: 52 },
      { ...latest, is_latest: false },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    await waitFor(() => expect(vi.mocked(announce)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(announce)).toHaveBeenCalledWith('The crawl finished: 52 URLs read.', expect.anything());
    await act(() => vi.advanceTimersByTimeAsync(CRAWL_POLL_MS + 100));
    expect(vi.mocked(announce)).toHaveBeenCalledTimes(1);
  });
});
