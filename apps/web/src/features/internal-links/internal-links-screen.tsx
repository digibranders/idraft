'use client';

import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { CrawlHeader } from './crawl-header';
import { crawlView, useCrawlNow, useCrawls, useWorkspaceTiers } from './crawl-reads';
import { CrawlBanners, FirstCrawl, failedText, NeverCrawled, NoWebsite, SkeletonRows } from './crawl-states';
import { SummaryStrip } from './summary-strip';
import { activeLinksTab, LINKS_TABS, type LinksTabContext } from './tabs';
import { useLinksState } from './url-state';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageToolbar } from '@/components/app/page-toolbar';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import type { CrawlRun, LinksScope } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { projectPath, withQuery, workspaceSettingsPath } from '@/lib/routes/paths';

/** The Pages tab filtered to the pages without a tier (the `tier` key of the filter bar, Task 7). */
const UNTIERED_QUERY = 'tier=none';

export interface InternalLinksProject {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  /** The project's website; `null` when none is set (spec 9 "No website"). */
  host: string | null;
}

export interface InternalLinksScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: InternalLinksProject;
}

/**
 * SEO > Internal links (spec 7, the mock `il.js`): the tabs with the page actions, the summary strip, the crawl
 * state banners, then the tab's own panel. Every number belongs to the latest finished crawl (decision W19).
 */
export function InternalLinksScreen(props: InternalLinksScreenProps): ReactNode {
  const t = useTranslations('internalLinks');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageToolbar title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <InternalLinksContent {...props} />;
}

function InternalLinksContent({ workspaceId, workspaceSlug, project }: InternalLinksScreenProps): ReactElement {
  const t = useTranslations('internalLinks');
  const states = useTranslations('internalLinks.states');
  const header = useTranslations('internalLinks.header');
  const common = useTranslations('common');
  const scope = useMemo((): LinksScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const host = project.host ?? '';
  const canCrawl = useCan('runs:trigger');
  const { state, setSearch } = useLinksState();
  // The end of a crawl is spoken once, when the poll sees it: a cancel is the person's own act and is not
  const announceEnd = useCallback(
    (run: CrawlRun): void => {
      if (run.state === 'failed') announce(states('endedFailed'), { key: 'internal-links-crawl' });
      else if (run.state !== 'cancelled') {
        announce(states('endedFinished', { count: run.pages_found }), { key: 'internal-links-crawl' });
      }
    },
    [states],
  );
  const crawls = useCrawls(scope, project.host !== null, announceEnd);
  const tiers = useWorkspaceTiers(workspaceId);
  const view = crawlView(
    project.host !== null,
    crawls.data?.data,
    crawls.isError ? 'error' : crawls.isPending ? 'loading' : 'ready',
  );
  const crawl = useCrawlNow(scope, host);

  const base = projectPath(workspaceSlug, project.slug, '/seo/internal-links');
  const settingsHref = projectPath(workspaceSlug, project.slug, '/settings/links');
  const tiersHref = workspaceSettingsPath(workspaceSlug, 'tiers');
  const domainsHref = projectPath(workspaceSlug, project.slug, '/settings/domains');
  const inspector = useInspector();
  // Task 9 reads the order for the inspector's Previous and Next: until then only the setter is used
  const [, setOrderState] = useState<readonly string[]>([]);
  // The table reports its order on every change of rows; an equal order keeps the state, so no render loop starts
  const setOrder = useCallback(
    (ids: readonly string[]) =>
      setOrderState((current) =>
        current.length === ids.length && current.every((id, place) => id === ids[place]) ? current : ids,
      ),
    [],
  );
  const [exportRun, setExportRun] = useState<(() => Promise<void>) | null>(null);
  const registerExport = useCallback((run: (() => Promise<void>) | null) => setExportRun(() => run), []);
  const onExport =
    exportRun === null
      ? null
      : () => {
          exportRun().catch(() => toast({ type: 'error', title: header('exportFailed') }));
        };

  const crawlNowButton = (
    <Button variant="primary" size="sm" loading={crawl.pending} disabled={!canCrawl} onClick={() => crawl.start()}>
      {header('crawlNow')}
    </Button>
  );

  const context: LinksTabContext = {
    scope,
    workspaceSlug,
    projectSlug: project.slug,
    timeZone: project.timeZone,
    host,
    state,
    setSearch,
    tiers: tiers.data?.data ?? [],
    inspect: {
      open: (urlId) => inspector.open({ type: 'page', id: urlId }),
      urlId: inspector.target?.type === 'page' ? inspector.target.id : null,
      setOrder,
    },
    openJourney: (urlId) =>
      setSearch({ tab: 'journey', focus: urlId, open: null, grp: null, more: null, topen: null }, { history: 'push' }),
    registerExport,
    hrefOf: (path) => projectPath(workspaceSlug, project.slug, path),
  };

  const tab = activeLinksTab(LINKS_TABS, state.tab);
  let body: ReactNode;
  switch (view.kind) {
    case 'no-website':
      body = <NoWebsite settingsHref={domainsHref} />;
      break;
    case 'loading':
      body = <SkeletonRows />;
      break;
    case 'error':
      body = (
        <InlineError
          title={states('loadFailed')}
          reason={states('loadFailedReason')}
          errorId={null}
          onRetry={() => void crawls.refetch()}
          retrying={crawls.isFetching}
          retryLabel={common('retry')}
        />
      );
      break;
    case 'never':
      body = <NeverCrawled host={host} crawlNow={crawlNowButton} />;
      break;
    case 'first':
      body = <FirstCrawl run={view.run} host={host} timeZone={project.timeZone} />;
      break;
    case 'failed-first':
      body = (
        <EmptyState
          title={states('failedLead')}
          reason={failedText(states, view.run, host)}
          headingLevel={2}
          primaryAction={
            <Button
              variant="primary"
              size="sm"
              loading={crawl.pending}
              disabled={!canCrawl}
              onClick={() => crawl.start()}
            >
              {states('retry')}
            </Button>
          }
        />
      );
      break;
    case 'ready':
      body = (
        <>
          <CrawlBanners
            latest={view.latest}
            active={view.active}
            failed={view.failed}
            host={host}
            timeZone={project.timeZone}
            settingsHref={settingsHref}
            canCrawl={canCrawl}
            onRetry={() => crawl.start()}
            onHigherLimit={() => crawl.start(true)}
          />
          {tab === null ? null : (
            <TabsPanel value={tab.id} className="flex min-w-0 flex-col gap-3">
              {tab.render(context)}
            </TabsPanel>
          )}
        </>
      );
      break;
  }

  const ready = view.kind === 'ready';
  return (
    <InspectorLayout inspector={null}>
      <div className={PAGE_CLASS}>
        <Tabs
          variant="segmented"
          label={t('tabs.label')}
          value={tab?.id ?? 'pages'}
          // The tab is the one change of the page that makes a history entry
          onValueChange={(next) => setSearch({ tab: next === 'pages' ? null : next }, { history: 'push' })}
          items={LINKS_TABS.map((entry) => ({ value: entry.id, label: entry.label(t) }))}
          renderList={(tabList) => (
            <PageToolbar
              title={t('title')}
              tabs={tabList}
              stats={ready ? <SummaryStrip scope={scope} untieredHref={withQuery(base, UNTIERED_QUERY)} /> : null}
              actions={
                // The empty states carry their own action; the header shows once there is a crawl to act on
                view.kind === 'no-website' || view.kind === 'never' || view.kind === 'failed-first' ? null : (
                  <CrawlHeader
                    latest={view.kind === 'ready' ? view.latest : null}
                    active={view.kind === 'ready' ? view.active : view.kind === 'first' ? view.run : null}
                    timeZone={project.timeZone}
                    canCrawl={canCrawl}
                    crawlPending={crawl.pending}
                    onCrawlNow={() => crawl.start()}
                    onExport={ready ? onExport : null}
                    settingsHref={settingsHref}
                    tiersHref={tiersHref}
                  />
                )
              }
            />
          )}
          className="gap-3"
        >
          {body}
        </Tabs>
      </div>
    </InspectorLayout>
  );
}
