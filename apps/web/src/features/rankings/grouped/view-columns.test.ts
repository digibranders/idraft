import { describe, expect, it } from 'vitest';

import { columnsForView, HIDDEN_IN_GROUPS, mergeHidden, visibleForView } from './view-columns';

const ALL = [
  'keyword',
  'country',
  'current_rank',
  'ranking_url',
  'search_volume',
  'keyword_difficulty',
  'intent',
  'serp_features',
  'aio',
  'cpc_usd',
  'competitor_e1',
  'competitor_e2',
  'trend',
  'priority',
  'group',
  'tags',
  'best_rank',
  'last_observed_at',
  'created_at',
];

const FLAT_DEFAULTS = [
  'keyword',
  'current_rank',
  'search_volume',
  'keyword_difficulty',
  'intent',
  'serp_features',
  'aio',
  'cpc_usd',
  'competitor_e1',
  'trend',
  'group',
  'tags',
  'last_observed_at',
  'created_at',
];

describe('columnsForView', () => {
  it('keeps every column in the flat view', () => {
    expect(columnsForView(ALL, 'flat')).toEqual(ALL);
  });

  it('leaves out the columns a group has no figure for, and the competitor columns, in By group', () => {
    const shown = columnsForView(ALL, 'groups');
    for (const id of HIDDEN_IN_GROUPS) expect(shown).not.toContain(id);
    expect(shown).not.toContain('competitor_e1');
    expect(shown).not.toContain('competitor_e2');
    expect(shown).toEqual([
      'keyword',
      'country',
      'current_rank',
      'ranking_url',
      'search_volume',
      'aio',
      'cpc_usd',
      'priority',
      'best_rank',
      'last_observed_at',
      'created_at',
    ]);
  });

  it('names the hidden columns of the plan', () => {
    expect([...HIDDEN_IN_GROUPS].sort()).toEqual(
      ['group', 'intent', 'keyword_difficulty', 'serp_features', 'tags', 'trend'].sort(),
    );
  });
});

describe('visibleForView', () => {
  it('leaves the table its defaults when the URL names no columns', () => {
    expect(visibleForView(null, 'flat')).toBeNull();
    expect(visibleForView(null, 'groups')).toBeNull();
  });

  it('keeps the explicit list in the flat view', () => {
    expect(visibleForView(['keyword', 'trend', 'search_volume'], 'flat')).toEqual([
      'keyword',
      'trend',
      'search_volume',
    ]);
  });

  it('drops the hidden columns from an explicit list in By group, in order', () => {
    expect(visibleForView(['keyword', 'trend', 'search_volume', 'competitor_e1', 'tags', 'cpc_usd'], 'groups')).toEqual(
      ['keyword', 'search_volume', 'cpc_usd'],
    );
  });
});

describe('mergeHidden', () => {
  it('stores the chooser result as it is in the flat view', () => {
    expect(mergeHidden(['keyword', 'trend'], ['keyword'], FLAT_DEFAULTS, 'flat')).toEqual(['keyword']);
  });

  it('stores a reset as a reset in By group', () => {
    expect(mergeHidden(['keyword', 'trend'], null, FLAT_DEFAULTS, 'groups')).toBeNull();
  });

  it('keeps the hidden columns the flat view had chosen, where they were', () => {
    const urlCols = ['keyword', 'current_rank', 'keyword_difficulty', 'search_volume', 'tags', 'created_at'];
    expect(
      mergeHidden(urlCols, ['keyword', 'current_rank', 'search_volume', 'cpc_usd'], FLAT_DEFAULTS, 'groups'),
    ).toEqual(['keyword', 'current_rank', 'keyword_difficulty', 'search_volume', 'tags', 'cpc_usd']);
  });

  it('keeps the flat defaults that By group hides when the URL names no columns', () => {
    const merged = mergeHidden(null, ['keyword', 'current_rank', 'search_volume'], FLAT_DEFAULTS, 'groups');
    expect(merged).toEqual([
      'keyword',
      'current_rank',
      'search_volume',
      'keyword_difficulty',
      'intent',
      'serp_features',
      'competitor_e1',
      'trend',
      'group',
      'tags',
    ]);
  });

  it('does not repeat a column the person chose in By group', () => {
    const merged = mergeHidden(['keyword', 'trend'], ['keyword', 'trend', 'aio'], FLAT_DEFAULTS, 'groups');
    expect(merged).toEqual(['keyword', 'trend', 'aio']);
  });
});
