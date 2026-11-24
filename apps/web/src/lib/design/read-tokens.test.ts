// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { readChartTokens } from './read-tokens';

describe('readChartTokens', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('reads the boundary line colour from --foreground-muted', () => {
    // Where no canvas can convert it (a test environment), the raw value comes back as it was set
    document.documentElement.style.setProperty('--foreground-muted', 'muted-grey');
    expect(readChartTokens().foregroundMuted).toBe('muted-grey');
  });

  it('reads any other colour token by name', () => {
    document.documentElement.style.setProperty('--seq-6', 'deep-blue');
    expect(readChartTokens().named?.('seq-6')).toBe('deep-blue');
  });

  it('reads a token the page does not define as undefined, so a caller can fall back', () => {
    expect(readChartTokens().named?.('no-such-token')).toBeUndefined();
  });
});
