'use client';

import { Ban } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';

import { OverviewTab } from './overview-tab';
import { usePagesState } from './use-pages-state';
import { ContextLine } from '../context-line';
import { CrawlDialogs, useCrawlDialogs } from '../crawl-dialogs';
import { CrawlHeader } from '../crawl-header';
import { CrawlNotFound } from '../crawl-not-found';
import { CrawlPicker } from '../crawl-picker';
import { useCrawlShell, usePageExport } from '../crawl-shell';
import { useClientSummary } from '../export/use-client-summary';
import { issueCheckHref, type PageDrawerContext } from '../inspector/page-drawer-context';
import { PageInspector, PageNotFoundInspector } from '../inspector/page-inspector';
import type { InternalLinksProject } from '../internal-links-screen';
import { UNTIERED_QUERY } from '../pages/page-filters';
import type { PagesContext } from '../pages/pages-context';
import { PagesTab } from '../pages/pages-tab';
import { PagesTabStrip } from './pages-tab-strip';

import { inspectedPage } from '../url-state';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageToolbar } from '@/components/app/page-toolbar';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import type { PagesTabId } from '@/lib/pages/tabs';
import { PAGES_DEFAULT_SORT } from '@/lib/pages/url-state';
import { useCan } from '@/lib/permissions';
import { integrationsPath, pagesTabPath, projectPath, withQuery } from '@/lib/routes/paths';

const HEADING_ID = 'pages-heading';
const INTERNAL_LINKS_PATH = '/seo/internal-links';
const TAXONOMY_PATH = '/settings/taxonomy';
const CHANGES_TAB = { tab: 'changes' };
const PAGE_BODY_CLASS = 'flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5';

export interface PagesScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: InternalLinksProject;
  tab: Extract<PagesTabId, 'overview' | 'all'>;
}

/**
 * SEO > Pages (spec 5.1): the Overview and All pages as two route tabs over one crawl shell, with the page drawer over
 * the page. Every number belongs to the crawl in view, as on Internal links.
 */
export function PagesScreen(props: PagesScreenProps): ReactNode {
  const t = useTranslations('pages');
  const links = useTranslations('internalLinks');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageToolbar title={t('title')} />
        <EmptyState icon={Ban} title={links('noAccessTitle')} reason={links('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <PagesContent {...props} />;
}

function PagesContent({ workspaceId, workspaceSlug, project, tab }: PagesScreenProps): ReactElement {
  const t = useTranslations('pages');
  const { state, setSearch } = usePagesState();
  const router = useRouter();
  const canNote = useCan('notes:write');
  const actions = useCrawlDialogs();
  const { canWrite } = actions;
  const shell = useCrawlShell({
    workspaceId,
    workspaceSlug,
    project,
    run: state.run,
    firstCrawlActions: actions.buttons,
  });
  const { scope, host, view, inView, crawl, canCrawl, canEditTiers, runs } = shell;
  const ready = view.kind === 'ready';
  const crawlNotFound = inView.unknown || state.invalidRun !== null;
  const chooseCrawl = (next: string | null): void => setSearch({ run: next }, { history: 'push' });
  const backToLatest = (): void => {
    chooseCrawl(null);
    document.getElementById(HEADING_ID)?.focus();
  };

  const inspector = useInspector();
  const inspected = inspectedPage(inspector.target);
  const [order, setOrder] = useState<readonly string[]>([]);
  const inspectorWords = useTranslations('internalLinks.inspector');
  const stepping = useInspectorStepping({
    inspector,
    type: 'page',
    order,
    typeLabel: inspectorWords('typeLabel'),
    typeNoun: inspectorWords('typeNoun'),
  });
  const { registerExport, onExport, exporting } = usePageExport();
  const summary = useClientSummary({ scope, view: inView, host, timeZone: project.timeZone });
  const summaryReady = ready && inView.crawl !== null && !crawlNotFound;

  const run = inView.run;
  // Only the crawl in view travels between the tabs, and to Internal links
  const withRun = useCallback(
    (path: Route, values: Record<string, string> = {}): Route => {
      const query = new URLSearchParams(values);
      if (run !== null) query.set('run', run);
      return withQuery(path, query.toString());
    },
    [run],
  );
  const linksBase = projectPath(workspaceSlug, project.slug, INTERNAL_LINKS_PATH);
  const allPages = useCallback(
    (query: Record<string, string>): Route => withRun(pagesTabPath(workspaceSlug, project.slug, 'all'), query),
    [withRun, workspaceSlug, project.slug],
  );

  const pagesContext: PagesContext = {
    scope,
    host,
    timeZone: project.timeZone,
    crawl: inView,
    tiers: shell.tiers,
    state,
    defaultSort: PAGES_DEFAULT_SORT,
    setSearch,
    inspect: { open: (urlId) => inspector.open({ type: 'page', id: urlId }), setOrder, ...inspected },
    openJourney: (urlId) => router.push(withRun(linksBase, { tab: 'journey', focus: urlId })),
    openEdgeWorklist: (worklist) => router.push(withRun(linksBase, { tab: 'links', lview: worklist, scope: 'all' })),
    registerExport,
    taxonomyHref: projectPath(workspaceSlug, project.slug, TAXONOMY_PATH),
  };
  const drawerContext: PageDrawerContext = {
    scope,
    host,
    workspaceSlug,
    projectSlug: project.slug,
    crawl: inView,
    linkScope: state.scope,
    tiers: shell.tiers,
    timeZone: project.timeZone,
    canWrite,
    canNote,
    openPage: pagesContext.inspect.open,
    hrefs: {
      journey: (urlId) => withRun(linksBase, { tab: 'journey', focus: urlId }),
      // The scope travels only when it is not the default, as the address of Internal links reads it
      linksFrom: (urlId) =>
        withRun(linksBase, {
          tab: 'links',
          src: urlId,
          ...(state.scope === 'editorial' ? {} : { scope: state.scope }),
        }),
      linksTo: (urlId) =>
        withRun(linksBase, {
          tab: 'links',
          tgt: urlId,
          ...(state.scope === 'editorial' ? {} : { scope: state.scope }),
        }),
      issueCheck: issueCheckHref(projectPath(workspaceSlug, project.slug, '/seo/issues')),
      taxonomy: pagesContext.taxonomyHref,
      integrations: integrationsPath(workspaceSlug, project.slug),
    },
  };

  const tabList = (
    <PagesTabStrip
      workspaceSlug={workspaceSlug}
      projectSlug={project.slug}
      current={tab}
      // The crawl in view travels between Overview and All pages; Monitoring has no crawl
      hrefOf={(id, route) => (id === 'monitoring' ? route : withRun(route))}
    />
  );
  const toolbar = (
    <PageToolbar title={t('title')} headingId={HEADING_ID}>
      {view.kind === 'ready' || view.kind === 'first' ? (
        <CrawlHeader
          layout="one-line"
          tabs={tabList}
          activeTab={tab}
          context={
            ready ? (
              <>
                <CrawlPicker
                  runs={runs}
                  run={inView.run}
                  timeZone={project.timeZone}
                  needsLinks={false}
                  onChoose={chooseCrawl}
                  onBack={backToLatest}
                />
                <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
                <ContextLine
                  scope={scope}
                  run={inView.run}
                  timeZone={project.timeZone}
                  untieredHref={allPages(Object.fromEntries(new URLSearchParams(UNTIERED_QUERY)))}
                  changesHref={withRun(linksBase, CHANGES_TAB)}
                />
              </>
            ) : undefined
          }
          active={view.kind === 'ready' ? view.active : view.run}
          timeZone={project.timeZone}
          canCrawl={canCrawl}
          canEditTiers={canEditTiers}
          crawlPending={crawl.pending}
          crawlsOff={crawl.crawlsOff}
          onCrawlNow={() => crawl.start()}
          onExport={ready ? onExport : null}
          exporting={exporting}
          onSummary={summaryReady ? summary.run : null}
          summaryPreparing={summary.preparing}
          onShare={summaryReady ? () => actions.setDialog('share') : null}
          extraItems={actions.items}
          settingsHref={shell.hrefs.settings}
          tiersHref={shell.hrefs.tiers}
        />
      ) : null}
    </PageToolbar>
  );

  const body: ReactNode =
    shell.stateBody ??
    (crawlNotFound ? (
      <CrawlNotFound onBack={backToLatest} />
    ) : (
      <>
        {shell.notice}
        {shell.banners}
        {tab === 'overview' ? (
          <OverviewTab
            scope={scope}
            run={inView.run}
            workspaceSlug={workspaceSlug}
            projectSlug={project.slug}
            allPages={allPages}
            registerExport={registerExport}
          />
        ) : (
          <PagesTab context={pagesContext} />
        )}
      </>
    ));

  let inspectorHost: ReactElement | null = null;
  // No drawer for a crawl that is not shown: its page belongs to no crawl on screen
  if (inspector.target?.type === 'page' && ready && !crawlNotFound) {
    inspectorHost =
      inspected.urlId === null ? (
        <PageNotFoundInspector key={inspector.target.id} onClose={inspector.close} />
      ) : (
        <PageInspector
          key={inspected.urlId}
          context={drawerContext}
          urlId={inspected.urlId}
          positionText={stepping.positionText}
          navigation={stepping.navigation}
          onStep={stepping.onStep}
          onClose={inspector.close}
        />
      );
  }
  return (
    <InspectorLayout inspector={inspectorHost}>
      <div className={PAGE_BODY_CLASS}>
        {toolbar}
        {body}
      </div>
      <CrawlDialogs actions={actions} scope={scope} host={host} tiers={shell.tiers} timeZone={project.timeZone} />
    </InspectorLayout>
  );
}
