'use client';

import { CircleSlash, History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SerpTable } from './serp-table';
import { SnapshotPicker } from './snapshot-picker';
import { useSnapshotView } from './use-snapshot-view';
import { detailStateOf } from '../detail-state';
import type { KeywordDetail, KeywordScope } from '../../keyword-inspector/inspector-queries';
import { SectionError } from '../../keyword-inspector/section-error';
import type { TableStatus } from '@/components/app/data-table/types';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { formatDetailDateTime, formatInteger } from '@/lib/format';

export interface SnapshotsTabProps {
  scope: KeywordScope;
  detail: KeywordDetail;
  /** The project's time zone: the times of the checks are shown in it. */
  timeZone: string;
}

/**
 * The SERP snapshots tab (24-page-templates.md section 9.4): the latest check's top 20, or one dated
 * snapshot chosen with the picker, with the own site and the tracked competitors marked. A keyword that
 * was never checked, or whose checks all failed, has no snapshot and says which of the two it is, in the
 * words every section of the page uses (Decision 9), without asking for a snapshot.
 */
export function SnapshotsTab({ scope, detail, timeZone }: SnapshotsTabProps): ReactElement {
  const state = detailStateOf(detail.state, detail.is_active);
  if (state.kind === 'pending' || state.kind === 'failed') return <NoSnapshot reason={state.kind} />;
  return <SnapshotViewer scope={scope} timeZone={timeZone} />;
}

function NoSnapshot({ reason }: { reason: 'pending' | 'failed' | 'archived' }): ReactElement {
  const t = useTranslations('keywordDetail.snapshots.empty');
  return (
    <EmptyState
      icon={reason === 'failed' ? CircleSlash : History}
      title={t(reason)}
      reason={t(`${reason}Reason`)}
      headingLevel={2}
    />
  );
}

function SnapshotViewer({ scope, timeZone }: { scope: KeywordScope; timeZone: string }): ReactElement {
  const t = useTranslations('keywordDetail.snapshots');
  const view = useSnapshotView(scope);
  const { chosen, rows, asked, observedAt } = view;

  // A keyword archived before its first check has no snapshot, though it is not "pending"
  if (view.current.isSuccess && view.latestId === null) return <NoSnapshot reason="archived" />;

  // What is on show reads through `serp-current` (the latest check) or through the snapshot's own read
  const active = chosen === null ? view.current : view.detail;
  const gone = chosen !== null && view.detail.isError && isApiProblem(view.detail.error, 'not_found');
  const status: TableStatus =
    rows === null
      ? active.isError
        ? 'error'
        : 'loading'
      : rows.length === 0
        ? 'empty'
        : active.isFetching
          ? 'refetching'
          : 'ready';

  const when = (instant: string): string => formatDetailDateTime(instant, timeZone);
  const heading =
    observedAt === null ? null : t(chosen === null ? 'heading.latest' : 'heading.dated', { when: when(observedAt) });
  // The titles of an older snapshot are kept for the tracked entities only, and a dated read says so
  const titlesNote = status !== 'loading' && view.titlesSource !== null && view.titlesSource !== 'serp_current_results';
  const returned = asked !== null && asked.depthReturned < asked.depth ? asked : null;

  const announceStep = (id: string): void => {
    const stepped = view.options.find((option) => option.id === id);
    if (stepped === undefined) return;
    announce(t(id === view.latestId ? 'heading.latest' : 'heading.dated', { when: when(stepped.observedAt) }), {
      key: 'snapshot-step',
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {heading === null ? (
          <Skeleton shape="text-14" widthPct={48} />
        ) : (
          <h2 className="type-section-title text-foreground">{heading}</h2>
        )}
        <SnapshotPicker
          options={view.options}
          latestId={view.latestId}
          chosen={chosen}
          timeZone={timeZone}
          onChoose={view.choose}
          onStepped={announceStep}
          loading={view.list.isPending}
          hasMore={view.list.hasNextPage}
          loadingMore={view.list.isFetchingNextPage}
          onLoadOlder={() => void view.list.fetchNextPage()}
        />
      </div>
      {view.list.isError && view.list.data === undefined ? (
        <SectionError
          title={t('picker.listFailed')}
          error={view.list.error}
          onRetry={() => void view.list.refetch()}
          retrying={view.list.isFetching}
        />
      ) : null}
      {titlesNote ? <p className="type-meta">{t('titlesNote')}</p> : null}
      {returned === null ? null : (
        <p className="type-meta">
          {t('returned', { returned: returned.depthReturned, depth: formatInteger(returned.depth) })}
        </p>
      )}
      {gone ? (
        <EmptyState
          icon={CircleSlash}
          title={t('gone.title')}
          reason={t('gone.reason')}
          headingLevel={2}
          primaryAction={<Button onClick={() => view.choose(null)}>{t('gone.clear')}</Button>}
        />
      ) : (
        // 49 rem: the 20 results of a latest check with the toolbar, the header and the footer, without an inner scroll
        <div className="flex h-196 min-h-0 flex-col">
          <SerpTable
            rows={rows ?? []}
            status={status}
            errorState={
              <SectionError
                title={t('table.failed')}
                reason={t('table.failedReason')}
                error={active.error}
                onRetry={() => void active.refetch()}
                retrying={active.isFetching}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
