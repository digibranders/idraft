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
    // Narrower on a phone, where the value is cut to an ellipsis; 176 px from 640 px as the Prompts tab has it
    <div className="w-32 min-w-0 sm:w-44">
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
