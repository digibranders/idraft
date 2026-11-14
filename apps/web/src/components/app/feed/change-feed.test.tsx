import { screen, within } from '@testing-library/react';
import { Globe, TrendingDown } from 'lucide-react';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChangeFeed, type ChangeFeedProps, type ChangeFeedState } from './change-feed';
import type { ChangeFeedGroup, ChangeFeedItem } from './feed-model';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/a11y/announcer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The real announcer, watched: the feed speaks through it and never through a live region of its own
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const NOW = new Date('2026-09-29T12:00:00Z');

function entry(id: string, group: ChangeFeedGroup, hoursAgo = 1): ChangeFeedItem {
  return {
    id,
    group,
    glyph: group === 'needs_attention' ? TrendingDown : Globe,
    text: `Sentence ${id}`,
    at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    href: `/alerts?inspect=event:${id}` as Route,
  };
}

const THREE_GROUPS: readonly ChangeFeedItem[] = [
  entry('n1', 'notices', 5),
  entry('c1', 'changes', 3),
  entry('c2', 'changes', 2),
  entry('a1', 'needs_attention', 1),
];

function ready(items: readonly ChangeFeedItem[] = THREE_GROUPS, total = items.length): ChangeFeedState {
  return { status: 'ready', items, total };
}

function props(state: ChangeFeedState, extra: Partial<ChangeFeedProps> = {}): ChangeFeedProps {
  return { title: 'Key changes', state, windowText: 'the last 28 days', timeZone: 'UTC', now: NOW, ...extra };
}

const rowsOf = (): HTMLElement[] =>
  screen
    .getAllByRole('listitem')
    .filter((item) => item.querySelector('a') !== null && item.querySelector('time') !== null);

describe('ChangeFeed states', () => {
  it('loading is a named status with five skeleton rows, no spinner and no groups', () => {
    const { container } = renderWithProviders(<ChangeFeed {...props({ status: 'loading' })} />);
    const status = screen.getByRole('status', { name: 'Loading changes' });
    expect(status.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Key changes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
  });

  it('error shows the failure with a working Retry', async () => {
    const onRetry = vi.fn();
    const state: ChangeFeedState = {
      status: 'error',
      error: {
        title: 'Changes did not load',
        reason: 'The request failed. Try again.',
        errorId: null,
        onRetry,
        retrying: false,
        retryLabel: 'Try again',
      },
    };
    const { user } = renderWithProviders(<ChangeFeed {...props(state)} />);
    expect(screen.getByText('Changes did not load')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty names the window, gives the reason and shows the action', () => {
    renderWithProviders(
      <ChangeFeed
        {...props(ready([]), {
          emptyAction: <Button variant="secondary">Open alert rules</Button>,
        })}
      />,
    );
    expect(screen.getByText('No detectable changes in the last 28 days')).toBeInTheDocument();
    expect(screen.getByText('Changes within normal variation are left out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open alert rules' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('ready groups the rows under h3 headings with plural counts, in the order of the design', () => {
    renderWithProviders(<ChangeFeed {...props(ready())} />);
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Needs attention', 'Changes', 'Notices']);
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(3);
    expect(within(lists[0] as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
    expect(within(lists[1] as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    // One is singular, two is plural
    const header = (name: string): HTMLElement => screen.getByRole('heading', { name }).parentElement as HTMLElement;
    expect(header('Needs attention')).toHaveTextContent('1 change');
    expect(header('Needs attention')).not.toHaveTextContent('1 changes');
    expect(header('Changes')).toHaveTextContent('2 changes');
    expect(header('Needs attention')).toHaveClass('h-9', 'bg-surface-subtle');
    // Newest first inside a group
    const changes = within(lists[1] as HTMLElement).getAllByRole('link');
    expect(changes.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Sentence c2'),
      expect.stringContaining('Sentence c1'),
    ]);
  });

  it('shows at most 8 rows and "View all 23 changes" when the total is larger', () => {
    const many = Array.from({ length: 12 }, (_, index) => entry(`c${String(index)}`, 'changes', index + 1));
    renderWithProviders(<ChangeFeed {...props(ready(many, 23), { viewAllHref: '/alerts' as Route })} />);
    expect(rowsOf()).toHaveLength(8);
    const link = screen.getByRole('link', { name: 'View all 23 changes' });
    expect(link).toHaveAttribute('href', '/alerts');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Changes');
    expect(screen.getByRole('heading', { level: 3 }).parentElement).toHaveTextContent('8 changes');
  });

  it('leaves the View all link out when everything is shown or no address is given', () => {
    const first = renderWithProviders(
      <ChangeFeed {...props(ready(THREE_GROUPS, 4), { viewAllHref: '/alerts' as Route })} />,
    );
    expect(screen.queryByRole('link', { name: /View all/ })).toBeNull();
    first.unmount();
    renderWithProviders(<ChangeFeed {...props(ready(THREE_GROUPS, 23))} />);
    expect(screen.queryByRole('link', { name: /View all/ })).toBeNull();
  });

  it.each([
    ['stale', 'Stale: last collected Sep 27, 18:30 UTC'],
    ['partial', 'Partial data: 612 of 1,000 prompts asked'],
  ] as const)('a %s notice shows its text and keeps the rows', (kind, text) => {
    renderWithProviders(<ChangeFeed {...props(ready(), { notice: { kind, text } })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(rowsOf()).toHaveLength(4);
  });

  it('shows held days as one neutral banner above the groups', () => {
    const { container } = renderWithProviders(
      <ChangeFeed {...props(ready(), { holdText: 'Anomaly hold: 3 days are not compared.' })} />,
    );
    const banners = container.querySelectorAll('[data-slot="banner"]');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent('Anomaly hold: 3 days are not compared.');
    expect(banners[0]?.className).toContain('bg-surface-subtle');
    expect(banners[0]?.compareDocumentPosition(screen.getAllByRole('heading', { level: 3 })[0] as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('refetching keeps the rows, is busy and shows the bar', () => {
    const { container } = renderWithProviders(
      <ChangeFeed {...props({ status: 'refetching', items: THREE_GROUPS, total: 4 })} />,
    );
    expect(rowsOf()).toHaveLength(4);
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-slot="feed-refetch-bar"]')).toHaveClass('bg-primary');
    expect(screen.queryByRole('status', { name: 'Loading changes' })).toBeNull();
  });

  it('is not busy and has no bar when ready', () => {
    const { container } = renderWithProviders(<ChangeFeed {...props(ready())} />);
    expect(container.querySelector('section')).not.toHaveAttribute('aria-busy');
    expect(container.querySelector('[data-slot="feed-refetch-bar"]')).toBeNull();
  });

  it('puts the group headings one level below a level 3 title', () => {
    renderWithProviders(<ChangeFeed {...props(ready(), { headingLevel: 3 })} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Key changes' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(3);
  });

  it('names each group list by its heading', () => {
    renderWithProviders(<ChangeFeed {...props(ready())} />);
    for (const name of ['Needs attention', 'Changes', 'Notices']) {
      const heading = screen.getByRole('heading', { name });
      const list = screen.getByRole('list', { name });
      expect(list).toHaveAttribute('aria-labelledby', heading.id);
    }
  });

  it('draws the filter above the groups and nothing when there is none', () => {
    const view = renderWithProviders(
      <ChangeFeed {...props(ready(), { filter: <div data-testid="filter">Event types</div> })} />,
    );
    const filter = screen.getByTestId('filter');
    expect(filter.compareDocumentPosition(screen.getAllByRole('heading', { level: 3 })[0] as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    view.unmount();
    renderWithProviders(<ChangeFeed {...props(ready(), { filter: null })} />);
    expect(screen.queryByTestId('filter')).toBeNull();
  });

  it('shows at most `max` rows, taken in group order, and links to the rest', () => {
    const items = [
      entry('a1', 'needs_attention', 1),
      ...Array.from({ length: 5 }, (_, index) => entry(`c${String(index)}`, 'changes', index + 2)),
      entry('n1', 'notices', 1),
    ];
    renderWithProviders(<ChangeFeed {...props(ready(items, 7), { max: 3, viewAllHref: '/alerts' as Route })} />);
    expect(rowsOf()).toHaveLength(3);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Needs attention',
      'Changes',
    ]);
    expect(screen.queryByText('Sentence n1')).toBeNull();
    expect(screen.getByRole('link', { name: 'View all 7 changes' })).toBeInTheDocument();
  });

  it('keeps focus on the same row from ready to refetching, even when a row arrives above it', () => {
    const items = [entry('c1', 'changes', 3), entry('c2', 'changes', 2)];
    const view = renderWithProviders(<ChangeFeed {...props(ready(items))} />);
    const link = screen.getByRole('link', { name: /Sentence c1/ });
    link.focus();
    expect(link).toHaveFocus();
    view.rerender(<ChangeFeed {...props({ status: 'refetching', items: [...items], total: 2 })} />);
    expect(screen.getByRole('link', { name: /Sentence c1/ })).toBe(link);
    expect(link).toHaveFocus();
    view.rerender(
      <ChangeFeed {...props({ status: 'refetching', items: [entry('c0', 'changes', 1), ...items], total: 3 })} />,
    );
    expect(screen.getByRole('link', { name: /Sentence c1/ })).toBe(link);
    expect(link).toHaveFocus();
  });

  it('renders hostile text in the title, notice, hold banner and rows as text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { container } = renderWithProviders(
      <ChangeFeed
        {...props(ready([{ ...entry('h1', 'changes'), text: hostile }]), {
          title: `Key ${hostile}`,
          notice: { kind: 'stale', text: `Stale ${hostile}` },
          holdText: `Hold ${hostile}`,
        })}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script, svg[onload]')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(`Key ${hostile}`);
    expect(screen.getByText(`Stale ${hostile}`)).toBeInTheDocument();
    expect(screen.getByText(`Hold ${hostile}`)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveTextContent(hostile);
  });
});

describe('ChangeFeed arrivals', () => {
  function Feed({ state }: { state: ChangeFeedState }): ReactElement {
    return <ChangeFeed {...props(state)} />;
  }
  const items = (count: number): ChangeFeedItem[] =>
    Array.from({ length: count }, (_, index) => entry(`c${String(index)}`, 'changes', index + 1));

  it('announces the rows that arrive in a refetch once, and never the first load', () => {
    vi.mocked(announce).mockClear();
    const view = renderWithProviders(<Feed state={{ status: 'loading' }} />);
    view.rerender(<Feed state={ready(items(5))} />);
    expect(announce).not.toHaveBeenCalled();
    view.rerender(<Feed state={{ status: 'refetching', items: items(5), total: 5 }} />);
    view.rerender(<Feed state={ready(items(7))} />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('2 new changes', { key: 'change-feed' });
    // The same rows again say nothing
    view.rerender(<Feed state={ready(items(7))} />);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('says "1 new change" for one and nothing when rows only leave', () => {
    vi.mocked(announce).mockClear();
    const view = renderWithProviders(<Feed state={ready(items(5))} />);
    view.rerender(<Feed state={ready(items(6))} />);
    expect(announce).toHaveBeenLastCalledWith('1 new change', { key: 'change-feed' });
    vi.mocked(announce).mockClear();
    view.rerender(<Feed state={ready(items(3))} />);
    expect(announce).not.toHaveBeenCalled();
  });

  it('counts only the rows on screen: rows beyond the cap of 8 are never announced', () => {
    vi.mocked(announce).mockClear();
    const view = renderWithProviders(<Feed state={ready(items(10), 10)} />);
    // Two older events arrive, below the cap: nothing on screen changed
    view.rerender(
      <Feed state={ready([...items(10), entry('old1', 'changes', 50), entry('old2', 'changes', 60)], 12)} />,
    );
    expect(announce).not.toHaveBeenCalled();
    // A newer event arrives and pushes one row out of the 8: one new row on screen
    view.rerender(
      <Feed state={ready([entry('fresh', 'changes', 0.5), ...items(10), entry('old1', 'changes', 50)], 12)} />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('1 new change', { key: 'change-feed' });
  });

  it('does not announce rows that follow a loading state (a new window is a new first load)', () => {
    vi.mocked(announce).mockClear();
    const view = renderWithProviders(<Feed state={ready(items(5))} />);
    view.rerender(<Feed state={{ status: 'loading' }} />);
    view.rerender(
      <Feed state={ready([entry('w1', 'changes', 1), entry('w2', 'changes', 2), entry('w3', 'changes', 3)])} />,
    );
    expect(announce).not.toHaveBeenCalled();
    // The rows of the new window are now the baseline
    view.rerender(
      <Feed state={ready([entry('w0', 'changes', 0.5), entry('w1', 'changes', 1), entry('w2', 'changes', 2)])} />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('1 new change', { key: 'change-feed' });
  });

  it('does not announce the rows of a first load that follows an error', () => {
    vi.mocked(announce).mockClear();
    const view = renderWithProviders(
      <Feed
        state={{
          status: 'error',
          error: { title: 'x', reason: 'y', errorId: null, onRetry: vi.fn(), retrying: false, retryLabel: 'Try again' },
        }}
      />,
    );
    view.rerender(<Feed state={ready(items(5))} />);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('ChangeFeed accessibility', () => {
  const states: ReadonlyArray<readonly [string, ChangeFeedState, Partial<ChangeFeedProps>]> = [
    ['loading', { status: 'loading' }, {}],
    [
      'error',
      {
        status: 'error',
        error: {
          title: 'Changes did not load',
          reason: 'The request failed. Try again.',
          errorId: null,
          onRetry: () => undefined,
          retrying: false,
          retryLabel: 'Try again',
        },
      },
      {},
    ],
    ['empty', ready([]), { emptyAction: <Button variant="secondary">Open alert rules</Button> }],
    [
      'ready with a notice, a hold and a link',
      ready(THREE_GROUPS, 23),
      {
        notice: { kind: 'stale', text: 'Stale: last collected Sep 27' },
        holdText: 'Anomaly hold: 3 days are not compared.',
        viewAllHref: '/alerts' as Route,
      },
    ],
    ['refetching', { status: 'refetching', items: THREE_GROUPS, total: 4 }, {}],
  ];

  it.each(['light', 'dark'])('has no violation in any state in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      for (const [, state, extra] of states) {
        const { container, unmount } = renderWithProviders(<ChangeFeed {...props(state, extra)} />);
        expect(await axe(container)).toHaveNoViolations();
        unmount();
      }
    } finally {
      document.documentElement.className = '';
    }
  });
});
