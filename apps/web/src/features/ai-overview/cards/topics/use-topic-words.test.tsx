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
    expect(tip).toBe('50.0%, 5 of 10 answers, 24% to 76%, 3 prompts, each counts once');
  });

  it('a share of voice tip says answers that name a brand', () => {
    const tip = words().cellTip(value({ value: 0.25, answers: 8, successes: null, prompts: null }), false);
    expect(tip).toBe('25.0%, 8 valid answers name a tracked brand');
    expect(tip).not.toContain(' of ');
  });

  it('a share of voice tip with prompts says them once', () => {
    const tip = words().cellTip(value({ value: 0.25, answers: 1, successes: null, prompts: 2 }), false);
    expect(tip).toBe('25.0%, 1 valid answer names a tracked brand, 2 prompts, each counts once');
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
