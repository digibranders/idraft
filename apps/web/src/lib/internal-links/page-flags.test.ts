import { describe, expect, it } from 'vitest';

import { pageFlags, type FlaggedPage } from './page-flags';

const page = (over: Partial<FlaggedPage> = {}): FlaggedPage => ({
  flags: [],
  broken_outlinks: 0,
  redirect_outlinks: 0,
  linking_pages: 5,
  is_indexable: true,
  status_code: 200,
  tier: { code: 'T2' },
  ...over,
});

describe('pageFlags (spec 7.2, mock il-model.js flags)', () => {
  it('has none for a healthy page', () => {
    expect(pageFlags(page(), 'editorial')).toEqual([]);
  });

  it('keeps the order of the mock: page errors, link structure, then outlinks', () => {
    const flags = pageFlags(
      page({ flags: ['deep_only_through_auto', 'orphan', 'redirect'], broken_outlinks: 2, redirect_outlinks: 1 }),
      'editorial',
    );
    expect(flags.map((flag) => flag.key)).toEqual([
      'redirect',
      'orphan',
      'deepOnlyThroughAuto',
      'brokenOutlinks',
      'redirectOutlinks',
    ]);
  });

  it('gives errors the negative tone and risks the warning tone', () => {
    const flags = pageFlags(page({ flags: ['broken', 'editorial_orphan'] }), 'editorial');
    expect(flags).toEqual([
      { key: 'errorPage', tone: 'negative' },
      { key: 'editorialOrphan', tone: 'warning' },
    ]);
  });

  it('flags a live, indexable T1 page with fewer than 3 editorial linking pages, only in the editorial scope', () => {
    const thin = page({ tier: { code: 'T1' }, linking_pages: 2 });
    expect(pageFlags(thin, 'editorial')).toEqual([{ key: 'fewEditorialLinks', tone: 'warning' }]);
    expect(pageFlags(thin, 'all')).toEqual([]);
    expect(pageFlags({ ...thin, is_indexable: false }, 'editorial').map((flag) => flag.key)).not.toContain(
      'fewEditorialLinks',
    );
  });

  it('flags mostly generic anchors in the warning tone', () => {
    expect(pageFlags(page({ flags: ['generic_anchors'] }), 'editorial')).toEqual([
      { key: 'genericAnchors', tone: 'warning' },
    ]);
  });

  it('marks a page whose placement is unknown in the neutral tone', () => {
    expect(pageFlags(page({ flags: ['placement_unknown'] }), 'editorial')).toEqual([
      { key: 'placementUnknown', tone: 'neutral' },
    ]);
  });
});
