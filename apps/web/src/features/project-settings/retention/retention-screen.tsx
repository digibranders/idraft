'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { RETENTION_CLASSES, type RetentionRule } from './retention-classes';
import { Banner } from '@/components/app/status/banner';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { formatInteger } from '@/lib/format';

/**
 * Settings > Project settings > Data retention: how long the platform keeps each kind of raw data (doc 23
 * section 9.2). The same for every workspace and not a setting, so it is read only for every member and
 * reads nothing from the API.
 */
export function RetentionScreen(): ReactNode {
  const t = useTranslations('dataRetention');
  const columns: PlainColumn<RetentionRule>[] = [
    { id: 'data', header: t('columns.data'), wrap: true, cell: (rule) => t(`classes.${rule.message}.name`) },
    { id: 'what', header: t('columns.what'), wrap: true, cell: (rule) => t(`classes.${rule.message}.what`) },
    {
      id: 'keptFor',
      header: t('columns.keptFor'),
      cell: (rule) => (rule.days === null ? t('indefinite') : t('days', { days: formatInteger(rule.days) })),
    },
  ];
  return (
    <section aria-labelledby="retention-title" className="flex flex-col gap-5">
      <div>
        <h2 id="retention-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <Banner tone="info" placement="region" message={t('notice')} />
      <PlainTable<RetentionRule>
        caption={t('tableCaption')}
        columns={columns}
        rows={RETENTION_CLASSES}
        rowKey={(rule) => rule.key}
        status="ready"
        errorState={null}
        emptyText={t('empty')}
      />
      <p className="type-meta">{t('pastRetention')}</p>
    </section>
  );
}
