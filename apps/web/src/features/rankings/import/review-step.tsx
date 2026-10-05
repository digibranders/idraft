'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { OUTCOMES, REASON_KEYS, isReasonCode, type Outcome, type OutcomeSummary, type Quota } from './import-model';
import type { ReviewChoices } from './import-model';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { RadioGroup } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Truncate } from '@/components/ui/truncate';
import type { ImportRow } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

/** What the section of an outcome shows of its rows. */
export type RowsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: readonly ImportRow[]; total: number };

const OVER_QUOTA = 'overQuota';
const OUTCOME_GROUP = 'outcomes';
/** The mobile half of a `device: both` row is part 2. */
const MOBILE_PART = 2;

export interface ReviewStepProps {
  summary: OutcomeSummary;
  quota: Quota | null;
  choices: ReviewChoices;
  onChoicesChange: (patch: Partial<ReviewChoices>) => void;
  rows: Partial<Record<Outcome, RowsState>>;
  /** How many rows each section lists. */
  limit: number;
  onRetryRows: () => void;
}

interface RowListProps {
  state: RowsState | undefined;
  count: number;
  limit: number;
  onRetry: () => void;
}

/** The first rows of an outcome: where each came from, the keyword and, for a row left out, why. */
function RowList({ state, count, limit, onRetry }: RowListProps): ReactElement | null {
  const t = useTranslations('rankings.import');
  const common = useTranslations('common');
  if (state === undefined || state.status === 'loading') {
    return (
      <div className="flex flex-col gap-1.5" aria-busy="true">
        <Skeleton shape="text-14" widthPct={100} />
        <Skeleton shape="text-14" widthPct={80} />
        <Skeleton shape="text-14" widthPct={64} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-3">
        <p className="type-body text-foreground-secondary">{t('rowsFailed')}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {common('retry')}
        </Button>
      </div>
    );
  }
  const reasonOf = (row: ImportRow): string | null => {
    if (row.outcome !== 'invalid') return null;
    if (isReasonCode(row.reason_code)) return t(`reasons.${REASON_KEYS[row.reason_code]}`);
    return row.reason;
  };
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {state.rows.map((row) => {
          const reason = reasonOf(row);
          return (
            <li key={`${String(row.row_no)}-${String(row.part)}`} className="flex items-baseline gap-3">
              <span className="w-24 shrink-0 num type-meta">
                {row.part === MOBILE_PART
                  ? t('rowPart', { row: formatInteger(row.row_no), device: t('deviceMobile') })
                  : t('row', { row: formatInteger(row.row_no) })}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {row.keyword === null || row.keyword === '' ? (
                  <span className="type-body text-foreground-tertiary">{t('noKeyword')}</span>
                ) : (
                  <Truncate text={row.keyword} className="type-body" />
                )}
                {reason === null ? null : <span className="type-meta">{reason}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {count > limit ? (
        <p className="type-meta">
          {t('rowsShown', { shown: formatInteger(state.rows.length), count: formatInteger(count) })}
        </p>
      ) : null}
    </>
  );
}

/**
 * Step 3: what will happen to every row of the file. The counts come first, then one section for each
 * outcome that has rows: what it means, the choice there is for it (duplicates and archived keywords), and
 * the first rows. Nothing is written until the last step.
 */
export function ReviewStep({
  summary,
  quota,
  choices,
  onChoicesChange,
  rows,
  limit,
  onRetryRows,
}: ReviewStepProps): ReactElement {
  const t = useTranslations('rankings.import');
  const shown = OUTCOMES.filter((outcome) => summary[outcome] > 0);
  const items: MetricStripItem[] = [
    ...shown.map((outcome) => ({
      id: outcome,
      label: t(`outcomes.${outcome}`),
      value: formatInteger(summary[outcome]),
    })),
    ...(summary.overQuota > 0
      ? [{ id: OVER_QUOTA, label: t('outcomes.overQuota'), value: formatInteger(summary.overQuota) }]
      : []),
  ];

  return (
    <>
      {summary.overQuota > 0 ? (
        <FormAlert
          message={t('outcomeHelp.overQuota', {
            count: summary.overQuota,
            limit: formatInteger(quota?.limit ?? 0),
          })}
        />
      ) : null}
      {items.length === 0 ? null : (
        <MetricStrip size="sm" label={t('reviewSummary')} groups={[{ id: OUTCOME_GROUP, items }]} status="ready" />
      )}
      {shown.map((outcome) => (
        <section key={outcome} aria-labelledby={`review-${outcome}`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id={`review-${outcome}`} className="type-subsection-title">
              {t(`outcomes.${outcome}`)}
            </h3>
            <p className="type-body text-foreground-secondary">{t(`outcomeHelp.${outcome}`)}</p>
          </div>
          {outcome === 'duplicate' ? (
            <>
              <RadioGroup<ReviewChoices['duplicates']>
                legend={t('duplicateLegend')}
                value={choices.duplicates}
                onValueChange={(duplicates) => onChoicesChange({ duplicates })}
                options={[
                  { value: 'skip', label: t('duplicateSkip') },
                  { value: 'merge', label: t('duplicateMerge') },
                ]}
              />
              <p className="type-meta">{t('duplicateRepeatNote')}</p>
            </>
          ) : null}
          {outcome === 'conflict' ? (
            <RadioGroup<ReviewChoices['conflicts']>
              legend={t('conflictLegend')}
              value={choices.conflicts}
              onValueChange={(conflicts) => onChoicesChange({ conflicts })}
              options={[
                { value: 'skip', label: t('conflictSkip') },
                { value: 'unarchive', label: t('conflictUnarchive') },
              ]}
            />
          ) : null}
          <RowList state={rows[outcome]} count={summary[outcome]} limit={limit} onRetry={onRetryRows} />
        </section>
      ))}
    </>
  );
}
