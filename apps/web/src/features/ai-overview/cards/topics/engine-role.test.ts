import { describe, expect, it } from 'vitest';

import { engineRole } from './engine-role';

describe('engineRole', () => {
  it('gives each engine the colour of its place in the fixed order, never of its place in the data', () => {
    expect(engineRole('chatgpt_web')).toEqual({ kind: 'brand' });
    expect(engineRole('gemini_web')).toEqual({ kind: 'palette', index: 2 });
    expect(engineRole('google_ai_mode')).toEqual({ kind: 'palette', index: 3 });
  });

  it('gives an engine that is not in the order the neutral role', () => {
    expect(engineRole('perplexity')).toEqual({ kind: 'other' });
  });
});
