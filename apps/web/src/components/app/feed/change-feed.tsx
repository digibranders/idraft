'use client';

import { CircleDashed, Clock } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, type ReactElement, type ReactNode } from 'react';

import {
  CHANGE_FEED_MAX,
  countNewItems,
  groupChangeFeed,
  type ChangeFeedGroup,
  type ChangeFeedItem,
} from './feed-model';
import { FeedRow } from './feed-row';
import type { ChartError, ChartNotice } from '@/components/app/chart/chart-frame';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Icon } from '@/components/ui/icon';
import { Skeleton, type SkeletonWidth } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { announce } from '@/lib/a11y/announcer';
import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ChangeFeedState =
  | { status: 'loading' }
  /** Callers pass `common.changeFeed.errorTitle` and `errorReason` as `error.title` and `error.reason`. */
  | { status: 'error'; error: ChartError }
  | { status: 'ready' | 'refetching'; items: readonly ChangeFeedItem[]; total: number };

export interface ChangeFeedProps {
  /** "Key changes": the panel's heading. */
  title: string;
  /** Default 2; the group headings are one level lower. */
  headingLevel?: 2 | 3 | undefined;
  state: ChangeFeedState;
  /** "the last 28 days": the empty state names the window. */
  windowText: string;
  /** "View all 23 changes" in the title row when `total` exceeds what is shown. */
  viewAllHref?: Route | undefined;
  /** Stale or partial data, in the title row's meta line; the rows stay. */
  notice?: ChartNotice | undefined;
  /** Held days: one neutral banner above the groups, not one line per event. */
  holdText?: string | undefined;
  /** The empty state's one action (for example "Open alert rules"). */
  emptyAction?: ReactNode;
  /** A `CountTabs` above the groups on a full list. */
  filter?: ReactNode;
  timeZone: string;
  now?: Date | undefined;
  /** Default `CHANGE_FEED_MAX`. */
  max?: number | undefined;
}

const GROUP_KEY = {
  needs_attention: 'needsAttention',
  changes: 'changes',
  notices: 'notices',
} as const satisfies Record<ChangeFeedGroup, 'needsAttention' | 'changes' | 'notices'>;

/** A fixed pattern, never a random one, so a re-render does not flicker (17 section 3.1). */
const SKELETON_WIDTHS: readonly SkeletonWidth[] = [72, 64, 80, 56, 72];
const ROW_PADDING = cn('flex min-h-9 items-center px-4 py-2');

/**
 * Tells screen readers when a refetch brings rows onto the screen; never on the first load. `shownIds` are the ids
 * of the rows drawn (not of every item fetched), and `undefined` while there are none to compare (loading or
 * error): the next rows are then a first load again, whatever window they belong to.
 */
function useArrivalAnnouncement(shownIds: readonly string[] | undefined): void {
  const t = useTranslations('common.changeFeed');
  const known = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (shownIds === undefined) {
      known.current = null;
      return;
    }
    if (known.current !== null) {
      const count = countNewItems(
        known.current,
        shownIds.map((id) => ({ id })),
      );
      if (count > 0) announce(t('arrived', { count }), { key: 'change-feed' });
    }
    known.current = new Set(shownIds);
  }, [shownIds, t]);
}

/**
 * Key changes (23-application-patterns.md section 9.2): the events of the window in three groups, newest first,
 * at most `max` rows, each a link to its evidence. Loading, error and empty keep the frame; a refetch keeps the
 * rows. Rows that arrive are announced through `announce`, never through a live region of its own.
 */
export function ChangeFeed({
  title,
  headingLevel = 2,
  state,
  windowText,
  viewAllHref,
  notice,
  holdText,
  emptyAction,
  filter,
  timeZone,
  now,
  max = CHANGE_FEED_MAX,
}: ChangeFeedProps): ReactElement {
  const t = useTranslations('common.changeFeed');
  const titleId = useId();
  const items = state.status === 'ready' || state.status === 'refetching' ? state.items : undefined;
  const sections = useMemo(() => (items === undefined ? [] : groupChangeFeed(items, max)), [items, max]);
  const shownIds = useMemo(
    () => (items === undefined ? undefined : sections.flatMap((section) => section.items.map((item) => item.id))),
    [items, sections],
  );
  useArrivalAnnouncement(shownIds);
  const shown = sections.reduce((sum, section) => sum + section.items.length, 0);
  const total = state.status === 'ready' || state.status === 'refetching' ? state.total : 0;
  const busy = state.status === 'loading' || state.status === 'refetching';
  const Title = headingLevel === 2 ? 'h2' : 'h3';
  const GroupHeading = headingLevel === 2 ? 'h3' : 'h4';
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy ? true : undefined}
      className="relative overflow-hidden rounded-lg border border-border bg-surface"
    >
      {state.status === 'refetching' ? (
        <div aria-hidden="true" data-slot="feed-refetch-bar" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      ) : null}
      <div className="flex min-h-12 items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <Title id={titleId} className="type-section-title">
            {title}
          </Title>
          {notice === undefined ? null : (
            <p className="inline-flex items-center gap-1 type-meta text-warning-text">
              <Icon icon={notice.kind === 'stale' ? Clock : CircleDashed} size="sm" />
              {notice.text}
            </p>
          )}
        </div>
        {viewAllHref !== undefined && total > shown ? (
          <TextLink render={<Link href={viewAllHref} />} className="ml-auto shrink-0 type-body whitespace-nowrap">
            {t('viewAll', { count: formatInteger(total) })}
          </TextLink>
        ) : null}
      </div>
      {filter === undefined || filter === null ? null : <div className="px-4 pb-3">{filter}</div>}
      {holdText === undefined ? null : (
        <div className="px-4 pb-3">
          <Banner tone="neutral" placement="region" message={holdText} />
        </div>
      )}
      {state.status === 'loading' ? (
        <div role="status" aria-label={t('loading')}>
          {SKELETON_WIDTHS.map((width, index) => (
            // The rows are placeholders in a fixed order, so the position is their identity
            <div key={index} className={cn(ROW_PADDING, 'border-t border-border-subtle')}>
              <Skeleton shape="text-14" widthPct={width} />
            </div>
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div className="border-t border-border-subtle">
          <InlineError {...state.error} />
        </div>
      ) : sections.length === 0 ? (
        <div className="border-t border-border-subtle">
          <EmptyState
            variant="inline"
            headingLevel={3}
            title={t('empty', { window: windowText })}
            reason={t('emptyReason')}
            primaryAction={emptyAction}
          />
        </div>
      ) : (
        sections.map((section) => {
          const headingId = `${titleId}-${section.group}`;
          return (
            <section key={section.group}>
              <div className="flex h-9 items-center gap-2 border-t border-border-subtle bg-surface-subtle px-4">
                <GroupHeading id={headingId} className="type-subsection-title">
                  {t(`groups.${GROUP_KEY[section.group]}`)}
                </GroupHeading>
                <span className="num type-meta">{t('groupCount', { count: section.items.length })}</span>
              </div>
              <ul aria-labelledby={headingId}>
                {section.items.map((item) => (
                  <FeedRow key={item.id} item={item} form="compact" timeZone={timeZone} now={now} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}
