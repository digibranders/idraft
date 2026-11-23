'use client';

import { Ban, ListFilter, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { ContextLine } from './context-line';
import { CrawlButton } from './crawl-button';
import { CrawlHeader } from './crawl-header';
import { CrawlNotFound } from './crawl-not-found';
import { CrawlPicker } from './crawl-picker';
import { crawlView, useCrawlNow, useCrawls, useWorkspaceTiers } from './crawl-reads';
import { CrawlBanners, CrawlsOffNotice, FirstCrawl, NeverCrawled, NoWebsite, SkeletonRows } from './crawl-states';
import { useClientSummary } from './export/use-client-summary';
import { PageInspector, PageNotFoundInspector } from './inspector/page-inspector';
import { UNTIERED_QUERY } from './pages/page-filters';
import { ImportDialog } from './rules/import-dialog';
import { RulesDialog } from './rules/rules-dialog';
import { AlertRulesDialog } from './settings/alert-rules-dialog';
import { TabBadge } from './tab-badge';
import { activeLinksTab, LINK_LEVEL_TABS, LINKS_TABS, type LinksTabContext } from './tabs';
import { useTabBadges } from './use-tab-badges';
import { inspectedPage, useLinksState, type LinksTabId } from './url-state';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageToolbar } from '@/components/app/page-toolbar';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import { isApiProblem } from '@/lib/api/problem';
import { crawlInView } from '@/lib/internal-links/crawl-choice';
import { failedText } from '@/lib/internal-links/crawl-failure';
import type { CrawlRun, LinksScope } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { projectPath, withQuery, workspaceSettingsPath } from '@/lib/routes/paths';

const CHANGES_QUERY = 'tab=changes';
const HEADING_ID = 'internal-links-heading';
const TAB_LIST_CLASS = 'max-w-full overflow-x-auto scrollbar-none';

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
  // The crawl every tab reads: the one `run` names, else the latest (an unknown id reads the latest, never wider)
  const inView = useMemo(() => crawlInView(crawls.data?.data ?? [], state.run), [crawls.data, state.run]);

  const ready = view.kind === 'ready';
  const registered = (id: LinksTabId): boolean => LINKS_TABS.some((entry) => entry.id === id);
  const badges = useTabBadges(
    scope,
    inView.run,
    { changes: ready && registered('changes'), opportunities: ready && registered('opportunities') },
    inView.linksAvailable,
  );
  const badgeWords = useTranslations('internalLinks.header');
  // The address names a crawl that cannot be shown: a malformed id, or one with no data in the project's list
  const crawlNotFound = inView.unknown || state.invalid.run !== null;
  // Choosing a crawl is a move like a tab change: it makes a history entry, so Back returns to the crawl before
  const chooseCrawl = (next: string | null): void => setSearch({ run: next }, { history: 'push' });
  // "Back to latest" removes the button that was pressed, so focus goes to the page heading, not to the page body
  const backToLatest = (): void => {
    chooseCrawl(null);
    document.getElementById(HEADING_ID)?.focus();
  };

  const base = projectPath(workspaceSlug, project.slug, '/seo/internal-links');
  const settingsHref = projectPath(workspaceSlug, project.slug, '/settings/links');
  const tiersHref = workspaceSettingsPath(workspaceSlug, 'tiers');
  const domainsHref = projectPath(workspaceSlug, project.slug, '/settings/domains');
  const inspector = useInspector();
  const inspected = inspectedPage(inspector.target);
  // The rows the open tab shows, in order: the inspector's "12 of 986" and its J and K step through them
  const [order, setOrder] = useState<readonly string[]>([]);
  const canWrite = useCan('projects:write');
  // Anyone who reads the project reads the rules; only a member who may write sets them or imports tiers
  const [dialog, setDialog] = useState<'rules' | 'import' | 'alerts' | null>(null);
  const ruleItems: MenuItemDef[] = [
    { id: 'rules', label: t('rules.open'), icon: ListFilter, onSelect: () => setDialog('rules') },
    ...(canWrite ? [{ id: 'import', label: t('csv.open'), icon: Upload, onSelect: () => setDialog('import') }] : []),
  ];
  const ruleButtons = canWrite ? (
    <>
      <Button variant="secondary" size="sm" onClick={() => setDialog('rules')}>
        {t('rules.setUp')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setDialog('import')}>
        {t('csv.open')}
      </Button>
    </>
  ) : undefined;
  const inspectorWords = useTranslations('internalLinks.inspector');
  const stepping = useInspectorStepping({
    inspector,
    type: 'page',
    order,
    typeLabel: inspectorWords('typeLabel'),
    typeNoun: inspectorWords('typeNoun'),
  });
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

  const summary = useClientSummary({ scope, view: inView, host, timeZone: project.timeZone });

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
    crawl: inView,
    setSearch,
    tiers: tiers.data?.data ?? [],
    // A page the address names that is no url id is a page that does not exist: the tab shows not found for `invalid`
    inspect: { open: (urlId) => inspector.open({ type: 'page', id: urlId }), setOrder, ...inspected },
    openJourney: (urlId) =>
      setSearch(
        { tab: 'journey', focus: urlId, open: null, grp: null, more: null, topen: null, inspect: null, itab: null },
        { history: 'push' },
      ),
    registerExport,
    openAlertSettings: canWrite ? () => setDialog('alerts') : null,
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
      body = <FirstCrawl run={view.run} host={host} timeZone={project.timeZone} actions={ruleButtons} />;
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
              {crawlNotFound ? <CrawlNotFound onBack={backToLatest} /> : tab.render(context)}
            </TabsPanel>
          )}
        </>
      );
      break;
  }

  const needsLinks = LINK_LEVEL_TABS.has(tab?.id ?? 'pages');
  // The page actions belong to a crawl that is read or under way; the other states carry their own action
  const toolbar = (tabList: ReactElement | undefined): ReactElement => (
    <PageToolbar title={t('title')} headingId={HEADING_ID}>
      {view.kind === 'ready' || view.kind === 'first' ? (
        <CrawlHeader
          tabs={tabList}
          activeTab={tab?.id}
          context={
            ready ? (
              <>
                <CrawlPicker
                  runs={crawls.data?.data ?? []}
                  run={inView.run}
                  timeZone={project.timeZone}
                  needsLinks={needsLinks}
                  onChoose={chooseCrawl}
                  onBack={backToLatest}
                />
                <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
                <ContextLine
                  scope={scope}
                  run={inView.run}
                  timeZone={project.timeZone}
                  untieredHref={withQuery(base, UNTIERED_QUERY)}
                  changesHref={registered('changes') ? withQuery(base, CHANGES_QUERY) : null}
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
          onSummary={ready && inView.crawl !== null && !crawlNotFound ? summary.run : null}
          summaryPreparing={summary.preparing}
          extraItems={ruleItems}
          settingsHref={settingsHref}
          tiersHref={tiersHref}
        />
      ) : null}
    </PageToolbar>
  );
  let inspectorHost: ReactElement | null = null;
  // No inspector for a crawl that is not shown: its page belongs to no crawl on screen
  if (inspector.target?.type === 'page' && ready && !crawlNotFound) {
    inspectorHost =
      inspected.urlId === null ? (
        <PageNotFoundInspector key={inspector.target.id} onClose={inspector.close} />
      ) : (
        <PageInspector
          key={inspected.urlId}
          context={context}
          urlId={inspected.urlId}
          canWrite={canWrite}
          positionText={stepping.positionText}
          navigation={stepping.navigation}
          onStep={stepping.onStep}
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
            onValueChange={(next) =>
              // The inspector opened from the journey belongs to it: it closes with the tab
              setSearch(
                {
                  tab: next === 'pages' ? null : next,
                  ...(state.tab === 'journey' ? { inspect: null, itab: null } : {}),
                },
                { history: 'push' },
              )
            }
            items={LINKS_TABS.map((entry) => ({
              value: entry.id,
              label: entry.label(t),
              icon: entry.icon,
              ...(entry.id === 'changes' && badges.changes !== null
                ? {
                    badge: (
                      <TabBadge
                        count={badges.changes}
                        text={badgeWords('badgeAlerts', { count: badges.changes })}
                        tone="negative"
                      />
                    ),
                  }
                : {}),
              ...(entry.id === 'opportunities' && badges.opportunities !== null
                ? {
                    badge: (
                      <TabBadge
                        count={badges.opportunities}
                        text={badgeWords('badgeOpen', { count: badges.opportunities })}
                        tone="neutral"
                      />
                    ),
                  }
                : {}),
            }))}
            // Six tabs with badges are wider than a phone: the list scrolls inside itself (spec 7.1)
            listClassName={TAB_LIST_CLASS}
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
      <RulesDialog
        open={dialog === 'rules'}
        onOpenChange={(next) => setDialog(next ? 'rules' : null)}
        scope={scope}
        tiers={context.tiers}
        canWrite={canWrite}
      />
      {canWrite ? (
        <AlertRulesDialog
          open={dialog === 'alerts'}
          onOpenChange={(next) => setDialog(next ? 'alerts' : null)}
          scope={scope}
          tierCount={tiers.data?.data.length ?? null}
          fallbackFocus={() => document.getElementById(HEADING_ID)}
        />
      ) : null}
      {canWrite ? (
        <ImportDialog
          open={dialog === 'import'}
          onOpenChange={(next) => setDialog(next ? 'import' : null)}
          scope={scope}
          tiers={context.tiers}
        />
      ) : null}
    </InspectorLayout>
  );
}
