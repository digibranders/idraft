'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useRateWords } from './rate-view';
import { engineRates, type RateFigure, type StripPrompt } from './strip-model';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import type { ProjectEngine } from '@/lib/api/types';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { formatInteger } from '@/lib/format';

export interface PromptsStripProps {
  /** The prompts in scope: those the Prompts tab lists after the filters. */
  prompts: readonly StripPrompt[];
  /** The engines shown, in the order of the table's columns. */
  engines: readonly ProjectEngine[];
  /** How many topics the prompts span; `null` while the summary cannot tell. */
  topics: number | null;
  status: 'loading' | 'ready' | 'refetching';
  /** The counts could not be read: the Prompts card stands alone, and the page's banner says why. */
  countsFailed: boolean;
}

/**
 * The strip under the page header (ADR-DS-022 decision 12): a Prompts card and one card per engine. An engine
 * card shows its prompt weighted Mention rate, the other headline rates on the line below, and the counts behind
 * all three in its tooltip. A rate over fewer than `MIN_OBSERVATIONS` valid answers shows the answers instead
 * (parity spec D-1), and a rate that does not exist reads "n/a" with its reason.
 */
export function PromptsStrip({ prompts, engines, topics, status, countsFailed }: PromptsStripProps): ReactElement {
  const t = useTranslations('prompts.strip');
  const separator = useTranslations('inspector')('separator');
  const words = useRateWords();
  // "Share of voice" is written out from a strip as wide as 1,280 px; under it the three rates would not fit
  const wide = useMediaQuery(MEDIA.xl);

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
      context: topics === null ? null : t('topicsSpanned', { count: topics }),
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
        label: t('engineRate', { engine: engine.engine.label }),
        value: words.text(mentioned),
        unknown:
          mentioned.state === 'ok'
            ? null
            : { kind: mentioned.state === 'insufficient' ? 'insufficient' : 'not-applicable' },
        context:
          mentioned.state === 'none'
            ? words.reason(mentioned)
            : t('line', {
                cited: words.text(cited),
                separator,
                name: t(wide ? 'shareOfVoice' : 'shareOfVoiceShort'),
                shareOfVoice: words.text(shareOfVoice),
              }),
        tip:
          mentioned.prompts === 0
            ? t('tipNoPrompts', parts)
            : t('tip', { ...parts, prompts: t('tipPrompts', { count: mentioned.prompts }) }),
      });
    }
  }
  const groups: readonly MetricStripGroup[] = [{ id: 'ai', items }];
  return <MetricStrip size="md" label={t('label')} groups={groups} status={status} />;
}
