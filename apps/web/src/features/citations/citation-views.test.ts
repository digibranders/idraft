import { describe, expect, it } from 'vitest';

import { CITATION_KEYS, parseScope } from './citation-scope';
import { CITATION_VIEW_KEYS, citationViews } from './citation-views';
import { governedKeys, matchView } from '@/components/app/views/views-model';

const name = (key: string): string => `name:${key}`;
const VIEWS = citationViews(name);

describe('citationViews', () => {
  it('has Default plus three presets and each sets only governed keys', () => {
    expect(VIEWS.map((view) => view.id)).toEqual([
      'default',
      'own-domain',
      'competitor-sources',
      'third-party-sources',
    ]);
    expect(VIEWS.map((view) => view.name)).toEqual(['name:default', 'name:own', 'name:competitors', 'name:thirdParty']);
    expect(VIEWS.every((view) => view.kind === 'preset')).toBe(true);
    const governed = new Set(governedKeys(CITATION_VIEW_KEYS));
    for (const view of VIEWS) {
      expect(Object.keys(view.params).every((key) => governed.has(key))).toBe(true);
    }
    expect(VIEWS[0]?.params).toEqual({});
  });

  it('the presets are the role filter and the scope reads it', () => {
    const roles = VIEWS.slice(1).map((view) => parseScope(view.params, []).roles);
    expect(roles).toEqual([['own'], ['competitor'], ['third_party']]);
  });

  it('no preset sets inspect, itab, win, from or to', () => {
    for (const view of VIEWS) {
      for (const key of ['view', 'inspect', 'itab', 'win', 'from', 'to']) {
        expect(view.params).not.toHaveProperty(key);
      }
    }
    expect(CITATION_VIEW_KEYS.filter((key) => ['view', 'inspect', 'itab', 'win', 'from', 'to'].includes(key))).toEqual(
      [],
    );
  });

  it('governs every key the scope reads, and a preset reads as unedited at its own address', () => {
    expect([...CITATION_VIEW_KEYS]).toEqual([...CITATION_KEYS]);
    const own = VIEWS[1];
    if (own === undefined) throw new Error('The Own domain view is missing');
    expect(matchView(VIEWS, own.id, { role: 'own' }, CITATION_VIEW_KEYS, 'Default').edited).toBe(false);
    expect(matchView(VIEWS, own.id, { role: 'own', min: '5' }, CITATION_VIEW_KEYS, 'Default').edited).toBe(true);
  });
});
