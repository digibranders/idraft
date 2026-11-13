'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useTopicDrawer } from './drawer-context';
import { compareEngines, type Comparison } from '@/features/prompts/topics-by-engine/comparison';
import type { EngineValue } from '@/features/prompts/topics-by-engine/engine-values';
import { formatDecimal, formatList, formatPercent } from '@/lib/format';
import type { CellMetric } from '@/lib/rates/rate-model';

/** The message of what the test of a gap found: a key of `prompts.topicDrawer.compare`. */
const TEST_SENTENCE = {
  within: 'within',
  detectable: 'detectable',
  'too-few': 'noTest',
  share: 'noTestShare',
} as const satisfies Record<Extract<Comparison, { kind: 'gap' }>['test'], string>;

/** The rates of a sentence carry one decimal, so the gap it names is the difference of the two it shows. */
const rateText = (ratio: number): string => formatPercent(ratio, { decimals: 1 });

/**
 * What can be said of the gap between the engines of the topic (WB-TPE-11), in words from counts only: the best and
 * the weakest with their rates and the gap in points, whether the difference is told from normal variation (an unpaired
 * test on the pooled answers; none for share of voice or when an engine has too few answers), and the engines left out.
 * An engine without a rate is named as left out and is never written as 0. `values` are in the order the engines are shown.
 */
export function ComparisonLine({
  values,
  metric,
}: {
  values: readonly EngineValue[];
  metric: CellMetric;
}): ReactElement {
  const t = useTranslations('prompts.topicDrawer.compare');
  const locale = useLocale();
  const { engines } = useTopicDrawer();
  const sentences = useMemo((): string[] => {
    const labelOf = (code: string): string =>
      engines.find((entry) => entry.engine.engine_code === code)?.engine.label ?? code;
    const comparison = compareEngines(values, metric);
    const lines: string[] = [];
    if (comparison.kind === 'gap') {
      const { best, worst } = comparison;
      lines.push(
        t('gap', {
          best: labelOf(best.code),
          bestRate: rateText(best.value ?? 0),
          worst: labelOf(worst.code),
          worstRate: rateText(worst.value ?? 0),
          points: formatDecimal(comparison.points, 1, { locale }),
        }),
        t(TEST_SENTENCE[comparison.test]),
      );
    } else if (comparison.kind === 'equal') {
      lines.push(t('equal', { rate: rateText(comparison.value) }));
    } else {
      lines.push(t(comparison.kind));
    }
    if (comparison.leftOut.length > 0) {
      lines.push(t('leftOut', { engines: formatList(comparison.leftOut.map(labelOf), locale) }));
    }
    return lines;
  }, [values, metric, engines, t, locale]);
  return (
    <div className="flex flex-col gap-1 type-body">
      {sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}
