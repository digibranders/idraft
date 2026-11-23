import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { keysOfSort, pageColumns, SORT_FIELD, sortOfKeys } from './page-columns';
import { PAGE_SORTS } from '../url-state';
import type { Comparison } from '@/lib/internal-links/page-extras';
import type { PageExtras, PageRow } from '@/lib/internal-links/types';
import { crawledPages, pageRow } from '@/mocks/internal-links-world';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'internalLinks' });
const build = (comparison: Comparison = 'ready', linksAvailable = true): ReturnType<typeof pageColumns> =>
  pageColumns(t, { tiers: [], scope: 'editorial', openJourney: () => undefined, comparison, linksAvailable });
const columns = build();

describe('the sort of the Pages table (decision W5)', () => {
  it('turns every sort the address takes into a column and back', () => {
    for (const sort of PAGE_SORTS) {
      expect(sortOfKeys(keysOfSort(sort))).toBe(sort);
    }
  });

  it('has no sort for a column the server cannot sort, nor for an empty choice', () => {
    expect(sortOfKeys([{ id: 'tags', desc: false }])).toBeNull();
    expect(sortOfKeys([])).toBeNull();
    expect(keysOfSort('-linking_pages')).toEqual([{ id: 'linking', desc: true }]);
  });

  it('sorts only the thirteen columns the API sorts, and never by equity', () => {
    expect(Object.values(SORT_FIELD).sort()).toEqual([
      'anchor',
      'change',
      'citations',
      'click_depth',
      'clicks',
      'in_sitemap',
      'indexable',
      'linking_pages',
      'outlinks',
      'path',
      'rank',
      'status_code',
      'tier',
    ]);
    const sortable = columns.filter((column) => column.sortValue !== undefined).map((column) => column.id);
    expect(sortable.sort()).toEqual(Object.keys(SORT_FIELD).sort());
    expect(sortOfKeys([{ id: 'change', desc: true }])).toBe('-change');
    expect(sortOfKeys([{ id: 'rank', desc: true }])).toBe('-rank');
    expect(sortOfKeys([{ id: 'citations', desc: false }])).toBe('citations');
    expect(sortOfKeys([{ id: 'anchors', desc: true }])).toBe('-anchor');
    expect(sortOfKeys([{ id: 'sitemap', desc: true }])).toBe('-in_sitemap');
    expect(sortOfKeys([{ id: 'tier', desc: false }])).toBe('tier');
    expect(sortOfKeys([{ id: 'clicks', desc: true }])).toBe('-clicks');
    for (const id of ['keywords', 'impressions']) {
      expect(sortOfKeys([{ id, desc: false }])).toBeNull();
    }
  });
});

describe('the Pages columns', () => {
  it('shows the slice 1 columns and Change by default and keeps the rest in the chooser, with no equity column', () => {
    expect(columns.filter((column) => column.defaultVisible !== false).map((column) => column.id)).toEqual([
      'page',
      'tier',
      'status',
      'depth',
      'linking',
      'fromTiers',
      'outlinks',
      'change',
      'flags',
    ]);
    const hidden = columns.filter((column) => column.defaultVisible === false).map((column) => column.id);
    for (const id of ['keywords', 'rank', 'citations', 'anchors', 'matches', 'clicks', 'impressions']) {
      expect(hidden).toContain(id);
    }
    expect(columns.some((column) => /equity|strength/i.test(column.id) || /equity|strength/i.test(column.header))).toBe(
      false,
    );
  });
});

const PAGE = crawledPages()[0];
if (PAGE === undefined) throw new Error('The mock crawl has no page');
const BASE: PageRow = pageRow(PAGE, 'editorial');
const withExtras = (extras: PageExtras): PageRow => ({ ...BASE, extras });
const NO_MOVE = { is_new: false, editorial_in_delta: 0, depth_delta: 0, depth_state: null, equity_points: null };

/** The text of one column's cell and its tooltip for a row. */
function cellOf(
  id: string,
  row: PageRow,
  built = columns,
): { text: string; tip: string | undefined; element: ReactElement } {
  const column = built.find((candidate) => candidate.id === id);
  if (column === undefined) throw new Error(`No column ${id}`);
  const element = <>{column.cell(row)}</>;
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
  const tip = column.cellTip?.(row);
  return {
    text: container.textContent,
    tip: tip === undefined ? undefined : [tip.content, tip.detail].join(' '),
    element,
  };
}

describe('the Change column', () => {
  it('shows links in with a sign, a new page, and nothing for a page that did not move', () => {
    expect(cellOf('change', withExtras({ change: { ...NO_MOVE, editorial_in_delta: 2 } })).text).toBe('+2');
    expect(cellOf('change', withExtras({ change: { ...NO_MOVE, editorial_in_delta: -3 } })).text).toBe('−3');
    expect(cellOf('change', withExtras({ change: { ...NO_MOVE, is_new: true, editorial_in_delta: null } })).text).toBe(
      'New',
    );
    expect(cellOf('change', withExtras({ change: NO_MOVE })).text).toBe('');
  });

  it('says why there is no figure: no earlier crawl, still updating, or not available', () => {
    const none = withExtras({ change: null });
    const first = cellOf('change', none, build('first_crawl'));
    expect(first.text).toBe('n/a');
    expect(first.tip).toContain('No earlier crawl');
    const updating = cellOf('change', none, build('updating'));
    expect(updating.text).toBe('Updating');
    expect(updating.tip).toContain('still being worked out');
    expect(cellOf('change', none, build('unavailable')).text).toBe('n/a');
    // Never a zero, and never "unchanged"
    expect(updating.text).not.toMatch(/0|unchanged/i);
  });

  it('draws nothing while the part has not arrived', () => {
    expect(cellOf('change', withExtras({ keywords: null })).text).toBe('');
  });

  it('names the depth move when links in did not change, and never shows equity points', () => {
    const closer = cellOf('change', withExtras({ change: { ...NO_MOVE, depth_delta: -1, equity_points: 3 } }));
    expect(closer.text).toBe('1 click closer');
    expect(closer.text).not.toMatch(/equity|point/i);
    expect(cellOf('change', withExtras({ change: { ...NO_MOVE, depth_state: 'lost', depth_delta: null } })).text).toBe(
      'No longer reachable',
    );
  });
});

describe('the rank, citation, anchor and Google columns', () => {
  it('shows tracked keywords and the average rank with one decimal, n/a without a rank', () => {
    const keywords = { tracked: 4, ranking: 2, average_rank: 6, best_volume: 900, rank_as_of: '2026-11-18' };
    expect(cellOf('keywords', withExtras({ keywords })).text).toBe('4');
    expect(cellOf('rank', withExtras({ keywords })).text).toBe('6.0');
    expect(cellOf('rank', withExtras({ keywords: { ...keywords, average_rank: null } })).text).toBe('n/a');
  });

  it('labels rank and citations as today’s numbers, and beside an older crawl names that crawl’s date', () => {
    const header = (id: string, olderCrawlDate: string | null): { text: string; tip: string | undefined } => {
      const column = pageColumns(t, {
        tiers: [],
        scope: 'editorial',
        openJourney: () => undefined,
        comparison: 'ready',
        linksAvailable: true,
        olderCrawlDate,
      }).find((candidate) => candidate.id === id);
      return { text: String(column?.header), tip: column?.headerTooltip };
    };
    expect(header('rank', null).text).toBe('Average rank today');
    expect(header('citations', null).text).toBe('AI citations today');
    expect(header('rank', null).tip).not.toContain('This crawl is from');
    expect(header('rank', 'Nov 4, 2026').tip).toContain('This crawl is from Nov 4, 2026');
    expect(header('citations', 'Nov 4, 2026').tip).toContain('today’s numbers, not the numbers of that day');
  });

  it('shows AI citations with the engines and the window in the tooltip', () => {
    const cell = cellOf(
      'citations',
      withExtras({ citations: { chatgpt: 14, gemini: 9, ai_mode: 6, total: 29, citations_as_of: '2026-11-18' } }),
    );
    expect(cell.text).toBe('29');
    expect(cell.tip).toContain('ChatGPT 14, Gemini 9, AI Mode 6, last 28 days');
  });

  it('shows anchors, whether one matches a keyword, and Not stored for a crawl without its links', () => {
    const anchors = { total: 8, distinct: 4, generic: 2, generic_share: 0.25, matches_keyword: true };
    expect(cellOf('anchors', withExtras({ anchors })).text).toBe('4 anchors, 25% generic');
    expect(cellOf('matches', withExtras({ anchors })).text).toBe('Yes');
    expect(cellOf('matches', withExtras({ anchors: { ...anchors, matches_keyword: false } })).text).toBe('No');
    expect(cellOf('matches', withExtras({ anchors: { ...anchors, matches_keyword: null } })).text).toBe('No keywords');
    const dropped = build('ready', false);
    expect(cellOf('anchors', withExtras({ anchors: null }), dropped).text).toBe('Not stored');
    expect(cellOf('anchors', withExtras({ anchors }), dropped).text).toBe('Not stored');
    expect(cellOf('matches', withExtras({ anchors: null }), dropped).text).toBe('Not stored');
    // A part that was not asked for is not "not stored"
    expect(cellOf('anchors', withExtras({ keywords: null })).text).toBe('');
  });

  it('shows Search Console clicks, Syncing while pending and Not connected without a link', () => {
    const gsc = { state: 'ok' as const, clicks: 1810, impressions: 52000, window_start: null, window_end: null };
    expect(cellOf('clicks', withExtras({ gsc })).text).toBe('1,810');
    expect(cellOf('impressions', withExtras({ gsc })).text).toBe('52,000');
    expect(cellOf('clicks', withExtras({ gsc: { ...gsc, state: 'pending', clicks: null } })).text).toBe('Syncing');
    expect(cellOf('clicks', withExtras({ gsc: { ...gsc, state: 'not_connected', clicks: null } })).text).toBe(
      'Not connected',
    );
    expect(columns.find((column) => column.id === 'clicks')?.headerTooltip).toBe('Google data, last 28 days');
  });
});
