'use client';

import { FileText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { DomainDetailRead } from './domain-reads';
import { URLCell } from '@/components/app/cells/url-cell';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TextLink } from '@/components/ui/text-link';
import type { SourceDomainDetailData, SourcePageRow } from '@/lib/citations/types';
import { formatInteger } from '@/lib/format';

/** The inspector lists the ten most cited pages; the full list is the Pages tab of the page, filtered to the domain. */
const LIMIT = 10;

export interface DomainPagesTabProps {
  domain: string;
  /** `null` while the read has nothing. */
  data: SourceDomainDetailData | null;
  read: DomainDetailRead;
  /** A read is on its way while the rows are on screen: they stay and the section says it is busy. */
  refetching: boolean;
  /** The Pages tab of the page filtered to this domain, keeping the scope: a real link. */
  pagesHref: Route;
  /** The source inspector of a cited page, as a real link. */
  sourceHrefOf: (urlId: number) => Route;
}

/**
 * The Pages tab (WB-DOM-07): the domain's ten most cited pages, each with its citation units and the answers that cite
 * it, in the order the API gives (most units first). A page opens the source inspector; "View all pages" leads to the
 * Pages tab of the page and shows only when the list may be cut at ten. The titles come from the answers: text only.
 */
export function DomainPagesTab({
  domain,
  data,
  read,
  refetching,
  pagesHref,
  sourceHrefOf,
}: DomainPagesTabProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const tt = useTranslations('citations.table');
  const common = useTranslations('common');
  const locale = useLocale();
  const pages = (data?.top_pages ?? []).slice(0, LIMIT);
  const status: InspectorSectionStatus =
    data === null ? (read.status === 'error' ? 'error' : 'loading') : pages.length === 0 ? 'empty' : 'ready';

  const columns: PlainColumn<SourcePageRow>[] = [
    {
      id: 'page',
      header: t('page'),
      cell: (row) => (
        <URLCell
          url={row.url}
          hostDisplay="hide"
          label={tt('urlLabel')}
          title={row.title}
          inspectorHref={sourceHrefOf(row.url_id)}
          context="list"
        />
      ),
    },
    { id: 'units', header: t('pageUnits'), cell: (row) => formatInteger(row.citation_units, { locale }) },
    { id: 'answers', header: t('pageAnswers'), cell: (row) => formatInteger(row.observations, { locale }) },
  ];

  return (
    <InspectorSection
      title={t('pagesTitle')}
      icon={FileText}
      status={status}
      action={
        pages.length >= LIMIT ? (
          <TextLink render={<Link href={pagesHref} />} className="type-body">
            {t('viewAllPages')}
          </TextLink>
        ) : undefined
      }
      error={
        <InlineError
          title={t('pagesFailed')}
          reason={t('loadFailedReason')}
          errorId={read.errorId}
          onRetry={read.retry}
          retrying={read.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState variant="inline" title={t('pagesEmptyTitle')} reason={t('pagesEmptyReason')} headingLevel={3} />
      }
    >
      <div aria-busy={refetching ? true : undefined}>
        <PlainTable<SourcePageRow>
          caption={t('pagesCaption', { domain })}
          columns={columns}
          rows={pages}
          rowKey={(row) => String(row.url_id)}
          status="ready"
          errorState={null}
          emptyText={t('pagesEmptyTitle')}
        />
      </div>
    </InspectorSection>
  );
}
