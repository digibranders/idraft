'use client';

import { FileText, Globe, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import {
  ALL_ENGINES,
  FAVICON,
  IDENTITY_WIDTH,
  lostRows,
  MIN_SUPPORT,
  notCited,
  topRows,
  type TopRow,
} from './citations-model';
import type { CitationRead } from './citations-reads';
import { DomainRoleBadge, Favicon } from '@/components/app/cells/domain-cell';
import { URLCell } from '@/components/app/cells/url-cell';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type {
  DomainRole,
  SourceChangePage,
  SourceDomainPage,
  SourceDomainRow,
  SourcePagePage,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { displayDomain, formatList, formatPercent } from '@/lib/format';
import { rateState } from '@/lib/stats';
import { cn } from '@/lib/utils';

/**
 * The answers that cite a row, as a count of the valid answers read ("13 of 24 answers", rule R11: a row counts once
 * in an answer, however many of its pages the answer cites). The rate is drawn for one platform only and from
 * `MIN_OBSERVATIONS` answers: over All platforms it would be a rate pooled across platforms.
 */
function AnswersCell({ cited, answers, rated }: { cited: number; answers: number; rated: boolean }): ReactElement {
  const t = useTranslations('prompts.citationsTab.domains');
  const rate = rated && rateState(answers) === 'ok' ? cited / answers : null;
  return (
    <span className="flex flex-col whitespace-nowrap">
      {rate === null ? null : <span className="num type-body-strong">{formatPercent(rate, { decimals: 0 })}</span>}
      <span className="num type-meta">{t('answersOf', { cited, answers })}</span>
    </span>
  );
}

/**
 * A domain and its role: the domain on a line of its own (icon, then the registrable domain, which gives way with
 * an ellipsis and is whole in its tooltip), and the role and New badges under it. Beside the domain the badge of a
 * competitor took 80 px of a 322 px table and left the domain one character.
 */
function DomainIdentity({
  domain,
  role,
  isNew,
  previousAnswers,
}: {
  domain: string;
  role: DomainRole;
  isNew: boolean;
  previousAnswers: number;
}): ReactElement {
  const text = visibleUrlText(displayDomain(domain));
  const own = role === 'own';
  return (
    // A one-track grid (`minmax(0, 1fr)`) has no minimum width of its own, so the table gives the domain what the
    // count columns leave, down to `min-w-18` (a role badge); a flex box would hold its whole text as its minimum
    <span data-slot="domain-identity" className={cn('grid min-w-18 grid-cols-1 gap-1 py-1', IDENTITY_WIDTH)}>
      <span data-slot="domain-line" className="flex min-w-0 items-center gap-1.5 font-mono type-table">
        <Favicon host={domain} mode={FAVICON} />
        <Tooltip content={text} purpose="label">
          <span
            dir="ltr"
            className={cn('min-w-0 truncate', own ? 'type-table-strong text-primary-text' : 'text-foreground')}
          >
            {text}
          </span>
        </Tooltip>
      </span>
      {role === 'third_party' && !isNew ? null : (
        <span className="flex flex-wrap items-center gap-1">
          {role === 'third_party' ? null : <DomainRoleBadge role={role} />}
          {isNew ? <NewMarker previousAnswers={previousAnswers} /> : null}
        </span>
      )}
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

interface TopListProps<TRow extends SourceDomainRow | SourcePageRow> {
  title: string;
  icon: LucideIcon;
  caption: string;
  failed: string;
  emptyTitle: string;
  emptyReason: string;
  read: CitationRead<{ data: TRow[]; meta: SourcesMeta }>;
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
  columns,
  rowKey,
  lead,
  after,
}: TopListProps<TRow>): ReactElement {
  const inspector = useTranslations('prompts.inspector');
  const common = useTranslations('common');
  const { data } = read;
  const top = data === undefined ? null : topRows(data.data, data.meta, MIN_SUPPORT);
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
        // The box the identity cells take their cap from (`IDENTITY_WIDTH`)
        <div aria-busy={read.refreshing ? true : undefined} className="@container flex flex-col gap-3">
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
          rows.map((row) => row.domain),
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
  /** `ALL_ENGINES` or an engine code: a rate is drawn for one platform only. */
  engine: string;
}

/**
 * The five most cited domains of the prompt (WB-PIC-01, register PR-DRAWER-08): role, and the answers that cite the
 * domain as a count of the valid answers read (rule R11), New against the period before (WB-PIC-04), and the domains
 * lost since. No position is a rank: the list is the order of the answers that cite a domain.
 */
export function TopDomains({ read, lost, engine }: TopDomainsProps): ReactElement {
  const t = useTranslations('prompts.citationsTab.domains');
  const columnsOf = (meta: SourcesMeta): PlainColumn<TopRow<SourceDomainRow>>[] => [
    {
      id: 'domain',
      header: t('domain'),
      cell: ({ row, isNew }) => (
        <DomainIdentity
          domain={row.registrable_domain}
          role={row.domain_role}
          isNew={isNew}
          previousAnswers={meta.previous_answers ?? 0}
        />
      ),
    },
    {
      id: 'citations',
      header: t('citations'),
      wrap: true,
      cell: ({ row }) => <AnswersCell cited={row.observations} answers={meta.answers} rated={engine !== ALL_ENGINES} />,
    },
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
  /** `ALL_ENGINES` or an engine code: a rate is drawn for one platform only. */
  engine: string;
}

/** The five most cited pages of the prompt (WB-PIC-02): the page with its host and title, the answers that cite it, New. */
export function TopPages({ read, ownPages, engine }: TopPagesProps): ReactElement {
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
      id: 'citations',
      header: domains('citations'),
      wrap: true,
      cell: ({ row }) => <AnswersCell cited={row.observations} answers={meta.answers} rated={engine !== ALL_ENGINES} />,
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
      rowKey={(row) => String(row.url_id)}
      columns={columnsOf}
      after={() => (noOwnPage ? <p className="type-meta">{t('noOwnPage')}</p> : null)}
    />
  );
}
