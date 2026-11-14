import { describe, expect, it } from 'vitest';

import { COMPETITOR_VIEW_KEYS, competitorViews } from './competitors-views';
import { parseScope } from './scope-model';
import { governedKeys, matchView } from '@/components/app/views/views-model';

const VIEWS = competitorViews((key) => `name:${key}`);
const ALL = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

describe('competitorViews', () => {
  it('has Default plus two presets, all presets', () => {
    expect(VIEWS.map((view) => view.id)).toEqual(['default', 'share-of-voice', 'branded-included']);
    expect(VIEWS.map((view) => view.name)).toEqual(['name:default', 'name:shareOfVoice', 'name:brandedIncluded']);
    expect(VIEWS.every((view) => view.kind === 'preset')).toBe(true);
    expect(VIEWS[0]?.params).toEqual({});
  });

  it('the view keys never include inspect, itab, the range or country', () => {
    for (const key of ['view', 'inspect', 'itab', 'win', 'from', 'to', 'country']) {
      expect(COMPETITOR_VIEW_KEYS).not.toContain(key);
    }
    expect(COMPETITOR_VIEW_KEYS).toEqual(
      expect.arrayContaining([
        'tab',
        'engine',
        'eng',
        'metric',
        'topic',
        'branded',
        'cmp',
        'lost',
        'sort',
        'cols',
        'density',
        'q',
      ]),
    );
  });

  it('the presets set only their own keys, and each is read by the scope', () => {
    const governed = new Set(governedKeys(COMPETITOR_VIEW_KEYS));
    for (const view of VIEWS) expect(Object.keys(view.params).every((key) => governed.has(key))).toBe(true);
    expect(parseScope(VIEWS[1]?.params ?? {}, ALL).metric).toBe('sov');
    expect(parseScope(VIEWS[2]?.params ?? {}, ALL).branded).toBe('included');
    expect(VIEWS[1]?.params).toEqual({ metric: 'sov' });
    expect(VIEWS[2]?.params).toEqual({ branded: 'include' });
  });

  it('a preset reads as unedited at its own address and as edited once another view key changes', () => {
    expect(matchView(VIEWS, 'share-of-voice', { metric: 'sov' }, COMPETITOR_VIEW_KEYS, 'Default').edited).toBe(false);
    expect(
      matchView(VIEWS, 'share-of-voice', { metric: 'sov', tab: 'ai' }, COMPETITOR_VIEW_KEYS, 'Default').edited,
    ).toBe(true);
  });
});
