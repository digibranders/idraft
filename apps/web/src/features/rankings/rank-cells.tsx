'use client';

import { CircleAlert, CircleHelp, Clock, RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { CopyButton } from '@/components/app/cells/copy-button';
import type { CellTip } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import type { RankCell } from '@/lib/api/types';
import {
  formatDetailDateTime,
  formatInteger,
  webHref,
  type ChangeDisplay,
  type CheckMark,
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
 * What may make a rank look current when it is not, at any table width (the Updated column's own marker shows
 * only from 1680 px): a clock when the API flags the keyword stale, a warning when checks after the one shown
 * have failed. The glyphs are decoration; the words are hidden text, and the tooltip carries the detail.
 */
function Marks({
  stale,
  failing,
  observedAt,
  unconfirmed = false,
  check = 'none',
}: {
  stale: boolean;
  failing: boolean;
  observedAt?: string | null | undefined;
  /** One check missed a rank an earlier one had; a second check confirms it. */
  unconfirmed?: boolean;
  /** A check is on its way, or the latest one could not say whether the site is absent. */
  check?: CheckMark;
}): ReactElement {
  const t = useTranslations('rankings.rank');
  const tip = observedAt ? t('lastGood', { date: observedAt }) : t('staleTooltip');
  return (
    <>
      {check === 'pending' ? (
        <Tooltip content={t('checkingTooltip')} purpose="label">
          <span className="inline-flex items-center">
            <Icon icon={RefreshCw} size="xs" className="text-foreground-tertiary" />
            <span className="sr-only">{t('speech.checking')}</span>
          </span>
        </Tooltip>
      ) : null}
      {check === 'inconclusive' ? (
        <Tooltip content={t('inconclusiveTooltip')} purpose="label">
          <span className="inline-flex items-center">
            <Icon icon={CircleAlert} size="xs" className="text-warning-text" />
            <span className="sr-only">{t('speech.inconclusive')}</span>
          </span>
        </Tooltip>
      ) : null}
      {unconfirmed ? (
        <Tooltip content={t('unconfirmedTooltip')} purpose="label">
          <span className="inline-flex items-center">
            <Icon icon={CircleHelp} size="xs" className="text-foreground-tertiary" />
            <span className="sr-only">{t('speech.unconfirmed')}</span>
          </span>
        </Tooltip>
      ) : null}
      {stale ? (
        <Tooltip content={tip} purpose="label">
          <span className="inline-flex items-center">
            <Icon icon={Clock} size="xs" className="text-warning-text" />
            <span className="sr-only">{t('speech.stale')}</span>
          </span>
        </Tooltip>
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

/** The text of a keyword that is not ranked within the checked depth: a plain hyphen, never a dash character. */
export const NOT_RANKED_MARK = '-';
/** The rank's box: three digits wide, so the change slots line up across rows; the number ends next to the change. */
const RANK_BOX = 'inline-flex w-7 shrink-0 items-center justify-end text-right';

/**
 * The rank and its change in one cell, read as one unit: the rank number in a fixed-width box sized for three
 * digits (`w-7 shrink-0`, tabular numerals, right-aligned so the number ends where the change begins), then
 * a small gap (`gap-1.5`) and the change and marks. The box keeps the change slots aligned across rows.
 */
export function RankCellView({
  display,
  change,
  timeZone,
}: {
  display: RankDisplay;
  change?: ChangeDisplay | undefined;
  timeZone?: string | undefined;
}): ReactElement {
  const t = useTranslations('rankings.rank');
  const observedDate =
    display.kind !== 'pending' && display.observedAt
      ? timeZone
        ? formatDetailDateTime(display.observedAt, timeZone)
        : display.observedAt
      : null;

  const marks =
    display.kind === 'pending' ? null : (
      <Marks
        stale={display.stale}
        failing={display.kind === 'failed' ? false : display.failing}
        observedAt={observedDate}
        unconfirmed={display.kind === 'beyond' && display.unconfirmed}
        check={display.kind === 'failed' ? 'none' : display.check}
      />
    );
  const changeSlot = (
    <span className="inline-flex shrink-0 items-center gap-1 text-left num whitespace-nowrap">
      {marks}
      {change !== undefined ? <RankChangeView display={change} /> : null}
    </span>
  );

  switch (display.kind) {
    case 'ranked':
      return (
        <span className="flex items-center gap-1.5">
          <span className={RANK_BOX}>
            <span className="num text-foreground">{formatInteger(display.rank)}</span>
          </span>
          {changeSlot}
        </span>
      );
    case 'beyond':
      return (
        <span className="flex items-center gap-1.5">
          <span className={RANK_BOX}>
            <span aria-hidden="true" className="num text-foreground-tertiary">
              {NOT_RANKED_MARK}
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
        <span className="flex items-center gap-1.5">
          <span className={RANK_BOX}>
            <Icon icon={TriangleAlert} size="sm" label={t('failed')} className="text-warning-text" />
          </span>
          {changeSlot}
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
export function PathText({ path }: { path: string }): ReactElement {
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
  /** Why a hyphen stands in the Rank cell: the keyword is not in the top results of the depth that was checked. */
  notRanked: (display: RankDisplay) => CellTip | undefined;
  /** The whole address of a ranking URL, which the cell shortens; nothing when there is no URL. */
  url: (display: UrlDisplay) => CellTip | undefined;
  /** What the Stale marker of the Updated column means, with the last good check. */
  stale: (observedAt: string | null) => CellTip;
}

/**
 * The tooltips of the rank cells, in the project's time zone. A tooltip is only for what the cell cannot say
 * itself: a path that is cut short, and what a marker means. The rank, its change and its date are not repeated
 * in one; the markers carry their own words.
 */
export function useRankTips(timeZone: string): RankTips {
  const t = useTranslations('rankings.rank');
  return useMemo(
    (): RankTips => ({
      notRanked: (display) =>
        display.kind === 'beyond' ? { content: t('notInTop', { depth: display.depth }) } : undefined,
      url: (display) => (display.kind === 'url' ? { content: display.full } : undefined),
      stale: (observedAt) => ({
        content: t('staleTooltip'),
        ...(observedAt === null ? {} : { detail: t('lastGood', { date: formatDetailDateTime(observedAt, timeZone) }) }),
      }),
    }),
    [t, timeZone],
  );
}
