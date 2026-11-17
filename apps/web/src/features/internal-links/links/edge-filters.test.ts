import { describe, expect, it } from 'vitest';

import { edgeExportQuery, edgeQueryOf } from './edge-filters';
import { parseLinksSearch } from '../url-state';

const TIER = '0192e4a0-1000-7000-8000-0000000000a1';

describe('edgeQueryOf', () => {
  it('reads the filter bar, the worklist, the page and the searches into one edges query', () => {
    const state = parseLinksSearch({ scope: 'template', lview: 'broken_and_redirected', lq: '/services', tgt: '108' });
    expect(
      edgeQueryOf(
        state,
        {
          stier: { kind: 'enum', values: ['none'] },
          ttier: { kind: 'enum', values: [TIER] },
          place: { kind: 'enum', values: ['footer', 'nowhere'] },
          tstatus: { kind: 'enum', values: ['3xx', '9xx'] },
          sq: { kind: 'text', operator: 'contains', text: ' /blog ' },
        },
        null,
        100,
      ),
    ).toEqual({
      scope: 'template',
      sourceTierIds: ['none'],
      targetTierIds: [TIER],
      tagIds: [],
      placements: ['footer'],
      targetStatus: ['3xx'],
      source: null,
      target: '108',
      worklist: 'broken_and_redirected',
      qSource: '/blog',
      qTarget: '/services',
      cursor: null,
      limit: 100,
    });
  });

  it('leaves out a tier or tag id the API would refuse, so a hand-edited address is no 422', () => {
    const query = edgeQueryOf(
      parseLinksSearch({}),
      {
        stier: { kind: 'enum', values: ['T1', TIER] },
        tag: { kind: 'enum', values: ['not-an-id'] },
      },
      null,
      100,
    );
    expect(query.sourceTierIds).toEqual([TIER]);
    expect(query.tagIds).toEqual([]);
  });

  it('never carries an address id that is not a url id into the query', () => {
    const query = edgeQueryOf(parseLinksSearch({ src: 'abc', tgt: '0' }), {}, null, 100);
    expect(query.source).toBeNull();
    expect(query.target).toBeNull();
  });
});

describe('edgeExportQuery', () => {
  it('is the same filter as a CSV, with no cursor and no page size', () => {
    const query = edgeQueryOf(parseLinksSearch({ scope: 'all', lq: '/a' }), {}, 'next', 200);
    expect(edgeExportQuery(query)).toEqual({ scope: 'all', q_target: '/a', format: 'csv' });
  });
});
