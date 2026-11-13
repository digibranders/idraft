import { describe, expect, it } from 'vitest';

import { defaultView, matchView, viewChangeCount, viewParams, type SavedView, type ViewState } from './views-model';

const DEFAULT = defaultView('Default');
const BRANDED: SavedView = { id: 'branded', name: 'Branded prompts', kind: 'preset', params: { branded: 'only' } };
const UNCITED: SavedView = {
  id: 'uncited',
  name: 'Uncited',
  kind: 'preset',
  params: { cited: 'no', sort: '-mention' },
};
const VIEWS = [DEFAULT, BRANDED, UNCITED] as const;
const KEYS = ['branded', 'cited', 'sort', 'q', 'cols', 'density'] as const;

const match = (
  views: readonly SavedView[],
  viewId: string | null,
  state: ViewState,
  keys: readonly string[],
): ReturnType<typeof matchView> => matchView(views, viewId, state, keys, 'Default');

describe('matchView', () => {
  it('names Default, not edited, when the URL has no view and no view key', () => {
    expect(match(VIEWS, null, {}, KEYS)).toEqual({ view: DEFAULT, edited: false });
    expect(match(VIEWS, null, { branded: null, q: null }, KEYS)).toEqual({ view: DEFAULT, edited: false });
  });

  it('names the view of the URL, not edited while the keys are its params', () => {
    expect(match(VIEWS, 'branded', { branded: 'only' }, KEYS)).toEqual({ view: BRANDED, edited: false });
  });

  it('is edited when a view key differs from the view, by an added key', () => {
    expect(match(VIEWS, 'branded', { branded: 'only', q: 'crm' }, KEYS)).toEqual({ view: BRANDED, edited: true });
  });

  it('is edited when a key of the view changed or was removed', () => {
    expect(match(VIEWS, 'branded', { branded: 'no' }, KEYS).edited).toBe(true);
    expect(match(VIEWS, 'branded', {}, KEYS).edited).toBe(true);
  });

  it('is edited when the Default view has a key set', () => {
    expect(match(VIEWS, null, { q: 'crm' }, KEYS)).toEqual({ view: DEFAULT, edited: true });
  });

  it('reads an empty value as an absent one', () => {
    expect(match(VIEWS, null, { q: '' }, KEYS).edited).toBe(false);
  });

  it('falls back to Default for an unknown view id, edited when keys are set', () => {
    expect(match(VIEWS, 'gone', {}, KEYS)).toEqual({ view: DEFAULT, edited: false });
    expect(match(VIEWS, 'gone', { branded: 'only' }, KEYS)).toEqual({ view: DEFAULT, edited: true });
    expect(match(VIEWS, 'default', {}, KEYS).view).toBe(DEFAULT);
  });

  it('never lets a key outside the view keys make a view edited', () => {
    expect(match(VIEWS, 'branded', { branded: 'only', inspect: 'keyword:1', win: '7d' }, KEYS).edited).toBe(false);
  });

  it('never reads the inspector, the date window or view itself as a view key, even when listed', () => {
    const listed = [...KEYS, 'inspect', 'itab', 'win', 'from', 'to', 'view'];
    const state = { inspect: 'keyword:1', itab: 'serp', win: '7d', from: '2026-01-01', to: '2026-01-02', view: 'x' };
    expect(match(VIEWS, null, state, listed)).toEqual({ view: DEFAULT, edited: false });
  });

  it('degrades to the first view when the list has no default view, and never throws', () => {
    expect(match([BRANDED, UNCITED], null, { branded: 'only' }, KEYS)).toEqual({ view: BRANDED, edited: false });
    expect(match([BRANDED, UNCITED], 'gone', {}, KEYS)).toEqual({ view: BRANDED, edited: true });
    expect(match([BRANDED, UNCITED], 'uncited', { cited: 'no', sort: '-mention' }, KEYS).view).toBe(UNCITED);
  });

  it('degrades to a default view with the given name when the list is empty', () => {
    expect(matchView([], null, {}, KEYS, 'Standard')).toEqual({ view: defaultView('Standard'), edited: false });
    expect(matchView([], 'gone', { q: 'crm' }, KEYS, 'Standard')).toEqual({
      view: defaultView('Standard'),
      edited: true,
    });
  });

  it('prefers the default view over the first view when both exist', () => {
    expect(match([BRANDED, DEFAULT], null, {}, KEYS).view).toBe(DEFAULT);
  });
});

describe('matchView with lists of values', () => {
  const INTENT: SavedView = {
    id: 'intent',
    name: 'Intent',
    kind: 'preset',
    params: { intent: 'commercial,transactional' },
  };
  const views = [DEFAULT, INTENT];
  const keys = [...KEYS, 'intent'];

  it('reads a sort as an ordered list: the same keys in another order are edited', () => {
    const SORTED: SavedView = { id: 'sorted', name: 'Sorted', kind: 'preset', params: { sort: 'name,-volume' } };
    expect(match([DEFAULT, SORTED], 'sorted', { sort: 'name,-volume' }, KEYS).edited).toBe(false);
    expect(match([DEFAULT, SORTED], 'sorted', { sort: '-volume,name' }, KEYS).edited).toBe(true);
  });

  it('is not edited when the same members come in another order', () => {
    expect(match(views, 'intent', { intent: 'commercial,transactional' }, keys).edited).toBe(false);
    expect(match(views, 'intent', { intent: 'transactional,commercial' }, keys).edited).toBe(false);
  });

  it('is edited when a member changed', () => {
    expect(match(views, 'intent', { intent: 'commercial,navigational' }, keys).edited).toBe(true);
  });

  it('is edited when a member was added or removed', () => {
    expect(match(views, 'intent', { intent: 'commercial,transactional,navigational' }, keys).edited).toBe(true);
    expect(match(views, 'intent', { intent: 'commercial' }, keys).edited).toBe(true);
  });

  it('reads a member listed twice as one', () => {
    expect(match(views, 'intent', { intent: 'transactional,commercial,commercial' }, keys).edited).toBe(false);
  });

  it('tells a key that is absent from one that is present and empty only where the view differs', () => {
    expect(match(views, 'intent', { intent: '' }, keys).edited).toBe(true);
    expect(match(views, 'intent', {}, keys).edited).toBe(true);
    expect(match([DEFAULT], null, { intent: '' }, keys).edited).toBe(false);
    expect(match([DEFAULT], null, { intent: ',' }, keys).edited).toBe(false);
  });
});

describe('viewParams', () => {
  it('sets the keys of the view and the view id, and clears every other view key', () => {
    expect(viewParams(UNCITED, KEYS)).toEqual({
      branded: null,
      cited: 'no',
      sort: '-mention',
      q: null,
      cols: null,
      density: null,
      view: 'uncited',
    });
  });

  it('clears every key and the view for Default', () => {
    expect(viewParams(DEFAULT, KEYS)).toEqual({
      branded: null,
      cited: null,
      sort: null,
      q: null,
      cols: null,
      density: null,
      view: null,
    });
  });

  it('writes a list of values as the view gives it', () => {
    const view: SavedView = { id: 'intent', name: 'Intent', kind: 'preset', params: { q: 'b,a' } };
    expect(viewParams(view, KEYS).q).toBe('b,a');
  });

  it('ignores a param whose key the screen does not govern', () => {
    const odd: SavedView = { id: 'odd', name: 'Odd', kind: 'preset', params: { branded: 'only', other: 'x' } };
    expect(viewParams(odd, KEYS)).not.toHaveProperty('other');
  });

  it('never writes the inspector, the date window or view itself, even when a view and the keys list them', () => {
    const risky: SavedView = {
      id: 'risky',
      name: 'Risky',
      kind: 'preset',
      params: {
        branded: 'only',
        inspect: 'keyword:1',
        itab: 'serp',
        win: '7d',
        from: '2026-01-01',
        to: '2026-01-02',
        view: 'x',
      },
    };
    const written = viewParams(risky, [...KEYS, 'inspect', 'itab', 'win', 'from', 'to', 'view']);
    for (const key of ['inspect', 'itab', 'win', 'from', 'to']) expect(written).not.toHaveProperty(key);
    expect(written.view).toBe('risky');
  });
});

describe('viewChangeCount', () => {
  it('counts the params of the view', () => {
    expect(viewChangeCount(DEFAULT)).toBe(0);
    expect(viewChangeCount(BRANDED)).toBe(1);
    expect(viewChangeCount(UNCITED)).toBe(2);
  });

  it('does not count a key that is never a view key', () => {
    expect(viewChangeCount({ ...BRANDED, params: { branded: 'only', win: '7d', inspect: 'keyword:1' } })).toBe(1);
  });
});
