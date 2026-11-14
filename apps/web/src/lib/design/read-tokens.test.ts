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
});
