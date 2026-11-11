import { act, screen, within } from '@testing-library/react';
import { Link2, TrendingUp } from 'lucide-react';
import type { Route } from 'next';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventTimeline, type EventTimelineProps, type TimelineEvent } from './event-timeline';
import { renderWithProviders } from '@/test/render';

type Kind = 'rank' | 'url';

const KINDS = [
  { kind: 'rank', label: 'Rank' },
  { kind: 'url', label: 'Ranking URL' },
] as const;

function event(id: string, at: string, extra: Partial<TimelineEvent<Kind>> = {}): TimelineEvent<Kind> {
  return {
    id,
    kind: 'rank',
    at,
    icon: TrendingUp,
    text: `Sentence of ${id}`,
    source: { label: 'Open snapshot', name: `Open snapshot of ${id}`, href: `/snapshots/${id}` as Route },
    ...extra,
  };
}

const EVENTS: TimelineEvent<Kind>[] = [
  event('a', '2026-10-30T09:15:00Z'),
  event('b', '2026-10-31T23:30:00Z', { kind: 'url', icon: Link2 }),
  event('c', '2026-10-31T08:05:00Z'),
];

function timeline(props: Partial<EventTimelineProps<Kind>> = {}): ReactElement {
  return (
    <EventTimeline<Kind>
      title="Events"
      events={EVENTS}
      kinds={KINDS}
      filter="all"
      onFilterChange={() => undefined}
      pageSize={50}
      status="ready"
      timeZone="Europe/Berlin"
      labels={{
        filter: 'Event types',
        all: 'All events',
        older: 'Show older events',
        loaded: (count) => `${String(count)} more events loaded`,
        loading: 'Loading the events',
        emptyTitle: 'No events yet',
        emptyReason: 'Nothing has changed since tracking began.',
      }}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('EventTimeline', () => {
  it('groups the events by local day of the project, newest first, one section per day with a hidden heading', () => {
    renderWithProviders(timeline());
    // 23:30 UTC on Oct 31 is 00:30 on Nov 1 in Berlin: its own day, not the day of the 08:05 event
    const days = screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(days).toEqual(['Nov 1', 'Oct 31', 'Oct 30']);
    const lists = screen.getAllByRole('list').filter((list) => list.tagName === 'OL');
    expect(lists).toHaveLength(3);
    const first = lists[0];
    if (first === undefined) throw new Error('No list');
    expect(within(first).getAllByRole('listitem')).toHaveLength(1);
    expect(within(first).getByText('Sentence of b')).toBeInTheDocument();
  });

  it('puts the title and the days one level lower than the heading level it is given', () => {
    renderWithProviders(timeline({ headingLevel: 2 }));
    expect(screen.getByRole('heading', { level: 2, name: 'Events' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Nov 1',
      'Oct 31',
      'Oct 30',
    ]);
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument();
  });

  it('sorts newest first even when the events arrive in another order', () => {
    renderWithProviders(timeline());
    const sentences = screen.getAllByText(/^Sentence of /).map((node) => node.textContent);
    expect(sentences).toEqual(['Sentence of b', 'Sentence of c', 'Sentence of a']);
  });

  it('puts a time element with the instant on each event and the clock time of the project', () => {
    renderWithProviders(timeline());
    const times = Array.from(document.querySelectorAll('time'));
    expect(times.map((time) => [time.getAttribute('datetime'), time.textContent])).toEqual([
      ['2026-10-31T23:30:00Z', '00:30'],
      ['2026-10-31T08:05:00Z', '09:05'],
      ['2026-10-30T09:15:00Z', '10:15'],
    ]);
  });

  it('shows the date on the first event of a day only', () => {
    renderWithProviders(
      timeline({
        events: [
          event('x', '2026-10-31T12:00:00Z'),
          event('y', '2026-10-31T10:00:00Z'),
          event('z', '2026-10-31T08:00:00Z'),
        ],
      }),
    );
    expect(screen.getAllByText('Oct 31')).toHaveLength(2);
    // One is the hidden heading and one the visible date of the first row
    const items = screen.getAllByRole('listitem');
    expect(within(items[0] ?? document.body).queryByText('Oct 31')).toBeInTheDocument();
    expect(within(items[1] ?? document.body).queryByText('Oct 31')).not.toBeInTheDocument();
    expect(within(items[2] ?? document.body).queryByText('Oct 31')).not.toBeInTheDocument();
  });

  it('gives each event a source link with its own accessible name', () => {
    renderWithProviders(timeline());
    const link = screen.getByRole('link', { name: 'Open snapshot of b' });
    expect(link).toHaveAttribute('href', '/snapshots/b');
    expect(link).toHaveTextContent('Open snapshot');
  });

  it('filters with toggle buttons that say whether they are pressed', async () => {
    const onFilterChange = vi.fn();
    const { user } = renderWithProviders(timeline({ onFilterChange }));
    const group = screen.getByRole('group', { name: 'Event types' });
    expect(within(group).getByRole('button', { name: 'All events' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Ranking URL' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(group).getByRole('button', { name: 'Ranking URL' }));
    expect(onFilterChange).toHaveBeenLastCalledWith(['url']);
  });

  it('adds a kind to a choice, removes it again, and returns to all when the last one is removed', async () => {
    const onFilterChange = vi.fn();
    function Controlled(): ReactElement {
      const [filter, setFilter] = useState<'all' | readonly Kind[]>(['url']);
      return timeline({
        filter,
        onFilterChange: (next) => {
          onFilterChange(next);
          setFilter(next);
        },
      });
    }
    const { user } = renderWithProviders(<Controlled />);
    const group = screen.getByRole('group', { name: 'Event types' });
    expect(within(group).getByRole('button', { name: 'Ranking URL' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All events' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(group).getByRole('button', { name: 'Rank' }));
    expect(onFilterChange).toHaveBeenLastCalledWith(['url', 'rank']);
    await user.click(within(group).getByRole('button', { name: 'Rank' }));
    await user.click(within(group).getByRole('button', { name: 'Ranking URL' }));
    expect(onFilterChange).toHaveBeenLastCalledWith('all');
  });

  it('offers Show older events only when it can load more, once per press', async () => {
    const onLoadMore = vi.fn();
    const { user, rerender } = renderWithProviders(timeline());
    expect(screen.queryByRole('button', { name: 'Show older events' })).not.toBeInTheDocument();
    rerender(timeline({ onLoadMore }));
    await user.click(screen.getByRole('button', { name: 'Show older events' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call for more while a page is loading', async () => {
    const onLoadMore = vi.fn();
    const { user } = renderWithProviders(timeline({ onLoadMore, loadingMore: true }));
    const button = screen.getByRole('button', { name: 'Show older events' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('announces how many events a press added, and moves focus to the heading when there is no more', async () => {
    const onLoadMore = vi.fn();
    const first = [event('a', '2026-10-30T09:15:00Z'), event('c', '2026-10-31T08:05:00Z')];
    const { user, rerender } = renderWithProviders(timeline({ events: first, onLoadMore }));
    await user.click(screen.getByRole('button', { name: 'Show older events' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(timeline({ events: EVENTS, onLoadMore }));
    expect(document.getElementById('live-region-polite')).toHaveTextContent('1 more events loaded');
    expect(screen.getByRole('button', { name: 'Show older events' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show older events' }));
    await act(async () => {
      rerender(timeline({ events: [...EVENTS, event('d', '2026-10-01T10:00:00Z')] }));
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Show older events' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Events' }));
  });

  it('does not announce or move focus for events that arrive without a press', () => {
    const { rerender } = renderWithProviders(timeline({ events: [EVENTS[0] ?? event('a', '2026-10-30T09:15:00Z')] }));
    rerender(timeline({ events: EVENTS }));
    expect(document.getElementById('live-region-polite')).toHaveTextContent('');
    expect(document.activeElement).toBe(document.body);
  });

  it('marks the highlighted event as the current one', () => {
    renderWithProviders(timeline({ highlightId: 'c' }));
    const current = screen.getAllByRole('listitem').filter((item) => item.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(within(current[0] ?? document.body).getByText('Sentence of c')).toBeInTheDocument();
  });

  it('says there are no events, with the reason it was given', () => {
    renderWithProviders(timeline({ events: [] }));
    expect(screen.getByRole('heading', { name: 'No events yet' })).toBeInTheDocument();
    expect(screen.getByText('Nothing has changed since tracking began.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a loading state that is not the empty state', () => {
    renderWithProviders(timeline({ events: [], status: 'loading' }));
    expect(screen.getByRole('status', { name: 'Loading the events' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { name: 'No events yet' })).not.toBeInTheDocument();
  });
});
