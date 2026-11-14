import { describe, expect, it } from 'vitest';

import { brandedField, brandedFromValues, brandedValues } from './branded-field';

const WORDS = { label: 'Branded', excluded: 'Excluded', only: 'Only', included: 'Included' };

describe('the Branded filter', () => {
  it('is a single choice enum of Excluded, Only and Included', () => {
    expect(brandedField(WORDS)).toEqual({
      id: 'branded',
      kind: 'enum',
      label: 'Branded',
      multi: false,
      options: [
        { value: 'excluded', label: 'Excluded' },
        { value: 'only', label: 'Only' },
        { value: 'included', label: 'Included' },
      ],
    });
  });

  it('shows the default as a chip, and Included as no chip', () => {
    expect(brandedValues('excluded')).toEqual({ branded: { kind: 'enum', values: ['excluded'] } });
    expect(brandedValues('only')).toEqual({ branded: { kind: 'enum', values: ['only'] } });
    expect(brandedValues('included')).toEqual({});
  });

  it('reads a removed chip as Included and a chip as its value', () => {
    expect(brandedFromValues({})).toBe('included');
    expect(brandedFromValues({ branded: { kind: 'enum', values: ['only'] } })).toBe('only');
    expect(brandedFromValues({ branded: { kind: 'enum', values: ['excluded'] } })).toBe('excluded');
  });

  it('reads a value it does not know as the default', () => {
    expect(brandedFromValues({ branded: { kind: 'enum', values: ['bogus'] } })).toBe('excluded');
  });
});
