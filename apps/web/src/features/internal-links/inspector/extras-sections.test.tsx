import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExtrasSections } from './extras-sections';
import type { Comparison } from '@/lib/internal-links/page-extras';
import type { PageDetailExtras } from '@/lib/internal-links/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const BASE: PageDetailExtras = {
  anchors: {
    total: 10,
    distinct: 3,
    generic: 4,
    generic_share: 0.4,
    matches_keyword: true,
    top: [
      { text: 'managed soc', count: 5, generic: false },
      { text: 'click here', count: 4, generic: true },
    ],
  },
  change: { is_new: false, editorial_in_delta: 2, equity_points: 3.5, depth_state: null, depth_delta: 1 },
  citations: { chatgpt: 5, gemini: 3, ai_mode: 2, total: 10, citations_as_of: '2026-11-18' },
  gsc: { state: 'ok', clicks: 1320, impressions: 28400, window_start: '2026-10-18', window_end: '2026-11-14' },
  keywords: [
    { keyword: 'soc as a service', rank: 4, change: 2, volume: 1900, rank_as_of: '2026-11-18' },
    { keyword: 'managed soc', rank: 12, change: -3, volume: 880, rank_as_of: '2026-11-18' },
    { keyword: 'soc pricing', rank: null, change: null, volume: null, rank_as_of: null },
  ],
};

function show(
  patch: Partial<PageDetailExtras> = {},
  comparison: Comparison | null = 'ready',
  linksAvailable = true,
  linksCompared = true,
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ExtrasSections
      extras={{ ...BASE, ...patch }}
      comparison={comparison}
      linksAvailable={linksAvailable}
      linksCompared={linksCompared}
    />,
  );
}
const card = (name: string): HTMLElement => screen.getByRole('heading', { name }).closest('section') as HTMLElement;

afterEach(() => document.documentElement.classList.remove('dark'));

describe('changes since the last crawl', () => {
  it('shows editorial links in with a sign and the depth move in words, and no strength figure', () => {
    show();
    const section = card('Changes since the last crawl');
    expect(section).toHaveTextContent('Editorial links in');
    expect(section).toHaveTextContent('+2');
    expect(section).toHaveTextContent('1 level deeper');
    expect(section.textContent).not.toMatch(/strength|equity|points/i);
  });

  it('says New page for a new page', () => {
    show({
      change: { is_new: true, editorial_in_delta: null, equity_points: null, depth_state: null, depth_delta: null },
    });
    expect(card('Changes since the last crawl')).toHaveTextContent('New page');
  });

  it.each([
    ['lost', 'No longer reachable'],
    ['found', 'Now reachable'],
  ] as const)('says %s depth in words', (state, text) => {
    show({
      change: { is_new: false, editorial_in_delta: 0, equity_points: null, depth_state: state, depth_delta: null },
    });
    expect(card('Changes since the last crawl')).toHaveTextContent(text);
  });

  it('says there is no change when nothing moved, and ignores a change in equity points only', () => {
    show({ change: { is_new: false, editorial_in_delta: 0, equity_points: 4, depth_state: null, depth_delta: 0 } });
    expect(card('Changes since the last crawl')).toHaveTextContent('No change since the last crawl');
  });

  it.each([['first_crawl'], [null]] as const)('is absent when the comparison is %s', (comparison) => {
    show({ change: null }, comparison);
    expect(screen.queryByRole('heading', { name: 'Changes since the last crawl' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tracked keywords' })).toBeInTheDocument();
  });

  it('says Updating while the comparison is worked out, and Not available when it failed', () => {
    const { unmount } = show({ change: null }, 'updating');
    expect(card('Changes since the last crawl')).toHaveTextContent('Updating');
    expect(card('Changes since the last crawl')).not.toHaveTextContent('+0');
    unmount();
    show({ change: null }, 'unavailable');
    expect(card('Changes since the last crawl')).toHaveTextContent('Not available');
  });
});

describe('tracked keywords', () => {
  it('lists keyword, rank, places moved and volume in a table with a caption', () => {
    show();
    const section = card('Tracked keywords');
    expect(section).toHaveTextContent('idraft rank tracking');
    const table = within(section).getByRole('table', { name: /tracked keywords/i });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Keyword', 'Rank', 'Places moved', 'Searches a month']);
    const first = within(table).getByRole('row', { name: /soc as a service/ });
    expect(first).toHaveTextContent('#4');
    expect(first).toHaveTextContent('Up 2');
    expect(first).toHaveTextContent('1,900');
    expect(within(table).getByRole('row', { name: /managed soc/ })).toHaveTextContent('Down 3');
    expect(within(table).getByRole('row', { name: /soc pricing/ })).toHaveTextContent('No rank yet');
  });

  it('lets a long keyword break inside the narrow inspector', () => {
    show({ keywords: [{ keyword: 'a'.repeat(120), rank: 1, change: 0, volume: 10, rank_as_of: '2026-11-18' }] });
    const cell = within(card('Tracked keywords')).getByRole('rowheader');
    expect(cell).toHaveClass('break-words', 'min-w-0');
  });

  it('says when the page has no tracked keywords', () => {
    show({ keywords: [] });
    expect(card('Tracked keywords')).toHaveTextContent('No tracked keywords for this page.');
  });
});

describe('AI citations', () => {
  it('shows the three engines, the total and that the numbers are today', () => {
    show();
    const section = card('AI citations');
    expect(section).toHaveTextContent(/ChatGPT\s*5/);
    expect(section).toHaveTextContent(/Gemini\s*3/);
    expect(section).toHaveTextContent(/AI Mode\s*2/);
    expect(section).toHaveTextContent('Cited in 10 answers');
    expect(section).toHaveTextContent('today');
  });

  it('says Cited in 0 answers when every count is zero', () => {
    show({ citations: { chatgpt: 0, gemini: 0, ai_mode: 0, total: 0, citations_as_of: null } });
    expect(card('AI citations')).toHaveTextContent('Cited in 0 answers');
  });
});

describe('anchor text pointing here', () => {
  it('lists the top anchors with a Generic badge, the summary and the keyword match', () => {
    show();
    const section = card('Anchor text pointing here');
    const table = within(section).getByRole('table', { name: /anchor text/i });
    expect(within(table).getByRole('row', { name: /managed soc/ })).toHaveTextContent('5');
    const generic = within(table).getByRole('row', { name: /click here/ });
    expect(generic).toHaveTextContent('Generic');
    expect(generic).toHaveTextContent('4');
    expect(section).toHaveTextContent('3 distinct, 40% generic');
    expect(section).toHaveTextContent('An anchor contains a tracked keyword');
  });

  it('says no anchor contains a tracked keyword, or nothing when there is no keyword', () => {
    const none = show({ anchors: { ...BASE.anchors, matches_keyword: false } });
    expect(card('Anchor text pointing here')).toHaveTextContent('No anchor contains a tracked keyword');
    none.unmount();
    show({ anchors: { ...BASE.anchors, matches_keyword: null } });
    const section = card('Anchor text pointing here');
    expect(section).not.toHaveTextContent(/tracked keyword/);
  });

  it('says there are no anchors when no editorial link points here', () => {
    show({ anchors: { total: 0, distinct: 0, generic: 0, generic_share: 0, matches_keyword: null, top: [] } });
    expect(card('Anchor text pointing here')).toHaveTextContent('No editorial links point here');
  });

  it('never reads a link change that was not compared as zero', () => {
    const moved = show({}, 'ready', true, false);
    expect(card('Changes since the last crawl')).toHaveTextContent('Not compared');
    expect(card('Changes since the last crawl')).not.toHaveTextContent('+2');
    moved.unmount();
    show(
      { change: { is_new: false, editorial_in_delta: 0, equity_points: null, depth_state: null, depth_delta: 0 } },
      'ready',
      true,
      false,
    );
    expect(card('Changes since the last crawl')).toHaveTextContent('Links were not compared with the last crawl');
    expect(card('Changes since the last crawl')).not.toHaveTextContent('No change');
  });

  it('says Not stored when the crawl no longer holds its links', () => {
    const dropped = show({ anchors: { ...BASE.anchors, distinct: null, matches_keyword: null, top: null } });
    expect(card('Anchor text pointing here')).toHaveTextContent('Not stored');
    expect(within(card('Anchor text pointing here')).queryByRole('table')).toBeNull();
    dropped.unmount();
    show({}, 'ready', false);
    expect(card('Anchor text pointing here')).toHaveTextContent('Not stored');
  });
});

describe('the parts a tab asks for', () => {
  const headings = (): (string | null)[] => screen.getAllByRole('heading').map((node) => node.textContent);

  it('draws only the tracked keywords card for parts keywords', () => {
    renderWithProviders(
      <ExtrasSections extras={BASE} comparison="ready" linksAvailable linksCompared parts={['keywords']} />,
    );
    expect(headings()).toEqual(['Tracked keywords']);
  });

  it('draws the cards asked for, in the usual order', () => {
    renderWithProviders(
      <ExtrasSections extras={BASE} comparison="ready" linksAvailable linksCompared parts={['anchors', 'changes']} />,
    );
    expect(headings()).toEqual(['Changes since the last crawl', 'Anchor text pointing here']);
  });

  it('draws every card without parts', () => {
    show();
    expect(headings()).toHaveLength(4);
  });
});

describe('what the sections never show', () => {
  it('has no equity or strength in text, names or titles', () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/equity|strength/i);
    const attributes = [...container.querySelectorAll('[aria-label], [title]')].map(
      (element) => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
    );
    expect(attributes.join(' ')).not.toMatch(/equity|strength/i);
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = show();
    expect(await axe(container)).toHaveNoViolations();
  });
});
