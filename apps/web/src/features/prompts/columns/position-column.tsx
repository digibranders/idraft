import type { ReactElement } from 'react';

import { POSITION_MIN_LISTS, positionOf, type FactsRow, type LinkedKeywordVolume } from '../facts';
import { SORT_ID } from '../prompt-model';
import {
  absenceOf,
  HatchedPill,
  Missing,
  notCollected,
  platformLabel,
  platformList,
  tipOf,
  unanswered,
} from './metric-shared';
import type { MetricContext, UnknownCell } from './metric-shared';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE, formatDecimal } from '@/lib/format';

/** The preview's Mention position column: 120 px. */
const POSITION_WIDTH = 120;

/** What a row gives the column: its facts and, for Google AI Overview, the keyword it is linked to. */
export interface PositionRows<TRow> {
  /** The facts of the row; `undefined` while they are not read. */
  facts: (row: TRow) => FactsRow | undefined;
  link: (row: TRow) => LinkedKeywordVolume | null | undefined;
}

/**
 * Mention position: each platform's own mean over its ordered answers (the place of the brand among the tracked brands a
 * valid answer names, and a platform needs `POSITION_MIN_LISTS` such answers), then the equal-weight average of the platforms that
 * have one, one decimal, 1 is first. It sorts lowest first. A figure too thin to show is the bare count of ordered
 * answers on the hatched ground; one that is not there says why and sorts last (R6).
 */
export function positionColumn<TRow>(context: MetricContext, rows: PositionRows<TRow>): DataTableColumn<TRow> {
  const { t, scope } = context;
  const readingOf = (row: TRow): ReturnType<typeof positionOf> | null => {
    const facts = rows.facts(row);
    if (facts === undefined) return null;
    // Read, and no platform in view has an answer for the row: that is an absence, not a fact the backend lacks
    if (unanswered(facts, scope))
      return { state: 'unknown', reason: 'unobserved', mentions: 0, ordered_answers: 0, answers: 0 };
    return positionOf([facts], scope);
  };
  const unknownOf = (row: TRow, reading: ReturnType<typeof positionOf> | null): UnknownCell => {
    if (reading === null || (reading.state === 'unknown' && reading.reason === 'not_collected')) {
      return notCollected(context);
    }
    const absence = absenceOf(context, rows.link(row));
    if (reading.state === 'unknown') {
      if (reading.reason === 'unobserved') return { label: absence.label, tip: absence.sentence };
      if (reading.reason === 'too_few_answers') {
        return {
          label: EMPTY_VALUE,
          tip: t('prompts.metrics.position.tooFewAnswersTip', { answers: reading.answers }),
        };
      }
      if (reading.reason === 'never_named') {
        return { label: EMPTY_VALUE, tip: t('prompts.metrics.position.neverNamedTip', { answers: reading.answers }) };
      }
    }
    return { label: EMPTY_VALUE, tip: absence.sentence };
  };
  const base = col.rank<TRow>(
    SORT_ID.position,
    (row) => {
      const reading = readingOf(row);
      return reading?.state === 'ok' ? reading.value : null;
    },
    {
      header: t('prompts.metrics.position.header'),
      headerTooltip: t('prompts.metrics.position.tip'),
      priority: 2,
      width: POSITION_WIDTH,
      // The preview's 120 px, which the header "MENTION POS..." fills: the table must not squeeze it further
      minWidth: POSITION_WIDTH,
      cell: (row): ReactElement => {
        const reading = readingOf(row);
        if (reading?.state === 'ok')
          return <span className="num whitespace-nowrap">{formatDecimal(reading.value, 1)}</span>;
        if (reading?.state === 'unknown' && reading.reason === 'too_few_lists') {
          // The number alone: the tooltip says it counts ordered answers, and a bare count reads cleaner in a column of positions
          return <HatchedPill>{reading.ordered_answers}</HatchedPill>;
        }
        return <Missing label={unknownOf(row, reading).label} />;
      },
      cellTip: (row): CellTip | undefined => {
        const reading = readingOf(row);
        if (reading?.state === 'ok') {
          const counts = { lists: reading.ordered_answers, mentions: reading.mentions };
          const [only] = reading.codes;
          return {
            content:
              reading.used > 1 || only === undefined
                ? t('prompts.metrics.position.averageTip', {
                    platforms: platformList(context, reading.codes),
                    ...counts,
                  })
                : t('prompts.metrics.position.onlyTip', { platform: platformLabel(context, only), ...counts }),
          };
        }
        if (reading?.state === 'unknown' && reading.reason === 'too_few_lists') {
          return {
            content: t('prompts.metrics.position.tooFewListsTip', {
              min: POSITION_MIN_LISTS,
              mentions: reading.mentions,
              lists: reading.ordered_answers,
            }),
          };
        }
        return tipOf(unknownOf(row, reading));
      },
    },
  );
  return base;
}
