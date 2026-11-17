'use client';

import type { ReactElement, ReactNode } from 'react';

import type { BoardEngine } from '../board-reads';
import type { Owner } from '../board-state';
import { slotDay, type CitationsTranslate, type PreviousText } from '../board-text';
import { pageText } from './page-rows';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import type { BoardColumn } from '@/components/app/table/board-table';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { CitedPageRow } from '@/lib/citations/board-queries';
import { formatInteger, formatSignedInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PageColumnsContext {
  t: CitationsTranslate;
  owner: Owner;
  /** The engines in scope, in code order: every enabled one for All platforms, else the one. */
  engines: readonly BoardEngine[];
  previous: PreviousText;
  /** How many slots `window.trend` holds (8 for a project with eight runs). */
  trendSlots: number;
  timeZone: string;
  latest: string | null;
  /** Wraps a row's "+N" chip in its prompts popover (Task 8); the popover sets the chip's `aria-haspopup` and `aria-expanded`. */
  promptsPopover: (row: CitedPageRow, chip: ReactElement) => ReactNode;
}

const isOwn = (row: CitedPageRow): boolean => row.domain_role === 'own';
const competitorColor = (row: CitedPageRow): number | null =>
  row.domain_role === 'competitor' ? row.color_index : null;

function Identity({ row, t }: { row: CitedPageRow; t: CitationsTranslate }): ReactElement {
  const text = pageText(row);
  return (
    <>
      <span className="min-w-0 truncate text-foreground">
        {isOwn(row) ? (
          text.path
        ) : (
          <>
            <span className="text-foreground-tertiary">{text.host}</span>
            {text.path}
          </>
        )}
      </span>
      {row.previous_citations === 0 ? <Badge className="ml-2 align-middle">{t('pages.new')}</Badge> : null}
    </>
  );
}

function OwnerCell({ row, t }: { row: CitedPageRow; t: CitationsTranslate }): ReactElement {
  const label =
    row.domain_role === 'own'
      ? t('pages.yourSite')
      : row.domain_role === 'competitor'
        ? (row.entity_name ?? pageText(row).host)
        : t('pages.thirdParty');
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <EntitySwatch shape="dot" own={isOwn(row)} colorIndex={competitorColor(row)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function PromptsCell({ row, context }: { row: CitedPageRow; context: PageColumnsContext }): ReactElement {
  const { t } = context;
  const top = row.top_prompts[0];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-8 shrink-0 num text-foreground">{formatInteger(row.prompts)}</span>
      {top === undefined ? null : (
        <Tooltip content={t('pages.topPromptTip', { text: top.text, count: top.citations })} purpose="label">
          <span className="min-w-0 truncate text-foreground-secondary">{top.text}</span>
        </Tooltip>
      )}
      {context.promptsPopover(
        row,
        <button
          type="button"
          data-cell-action=""
          aria-label={t('pages.moreLabel', { path: row.path, count: row.prompts })}
          className={cn(
            badgeVariants({ variant: 'outline', tone: 'neutral' }),
            'num outline-none hover:bg-surface-hover hover:text-foreground focus-visible:focus-ring',
          )}
        >
          {row.prompts > 1 ? t('pages.more', { count: row.prompts - 1 }) : t('pages.details')}
        </button>,
      )}
    </span>
  );
}

function PlatformsCell({ row, context }: { row: CitedPageRow; context: PageColumnsContext }): ReactElement {
  return (
    <span className="flex items-center gap-3">
      {context.engines.map((engine) => {
        const count = row.engines.find((cell) => cell.engine_code === engine.code)?.citation_units ?? 0;
        return (
          <Tooltip
            key={engine.code}
            content={context.t('pages.platformTip', { engine: engine.label, count })}
            purpose="label"
          >
            <span className={cn('inline-flex items-center gap-1', count === 0 && 'opacity-40')}>
              <EngineLogo engine={engine.code} name={engine.label} nameDisplay="visually-hidden" />
              <span className="num text-foreground-secondary">{formatInteger(count)}</span>
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** The columns of Cited pages (C 459 to 472), as the owner and the platforms in scope choose them. */
export function pageColumns(context: PageColumnsContext): BoardColumn<CitedPageRow>[] {
  const { t, owner, engines, previous } = context;
  const columns: BoardColumn<CitedPageRow>[] = [
    {
      id: 'page',
      header: t('pages.columns.page'),
      width: 280,
      sortKey: 'page',
      cell: (row) => <Identity row={row} t={t} />,
    },
  ];
  if (owner !== 'own') {
    columns.push({
      id: 'owner',
      header: t('pages.columns.domainType'),
      width: 140,
      cell: (row) => <OwnerCell row={row} t={t} />,
    });
  }
  columns.push(
    {
      id: 'citations',
      header: t('pages.columns.citations'),
      tip: t('pages.columns.citationsTip'),
      width: 104,
      sortKey: 'citations',
      cellClassName: 'num text-foreground',
      cell: (row) => formatInteger(row.citations),
    },
    {
      id: 'change',
      header: t('pages.columns.change'),
      tip: t('pages.columns.changeTip', { previous: previous.full }),
      width: 88,
      sortKey: 'change',
      cellTip: (row) =>
        row.citations === row.previous_citations
          ? undefined
          : t('measures.countBefore', { count: formatInteger(row.previous_citations) }),
      cell: (row) =>
        row.citations === row.previous_citations ? (
          <span className="text-foreground-tertiary">{t('pages.noChange')}</span>
        ) : (
          <span className="num text-foreground-secondary">
            {formatSignedInteger(row.citations - row.previous_citations)}
          </span>
        ),
    },
    {
      id: 'prompts',
      header: t('pages.columns.prompts'),
      tip: t('pages.columns.promptsTip'),
      width: null,
      sortKey: 'prompts',
      cell: (row) => <PromptsCell row={row} context={context} />,
    },
    {
      id: 'platforms',
      header: t('pages.columns.platforms'),
      tip: t('pages.columns.platformsTip'),
      width: engines.length > 1 ? 196 : 112,
      cell: (row) => <PlatformsCell row={row} context={context} />,
    },
    {
      id: 'trend',
      header: t('pages.columns.trend'),
      tip:
        context.trendSlots >= 8
          ? t('pages.columns.trendTip')
          : t('pages.columns.trendTipShort', { count: context.trendSlots }),
      width: 104,
      cell: (row) => (
        <span className="block w-24">
          <SparklineCell
            values={row.trend}
            label={t('pages.trendLabel', { values: row.trend.map((value) => formatInteger(value)).join(', ') })}
            width={96}
            height={20}
            entity={{ own: isOwn(row), colorIndex: competitorColor(row) }}
            endDot={false}
          />
        </span>
      ),
    },
    {
      id: 'last',
      header: t('pages.columns.lastCited'),
      width: 104,
      sortKey: 'last',
      cellClassName: 'whitespace-nowrap text-foreground-secondary',
      cell: (row) => slotDay(row.last_cited_at, context.timeZone, context.latest),
    },
  );
  return columns;
}

/** The row button's name and tooltip (C 406 and 483): "Open <url>", "<title> (<url>)", and "Not cited in ..." for New. */
export function pageIdentity(
  row: CitedPageRow,
  t: CitationsTranslate,
  previous: PreviousText,
): { label: string; tip: { content: string; detail?: string | undefined } } {
  const url = pageText(row).display;
  return {
    label: t('pages.open', { url }),
    tip: {
      content: t('pages.pageTip', { title: row.title ?? url, url }),
      ...(row.previous_citations === 0 ? { detail: t('pages.newTip', { previous: previous.full }) } : {}),
    },
  };
}
