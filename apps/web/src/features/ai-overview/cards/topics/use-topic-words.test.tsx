import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { EngineValue } from './engine-values';
import { useTopicWords } from './use-topic-words';
import messages from '../../../../../messages/en.json';

function Provider({ children }: { children: ReactNode }): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

const words = (): ReturnType<typeof useTopicWords> =>
  renderHook(() => useTopicWords(), { wrapper: Provider }).result.current;

const value = (over: Partial<EngineValue>): EngineValue => ({
  code: 'chatgpt_web',
  state: 'ok',
  value: 0.5,
  answers: 10,
  successes: 5,
  prompts: 3,
  observations: 12,
  reason: null,
  ...over,
});

describe('useTopicWords', () => {
  it('percent of null is n/a, never 0%', () => {
    const { percent } = words();
    expect(percent(null)).toBe('n/a');
    expect(percent(null)).not.toContain('0%');
    expect(percent(0.472)).toBe('47.2%');
  });

  it('a thin cell tip says the answers and no percent', () => {
    const tip = words().cellTip(value({ state: 'insufficient', value: null, answers: 3, successes: 1 }), true);
    expect(tip).toBe('3 answers, fewer than 4');
    expect(tip).not.toContain('%');
  });

  it('a cell with no valid answer says so and no percent', () => {
    const tip = words().cellTip(
      value({ state: 'none', value: null, answers: 0, successes: null, reason: 'noAnswers' }),
      true,
    );
    expect(tip).toBe('No answers');
  });

  it('a counted cell tip says k of n answers, the interval and the prompts', () => {
    const tip = words().cellTip(value({}), true);
    expect(tip).toBe(
      '50.0%, average of 3 prompts, each counting once. All answers pooled: 50.0%, 5 of 10 answers, 24% to 76%',
    );
  });

  it('a share of voice tip says x of y brand mentions', () => {
    const tip = words().cellTip(value({ value: 0.25, answers: 8, successes: 2, prompts: null }), false);
    expect(tip).toBe('25.0%, 2 of 8 brand mentions');
  });

  it('a share of voice tip never puts a prompt weighted percent beside the pooled counts', () => {
    const tip = words().cellTip(value({ value: 0.25, answers: 8, successes: 2, prompts: 2 }), false);
    expect(tip).toBe('25.0%, 2 of 8 brand mentions');
    expect(tip).not.toContain('prompt');
  });

  it('a share of voice cell without counts says why: not collected, or cut by the cap', () => {
    const none = { state: 'none' as const, value: null, answers: 0, successes: null, prompts: null };
    expect(words().cellTip(value({ ...none, reason: 'notCollected' }), false)).toBe('Not collected yet');
    expect(words().cellTip(value({ ...none, reason: 'capped' }), false)).toContain('More than 20 tracked brands');
    expect(words().cellTip(value({ state: 'insufficient', value: null, answers: 3, successes: 1 }), false)).toBe(
      '3 brand mentions, too few for a share',
    );
  });

  it('metric labels', () => {
    const { metricLabel } = words();
    expect(metricLabel('mention')).toBe('Mention rate');
    expect(metricLabel('citation')).toBe('Citation rate');
    expect(metricLabel('share_of_voice')).toBe('Share of voice');
  });

  it('says the window with its length for a meta line', () => {
    expect(words().window({ from: '2026-10-16', to: '2026-11-12', days: 28 })).toBe('Oct 16 to Nov 12, 2026, 28 days');
  });

  it('counts answers and prompts with their plural', () => {
    const { answers, prompts } = words();
    expect(answers(1)).toBe('1 answer');
    expect(answers(1234)).toBe('1,234 answers');
    expect(prompts(1)).toBe('1 prompt');
    expect(prompts(24)).toBe('24 prompts');
  });
});
