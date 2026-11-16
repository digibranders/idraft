import { describe, expect, it } from 'vitest';

import { INTENT_LABEL, INTENT_ORDER, intentOf } from './intent';

describe('intentOf', () => {
  it('names the intents of the API enum with a label and a meaning', () => {
    expect(intentOf('commercial')).toEqual({ state: 'ok', intent: 'commercial', ...INTENT_LABEL.commercial });
    expect(intentOf('transactional')).toMatchObject({ state: 'ok', label: 'Transactional' });
    expect(INTENT_ORDER).toHaveLength(Object.keys(INTENT_LABEL).length);
  });

  it('is unknown for a missing field and for the unclassified value', () => {
    expect(intentOf(undefined)).toEqual({ state: 'unknown', reason: 'not_collected' });
    expect(intentOf('unknown')).toEqual({ state: 'unknown', reason: 'unclassified' });
  });
});
