'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { OverviewAggregates } from '../../data/aggregates';
import { useCardDrill } from './use-card-seams';
import type { CardData } from './use-card-data';
import { useFrameState, type FrameState } from './use-frame-state';
import { LinkButton } from '@/components/ui/link-button';

/**
 * What the cards that count answers per engine (named and cited, the funnel, the coverage) share: a window with no
 * valid answer is an empty card that says why, and not a card of zeros (WP-34 plan section 3.6).
 */

/** The words of the empty state, from the card's own block of `aiOverview.engines`: the three cards use these keys. */
export type EmptyWords = (
  key:
    | 'emptyNoEnginesTitle'
    | 'emptyNoEnginesReason'
    | 'emptyNoPromptsTitle'
    | 'emptyNoPromptsReason'
    | 'emptyNoValidTitle'
    | 'emptyNoValidReason'
    | 'emptyNoAnswersReason',
  values?: { days: number } | { count: number },
) => string;

/** Whether any engine that is asked has a valid answer in the window. */
export const hasValidAnswers = (aggregates: OverviewAggregates | null): boolean =>
  aggregates?.engines.some((engine) => engine.asked && engine.validAnswers > 0) ?? false;

/** Answers collected on the asked engines that were not valid, and every answer collected. */
function collected(aggregates: OverviewAggregates | null): { notValid: number; all: number } {
  const asked = aggregates?.engines.filter((engine) => engine.asked) ?? [];
  const all = asked.reduce((total, engine) => total + engine.allAnswers, 0);
  return { all, notValid: all - asked.reduce((total, engine) => total + engine.validAnswers, 0) };
}

/**
 * The `ChartFrame` status props of a card of answers per engine. A window that read fine but holds no valid answer
 * on an asked engine is empty, with the reason first and "View runs" for a member who may see them.
 */
export function useAnswersFrame(data: CardData, name: string, words: EmptyWords): FrameState {
  const common = useTranslations('aiOverview.engines.common');
  const drill = useCardDrill();
  const runs = data.canViewRuns ? drill('runs') : null;
  const { notValid, all } = collected(data.aggregates);
  const phase = data.phase === 'ready' && !hasValidAnswers(data.aggregates) ? 'empty' : data.phase;
  const empty =
    data.asked.length === 0
      ? { title: words('emptyNoEnginesTitle'), reason: words('emptyNoEnginesReason') }
      : data.aggregates?.promptCount === 0
        ? { title: words('emptyNoPromptsTitle'), reason: words('emptyNoPromptsReason') }
        : {
            title: words('emptyNoValidTitle', { days: data.scope.range.days }),
            reason: all === 0 ? words('emptyNoAnswersReason') : words('emptyNoValidReason', { count: notValid }),
            action:
              runs === null ? undefined : (
                <LinkButton size="sm" render={<Link href={runs} />}>
                  {common('viewRuns')}
                </LinkButton>
              ),
          };
  return useFrameState({ ...data, phase }, { name, empty });
}
