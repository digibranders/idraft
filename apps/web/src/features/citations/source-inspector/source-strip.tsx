'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { SourceFigures } from './source-model';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';

/** How the page's row is going: it is read after the citations name the domain, and may not be among the pages listed. */
export type SourceRowState = 'loading' | 'error' | 'missing' | 'ready';

export interface SourceStripProps {
  state: SourceRowState;
  /** `null` unless the state is `ready`. */
  figures: SourceFigures | null;
  /** The engines in scope, for the name of an engine the row does not list. */
  engineLabels: ReadonlyMap<string, string>;
  /** A read is on its way while figures are on screen: they stay as they are, and the strip says it is busy. */
  refetching: boolean;
  /** The names of the engines the page chose; none means the figures are of every engine. */
  engineNames: readonly string[];
}

const KEYS = ['units', 'share', 'answers', 'prompts', 'engines'] as const;

/**
 * The strip above the source inspector's tabs (WB-SRC-01): the citation units, the share of every unit in scope with
 * its count, the answers that cite the page, the prompts whose answers cite it and how many engines cite it. There
 * is no change beside any of them (the read has no period before it, and a zero in its place would be a lie). A
 * page that is not among the pages listed, or whose pages could not be read, has n/a in every place, with the reason
 * in a tooltip the keyboard reaches.
 */
export function SourceStrip({ state, figures, engineLabels, refetching, engineNames }: SourceStripProps): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const locale = useLocale();
  // Units and share are pooled over every engine in scope, so the context never leaves out which engines they are of
  const scope = {
    scope: engineNames.length === 0 ? 'all' : 'chosen',
    engines: formatList(engineNames, locale),
  };
  const labels: Record<(typeof KEYS)[number], string> = {
    units: t('units'),
    share: t('share'),
    answers: t('answers'),
    prompts: t('prompts'),
    engines: t('engines'),
  };

  let items: MetricStripItem[];
  if (figures === null) {
    const reason = state === 'missing' ? t('rowMissing') : state === 'error' ? t('totalsFailed') : null;
    items = KEYS.map((key) => ({
      id: key,
      label: labels[key],
      value: EMPTY_VALUE,
      ...(reason === null ? {} : { unknown: { kind: 'not-applicable' as const }, tip: reason }),
    }));
  } else {
    const unknownEngine = figures.engines.find((engine) => engine.units === null)?.code ?? '';
    items = [
      {
        id: 'units',
        label: labels.units,
        value: formatInteger(figures.units, { locale }),
        context: t('unitsContext', { total: figures.share.total, answers: figures.answersInScope, ...scope }),
      },
      {
        id: 'share',
        label: labels.share,
        value: figures.share.value === null ? EMPTY_VALUE : formatPercent(figures.share.value, { locale }),
        unknown: figures.share.value === null ? { kind: 'not-applicable' } : null,
        // The count is the visible context, so the percent is never alone
        context: t('shareContext', { units: figures.share.units, total: figures.share.total, ...scope }),
      },
      {
        id: 'answers',
        label: labels.answers,
        value: formatInteger(figures.answers, { locale }),
        context: t('answersContext', { answers: figures.answersInScope }),
      },
      {
        id: 'prompts',
        label: labels.prompts,
        value: formatInteger(figures.prompts, { locale }),
        context: t('promptsContext'),
      },
      figures.enginesCiting === null
        ? {
            id: 'engines',
            label: labels.engines,
            value: EMPTY_VALUE,
            unknown: { kind: 'not-applicable' },
            tip: t('engineUnknown', { engine: engineLabels.get(unknownEngine) ?? unknownEngine }),
          }
        : {
            id: 'engines',
            label: labels.engines,
            value: formatInteger(figures.enginesCiting, { locale }),
            context: t('enginesContext', { count: figures.enginesCiting, total: figures.engines.length }),
          },
    ];
  }
  const groups: readonly MetricStripGroup[] = [{ id: 'source', items }];
  return (
    <MetricStrip
      size="sm"
      label={t('stripLabel')}
      groups={groups}
      status={state === 'loading' ? 'loading' : refetching ? 'refetching' : 'ready'}
    />
  );
}
