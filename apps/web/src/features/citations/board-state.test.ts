import { describe, expect, it } from 'vitest';

import { migrationOf, parseBoard, writeBoard, type BoardOptions, type BoardSearch } from './board-state';

const OPTIONS: BoardOptions = {
  engines: ['chatgpt_web', 'gemini_web'],
  terms: new Set(['t1', 't2']),
  tracked: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
};
const parse = (search: BoardSearch, options: BoardOptions = OPTIONS) => parseBoard(search, options);

describe('the Citations address', () => {
  it('reads nothing as the defaults: all platforms and groups, 4 runs, the first three competitors, your site, only gaps', () => {
    expect(parse({})).toEqual({
      platform: 'all',
      group: 'all',
      runs: 4,
      competitors: ['c1', 'c2', 'c3'],
      owner: 'own',
      gapsOnly: true,
      search: '',
    });
  });

  it.each([
    [{ platform: 'gemini_web' }, { platform: 'gemini_web' }],
    [{ platform: 'google_ai_mode' }, { platform: 'all' }],
    [{ platform: 'bing' }, { platform: 'all' }],
    [{ group: 't2' }, { group: 't2' }],
    [{ group: 'gone' }, { group: 'all' }],
    [{ runs: '2' }, { runs: 2 }],
    [{ runs: '3' }, { runs: 4 }],
    [{ owner: 'third' }, { owner: 'third' }],
    [{ owner: 'third_party' }, { owner: 'own' }],
    [{ gaps: 'all' }, { gapsOnly: false }],
    [{ gaps: 'some' }, { gapsOnly: true }],
    [{ q: `  ${'a'.repeat(250)}` }, { search: 'a'.repeat(200) }],
  ])('reads %o', (search, expected) => {
    expect(parse(search)).toMatchObject(expected);
  });

  it('reads comp: none when empty, unknown and repeated ids dropped, at most five, in the order given', () => {
    expect(parse({ comp: '' }).competitors).toEqual([]);
    expect(parse({ comp: 'c3,x,c1,c3' }).competitors).toEqual(['c3', 'c1']);
    expect(parse({ comp: 'c1,c2,c3,c4,c5,c6' }).competitors).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('keeps a group and the competitors as given while the terms and the tracked list load', () => {
    const loading: BoardOptions = { engines: null, terms: null, tracked: null };
    expect(parse({ group: 't9', comp: 'c9', platform: 'gemini_web' }, loading)).toMatchObject({
      group: 't9',
      competitors: ['c9'],
      platform: 'gemini_web',
    });
    expect(parse({}, loading).competitors).toEqual([]);
  });

  it('writes the defaults as nothing and every other value under its key', () => {
    expect(writeBoard(parse({}), OPTIONS.tracked)).toEqual({
      platform: null,
      group: null,
      runs: null,
      comp: null,
      owner: null,
      gaps: null,
      q: null,
    });
    expect(
      writeBoard(
        { platform: 'gemini_web', group: 't1', runs: 1, competitors: [], owner: 'all', gapsOnly: false, search: 'crm' },
        OPTIONS.tracked,
      ),
    ).toEqual({ platform: 'gemini_web', group: 't1', runs: '1', comp: '', owner: 'all', gaps: 'all', q: 'crm' });
  });

  it('moves the old keys once: role to owner, topic to group, the rest dropped', () => {
    expect(migrationOf({ tab: 'domains', role: 'third_party', topic: 't1', win: '7d', engine: 'chatgpt_web' })).toEqual(
      {
        tab: null,
        role: null,
        topic: null,
        win: null,
        engine: null,
        owner: 'third',
        group: 't1',
      },
    );
    expect(migrationOf({ tab: 'new-lost', role: 'own,competitor' })).toEqual({ tab: null, role: null });
    expect(migrationOf({ platform: 'chatgpt_web' })).toBeNull();
  });
});
