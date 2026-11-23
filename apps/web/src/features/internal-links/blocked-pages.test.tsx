import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CoverageNote } from './crawl-states';
import { StatusBadge } from './status-badge';
import { pageFlags, type FlaggedPage } from '@/lib/internal-links/page-flags';
import { isBlockedStatus, readPages } from '@/lib/internal-links/status';
import type { CrawlRun } from '@/lib/internal-links/types';
import { crawlsOf, EVENTUS } from '@/mocks/internal-links-world';
import { renderWithProviders } from '@/test/render';

const BASE: FlaggedPage = {
  flags: [],
  broken_outlinks: 0,
  redirect_outlinks: 0,
  linking_pages: 5,
  is_indexable: true,
  status_code: 403,
  tier: null,
};

describe('a page that refused the crawler', () => {
  it('counts 401, 403 and 429 as blocked, and nothing else', () => {
    expect([401, 403, 429].every(isBlockedStatus)).toBe(true);
    expect([200, 301, 404, 410, 500, null].some(isBlockedStatus)).toBe(false);
  });

  it('reads the pages the crawl could read, and says nothing when none refused', () => {
    expect(readPages(1000, 60)).toEqual({ read: 940, crawled: 1000 });
    expect(readPages(1000, 0)).toBeNull();
    expect(readPages(1000, null)).toBeNull();
  });

  it('shows a grey Blocked chip, never the number or a red chip', () => {
    renderWithProviders(<StatusBadge status={403} />);
    const chip = screen.getByText('Blocked');
    expect(chip).toHaveClass('bg-neutral-subtle');
    expect(chip.className).not.toMatch(/negative|warning/);
    expect(screen.queryByText('403')).toBeNull();
  });

  it('keeps the number in red for a page that is not found', () => {
    renderWithProviders(<StatusBadge status={404} />);
    expect(screen.getByText('404').className).toMatch(/negative/);
  });

  it('flags a blocked row as Blocked in neutral, not as an error page', () => {
    expect(pageFlags({ ...BASE, flags: ['blocked'] }, 'all')).toEqual([{ key: 'blocked', tone: 'neutral' }]);
  });
});

describe('the coverage note', () => {
  const run = (blocked: number | null): CrawlRun => ({
    ...(crawlsOf(EVENTUS.project_id)[0] as CrawlRun),
    pages_crawled: 1000,
    pages_blocked: blocked,
  });

  it('says how many pages were read and that numbers may be incomplete', () => {
    renderWithProviders(<CoverageNote run={run(60)} />);
    expect(
      screen.getByText('Read 940 of 1,000 pages; 60 refused our crawler, so numbers may be incomplete.'),
    ).toBeInTheDocument();
  });

  it.each([[0], [null]])('is absent when %s pages refused the crawler', (blocked) => {
    renderWithProviders(<CoverageNote run={run(blocked)} />);
    expect(screen.queryByText(/refused our crawler/)).toBeNull();
  });
});
