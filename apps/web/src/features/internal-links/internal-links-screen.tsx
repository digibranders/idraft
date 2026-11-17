'use client';

import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { CrawlButton } from './crawl-button';
import { CrawlHeader } from './crawl-header';
import { crawlView, useCrawlNow, useCrawls, useWorkspaceTiers } from './crawl-reads';
import {
  CrawlBanners,
  CrawlsOffNotice,
  FirstCrawl,
  failedText,
  NeverCrawled,
  NoWebsite,
  SkeletonRows,
} from './crawl-states';
import { PageInspector, PageNotFoundInspector } from './inspector/page-inspector';
import { UNTIERED_QUERY } from './pages/page-filters';
import { SummaryStrip } from './summary-strip';
import { activeLinksTab, LINKS_TABS, type LinksTabContext } from './tabs';
import { inspectedPage, useLinksState } from './url-state';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageToolbar } from '@/components/app/page-toolbar';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import type { CrawlRun, LinksScope } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { projectPath, withQuery, workspaceSettingsPath } from '@/lib/routes/paths';

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
 * state banners, then the tab's own panel. Every number belongs to the latest finished crawl (decision W19). The tab
 * list is drawn only where there is a panel to switch: with a crawl to read.
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
  const canEditTiers = useCan('workspace:update');
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
    crawls.data?.page.has_more ?? false,
  );
  const crawl = useCrawlNow(scope, host);

  const base = projectPath(workspaceSlug, project.slug, '/seo/internal-links');
  const settingsHref = projectPath(workspaceSlug, project.slug, '/settings/links');
  const tiersHref = workspaceSettingsPath(workspaceSlug, 'tiers');
  const domainsHref = projectPath(workspaceSlug, project.slug, '/settings/domains');
  const inspector = useInspector();
  const inspected = inspectedPage(inspector.target);
  // The rows the open tab shows, in order: the inspector's "12 of 986" and its J and K step through them
  const [order, setOrder] = useState<readonly string[]>([]);
  const canWrite = useCan('projects:write');
  const at = inspector.position(order);
  const [exportRun, setExportRun] = useState<(() => Promise<void>) | null>(null);
  const registerExport = useCallback((run: (() => Promise<void>) | null) => setExportRun(() => run), []);
  // One download at a time: a second press while the file is being made would start the same file again
  const [exporting, setExporting] = useState(false);
  const exportingNow = useRef(false);
  const onExport =
    exportRun === null
      ? null
      : () => {
          if (exportingNow.current) return;
          exportingNow.current = true;
          setExporting(true);
          exportRun()
            .catch((error: unknown) => {
              // What the API said, when it said something (a problem's detail, else its title)
              const reason = isApiProblem(error) ? (error.detail ?? error.string('title')) : null;
              toast({
                type: 'error',
                title: header('exportFailed'),
                ...(reason === null ? {} : { description: reason }),
              });
            })
            .finally(() => {
              exportingNow.current = false;
              setExporting(false);
            });
        };

  // Only someone who may crawl can have pressed Crawl now, so only they are told crawls are not switched on yet
  // It is a child of the page's own column (`gap-3`) or of the tabs' (`gap-3`), so its spacing comes from the layout
  const notice =
    crawl.crawlsOff && canCrawl ? <CrawlsOffNotice pending={crawl.pending} onCheckAgain={() => crawl.start()} /> : null;
  const crawlButton = (label: string): ReactElement => (
    <CrawlButton
      label={label}
      canCrawl={canCrawl}
      pending={crawl.pending}
      crawlsOff={crawl.crawlsOff}
      startedAgo={null}
      onClick={() => crawl.start()}
    />
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
    // A page the address names that is no url id is a page that does not exist: the tab shows not found for `invalid`
    inspect: { open: (urlId) => inspector.open({ type: 'page', id: urlId }), setOrder, ...inspected },
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
    case 'unknown':
      body = (
        <InlineError
          title={states('loadFailed')}
          reason={view.kind === 'error' ? states('loadFailedReason') : states('unknownReason')}
          errorId={null}
          onRetry={() => void crawls.refetch()}
          retrying={crawls.isFetching}
          retryLabel={common('retry')}
        />
      );
      break;
    case 'never':
      body = (
        <>
          {notice}
          <NeverCrawled host={host} crawlNow={crawlButton(header('crawlNow'))} />
        </>
      );
      break;
    case 'first':
      body = <FirstCrawl run={view.run} host={host} timeZone={project.timeZone} />;
      break;
    case 'failed-first':
      body = (
        <>
          {notice}
          <EmptyState
            title={states('failedLead')}
            reason={failedText(states, view.run, host)}
            headingLevel={2}
            primaryAction={crawlButton(states('retry'))}
          />
        </>
      );
      break;
    case 'ready':
      body = (
        <>
          {notice}
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
  // The page actions belong to a crawl that is read or under way; the other states carry their own action
  const actions =
    view.kind === 'ready' || view.kind === 'first' ? (
      <CrawlHeader
        latest={view.kind === 'ready' ? view.latest : null}
        active={view.kind === 'ready' ? view.active : view.run}
        timeZone={project.timeZone}
        canCrawl={canCrawl}
        canEditTiers={canEditTiers}
        crawlPending={crawl.pending}
        crawlsOff={crawl.crawlsOff}
        onCrawlNow={() => crawl.start()}
        onExport={ready ? onExport : null}
        exporting={exporting}
        settingsHref={settingsHref}
        tiersHref={tiersHref}
      />
    ) : null;
  const toolbar = (tabs: ReactElement | undefined): ReactElement => (
    <PageToolbar
      title={t('title')}
      tabs={tabs}
      stats={ready ? <SummaryStrip scope={scope} untieredHref={withQuery(base, UNTIERED_QUERY)} /> : null}
      actions={actions}
    />
  );
  let inspectorHost: ReactElement | null = null;
  if (inspector.target?.type === 'page' && ready) {
    inspectorHost =
      inspected.urlId === null ? (
        <PageNotFoundInspector key={inspector.target.id} onClose={inspector.close} />
      ) : (
        <PageInspector
          key={inspected.urlId}
          context={context}
          urlId={inspected.urlId}
          canWrite={canWrite}
          positionText={at === null ? null : t('inspector.position', { index: at.index + 1, count: at.count })}
          navigation={
            at === null
              ? null
              : {
                  onPrevious: () => inspector.step('previous', order),
                  onNext: () => inspector.step('next', order),
                  atFirst: at.index === 0,
                  atLast: at.index === at.count - 1,
                }
          }
          onStep={(direction) => inspector.step(direction, order)}
          onClose={inspector.close}
        />
      );
  }
  return (
    <InspectorLayout inspector={inspectorHost}>
      <div className={PAGE_CLASS}>
        {ready ? (
          <Tabs
            variant="segmented"
            label={t('tabs.label')}
            value={tab?.id ?? 'pages'}
            // The tab is the one change of the page that makes a history entry
            onValueChange={(next) => setSearch({ tab: next === 'pages' ? null : next }, { history: 'push' })}
            items={LINKS_TABS.map((entry) => ({ value: entry.id, label: entry.label(t) }))}
            renderList={toolbar}
            className="gap-3"
          >
            {body}
          </Tabs>
        ) : (
          <>
            {toolbar(undefined)}
            {body}
          </>
        )}
      </div>
    </InspectorLayout>
  );
}
