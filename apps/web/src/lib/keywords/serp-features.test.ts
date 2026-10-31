import { describe, expect, it } from 'vitest';

import { FEATURE_SLOTS, FEATURE_TYPES, OWNABLE_FEATURE_TYPES, featureListDisplay } from './serp-features';

describe('SERP features', () => {
  it('mirrors the 16 codes of the backend in its order', () => {
    expect(FEATURE_TYPES).toHaveLength(16);
    expect(FEATURE_TYPES[0]).toBe('ai_overview');
    expect(FEATURE_TYPES.at(-1)).toBe('sitelinks');
  });

  it('cannot own related searches', () => {
    expect(OWNABLE_FEATURE_TYPES).not.toContain('related_searches');
    expect(OWNABLE_FEATURE_TYPES).toHaveLength(15);
  });

  it('orders the slots by the fixed feature order and marks the owned ones', () => {
    expect(featureListDisplay(['video', 'ai_overview', 'featured_snippet'], ['featured_snippet'])).toEqual({
      shown: [
        { type: 'ai_overview', owned: false },
        { type: 'featured_snippet', owned: true },
        { type: 'video', owned: false },
      ],
      overflow: 0,
      all: [
        { type: 'ai_overview', owned: false },
        { type: 'featured_snippet', owned: true },
        { type: 'video', owned: false },
      ],
    });
  });

  it('shows five slots and counts the rest', () => {
    const present = ['ads', 'sitelinks', 'video', 'images', 'local_pack', 'shopping', 'top_stories'];
    const shown = featureListDisplay(present, []);
    expect(shown.shown).toHaveLength(FEATURE_SLOTS);
    expect(shown.overflow).toBe(2);
    expect(shown.all).toHaveLength(7);
  });

  it('keeps a code the UI does not know, after the known ones, and drops repeats', () => {
    expect(featureListDisplay(['new_thing', 'video', 'video'], []).shown).toEqual([
      { type: 'video', owned: false },
      { type: 'new_thing', owned: false },
    ]);
  });

  it('shows nothing for no features', () => {
    expect(featureListDisplay([], [])).toEqual({ shown: [], overflow: 0, all: [] });
  });
});
