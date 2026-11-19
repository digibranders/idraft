import { describe, expect, it } from 'vitest';

import { tierEdge, tierFill } from './tier-colors';

const CODES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

describe('tier color classes', () => {
  it.each(CODES.map((code, index) => [code, index + 1] as const))('maps %s to the tier-%i token', (code, position) => {
    expect(tierFill({ code })).toBe(`bg-tier-${String(position)}`);
    expect(tierEdge({ code })).toBe(`border-l-tier-${String(position)}`);
  });

  it('gives Untiered the neutral token', () => {
    expect(tierFill(null)).toBe('bg-tier-none');
    expect(tierEdge(null)).toBe('border-l-tier-none');
  });
});
