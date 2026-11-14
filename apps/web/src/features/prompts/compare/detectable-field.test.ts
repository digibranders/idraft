import { describe, expect, it } from 'vitest';

import { DETECTABLE_ID, detectableField, isDetectableOnly } from './detectable-field';

describe('detectableField', () => {
  it('is an enum field Show with the one option Detectable changes only, in the address as detectable=only', () => {
    expect(DETECTABLE_ID).toBe('detectable');
    expect(detectableField({ field: 'Show', option: 'Detectable changes only' })).toEqual({
      id: 'detectable',
      kind: 'enum',
      label: 'Show',
      multi: false,
      options: [{ value: 'only', label: 'Detectable changes only' }],
    });
  });
});

describe('isDetectableOnly', () => {
  it('is true only for the value only', () => {
    expect(isDetectableOnly({ detectable: { kind: 'enum', values: ['only'] } })).toBe(true);
    expect(isDetectableOnly({})).toBe(false);
    expect(isDetectableOnly({ branded: { kind: 'enum', values: ['include'] } })).toBe(false);
  });
});
