import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { RankChangeView, RankCellView, RankingUrlView, StaleMarker, useRankTips } from './rank-cells';
import type { CellTip } from '@/components/app/data-table/types';
import type { RankCell, RankChange, UrlRef } from '@/lib/api/types';
import { changeDisplay, rankDisplay, urlDisplay } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NOW = '2026-10-06T02:00:00Z';

const cell = (over: Partial<RankCell> = {}): RankCell => ({
  state: 'ranked',
  rank: 3,
  absolute_rank: 3,
  depth_requested: 20,
  observed_at: NOW,
  serp_snapshot_id: null,
  url: null,
  ...over,
});

const change = (label: RankChange['label'], value: number | null = null): RankChange => ({
  label,
  value,
  previous_rank: null,
  previous_observed_at: null,
});

const URL_REF: UrlRef = {
  url_id: '7',
  canonical_url: 'https://fynix.digital/blog/local-seo/choose-an-agency',
  host: 'fynix.digital',
  path: '/blog/local-seo/choose-an-agency',
  registrable_domain: 'fynix.digital',
};

const rank = (over: Partial<RankCell> = {}, stale = false): ReactElement => (
  <RankCellView display={rankDisplay(cell(over), stale)} />
);

describe('RankCellView', () => {
  it('shows a ranked keyword by its number, in the numeric style and the foreground color', () => {
    renderWithProviders(rank());
    expect(screen.getByText('3')).toHaveClass('num', 'text-foreground');
  });

  it('shows beyond depth as plain tertiary text for the depth that was checked, and says it in words', () => {
    renderWithProviders(rank({ state: 'beyond_depth', rank: null, depth_requested: 50 }));
    const glyph = screen.getByText('>50');
    expect(glyph).toHaveClass('text-foreground-tertiary');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('not in top 50')).toHaveClass('sr-only');
  });

  it('shows pending in tertiary text before the first check', () => {
    renderWithProviders(rank({ state: 'not_checked', rank: null, depth_requested: null, observed_at: null }));
    expect(screen.getByText('Pending')).toHaveClass('text-foreground-tertiary');
  });

  it('shows a failed check as a warning icon with a name, and no number', () => {
    renderWithProviders(rank({ state: 'failed', rank: null }));
    expect(screen.getByRole('img', { name: 'Check failed' })).toHaveClass('text-warning-text');
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('has no accessibility violations in any state', async () => {
    const { container } = renderWithProviders(
      <>
        {rank()}
        {rank({ state: 'beyond_depth', rank: null })}
        {rank({ state: 'failed', rank: null })}
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const changeView = (value: RankChange): ReactElement => <RankChangeView display={changeDisplay(value)} />;

describe('RankChangeView', () => {
  it('shows an arrow glyph with the places, hidden from speech, and says it in words', () => {
    renderWithProviders(changeView(change('numeric', 5)));
    const glyph = screen.getByText('↑5');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass('num', 'text-positive-text');
    expect(screen.getByText('improved 5 positions')).toHaveClass('sr-only');
  });

  it('colors a fall of more than 2 places, and leaves a move of 1 in the foreground', () => {
    renderWithProviders(
      <>
        {changeView(change('numeric', -3))}
        {changeView(change('numeric', 1))}
      </>,
    );
    expect(screen.getByText('↓3')).toHaveClass('text-negative-text');
    expect(screen.getByText('declined 3 positions')).toBeInTheDocument();
    expect(screen.getByText('↑1')).toHaveClass('text-foreground');
    expect(screen.getByText('improved 1 position')).toBeInTheDocument();
  });

  it('shows 0 for no movement, in the foreground', () => {
    renderWithProviders(changeView(change('numeric', 0)));
    expect(screen.getByText('0')).toHaveClass('text-foreground');
    expect(screen.getByText('no change')).toHaveClass('sr-only');
  });

  it('shows New and Lost in color, always', () => {
    renderWithProviders(
      <>
        {changeView(change('new'))}
        {changeView(change('lost'))}
      </>,
    );
    expect(screen.getByText('New')).toHaveClass('text-positive-text');
    expect(screen.getByText('entered the tracked depth')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toHaveClass('text-negative-text');
    expect(screen.getByText('dropped out of the tracked depth')).toBeInTheDocument();
  });

  it.each([
    ['first_check', 'first check'],
    ['unchanged_beyond', 'still beyond tracked depth'],
    ['consistent_beyond', 'still beyond tracked depth'],
  ] as const)('shows nothing visible for %s, only its words for a screen reader', (label, words) => {
    const { container } = renderWithProviders(changeView(change(label)));
    const speech = screen.getByText(words);
    expect(speech).toHaveClass('sr-only');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(container).toHaveTextContent(words);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <>
        {changeView(change('numeric', 5))}
        {changeView(change('new'))}
        {changeView(change('first_check'))}
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const urlView = (current: RankCell, count: number): ReactElement => (
  <RankingUrlView display={urlDisplay(current, count)} />
);

describe('RankingUrlView', () => {
  it('shows the path in the mono style, shortened in the middle, with the whole path for a screen reader', () => {
    renderWithProviders(urlView(cell({ url: URL_REF }), 1));
    const shown = screen.getByText('/blog/…/choose-an-agency');
    expect(shown).toHaveAttribute('aria-hidden', 'true');
    expect(shown.closest('.type-mono')).not.toBeNull();
    expect(screen.getByText(URL_REF.path)).toHaveClass('sr-only');
    expect(screen.queryByText('fynix.digital')).not.toBeInTheDocument();
  });

  it('shows a short path as it is', () => {
    renderWithProviders(urlView(cell({ url: { ...URL_REF, path: '/pricing' } }), 1));
    expect(screen.getByText('/pricing')).toBeInTheDocument();
  });

  it('adds +1 for a second ranking URL and says it in words, and nothing for one', () => {
    const { rerender } = renderWithProviders(urlView(cell({ url: URL_REF }), 2));
    expect(screen.getByText('+1')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('and 1 more of your URLs ranks')).toHaveClass('sr-only');
    rerender(urlView(cell({ url: URL_REF }), 1));
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
    rerender(urlView(cell({ url: URL_REF }), 4));
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('and 3 more of your URLs rank')).toBeInTheDocument();
  });

  it('shows Not ranking and Pending in tertiary text', () => {
    renderWithProviders(
      <>
        {urlView(cell({ state: 'beyond_depth', rank: null }), 0)}
        {urlView(cell({ state: 'not_checked', rank: null }), 0)}
      </>,
    );
    expect(screen.getByText('Not ranking')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('Pending')).toHaveClass('text-foreground-tertiary');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(urlView(cell({ url: URL_REF }), 2));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('StaleMarker', () => {
  it('is a warning word, not a box', () => {
    renderWithProviders(<StaleMarker />);
    expect(screen.getByText('Stale')).toHaveClass('text-warning-text');
  });
});

type Tips = ReturnType<typeof useRankTips>;

/** The three lines of a tip the hook builds, read back from the page. */
function renderTip(pick: (tips: Tips) => CellTip | undefined): {
  content: string;
  detail: string;
  description: string;
} {
  function Show(): ReactElement {
    const tip = pick(useRankTips('UTC'));
    return (
      <>
        <p data-testid="content">{tip?.content ?? 'none'}</p>
        <p data-testid="detail">{tip?.detail ?? 'none'}</p>
        <p data-testid="description">{tip?.description ?? 'none'}</p>
      </>
    );
  }
  const { unmount } = renderWithProviders(<Show />);
  const read = {
    content: screen.getByTestId('content').textContent,
    detail: screen.getByTestId('detail').textContent,
    description: screen.getByTestId('description').textContent,
  };
  unmount();
  return read;
}

const DATE = 'Oct 6, 2026 · 02:00 UTC';

describe('rank tips', () => {
  it('gives a ranked keyword its rank, its check and its depth', () => {
    expect(renderTip((tips) => tips.rank(rankDisplay(cell(), false)))).toMatchObject({
      content: `Rank 3, ${DATE}, depth 20`,
      detail: 'none',
    });
  });

  it('gives a keyword beyond the depth the depth that was checked', () => {
    const beyond = rankDisplay(cell({ state: 'beyond_depth', rank: null, depth_requested: 50 }), false);
    expect(renderTip((tips) => tips.rank(beyond)).content).toBe(`Not in the top 50, ${DATE}`);
  });

  it('adds the last good check of a stale keyword as its detail, and the screen reader hears both lines', () => {
    expect(renderTip((tips) => tips.rank(rankDisplay(cell(), true)))).toMatchObject({
      content: `Rank 3, ${DATE}, depth 20`,
      detail: `Last successful check: ${DATE}`,
      description: 'none',
    });
  });

  it('explains Pending and a failed check', () => {
    expect(renderTip((tips) => tips.rank({ kind: 'pending' })).content).toBe('The first check has not run yet.');
    expect(renderTip((tips) => tips.rank({ kind: 'failed', observedAt: null, stale: false }))).toMatchObject({
      content: 'The last check failed. It will be tried again.',
      detail: 'none',
    });
    expect(renderTip((tips) => tips.rank({ kind: 'failed', observedAt: NOW, stale: true })).detail).toBe(
      `Last successful check: ${DATE}`,
    );
  });
});

describe('stale tip', () => {
  it('says the rank shown is from the last check that worked, and when that was', () => {
    expect(renderTip((tips) => tips.stale(NOW))).toMatchObject({
      content: 'No recent successful check. The rank shown is from the last one that worked.',
      detail: `Last successful check: ${DATE}`,
    });
    expect(renderTip((tips) => tips.stale(null)).detail).toBe('none');
  });
});

describe('change and URL tips', () => {
  it('says where a rank moved from and to, and what a screen reader hears after the words', () => {
    const moved: RankChange = { label: 'numeric', value: 5, previous_rank: 8, previous_observed_at: NOW };
    expect(renderTip((tips) => tips.change(moved, cell()))).toEqual({
      content: 'improved 5 positions',
      detail: 'From 8 to 3',
      description: 'From 8 to 3',
    });
    const fell: RankChange = { label: 'numeric', value: -1, previous_rank: 2, previous_observed_at: NOW };
    expect(renderTip((tips) => tips.change(fell, cell({ rank: 3 }))).content).toBe('declined 1 position');
  });

  it('gives no tip to a change that has nothing to explain', () => {
    expect(renderTip((tips) => tips.change(change('first_check'), cell())).content).toBe('none');
    expect(renderTip((tips) => tips.change(change('new'), cell())).content).toBe('none');
    // A numeric change without both ranks cannot say from where to where
    expect(renderTip((tips) => tips.change(change('numeric', 4), cell({ rank: null }))).detail).toBe('none');
  });

  it('shows the whole address and the check for a ranking URL, and only the check to a screen reader', () => {
    const ranked = cell({ url: URL_REF });
    expect(renderTip((tips) => tips.url(urlDisplay(ranked, 1), rankDisplay(ranked, false)))).toEqual({
      content: URL_REF.canonical_url,
      detail: `Checked ${DATE}`,
      description: `Checked ${DATE}`,
    });
  });

  it('explains Pending in the URL column, and a failed check as such', () => {
    const pending = cell({ state: 'not_checked', rank: null, depth_requested: null, observed_at: null });
    expect(renderTip((tips) => tips.url(urlDisplay(pending, 0), rankDisplay(pending, false))).content).toBe(
      'The first check has not run yet.',
    );
    const failed = cell({ state: 'failed', rank: null });
    expect(renderTip((tips) => tips.url(urlDisplay(failed, 0), rankDisplay(failed, false))).content).toBe(
      'The last check failed. It will be tried again.',
    );
    const none = cell({ state: 'beyond_depth', rank: null });
    expect(renderTip((tips) => tips.url(urlDisplay(none, 0), rankDisplay(none, false))).content).toBe('none');
  });
});
