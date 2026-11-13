'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useRateWords } from '../rate-view';
import { SENTENCE_BREAK } from '@/components/app/metric/delta';
import type { RateChange, Side } from '@/lib/compare/change-model';
import type { CellMetric } from '@/lib/rates/rate-model';
import type { RateReading } from '@/lib/rates/strip-model';

/** Why a cell has no change to draw while comparison is on; the key of `prompts.compare.change`. */
export type ChangeGap = 'noPrevious' | 'tooFew' | 'noEngineInBoth';

export interface ChangeTipOptions {
  /** `engine`: one engine of a row. `average`: the equal weight average over engines. `strip`: a chip over prompts. */
  kind: 'engine' | 'average' | 'strip';
  /** The compared window as `formatDateRange` writes it; `null` when the response names none. */
  range: string | null;
  /** The metric the change is of; share of voice has no test, which the tip says. Default Mentioned. */
  metric?: CellMetric | undefined;
  /** `average` only: the engines the average shown is over (with a rate now); defaults to the engines the change took. */
  shown?: number | undefined;
  /** `average` only: the label of the one engine a change of one of several is of, so the tip can name it. */
  engine?: string | undefined;
}

export interface ChangeWords {
  /**
   * The tooltip text of a change, in sentences with no full stop of their own: the previous value with its counts,
   * how many engines an average is over, the compared window, and what the test found. Empty for no change.
   */
  tip: (change: RateChange | null, options: ChangeTipOptions) => string;
  /** The previous value with its counts: "Previous 29%, 7 of 24 answers". Empty for no change. */
  label: (change: RateChange | null) => string;
  /** Why there is no change to draw: the cell has no previous period, or too few answers in one of them. */
  gap: (reason: ChangeGap) => string;
}

/** A side as the reading the rate words take. */
const readingOf = (side: Side): RateReading => ({
  state: 'ok',
  value: side.value,
  answers: side.answers,
  successes: side.successes,
  reason: null,
});

/**
 * The words of a change (WP-19), from one translator, so a loop builds its tips with pure functions. A change that
 * is coloured says "detectable"; every change that was tested says it is an interim test, and one without a test
 * (share of voice) says so instead of saying nothing.
 */
export function useChangeWords(): ChangeWords {
  const t = useTranslations('prompts.compare');
  const delta = useTranslations('common.delta');
  const words = useRateWords();
  return useMemo(() => {
    const label = (change: RateChange | null): string => {
      if (change === null) return '';
      const { before } = change;
      const rate = words.text(readingOf(before));
      const basis = words.basis(readingOf(before)) ?? '';
      return before.prompts === null
        ? t('tip.previous', { rate, basis })
        : t('tip.previousPrompts', { rate, basis, count: before.prompts });
    };
    const tip = (
      change: RateChange | null,
      { kind, range, metric = 'mentioned', shown, engine }: ChangeTipOptions,
    ): string => {
      if (change === null) return '';
      const sentences: string[] = [];
      // First what the figures are of: an average of engines, or the one engine that took part, so the points are never
      // read as the average's change
      if (kind === 'average' && change.engines > 1) {
        const inAverage = shown ?? change.engines;
        sentences.push(
          t('tip.averageTest', {
            count: change.engines,
            shown: inAverage,
            partial: inAverage > change.engines ? 'true' : 'false',
          }),
        );
      } else if (kind === 'average' && engine !== undefined && (shown ?? 1) > 1) {
        sentences.push(t('tip.onlyEngine', { engine }));
      }
      sentences.push(label(change));
      if (range !== null) {
        sentences.push(kind === 'strip' ? t('strip.previousLabel', { range }) : t('windowTip', { range }));
      }
      if (metric === 'share_of_voice') {
        sentences.push(t('change.shareNoTest'));
      } else if (change.detectable === true) {
        // The interim label below says unpaired once
        sentences.push(delta('detectableTip', { hasMethod: 'false', method: '' }));
      } else if (change.detectable === false) {
        sentences.push(delta('withinTip', { hasInterval: 'false', interval: '' }));
      } else {
        sentences.push(t('change.untested'));
      }
      if (metric !== 'share_of_voice' && change.detectable !== null) sentences.push(delta('interimTip'));
      return sentences.join(SENTENCE_BREAK);
    };
    const gaps: Record<ChangeGap, string> = {
      noPrevious: t('change.noPrevious'),
      tooFew: t('change.tooFew'),
      noEngineInBoth: t('change.noEngineInBoth'),
    };
    return { tip, label, gap: (reason) => gaps[reason] };
  }, [t, delta, words]);
}
