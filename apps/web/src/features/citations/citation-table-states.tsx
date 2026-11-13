'use client';

import { MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { DEFAULT_MIN_SUPPORT } from './citation-scope';
import type { TableStatus } from '@/components/app/data-table/types';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import type { SourcesMeta } from '@/lib/citations/types';
import { projectPath } from '@/lib/routes/paths';

/**
 * What the Domains and the Pages tab say alike: which state the table is in, the two empty states, and the notes
 * above the table (the units the shares are of, a refresh that failed, rows cut at 200, no previous answers).
 */

/** What a tab's read says about itself: `data` is `hasData` because a failed refresh keeps the rows of the last read. */
export interface TableReadFacts {
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  hasData: boolean;
}

/**
 * A minimum above 1 can be what left no row, the default 2 included: when everything cited has 1 unit the default
 * hides all of it, so the empty state says to lower it.
 */
export const minimumRaised = (minSupport: number): boolean => minSupport > 1;

/**
 * The state of the table. Nothing to list is `empty` only when no filter (engine, topic, branded, a search) changed
 * what was read and the scope has no citation unit; otherwise a filter, a search or the minimum left none.
 */
export function resolveTableStatus({
  read,
  listed,
  filtering,
  meta,
}: {
  read: TableReadFacts;
  /** The rows the table lists, after the tab's own search. */
  listed: number;
  /** A filter or a search narrows the list. */
  filtering: boolean;
  meta: SourcesMeta | undefined;
}): TableStatus {
  if (read.isError && !read.hasData) return 'error';
  if (read.isPending) return 'loading';
  if (listed === 0) return !filtering && meta !== undefined && meta.citation_units === 0 ? 'empty' : 'filtered-empty';
  return read.isFetching ? 'refetching' : 'ready';
}

/** No answer was read, or answers were read and none names a source. */
export function CitationEmptyState({
  meta,
  workspaceSlug,
  projectSlug,
}: {
  meta: SourcesMeta | undefined;
  workspaceSlug: string;
  projectSlug: string;
}): ReactElement {
  const t = useTranslations('citations');
  if (meta !== undefined && meta.answers === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title={t('empty.noAnswersTitle')}
        reason={t('empty.noAnswersReason')}
        headingLevel={2}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, projectSlug, '/ai/prompts')} />}>
            {t('empty.toPrompts')}
          </TextLink>
        }
      />
    );
  }
  return (
    <EmptyState
      title={t('empty.noCitingTitle')}
      reason={t('empty.noCitingReason', { answers: meta?.answers ?? 0 })}
      headingLevel={2}
    />
  );
}

/** A filter, a search or the minimum left no row: the filters are named, and Clear puts the page back. */
export function CitationFilteredEmptyState({
  filterBar,
  minSupport,
  filtering,
  onClear,
}: {
  filterBar: { fields: readonly FilterField[]; values: FilterValues };
  minSupport: number;
  filtering: boolean;
  onClear: () => void;
}): ReactElement {
  const t = useTranslations('citations');
  const tt = useTranslations('citations.table');
  return (
    <EmptyState
      title={t('filters.empty')}
      reason={t('filters.emptyReason')}
      headingLevel={2}
      details={
        <>
          <ReadOnlyFilterChips fields={filterBar.fields} values={filterBar.values} />
          {minimumRaised(minSupport) ? <p className="type-meta">{tt('emptyMinimum')}</p> : null}
        </>
      }
      primaryAction={
        filtering || minSupport !== DEFAULT_MIN_SUPPORT ? (
          <Button variant="secondary" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        ) : undefined
      }
    />
  );
}

export interface CitationTableNotesProps {
  meta: SourcesMeta | undefined;
  /** The comparison is on: with no answers in the period before, nothing can be marked New. */
  compare: boolean;
  /** A refresh failed and the rows of the last read are on screen. */
  refreshFailed: boolean;
  refetching: boolean;
  onRetry: () => void;
  /** The words for rows cut at 200 ("The 200 most cited domains are listed of 1,204. ..."), or `null` when all are listed. */
  truncated: string | null;
  /** Notes only the tab knows, after these. */
  children?: ReactNode;
}

/** The notes above a table. */
export function CitationTableNotes({
  meta,
  compare,
  refreshFailed,
  refetching,
  onRetry,
  truncated,
  children,
}: CitationTableNotesProps): ReactElement {
  const tt = useTranslations('citations.table');
  const common = useTranslations('common');
  return (
    <>
      {meta === undefined ? null : (
        <p className="type-meta">{tt('shareScope', { units: meta.citation_units, answers: meta.answers })}</p>
      )}
      {refreshFailed ? (
        <Banner
          tone="warning"
          placement="region"
          live
          message={tt('refreshFailed')}
          actions={
            <Button variant="secondary" size="sm" loading={refetching} onClick={onRetry}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      {truncated === null ? null : <Banner tone="warning" placement="region" live message={truncated} />}
      {compare && meta?.previous_answers === 0 ? (
        <Banner tone="info" placement="region" live message={tt('noPrevious')} />
      ) : null}
      {children}
    </>
  );
}
