'use client';

import { Link2, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { askedEngines } from '../data/overview-queries';
import { useCurrentAggregates } from '../data/use-current-aggregates';
import { staleDaysOf } from '../notices/notice-model';
import { useNow } from '../notices/use-now';
import { useOverview, useOverviewFreshness } from '../overview-context';
import { metaLine } from './meta-line';
import { PageHeader } from '@/components/app/shell/page-header';
import { FreshnessIndicator } from '@/components/app/status/freshness-indicator';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { CustomizeButton, CustomizingBadge } from '@/features/layouts';
import { copyText } from '@/lib/dom/clipboard';
import { formatTableDateTime } from '@/lib/format';

/** The id of the More actions item that copies the link. */
const COPY_LINK = 'copy-link';

/**
 * The meta line: when the project's newest answer came, how many prompts are asked and on how many engines. The
 * freshness is a fact of the project (the last 92 days, no filter), so it does not move with the window; the prompts
 * and engines are those of the scope the numbers below show. Until the reads have answered it is a skeleton the
 * height of the line, so nothing moves; a failed freshness read leaves that fact out, and a project with no engine
 * on has no line.
 */
function useMeta(): ReactNode {
  const t = useTranslations('aiOverview.meta');
  const fresh = useTranslations('aiOverview.freshness');
  const { project, scope, engines, enabledEngines } = useOverview();
  const { aggregates, summary } = useCurrentAggregates();
  const freshness = useOverviewFreshness();
  const now = useNow();
  if (engines.status === 'error' || (engines.status === 'ready' && enabledEngines.length === 0)) return undefined;
  if (engines.status === 'loading' || summary.status === 'loading' || freshness.status === 'loading') {
    return <Skeleton shape="text-13" widthPct={48} />;
  }
  const promptCount = aggregates?.promptCount ?? null;
  const newest = freshness.data;
  let indicator: ReactNode = null;
  if (newest !== undefined) {
    const staleDays = staleDaysOf(newest.lastValidAt, now);
    indicator = (
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
  return metaLine([
    indicator,
    promptCount === null ? null : t('prompts', { count: promptCount }),
    t('engines', { count: askedEngines({ scope, enabledEngines }).length }),
  ]);
}

/**
 * The title block of the page (24 section 9.2, the approved preview): the title with the Customizing badge beside
 * it, the meta line under it, and Customize and More actions at the end. The Export menu joins them with the
 * export (T11). While the engines load there is no Customize: the layout counts AI cards as unavailable until they
 * are read, so entering the mode then would show every AI card as a placeholder.
 */
export function OverviewHeader(): ReactElement {
  const t = useTranslations('aiOverview');
  const common = useTranslations('common');
  const { engines } = useOverview();
  const meta = useMeta();
  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  return (
    <PageHeader
      title={t('title')}
      titleAddon={<CustomizingBadge />}
      meta={meta}
      actions={
        <>
          {engines.status === 'loading' ? (
            // The size of the Customize button, so the actions do not move when it arrives
            <span
              aria-hidden="true"
              className="hidden h-control w-28 animate-skeleton-pulse rounded-md bg-surface-subtle md:block"
            />
          ) : (
            <CustomizeButton />
          )}
          <Menu
            align="end"
            trigger={<IconButton icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
            items={[{ id: COPY_LINK, label: t('copyLink'), icon: Link2, onSelect: copyLink }]}
          />
        </>
      }
    />
  );
}
