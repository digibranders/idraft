import { describe, expect, it } from 'vitest';

import { EVENT_KINDS, eventTypeFilter, eventView, kindOf, typesOf } from './events-model';
import type { RankEventOut, UrlRef } from '@/lib/api/types';

const ALL_TYPES = [
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

const urlRef = (path: string): UrlRef => ({
  url_id: `url-${path}`,
  canonical_url: `https://fynix.example${path}`,
  host: 'fynix.example',
  path,
  registrable_domain: 'fynix.example',
});

function event(type: string, extra: Partial<RankEventOut> = {}): RankEventOut {
  return {
    rank_event_id: 'event-1',
    event_type: type,
    occurred_at: '2026-10-29T02:00:00Z',
    entity: { entity_id: 'own', canonical_name: 'Fynix', entity_type: 'organization', role: 'own', color_index: null },
    other_entity: null,
    from_rank: null,
    to_rank: null,
    from_url: null,
    to_url: null,
    feature_type: null,
    keyword: 'seo agency berlin',
    tracked_keyword_id: 'tk-1',
    serp_snapshot_id: 'snap-1',
    ...extra,
  };
}

describe('the kinds of event', () => {
  it('puts each of the 21 event types of the backend in exactly one kind', () => {
    expect(ALL_TYPES).toHaveLength(21);
    for (const type of ALL_TYPES) {
      expect(EVENT_KINDS.filter((kind) => typesOf([kind]).includes(type))).toHaveLength(1);
    }
    expect(EVENT_KINDS.flatMap((kind) => typesOf([kind])).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('does not guess the kind of a code it does not know', () => {
    expect(kindOf('entered_top_10')).toBe('rank');
    expect(kindOf('url_changed')).toBe('url');
    expect(kindOf('aio_citation_lost')).toBe('ai_citation');
    expect(kindOf('overtook')).toBe('competitor');
    expect(kindOf('something_new')).toBeNull();
  });

  it('asks for no type filter at all when every kind is chosen, and for the union otherwise', () => {
    expect(eventTypeFilter([...EVENT_KINDS])).toBeUndefined();
    expect(eventTypeFilter(['url', 'competitor'])).toEqual(['url_changed', 'overtaken_by', 'overtook']);
  });

  it('reads an empty choice as every kind, because nothing chosen would show nothing', () => {
    expect(eventTypeFilter([])).toBeUndefined();
  });
});

describe('eventView', () => {
  it('keeps an event of an unknown type visible under All, with its code', () => {
    const view = eventView(event('something_new'));
    expect(view.kind).toBeNull();
    expect(view.type).toBe('something_new');
  });

  it('reads rank values as ranks or as not ranked, never as zero', () => {
    expect(eventView(event('rank_gain', { from_rank: 8, to_rank: 3 })).values).toEqual({
      from: { kind: 'rank', rank: 8 },
      to: { kind: 'rank', rank: 3 },
    });
    expect(eventView(event('lost_ranking', { from_rank: 14, to_rank: null })).values.to).toEqual({ kind: 'none' });
    expect(eventView(event('new_ranking', { from_rank: null, to_rank: 12 })).values.from).toEqual({ kind: 'none' });
  });

  it('takes the paths of a URL change from the event, and none when the API sent no URL', () => {
    const withUrls = eventView(event('url_changed', { from_url: urlRef('/blog'), to_url: urlRef('/pricing') }));
    expect(withUrls.paths).toEqual({ from: '/blog', to: '/pricing' });
    expect(eventView(event('url_changed', { from_url: null, to_url: null })).paths).toEqual({ from: null, to: null });
  });

  it('carries the feature, the other entity, the snapshot and the instant of the event', () => {
    const view = eventView(
      event('overtaken_by', {
        rank_event_id: 'event-9',
        feature_type: 'featured_snippet',
        serp_snapshot_id: 'snap-9',
        occurred_at: '2026-10-28T14:00:00Z',
        other_entity: {
          entity_id: 'rival',
          canonical_name: 'Rival Media',
          entity_type: 'organization',
          role: 'competitor',
          color_index: 3,
        },
      }),
    );
    expect(view).toMatchObject({
      id: 'event-9',
      kind: 'competitor',
      type: 'overtaken_by',
      at: '2026-10-28T14:00:00Z',
      featureType: 'featured_snippet',
      other: 'Rival Media',
      snapshotId: 'snap-9',
    });
  });
});
