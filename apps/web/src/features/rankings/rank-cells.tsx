'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { CellTip } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { RankCell, RankChange } from '@/lib/api/types';
import {
  formatDetailDateTime,
  formatInteger,
  formatRankCell,
  truncatePath,
  type ChangeDisplay,
  type RankDisplay,
  type UrlDisplay,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The cells of the rank columns (12-tables.md sections 6 and 7.3, 14-badges-status.md section 5). They only
 * lay out what `lib/format/rank-display.ts` decided and say it in the catalog's words. A cell shows its value
 * and nothing it cannot say to a screen reader: what the glyphs stand for is in hidden text, and the longer
 * explanation is the cell's tooltip (`useRankTips`), which the table puts on the focused cell.
 */

const ARROWS = { up: '↑', down: '↓' } as const;
const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground'),
} as const;
/** About what a mono path fits in the URL column's usual width; the cell clips what is left with an ellipsis. */
const PATH_CHARS = 30;

/** The rank: its number, `>20` for the depth that was checked, Pending, or a failed check. */
export function RankCellView({ display }: { display: RankDisplay }): ReactElement {
  const t = useTranslations('rankings.rank');
  switch (display.kind) {
    case 'ranked':
      return <span className="num text-foreground">{formatInteger(display.rank)}</span>;
    case 'beyond':
      return (
        <>
          <span aria-hidden="true" className="num text-foreground-tertiary">
            {formatRankCell({ rank: null, depth: display.depth })}
          </span>
          <span className="sr-only">{t('speech.beyond', { depth: display.depth })}</span>
        </>
      );
    case 'pending':
      return <span className="text-foreground-tertiary">{t('pending')}</span>;
    case 'failed':
      return <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />;
  }
}

/** The change: an arrow glyph and the places, New or Lost, or nothing visible when there is nothing to show. */
export function RankChangeView({ display }: { display: ChangeDisplay }): ReactElement {
  const t = useTranslations('rankings.rank');
  switch (display.kind) {
    case 'arrow':
      return (
        <>
          <span aria-hidden="true" className={cn('num', TONE[display.tone])}>
            {ARROWS[display.direction]}
            {formatInteger(display.amount)}
          </span>
          <span className="sr-only">
            {t(display.direction === 'up' ? 'speech.improved' : 'speech.declined', { count: display.amount })}
          </span>
        </>
      );
    case 'flat':
      return (
        <>
          <span aria-hidden="true" className={cn('num', TONE.neutral)}>
            {formatInteger(0)}
          </span>
          <span className="sr-only">{t('speech.noChange')}</span>
        </>
      );
    case 'new':
      return (
        <>
          <span aria-hidden="true" className={TONE.positive}>
            {t('new')}
          </span>
          <span className="sr-only">{t('speech.entered')}</span>
        </>
      );
    case 'lost':
      return (
        <>
          <span aria-hidden="true" className={TONE.negative}>
            {t('lost')}
          </span>
          <span className="sr-only">{t('speech.dropped')}</span>
        </>
      );
    case 'empty':
      return (
        <span className="sr-only">
          {t(display.reason === 'firstCheck' ? 'speech.firstCheck' : 'speech.stillBeyond')}
        </span>
      );
  }
}

/** The own URL that ranks: its path in mono, shortened in the middle, and `+1` when more of the project's URLs rank. */
export function RankingUrlView({ display }: { display: UrlDisplay }): ReactElement {
  const t = useTranslations('rankings.rank');
  switch (display.kind) {
    case 'url': {
      const shortened = truncatePath(display.path, PATH_CHARS);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block min-w-0 truncate type-mono text-foreground">
            {shortened === display.path ? (
              display.path
            ) : (
              <>
                <span aria-hidden="true">{shortened}</span>
                <span className="sr-only">{display.path}</span>
              </>
            )}
          </span>
          {display.extra > 0 ? (
            <>
              <span aria-hidden="true" className="shrink-0 num type-label">
                {`+${formatInteger(display.extra)}`}
              </span>
              <span className="sr-only">{t('moreUrls', { count: display.extra })}</span>
            </>
          ) : null}
        </span>
      );
    }
    case 'none':
      return <span className="text-foreground-tertiary">{t('notRanking')}</span>;
    case 'pending':
      return <span className="text-foreground-tertiary">{t('pending')}</span>;
  }
}

/** The marker of a keyword whose latest successful check is out of date (the API's `is_stale`). */
export function StaleMarker(): ReactElement {
  const t = useTranslations('rankings.rank');
  return (
    <Badge tone="warning" variant="text">
      {t('stale')}
    </Badge>
  );
}

export interface RankTips {
  /** The tooltip and description of the Rank cell. */
  rank: (display: RankDisplay) => CellTip | undefined;
  /** Where a rank moved from and to, for a change that has both ranks. */
  change: (change: RankChange, current: RankCell) => CellTip | undefined;
  /** The whole address and the check of a ranking URL, or why there is none yet. */
  url: (display: UrlDisplay, rank: RankDisplay) => CellTip | undefined;
  /** What the Stale marker of the Updated column means, with the last good check. */
  stale: (observedAt: string | null) => CellTip;
}

/**
 * The tooltips of the rank cells, in the project's time zone. A tip has a description only where the cell's
 * own text already says its first line (a change's words, a URL's path): the description is then the detail
 * alone, so a screen reader does not hear the line twice.
 */
export function useRankTips(timeZone: string): RankTips {
  const t = useTranslations('rankings.rank');
  return useMemo((): RankTips => {
    const date = (instant: string): string => formatDetailDateTime(instant, timeZone);
    const lastGood = (observedAt: string | null, stale: boolean): string | undefined =>
      stale && observedAt !== null ? t('lastGood', { date: date(observedAt) }) : undefined;
    const withDetail = (content: string, detail: string | undefined): CellTip =>
      detail === undefined ? { content } : { content, detail };
    const failed = (): CellTip => ({ content: t('failedTooltip') });
    const pending = (): CellTip => ({ content: t('pendingTooltip') });
    return {
      rank: (display) => {
        switch (display.kind) {
          case 'ranked':
            return withDetail(
              t('rankTip', { rank: formatInteger(display.rank), date: date(display.observedAt), depth: display.depth }),
              lastGood(display.observedAt, display.stale),
            );
          case 'beyond':
            return display.observedAt === null
              ? undefined
              : withDetail(
                  t('beyondTip', { depth: display.depth, date: date(display.observedAt) }),
                  lastGood(display.observedAt, display.stale),
                );
          case 'pending':
            return pending();
          case 'failed':
            return withDetail(t('failedTooltip'), lastGood(display.observedAt, display.stale));
        }
      },
      change: (change, current) => {
        if (change.label !== 'numeric' || change.value === null || change.value === 0) return undefined;
        if (change.previous_rank === null || current.rank === null) return undefined;
        const detail = t('fromTo', { from: formatInteger(change.previous_rank), to: formatInteger(current.rank) });
        const amount = Math.abs(change.value);
        return {
          content: t(change.value > 0 ? 'speech.improved' : 'speech.declined', { count: amount }),
          detail,
          description: detail,
        };
      },
      url: (display, rank) => {
        switch (display.kind) {
          case 'url': {
            if (rank.kind !== 'ranked') return { content: display.full };
            const detail = t('checked', { date: date(rank.observedAt) });
            return { content: display.full, detail, description: detail };
          }
          case 'pending':
            return rank.kind === 'failed' ? failed() : pending();
          case 'none':
            return undefined;
        }
      },
      stale: (observedAt) => withDetail(t('staleTooltip'), lastGood(observedAt, true)),
    };
  }, [t, timeZone]);
}
