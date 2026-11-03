import type { RankEventOut } from '@/lib/api/types';

/**
 * The rank events of a keyword as the page sorts and reads them (25-component-inventory.md section 12.1).
 * Functions return codes and numbers, never sentences: the panel puts the words in through the message
 * catalog, so nothing here depends on the language.
 */

/** The kinds of the filter above the feed: the `TimelineEventKind`s of 25 section 12.1 that rank events have. */
export const EVENT_KINDS = ['rank', 'url', 'serp_feature', 'ai_citation', 'competitor'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The 21 event types of the backend (migration 0013), in the order the filter sends them within a kind. */
export const EVENT_TYPES = [
  'entered_top_3',
  'entered_top_10',
  'entered_top_20',
  'entered_top_100',
  'lost_top_3',
  'lost_top_10',
  'lost_top_20',
  'lost_top_100',
  'new_ranking',
  'lost_ranking',
  'rank_drop',
  'rank_gain',
  'url_changed',
  'feature_gained',
  'feature_lost',
  'aio_appeared',
  'aio_disappeared',
  'aio_citation_gained',
  'aio_citation_lost',
  'overtaken_by',
  'overtook',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const KIND_OF_TYPE: Readonly<Record<EventType, EventKind>> = {
  entered_top_3: 'rank',
  entered_top_10: 'rank',
  entered_top_20: 'rank',
  entered_top_100: 'rank',
  lost_top_3: 'rank',
  lost_top_10: 'rank',
  lost_top_20: 'rank',
  lost_top_100: 'rank',
  new_ranking: 'rank',
  lost_ranking: 'rank',
  rank_drop: 'rank',
  rank_gain: 'rank',
  url_changed: 'url',
  feature_gained: 'serp_feature',
  feature_lost: 'serp_feature',
  aio_appeared: 'serp_feature',
  aio_disappeared: 'serp_feature',
  aio_citation_gained: 'ai_citation',
  aio_citation_lost: 'ai_citation',
  overtaken_by: 'competitor',
  overtook: 'competitor',
};

/** The API's event type is a plain string: a code this app does not list is not an `EventType`. */
export const isEventType = (value: string): value is EventType => (EVENT_TYPES as readonly string[]).includes(value);

/** The kind of a type code, or null for a code this app does not know. */
export function kindOf(type: string): EventKind | null {
  return isEventType(type) ? KIND_OF_TYPE[type] : null;
}

/** The type codes of `kinds`, in the order of the kinds given. */
export function typesOf(kinds: readonly EventKind[]): EventType[] {
  return kinds.flatMap((kind) => EVENT_TYPES.filter((type) => KIND_OF_TYPE[type] === kind));
}

/**
 * The `filter[event_type_in]` of a choice of kinds. Every kind, or none chosen, asks for no filter at all:
 * an event of a type this app does not know stays visible under "all", and a filter by type would hide it.
 */
export function eventTypeFilter(kinds: readonly EventKind[]): EventType[] | undefined {
  const chosen = EVENT_KINDS.filter((kind) => kinds.includes(kind));
  return chosen.length === 0 || chosen.length === EVENT_KINDS.length ? undefined : typesOf(kinds);
}

/** A rank in an event: a place, or the keyword was not ranked (never zero). */
export type EventRank = { kind: 'rank'; rank: number } | { kind: 'none' };

export interface EventView {
  id: string;
  /** `null` for a type this app does not know. */
  kind: EventKind | null;
  /** The code as the API sent it. */
  type: string;
  /** The instant of the event. */
  at: string;
  values: { from: EventRank; to: EventRank };
  /** The paths of the ranking URL before and after; null where the API sent no URL. */
  paths: { from: string | null; to: string | null };
  featureType: string | null;
  /** The name of the competitor of an overtake. */
  other: string | null;
  snapshotId: string;
}

const rankOf = (rank: number | null): EventRank => (rank === null ? { kind: 'none' } : { kind: 'rank', rank });

/** What the feed shows of one event, as codes. */
export function eventView(event: RankEventOut): EventView {
  return {
    id: event.rank_event_id,
    kind: kindOf(event.event_type),
    type: event.event_type,
    at: event.occurred_at,
    values: { from: rankOf(event.from_rank), to: rankOf(event.to_rank) },
    paths: { from: event.from_url?.path ?? null, to: event.to_url?.path ?? null },
    featureType: event.feature_type,
    other: event.other_entity?.canonical_name ?? null,
    snapshotId: event.serp_snapshot_id,
  };
}
