import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useRateTipWords } from './use-rate-tip-words';
import messages from '../../../../messages/en.json';
import { MIN_OBSERVATIONS } from '@/lib/stats';

function Provider({ children }: { children: ReactNode }): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

describe('useRateTipWords', () => {
  it('reads the words from the catalog and the numbers from the house formats', () => {
    const { result } = renderHook(() => useRateTipWords(), { wrapper: Provider });
    const words = result.current;
    expect(words.value(0.34)).toBe('34.0%');
    expect(words.answers(612, 1800)).toBe('612 of 1,800 answers');
    expect(words.interval({ low: 0.28, high: 0.41 })).toBe('28% to 41%');
    expect(words.prompts(250)).toBe('250 prompts, each counts once');
    expect(words.prompts(1)).toBe('1 prompt, each counts once');
    expect(words.thin(3)).toBe(`3 answers, fewer than ${String(MIN_OBSERVATIONS)}`);
    expect(words.thin(1)).toBe(`1 answer, fewer than ${String(MIN_OBSERVATIONS)}`);
    expect(words.pooled(4)).toBe('pooled over 4 weeks');
    expect(words.noAnswers).toBe('No answers');
  });
});
