'use client';

import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement, type ReactNode } from 'react';

import { POOL_BELOW_PROMPTS } from './model-types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

export interface TopicFootnoteProps {
  /** Prompts that are in more than one topic; `null` while the prompt rows are not read. */
  overlapPrompts: number | null;
  /** A weekly point on the card is pooled over the weeks around it. */
  pooled: boolean;
  weighting: 'prompt' | 'answer';
  /** The card shows a change, so the test behind its colour is named. */
  compareTest?: boolean | undefined;
  /** The card's own sentences (the heat map's bins), after the fixed ones. */
  extra?: ReactNode;
}

/**
 * The footnote every topics card carries: topics overlap, how a rate is weighted, that a rate under 4 valid answers
 * is not shown as a percent, and, only where they apply, the pooling of weekly points and the test of a change.
 */
export function TopicFootnote({
  overlapPrompts,
  pooled,
  weighting,
  compareTest = false,
  extra,
}: TopicFootnoteProps): ReactElement {
  const t = useTranslations('aiOverview.topics.common');
  const sentences: ReactNode[] = [
    t('overlap'),
    overlapPrompts === null ? null : t('overlapCount', { count: overlapPrompts }),
    weighting === 'prompt' ? t('weighting.prompt') : t('weighting.answer'),
    t('smallSample', { min: MIN_OBSERVATIONS }),
    pooled ? t('pooled', { below: POOL_BELOW_PROMPTS }) : null,
    compareTest ? t('compareTestNote') : null,
    extra ?? null,
  ];
  return (
    <div>
      {sentences
        .filter((sentence) => sentence !== null)
        .map((sentence, index) => (
          // The list has a fixed order and is never reordered, so the position is the identity. The space after
          // each sentence keeps the text of the footnote (also in the PNG) readable as one paragraph.
          <Fragment key={index}>
            <span>{sentence}</span>{' '}
          </Fragment>
        ))}
    </div>
  );
}
