'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { RATE_METRICS, type RateMetric } from '@/features/prompts/prompt-model';
import { Select } from '@/components/ui/select';

/**
 * The metric of the engine columns, the heat map and the drawer's engine panel: Mention, Citation or Share of voice,
 * written to the address's `metric` by the caller. The Prompts tab draws the same choice inline in the screen; this is
 * the same control and the same words, for the views of the Topics tab.
 */
export function MetricSelect({
  value,
  onValueChange,
}: {
  value: RateMetric;
  onValueChange: (metric: RateMetric) => void;
}): ReactElement {
  const t = useTranslations('prompts');
  return (
    <div className="w-44">
      <Select<RateMetric>
        aria-label={t('metric.label')}
        size="sm"
        value={value}
        onValueChange={onValueChange}
        placeholder={t('metric.placeholder')}
        options={RATE_METRICS.map((metric) => ({ value: metric, label: t(`metric.${metric}`) }))}
      />
    </div>
  );
}
