'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { DomainFigures } from './domain-model';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';

export interface DomainStripProps {
  /** `null` while the read has nothing: the labels stay and the values are bars. */
  figures: DomainFigures | null;
  /** A read is on its way while figures are on screen: they stay as they are, and the strip says it is busy. */
  refetching: boolean;
  /** The names of the engines the page chose; none means the figures are of every engine. */
  engineNames: readonly string[];
}

/**
 * The strip above the domain inspector's tabs (WB-DOM-02): the citation units, the share of every unit in scope
 * with its count, the answers that cite the domain and the prompts whose answers cite it. There is no change
 * beside any of them: the detail has no period before it, and a zero in its place would be a lie. The answers
 * and prompts are n/a, with the reason, for a domain the API read in several roles.
 */
export function DomainStrip({ figures, refetching, engineNames }: DomainStripProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const locale = useLocale();
  // Units and share are pooled over every engine in scope, so the context never leaves out which engines they are of
  const scope = {
    scope: engineNames.length === 0 ? 'all' : 'chosen',
    engines: formatList(engineNames, locale),
  };
  const answersUnknown = t('answersUnknown');
  const countOrUnknown = (count: number | null): Pick<MetricStripItem, 'value' | 'unknown'> =>
    count === null
      ? { value: EMPTY_VALUE, unknown: { kind: 'not-applicable' } }
      : { value: formatInteger(count, { locale }) };

  const items: MetricStripItem[] = [
    {
      id: 'units',
      label: t('units'),
      value: figures === null ? EMPTY_VALUE : formatInteger(figures.units, { locale }),
      context:
        figures === null
          ? undefined
          : t('unitsContext', { total: figures.total, answers: figures.answersInScope, ...scope }),
    },
    {
      id: 'share',
      label: t('share'),
      value: figures?.share.value == null ? EMPTY_VALUE : formatPercent(figures.share.value, { locale }),
      unknown: figures?.share.value == null ? { kind: 'not-applicable' } : null,
      // The count is the visible context, so the percent is never alone
      context:
        figures === null
          ? undefined
          : t('shareContext', { units: figures.share.units, total: figures.share.total, ...scope }),
    },
    {
      id: 'answers',
      label: t('answers'),
      ...countOrUnknown(figures?.answers ?? null),
      context:
        figures === null
          ? undefined
          : figures.answers === null
            ? answersUnknown
            : t('answersContext', { answers: figures.answersInScope }),
      ...(figures !== null && figures.answers === null ? { tip: answersUnknown } : {}),
    },
    {
      id: 'prompts',
      label: t('prompts'),
      ...countOrUnknown(figures?.prompts ?? null),
      context: figures === null ? undefined : figures.prompts === null ? answersUnknown : t('promptsContext'),
      ...(figures !== null && figures.prompts === null ? { tip: answersUnknown } : {}),
    },
  ];
  const groups: readonly MetricStripGroup[] = [{ id: 'domain', items }];
  return (
    <MetricStrip
      size="sm"
      label={t('stripLabel')}
      groups={groups}
      status={figures === null ? 'loading' : refetching ? 'refetching' : 'ready'}
    />
  );
}
