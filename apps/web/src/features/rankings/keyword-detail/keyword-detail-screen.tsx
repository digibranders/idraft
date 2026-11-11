'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, SearchX } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';

import { KeywordDetailHeader } from './detail-header';
import { DetailStrip } from './detail-strip';
import { useDetailUrlState, type DetailTab } from './detail-url-state';
import { EventsPanel } from './events-panel';
import { listReturnHref, tabStorage } from './list-return';
import { RankHistoryPanel } from './rank-history-panel';
import { SnapshotsTab } from './snapshots/snapshots-tab';
import { useCheckNow } from '../check-now/use-check-now';
import { CHECK_POLL_MS, hasPendingCheck } from '../rankings-queries';
import { detailQuery, type KeywordScope } from '../keyword-inspector/inspector-queries';
import { SectionError } from '../keyword-inspector/section-error';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { useCan } from '@/lib/permissions';
import { projectPath, rankingsPath } from '@/lib/routes/paths';

export interface KeywordDetailScreenProps {
  workspaceId: string;
  projectId: string;
  /** The slugs in the URL, for the paths of the list and of the page itself. */
  workspaceSlug: string;
  projectSlug: string;
  trackedKeywordId: string;
  /** The project's time zone, for dates. */
  timeZone: string;
}

const EMPTY_SELECTION = { ids: new Set<string>(), allMatching: false };
const noop = (): void => undefined;
const TAB_ITEMS: readonly DetailTab[] = ['overview', 'snapshots'];

/** The list as the person left it. Server and first client render lead to the bare list: the storage is the browser's. */
function useListHref(workspaceSlug: string, projectSlug: string): Route {
  const bare = rankingsPath(workspaceSlug, projectSlug);
  return useSyncExternalStore(
    () => noop,
    () => listReturnHref(tabStorage(), bare),
    () => bare,
  );
}

/**
 * The page of one tracked keyword (20-frontend-specification.md section 5.4, 24-page-templates.md section
 * 9.4). It needs `data:read`, as every rank route does. This task builds the route, the header, the tabs and
 * the states; the sections of each tab join with the tasks that follow, each reading `detailStateOf` so
 * that the whole page says the same about the keyword.
 */
export function KeywordDetailScreen(props: KeywordDetailScreenProps): ReactElement {
  const canRead = useCan('data:read');
  return canRead ? <KeywordDetailContent {...props} /> : <NoAccess {...props} />;
}

function NoAccess({ workspaceSlug, projectSlug }: KeywordDetailScreenProps): ReactElement {
  const t = useTranslations('keywordDetail');
  return (
    <div className={PAGE_CLASS}>
      <EmptyState
        icon={Ban}
        title={t('noAccess.title')}
        reason={t('noAccess.reason')}
        headingLevel={1}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, projectSlug)} />}>
            {t('noAccess.toOverview')}
          </TextLink>
        }
      />
    </div>
  );
}

function KeywordDetailContent({
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
  trackedKeywordId,
  timeZone,
}: KeywordDetailScreenProps): ReactElement {
  const t = useTranslations('keywordDetail');
  const canCheck = useCan('runs:trigger');
  const { tab, setTab } = useDetailUrlState();
  const backHref = useListHref(workspaceSlug, projectSlug);
  const scope = useMemo(
    (): KeywordScope => ({ workspaceId, projectId, trackedKeywordId }),
    [workspaceId, projectId, trackedKeywordId],
  );
  // Read again while a check is queued or being answered, as the list does, so Check now comes back by itself
  const detail = useQuery({
    ...detailQuery(scope),
    refetchInterval: (query) => (query.state.data && hasPendingCheck(query.state.data.data) ? CHECK_POLL_MS : false),
  });
  const data = detail.data?.data ?? null;
  // The keyword has no list here to drop from. A keyword deleted while the page is open keeps showing the last
  // read until the page loads again: TanStack Query keeps the data of a read that failed, and `data` wins below
  const pendingIds = useMemo(
    (): ReadonlySet<string> => new Set(data !== null && hasPendingCheck(data) ? [trackedKeywordId] : []),
    [data, trackedKeywordId],
  );
  const checkNow = useCheckNow({
    scope,
    enabled: canCheck,
    archived: false,
    chosen: EMPTY_SELECTION,
    pendingIds,
    onDrop: noop,
  });

  if (data === null) {
    if (detail.isError) {
      return isApiProblem(detail.error, 'not_found') ? (
        <div className={PAGE_CLASS}>
          <EmptyState
            icon={SearchX}
            title={t('notFound.title')}
            reason={t('notFound.reason')}
            headingLevel={1}
            secondaryAction={<TextLink render={<Link href={backHref} />}>{t('notFound.toList')}</TextLink>}
          />
        </div>
      ) : (
        <div className={PAGE_CLASS}>
          <SectionError
            title={t('loadFailed.title')}
            reason={t('loadFailed.reason')}
            error={detail.error}
            onRetry={() => void detail.refetch()}
            retrying={detail.isFetching}
          />
        </div>
      );
    }
    return <DetailSkeleton label={t('loading')} />;
  }

  const items = TAB_ITEMS.map((value) => ({ value, label: t(`tabs.${value}`) }));
  return (
    <div className={PAGE_CLASS}>
      <KeywordDetailHeader
        scope={scope}
        detail={data}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        timeZone={timeZone}
        backHref={backHref}
        checkNow={checkNow}
      />
      {checkNow.progress}
      <DetailStrip scope={scope} detail={data} timeZone={timeZone} />
      <Tabs
        variant="underline"
        label={t('tabs.label')}
        value={tab}
        onValueChange={(next) => void setTab(next)}
        items={items}
      >
        <TabsPanel<DetailTab> value="overview" className="pt-4">
          {/* The evidence column is 8 of 12 from 1280 px and the full width below; the right rail joins it later */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 flex min-w-0 flex-col gap-4 xl:col-span-8">
              <RankHistoryPanel scope={scope} detail={data} timeZone={timeZone} />
            </div>
            <div className="col-span-12 flex min-w-0 flex-col gap-4 xl:col-span-4">
              <EventsPanel
                scope={scope}
                detail={data}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                timeZone={timeZone}
              />
            </div>
          </div>
        </TabsPanel>
        <TabsPanel<DetailTab> value="snapshots" className="pt-4">
          <SnapshotsTab scope={scope} detail={data} timeZone={timeZone} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}

/** The shape of the header while the keyword loads: the back link, the title, two meta lines and the tabs. */
function DetailSkeleton({ label }: { label: string }): ReactNode {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={PAGE_CLASS}>
      <div className="flex w-72 max-w-full flex-col gap-2">
        <Skeleton shape="text-12" widthPct={48} />
        <Skeleton shape="text-14" widthPct={80} />
        <Skeleton shape="text-12" widthPct={100} />
        <Skeleton shape="text-12" widthPct={64} />
      </div>
      <Skeleton shape="block" height="row" />
    </div>
  );
}
