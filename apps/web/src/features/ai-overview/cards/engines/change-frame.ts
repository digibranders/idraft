'use client';

import type { CardData } from './use-card-data';
import { useFrameState, type FrameState } from './use-frame-state';
import { comparisonWindow } from '../../data/overview-queries';
import type { ChartEmpty } from '@/components/app/chart/chart-frame';
import type { EngineCode } from '@/lib/api/types';
import { ENGINES } from '@/lib/layouts/catalog';

/** The Engine option of the catalog: ChatGPT unless the layout names another engine of the catalog. */
export const engineOption = (value: string | undefined): EngineCode =>
  ENGINES.find((engine) => engine.code === value)?.code ?? 'chatgpt_web';

/**
 * What the three cards that compare two windows (movers, period comparison, what moved the rate) share: when the
 * comparison is off, or the window before has no answer, the card is an empty one that says so and says what to do
 * (WP-34 plan section 3.6), and never a card of changes made up from one window.
 */

/** The words of the empty states, from the card's own block of `aiOverview.engines`: the three cards use these keys. */
export type ChangeWords = (
  key:
    | 'emptyNoEngineTitle'
    | 'emptyNoEngineReason'
    | 'emptyNoPromptsTitle'
    | 'emptyNoPromptsReason'
    | 'emptyOffTitle'
    | 'emptyOffReason'
    | 'emptyNoPreviousTitle'
    | 'emptyNoPreviousReason',
  values?: { days: number },
) => string;

/** What only the card can tell: its own empty state, or that its engine has nothing in the window before. */
export type OwnEmpty = ChartEmpty | 'noPrevious' | null;

/**
 * The `ChartFrame` status props of a card made of a comparison. The reasons come in this order: no engine asked,
 * no prompt, the comparison off, no answer in the window before, then the card's own (`own`).
 */
export function useChangeFrame(data: CardData, name: string, words: ChangeWords, own: OwnEmpty): FrameState {
  const { scope, aggregates } = data;
  const reasons: Readonly<Record<'noEngine' | 'noPrompts' | 'off' | 'noPrevious', ChartEmpty>> = {
    noEngine: { title: words('emptyNoEngineTitle'), reason: words('emptyNoEngineReason') },
    noPrompts: { title: words('emptyNoPromptsTitle'), reason: words('emptyNoPromptsReason') },
    off: { title: words('emptyOffTitle'), reason: words('emptyOffReason') },
    noPrevious: {
      title: words('emptyNoPreviousTitle', { days: scope.range.days }),
      reason: words('emptyNoPreviousReason'),
    },
  };
  const empty =
    data.asked.length === 0
      ? reasons.noEngine
      : aggregates?.promptCount === 0
        ? reasons.noPrompts
        : comparisonWindow(scope) === null
          ? reasons.off
          : aggregates?.previousAnswers === 0 || own === 'noPrevious' || own === null
            ? reasons.noPrevious
            : own;
  // Only data that was read can be judged empty: while a read runs the card keeps its phase
  const bare = own !== null || aggregates?.previousAnswers === 0;
  const phase = data.phase === 'ready' && bare ? 'empty' : data.phase;
  return useFrameState({ ...data, phase }, { name, empty });
}
