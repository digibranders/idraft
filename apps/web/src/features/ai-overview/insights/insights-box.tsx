'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { INSIGHT_KEYS, openLines, type InsightCount, type InsightKey } from './insights-model';
import { useInsights, type InsightReads } from './use-insights';
import { useOverview } from '../overview-context';
import type { Read } from '../data/read-state';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInteger } from '@/lib/format';
import { projectPath, withQuery } from '@/lib/routes/paths';

/** Where each line leads: the page that holds the work (docs/superpowers/plans/2026-11-24-opportunities-feed.md). */
const DESTINATIONS: Readonly<Record<InsightKey, { path: `/${string}`; query: string }>> = {
  untracked: { path: '/ai/prompts', query: '' },
  gaps: { path: '/ai/citations/gaps', query: '' },
  citingCompetitors: { path: '/ai/citations', query: 'owner=third' },
  newDomains: { path: '/ai/citations', query: '' },
};
const ACTION_KEY = {
  untracked: 'startTracking',
  gaps: 'viewGaps',
  citingCompetitors: 'viewPages',
  newDomains: 'viewPages',
} as const satisfies Record<InsightKey, string>;

const ROW = 'flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2';

function LineSkeleton(): ReactElement {
  return (
    <li className={ROW} aria-hidden="true">
      <Skeleton shape="text-14" widthPct={48} />
    </li>
  );
}

/** One finding: its count, the sentence and the link; or, for a read that failed, the failure and Retry. */
function Line({ lineKey, read }: { lineKey: InsightKey; read: Read<InsightCount> }): ReactElement | null {
  const t = useTranslations('aiOverview.insights');
  const { workspaceSlug, project } = useOverview();
  if (read.status === 'loading') return <LineSkeleton />;
  if (read.status === 'error') {
    return (
      <li className={ROW}>
        <span className="min-w-0 flex-1 basis-60 type-body text-foreground-secondary">
          {t(`lines.${lineKey}.failed`)}
        </span>
        <Button variant="secondary" size="sm" onClick={read.refetch}>
          {t('retry')}
        </Button>
      </li>
    );
  }
  if (read.data === undefined || read.data.count === 0) return null;
  const { count, atLeast } = read.data;
  const { path, query } = DESTINATIONS[lineKey];
  const href = withQuery(projectPath(workspaceSlug, project.slug, path), query);
  const sentence = t(`lines.${lineKey}.text`, { count });
  return (
    <li className={ROW} data-insight={lineKey}>
      <span className="min-w-10 num type-metric-sm text-foreground">
        {formatInteger(count)}
        {atLeast ? t('atLeastMark') : ''}
      </span>
      <span className="min-w-0 flex-1 basis-60 type-body text-foreground">{sentence}</span>
      <LinkButton render={<Link href={href} />} size="sm" aria-label={`${t(ACTION_KEY[lineKey])}: ${sentence}`}>
        {t(ACTION_KEY[lineKey])}
      </LinkButton>
    </li>
  );
}

const settled = (reads: InsightReads): boolean => INSIGHT_KEYS.every((key) => reads[key].status !== 'loading');

/**
 * The Insights box at the top of the Overview grid (roadmap feature 4): a count, a sentence and a link to the page
 * that holds the work, per line. It counts the whole project, so the scope bar does not change it. Each line loads
 * and fails alone; a line at zero is left out, and with every line at zero the box says there is nothing to do.
 */
export function InsightsBox(): ReactElement {
  const t = useTranslations('aiOverview.insights');
  const reads = useInsights();
  const open = openLines({
    untracked: reads.untracked.data,
    gaps: reads.gaps.data,
    citingCompetitors: reads.citingCompetitors.data,
    newDomains: reads.newDomains.data,
  });
  return (
    <section
      aria-labelledby="overview-insights-title"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex min-h-12 items-center gap-2 px-4 py-3">
        <Icon icon={Sparkles} className="text-foreground-secondary" />
        <h2 id="overview-insights-title" className="type-section-title">
          {t('title')}
        </h2>
        <span className="type-meta">{t('meta')}</span>
      </div>
      <ul className="divide-y divide-border-subtle border-t border-border-subtle" aria-busy={!settled(reads)}>
        {INSIGHT_KEYS.map((key) => (
          <Line key={key} lineKey={key} read={reads[key]} />
        ))}
      </ul>
      {settled(reads) && open.length === 0 && INSIGHT_KEYS.every((key) => reads[key].status !== 'error') ? (
        <EmptyState variant="card" headingLevel={3} title={t('emptyTitle')} reason={t('emptyReason')} />
      ) : null}
    </section>
  );
}
