'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { useFailureText } from './import-failure';
import { IMPORT_POLL_MS, reportPath, useImport } from './import-queries';
import { importPhase, reportLinkOf } from './import-model';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { refreshGroups, refreshVocabularies } from '../taxonomy-queries';
import { CollectionProgress } from '@/components/app/status/collection-progress';
import { toast } from '@/components/ui/toast';
import { downloadUrl } from '@/lib/dom/download';
import { formatInteger, formatIsoDate } from '@/lib/format';

export interface ImportProgressProps {
  scope: ProjectScope;
  importId: string;
  /** The project's time zone, for the date in the report's file name. */
  timeZone: string;
  /** The write ended, or cannot be followed: the header lets go of it. Called once, with the id. */
  onSettled: (importId: string) => void;
}

/**
 * The write of an import under Rankings' page header (23-application-patterns.md section 12.1): the bar
 * while it runs, and when it ends one toast, with the report to download on success. It asks about the import
 * every few seconds, so it survives the dialog and a reload (Rankings finds a write under way on mount). The
 * keyword table, the groups and the vocabularies are read again at the end, since the import may have made
 * keywords, groups and terms.
 */
export function ImportProgress({ scope, importId, timeZone, onSettled }: ImportProgressProps): ReactElement | null {
  const t = useTranslations('rankings.import');
  const failureText = useFailureText();
  const queryClient = useQueryClient();
  const current = useImport(scope, importId, IMPORT_POLL_MS);
  const imported = current.data;
  // The end is reported once, however many times the answer is read again
  const handled = useRef(false);
  const lost = current.isError && imported === undefined;

  useEffect(() => {
    if (handled.current) return;
    const toastId = `keyword-import-${importId}`;
    if (imported === undefined) {
      // A read that fails for good leaves nothing to follow: say so, once
      if (lost) {
        handled.current = true;
        toast({ id: toastId, type: 'error', title: t('progressLost') });
        onSettled(importId);
      }
      return;
    }
    const phase = importPhase(imported.status);
    if (phase === 'done') {
      handled.current = true;
      void refreshKeywords(queryClient, scope);
      void refreshGroups(queryClient, scope);
      void refreshVocabularies(queryClient, scope.workspaceId);
      const { created, merged, skipped } = imported.counts;
      const date = formatIsoDate(imported.finished_at ?? new Date(), timeZone);
      // The report is offered when the import links to one, and downloaded from that link when it is a path of
      // this app's API (the known path stands in for any other)
      const report = reportLinkOf(imported.operation.links, reportPath(scope, importId), window.location.origin);
      toast({
        id: toastId,
        type: 'success',
        title:
          merged > 0
            ? t('finishedMerged', {
                created: formatInteger(created),
                merged: formatInteger(merged),
                skipped: formatInteger(skipped),
              })
            : t('finished', { created: formatInteger(created), skipped: formatInteger(skipped) }),
        action:
          report === null
            ? undefined
            : { label: t('downloadReport'), onAction: () => downloadUrl(report, t('reportName', { date })) },
      });
      onSettled(importId);
    } else if (phase === 'failed') {
      handled.current = true;
      toast({
        id: toastId,
        type: 'error',
        title: t('finishedFailed', {
          reason: failureText(imported.error_code ?? imported.operation.error?.code, t('requestFailed')),
        }),
      });
      onSettled(importId);
    } else if (phase === 'gone' || phase === 'expired') {
      handled.current = true;
      onSettled(importId);
    }
  }, [imported, lost, importId, scope, timeZone, queryClient, onSettled, failureText, t]);

  if (imported === undefined) return null;
  const phase = importPhase(imported.status);
  if (phase !== 'writing' && phase !== 'reading') return null;
  const { done, total } = imported.operation.progress;
  const all = total ?? imported.counts.rows_total;
  return (
    <CollectionProgress
      density="standard"
      status="running"
      text={t('progressText')}
      counts={{ done, failed: 0, total: all }}
      countsText={t('progressCounts', { done: formatInteger(done), total: formatInteger(all) })}
      progressText={t('progressCounts', { done: formatInteger(done), total: formatInteger(all) })}
    />
  );
}
