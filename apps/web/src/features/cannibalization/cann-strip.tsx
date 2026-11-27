'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { countChange } from './cann-model';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import type { CannCount, CannConflictList, CannSwitchList } from '@/lib/api/types';
import { EMPTY_VALUE, formatInteger } from '@/lib/format';

type Translate = ReturnType<typeof useTranslations<'cannibalization.measures'>>;

type MeasureKey =
  | 'conflicts'
  | 'likely'
  | 'together'
  | 'unstable'
  | 'volume'
  | 'gap'
  | 'switches'
  | 'switchedKeywords'
  | 'flipFlops'
  | 'leftTarget'
  | 'improved'
  | 'dropped';

interface Figure {
  id: MeasureKey;
  /** `null`: the figure is not a number (no keyword to take a median of). */
  value: string | null;
  count?: CannCount;
}

interface StripContext {
  t: Translate;
  days: number;
  hasPrevious: boolean;
}

function itemOf({ id, value, count }: Figure, { t, days, hasPrevious }: StripContext): MetricStripItem {
  const label = t(`${id}.label`);
  const hint = `${t(`${id}.what`)} ${t(`${id}.how`)}`;
  const shown = value ?? EMPTY_VALUE;
  const change = count === undefined ? null : countChange(count, hasPrevious);
  return {
    id,
    label,
    value: shown,
    unknown: value === null ? { kind: 'not-applicable' } : null,
    tip: hint,
    spoken: t('aria', { label, value: change === null ? shown : `${shown}, ${change.text}`, hint }),
    detail: change === null ? undefined : t('change', { before: formatInteger(change.before), days }),
    delta: change === null ? undefined : <span className="num text-foreground-secondary">{change.text}</span>,
  };
}

function useItems(
  figures: readonly Figure[] | null,
  context: StripContext,
  ids: readonly MeasureKey[],
): MetricStripItem[] {
  const { t, days, hasPrevious } = context;
  return useMemo(
    () =>
      figures === null
        ? ids.map((id) => ({ id, label: t(`${id}.label`), value: '' }))
        : figures.map((figure) => itemOf(figure, { t, days, hasPrevious })),
    [figures, t, days, hasPrevious, ids],
  );
}

const CONFLICT_IDS = [
  'conflicts',
  'likely',
  'together',
  'unstable',
  'volume',
  'gap',
] as const satisfies readonly MeasureKey[];
const CONFLICT_GROUP = CONFLICT_IDS[0];
const SWITCH_IDS = [
  'switches',
  'switchedKeywords',
  'flipFlops',
  'leftTarget',
  'improved',
  'dropped',
] as const satisfies readonly MeasureKey[];
const SWITCH_GROUP = SWITCH_IDS[0];

export interface ConflictStripProps {
  list: CannConflictList | undefined;
  status: 'loading' | 'ready' | 'refetching';
  days: number;
}

/** The six figures of the Cannibalization tab, with the change against the previous period when the API has one. */
export function ConflictStrip({ list, status, days }: ConflictStripProps): ReactElement {
  const t = useTranslations('cannibalization.measures');
  const head = list?.headline;
  const places = t('places', { count: Math.round(head?.typical_rank_gap ?? 0) });
  const figures = useMemo((): Figure[] | null => {
    if (head === undefined) return null;
    return [
      { id: 'conflicts', value: formatInteger(head.conflicts.value), count: head.conflicts },
      { id: 'likely', value: formatInteger(head.likely.value), count: head.likely },
      { id: 'together', value: formatInteger(head.together.value), count: head.together },
      { id: 'unstable', value: formatInteger(head.unstable.value), count: head.unstable },
      { id: 'volume', value: formatInteger(head.volume_at_risk) },
      { id: 'gap', value: head.typical_rank_gap === null ? null : places },
    ];
  }, [head, places]);
  const items = useItems(figures, { t, days, hasPrevious: list?.meta.has_previous ?? false }, CONFLICT_IDS);
  return (
    <MetricStrip
      size="line"
      label={t('label')}
      groups={[{ id: CONFLICT_GROUP, items }]}
      status={head === undefined ? 'loading' : status}
    />
  );
}

export interface SwitchStripProps {
  list: CannSwitchList | undefined;
  status: 'loading' | 'ready' | 'refetching';
  days: number;
}

/** The six figures of the Switching tab. */
export function SwitchStrip({ list, status, days }: SwitchStripProps): ReactElement {
  const t = useTranslations('cannibalization.measures');
  const head = list?.headline;
  const figures = useMemo((): Figure[] | null => {
    if (head === undefined) return null;
    return [
      { id: 'switches', value: formatInteger(head.switches.value), count: head.switches },
      { id: 'switchedKeywords', value: formatInteger(head.keywords) },
      { id: 'flipFlops', value: formatInteger(head.flip_flop_keywords) },
      { id: 'leftTarget', value: formatInteger(head.left_target) },
      { id: 'improved', value: formatInteger(head.improved) },
      { id: 'dropped', value: formatInteger(head.dropped) },
    ];
  }, [head]);
  const items = useItems(figures, { t, days, hasPrevious: list?.meta.has_previous ?? false }, SWITCH_IDS);
  return (
    <MetricStrip
      size="line"
      label={t('label')}
      groups={[{ id: SWITCH_GROUP, items }]}
      status={head === undefined ? 'loading' : status}
    />
  );
}
