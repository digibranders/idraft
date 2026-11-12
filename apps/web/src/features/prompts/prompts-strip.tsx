'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useRateWords } from './rate-view';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import type { ProjectEngine } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { engineRates, type RateFigure, type StripPrompt } from '@/lib/rates/strip-model';

export interface PromptsStripProps {
  /** The prompts in scope: those the Prompts tab lists after the filters. */
  prompts: readonly StripPrompt[];
  /** The engines shown, in the order of the table's columns. */
  engines: readonly ProjectEngine[];
  /** How many topics the prompts span; `null` while the summary cannot tell. */
  topics: number | null;
  status: 'loading' | 'ready' | 'refetching';
  /** The counts could not be read: the Prompts chip stands alone, and the page's banner says why. */
  countsFailed: boolean;
}

/**
 * The chips of the page's toolbar (ADR-DS-022 decision 12): Prompts with its count, and one chip per engine with
 * its prompt weighted Mention rate. The chip's tooltip, a tab stop, holds what does not fit the toolbar: the topics
 * the prompts span, and for an engine the Mentioned, Cited and Share of voice counts. A rate over fewer than
 * `MIN_OBSERVATIONS` valid answers shows the answers instead (parity spec D-1), and a rate that does not exist
 * reads "n/a" with its reason.
 */
export function PromptsStrip({ prompts, engines, topics, status, countsFailed }: PromptsStripProps): ReactElement {
  const t = useTranslations('prompts.strip');
  const words = useRateWords();

  /** One rate in the tooltip: the counts behind it, or why there is none. */
  const detailOf = (figure: RateFigure, ofBrandNamed = false): string => {
    const basis = words.basis(figure);
    if (basis === null) return t('tipReason', { reason: figure.reason ?? 'noAnswers' });
    const counted = ofBrandNamed ? t('tipShareBasis', { basis }) : basis;
    return figure.state === 'insufficient' ? t('tipInsufficient', { basis: counted }) : counted;
  };

  const items: MetricStripItem[] = [
    {
      id: 'prompts',
      label: t('prompts'),
      value: formatInteger(prompts.length),
      tip: topics === null ? undefined : t('topicsSpanned', { count: topics }),
    },
  ];
  if (!countsFailed) {
    for (const engine of engines) {
      const code = engine.engine.engine_code;
      const { mentioned, cited, shareOfVoice } = engineRates(prompts, code);
      const parts = {
        mentioned: t('tipRate', { metric: t('tipMentioned'), detail: detailOf(mentioned) }),
        cited: t('tipRate', { metric: t('tipCited'), detail: detailOf(cited) }),
        shareOfVoice: t('tipRate', { metric: t('tipShareOfVoice'), detail: detailOf(shareOfVoice, true) }),
      };
      items.push({
        id: code,
        label: engine.engine.label,
        value: words.text(mentioned),
        unknown:
          mentioned.state === 'ok'
            ? null
            : { kind: mentioned.state === 'insufficient' ? 'insufficient' : 'not-applicable' },
        tip:
          mentioned.prompts === 0
            ? t('tipNoPrompts', parts)
            : t('tip', { ...parts, prompts: t('tipPrompts', { count: mentioned.prompts }) }),
      });
    }
  }
  const groups: readonly MetricStripGroup[] = [{ id: 'ai', items }];
  return <MetricStrip size="inline" nowrap label={t('label')} groups={groups} status={status} />;
}
