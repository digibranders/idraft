import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChecksTable, type ChecksTableProps } from './checks-table';
import { ISSUE_CHECKS } from '@/test/issues-harness';
import { renderWithProviders } from '@/test/render';
import type { IssueCheck } from '@/lib/issues/types';

const INTEGRATIONS = '/digibranders/eventus-security/integrations/google';

const props = (over: Partial<ChecksTableProps> = {}): ChecksTableProps => ({
  checks: ISSUE_CHECKS.filter((check) => check.tab === 'technical'),
  pagesCrawled: 1840,
  gsc: 'ok',
  integrationsHref: INTEGRATIONS as ChecksTableProps['integrationsHref'],
  caption: 'Technical checks',
  onOpen: vi.fn(),
  ...over,
});

const row = (name: string): HTMLElement => {
  const text = screen.getAllByText(name)[0];
  const found = text?.closest('tr');
  if (found === null || found === undefined) throw new Error(`No row for ${name}`);
  return found;
};

describe('the list of checks', () => {
  it('names the table and its columns, with a hidden name for the arrow column', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const table = screen.getByRole('table', { name: 'Technical checks' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Issue', 'Severity', 'Found by', 'Pages', 'Clicks', 'Example', 'Open']);
  });

  it('draws one header row per category, bold and in the main text colour on the subtle band', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const headers = screen.getAllByRole('rowheader').map((header) => header.textContent);
    expect(headers).toEqual(['Status', 'Pages that earn visits', 'Redirects', 'Sitemap', 'Links']);
    const status = screen.getByRole('rowheader', { name: 'Status' });
    expect(status).toHaveClass('type-body-strong', 'text-foreground', 'bg-surface-subtle', 'border-t');
    // The band stands apart by its ground and the border above it, not by size: the compact row height
    expect(status.closest('tr')).toHaveClass('h-row-compact');
  });

  it('gives a passed check the same name as one that found pages: bold and in the main text colour', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const found = screen.getByText('Pages that return a 4xx error');
    const passed = screen.getByText('Pages that return a 5xx error');
    expect(passed.className).toBe(found.className);
    expect(passed).toHaveClass('type-body-strong', 'text-foreground');
    expect(passed).not.toHaveClass('text-foreground-secondary', 'text-foreground-tertiary');
    // A check that did not run keeps the same name too
    expect(screen.getByText('Broken or redirected pages with Google clicks').className).toBe(found.className);
  });

  it('shows a passed check as Passed in the Pages cell, with a check mark', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const cells = within(row('Pages that return a 5xx error')).getAllByRole('cell');
    expect(within(cells[3] as HTMLElement).getByText('Passed')).toBeInTheDocument();
    expect(cells[3]?.querySelector('svg')).not.toBeNull();
    expect(within(row('Pages that return a 4xx error')).queryByText('Passed')).toBeNull();
  });

  it('shows the count of a check with its share of the pages crawled in a tooltip, and the clicks and an example', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const cells = within(row('Pages that return a 4xx error')).getAllByRole('cell');
    const count = within(cells[3] as HTMLElement).getByText('3');
    expect(count).toHaveAccessibleDescription('0.2% of the 1,840 pages crawled');
    expect(cells[4]).toHaveTextContent('340');
    expect(cells[5]).toHaveTextContent('/old-pricing');
  });

  it('opens a check that ran, passed or not, from its button, and says which one in the name', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(<ChecksTable {...props({ onOpen })} />);
    await user.click(screen.getByRole('button', { name: 'Open Pages that return a 4xx error' }));
    expect(onOpen).toHaveBeenLastCalledWith('status-4xx');
    await user.click(screen.getByRole('button', { name: 'Open Pages that return a 5xx error' }));
    expect(onOpen).toHaveBeenLastCalledWith('status-5xx');
  });

  it('opens a check from a click anywhere on its row', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(<ChecksTable {...props({ onOpen })} />);
    await user.click(within(row('Redirect chains')).getAllByRole('cell')[5] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith('redirect-chain');
  });

  it('gives a check that did not run no button and no arrow, and says why in the Pages cell', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(<ChecksTable {...props({ onOpen })} />);
    const notConnected = row('Broken or redirected pages with Google clicks');
    expect(within(notConnected).queryByRole('button')).toBeNull();
    expect(within(notConnected).getByText('Not connected')).toBeInTheDocument();
    expect(within(notConnected).getByRole('link', { name: 'Connect Search Console' })).toHaveAttribute(
      'href',
      INTEGRATIONS,
    );
    // No open arrow in the last cell
    const cells = within(notConnected).getAllByRole('cell');
    expect(cells[cells.length - 1]?.querySelector('svg')).toBeNull();
    await user.click(cells[0] as HTMLElement);
    expect(onOpen).not.toHaveBeenCalled();

    const notCollected = row('Broken or redirected pages cited in AI answers');
    expect(within(notCollected).getByText('Not collected yet')).toBeInTheDocument();
    expect(within(notCollected).queryByRole('button')).toBeNull();
    expect(within(notCollected).queryByRole('link')).toBeNull();
  });

  it('shows n/a with the reason for a check the crawl could not run', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const noSitemap = within(
      within(row('Sitemap lists an address that does not return 200')).getAllByRole('cell')[3] as HTMLElement,
    );
    expect(noSitemap.getByText('n/a')).toHaveAccessibleDescription('The crawl found no sitemap');
    const dropped = within(within(row('Pages with nofollow internal links')).getAllByRole('cell')[3] as HTMLElement);
    expect(dropped.getByText('n/a')).toHaveAccessibleDescription('This crawl no longer holds its links');
    expect(within(row('Pages with nofollow internal links')).queryByRole('button')).toBeNull();
  });

  it('shows n/a with a reason for clicks when Search Console is not connected or has no numbers yet', () => {
    const noClicks = (checks: readonly IssueCheck[]): IssueCheck[] =>
      checks.map((check) => ({ ...check, clicks: null }));
    const { unmount } = renderWithProviders(
      <ChecksTable {...props({ checks: noClicks(props().checks), gsc: 'not_connected' })} />,
    );
    const clicks = within(within(row('Pages that return a 4xx error')).getAllByRole('cell')[4] as HTMLElement);
    expect(clicks.getByText('n/a')).toHaveAccessibleDescription('Search Console is not connected');
    unmount();
    renderWithProviders(<ChecksTable {...props({ checks: noClicks(props().checks), gsc: 'pending' })} />);
    const pending = within(within(row('Pages that return a 4xx error')).getAllByRole('cell')[4] as HTMLElement);
    expect(pending.getByText('n/a')).toHaveAccessibleDescription('Search Console has no page numbers yet');
  });

  it('names the severity and where the check was found in each row, with what they mean as a description', () => {
    renderWithProviders(<ChecksTable {...props()} />);
    const cells = within(row('Redirect chains')).getAllByRole('cell');
    expect(within(cells[1] as HTMLElement).getByText('Warning')).toBeInTheDocument();
    expect(cells[2]).toHaveTextContent('Crawl');
    const error = within(within(row('Pages that return a 4xx error')).getAllByRole('cell')[1] as HTMLElement).getByText(
      'Error',
    );
    expect(error).toHaveClass('bg-negative-subtle');
    expect(error).toHaveAccessibleDescription('Breaks a page for visitors or for Google. Fix these first.');
    expect(within(cells[2] as HTMLElement).getByText('Crawl')).toHaveAccessibleDescription(
      'Found by crawling the site, page by page.',
    );
    expect(
      within(
        within(row('Sitemap lists an address that does not return 200')).getAllByRole('cell')[1] as HTMLElement,
      ).getByText('Warning'),
    ).toHaveClass('bg-warning-subtle');
  });

  it('writes the words of a category it has none for as its id', () => {
    const odd: IssueCheck = { ...(ISSUE_CHECKS[0] as IssueCheck), category: 'speed_tests' };
    renderWithProviders(<ChecksTable {...props({ checks: [odd] })} />);
    expect(screen.getByRole('rowheader', { name: 'speed_tests' })).toBeInTheDocument();
  });
});
