'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { staleDaysOf } from '../notices/notice-model';
import { useNow } from '../notices/use-now';
import { useOverview, useOverviewFreshness } from '../overview-context';
import { FreshnessIndicator } from '@/components/app/status/freshness-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { formatTableDateTime } from '@/lib/format';

/**
 * When the project's newest answer came. It is a fact of the project (the last 92 days, no filter), so it does not
 * move with the scope: the toolbar holds no text that changes with the Platform and Group, and its row keeps its
 * shape. Until the reads have answered it is a skeleton the height of the line, so nothing moves; a failed read
 * leaves the fact out, and a project with no platform on has no line.
 */
function useFreshness(): ReactNode {
  const t = useTranslations('aiOverview.meta');
  const fresh = useTranslations('aiOverview.freshness');
  const { project, engines, enabledEngines } = useOverview();
  const freshness = useOverviewFreshness();
  const now = useNow();
  if (engines.status === 'error' || (engines.status === 'ready' && enabledEngines.length === 0)) return null;
  if (engines.status === 'loading' || freshness.status === 'loading') return <Skeleton shape="text-13" widthPct={48} />;
  const newest = freshness.data;
  if (newest === undefined) return null;
  const staleDays = staleDaysOf(newest.lastValidAt, now);
  return (
    <FreshnessIndicator
      state={newest.lastObservedAt === null ? 'none' : staleDays === null ? 'fresh' : 'stale'}
      lastAnswerAt={newest.lastObservedAt}
      timeZone={project.timeZone}
      text={
        newest.lastObservedAt === null
          ? fresh('none')
          : t('updated', { time: formatTableDateTime(newest.lastObservedAt, project.timeZone) })
      }
      badgeText={staleDays === null ? undefined : fresh('stale', { days: staleDays })}
      tooltip={(relative) => fresh('newest', { time: relative })}
    />
  );
}

export interface OverviewFreshnessProps {
  /** In the toolbar when there is room (from 1440 px), at the foot of the page otherwise. */
  place: 'toolbar' | 'foot';
}

/** The freshness text in one of its two places: only the one that fits the width draws it. */
export function OverviewFreshness({ place }: OverviewFreshnessProps): ReactElement | null {
  const roomy = useMediaQuery(MEDIA['2xl']);
  const node = useFreshness();
  if (node === null || roomy !== (place === 'toolbar')) return null;
  return place === 'toolbar' ? (
    <span data-slot="overview-meta" className="type-meta text-foreground-tertiary">
      {node}
    </span>
  ) : (
    <p data-slot="overview-meta" className="type-meta text-foreground-tertiary">
      {node}
    </p>
  );
}
