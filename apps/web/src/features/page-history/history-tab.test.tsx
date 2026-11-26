import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { HISTORY } from './history-fixtures';
import { HistoryTab } from './history-tab';
import { LastEditedLine } from './last-edited-line';
import { forgetOpenRows } from './model/open-state';
import type { PageHistory } from './model/page-history';

const HISTORY_PATH = mswPath(
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/history',
);
const SCOPE = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
};

const answer = (patch: Partial<PageHistory> = {}): void =>
  server.use(http.get(HISTORY_PATH, () => HttpResponse.json({ data: { ...HISTORY, ...patch } })));
const tab = (urlId = '108'): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(<HistoryTab scope={SCOPE} urlId={urlId} timeZone="UTC" />);

beforeEach(() => forgetOpenRows());
afterEach(() => server.resetHandlers());

describe('the History tab', () => {
  it('shows the four dates, the Google warning and the timeline newest first', async () => {
    answer();
    tab();
    const strip = await screen.findByRole('list', { name: 'Crawls of this page, newest first' });
    const dates = screen.getByLabelText('Dates of this page').textContent ?? '';
    for (const word of [
      'Last edited',
      'Last change seen',
      'First seen',
      'Google crawled',
      'Nov 18, 2026',
      'Before the last change',
    ]) {
      expect(dates).toContain(word);
    }
    expect(
      screen.getByText(/Google last crawled this page on Nov 15, 2026, before the change of Nov 20, 2026/),
    ).toBeInTheDocument();
    const rows = within(strip)
      .getAllByRole('listitem', { name: '' })
      .filter((row) => row.parentElement === strip);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Nov 20, 2026'),
      expect.stringContaining('Nov 13, 2026'),
      expect.stringContaining('Nov 6, 2026'),
      expect.stringContaining('Oct 30, 2026'),
    ]);
    expect(within(strip).getByText('Site-wide change')).toBeInTheDocument();
    expect(within(strip).getByText('First seen')).toBeInTheDocument();
  });

  it('opens the newest content change and lets a person open and close rows', async () => {
    answer();
    const { user } = tab();
    const newest = await screen.findByRole('button', { name: /Nov 20, 2026/ });
    expect(newest).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('How onboarding works')).toBeVisible();
    expect(screen.getByText('Text grew by 120 words')).toBeVisible();
    expect(screen.getByText('2 editorial links removed')).toBeVisible();
    const older = screen.getByRole('button', { name: /Nov 6, 2026/ });
    expect(older).toHaveAttribute('aria-expanded', 'false');
    await user.click(older);
    expect(older).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Our partners')).toBeVisible();
    await user.click(newest);
    expect(newest).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('How onboarding works')).not.toBeVisible();
  });

  it('keeps the rows a person opened when the tab comes back for the same page', async () => {
    answer();
    const first = tab();
    const { user } = first;
    await user.click(await screen.findByRole('button', { name: /Nov 6, 2026/ }));
    first.unmount();
    tab();
    expect(await screen.findByRole('button', { name: /Nov 6, 2026/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('folds the note on how the dates are read, and states the limits in the footer', async () => {
    answer();
    const { user } = tab();
    const note = await screen.findByRole('button', { name: 'How these dates are read' });
    expect(note).toHaveAttribute('aria-expanded', 'false');
    await user.click(note);
    expect(note).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Last-Modified header/)).toBeVisible();
    expect(screen.getByText(/History starts on Oct 30, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Pages behind a login are not covered.')).toBeInTheDocument();
  });

  it('shows None with its reason for a page without dates and no Google data', async () => {
    answer({
      declared: null,
      last_change: null,
      changes: 0,
      google: null,
      tracked: false,
      versions: HISTORY.versions.slice(3),
    });
    tab();
    const strip = await screen.findByLabelText('Dates of this page');
    expect(strip).toHaveTextContent('The page declares no date');
    expect(strip).toHaveTextContent('Since Oct 30, 2026');
    expect(strip).toHaveTextContent('Read for pages in Monitoring');
    expect(screen.queryByText(/Google last crawled/)).not.toBeInTheDocument();
    expect(screen.getByText('The oldest crawl idraft kept a copy of.')).toBeInTheDocument();
  });

  it.each([
    [
      { readable: false, why: 'redirect', status: 301 } as const,
      'This address redirects',
      'Open the page it leads to.',
    ],
    [{ readable: false, why: 'error', status: 404 } as const, 'This address is not a page', 'It answers with 404'],
  ])('explains an unreadable page %#', async (patch, title, reason) => {
    answer(patch);
    tab();
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(reason))).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Crawls/ })).not.toBeInTheDocument();
  });

  it('says there is no history yet when no version was kept', async () => {
    answer({ versions: [] });
    tab();
    expect(await screen.findByRole('heading', { name: 'No history yet' })).toBeInTheDocument();
  });

  it('shows a skeleton while loading, and an error with Try again that reads again', async () => {
    let calls = 0;
    server.use(
      http.get(HISTORY_PATH, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 })
          : HttpResponse.json({ data: HISTORY });
      }),
    );
    const { user } = tab();
    expect(screen.getByRole('status', { name: 'Loading the history of this page' })).toBeInTheDocument();
    expect(await screen.findByText('Could not load the history of this page')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: /Crawls/ })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    answer();
    const { container } = tab();
    await screen.findByRole('list', { name: /Crawls/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the Overview line', () => {
  const line = (onOpen = (): void => undefined): ReturnType<typeof renderWithProviders> =>
    renderWithProviders(<LastEditedLine scope={SCOPE} urlId="108" timeZone="UTC" onOpen={onOpen} />);

  it('says when the page was last edited and opens the History tab', async () => {
    answer();
    let opened = 0;
    const { user } = line(() => {
      opened += 1;
    });
    expect(await screen.findByText(/Last edited Nov 18, 2026\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See history' }));
    expect(opened).toBe(1);
  });

  it('falls back to the last change seen, then to no change seen', async () => {
    answer({ declared: null });
    line();
    expect(await screen.findByText(/Last change seen Nov 20, 2026\./)).toBeInTheDocument();
  });

  it('says no change was seen since the history started', async () => {
    answer({ declared: null, last_change: null });
    line();
    expect(await screen.findByText(/No change seen since Oct 30, 2026\./)).toBeInTheDocument();
  });

  it('shows nothing for a page that cannot be read', async () => {
    let read = false;
    server.use(
      http.get(HISTORY_PATH, () => {
        read = true;
        return HttpResponse.json({ data: { ...HISTORY, readable: false, why: 'redirect' } });
      }),
    );
    const { container, queryClient } = line();
    await vi.waitFor(() => expect(read).toBe(true));
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(container).not.toHaveTextContent('Last');
    expect(screen.queryByRole('button', { name: 'See history' })).not.toBeInTheDocument();
  });
});
