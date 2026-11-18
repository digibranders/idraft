'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MetricStrip, type MetricStripGroup } from '@/components/app/metric/metric-strip';
import { formatInteger } from '@/lib/format';
import type { ChangeScope, ChangesSummary } from '@/lib/internal-links/types';

/**
 * The counts of what the crawl changed against the one before it (mock `strip`): editorial links lost and added,
 * the ones lost to the important tiers, and the pages added and lost. Only worked out changes are drawn.
 */
export function ChangesStrip({
  summary,
  since,
  tiers,
  linkScope,
}: {
  summary: ChangesSummary;
  /** The links the lost and added counts are of; the count lost to the important tiers is editorial either way. */
  linkScope: ChangeScope;
  /** "since 7 Nov". */
  since: string;
  /** "T1 and T2". */
  tiers: string;
}): ReactElement {
  const t = useTranslations('internalLinks.changes.strip');
  const context = t('since', { since });
  const all = linkScope === 'all';
  const groups: MetricStripGroup[] = [
    {
      id: 'changes',
      items: [
        {
          id: 'lost',
          label: all ? t('lostAll') : t('lost'),
          value: formatInteger(all ? summary.all_lost : summary.editorial_lost),
          context,
        },
        {
          id: 'added',
          label: all ? t('addedAll') : t('added'),
          value: formatInteger(all ? summary.all_added : summary.editorial_added),
          context,
        },
        {
          id: 'lost-top',
          label: t('lostTop', { tiers }),
          value: formatInteger(summary.lost_to_top),
          context: t('editorialSince', { since }),
        },
        { id: 'pages-added', label: t('pagesAdded'), value: formatInteger(summary.pages_added), context },
        { id: 'pages-lost', label: t('pagesLost'), value: formatInteger(summary.pages_lost), context },
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-1">
      <MetricStrip size="md" label={t('label')} status="ready" groups={groups} />
      {all ? <p className="type-meta text-foreground-secondary">{t('scopeNote', { tiers })}</p> : null}
    </div>
  );
}
