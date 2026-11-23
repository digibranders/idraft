import { describe, expect, it } from 'vitest';

import { isShotStored, latestOf, SHOT_WINDOW_MS, shotStateOf, storeShot } from './answer-screenshots';

const AT = Date.parse('2026-11-12T02:00:00Z');
const SCOPE = { workspaceId: 'w', projectId: 'p', now: AT + 3_600_000 };

describe('shotStateOf', () => {
  it('is available once stored, whatever the engine and the age', () => {
    expect(shotStateOf('chatgpt_web', true, AT, AT + 30 * 86_400_000)).toBe('available');
  });

  it('is capturable up to 6 days 20 hours after the answer and expired after', () => {
    expect(shotStateOf('gemini_web', false, AT, AT + SHOT_WINDOW_MS)).toBe('capturable');
    expect(shotStateOf('gemini_web', false, AT, AT + SHOT_WINDOW_MS + 1)).toBe('expired');
  });

  it('is unsupported for an engine with no platform page', () => {
    expect(shotStateOf('perplexity', false, AT, AT)).toBe('unsupported');
  });
});

describe('latestOf', () => {
  const newest = { observation_id: '77', observed_at: '2026-11-12T02:00:00Z' };

  it('has no path until a capture is stored, then the API path of the image', () => {
    expect(latestOf(SCOPE, 'chatgpt_web', newest)).toEqual({
      ...newest,
      screenshot_url: null,
      screenshot_state: 'capturable',
    });
    storeShot('p', '77');
    expect(isShotStored('p', '77')).toBe(true);
    expect(latestOf(SCOPE, 'chatgpt_web', newest)).toEqual({
      ...newest,
      screenshot_url: '/api/v1/workspaces/w/projects/p/ai/observations/77/screenshot',
      screenshot_state: 'available',
    });
  });
});
