import { describe, expect, it } from 'vitest';

import { recommendedOf } from './recommended';
import { cellOf, engine, rowOf } from './test-helpers';

const SCOPE = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

describe('recommendedOf', () => {
  it('averages the classified engines with equal weight, each prompt weighted', () => {
    const rows = [
      rowOf(
        engine('chatgpt_web', { valid: 4, recommended: cellOf(4, 4) }),
        engine('gemini_web', { valid: 10, recommended: cellOf(2, 10) }),
      ),
      rowOf(
        engine('chatgpt_web', { valid: 40, recommended: cellOf(0, 40) }),
        engine('google_ai_mode', { recommended: null }),
      ),
    ];
    const reading = recommendedOf(rows, SCOPE);
    expect(reading).toMatchObject({ state: 'ok', codes: ['chatgpt_web', 'gemini_web'], answers: 54 });
    // ChatGPT (100% + 0%) / 2 = 50%, Gemini 20%
    if (reading.state === 'ok') expect(reading.value).toBeCloseTo(0.35);
  });

  it('is unknown with a reason', () => {
    expect(recommendedOf([rowOf(engine('chatgpt_web'))], SCOPE)).toMatchObject({
      state: 'unknown',
      reason: 'not_collected',
    });
    expect(recommendedOf([rowOf(engine('google_ai_mode', { recommended: null }))], SCOPE)).toMatchObject({
      state: 'unknown',
      reason: 'not_classified',
    });
    expect(recommendedOf([rowOf(engine('chatgpt_web', { valid: 3, recommended: cellOf(1, 3) }))], SCOPE)).toMatchObject(
      { state: 'unknown', reason: 'too_few_answers', answers: 3 },
    );
  });
});
