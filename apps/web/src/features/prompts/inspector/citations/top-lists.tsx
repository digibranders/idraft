'use client';

import { FileText, Globe, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import {
  engineCell,
  FAVICON,
  IDENTITY_WIDTH,
  lostRows,
  notCited,
  topRows,
  type EngineColumn,
  type TopRow,
} from './citations-model';
import type { CitationRead } from './citations-reads';
import type { PromptCounts } from '../../inspector-reads';
import { DomainCell } from '@/components/app/cells/domain-cell';
import { URLCell } from '@/components/app/cells/url-cell';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { unitShare, type UnitShare } from '@/lib/citations/share-model';
import type {
  SourceChangePage,
  SourceDomainPage,
  SourceDomainRow,
  SourcePagePage,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A cell's two lines: the units, then the share with the units it is a share of ("25.0% of 48 units"). */
function UnitsCell({ units, share }: { units: number; share: UnitShare }): ReactElement {
  const t = useTranslations('prompts.citationsTab.domains');
  return (
    <span className="flex flex-col whitespace-nowrap">
      <span className="num type-body-strong">{formatInteger(units)}</span>
      <span className="num type-meta">
        {share.value === null ? EMPTY_VALUE : t('unitsOf', { share: formatPercent(share.value), units: share.total })}
      </span>
    </span>
  );
}

/** The New badge: text, and the reason as its description; a tab stop so a keyboard reaches the tooltip. */
function NewMarker({ previousAnswers }: { previousAnswers: number }): ReactElement {
  const t = useTranslations('prompts.citationsTab.domains');
  return (
    <Tooltip content={t('newTip', { answers: previousAnswers })}>
      <Badge variant="outline" tabIndex={0}>
        {t('new')}
      </Badge>
    </Tooltip>
  );
}

/** One engine's units of a row; n/a, with the reason, for an engine that has no valid answer. */
function EngineCount({ count, label }: { count: number | null; label: string }): ReactElement {
  const t = useTranslations('prompts.citationsTab.domains');
  if (count !== null) return <span>{formatInteger(count)}</span>;
  return (
    <Tooltip content={t('engineNone', { engine: label })}>
      <span>{EMPTY_VALUE}</span>
    </Tooltip>
  );
}

interface TopListProps<TRow extends SourceDomainRow | SourcePageRow> {
  title: string;
  icon: LucideIcon;
  caption: string;
  failed: string;
  emptyTitle: string;
  emptyReason: string;
  read: CitationRead<{ data: TRow[]; meta: SourcesMeta }>;
  minSupport: number;
  columns: (meta: SourcesMeta) => PlainColumn<TopRow<TRow>>[];
  rowKey: (row: TRow) => string;
  /** Above the table, when there is one. */
  lead?: (meta: SourcesMeta) => ReactNode;
  /** Under the table, when there is one. */
  after?: (meta: SourcesMeta) => ReactNode;
}

/** The section both lists share: loads and fails alone, empty with its reason, keeps the rows while it refreshes. */
function TopList<TRow extends SourceDomainRow | SourcePageRow>({
  title,
  icon,
  caption,
  failed,
  emptyTitle,
  emptyReason,
  read,
  minSupport,
  columns,
  rowKey,
  lead,
  after,
}: TopListProps<TRow>): ReactElement {
  const inspector = useTranslations('prompts.inspector');
  const common = useTranslations('common');
  const { data } = read;
  const top = data === undefined ? null : topRows(data.data, data.meta, minSupport);
  let status: InspectorSectionStatus = 'loading';
  if (read.status === 'error') status = 'error';
  else if (top !== null) status = top.rows.length === 0 ? 'empty' : 'ready';
  return (
    <InspectorSection
      title={title}
      icon={icon}
      status={status}
      error={
        <InlineError
          title={failed}
          reason={inspector('loadFailedReason')}
          errorId={read.errorId}
          onRetry={read.retry}
          retrying={read.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        // With no answer in the window there is nothing to be cited in: the pair the other tabs use
        data !== undefined && data.meta.answers === 0 ? (
          <EmptyState
            variant="inline"
            title={inspector('answersEmpty')}
            reason={inspector('answersEmptyReason')}
            headingLevel={3}
          />
        ) : (
          <EmptyState variant="inline" title={emptyTitle} reason={emptyReason} headingLevel={3} />
        )
      }
    >
      {data === undefined || top === null ? null : (
        <div aria-busy={read.refreshing ? true : undefined} className="flex flex-col gap-3">
          {lead?.(data.meta)}
          <PlainTable<TopRow<TRow>>
            caption={caption}
            columns={columns(data.meta)}
            rows={top.rows}
            rowKey={(entry) => rowKey(entry.row)}
            status="ready"
            errorState={null}
            emptyText={emptyTitle}
          />
          {after?.(data.meta)}
        </div>
      )}
    </InspectorSection>
  );
}

/**
 * The domains under the lost line: sources cited before, in neither of the last two periods. It loads and fails
 * apart from the table (one line with Retry); with nothing lost, or while it loads, it draws nothing.
 */
// shortcut: lists the 5 domains read and does not say when more were lost, add a "N more" count when a Lost list is built
function LostLine({ lost }: { lost: CitationRead<SourceChangePage> }): ReactElement | null {
  const t = useTranslations('prompts.citationsTab.lost');
  const common = useTranslations('common');
  const locale = useLocale();
  if (lost.status === 'error') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 type-meta">
        {t('failed')}
        <Button variant="link" size="sm" loading={lost.retrying} onClick={lost.retry}>
          {common('retry')}
        </Button>
      </p>
    );
  }
  const rows = lost.data === undefined ? [] : lostRows(lost.data);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="type-label">{t('title')}</p>
      <p className="num type-meta">
        {formatList(
          rows.map((row) => t('row', { domain: row.domain, units: row.units })),
          locale,
        )}
      </p>
      <p className="type-meta text-foreground-tertiary">{t('tip')}</p>
    </div>
  );
}

export interface TopDomainsProps {
  read: CitationRead<SourceDomainPage>;
  lost: CitationRead<SourceChangePage>;
  /** One count column for each engine (`engineColumns`); none for a single engine. */
  columns: readonly EngineColumn[];
  /** The prompt's summary: which engines had a valid answer. */
  counts: PromptCounts;
  minSupport: number;
}

/**
 * The five most cited domains of the prompt (WB-PIC-01): role, citation units and the share with the units it is a
 * share of, New against the period before (WB-PIC-04), one count per engine for All engines (WB-PIC-03), and
 * the domains lost since. No position is a rank: the list is the order of citation units.
 */
export function TopDomains({ read, lost, columns, counts, minSupport }: TopDomainsProps): ReactElement {
  const t = useTranslations('prompts.citationsTab.domains');
  const columnsOf = (meta: SourcesMeta): PlainColumn<TopRow<SourceDomainRow>>[] => [
    {
      id: 'domain',
      header: t('domain'),
      cell: ({ row, isNew }) => (
        <span className={cn('flex min-w-0 items-center gap-2', IDENTITY_WIDTH)}>
          <DomainCell
            host={row.registrable_domain}
            registrable={row.registrable_domain}
            role={row.domain_role}
            favicon={FAVICON}
            context="list"
          />
          {isNew ? <NewMarker previousAnswers={meta.previous_answers ?? 0} /> : null}
        </span>
      ),
    },
    {
      id: 'units',
      header: t('units'),
      wrap: true,
      cell: ({ row }) => <UnitsCell units={row.citation_units} share={unitShare(row.source_share)} />,
    },
    ...columns.map((column): PlainColumn<TopRow<SourceDomainRow>> => ({
      id: `engine-${column.code}`,
      header: column.label,
      description: t('engineUnits', { engine: column.label }),
      cell: ({ row }) => <EngineCount count={engineCell(row, column.code, counts)} label={column.label} />,
    })),
  ];
  return (
    <TopList<SourceDomainRow>
      title={t('title')}
      icon={Globe}
      caption={t('caption')}
      failed={t('failed')}
      emptyTitle={t('emptyTitle')}
      emptyReason={t('emptyReason')}
      read={read}
      minSupport={minSupport}
      rowKey={(row) => `${row.registrable_domain}:${row.domain_role}:${row.role_entity_id ?? ''}`}
      columns={columnsOf}
      lead={(meta) =>
        notCited(meta) ? <p className="type-meta">{t('notCitedLead', { answers: meta.answers })}</p> : null
      }
      after={() => <LostLine lost={lost} />}
    />
  );
}

export interface TopPagesProps {
  read: CitationRead<SourcePagePage>;
  /** The own pages the prompt cites (`page.total`); unknown while it loads or when it failed. */
  ownPages: CitationRead<SourcePagePage>;
  minSupport: number;
}

/** The five most cited pages of the prompt (WB-PIC-02): the page with its host and title, units and share, New. */
export function TopPages({ read, ownPages, minSupport }: TopPagesProps): ReactElement {
  const t = useTranslations('prompts.citationsTab.pages');
  const domains = useTranslations('prompts.citationsTab.domains');
  const noOwnPage = ownPages.data?.page.total === 0;
  const columnsOf = (meta: SourcesMeta): PlainColumn<TopRow<SourcePageRow>>[] => [
    {
      id: 'page',
      header: t('page'),
      cell: ({ row, isNew }) => (
        <span className={cn('flex min-w-0 items-center gap-2', IDENTITY_WIDTH)}>
          <URLCell
            url={row.url}
            hostDisplay="show"
            label={t('urlLabel')}
            title={row.title}
            favicon={FAVICON}
            context="list"
          />
          {isNew ? <NewMarker previousAnswers={meta.previous_answers ?? 0} /> : null}
        </span>
      ),
    },
    {
      id: 'units',
      header: domains('units'),
      wrap: true,
      cell: ({ row }) => <UnitsCell units={row.citation_units} share={unitShare(row.source_share)} />,
    },
  ];
  return (
    <TopList<SourcePageRow>
      title={t('title')}
      icon={FileText}
      caption={t('caption')}
      failed={t('failed')}
      emptyTitle={t('emptyTitle')}
      emptyReason={t('emptyReason')}
      read={read}
      minSupport={minSupport}
      rowKey={(row) => String(row.url_id)}
      columns={columnsOf}
      after={() => (noOwnPage ? <p className="type-meta">{t('noOwnPage')}</p> : null)}
    />
  );
}
