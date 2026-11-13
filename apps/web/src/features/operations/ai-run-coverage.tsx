'use client';

import { CircleDashed, MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { TASK_STATUS_KEYS } from './run-model';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { byEngineOrder } from '@/components/app/engine/order';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { useErrorId } from '@/lib/api/use-error-id';
import { formatList, formatPercent } from '@/lib/format';
import { coverageRows, missingShown, type CoverageMissing, type CoverageRow } from '@/lib/runs/ai-health-model';
import { useAiCoverage, useEngineNames, usePromptTexts, type AiRunsScope } from '@/lib/runs/ai-reads';
import { cn } from '@/lib/utils';

export interface AiRunCoverageProps {
  scope: AiRunsScope;
  runId: string;
  /** The run has not ended: its coverage is read again every few seconds. */
  open: boolean;
}

/**
 * The two sections an AI run's inspector has after "Tasks by status" (WP-30, C3): what each engine planned and
 * stored ("Answers by engine"), and the planned tasks that have no answer ("Missing answers"). One read feeds
 * both, so a failed read is one error with one Retry, in the first section; the run's own sections are not
 * touched. Engines are listed one by one and never pooled.
 */
export function AiRunCoverage({ scope, runId, open }: AiRunCoverageProps): ReactElement {
  const t = useTranslations('runs');
  const common = useTranslations('common');
  const coverage = useAiCoverage(scope, runId, true, open);
  const engineName = useEngineNames(scope);
  const promptTexts = usePromptTexts(scope);
  const errorId = useErrorId(coverage.error);
  const [showAll, setShowAll] = useState(false);

  const data = coverage.data?.data;
  const failed = data === undefined && coverage.isError;
  const rows = data === undefined ? [] : coverageRows(byEngineOrder(data.by_engine, (engine) => engine.engine_code));
  const missing = data?.missing ?? [];
  const { rows: shown, hidden } = missingShown(missing, showAll);

  const columns: readonly PlainColumn<CoverageMissing>[] = [
    {
      id: 'prompt',
      header: t('coverage.columns.prompt'),
      cell: (row) => (
        <span className="block py-1 wrap-anywhere">{promptTexts.get(row.prompt_id) ?? row.prompt_id}</span>
      ),
    },
    {
      id: 'engine',
      header: t('coverage.columns.engine'),
      cell: (row) => <EngineBadge engine={row.engine_code} name={engineName(row.engine_code)} />,
    },
    {
      id: 'status',
      header: t('coverage.columns.status'),
      cell: (row) => t(`taskStatuses.${TASK_STATUS_KEYS[row.task_status]}`),
    },
  ];

  const loadError: ReactNode = (
    <InlineError
      title={t('coverage.loadFailed')}
      reason={t('coverage.loadFailedReason')}
      errorId={errorId}
      onRetry={() => void coverage.refetch()}
      retrying={coverage.isFetching}
      retryLabel={common('retry')}
    />
  );

  return (
    <>
      <InspectorSection
        title={t('coverage.byEngine')}
        icon={MessagesSquare}
        // A poll that fails after a good read leaves what is on screen, and says so (below)
        status={data === undefined ? (failed ? 'error' : 'loading') : rows.length === 0 ? 'empty' : 'ready'}
        error={loadError}
        empty={
          <EmptyState
            variant="inline"
            title={t('coverage.noEngines')}
            reason={t('coverage.noEnginesReason')}
            headingLevel={3}
          />
        }
      >
        <div className="flex flex-col gap-3">
          {coverage.isError ? <p className="type-meta">{t('inspector.stale')}</p> : null}
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.engine} className="flex flex-col gap-1">
                <div className="flex">
                  <EngineBadge engine={row.engine} name={engineName(row.engine)} />
                </div>
                <EngineLine row={row} />
              </li>
            ))}
          </ul>
        </div>
      </InspectorSection>
      {/* The one read already failed in the section above, and a run that planned nothing has nothing missing */}
      {failed || (data !== undefined && rows.length === 0) ? null : (
        <InspectorSection
          title={t('coverage.missing')}
          icon={CircleDashed}
          status={data === undefined ? 'loading' : missing.length === 0 ? 'empty' : 'ready'}
          empty={
            <EmptyState
              variant="inline"
              title={t('coverage.allArrived')}
              reason={t('coverage.allArrivedReason')}
              headingLevel={3}
            />
          }
        >
          <div className="flex flex-col gap-2">
            <p className="type-meta">{t('coverage.missingCount', { count: missing.length })}</p>
            <PlainTable
              caption={t('coverage.caption')}
              columns={columns}
              rows={shown}
              rowKey={(row) =>
                `${row.prompt_id}:${row.engine_code}:${String(row.location_id)}:${String(row.replicate_index)}`
              }
              status="ready"
              errorState={null}
              emptyText={t('coverage.allArrived')}
            />
            {hidden > 0 ? (
              <div>
                <Button variant="link" size="sm" onClick={() => setShowAll(true)}>
                  {t('coverage.showAll', { count: missing.length })}
                </Button>
              </div>
            ) : null}
          </div>
        </InspectorSection>
      )}
    </>
  );
}

/**
 * One engine's counts: "141 of 150 answers valid, 94%" with the partial and invalid answers in words under it.
 * Nothing planned is "n/a" with its reason, and fewer than 10 planned shows the counts without a rate. Only a
 * degraded engine has a tone: the rate itself carries no colour.
 */
function EngineLine({ row }: { row: CoverageRow }): ReactElement {
  const t = useTranslations('runs.coverage');
  if (row.kind === 'none') {
    return (
      <>
        <p className="type-body">{t('none')}</p>
        <p className="type-meta">{t('noneReason')}</p>
      </>
    );
  }
  return (
    <>
      <p className={cn('num type-body', row.degraded && 'text-warning-text')}>
        {row.rate === null
          ? t('validCounts', { valid: row.valid, planned: row.planned })
          : t('validRated', {
              valid: row.valid,
              planned: row.planned,
              percent: formatPercent(row.rate, { decimals: 0 }),
            })}
      </p>
      {row.kind === 'thin' ? <p className="type-meta">{t('thin', { planned: row.planned })}</p> : null}
      {row.parts.length === 0 ? null : (
        <p className="num type-meta">
          {formatList(row.parts.map((part) => t(`invalid.${part.part}`, { count: part.count })))}
        </p>
      )}
    </>
  );
}
