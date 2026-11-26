import { describe, expect, it } from 'vitest';

import { PAGES_DEFAULT_SORT, PAGES_REDIRECT_KEYS, parsePagesSearch } from './url-state';

const RUN = '0192E4A0-1000-7000-8000-000000000001';

describe('parsePagesSearch', () => {
  it('reads an empty address as the defaults', () => {
    expect(parsePagesSearch({})).toEqual({
      run: null,
      invalidRun: null,
      scope: 'editorial',
      view: null,
      worklist: null,
      sort: 'path',
      q: null,
      depth: null,
      variants: false,
    });
    expect(PAGES_DEFAULT_SORT).toBe('path');
  });

  it('reads a server view as a view, and one of the six page worklists as a worklist', () => {
    expect(parsePagesSearch({ view: 'live' })).toMatchObject({ view: 'live', worklist: null });
    expect(parsePagesSearch({ view: 'orphans' })).toMatchObject({ view: null, worklist: 'orphans' });
  });

  it('reads an unknown view as no view and no worklist', () => {
    expect(parsePagesSearch({ view: 'nope' })).toMatchObject({ view: null, worklist: null });
  });

  it('keeps a known sort and falls back to path for another', () => {
    expect(parsePagesSearch({ sort: '-impressions' }).sort).toBe('-impressions');
    expect(parsePagesSearch({ sort: 'nope' }).sort).toBe('path');
  });

  it('keeps a depth of 0 to 6 and reads anything else as none', () => {
    expect(parsePagesSearch({ depth: '0' }).depth).toBe(0);
    expect(parsePagesSearch({ depth: '6' }).depth).toBe(6);
    for (const bad of ['7', '-1', '2.5', 'x', '']) expect(parsePagesSearch({ depth: bad }).depth).toBeNull();
  });

  it('reads variants=1 as true and anything else as false', () => {
    expect(parsePagesSearch({ variants: '1' }).variants).toBe(true);
    expect(parsePagesSearch({ variants: 'true' }).variants).toBe(false);
    expect(parsePagesSearch({}).variants).toBe(false);
  });

  it('trims the search and cuts it at 200 characters', () => {
    expect(parsePagesSearch({ q: '  pricing ' }).q).toBe('pricing');
    expect(parsePagesSearch({ q: 'a'.repeat(300) }).q).toHaveLength(200);
    expect(parsePagesSearch({ q: '   ' }).q).toBeNull();
  });

  it('lower-cases a crawl id, and keeps the text of a malformed one apart', () => {
    expect(parsePagesSearch({ run: RUN })).toMatchObject({ run: RUN.toLowerCase(), invalidRun: null });
    expect(parsePagesSearch({ run: 'not-a-crawl' })).toMatchObject({ run: null, invalidRun: 'not-a-crawl' });
  });

  it('reads the scope', () => {
    expect(parsePagesSearch({ scope: 'all' }).scope).toBe('all');
    expect(parsePagesSearch({ scope: 'nope' }).scope).toBe('editorial');
  });
});

describe('PAGES_REDIRECT_KEYS', () => {
  it('names the keys only the old Pages tab wrote', () => {
    expect(PAGES_REDIRECT_KEYS).toContain('view');
    expect(PAGES_REDIRECT_KEYS).not.toContain('run');
  });
});
