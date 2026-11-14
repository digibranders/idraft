import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { SPARK_TIP_POINTS, useSparklineTip, type SparkTipPoint } from './sparkline-tip';
import messages from '../../../../messages/en.json';

function Provider({ children }: { children: ReactNode }): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

const points = (count: number): SparkTipPoint[] =>
  Array.from({ length: count }, (_, index) => ({
    dateText: `Oct ${String(index + 1)}`,
    valueText: `${String(30 + index)}%`,
  }));

describe('useSparklineTip', () => {
  it('names the last 7 of 10 points, oldest first, under the title', () => {
    const { result } = renderHook(() => useSparklineTip(), { wrapper: Provider });
    expect(SPARK_TIP_POINTS).toBe(7);
    expect(result.current('Mention rate', points(10))).toEqual({
      content: 'Mention rate',
      detail: 'Oct 4: 33%, Oct 5: 34%, Oct 6: 35%, Oct 7: 36%, Oct 8: 37%, Oct 9: 38%, Oct 10: 39%',
    });
  });

  it('names all the points when there are fewer than 7', () => {
    const { result } = renderHook(() => useSparklineTip(), { wrapper: Provider });
    expect(result.current('Rank', points(2))).toEqual({ content: 'Rank', detail: 'Oct 1: 30%, Oct 2: 31%' });
  });

  it('gives no tip without points', () => {
    const { result } = renderHook(() => useSparklineTip(), { wrapper: Provider });
    expect(result.current('Mention rate', [])).toBeUndefined();
  });

  it('keeps the same function between renders, so a column definition built on it is stable', () => {
    const { result, rerender } = renderHook(() => useSparklineTip(), { wrapper: Provider });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
