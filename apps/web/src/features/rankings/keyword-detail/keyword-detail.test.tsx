import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DETAIL } from '../keyword-inspector/inspector-queries';
import { rememberListHref } from './list-return';
import * as announcer from '@/lib/a11y/announcer';
import type { TrackedKeywordDetail } from '@/lib/api/types';
import { rankingsPath } from '@/lib/routes/paths';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { TRACKED_KEYWORD_DETAIL } from '@/test/api-shapes';
import { axe } from '@/test/axe';
import { DETAIL_KEYWORDS, keywordDetailAs, UNKNOWN_KEYWORD_ID } from '@/test/keyword-detail-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

const router = vi.hoisted(() => ({ push: vi.fn<(path: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: router.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const LIST = '/digibranders/fynix/seo/keywords';
const CHECK_BODY = z.object({ tracked_keyword_ids: z.array(z.string()) });
const ARCHIVE_BODY = z.object({ is_active: z.boolean() });

beforeEach(() => {
  stubWideScreen();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  router.push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreWideScreen();
  window.sessionStorage.clear();
  server.events.removeAllListeners();
});

/** The JSON bodies of the requests of `method` whose path ends with `suffix`, in the order they were made. */
function recordBodies(method: string, suffix: string): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', async ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(suffix)) {
      bodies.push(await request.clone().json());
    }
  });
  return bodies;
}

const DETAIL_ANSWER = z.object({ data: TRACKED_KEYWORD_DETAIL });

/** The mock's own answer for the keyword, changed by `change` (for a state the fixtures do not have). */
function answerDetailWith(change: (detail: TrackedKeywordDetail) => TrackedKeywordDetail): HttpHandler {
  return http.get(mswPath(DETAIL), async ({ request }) => {
    const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
    const body = DETAIL_ANSWER.parse(await real?.json());
    return HttpResponse.json({ data: change(body.data) });
  });
}

/** The keyword with a ranking URL at `canonical`, whatever the world says. */
function withRankingUrl(detail: TrackedKeywordDetail, canonical: string): TrackedKeywordDetail {
  const url = detail.state.current.url;
  if (url === null) throw new Error('The ranked fixture has no ranking URL');
  return {
    ...detail,
    state: { ...detail.state, current: { ...detail.state.current, url: { ...url, canonical_url: canonical } } },
  };
}

const heading = (name: string): Promise<HTMLElement> => screen.findByRole('heading', { level: 1, name });
const actionNamed = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('The keyword page header', () => {
  it('names the keyword, says where and on what it is tracked and how fresh it is, and shows its groups and tags', async () => {
    const { container } = renderWithProviders(keywordDetailAs('editor'));
    const title = await heading(DETAIL_KEYWORDS.ranked.text);
    expect(title).toHaveAttribute('lang', 'en');
    expect(screen.getByText(/Germany · Desktop · Google · English · Depth: Standard/)).toHaveTextContent(
      'Updated 10h ago',
    );
    const second = screen.getByText(/^No target URL/);
    expect(second).toHaveTextContent('Groups Local');
    expect(second).toHaveTextContent('Tags Local SEO');
    expect(screen.getByRole('link', { name: 'Keywords' })).toHaveAttribute('href', LIST);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the target URL path of a keyword that has one', async () => {
    renderWithProviders(keywordDetailAs('editor', '0192d1a8-e007-7a10-8e07-000000000003'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/^Target \/blog\/seo-audit/)).toBeInTheDocument();
    expect(screen.queryByText(/No target URL/)).toBeNull();
  });

  it('names the keyword in full when it is one long word of 120 characters', async () => {
    const long = 'k'.repeat(120);
    server.use(answerDetailWith((detail) => ({ ...detail, keyword: { ...detail.keyword, text: long } })));
    renderWithProviders(keywordDetailAs('editor'));
    const title = await heading(long);
    expect(title).toHaveTextContent(long);
    expect(title.textContent).toHaveLength(120);
  });

  it('offers no link to a ranking URL that is not a web address, whatever its scheme', async () => {
    server.use(answerDetailWith((detail) => withRankingUrl(detail, 'javascript:alert(1)')));
    renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(screen.queryByText('Open ranking page')).toBeNull();
  });

  it('links the ranking URL exactly as the API gives it', async () => {
    const address = 'https://fynix.digital/blog/ranking-page?utm=1';
    server.use(answerDetailWith((detail) => withRankingUrl(detail, address)));
    renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.getByRole('link', { name: 'Open ranking page in a new tab' })).toHaveAttribute('href', address);
  });

  it('offers the ranking page in a new tab, as a link that cannot reach back to the page', async () => {
    renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    const link = screen.getByRole('link', { name: 'Open ranking page in a new tab' });
    expect(link).toHaveAttribute('href', 'https://fynix.digital/blog/seo-audit');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveTextContent('Open ranking page');
  });

  it('lists the actions in the order Open ranking page, More actions, Check now', async () => {
    renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    const link = screen.getByRole('link', { name: 'Open ranking page in a new tab' });
    const more = actionNamed('More actions');
    const check = actionNamed('Check now');
    const before = (first: Element, second: Element): boolean =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(link, more)).toBe(true);
    expect(before(more, check)).toBe(true);
  });

  it('says Not checked yet for a keyword that has no check, and has no ranking page to open', async () => {
    renderWithProviders(keywordDetailAs('editor', DETAIL_KEYWORDS.pending.id));
    await heading(DETAIL_KEYWORDS.pending.text);
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    expect(screen.queryByText(/^Updated /)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open ranking page/ })).toBeNull();
  });

  it('says Stale for a keyword whose checks stopped, and adds Last checks failed when they failed', async () => {
    const stale = renderWithProviders(keywordDetailAs('editor', DETAIL_KEYWORDS.stale.id));
    await heading(DETAIL_KEYWORDS.stale.text);
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.queryByText('Last checks failed')).toBeNull();
    stale.unmount();

    renderWithProviders(keywordDetailAs('editor', DETAIL_KEYWORDS.failing.id));
    await heading(DETAIL_KEYWORDS.failing.text);
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Last checks failed')).toBeInTheDocument();
  });

  it('says Check failed for a keyword whose every check failed, and not Stale', async () => {
    renderWithProviders(keywordDetailAs('editor', DETAIL_KEYWORDS.failed.id));
    await heading(DETAIL_KEYWORDS.failed.text);
    expect(screen.getByText('Check failed')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.queryByText('Last checks failed')).toBeNull();
  });

  it('leads back to the list as the person left it, and to the bare list without a remembered one', async () => {
    rememberListHref(
      window.sessionStorage,
      rankingsPath('digibranders', 'fynix'),
      '?q=seo&sort=-rank&inspect=keyword%3Ax',
    );
    const remembered = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Keywords' })).toHaveAttribute('href', `${LIST}?q=seo&sort=-rank`),
    );
    remembered.unmount();

    window.sessionStorage.clear();
    renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.getByRole('link', { name: 'Keywords' })).toHaveAttribute('href', LIST);
  });
});

describe('The keyword page actions', () => {
  it('checks the keyword now, and only this keyword', async () => {
    const bodies = recordBodies('POST', '/seo/check-now');
    const { user } = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('Check now'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(CHECK_BODY.parse(bodies[0]).tracked_keyword_ids).toEqual([DETAIL_KEYWORDS.ranked.id]);
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });

  it('has no Check now for a viewer, for an archived keyword or for a member who cannot start checks', async () => {
    const viewer = renderWithProviders(keywordDetailAs('viewer'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    viewer.unmount();

    renderWithProviders(keywordDetailAs('editor', DETAIL_KEYWORDS.archived.id));
    await heading(DETAIL_KEYWORDS.archived.text);
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('gives an editor Copy link, Copy keyword, Edit settings, Change depth and Archive', async () => {
    const { user } = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    const menu = await screen.findByRole('menu');
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(['Copy link', 'Copy keyword', 'Edit settings', 'Change depth', 'Archive']);
  });

  it('gives a viewer only the copy items', async () => {
    const { user } = renderWithProviders(keywordDetailAs('viewer'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Copy link', 'Copy keyword']);
  });

  it('copies the address of the page and says so', async () => {
    const announce = vi.spyOn(announcer, 'announce');
    const { user } = renderWithProviders(keywordDetailAs('viewer'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Link copied'));
    // user-event gives the page a clipboard of its own, which reads back what was written
    expect(await navigator.clipboard.readText()).toBe(
      `https://localhost:3000/digibranders/fynix/seo/keywords/${DETAIL_KEYWORDS.ranked.id}`,
    );
  });

  it('opens the list with the keyword in its inspector for Edit settings, so editing has one place', async () => {
    const { user } = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit settings' }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith(`${LIST}?inspect=keyword%3A${DETAIL_KEYWORDS.ranked.id}`);
  });

  it('opens the depth dialog from Change depth', async () => {
    const { user } = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Change depth' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('archives the keyword, and says so with an undo', async () => {
    const bodies = recordBodies('PATCH', `/tracked-keywords/${DETAIL_KEYWORDS.ranked.id}`);
    const { user } = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('1 keyword archived')).toBeInTheDocument();
    expect(bodies.length).toBeGreaterThan(0);
    expect(ARCHIVE_BODY.parse(bodies[0]).is_active).toBe(false);
    // The page follows what was written: the keyword is archived now
    expect(await screen.findByText('Archived', { selector: 'span' })).toBeInTheDocument();
  });

  it('offers Undo once the keyword is archived, and Undo puts it back', async () => {
    const bodies = recordBodies('PATCH', `/tracked-keywords/${DETAIL_KEYWORDS.ranked.id}`);
    const { user } = renderWithProviders(keywordDetailAs('editor'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('1 keyword unarchived')).toBeInTheDocument();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies.map((body) => ARCHIVE_BODY.parse(body).is_active)).toEqual([false, true]);
    await waitFor(() => expect(screen.queryByText('Archived', { selector: 'span' })).toBeNull());
  });

  it('copies the keyword text exactly, and says so', async () => {
    const announce = vi.spyOn(announcer, 'announce');
    const { user } = renderWithProviders(keywordDetailAs('viewer'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    await user.click(actionNamed('More actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy keyword' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Keyword copied'));
    expect(await navigator.clipboard.readText()).toBe(DETAIL_KEYWORDS.ranked.text);
  });
});

describe('An archived keyword', () => {
  it('shows the Archived badge and offers only Copy link and Restore, and Restore restores it', async () => {
    const { user } = renderWithProviders(keywordDetailAs('editor', DETAIL_KEYWORDS.archived.id));
    await heading(DETAIL_KEYWORDS.archived.text);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await user.click(actionNamed('More actions'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Copy link', 'Restore']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore' }));
    expect(await screen.findByText('1 keyword unarchived')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Archived')).toBeNull());
  });

  it('gives a viewer Copy link alone', async () => {
    const { user } = renderWithProviders(keywordDetailAs('viewer', DETAIL_KEYWORDS.archived.id));
    await heading(DETAIL_KEYWORDS.archived.text);
    await user.click(actionNamed('More actions'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Copy link']);
  });
});

describe('The tabs of the keyword page', () => {
  it('has Overview and SERP snapshots, Overview first, and ArrowRight moves focus and the choice', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(keywordDetailAs('viewer'), {
      onUrlUpdate: (event: UrlUpdateEvent) => writes.push(event.queryString),
    });
    await heading(DETAIL_KEYWORDS.ranked.text);
    const list = screen.getByRole('tablist', { name: 'Keyword sections' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['OverviewOverview', 'SERP snapshotsSERP snapshots']);
    const overview = within(list).getByRole('tab', { name: 'Overview', selected: true });
    overview.focus();
    await user.keyboard('{ArrowRight}');
    const snapshots = within(list).getByRole('tab', { name: 'SERP snapshots', selected: true });
    expect(snapshots).toHaveFocus();
    await waitFor(() => expect(writes.at(-1)).toBe('?tab=snapshots'));
    expect(screen.getByRole('tabpanel', { name: 'SERP snapshots' })).toBeInTheDocument();
  });

  it('keeps a panel with no content out of the tab order', async () => {
    renderWithProviders(keywordDetailAs('viewer'));
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1');
  });

  it('opens on the tab of the link', async () => {
    renderWithProviders(keywordDetailAs('viewer'), { searchParams: '?tab=snapshots' });
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.getByRole('tab', { name: 'SERP snapshots', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'SERP snapshots' })).toBeInTheDocument();
  });
});

describe('The states of the keyword page', () => {
  it('says that a keyword which is not tracked is gone, and leads back to the list', async () => {
    renderWithProviders(keywordDetailAs('editor', UNKNOWN_KEYWORD_ID));
    expect(await heading('This keyword is no longer tracked')).toBeInTheDocument();
    expect(screen.getByText('It was deleted, or you do not have access to its project.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Keywords' })).toHaveAttribute('href', LIST);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows the no-access state to a role that cannot read rank data, and asks the API nothing', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname));
    renderWithProviders(keywordDetailAs('billing'));
    expect(await heading('You do not have access to this keyword')).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view rank data. Ask an admin of this workspace.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the project' })).toHaveAttribute('href', '/digibranders/fynix');
    expect(asked.filter((path) => path.includes('/tracked-keywords/'))).toEqual([]);
  });

  it('shows a loading status while the keyword loads, then the page', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    server.use(
      http.get(mswPath(DETAIL), async () => {
        await gate;
        return undefined;
      }),
    );
    renderWithProviders(keywordDetailAs('viewer'));
    expect(await screen.findByRole('status', { name: 'Loading the keyword' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    open();
    await heading(DETAIL_KEYWORDS.ranked.text);
    expect(screen.queryByRole('status', { name: 'Loading the keyword' })).toBeNull();
  });

  it('keeps an error from looking like a missing keyword, and reads again on Try again', async () => {
    let fail = true;
    server.use(http.get(mswPath(DETAIL), ({ request }) => (fail ? problem(request, 'provider_paused') : undefined)));
    const { user } = renderWithProviders(keywordDetailAs('viewer'));
    expect(await screen.findByText('The keyword did not load')).toBeInTheDocument();
    expect(screen.getByText('Nothing else on this page can be shown until it does.')).toBeInTheDocument();
    expect(screen.queryByText('This keyword is no longer tracked')).toBeNull();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await heading(DETAIL_KEYWORDS.ranked.text)).toBeInTheDocument();
  });
});
