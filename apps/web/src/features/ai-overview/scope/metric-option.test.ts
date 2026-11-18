import { describe, expect, it } from 'vitest';

import { metricOfOption, optionOfMetric } from './metric-option';
import { DEFAULT_METRIC, SCOPE_METRICS } from './scope-model';
import { cardType } from '@/lib/layouts/catalog';

describe('metric option and scope metric', () => {
  it('spells share of voice differently and nothing else', () => {
    expect(SCOPE_METRICS.map(optionOfMetric)).toEqual(['visibility', 'mention', 'citation', 'share_of_voice']);
  });

  it('round trips every scope metric', () => {
    for (const metric of SCOPE_METRICS) expect(metricOfOption(optionOfMetric(metric))).toBe(metric);
  });

  it('reads a value no metric stands for as the default', () => {
    expect(metricOfOption('sov')).toBe(DEFAULT_METRIC);
    expect(metricOfOption(undefined)).toBe(DEFAULT_METRIC);
    expect(metricOfOption('')).toBe(DEFAULT_METRIC);
  });

  it('maps every value of the catalog visibility metric option to a scope metric', () => {
    const values = cardType('ai.rate_trend_by_engine')?.options.metric?.values.map((entry) => entry.value);
    expect(values).toEqual(SCOPE_METRICS.map(optionOfMetric));
  });
});
