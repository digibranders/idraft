import type { ReactElement } from 'react';

import { SENTIMENT_KEYS, SENTIMENT_MIN, sentimentOf, type FactsRow, type LinkedKeywordVolume } from '../facts';
import type { SentimentKey } from '../facts';
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
import { EMPTY_VALUE, formatPercent } from '@/lib/format';

/** The preview's Sentiment column: 168 px. */
const SENTIMENT_WIDTH = 168;

/** The chart token of each share's segment, in the order the bar draws them. */
const SEGMENT_TOKEN: Readonly<Record<SentimentKey, string>> = {
  positive: 'chart-positive',
  neutral: 'chart-bar-neutral',
  negative: 'chart-negative',
  mixed: 'chart-other',
};

export interface SentimentRows<TRow> {
  /** The facts of the row; `undefined` while they are not read. */
  facts: (row: TRow) => FactsRow | undefined;
  link: (row: TRow) => LinkedKeywordVolume | null | undefined;
}

const percent = (share: number): string => formatPercent(share, { decimals: 0 });

/**
 * Sentiment: the tone of the answers that name the brand, as four shares (positive, neutral, negative, mixed) and never
 * one score. The cell shows the positive share and the four as a bar; each classifying platform has its own shares and
 * the figure is the equal-weight average of those with `SENTIMENT_MIN` classified mentions. It sorts by the positive
 * share, largest first, the rows without shares last.
 */
export function sentimentColumn<TRow>(context: MetricContext, rows: SentimentRows<TRow>): DataTableColumn<TRow> {
  const { t, scope } = context;
  const readingOf = (row: TRow): ReturnType<typeof sentimentOf> | null => {
    const facts = rows.facts(row);
    if (facts === undefined) return null;
    // Read, and no platform in view has an answer for the row: that is an absence, not a fact the backend lacks
    if (unanswered(facts, scope)) return { state: 'unobserved', shares: null, codes: [], mentions: 0, answers: 0 };
    return sentimentOf([facts], scope);
  };
  const unknownOf = (row: TRow, reading: ReturnType<typeof sentimentOf> | null): UnknownCell => {
    if (reading === null || reading.state === 'not_collected') return notCollected(context);
    if (reading.state === 'none') return { label: EMPTY_VALUE, tip: t('prompts.metrics.sentiment.noneTip') };
    const { label, sentence } = absenceOf(context, rows.link(row));
    return { label, tip: sentence };
  };
  const base = col.volumeTrend<TRow>(SORT_ID.sentiment, (row) => readingOf(row)?.shares?.positive ?? null, {
    header: t('prompts.metrics.sentiment.header'),
    headerTooltip: t('prompts.metrics.sentiment.tip'),
    priority: 3,
    width: SENTIMENT_WIDTH,
    minWidth: SENTIMENT_WIDTH,
    // The cell is drawn below, for it has the thin state too
    known: () => null,
  });
  return {
    ...base,
    cell: (row): ReactElement => {
      const reading = readingOf(row);
      if (reading?.state === 'insufficient') {
        return <HatchedPill>{t('prompts.metrics.sentiment.pill', { count: reading.mentions })}</HatchedPill>;
      }
      if (reading?.state !== 'ok' || reading.shares === null) return <Missing label={unknownOf(row, reading).label} />;
      const { shares } = reading;
      return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="num">{percent(shares.positive)}</span>
          <span className="type-label text-foreground-tertiary">{t('prompts.metrics.sentiment.positive')}</span>
          <span aria-hidden="true" className="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-neutral-subtle">
            {SENTIMENT_KEYS.filter((key) => shares[key] > 0).map((key) => (
              <span
                key={key}
                className="h-full"
                style={{ width: `${shares[key] * 100}%`, background: `var(--${SEGMENT_TOKEN[key]})` }}
              />
            ))}
          </span>
        </span>
      );
    },
    cellTip: (row): CellTip => {
      const reading = readingOf(row);
      if (reading?.state === 'insufficient') {
        return {
          content: t('prompts.metrics.sentiment.insufficientTip', {
            mentions: reading.mentions,
            answers: reading.answers,
            min: SENTIMENT_MIN,
          }),
        };
      }
      if (reading?.state !== 'ok' || reading.shares === null) return tipOf(unknownOf(row, reading));
      const { shares, codes } = reading;
      const [only] = codes;
      return {
        content: t('prompts.metrics.sentiment.cellTip', {
          shares: t('prompts.metrics.sentiment.shares', {
            positive: percent(shares.positive),
            neutral: percent(shares.neutral),
            negative: percent(shares.negative),
            mixed: percent(shares.mixed),
          }),
          basis:
            codes.length > 1 || only === undefined
              ? t('prompts.metrics.sentiment.averageBasis', { platforms: platformList(context, codes) })
              : t('prompts.metrics.sentiment.onlyBasis', {
                  platform: platformLabel(context, only),
                  mentions: reading.mentions,
                }),
        }),
      };
    },
  };
}
