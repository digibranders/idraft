'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Popover } from '@/components/ui/popover';
import { TextLink } from '@/components/ui/text-link';
import { formatInteger } from '@/lib/format';

export interface MetricInfoProps {
  /** "Mention rate". The trigger reads "About Mention rate". */
  name: string;
  /** One sentence. */
  definition: string;
  /** In words: "Answers that name the brand divided by valid answers". */
  formula: string;
  /** The sample of the current view: "250 prompts, 1,800 valid answers". */
  denominatorText?: string | undefined;
  aggregation?: 'prompt_weighted' | 'observation_weighted' | undefined;
  methodVersion?: number | undefined;
  /** AI rates only. Closes the popover, then calls back. */
  onOpenStatistics?: (() => void) | undefined;
  /** The in-app methodology page of the metric. Always the last line. */
  methodologyHref: string;
}

/**
 * The (i) button and its popover (23-application-patterns.md section 8.1, 22 section 10). The popover explains
 * what the metric means, in a fixed order, and never repeats the value's numbers: those stay in the value tooltip.
 */
export function MetricInfo({
  name,
  definition,
  formula,
  denominatorText,
  aggregation,
  methodVersion,
  onOpenStatistics,
  methodologyHref,
}: MetricInfoProps): ReactElement {
  const t = useTranslations('common.metricInfo');
  const [open, setOpen] = useState(false);
  return (
    <Popover
      trigger={<IconButton icon={Info} size="icon-xs" label={t('trigger', { name })} />}
      title={name}
      padding="text"
      width="max"
      open={open}
      onOpenChange={setOpen}
    >
      <p className="type-body text-foreground">{definition}</p>
      <p className="type-body text-foreground-secondary">{t('formula', { formula })}</p>
      {denominatorText === undefined ? null : (
        <p className="type-body text-foreground-secondary">{t('sample', { text: denominatorText })}</p>
      )}
      {aggregation === undefined ? null : (
        <p className="type-body text-foreground-secondary">
          {aggregation === 'prompt_weighted' ? t('promptWeighted') : t('observationWeighted')}
        </p>
      )}
      {methodVersion === undefined ? null : (
        <p className="type-meta">{t('methodVersion', { version: formatInteger(methodVersion) })}</p>
      )}
      {onOpenStatistics === undefined ? null : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            setOpen(false);
            onOpenStatistics();
          }}
        >
          {t('openStatistics')}
        </Button>
      )}
      <TextLink href={methodologyHref} className="self-start type-body">
        {t('methodology')}
      </TextLink>
    </Popover>
  );
}
