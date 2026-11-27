'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { countChange } from './cann-model';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import type { CannCount, CannConflictList, CannSwitchList } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

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
  /** The tooltip's sentences with this period's numbers in them, in place of the general ones. */
  live?: { what?: string; how?: string };
}

interface StripContext {
  t: Translate;
  days: number;
  hasPrevious: boolean;
}

function itemOf({ id, value, count, live }: Figure, { t, days, hasPrevious }: StripContext): MetricStripItem {
  const label = t(`${id}.label`);
  const hint = `${live?.what ?? t(`${id}.what`)} ${live?.how ?? t(`${id}.how`)}`;
  const shown = value ?? t('notKnown');
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
    const ofRanked = `${formatInteger(head.conflicts.value)} ${t('ofRanked', { ranked: formatInteger(head.ranked_keywords) })}`;
    return [
      {
        id: 'conflicts',
        value: formatInteger(head.conflicts.value),
        count: head.conflicts,
        live: { what: t('conflicts.whatLive', { ofRanked }) },
      },
      { id: 'likely', value: formatInteger(head.likely.value), count: head.likely },
      { id: 'together', value: formatInteger(head.together.value), count: head.together },
      { id: 'unstable', value: formatInteger(head.unstable.value), count: head.unstable },
      {
        id: 'volume',
        value: formatInteger(head.volume_at_risk),
        live: { what: t('volume.whatLive', { count: head.volume_keywords }) },
      },
      {
        id: 'gap',
        value: head.typical_rank_gap === null ? null : places,
        live: { how: t('gap.howLive', { count: head.volume_keywords, days }) },
      },
    ];
  }, [head, places, days, t]);
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
      {
        id: 'switches',
        value: formatInteger(head.switches.value),
        count: head.switches,
        live: { how: t('switches.howLive', { count: head.one_check_changes, days }) },
      },
      {
        id: 'switchedKeywords',
        value: formatInteger(head.keywords),
        live: {
          what: t('switchedKeywords.whatLive', {
            ofRanked: `${formatInteger(head.keywords)} ${t('ofRanked', { ranked: formatInteger(head.ranked_keywords) })}`,
          }),
        },
      },
      { id: 'flipFlops', value: formatInteger(head.flip_flop_keywords) },
      { id: 'leftTarget', value: formatInteger(head.left_target) },
      { id: 'improved', value: formatInteger(head.improved) },
      { id: 'dropped', value: formatInteger(head.dropped) },
    ];
  }, [head, days, t]);
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
