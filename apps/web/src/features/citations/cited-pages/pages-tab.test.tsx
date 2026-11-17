import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PagesTab, type PagesTabProps } from './pages-tab';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
// A function declaration does not keep the narrowing of `fynix`
const PROJECT_ID = fynix.project_id;
const EXPECTED = CITATIONS_FIXTURE.expected.chatgpt;

function setup(overrides: Partial<PagesTabProps> = {}) {
  const props: PagesTabProps = {
    project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: PROJECT_ID },
    scope: { runs: 4, engines: ['chatgpt_web'], term: null },
    ready: true,
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    owner: 'own',
    search: '',
    onOwnerChange: vi.fn(),
    onSearchChange: vi.fn(),
    onResetScope: vi.fn(),
    tabs: <nav aria-label="Citations views" />,
    previous: { full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' },
    scopeText: 'ChatGPT, All groups, Last 4 runs',
    timeZone: 'Europe/Berlin',
    activeId: null,
    onOpen: vi.fn(),
    onOrderChange: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<PagesTab {...props} />) };
}

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the Cited pages tab', () => {
  it('lists the own pages with the owner counts, the footer and the freshness (C 545 to 561)', async () => {
    const { container } = setup();
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    expect(within(table).getAllByRole('row')).toHaveLength(EXPECTED.pages.own + 1);
    const owners = screen.getByRole('group', { name: 'Domain type' });
    expect(within(owners).getByRole('button', { pressed: true })).toHaveTextContent(
      `Your site${String(EXPECTED.pages.own)}`,
    );
    expect(within(owners).getByRole('button', { name: /^All/ })).toHaveTextContent(String(EXPECTED.pages.all));
    expect(
      screen.getByText(`${String(EXPECTED.pages.own)} pages · ${String(EXPECTED.strip.citations)} citations`),
    ).toBeVisible();
    expect(screen.getByText('Updated Sep 28, 02:10 · run 48')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens the prompts popover from the chip and the page details from its foot (C 416 to 444)', async () => {
    const { user, props } = setup();
    await screen.findByRole('table', { name: 'Cited pages' });
    const chip = screen.getAllByRole('button', { name: /^Prompts that cite / })[0];
    if (chip === undefined) throw new Error('No chip');
    await user.click(chip);
    const dialog = screen.getByRole('dialog', { name: /^Prompts that cite / });
    expect(within(dialog).getByText('Cited for')).toBeVisible();
    expect(within(dialog).getAllByRole('listitem').length).toBeLessThanOrEqual(10);
    await user.click(within(dialog).getByRole('button', { name: /^(Show all \d+ prompts|Open the page details)$/ }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ domain_role: 'own' }), expect.any(HTMLElement));
  });

  it('says no page matches a search, with a way out', async () => {
    const { user, props } = setup({ search: 'zzzz' });
    expect(await screen.findByRole('heading', { name: 'No pages match' })).toBeVisible();
    expect(screen.getByText('No page of your site contains “zzzz”.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(props.onSearchChange).toHaveBeenCalledWith('');
  });

  it('says no answer cites a page in this scope, and resets the scope', async () => {
    server.use(
      http.get(mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/cited-pages'), () =>
        HttpResponse.json({
          data: [],
          meta: {
            citations: 0,
            owners: { own: 0, competitor: 0, third_party: 0, all: 0 },
            window: {
              runs: 4,
              timezone: 'Europe/Berlin',
              current: [],
              previous: [],
              trend: [],
              answers: 0,
              prompts: 0,
              latest_answer_at: null,
              latest_run_number: null,
            },
          },
          page: { offset: 0, limit: 200, total: 0 },
        }),
      ),
    );
    const { user, props } = setup();
    expect(await screen.findByRole('heading', { name: 'No citations in this scope' })).toBeVisible();
    expect(
      screen.getByText(
        'No answer in ChatGPT, All groups, Last 4 runs cites a page. Choose more runs or another group.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset scope' }));
    expect(props.onResetScope).toHaveBeenCalled();
  });

  it('reads the next 200 pages when the scroll reaches the end, keeping the rows it has (D-6)', async () => {
    // The end of the scroll is always in view here, so every observation asks for the next page
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {}
        observe(): void {
          this.callback([{ isIntersecting: true }]);
        }
        disconnect(): void {}
      },
    );
    try {
      setup({ owner: 'all' });
      const table = await screen.findByRole('table', { name: 'Cited pages' });
      await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(EXPECTED.pages.all + 1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the sort when Show all pages leaves an owner with no pages (C 568)', async () => {
    const requested: string[] = [];
    const path = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/cited-pages');
    const emptyWindow = {
      runs: 4,
      timezone: 'Europe/Berlin',
      current: [],
      previous: [],
      trend: [],
      answers: 8,
      prompts: 2,
      latest_answer_at: null,
      latest_run_number: null,
    };
    server.use(
      http.get(path, ({ request }) => {
        const sort = new URL(request.url).searchParams.get('sort') ?? '';
        requested.push(sort);
        // Sorted by change, the owner has no page: the other owners still have some
        if (sort !== '-change') return undefined;
        return HttpResponse.json({
          data: [],
          meta: { citations: 0, owners: { own: 0, competitor: 3, third_party: 4, all: 7 }, window: emptyWindow },
          page: { offset: 0, limit: 200, total: 0 },
        });
      }),
    );
    const { user, props } = setup();
    await screen.findByRole('table', { name: 'Cited pages' });
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(await screen.findByRole('button', { name: 'Show all pages' }));
    expect(props.onOwnerChange).toHaveBeenCalledWith('all');
    // The old behaviour sorted by citations again, which asks for the default order and brings the table back
    expect(screen.getByRole('heading', { name: 'No pages match' })).toBeVisible();
    expect(requested.at(-1)).toBe('-change');
  });

  it('resets the sort when the owner changes (C 555)', async () => {
    const { user, props } = setup();
    await screen.findByRole('table', { name: 'Cited pages' });
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(within(screen.getByRole('group', { name: 'Domain type' })).getByRole('button', { name: /^All/ }));
    expect(props.onOwnerChange).toHaveBeenCalledWith('all');
    expect(screen.getByRole('columnheader', { name: /Citations/ })).toHaveAttribute('aria-sort', 'descending');
  });
});
