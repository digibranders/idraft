'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EmptyState } from '@/components/app/status/empty-state';

/**
 * Sync status and history (24-page-templates.md section 9.12). The backend has no pull yet, so there is
 * nothing to count: every cell says so in words instead of showing a number, and the history says why it is
 * empty. Once the pull exists this reads its progress; the strip keeps these labels.
 */
export function SyncSection({ propertyChosen }: { propertyChosen: boolean }): ReactElement {
  const t = useTranslations('integrations.sync');
  const pending = { kind: 'pending' } as const;
  const items: MetricStripItem[] = [
    { id: 'lastSync', label: t('lastSync'), value: t('never'), unknown: pending },
    { id: 'coverage', label: t('coverage'), value: t('notStarted'), unknown: pending },
    { id: 'rows', label: t('rows'), value: t('none'), unknown: pending },
    { id: 'next', label: t('next'), value: t('notScheduled'), unknown: pending },
  ];
  const groups = [{ id: 'sync', items }];
  return (
    <>
      <MetricStrip size="md" label={t('stripLabel')} groups={groups} status="ready" />
      <section aria-labelledby="gsc-history-title" className="rounded-lg border border-border bg-surface">
        <h2 id="gsc-history-title" className="px-5 pt-4 type-section-title">
          {t('historyTitle')}
        </h2>
        <EmptyState
          variant="inline"
          headingLevel={3}
          title={t('emptyTitle')}
          reason={propertyChosen ? t('emptyAfterProperty') : t('emptyBeforeProperty')}
        />
      </section>
    </>
  );
}
