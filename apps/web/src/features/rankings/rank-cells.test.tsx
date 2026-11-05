import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BestRankView,
  PATH_END_CHARS,
  RankChangeView,
  RankCellView,
  RankingUrlView,
  StaleMarker,
  useRankTips,
} from './rank-cells';
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

const rank = (over: Partial<RankCell> = {}, stale = false, failures = 0): ReactElement => (
  <RankCellView display={rankDisplay(cell(over), stale, failures)} />
);

/** The marker glyphs of a cell: they are decoration, the words for them are hidden text. */
const glyphsIn = (container: HTMLElement): Element[] => [...container.querySelectorAll('svg[data-slot="icon"]')];

describe('RankCellView', () => {
  it('shows a ranked keyword by its number, in the numeric style and the foreground color', () => {
    renderWithProviders(rank());
    expect(screen.getByText('3')).toHaveClass('num', 'text-foreground');
  });

  it('shows beyond depth as a plain tertiary hyphen, and says in words the depth that was checked', () => {
    renderWithProviders(rank({ state: 'beyond_depth', rank: null, depth_requested: 50 }));
    const glyph = screen.getByText('-');
    expect(glyph).toHaveClass('text-foreground-tertiary');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('not in top 50')).toHaveClass('sr-only');
    expect(screen.queryByText('>50')).toBeNull();
  });

  it('shows a hyphen for a keyword not found within the top 100, whatever number of results Google returned', () => {
    renderWithProviders(rank({ state: 'beyond_depth', rank: null, depth_requested: 100, depth_returned: 66 }));
    expect(screen.getByText('-')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('not in top 100')).toHaveClass('sr-only');
    expect(screen.queryByText('>100')).toBeNull();
    expect(screen.queryByText('>66')).toBeNull();
  });

  it('keeps the rank and its change in one group: a three-digit box, a small gap, the number ending at the change', () => {
    const { container } = renderWithProviders(
      <RankCellView display={rankDisplay(cell({ rank: 32 }), false)} change={changeDisplay(change('numeric', 30))} />,
    );
    const group = container.firstElementChild;
    expect(group).toHaveClass('flex', 'gap-1.5');
    expect(group).not.toHaveClass('gap-2');
    const [box, slot] = [...(group?.children ?? [])];
    expect(box).toHaveClass('w-7', 'shrink-0', 'justify-end', 'text-right');
    expect(box).toContainElement(screen.getByText('32'));
    expect(slot).toHaveTextContent('↑30');
  });

  it('leaves pending as it was: the word alone, with no rank box', () => {
    const { container } = renderWithProviders(rank({ state: 'not_checked', rank: null }));
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(container.querySelector('.w-7')).toBeNull();
    expect(screen.queryByText('-')).toBeNull();
  });

  it('marks a drop that one check has not yet confirmed, with words for a screen reader', () => {
    renderWithProviders(
      <RankCellView
        display={rankDisplay(cell({ state: 'beyond_depth', rank: null }), false, 0, { dropUnconfirmed: true })}
      />,
    );
    expect(screen.getByText('drop not yet confirmed')).toHaveClass('sr-only');
  });

  it('marks a keyword with a check on its way, and one whose latest check could not say', () => {
    const { unmount } = renderWithProviders(
      <RankCellView display={rankDisplay(cell(), false, 0, { check: { status: 'processing' } })} />,
    );
    expect(screen.getByText('check in progress')).toHaveClass('sr-only');
    expect(screen.getByText('3')).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <RankCellView display={rankDisplay(cell(), false, 0, { check: { status: 'inconclusive' } })} />,
    );
    expect(screen.getByText('latest check inconclusive')).toHaveClass('sr-only');
    expect(screen.queryByText('check in progress')).toBeNull();
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

  it('shows no marker for a rank that is neither stale nor failing', () => {
    const { container } = renderWithProviders(rank());
    expect(glyphsIn(container)).toHaveLength(0);
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.queryByText('last check failed')).not.toBeInTheDocument();
  });

  it.each([
    ['ranked', {}, '3'],
    ['beyond the depth', { state: 'beyond_depth', rank: null }, '-'],
  ] as const)('marks a stale rank that is %s with a clock, for every width, and says so in words', (_, over, shown) => {
    const { container } = renderWithProviders(rank(over, true));
    expect(screen.getByText(shown)).toBeInTheDocument();
    const [glyph, ...rest] = glyphsIn(container);
    expect(rest).toHaveLength(0);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass('text-warning-text');
    expect(screen.getByText('stale')).toHaveClass('sr-only');
  });

  it('marks a stale keyword whose checks all failed with the clock beside the warning', () => {
    const { container } = renderWithProviders(rank({ state: 'failed', rank: null }, true));
    expect(screen.getByRole('img', { name: 'Check failed' })).toBeInTheDocument();
    expect(glyphsIn(container)).toHaveLength(2);
    expect(screen.getByText('stale')).toHaveClass('sr-only');
  });

  it('keeps the rank of the last good check and warns that the checks since then failed', () => {
    const { container } = renderWithProviders(rank({}, false, 2));
    expect(screen.getByText('3')).toHaveClass('num', 'text-foreground');
    const [glyph, ...rest] = glyphsIn(container);
    expect(rest).toHaveLength(0);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass('text-warning-text');
    expect(screen.getByText('last check failed')).toHaveClass('sr-only');
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('warns for a failing check beyond the depth too, and shows both marks for a stale failing one', () => {
    const { container } = renderWithProviders(rank({ state: 'beyond_depth', rank: null }, true, 4));
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(glyphsIn(container)).toHaveLength(2);
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByText('last check failed')).toBeInTheDocument();
  });

  it('has no accessibility violations in any state', async () => {
    const { container } = renderWithProviders(
      <>
        {rank()}
        {rank({ state: 'beyond_depth', rank: null })}
        {rank({ state: 'failed', rank: null })}
        {rank({}, true, 2)}
        {rank({ state: 'beyond_depth', rank: null }, true)}
        {rank({ state: 'failed', rank: null }, true)}
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('gives failed, ranked, beyond and stale cases the same fixed 28 px rank box and slot alignment', () => {
    const chg = changeDisplay(change('numeric', 2));
    const { container } = renderWithProviders(
      <div>
        <div data-testid="ranked">
          <RankCellView display={rankDisplay(cell({ rank: 5 }), false)} change={chg} />
        </div>
        <div data-testid="beyond">
          <RankCellView display={rankDisplay(cell({ state: 'beyond_depth', rank: null }), false)} change={chg} />
        </div>
        <div data-testid="failed">
          <RankCellView display={rankDisplay(cell({ state: 'failed', rank: null }), false)} change={chg} />
        </div>
        <div data-testid="stale">
          <RankCellView display={rankDisplay(cell({ rank: 5 }), true)} change={chg} />
        </div>
        <div data-testid="stale-beyond-100">
          <RankCellView
            display={rankDisplay(cell({ state: 'beyond_depth', rank: null, depth_requested: 100 }), true)}
            change={chg}
          />
        </div>
      </div>,
    );

    for (const testId of ['ranked', 'beyond', 'failed', 'stale', 'stale-beyond-100']) {
      const el = container.querySelector(`[data-testid="${testId}"]`);
      const rankBox = el?.querySelector('.w-7');
      expect(rankBox).toBeInTheDocument();
      expect(rankBox).toHaveClass('w-7', 'shrink-0');
      expect(rankBox).not.toHaveClass('overflow-hidden');
    }
  });

  it('renders rank 100 without truncation or clipping', () => {
    const { getByText } = renderWithProviders(<RankCellView display={rankDisplay(cell({ rank: 100 }), false)} />);
    expect(getByText('100')).toBeInTheDocument();
  });

  it('shows tooltip with last successful check date on stale clock icon', async () => {
    const { user } = renderWithProviders(
      <RankCellView
        display={rankDisplay(cell({ rank: 5, observed_at: '2026-10-29T10:00:00Z' }), true)}
        timeZone="UTC"
      />,
    );
    await user.hover(screen.getByText('stale'));
    await waitFor(() =>
      expect(screen.getByText('Last successful check: Oct 29, 2026 · 10:00 UTC.')).toBeInTheDocument(),
    );
  });

  it('shows a hyphen at depth 100 and at depth 20, with the depth in the words', () => {
    const { rerender } = renderWithProviders(
      <RankCellView display={rankDisplay(cell({ state: 'beyond_depth', rank: null, depth_requested: 100 }), false)} />,
    );
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('not in top 100')).toHaveClass('sr-only');

    rerender(
      <RankCellView display={rankDisplay(cell({ state: 'beyond_depth', rank: null, depth_requested: 20 }), false)} />,
    );
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('not in top 20')).toHaveClass('sr-only');
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
    // One side of the pair may have a rank (35 against a depth of 20), so this one does not say "still beyond"
    ['consistent_beyond', 'no change within the depth checked'],
  ] as const)('shows nothing visible for %s, only its words for a screen reader', (label, words) => {
    const { container } = renderWithProviders(changeView(change(label)));
    const speech = screen.getByText(words);
    expect(speech).toHaveClass('sr-only');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(container).toHaveTextContent(words);
  });

  it('says nothing at all before the first check has produced a rank', () => {
    renderWithProviders(
      <span data-testid="cell">
        <RankChangeView display={{ kind: 'blank' }} />
      </span>,
    );
    const cell = screen.getByTestId('cell');
    expect(cell).toBeEmptyDOMElement();
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
  it('shows the path in the mono family at the table size, its start giving way to an ellipsis and its end always in view', () => {
    renderWithProviders(urlView(cell({ url: URL_REF }), 1));
    // The end tells URLs apart, so it never shrinks; the start is clipped with an ellipsis by CSS, not cut by code
    const end = URL_REF.path.slice(-PATH_END_CHARS);
    const start = URL_REF.path.slice(0, -PATH_END_CHARS);
    const tail = screen.getByText(end);
    expect(tail).toHaveClass('shrink-0');
    expect(tail).not.toHaveClass('truncate');
    const head = screen.getByText(start);
    expect(head).toHaveClass('truncate');
    expect(head.closest('.font-mono')).not.toBeNull();
    // Nothing of the path is dropped from the text, so no part of it is cut twice
    expect(head.textContent + (tail.textContent ?? '')).toBe(URL_REF.path);
    expect(head.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(URL_REF.path)).toHaveClass('sr-only');
    expect(screen.queryByText('fynix.digital')).not.toBeInTheDocument();
  });

  it('keeps the end of a path of 28 characters or more, which no mono cell of 180 px holds', () => {
    const long = '/blog/how-to-choose-an-seo-agency';
    expect(long.length).toBeGreaterThanOrEqual(28);
    renderWithProviders(
      urlView(cell({ url: { ...URL_REF, path: long, canonical_url: `https://fynix.digital${long}` } }), 1),
    );
    const tail = screen.getByText(long.slice(-PATH_END_CHARS));
    expect(tail).toHaveClass('shrink-0');
    expect(tail.textContent).toMatch(/seo-agency$/);
  });

  it('shows a path no longer than its end as one piece', () => {
    renderWithProviders(urlView(cell({ url: { ...URL_REF, path: '/pricing' } }), 1));
    const shown = screen.getByText('/pricing');
    expect(shown).toHaveClass('truncate');
    expect(shown).not.toHaveAttribute('aria-hidden');
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

  it('shows n/a in tertiary text after a failed check: not Pending, and not Not ranking', () => {
    renderWithProviders(urlView(cell({ state: 'failed', rank: null }), 0));
    expect(screen.getByText('n/a')).toHaveClass('text-foreground-tertiary');
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Not ranking')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(urlView(cell({ url: URL_REF }), 2));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('RankingUrlView link and copy button', () => {
  /** What the API sends is copied and opened as it is: a fragment and tracking parameters stay. */
  const FULL = 'https://fynix.digital/blog/local-seo/choose-an-agency?utm_source=news&ref=x#top';
  const withUrl = (canonical_url: string): ReactElement => urlView(cell({ url: { ...URL_REF, canonical_url } }), 2);
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const OPEN = `Open ${URL_REF.path} in a new tab`;

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  /** Rendered, then given a clipboard: rendering sets up user-event, which installs one of its own. */
  function renderUrl(ui: ReactElement): ReturnType<typeof renderWithProviders> {
    const view = renderWithProviders(ui);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return view;
  }

  it('links the path to the whole address in a new tab, and says so in its name', () => {
    renderUrl(withUrl(FULL));
    const link = screen.getByRole('link', { name: OPEN });
    expect(link).toHaveAttribute('href', FULL);
    expect(link).toHaveAttribute('target', '_blank');
    // An outbound link of search data: no opener, no referrer, and no endorsement
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    // The grid keeps its one tab stop: the table moves into the link with F2
    expect(link).toHaveAttribute('tabindex', '-1');
    expect(link).toHaveAttribute('data-cell-control');
    expect(link).toHaveTextContent(URL_REF.path);
  });

  it('draws the link in the link color, underlined on hover and focus, so it is seen as a link', () => {
    renderUrl(withUrl(FULL));
    const link = screen.getByRole('link', { name: OPEN });
    expect(link).toHaveClass('text-link', 'hover:underline', 'focus-visible:underline');
    expect(link).not.toHaveClass('text-inherit');
  });

  it('lays the copy button over the end of the cell when there is no +N, so the path keeps the whole width', () => {
    const { rerender } = renderUrl(urlView(cell({ url: URL_REF }), 1));
    const wrapper = screen.getByRole('button', { name: 'Copy ranking URL' }).parentElement;
    expect(wrapper).toHaveClass('absolute', 'right-0', 'bg-inherit');
    expect(wrapper).not.toHaveClass('shrink-0');
    // What the button lies over is positioned and hands the cell's own background on
    expect(wrapper?.parentElement).toHaveClass('relative', 'bg-inherit');
    // Beside a +N the button has a place of its own: the marker is never covered
    rerender(urlView(cell({ url: URL_REF }), 2));
    const inline = screen.getByRole('button', { name: 'Copy ranking URL' }).parentElement;
    expect(inline).toHaveClass('shrink-0');
    expect(inline).not.toHaveClass('absolute');
  });

  it('keeps the +1 marker, and its words, out of the link', () => {
    renderUrl(withUrl(FULL));
    const link = screen.getByRole('link', { name: OPEN });
    expect(link).not.toHaveTextContent('+1');
    expect(link).not.toHaveTextContent('more of your URLs');
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('and 1 more of your URLs ranks')).toBeInTheDocument();
  });

  it('is a link for http and https only: any other scheme is the path as plain text', () => {
    for (const canonical of ['javascript:alert(document.cookie)', 'data:text/html,<p>x</p>', 'ftp://fynix.digital/a']) {
      const { unmount } = renderUrl(withUrl(canonical));
      expect(screen.queryByRole('link')).toBeNull();
      expect(document.querySelector('a')).toBeNull();
      expect(screen.getByText(URL_REF.path)).toBeInTheDocument();
      unmount();
    }
    renderUrl(withUrl('http://fynix.digital/blog'));
    expect(screen.getByRole('link', { name: OPEN })).toHaveAttribute('href', 'http://fynix.digital/blog');
  });

  it('copies the whole address exactly as the API sent it, and shows and says that it did', async () => {
    const { user } = renderUrl(withUrl(FULL));
    const copy = screen.getByRole('button', { name: 'Copy ranking URL' });
    expect(copy).toHaveAttribute('tabindex', '-1');
    expect(copy).toHaveAttribute('data-cell-control');
    await user.click(copy);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FULL);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Ranking URL copied');
  });

  it('has a copy button for a URL that is no link too, and none where there is no URL', () => {
    const { rerender } = renderUrl(withUrl('javascript:alert(1)'));
    expect(screen.getByRole('button', { name: 'Copy ranking URL' })).toBeInTheDocument();
    for (const current of [
      cell({ state: 'beyond_depth', rank: null }),
      cell({ state: 'not_checked', rank: null }),
      cell({ state: 'failed', rank: null }),
    ]) {
      rerender(urlView(current, 0));
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    }
  });

  it('keeps the click on the link and on the copy button from the row around it', async () => {
    const onClick = vi.fn();
    const stay = (event: Event): void => event.preventDefault();
    // Capturing: the link's own handler stops the click before it reaches the document
    document.addEventListener('click', stay, true);
    const { user } = renderUrl(
      // The wrapper stands for the table row, which opens its record on a click
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onClick} onAuxClick={onClick}>
        {withUrl(FULL)}
      </div>,
    );
    await user.click(screen.getByRole('link', { name: OPEN }));
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('link', { name: OPEN }));
    await user.keyboard('{/Control}');
    fireEvent(
      screen.getByRole('link', { name: OPEN }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    );
    await user.click(screen.getByRole('button', { name: 'Copy ranking URL' }));
    document.removeEventListener('click', stay, true);
    expect(onClick).not.toHaveBeenCalled();
    // The rest of the cell is the row's
    await user.click(screen.getByText('+1'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('has no accessibility violations with the link and the copy button', async () => {
    const { container } = renderUrl(withUrl(FULL));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BestRankView', () => {
  it('shows the best rank as a number, and the same word as the other columns for what is not one', () => {
    renderWithProviders(
      <>
        <BestRankView best={4} state="ranked" />
        <BestRankView best={null} state="beyond_depth" />
        <BestRankView best={null} state="not_checked" />
        <BestRankView best={null} state="failed" />
      </>,
    );
    expect(screen.getByText('4')).toHaveClass('num', 'text-foreground');
    expect(screen.getByText('Not ranking')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('Pending')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('n/a')).toHaveClass('text-foreground-tertiary');
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

describe('stale tip', () => {
  it('says the rank shown is from the last check that worked, and when that was', () => {
    expect(renderTip((tips) => tips.stale(NOW))).toMatchObject({
      content: 'No recent successful check. The rank shown is from the last one that worked.',
      detail: `Last successful check: ${DATE}.`,
    });
    expect(renderTip((tips) => tips.stale(null)).detail).toBe('none');
  });
});

describe('URL tip', () => {
  it('shows the whole address of a ranking URL, which the cell cuts short, and nothing else', () => {
    const ranked = cell({ url: URL_REF });
    expect(renderTip((tips) => tips.url(urlDisplay(ranked, 1)))).toEqual({
      content: URL_REF.canonical_url,
      detail: 'none',
      description: 'none',
    });
  });

  it('gives no tip where the cell says it all: pending, failed, or no ranking URL', () => {
    const pending = cell({ state: 'not_checked', rank: null, depth_requested: null, observed_at: null });
    const failed = cell({ state: 'failed', rank: null });
    const none = cell({ state: 'beyond_depth', rank: null });
    for (const found of [pending, failed, none]) {
      expect(renderTip((tips) => tips.url(urlDisplay(found, 0))).content).toBe('none');
    }
  });
});
