'use client';

import { Clock, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { CopyButton } from '@/components/app/cells/copy-button';
import type { CellTip } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import type { RankCell, RankChange } from '@/lib/api/types';
import {
  formatDetailDateTime,
  formatInteger,
  formatRankCell,
  webHref,
  type ChangeDisplay,
  type RankDisplay,
  type UrlDisplay,
} from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
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
/** The words, under `rankings.rank.speech`, for a change that shows nothing. */
const EMPTY_SPEECH = {
  firstCheck: 'speech.firstCheck',
  stillBeyond: 'speech.stillBeyond',
  withinDepth: 'speech.withinDepth',
} as const satisfies Record<Extract<ChangeDisplay, { kind: 'empty' }>['reason'], string>;
/** The last characters of a path that always stay in view: the last segment of a usual path, or most of it. */
export const PATH_END_CHARS = 12;

/**
 * The cell's content, left aligned: marks, if any, then the value, 2 px apart (icon to counter). A cell that
 * has both marks and a three digit rank is a little wider than the narrowest Rank column: the extra grows to
 * the right, into the padding of the cell beside it.
 */

/**
 * What may make a rank look current when it is not, at any table width (the Updated column's own marker shows
 * only from 1680 px): a clock when the API flags the keyword stale, a warning when checks after the one shown
 * have failed. The glyphs are decoration; the words are hidden text, and the tooltip carries the detail.
 */
function Marks({ stale, failing }: { stale: boolean; failing: boolean }): ReactElement {
  const t = useTranslations('rankings.rank');
  return (
    <>
      {stale ? (
        <>
          <Icon icon={Clock} size="xs" className="text-warning-text" />
          <span className="sr-only">{t('speech.stale')}</span>
        </>
      ) : null}
      {failing ? (
        <>
          <Icon icon={TriangleAlert} size="xs" className="text-warning-text" />
          <span className="sr-only">{t('speech.lastCheckFailed')}</span>
        </>
      ) : null}
    </>
  );
}

/**
 * The rank and its change in one cell: the rank number in a fixed-width box (~32 px, `w-8 shrink-0`),
 * then the change in a fixed-width slot (`w-12 shrink-0`) to its right.
 */
export function RankCellView({
  display,
  change,
}: {
  display: RankDisplay;
  change?: ChangeDisplay | undefined;
}): ReactElement {
  const t = useTranslations('rankings.rank');
  const changeSlot =
    change !== undefined ? (
      <span className="inline-flex w-12 shrink-0 items-center gap-0.5 text-left num whitespace-nowrap">
        <RankChangeView display={change} />
      </span>
    ) : null;

  switch (display.kind) {
    case 'ranked':
      return (
        <span className="flex items-center gap-2">
          <span className="inline-flex w-8 shrink-0 items-center gap-0.5">
            <Marks stale={display.stale} failing={display.failing} />
            <span className="num text-foreground">{formatInteger(display.rank)}</span>
          </span>
          {changeSlot}
        </span>
      );
    case 'beyond':
      return (
        <span className="flex items-center gap-2">
          <span className="inline-flex w-8 shrink-0 items-center gap-0.5">
            <Marks stale={display.stale} failing={display.failing} />
            <span aria-hidden="true" className="num text-foreground-tertiary">
              {formatRankCell({ rank: null, depth: display.depth })}
            </span>
            <span className="sr-only">{t('speech.beyond', { depth: display.depth })}</span>
          </span>
          {changeSlot}
        </span>
      );
    case 'pending':
      return (
        <span className="flex items-center gap-2">
          <span className="type-meta text-foreground-tertiary">{t('pending')}</span>
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <Marks stale={display.stale} failing={false} />
            <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />
          </span>
          {changeSlot !== null ? <span aria-hidden="true" className="w-12 shrink-0" /> : null}
        </span>
      );
  }
}

/** The best rank: a number, or the same word for what is not one as the other rank columns use. */
export function BestRankView({ best, state }: { best: number | null; state: RankCell['state'] }): ReactElement {
  const t = useTranslations('rankings.rank');
  if (best !== null) return <span className="num text-foreground">{formatInteger(best)}</span>;
  const word = state === 'not_checked' ? 'pending' : state === 'failed' ? 'unavailable' : 'notRanking';
  return <span className="text-foreground-tertiary">{t(word)}</span>;
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
      return <span className="sr-only">{t(EMPTY_SPEECH[display.reason])}</span>;
    case 'blank':
      return <></>;
  }
}

/**
 * A path in the cell's width without ever cutting its end: the end tells one URL from another, so it keeps
 * its room (`shrink-0`) and the start gives way to an ellipsis. The width is the browser's to know, so the
 * shortening is CSS and nothing here counts characters of the column. A screen reader gets the whole path.
 */
function PathText({ path }: { path: string }): ReactElement {
  const letters = [...path];
  if (letters.length <= PATH_END_CHARS) {
    return (
      <span data-truncate="" className="block min-w-0 truncate">
        {path}
      </span>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="flex min-w-0">
        <span data-truncate="" className="min-w-0 truncate">
          {letters.slice(0, -PATH_END_CHARS).join('')}
        </span>
        <span className="shrink-0">{letters.slice(-PATH_END_CHARS).join('')}</span>
      </span>
      <span className="sr-only">{path}</span>
    </>
  );
}

/**
 * The own URL that ranks: its path in mono with its end in view, a link to the whole address in a new tab
 * (in the link color, underlined on hover and focus; `nofollow` as for any link out of search data), and `+1`
 * beside it, outside the link, when more of the project's URLs rank. A copy button follows (it copies the
 * whole address as the API sent it). It lies over the end of the cell on hover and focus, as in the Keyword
 * cell, so the narrow column gives the path all its width; beside a `+1` it has a place of its own instead,
 * so the marker is never covered. The link and the button are out of the tab order and marked for the grid,
 * which reaches them with F2; their clicks stay with them, so the row does not open. An address that is not
 * http or https is the path as text, never a link.
 */
export function RankingUrlView({ display }: { display: UrlDisplay }): ReactElement {
  const t = useTranslations('rankings.rank');
  switch (display.kind) {
    case 'url': {
      const href = webHref(display.full);
      const marked = display.extra > 0;
      return (
        // `relative` and `bg-inherit` hold the copy button when it lies over the end of the cell
        <span className="relative flex min-w-0 items-center gap-1.5 bg-inherit">
          <span className="block min-w-0 font-mono text-foreground">
            {href === null ? (
              <PathText path={display.path} />
            ) : (
              <TextLink
                {...CELL_CONTROL}
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={t('openUrl', { path: display.path })}
                // The row around the cell opens its record on a click; a click on the link is the link's own
                onClick={(event) => event.stopPropagation()}
                onAuxClick={(event) => event.stopPropagation()}
                className="block"
              >
                <PathText path={display.path} />
              </TextLink>
            )}
          </span>
          {marked ? (
            <>
              <span aria-hidden="true" className="shrink-0 num type-label">
                {`+${formatInteger(display.extra)}`}
              </span>
              <span className="sr-only">{t('moreUrls', { count: display.extra })}</span>
            </>
          ) : null}
          <CopyButton
            // The column's width is tight, so the button takes none of it unless a `+N` is there to keep in view
            placement={marked ? 'inline' : 'overlay'}
            text={display.full}
            label={t('copyUrl')}
            announcement={t('urlCopied')}
          />
        </span>
      );
    }
    case 'none':
      return <span className="text-foreground-tertiary">{t('notRanking')}</span>;
    case 'pending':
      return <span className="text-foreground-tertiary">{t('pending')}</span>;
    case 'failed':
      return <span className="text-foreground-tertiary">{t('unavailable')}</span>;
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
  /**
   * The tooltip and description of the Rank cell: where and when it was checked, the rank before it when there
   * is one, and what is wrong with it (stale, or the checks after it failed).
   */
  rank: (
    display: RankDisplay,
    previousRankOrChange?: number | null | RankChange,
    current?: RankCell,
  ) => CellTip | undefined;
  /** Where a rank moved from and to, for a change that has both ranks. */
  change: (change: RankChange, current: RankCell) => CellTip | undefined;
  /** The whole address and the check of a ranking URL, or why there is none yet. */
  url: (display: UrlDisplay, rank: RankDisplay) => CellTip | undefined;
  /** Why Best rank has no number yet or after a failed check; nothing for a keyword that was checked. */
  best: (state: RankCell['state']) => CellTip | undefined;
  /** What the Stale marker of the Updated column means, with the last good check. */
  stale: (observedAt: string | null) => CellTip;
}

/**
 * The tooltips of the rank cells, in the project's time zone. A tip has a description only where the cell's
 * own text already says its first line (a change's words, a `>20` that is spoken as "not in top 20"): the
 * description is then the rest of the tooltip, so a screen reader does not hear the line twice.
 */
export function useRankTips(timeZone: string): RankTips {
  const t = useTranslations('rankings.rank');
  return useMemo((): RankTips => {
    const date = (instant: string): string => formatDetailDateTime(instant, timeZone);
    const lastGood = (observedAt: string | null, stale: boolean): string | undefined =>
      stale && observedAt !== null ? t('lastGood', { date: date(observedAt) }) : undefined;
    const previous = (rank: number | null): string | undefined =>
      rank === null ? undefined : t('previousRank', { rank: formatInteger(rank) });
    /** Sentences, each ending in its own full stop, as one line. */
    const joined = (parts: readonly (string | undefined)[]): string | undefined => {
      const found = parts.filter((part): part is string => part !== undefined);
      return found.length === 0 ? undefined : found.join(' ');
    };
    const withDetail = (content: string, detail: string | undefined): CellTip =>
      detail === undefined ? { content } : { content, detail };
    const failed = (): CellTip => ({ content: t('failedTooltip') });
    const pending = (): CellTip => ({ content: t('pendingTooltip') });

    const changeTipOf = (change: RankChange, current: RankCell): CellTip | undefined => {
      if (change.label !== 'numeric' || change.value === null || change.value === 0) return undefined;
      if (change.previous_rank === null || current.rank === null) return undefined;
      const detail = t('fromTo', { from: formatInteger(change.previous_rank), to: formatInteger(current.rank) });
      const amount = Math.abs(change.value);
      return {
        content: t(change.value > 0 ? 'changeTip.improved' : 'changeTip.declined', { count: amount }),
        detail,
        description: detail,
      };
    };

    return {
      rank: (display, previousRankOrChange = null, current) => {
        const isChangeObj =
          typeof previousRankOrChange === 'object' && previousRankOrChange !== null && 'label' in previousRankOrChange;
        const previousRank = isChangeObj ? previousRankOrChange.previous_rank : previousRankOrChange;
        const changeObj = isChangeObj ? previousRankOrChange : undefined;

        let baseTip: CellTip | undefined;
        switch (display.kind) {
          case 'ranked':
            baseTip = withDetail(
              t('rankTip', { rank: formatInteger(display.rank), date: date(display.observedAt), depth: display.depth }),
              joined([
                previous(previousRank),
                lastGood(display.observedAt, display.stale),
                display.failing ? t('failedTooltip') : undefined,
              ]),
            );
            break;
          case 'beyond': {
            if (display.observedAt === null) {
              baseTip = undefined;
              break;
            }
            const rest = [
              previous(previousRank),
              lastGood(display.observedAt, display.stale),
              display.failing ? t('failedTooltip') : undefined,
            ];
            // The cell says "not in top 20" itself: what the screen reader hears after it is the rest
            const description = joined([t('checked', { date: date(display.observedAt) }), ...rest]);
            baseTip = {
              ...withDetail(t('beyondTip', { depth: display.depth, date: date(display.observedAt) }), joined(rest)),
              ...(description === undefined ? {} : { description }),
            };
            break;
          }
          case 'pending':
            baseTip = pending();
            break;
          case 'failed':
            baseTip = withDetail(t('failedTooltip'), lastGood(display.observedAt, display.stale));
            break;
        }

        if (changeObj && current) {
          const cTip = changeTipOf(changeObj, current);
          if (cTip) {
            if (!baseTip) return cTip;
            const content = `${baseTip.content}. ${cTip.content}.`;
            const detail = [baseTip.detail, cTip.detail].filter(Boolean).join(' ');
            return {
              content,
              ...(detail ? { detail } : {}),
            };
          }
        }
        return baseTip;
      },
      change: changeTipOf,
      best: (state) => (state === 'failed' ? failed() : state === 'not_checked' ? pending() : undefined),
      url: (display, rank) => {
        switch (display.kind) {
          case 'url': {
            if (rank.kind !== 'ranked') return { content: display.full };
            const detail = t('checked', { date: date(rank.observedAt) });
            return { content: display.full, detail, description: detail };
          }
          case 'pending':
            return pending();
          case 'failed':
            return failed();
          case 'none':
            return undefined;
        }
      },
      stale: (observedAt) => withDetail(t('staleTooltip'), lastGood(observedAt, true)),
    };
  }, [t, timeZone]);
}
