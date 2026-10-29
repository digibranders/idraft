import { describe, expect, it } from 'vitest';

import { AIO_CHOICES, CHANGE_CHOICES, RANK_CHOICES, STALE_CHOICES, rankFilterParams } from './rank-filters';
import type { FilterValues } from '@/components/app/filters/types';

const one = (id: string, value: string): FilterValues => ({ [id]: { kind: 'enum', values: [value] } });

describe('rankFilterParams', () => {
  it('sends nothing when no rank filter is chosen', () => {
    expect(rankFilterParams({})).toEqual({});
  });

  it.each([
    ['top3', 1, 3],
    ['top10', 4, 10],
    ['top20', 11, 20],
    ['top50', 21, 50],
    ['top100', 51, 100],
  ] as const)('maps the %s bucket to places %i to %i', (bucket, from, to) => {
    expect(rankFilterParams(one('rank', bucket))).toEqual({ 'filter[rank_gte]': from, 'filter[rank_lte]': to });
  });

  it('maps beyond depth to a checked keyword with no rank, and sends no range with it', () => {
    expect(rankFilterParams(one('rank', 'beyond'))).toEqual({ 'filter[rank_is_null]': true });
  });

  it('maps each change to the exact parameter the API takes', () => {
    expect(rankFilterParams(one('chg', 'improved'))).toEqual({ 'filter[improved]': true });
    expect(rankFilterParams(one('chg', 'declined'))).toEqual({ 'filter[declined]': true });
    expect(rankFilterParams(one('chg', 'entered'))).toEqual({ 'filter[rank_change_label_in]': ['new'] });
    expect(rankFilterParams(one('chg', 'lost'))).toEqual({ 'filter[rank_change_label_in]': ['lost'] });
  });

  it('maps a SERP feature to feature_present and an owned feature to feature_owned', () => {
    expect(rankFilterParams(one('feat', 'featured_snippet'))).toEqual({
      'filter[feature_present]': 'featured_snippet',
    });
    expect(rankFilterParams(one('featown', 'video'))).toEqual({ 'filter[feature_owned]': 'video' });
  });

  it('drops a feature code the API does not know and an owned feature that cannot be owned', () => {
    expect(rankFilterParams(one('feat', 'image_pack'))).toEqual({});
    expect(rankFilterParams(one('featown', 'related_searches'))).toEqual({});
  });

  it('maps the AI Overview chip to a list of states, keeping only known ones', () => {
    expect(rankFilterParams({ aio: { kind: 'enum', values: ['present_cited', 'absent'] } })).toEqual({
      'filter[aio_state]': ['present_cited', 'absent'],
    });
    expect(rankFilterParams({ aio: { kind: 'enum', values: ['sometimes'] } })).toEqual({});
  });

  it('maps stale to the API flag', () => {
    expect(rankFilterParams(one('stale', 'stale'))).toEqual({ 'filter[is_stale]': true });
  });

  it('combines the three chips, which the API takes together', () => {
    const values: FilterValues = { ...one('rank', 'top10'), ...one('chg', 'declined'), ...one('stale', 'stale') };
    expect(rankFilterParams(values)).toEqual({
      'filter[rank_gte]': 4,
      'filter[rank_lte]': 10,
      'filter[declined]': true,
      'filter[is_stale]': true,
    });
  });

  it('never sends an empty value: unknown values and filters of another kind give nothing', () => {
    expect(rankFilterParams(one('rank', 'top7'))).toEqual({});
    expect(rankFilterParams(one('chg', 'sideways'))).toEqual({});
    expect(rankFilterParams(one('stale', 'fresh'))).toEqual({});
    expect(rankFilterParams({ rank: { kind: 'enum', values: [] } })).toEqual({});
    expect(rankFilterParams({ rank: { kind: 'range', min: 1, max: 3 } })).toEqual({});
    expect(rankFilterParams({ chg: { kind: 'text', operator: 'contains', text: 'improved' } })).toEqual({});
  });

  it('takes the first value when a link names several, as the single choice chips do', () => {
    expect(rankFilterParams({ rank: { kind: 'enum', values: ['top10', 'top3'] } })).toEqual({
      'filter[rank_gte]': 4,
      'filter[rank_lte]': 10,
    });
  });

  it('lists the choices each chip offers, in the order of its menu', () => {
    expect(RANK_CHOICES).toEqual(['top3', 'top10', 'top20', 'top50', 'top100', 'beyond']);
    expect(CHANGE_CHOICES).toEqual(['improved', 'declined', 'entered', 'lost']);
    expect(STALE_CHOICES).toEqual(['stale']);
    expect(AIO_CHOICES).toEqual(['present_cited', 'present_not_cited', 'absent', 'not_loaded', 'unknown']);
  });
});
