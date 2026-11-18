'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import type { BoardEngine, BoardRead, TrackedCompetitor } from '../board-reads';
import { BoardPanel } from '../board-panel';
import { updatedText } from '../board-text';
import { GapMark } from './gap-mark';
import { GAP_SORT_DEFAULT, lostTip, markLines, sortGapRows, visibleGapRows } from './gap-model';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { BoardTable, BoardTableSkeleton, type BoardColumn, type BoardSort } from '@/components/app/table/board-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { CitationGapList, CitationGapRow } from '@/lib/citations/board-queries';
import { formatInteger } from '@/lib/format';

export interface GapsTabProps {
  read: BoardRead<CitationGapList>;
  /** The selected competitors, in the tracked order: one column each. */
  competitors: readonly TrackedCompetitor[];
  /** The read of the tracked competitors: "Choose competitors" shows only once it has loaded. */
  competitorsRead: BoardRead<unknown>;
  ownName: string;
  engines: readonly BoardEngine[];
  gapsOnly: boolean;
  search: string;
  onGapsOnlyChange: (gapsOnly: boolean) => void;
  onSearchChange: (search: string) => void;
  onResetScope: () => void;
  /** Opens the competitors popover (C 681). */
  onChooseCompetitors: () => void;
  tabs: ReactNode;
  scopeText: string;
  timeZone: string;
  activeId: string | null;
  onOpen: (row: CitationGapRow, opener: HTMLElement | null) => void;
  /** The rows in the table's order, for the drawer's J and K and "i of n". */
  onOrderChange: (ids: readonly string[]) => void;
}

/** Gap analysis (C 573 to 686): you against up to five tracked competitors, per prompt; the gap is per engine. */
export function GapsTab(props: GapsTabProps): ReactElement {
  const t = useTranslations('citations');
  const { read, competitors, competitorsRead, engines, gapsOnly, search, onOrderChange } = props;
  const [sort, setSort] = useState<BoardSort>(GAP_SORT_DEFAULT);
  const rows = useMemo(() => read.data?.data ?? [], [read.data]);
  const visible = useMemo(
    () => sortGapRows(visibleGapRows(rows, { gapsOnly, search }), sort),
    [rows, gapsOnly, search, sort],
  );
  useEffect(() => {
    onOrderChange(visible.map((row) => row.prompt_id));
  }, [visible, onOrderChange]);

  const labelOf = useMemo(() => {
    const labels = new Map<string, string>(engines.map((engine) => [engine.code, engine.label]));
    return (code: string): string => labels.get(code) ?? code;
  }, [engines]);
  const nameOf = useMemo(() => {
    const names = new Map(competitors.map((competitor) => [competitor.id, competitor.name]));
    return (id: string): string => names.get(id) ?? id;
  }, [competitors]);

  const columns = useMemo((): BoardColumn<CitationGapRow>[] => {
    return [
      {
        id: 'prompt',
        header: t('gaps.columns.prompt'),
        width: null,
        sortKey: 'prompt',
        cell: (row) => <span className="truncate text-foreground">{row.text}</span>,
      },
      {
        id: 'group',
        header: t('gaps.columns.group'),
        width: 136,
        sortKey: 'topic',
        cellClassName: 'truncate text-foreground-secondary',
        cell: (row) =>
          row.topic === null ? (
            <span className="text-foreground-tertiary">{t('toolbar.noGroup')}</span>
          ) : (
            row.topic.name
          ),
      },
      {
        id: 'you',
        header: props.ownName,
        width: 120,
        sortKey: 'you',
        tip: t('gaps.columns.youTip'),
        cell: (row) => (
          <GapMark state={row.you.total.state} own lost={row.gap > 0} tip={markLines(row.you, labelOf, t)} />
        ),
      },
      ...competitors.map((competitor): BoardColumn<CitationGapRow> => ({
        id: `c:${competitor.id}`,
        header: competitor.name,
        headerLead: <EntitySwatch shape="dot" own={false} colorIndex={competitor.colorIndex} />,
        width: 120,
        sortKey: `c:${competitor.id}`,
        tip: t('gaps.columns.competitorTip', { domain: competitor.domain ?? competitor.name }),
        cell: (row) => {
          const cell = row.competitors.find((candidate) => candidate.entity_id === competitor.id);
          return cell === undefined ? (
            <GapMark state="none" own={false} lost={false} tip="" />
          ) : (
            <GapMark state={cell.total.state} own={false} lost={false} tip={markLines(cell, labelOf, t)} />
          );
        },
      })),
      {
        id: 'lost',
        header: t('gaps.columns.lostOn'),
        width: 184,
        sortKey: 'gap',
        tip: t('gaps.columns.lostOnTip'),
        cellTip: (row) => (row.gap > 0 ? lostTip(row, labelOf, nameOf, t) : undefined),
        cell: (row) =>
          row.gap > 0 ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex shrink-0 items-center gap-1">
                {row.lost_on.map((code) => (
                  <EngineLogo key={code} engine={code} name={labelOf(code)} nameDisplay="visually-hidden" />
                ))}
              </span>
              <span className="truncate num text-foreground-secondary">
                {t('gaps.lostTo', { count: row.lost_to.length })}
              </span>
            </span>
          ) : (
            <span className="text-foreground-tertiary">{t('gaps.none')}</span>
          ),
      },
    ];
  }, [t, props.ownName, competitors, labelOf, nameOf]);

  const controls = (
    <Checkbox checked={gapsOnly} label={t('gaps.onlyGaps')} onCheckedChange={(next) => props.onGapsOnlyChange(next)} />
  );
  const gaps = rows.filter((row) => row.gap > 0).length;
  const summary =
    read.data === undefined ? null : (
      <p className="num type-meta md:whitespace-nowrap">
        {t.rich('gaps.summary', {
          gaps: formatInteger(gaps),
          prompts: rows.length,
          strong: (chunks) => <span className="type-body-strong text-foreground">{chunks}</span>,
        })}
      </p>
    );

  const failed = (read: BoardRead<unknown>): ReactElement => (
    <InlineError
      title={t('board.loadFailedTitle')}
      reason={t('board.loadFailedReason')}
      errorId={read.errorId}
      onRetry={read.retry}
      retrying={read.retrying}
      retryLabel={t('board.retry')}
    />
  );

  let body: ReactNode;
  // The tracked competitors are read first: until they are known, "none chosen" is not an answer
  if (competitorsRead.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} />;
  } else if (competitorsRead.status === 'error') {
    body = failed(competitorsRead);
  } else if (competitors.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.chooseTitle')}
        reason={t('gaps.chooseReason')}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={props.onChooseCompetitors}>
            {t('gaps.chooseAction')}
          </Button>
        }
      />
    );
  } else if (read.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} />;
  } else if (read.status === 'error') {
    body = failed(read);
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.noAnswersTitle')}
        reason={t('gaps.noAnswersReason', { scope: props.scopeText })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={props.onResetScope}>
            {t('gaps.resetScope')}
          </Button>
        }
      />
    );
  } else if (visible.length === 0 && search.trim() !== '') {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.noMatchTitle')}
        reason={t('gaps.noMatchReason', { query: search.trim() })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => props.onSearchChange('')}>
            {t('gaps.clearSearch')}
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('gaps.noGapsTitle')}
        reason={t('gaps.noGapsReason')}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => props.onGapsOnlyChange(false)}>
            {t('gaps.showAll')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <BoardTable<CitationGapRow>
        caption={t('gaps.caption')}
        columns={columns}
        rows={visible}
        rowId={(row) => row.prompt_id}
        rowLabel={(row) => t('gaps.open', { prompt: row.text })}
        identityTip={(row) => ({ content: row.text })}
        onOpen={props.onOpen}
        activeId={props.activeId}
        sort={sort}
        onSortChange={setSort}
        busy={read.refetching}
      />
    );
  }

  const runWindow = read.data?.meta.window;
  return (
    <BoardPanel
      tabs={props.tabs}
      search={search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('board.searchPrompts')}
      controls={controls}
      summary={summary}
      refetching={read.refetching}
      footerText={
        read.data === undefined
          ? null
          : gapsOnly
            ? t('gaps.footerGaps', { count: visible.length })
            : t('gaps.footer', { count: visible.length })
      }
      updated={runWindow === undefined ? null : updatedText(runWindow, props.timeZone, t)}
    >
      {body}
    </BoardPanel>
  );
}
