import type { useTranslations } from 'next-intl';
import { createElement } from 'react';

import type { CitationRead } from './citation-reads';
import type { CitationScope } from './citation-scope';
import { Delta } from '@/components/app/metric/delta';
import { MetricInfo } from '@/components/app/metric/metric-info';
import type { MetricStripItem } from '@/components/app/metric/metric-strip';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import { ownShare } from '@/lib/citations/share-model';
import type { EngineCode, SourceChangePage, SourceDiversity, SourceDomainPage } from '@/lib/citations/types';
import { EMPTY_VALUE, formatDecimal, formatInteger, formatList, formatPercent } from '@/lib/format';

/**
 * The six figures of the Citations strip (DS 9.7), from the reads. Each figure comes from its own read and fails
 * alone: a read that failed is n/a with the reason, one on its way is pending. The strip is of the whole scope, so
 * no figure takes the role filter. Pure: reads in, items out, apart from the elements the items hold.
 */

export interface StripReads {
  /** `meta` of the scope: answers, units, units of each role and engine. */
  scope: CitationRead<SourceDomainPage>;
  /** The period before; no data while the comparison is off or that period has no answers. */
  previous: CitationRead<SourceDomainPage>;
  diversity: CitationRead<SourceDiversity>;
  newSources: CitationRead<SourceChangePage>;
  lostSources: CitationRead<SourceChangePage>;
}

/** The translator of `citations.strip`, as `useTranslations('citations.strip')` and `createTranslator` give it. */
export type StripTranslate = ReturnType<typeof useTranslations<'citations.strip'>>;

export interface StripWords {
  t: StripTranslate;
  /** The name of an engine by its code. */
  labelOf: (code: EngineCode) => string;
}

/** One figure that cannot be shown: n/a, in the tertiary colour, and why (a failed read, or none to tell). */
const unavailable = (id: string, label: string, reason: string): MetricStripItem => ({
  id,
  label,
  value: EMPTY_VALUE,
  unknown: { kind: 'not-applicable' },
  tip: reason,
});

/** One figure whose read is on its way. */
const waiting = (id: string, label: string): MetricStripItem => ({
  id,
  label,
  value: EMPTY_VALUE,
  unknown: { kind: 'pending' },
});

/** The read's data, or the item that stands in for it: failed (n/a with its reason) or on its way (pending). */
function dataOf<TPage>(
  read: CitationRead<TPage>,
  id: string,
  label: string,
  t: StripTranslate,
): { data: TPage; none: null } | { data: null; none: MetricStripItem } {
  if (read.data !== undefined) return { data: read.data, none: null };
  return { data: null, none: read.status === 'error' ? unavailable(id, label, t('unavailable')) : waiting(id, label) };
}

function unitsItem(reads: StripReads, scope: CitationScope, { t, labelOf }: StripWords): MetricStripItem {
  const label = t('units');
  const { data, none } = dataOf(reads.scope, 'units', label, t);
  if (data === null) return none;
  const { meta } = data;
  return {
    id: 'units',
    label,
    value: formatInteger(meta.citation_units),
    // Engines are never pooled silently: a chosen few are named, and only no choice says all of them
    context:
      scope.engines.length === 0
        ? t('unitsContext', { answers: meta.answers })
        : t('unitsContextEngines', { answers: meta.answers, engines: formatList(scope.engines.map(labelOf)) }),
  };
}

function distinctItem(reads: StripReads, { t }: StripWords): MetricStripItem {
  const label = t('distinct');
  const { data, none } = dataOf(reads.diversity, 'distinct', label, t);
  if (data === null) return none;
  return {
    id: 'distinct',
    label,
    value: formatInteger(data.meta.distinct_domains),
    context: t('distinctContext'),
  };
}

function effectiveItem(reads: StripReads, { t, labelOf }: StripWords): MetricStripItem {
  const label = t('effective');
  const { data, none } = dataOf(reads.diversity, 'effective', label, t);
  if (data === null) return none;
  const average = data.meta.effective_sources_engine_average;
  const counted = data.data.filter((engine) => engine.effective_sources.value !== null);
  if (average === null || counted.length === 0) return unavailable('effective', label, t('effectiveNone'));
  return {
    id: 'effective',
    label,
    labelAddon: createElement(MetricInfo, {
      name: t('effectiveInfoName'),
      definition: t('effectiveInfoDefinition'),
      formula: t('effectiveInfoFormula'),
      methodologyHref: METHODOLOGY_HREF,
    }),
    value: formatDecimal(average, 1),
    context: t('effectiveContext', { count: counted.length }),
    // Each engine alone with its units: the average never pools them
    tip: t('effectiveTip', {
      engines: formatList(
        data.data.map((engine) =>
          t('effectiveEngine', {
            engine: labelOf(engine.engine_code),
            value: formatDecimal(engine.effective_sources.value, 1),
            units: engine.citation_units,
          }),
        ),
      ),
    }),
  };
}

function ownShareItem(reads: StripReads, scope: CitationScope, { t }: StripWords): MetricStripItem {
  const label = t('ownShare');
  const { data, none } = dataOf(reads.scope, 'own-share', label, t);
  if (data === null) return none;
  // From `meta`, which the role filter never narrows
  const now = ownShare(data.meta);
  if (now.value === null) return unavailable('own-share', label, t('noUnits'));
  const before = reads.previous.data === undefined ? null : ownShare(reads.previous.data.meta);
  const base = {
    id: 'own-share',
    label,
    value: formatPercent(now.value),
    context: t('ownContext', { units: now.units, total: now.total }),
  };
  const counts = { units: now.units, total: now.total };
  // With the comparison off there is no change, whatever a read of the period before still holds
  if (!scope.compare) return { ...base, tip: t('ownTip', counts) };
  if (reads.previous.status === 'error') return { ...base, tip: t('ownTipPreviousFailed', counts) };
  if (before === null || before.value === null || (data.meta.previous_answers ?? 0) === 0) {
    return { ...base, tip: t('ownTip', counts) };
  }
  return {
    ...base,
    // No test of detectability exists for a share of sources, so the change is never coloured
    delta: createElement(Delta, {
      input: { value: now.value - before.value, unit: 'points', polarity: 'neutral', isDetectable: null },
      tip: false,
    }),
    tip: t('ownTipCompared', {
      units: now.units,
      total: now.total,
      share: formatPercent(before.value),
      previousUnits: before.units,
      previousTotal: before.total,
    }),
  };
}

function changeItem(
  reads: StripReads,
  read: CitationRead<SourceChangePage>,
  kind: 'new' | 'lost',
  { t }: StripWords,
): MetricStripItem {
  const label = t(kind);
  const { data, none } = dataOf(read, kind, label, t);
  if (data === null) return none;
  // A period before with no answers makes every cited domain "new": the count says nothing, so it is n/a (D4)
  const scope = dataOf(reads.scope, kind, label, t);
  if (scope.data === null) return scope.none;
  if ((scope.data.meta.previous_answers ?? 0) === 0) {
    return unavailable(kind, label, t(kind === 'new' ? 'newNoPrevious' : 'lostNoPrevious'));
  }
  return {
    id: kind,
    label,
    value: formatInteger(data.page.total),
    context: kind === 'new' ? t('newContext', { min: data.meta.min_support }) : t('lostContext'),
  };
}

/** The six items in the order of DS 9.7. */
export function stripItems(reads: StripReads, scope: CitationScope, words: StripWords): MetricStripItem[] {
  return [
    unitsItem(reads, scope, words),
    distinctItem(reads, words),
    effectiveItem(reads, words),
    ownShareItem(reads, scope, words),
    changeItem(reads, reads.newSources, 'new', words),
    changeItem(reads, reads.lostSources, 'lost', words),
  ];
}

/** Loading until the scope read arrives; refetching while any read is on its way again; ready otherwise. */
export function stripStatus(reads: StripReads): 'loading' | 'ready' | 'refetching' {
  if (reads.scope.status === 'loading') return 'loading';
  return Object.values(reads).some((read: CitationRead<unknown>) => read.retrying) ? 'refetching' : 'ready';
}
