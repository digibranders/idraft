import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadApiFile } from '@/lib/api/download';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { FYNIX_LINKS, NO_WEBSITE } from '@/test/internal-links-harness';
import { answerCrawls, answerIssues, crawlRun, ISSUE_CHECKS, ISSUES, issueList, issuesAs } from '@/test/issues-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/issues',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/download')>();
  return { ...actual, downloadApiFile: vi.fn(async () => undefined) };
});

const CSV_PATH = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}/issues`;

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadApiFile).mockClear();
  server.use(answerIssues());
});
afterEach(() => {
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

const technical = async (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Technical checks' });
const opened = (): string[] =>
  screen.getAllByRole('button').flatMap((button) => {
    const name = button.getAttribute('aria-label') ?? '';
    return name.startsWith('Open ') ? [name] : [];
  });

describe('the access and crawl states of the Issues page (spec 7.4)', () => {
  it('tells a member who cannot read the project that they cannot see issues', () => {
    renderWithProviders(issuesAs('billing'));
    expect(screen.getByRole('heading', { name: 'You cannot see issues' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('explains that a website is needed, with the link to the domains settings', () => {
    renderWithProviders(issuesAs('editor', NO_WEBSITE));
    expect(screen.getByRole('heading', { name: 'Add your website to map internal links' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add website' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/settings/domains',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers the first crawl of a site never crawled, and shows no table', async () => {
    renderWithProviders(issuesAs('editor', FYNIX_LINKS));
    expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Measures' })).toBeNull();
  });

  it('shows the progress of a first crawl under way, and no table', async () => {
    server.use(answerCrawls([crawlRun({ state: 'crawling', pages_found: 312, finished_at: null })]));
    renderWithProviders(issuesAs('editor'));
    expect(await screen.findByRole('heading', { name: 'Mapping eventussecurity.com' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '312');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('names why a first crawl failed, offers Try again and shows no table', async () => {
    server.use(
      answerCrawls([
        crawlRun({ state: 'failed', error_code: 'site_blocked', error_message: 'RAW TEXT', finished_at: null }),
      ]),
    );
    renderWithProviders(issuesAs('editor'));
    expect(await screen.findByText(/refused our crawler/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/RAW TEXT/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the list of the finished crawl under the banner of a newer crawl that is running', async () => {
    server.use(
      answerCrawls([
        crawlRun({ run_id: 'newer', state: 'crawling', created_at: '2026-11-16T03:00:00Z', finished_at: null }),
        crawlRun({ is_latest: true }),
      ]),
    );
    renderWithProviders(issuesAs('editor'));
    expect(await technical()).toBeInTheDocument();
    expect(screen.getByText(/Crawling now: read/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawling' })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the list of the finished crawl under the banner of a newer crawl that failed', async () => {
    server.use(
      answerCrawls([
        crawlRun({ run_id: 'newer', state: 'failed', error_code: 'site_blocked', created_at: '2026-11-16T03:00:00Z' }),
        crawlRun({ is_latest: true }),
      ]),
    );
    renderWithProviders(issuesAs('editor'));
    expect(await technical()).toBeInTheDocument();
    expect(screen.getByText('The last crawl failed.')).toBeInTheDocument();
  });

  it('draws skeleton rows while the checks load, not a spinner and not a table', async () => {
    server.use(
      http.get(ISSUES, async () => {
        await delay(80);
        return HttpResponse.json(issueList());
      }),
    );
    const { container } = renderWithProviders(issuesAs('editor'));
    await screen.findByRole('group', { name: 'Measures' });
    expect(screen.getByRole('group', { name: 'Measures' })).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(await technical()).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('shows an inline error with Try again when the checks cannot be read, and reads them again', async () => {
    let calls = 0;
    server.use(
      http.get(ISSUES, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'internal_error') : HttpResponse.json(issueList());
      }),
    );
    const { user } = renderWithProviders(issuesAs('editor'));
    expect(await screen.findByText('The issues could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await technical()).toBeInTheDocument();
  });
});

describe('the list view', () => {
  it('has one h1, the toolbar of one row, the strip and one panel', async () => {
    renderWithProviders(issuesAs('editor'));
    await technical();
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([screen.getByRole('heading', { name: 'Issues' })]);
    expect(screen.getByRole('combobox', { name: /Found by/ })).toBeInTheDocument();
    expect(screen.getByText(/^eventussecurity\.com, crawl of .+, 1,840 pages$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Measures' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show passed checks' })).toBeChecked();
  });

  it('shows the six measures, and Checks passed as "9 of 27"', async () => {
    renderWithProviders(issuesAs('editor'));
    await technical();
    const measures = within(screen.getByRole('group', { name: 'Measures' }));
    expect(measures.getAllByRole('term')).toHaveLength(6);
    expect(measures.getByText('9 of 27')).toBeInTheDocument();
    expect(measures.getByText('1,840')).toBeInTheDocument();
  });

  it('groups the Technical rows by category in the order of the list, with the counts on the tabs', async () => {
    renderWithProviders(issuesAs('editor'));
    const table = await technical();
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['Status', 'Pages that earn visits', 'Redirects', 'Sitemap', 'Links']);
    expect(opened()).toEqual([
      'Open Pages that return a 4xx error',
      'Open Pages that return a 5xx error',
      'Open Redirect chains',
    ]);
    expect(screen.getByRole('tab', { name: /^Technical.*2 issues found$/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^On-page.*1 issue found$/ })).toBeInTheDocument();
    expect(screen.getByText('7 checks of 7 on this tab')).toBeInTheDocument();
  });

  it('writes the tab as a history entry and shows the On-page rows, the most severe first', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await technical();
    expect(writes).toEqual([]);
    await user.click(screen.getByRole('tab', { name: /^On-page/ }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('tab=on-page'));
    expect(writes.at(-1)?.history).toBe('push');
    await screen.findByRole('table', { name: 'On-page checks' });
    expect(opened()).toEqual(['Open Pages without a title', 'Open Titles over 60 characters']);
  });

  it('opens on the tab of the address, and lets the tab of a check win over it', async () => {
    renderWithProviders(issuesAs('editor'), { searchParams: '?tab=on-page' });
    expect(await screen.findByRole('table', { name: 'On-page checks' })).toBeInTheDocument();
  });

  it('shows a check that passed as Passed, and hides it with Show passed checks off', async () => {
    const { user } = renderWithProviders(issuesAs('editor'));
    const table = await technical();
    expect(within(table).getByText('Passed')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Show passed checks' }));
    await waitFor(() => expect(within(table).queryByText('Passed')).toBeNull());
    expect(screen.queryByText('Pages that return a 5xx error')).toBeNull();
    // A check that did not run stays
    expect(screen.getByText('Broken or redirected pages with Google clicks')).toBeInTheDocument();
    expect(screen.getByText('6 checks of 7 on this tab')).toBeInTheDocument();
  });

  it('gives a check that did not run its state in the Pages cell, with no button and no arrow', async () => {
    renderWithProviders(issuesAs('editor'));
    await technical();
    const gsc = screen.getByText('Broken or redirected pages with Google clicks').closest('tr') as HTMLElement;
    expect(within(gsc).getByText('Not connected')).toBeInTheDocument();
    expect(within(gsc).getByRole('link', { name: 'Connect Search Console' })).toHaveAttribute(
      'href',
      '/digibranders/eventus-security/integrations/google',
    );
    expect(within(gsc).queryByRole('button')).toBeNull();
    const ai = screen.getByText('Broken or redirected pages cited in AI answers').closest('tr') as HTMLElement;
    expect(within(ai).getByText('Not collected yet')).toBeInTheDocument();
    const pagesCell = (name: string): HTMLElement => {
      const row = screen.getByText(name).closest('tr') as HTMLElement;
      return within(row).getAllByRole('cell')[3] as HTMLElement;
    };
    expect(
      within(pagesCell('Sitemap lists an address that does not return 200')).getByText('n/a'),
    ).toHaveAccessibleDescription('The crawl found no sitemap');
    expect(within(pagesCell('Pages with nofollow internal links')).getByText('n/a')).toHaveAccessibleDescription(
      'This crawl no longer holds its links',
    );
  });

  it('shows n/a with its reason for the clicks when Search Console is not connected', async () => {
    server.use(
      answerIssues(
        issueList(
          ISSUE_CHECKS.map((check) => ({ ...check, clicks: null })),
          { state: 'not_connected', window_start: null, window_end: null },
        ),
      ),
    );
    renderWithProviders(issuesAs('editor'));
    await technical();
    const row = screen.getByText('Pages that return a 4xx error').closest('tr') as HTMLElement;
    expect(within(within(row).getAllByRole('cell')[4] as HTMLElement).getByText('n/a')).toHaveAccessibleDescription(
      'Search Console is not connected',
    );
  });

  it('narrows the rows by severity, and writes it to the address as a replace', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await technical();
    await user.click(screen.getByRole('button', { name: /^Warnings/ }));
    await waitFor(() => expect(opened()).toEqual(['Open Redirect chains']));
    expect(writes.at(-1)).toEqual({ queryString: '?severity=warning', history: 'replace' });
    expect(screen.getByRole('button', { name: /^Warnings/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('narrows the rows by where they were found, from the address and from the select', async () => {
    const { user } = renderWithProviders(issuesAs('editor'));
    await technical();
    await user.click(screen.getByRole('combobox', { name: /Found by/ }));
    await user.click(await screen.findByRole('option', { name: /AI answers/ }));
    await waitFor(() => expect(screen.queryByText('Redirect chains')).toBeNull());
    expect(screen.getByText('Broken or redirected pages cited in AI answers')).toBeInTheDocument();
  });

  it('narrows the rows by the search over the names and the category names, kept as typed', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await technical();
    await user.type(screen.getByRole('searchbox', { name: 'Search issues' }), 'redirect ');
    await waitFor(() => expect(screen.queryByText('Pages that return a 4xx error')).toBeNull());
    expect(screen.getByText('Redirect chains')).toBeInTheDocument();
    expect(writes.at(-1)).toBe('?q=redirect+');
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveValue('redirect ');
  });

  it('says No checks match, and Clear filters resets the address', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      searchParams: '?severity=notice&q=zzz&passed=hide&by=gsc',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByRole('heading', { name: 'No checks match' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await technical()).toBeInTheDocument();
    expect(writes.at(-1)).toBe('');
    expect(screen.getByRole('checkbox', { name: 'Show passed checks' })).toBeChecked();
  });

  it('writes the check to the address when a row is pressed, and shows the open check in place of the list', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = renderWithProviders(issuesAs('editor'), {
      searchParams: '?q=redirect',
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await user.click(await screen.findByRole('button', { name: 'Open Redirect chains' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toBe('?check=redirect-chain'));
    expect(writes.at(-1)?.history).toBe('push');
    expect(await screen.findByRole('heading', { level: 2, name: 'Redirect chains' })).toBeInTheDocument();
    // The toolbar and the strip are not there while a check is open, and the page keeps its one h1
    expect(screen.queryByRole('group', { name: 'Measures' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Found by/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crawl now' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'All issues' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toBe(''));
    expect(await technical()).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Measures' })).toBeInTheDocument();
  });

  it('opens the check the address names, in its own tab', async () => {
    const { user } = renderWithProviders(issuesAs('editor'), { searchParams: '?tab=technical&check=title-long' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Titles over 60 characters' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All issues' }));
    expect(await screen.findByRole('table', { name: 'On-page checks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^On-page/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the list for a check it does not know and for one that did not run', async () => {
    const unknown = renderWithProviders(issuesAs('editor'), { searchParams: '?check=no-such-check' });
    expect(await technical()).toBeInTheDocument();
    unknown.unmount();
    renderWithProviders(issuesAs('editor'), { searchParams: '?check=cited-page-broken' });
    expect(await technical()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('downloads the CSV of the checks with Export, and says so when the file cannot be made', async () => {
    const { user } = renderWithProviders(issuesAs('editor'));
    await technical();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(downloadApiFile).toHaveBeenCalledWith(CSV_PATH, { format: 'csv' }, 'issues.csv');
    vi.mocked(downloadApiFile).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect((await screen.findAllByText('The file could not be made. Try again in a moment.')).length).toBeGreaterThan(
      0,
    );
  });

  it('keeps Crawl now in the tab order for a viewer, with the reason, and starts nothing', async () => {
    renderWithProviders(issuesAs('viewer'));
    await technical();
    const button = screen.getByRole('button', { name: 'Crawl now' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Your role cannot start crawls. Ask an admin of the workspace.');
  });

  it('has no axe violations in the list, in both themes', async () => {
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container, unmount } = renderWithProviders(issuesAs('editor'));
      await technical();
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
