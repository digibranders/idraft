'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { PreviousText } from './board-text';
import { measureSlots, type MeasureSlot } from './measures-model';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { TrendIcon } from '@/components/app/metric/trend-icon';
import type { CitationOverview } from '@/lib/citations/board-queries';

export interface MeasuresStripProps {
  /** `undefined` while the first read loads. */
  overview: CitationOverview | undefined;
  status: 'loading' | 'ready' | 'refetching';
  allPlatforms: boolean;
  ownDomain: string;
  previous: PreviousText;
}

const LABELS = ['citations', 'frequency', 'coverage', 'urls', 'domains', 'growth'] as const;
const GROUP_ID = LABELS[0];

function itemOf(slot: MeasureSlot): MetricStripItem {
  return {
    id: slot.id,
    label: slot.label,
    value: slot.value,
    unknown: slot.unknown ? { kind: 'not-applicable' } : null,
    tip: slot.hint,
    spoken: slot.spoken,
    detail: slot.delta?.tip,
    delta:
      slot.delta === null ? undefined : slot.delta.kind === 'points' ? (
        <TrendIcon input={slot.delta.input} spoken={slot.delta.spoken} />
      ) : (
        <span className="num text-foreground-secondary">{slot.delta.text}</span>
      ),
  };
}

/** The strip of the six measures (C 200 to 257): one line per slot, 2, 3 or 6 columns by its own width. */
export function MeasuresStrip({
  overview,
  status,
  allPlatforms,
  ownDomain,
  previous,
}: MeasuresStripProps): ReactElement {
  const t = useTranslations('citations');
  const items = useMemo((): readonly MetricStripItem[] => {
    if (overview === undefined) {
      return LABELS.map((id) => ({ id, label: t(`measures.${id}.label`), value: '' }));
    }
    return measureSlots({ overview, allPlatforms, ownDomain, previous }, t).map(itemOf);
  }, [overview, allPlatforms, ownDomain, previous, t]);
  return (
    <MetricStrip
      size="line"
      label={t('measures.label')}
      groups={[{ id: GROUP_ID, items }]}
      status={overview === undefined ? 'loading' : status}
    />
  );
}
