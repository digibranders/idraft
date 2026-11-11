'use client';

import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';

import { EmptyState } from './empty-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { announce } from '@/lib/a11y/announcer';
import { formatDetailDateTime, formatIsoDate, formatTableDate, formatTime } from '@/lib/format';

/** One dated event of one object, with the source that proves it (25-component-inventory.md section 12.1). */
export interface TimelineEvent<K extends string> {
  id: string;
  kind: K;
  /** The instant of the event. */
  at: string;
  icon: LucideIcon;
  /** The finished sentence: the component words nothing. */
  text: string;
  /** The evidence: `name` is the accessible name of the link and starts with `label`. */
  source: { label: string; name: string; href: Route };
}

export interface EventTimelineLabels {
  /** The name of the group of filter buttons. */
  filter: string;
  /** The button that clears the filter. */
  all: string;
  older: string;
  /** Said when a press of `older` has added `count` events. */
  loaded: (count: number) => string;
  loading: string;
  emptyTitle: string;
  emptyReason: string;
}

export interface EventTimelineProps<K extends string> {
  /** The heading of the list: it takes focus when the last page has been loaded. */
  title: string;
  /** The level of the title (the days are one level lower); `h3` in a section that has an `h2`. Default 3. */
  headingLevel?: 2 | 3;
  events: readonly TimelineEvent<K>[];
  /** The kinds a person can filter by, in the order of the buttons. */
  kinds: readonly { kind: K; label: string }[];
  filter: 'all' | readonly K[];
  onFilterChange: (filter: 'all' | readonly K[]) => void;
  /** How many events a page holds: 10 in an inspector, 50 on a page. It sizes the loading state. */
  pageSize: 10 | 50;
  /** Present while there are older events to load; absent when the list is complete. */
  onLoadMore?: (() => void) | undefined;
  loadingMore?: boolean | undefined;
  /** An event from a notification link. */
  highlightId?: string | null | undefined;
  status: 'loading' | 'ready';
  /** The project's time zone: days and clock times are the project's. */
  timeZone: string;
  labels: EventTimelineLabels;
}

/** The rows a loading state draws: a page of 50 is not 50 skeleton rows. */
const LOADING_ROWS = { 10: 5, 50: 6 } as const;

interface Day<K extends string> {
  key: string;
  label: string;
  events: TimelineEvent<K>[];
}

function groupByDay<K extends string>(events: readonly TimelineEvent<K>[], timeZone: string): Day<K>[] {
  // Newest first. The sort is stable, so events of one instant keep the order the API gave them
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const days: Day<K>[] = [];
  for (const event of sorted) {
    const key = formatIsoDate(event.at, timeZone);
    const last = days.at(-1);
    if (last?.key === key) last.events.push(event);
    else days.push({ key, label: formatTableDate(event.at, timeZone), events: [event] });
  }
  return days;
}

/**
 * The dated events of one object (18-notifications-alerts.md section 7, 25 section 12.1): one section per
 * project day with a hidden heading, an ordered list, a 64 px date column on the first event of a day, rows
 * of at least 28 px, no rail, dots or cards. The filter is a group of toggle buttons; "Show older events"
 * loads the next page and says how many events it added.
 */
export function EventTimeline<K extends string>({
  title,
  headingLevel = 3,
  events,
  kinds,
  filter,
  onFilterChange,
  pageSize,
  onLoadMore,
  loadingMore = false,
  highlightId = null,
  status,
  timeZone,
  labels,
}: EventTimelineProps<K>): ReactElement {
  const days = useMemo(() => groupByDay(events, timeZone), [events, timeZone]);
  const heading = useRef<HTMLHeadingElement>(null);
  const pressed = useRef(false);
  const seen = useRef(events.length);

  // After a press of "Show older events": say how many events arrived, and when there is no more, move focus
  // to the heading, because the button that had it is gone
  useEffect(() => {
    const added = events.length - seen.current;
    seen.current = events.length;
    if (!pressed.current || loadingMore) return;
    pressed.current = false;
    if (added > 0) announce(labels.loaded(added));
    if (onLoadMore === undefined) heading.current?.focus();
  });

  const Title = `h${String(headingLevel)}` as 'h2' | 'h3';
  const DayTitle = `h${String(headingLevel + 1)}` as 'h3' | 'h4';
  const chosen = filter === 'all' ? [] : filter;
  const toggle = (kind: K): void => {
    const next = chosen.includes(kind) ? chosen.filter((entry) => entry !== kind) : [...chosen, kind];
    onFilterChange(next.length === 0 ? 'all' : next);
  };

  return (
    <div className="flex flex-col gap-3">
      <Title ref={heading} tabIndex={-1} className="type-subsection-title text-foreground outline-none">
        {title}
      </Title>
      <div role="group" aria-label={labels.filter} className="flex flex-wrap gap-1">
        <Button size="sm" aria-pressed={filter === 'all'} onClick={() => onFilterChange('all')}>
          {labels.all}
        </Button>
        {kinds.map(({ kind, label }) => (
          <Button key={kind} size="sm" aria-pressed={chosen.includes(kind)} onClick={() => toggle(kind)}>
            {label}
          </Button>
        ))}
      </div>
      {status === 'loading' ? (
        <div role="status" aria-label={labels.loading} aria-busy="true" className="flex flex-col gap-3">
          {Array.from({ length: LOADING_ROWS[pageSize] }, (_, row) => (
            <Skeleton key={row} shape="text-14" widthPct={row % 2 === 0 ? 80 : 64} />
          ))}
        </div>
      ) : days.length === 0 ? (
        <EmptyState variant="inline" title={labels.emptyTitle} reason={labels.emptyReason} headingLevel={3} />
      ) : (
        <>
          <div className="flex flex-col">
            {days.map((day) => (
              <section key={day.key} className="border-t border-border-subtle first:border-t-0">
                <DayTitle className="sr-only">{day.label}</DayTitle>
                <ol>
                  {day.events.map((event, index) => (
                    <li
                      key={event.id}
                      aria-current={highlightId === event.id ? 'true' : undefined}
                      className="flex min-h-7 gap-2 py-2 aria-current:bg-surface-selected"
                    >
                      <span aria-hidden="true" className="w-16 shrink-0 num type-meta text-foreground-tertiary">
                        {index === 0 ? day.label : null}
                      </span>
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <span className="flex h-5 items-center">
                          <Icon icon={event.icon} className="text-foreground-tertiary" />
                        </span>
                        <div className="min-w-0">
                          <p className="type-body break-words text-foreground">{event.text}</p>
                          <p className="type-meta text-foreground-tertiary">
                            <time dateTime={event.at} title={formatDetailDateTime(event.at, timeZone)} className="num">
                              {formatTime(event.at, timeZone)}
                            </time>
                            {' · '}
                            <TextLink render={<Link href={event.source.href} />} aria-label={event.source.name}>
                              {event.source.label}
                            </TextLink>
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          {onLoadMore === undefined ? null : (
            <div className="flex justify-center">
              <Button
                loading={loadingMore}
                onClick={() => {
                  pressed.current = true;
                  onLoadMore();
                }}
              >
                {labels.older}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
