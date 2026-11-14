'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { StatusChip } from '@/components/app/page-toolbar/status-chip';
import { Banner } from './banner';
import { CollectionProgress } from './collection-progress';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { formatPercent } from '@/lib/format';
import { DEGRADED_BELOW, formatCoverageRate, type DegradedEngine } from '@/lib/runs/ai-health-model';

/** A degraded engine with the name to show for it. */
export interface DegradedEngineView extends DegradedEngine {
  name: string;
}

export interface AiCollectionStatusViewProps {
  /** An AI run of the project is open: its counts (`null` while it has planned no task) and the page of the run. */
  progress: { counts: { processed: number; failed: number; total: number } | null; href: Route } | null;
  /** The engines of the newest finished run that are degraded, and the page of that run. */
  notice: { engines: readonly DegradedEngineView[]; href: Route } | null;
  /** The read behind the notice failed: a quiet line with Retry, never a banner. */
  failure: { onRetry: () => void; retrying: boolean } | null;
  /** Presentation variant: full width banners (default) or compact toolbar chips. */
  variant?: 'banner' | 'inline' | undefined;
}

/**
 * What an AI page says about its collection (WP-30 decisions D12 and D15, 17 section 4, 18 section 4): a
 * compact progress line while a run is open, a warning banner per degraded engine of the newest finished run,
 * and, when the coverage could not be read, a quiet line with Retry. It draws nothing when there is nothing to
 * say, so the page's own spacing does not change. The banners are present when the page is read, so they carry
 * no live role.
 */
export function AiCollectionStatusView({
  progress,
  notice,
  failure,
  variant = 'banner',
}: AiCollectionStatusViewProps): ReactElement | null {
  const t = useTranslations('runs');
  const common = useTranslations('common');
  if (progress === null && notice === null && failure === null) return null;

  if (variant === 'inline') {
    return (
      <div data-slot="ai-collection-status" className="flex items-center gap-2">
        {progress === null ? null : (
          <StatusChip
            tone="info"
            label={t('progress.collecting')}
            tooltip={
              progress.counts === null
                ? t('progress.preparing')
                : t('progress.counted', {
                    done: progress.counts.processed,
                    total: progress.counts.total,
                    failed: progress.counts.failed,
                  })
            }
            ariaLabel={t('progress.viewRun')}
            href={progress.href}
          />
        )}
        {notice?.engines.map((row) => (
          <StatusChip
            key={row.engine}
            tone="warning"
            label={t('notice.degraded', { name: row.name })}
            tooltip={t('notice.engine', {
              name: row.name,
              valid: row.valid,
              planned: row.planned,
              percent: formatCoverageRate(row.rate),
              threshold: formatPercent(DEGRADED_BELOW, { decimals: 0 }),
            })}
            ariaLabel={t('notice.viewRunFor', { name: row.name })}
            href={notice.href}
          />
        ))}
        {failure === null ? null : (
          <div className="flex items-center gap-1 type-meta text-foreground-tertiary">
            <p>{t('notice.loadFailed')}</p>
            <Button variant="ghost" size="sm" loading={failure.retrying} onClick={failure.onRetry}>
              {common('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div data-slot="ai-collection-status" className="flex flex-col gap-2">
      {progress === null ? null : (
        <div>
          <CollectionProgress
            density="compact"
            status="running"
            text={
              progress.counts === null
                ? t('progress.preparing')
                : t('progress.counted', {
                    done: progress.counts.processed,
                    total: progress.counts.total,
                    failed: progress.counts.failed,
                  })
            }
            action={
              <TextLink render={<Link href={progress.href} />} className="inline-flex min-h-6 items-center">
                {t('progress.viewRun')}
              </TextLink>
            }
          />
        </div>
      )}
      {notice?.engines.map((row) => (
        <Banner
          key={row.engine}
          tone="warning"
          placement="region"
          message={t('notice.engine', {
            name: row.name,
            valid: row.valid,
            planned: row.planned,
            percent: formatCoverageRate(row.rate),
            threshold: formatPercent(DEGRADED_BELOW, { decimals: 0 }),
          })}
          actions={
            <TextLink
              render={<Link href={notice.href} />}
              aria-label={t('notice.viewRunFor', { name: row.name })}
              className="inline-flex min-h-6 items-center"
            >
              {t('progress.viewRun')}
            </TextLink>
          }
        />
      ))}
      {failure === null ? null : (
        <div className="flex flex-wrap items-center gap-x-2 type-meta">
          <p>{t('notice.loadFailed')}</p>
          <Button variant="ghost" size="sm" loading={failure.retrying} onClick={failure.onRetry}>
            {common('retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
