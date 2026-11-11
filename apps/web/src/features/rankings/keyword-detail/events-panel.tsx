'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import {
  FileText,
  Info,
  Link2,
  ListOrdered,
  ScanSearch,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { rankEventsQuery } from './detail-queries';
import { detailStateOf } from './detail-state';
import { useDetailUrlState } from './detail-url-state';
import {
  EVENT_KIND_MESSAGE_KEYS,
  EVENT_KINDS,
  EVENT_TYPE_MESSAGE_KEYS,
  eventView,
  type EventKind,
  type EventRank,
  type EventView,
} from './events-model';
import type { KeywordDetail, KeywordScope } from '../keyword-inspector/inspector-queries';
import { SectionError } from '../keyword-inspector/section-error';
import { EventTimeline, type TimelineEvent } from '@/components/app/status/event-timeline';
import { formatInteger, formatTableDateTime } from '@/lib/format';
import { FEATURE_MESSAGE_KEYS, isFeatureType } from '@/lib/keywords/serp-features';
import { keywordDetailPath, withQuery } from '@/lib/routes/paths';

export interface EventsPanelProps {
  scope: KeywordScope;
  detail: KeywordDetail;
  /** The slugs in the URL, for the link of each event to its snapshot. */
  workspaceSlug: string;
  projectSlug: string;
  /** The project's time zone, for the days and times of the events. */
  timeZone: string;
}

/** The glyph of an event (18-notifications-alerts.md section 7.1); an event of an unknown type gets a plain `Info`. */
function glyphOf(view: EventView): LucideIcon {
  switch (view.type) {
    case 'entered_top_3':
    case 'entered_top_10':
    case 'entered_top_20':
    case 'entered_top_100':
    case 'rank_gain':
      return TrendingUp;
    case 'lost_top_3':
    case 'lost_top_10':
    case 'lost_top_20':
    case 'lost_top_100':
    case 'rank_drop':
      return TrendingDown;
    case 'new_ranking':
    case 'lost_ranking':
      return ListOrdered;
    case 'url_changed':
      return FileText;
    case 'feature_gained':
    case 'feature_lost':
    case 'aio_appeared':
    case 'aio_disappeared':
      return ScanSearch;
    case 'aio_citation_gained':
    case 'aio_citation_lost':
      return Link2;
    case 'overtaken_by':
    case 'overtook':
      return Users;
    default:
      return Info;
  }
}

/**
 * The events feed of the keyword (24-page-templates.md section 9.4, 18 section 7): the newest 50 events, 50
 * more per press of "Show older events", filtered by kind (the kinds are in the address as `events`). Each
 * event is one sentence and a link to the SERP snapshot that proves it.
 */
export function EventsPanel({ scope, detail, workspaceSlug, projectSlug, timeZone }: EventsPanelProps): ReactElement {
  const t = useTranslations('keywordDetail.events');
  const featureNames = useTranslations('rankings.features.names');
  const { events: kinds, setEvents } = useDetailUrlState();
  const query = useInfiniteQuery(rankEventsQuery(scope, kinds));

  const sentenceOf = useCallback(
    (view: EventView): string => {
      const rankText = (value: EventRank): string =>
        value.kind === 'rank' ? t('rank.ranked', { rank: formatInteger(value.rank) }) : t('rank.none');
      const from = rankText(view.values.from);
      const to = rankText(view.values.to);
      const feature =
        view.featureType === null
          ? t('noFeature')
          : isFeatureType(view.featureType)
            ? featureNames(FEATURE_MESSAGE_KEYS[view.featureType])
            : view.featureType;
      switch (view.type) {
        case 'entered_top_3':
        case 'entered_top_10':
        case 'entered_top_20':
        case 'entered_top_100':
        case 'lost_top_3':
        case 'lost_top_10':
        case 'lost_top_20':
        case 'lost_top_100':
        case 'rank_gain':
        case 'rank_drop':
          return t(`types.${EVENT_TYPE_MESSAGE_KEYS[view.type]}`, { from, to });
        case 'new_ranking':
          return t('types.newRanking', { to });
        case 'lost_ranking':
          return t('types.lostRanking', { from });
        case 'url_changed':
          return t('types.urlChanged', {
            fromPath: view.paths.from ?? t('noPath'),
            toPath: view.paths.to ?? t('noPath'),
          });
        case 'feature_gained':
        case 'feature_lost':
          return t(`types.${EVENT_TYPE_MESSAGE_KEYS[view.type]}`, { feature });
        case 'aio_appeared':
        case 'aio_disappeared':
        case 'aio_citation_gained':
        case 'aio_citation_lost':
          return t(`types.${EVENT_TYPE_MESSAGE_KEYS[view.type]}`);
        case 'overtaken_by':
          return t('types.overtakenBy', { competitor: view.other ?? t('noCompetitor'), from, to });
        case 'overtook':
          return t('types.overtook', { competitor: view.other ?? t('noCompetitor'), to });
        default:
          return t('types.unknown', { code: view.type });
      }
    },
    [t, featureNames],
  );

  const pages = query.data?.pages;
  const events = useMemo(
    (): TimelineEvent<EventKind>[] =>
      (pages ?? []).flatMap((page) =>
        page.data.map((event) => {
          const view = eventView(event);
          return {
            id: view.id,
            // An event of a type this app does not know has no kind: it is listed under "all" as a Rank event
            kind: view.kind ?? 'rank',
            at: view.at,
            icon: glyphOf(view),
            text: sentenceOf(view),
            source: {
              label: t('open'),
              name: t('openOf', { date: formatTableDateTime(view.at, timeZone) }),
              href: withQuery(
                keywordDetailPath(workspaceSlug, projectSlug, scope.trackedKeywordId),
                `tab=snapshots&obs=${encodeURIComponent(view.snapshotId)}`,
              ),
            },
          };
        }),
      ),
    [pages, sentenceOf, t, timeZone, workspaceSlug, projectSlug, scope.trackedKeywordId],
  );

  if (query.data === undefined && query.isError) {
    return (
      <section aria-label={t('title')} className="rounded-lg border border-border bg-surface p-4">
        <SectionError
          title={t('failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </section>
    );
  }

  const allKinds = kinds.length === EVENT_KINDS.length;
  const state = detailStateOf(detail.state, detail.is_active).kind;
  const empty =
    state === 'pending'
      ? { title: t('empty'), reason: t('emptyPending') }
      : state === 'failed'
        ? { title: t('empty'), reason: t('emptyFailed') }
        : allKinds
          ? { title: t('empty'), reason: t('emptyNone') }
          : { title: t('emptyFiltered'), reason: t('emptyFilteredReason') };

  return (
    <section aria-label={t('title')} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {query.isError ? (
        <SectionError
          title={query.isFetchNextPageError ? t('olderFailed') : t('failed')}
          error={query.error}
          onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
          retrying={query.isFetching}
        />
      ) : null}
      <EventTimeline<EventKind>
        title={t('title')}
        headingLevel={2}
        events={events}
        kinds={EVENT_KINDS.map((kind) => ({ kind, label: t(`kinds.${EVENT_KIND_MESSAGE_KEYS[kind]}`) }))}
        filter={allKinds ? 'all' : kinds}
        onFilterChange={(next) => void setEvents(next === 'all' ? EVENT_KINDS : next)}
        pageSize={50}
        onLoadMore={query.hasNextPage ? () => void query.fetchNextPage() : undefined}
        loadingMore={query.isFetchingNextPage}
        status={query.isPending ? 'loading' : 'ready'}
        timeZone={timeZone}
        labels={{
          filter: t('filter'),
          all: t('all'),
          older: t('older'),
          loaded: (count) => t('olderLoaded', { count }),
          loading: t('loading'),
          emptyTitle: empty.title,
          emptyReason: empty.reason,
        }}
      />
    </section>
  );
}
