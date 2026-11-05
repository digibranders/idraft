import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TrackedKeywordRow, UrlRef } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';
import type { PairedRow } from './keyword-pairs';
import { RankingPagesCard, rankingPages } from './ranking-pages';

const url = (id: string, path: string): UrlRef => ({
  url_id: id,
  canonical_url: `https://eventussecurity.com${path}`,
  host: 'eventussecurity.com',
  registrable_domain: 'eventussecurity.com',
  path,
});

type Page = { url: UrlRef; rank: number; shares_rank: boolean };

function tracked(device: 'desktop' | 'mobile', pages: Page[] | null, best?: Page): TrackedKeywordRow {
  return {
    device,
    ranking_urls: pages,
    state: {
      current: best
        ? { state: 'ranked', rank: best.rank, url: best.url }
        : { state: 'beyond_depth', rank: null, url: null },
    },
  } as unknown as TrackedKeywordRow;
}

const GUIDE = url('1', '/best-soc-guide');
const SERVICE = url('2', '/managed-soc-service');
const SITELINK = url('3', '/best-soc-guide/pricing');

function paired(desktop: TrackedKeywordRow | null, mobile: TrackedKeywordRow | null): PairedRow {
  const primary = (desktop ?? mobile) as TrackedKeywordRow;
  return { ...primary, devices: { desktop, mobile } };
}

describe('rankingPages', () => {
  it('lists a page once with its rank on the device shown, best first', () => {
    const row = paired(
      tracked('desktop', [
        { url: SERVICE, rank: 16, shares_rank: false },
        { url: GUIDE, rank: 5, shares_rank: false },
      ]),
      tracked('mobile', [
        { url: GUIDE, rank: 13, shares_rank: false },
        { url: SERVICE, rank: 19, shares_rank: false },
      ]),
    );

    const pages = rankingPages(row, 'desktop');

    expect(pages.map((page) => [page.url.path, page.rank])).toEqual([
      ['/best-soc-guide', 5],
      ['/managed-soc-service', 16],
    ]);
  });

  it('lists a page with the rank of the device shown only', () => {
    const row = paired(
      tracked('desktop', [{ url: GUIDE, rank: 3, shares_rank: false }]),
      tracked('mobile', [{ url: GUIDE, rank: 9, shares_rank: false }]),
    );

    expect(rankingPages(row, 'mobile').map((entry) => entry.rank)).toEqual([9]);
  });

  it('keeps to the devices the table shows', () => {
    const row = paired(
      tracked('desktop', [{ url: GUIDE, rank: 5, shares_rank: false }]),
      tracked('mobile', [{ url: SERVICE, rank: 19, shares_rank: false }]),
    );

    expect(rankingPages(row, 'mobile').map((page) => page.url.path)).toEqual(['/managed-soc-service']);
    expect(rankingPages(row, 'desktop').map((page) => page.url.path)).toEqual(['/best-soc-guide']);
  });

  it('marks a page that shares a rank as a sub-result', () => {
    const row = paired(
      tracked('desktop', [
        { url: GUIDE, rank: 3, shares_rank: false },
        { url: SITELINK, rank: 3, shares_rank: true },
      ]),
      null,
    );

    expect(rankingPages(row, 'desktop').map((page) => [page.url.path, page.sharesRank])).toEqual([
      ['/best-soc-guide', false],
      ['/best-soc-guide/pricing', true],
    ]);
  });

  it('falls back to the page the state names when the rows did not carry the pages', () => {
    const row = paired(tracked('desktop', null, { url: GUIDE, rank: 7, shares_rank: false }), null);

    expect(rankingPages(row, 'desktop').map((page) => [page.url.path, page.rank])).toEqual([['/best-soc-guide', 7]]);
  });

  it('lists nothing for a keyword that does not rank', () => {
    expect(rankingPages(paired(tracked('desktop', []), tracked('mobile', [])), 'desktop')).toEqual([]);
  });
});

describe('RankingPagesCard', () => {
  const pages = rankingPages(
    paired(
      tracked('desktop', [
        { url: GUIDE, rank: 5, shares_rank: false },
        { url: SERVICE, rank: 16, shares_rank: false },
      ]),
      tracked('mobile', [
        { url: GUIDE, rank: 13, shares_rank: false },
        { url: SERVICE, rank: 19, shares_rank: false },
      ]),
    ),
    'desktop',
  );

  it('opens on hover with each page, its rank on the device shown and the time of the check', async () => {
    const { user } = renderWithProviders(
      <RankingPagesCard
        trigger={<a href="https://eventussecurity.com/best-soc-guide">Open</a>}
        pages={pages}
        checkedAt="2026-11-04T05:00:00Z"
        timeZone="UTC"
      />,
    );

    await user.hover(screen.getByRole('link', { name: 'Open' }));

    expect(await screen.findByText('2 pages rank for this keyword', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '/best-soc-guide' })).toHaveAttribute(
      'href',
      'https://eventussecurity.com/best-soc-guide',
    );
    expect(screen.getByRole('link', { name: '/managed-soc-service' })).toBeInTheDocument();
    expect(screen.getByText('Best rank')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('/best-soc-guideBest rank5');
    expect(rows[1]).not.toHaveTextContent('13');
    expect(rows[2]).toHaveTextContent('/managed-soc-service16');
    expect(rows[2]).not.toHaveTextContent('19');
    expect(screen.getByText(/At the last check/)).toBeInTheDocument();
  });
});
