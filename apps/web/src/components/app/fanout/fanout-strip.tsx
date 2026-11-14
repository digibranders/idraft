'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import type { FanoutMeta } from '@/lib/fanout';
import { EMPTY_VALUE, formatInteger, formatPercent } from '@/lib/format';

export interface FanoutStripProps {
  /** The read's `meta`; `undefined` until the first read lands. */
  meta: Pick<FanoutMeta, 'answers' | 'answers_with_fanout'> | undefined;
  /** The queries the route counted at the minimum asked, not the rows on screen. */
  listed: number | undefined;
  /** The name of the one engine the counts are of: engines are never pooled. */
  engine: string;
  minSupport: number;
  status: 'loading' | 'ready' | 'refetching';
}

/**
 * The summary above a list of fan-out queries (docs/16 F1): how many of the answers issued at least one query, and
 * how many queries are listed. The percent never stands alone: its count is the context and the tip. The mean of
 * queries per answer is not here, because the route does not give the number of queries (it is in the prompt
 * summary). No value is coloured: nothing in it is a test of change.
 */
export function FanoutStrip({ meta, listed, engine, minSupport, status }: FanoutStripProps): ReactElement {
  const t = useTranslations('fanout.strip');
  const withFanout = ((): MetricStripItem => {
    const base = { id: 'with-fanout', label: t('withFanout') };
    if (meta === undefined) return { ...base, value: EMPTY_VALUE, unknown: { kind: 'pending' } };
    const { answers: n, answers_with_fanout: k } = meta;
    // No valid answer: a ratio of nothing, and the reason is said
    if (n <= 0) {
      return { ...base, value: EMPTY_VALUE, unknown: { kind: 'not-applicable' }, tip: t('noAnswers', { engine }) };
    }
    return {
      ...base,
      value: formatPercent(k / n),
      context: t('withFanoutContext', { k, n, engine }),
      tip: t('withFanoutTip', { k, n, engine }),
    };
  })();
  const queries: MetricStripItem =
    listed === undefined
      ? { id: 'listed', label: t('listed'), value: EMPTY_VALUE, unknown: { kind: 'pending' } }
      : {
          id: 'listed',
          label: t('listed'),
          value: formatInteger(listed),
          context: t('listedContext', { min: minSupport }),
        };
  const groups: readonly MetricStripGroup[] = [{ id: 'fanout', items: [withFanout, queries] }];
  return <MetricStrip size="sm" label={t('label')} groups={groups} status={status} />;
}
