'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, Download, RefreshCw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { CheckView } from './check-view';
import { useCheckWords } from './check-words';
import { ChecksTable } from './checks-table';
import { IssuesStrip } from './issues-strip';
import { useFileExport } from './use-file-export';
import { useIssuesState } from './use-issues-state';
import { useResultAnnouncement } from './use-result-announcement';
import { CrawlButton } from '../crawl-button';
import { crawlView, useCrawlNow, useCrawls, useWorkspaceTiers } from '../crawl-reads';
import { CrawlBanners, CrawlsOffNotice, FirstCrawl, NeverCrawled, NoWebsite, SkeletonRows } from '../crawl-states';
import { drawerContextOf } from '../inspector/page-drawer-context';
import { PageInspector, PageNotFoundInspector } from '../inspector/page-inspector';
import type { InternalLinksScreenProps } from '../internal-links-screen';
import { TabBadge } from '../tab-badge';
import type { LinksTabContext } from '../tabs';
import { inspectedPage, parseLinksSearch, type SetLinksSearch } from '../url-state';
import { PressedGroup } from '@/components/app/filters/pressed-group';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageToolbar } from '@/components/app/page-toolbar';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { Select } from '@/components/ui/select';
import { Tabs, TabsPanel, type TabItem } from '@/components/ui/tabs';
import { announce } from '@/lib/a11y/announcer';
import { downloadApiFile } from '@/lib/api/download';
import { formatInteger, formatRelative, formatTableDate } from '@/lib/format';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import { crawlInView } from '@/lib/internal-links/crawl-choice';
import { failedText } from '@/lib/internal-links/crawl-failure';
import type { CrawlRun, LinksScope, PageTier } from '@/lib/internal-links/types';
import { isIssueListResponse, issuesCsv, issuesQuery } from '@/lib/issues/queries';
import { tabCounts, visibleChecks } from '@/lib/issues/rows';
import type { CheckId, IssueCheck, IssueListResponse } from '@/lib/issues/types';
import {
  SEARCH_MAX_LENGTH,
  tabOfApi,
  type IssuesFoundBy,
  type IssuesSeverity,
  type IssuesTab,
} from '@/lib/issues/url-state';
import { useCan } from '@/lib/permissions';
import { integrationsPath, projectPath, withQuery } from '@/lib/routes/paths';

const HEADING_ID = 'issues-heading';
const EXPORT_NAME = 'issues.csv';
/** What `passed` holds in the address when the passed checks are hidden. */
const HIDE_PASSED = 'hide';
const ANNOUNCE_KEY = 'issues-results';
const NO_CHECKS: readonly IssueCheck[] = [];
const TABS: readonly IssuesTab[] = ['technical', 'on-page'];
const FOUND_BY: readonly IssuesFoundBy[] = ['all', 'crawl', 'ranks', 'gsc', 'ai'];
const SEVERITIES: readonly IssuesSeverity[] = ['all', 'error', 'warning', 'notice'];
/** One empty list for every render: a new one each time would re-run the effects that depend on the tiers. */
const NO_TIERS: readonly PageTier[] = [];
/** The page inspector reads the Internal links state for its scope; this page keeps none of it, so it is the default. */
const LINKS_STATE = parseLinksSearch({});

/** The answer as the list of checks (its generated type is `unknown`, see `isIssueListResponse`). */
function readList(data: unknown): IssueListResponse {
  if (isIssueListResponse(data)) return data;
  throw new Error('The issues answer is not a list of checks');
}

/**
 * Website audit > Issues (spec 7): the crawl's checks in two tabs. It reads the latest finished crawl only and shows
 * the crawl states of Internal links (no website, never crawled, first crawl, failed) in place of the list.
 */
export function IssuesScreen(props: InternalLinksScreenProps): ReactNode {
  const t = useTranslations('issues');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageToolbar title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <IssuesContent {...props} />;
}

function IssuesContent({ workspaceId, workspaceSlug, project }: InternalLinksScreenProps): ReactElement {
  const t = useTranslations('issues');
  const states = useTranslations('internalLinks.states');
  const common = useTranslations('common');
  const scope = useMemo((): LinksScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const host = project.host ?? '';
  const canCrawl = useCan('runs:trigger');
  // The end of a crawl is spoken once, when the poll sees it: a cancel is the person's own act and is not
  const announceEnd = useCallback(
    (run: CrawlRun): void => {
      if (run.state === 'failed') announce(states('endedFailed'), { key: 'internal-links-crawl' });
      else if (run.state !== 'cancelled') {
        announce(states('endedFinished', { count: run.pages }), { key: 'internal-links-crawl' });
      }
    },
    [states],
  );
  const crawls = useCrawls(scope, project.host !== null, announceEnd);
  const view = crawlView(
    project.host !== null,
    crawls.data?.data,
    crawls.isError ? 'error' : crawls.isPending ? 'loading' : 'ready',
    crawls.data?.page.has_more ?? false,
  );
  const crawl = useCrawlNow(scope, host);
  const ready = view.kind === 'ready';
  // A newer crawl that is under way: Crawl now reads "Crawling" and says when it started
  const running = view.kind === 'ready' ? view.active : null;
  // The latest finished crawl only (spec 7.4): no `run` in the address and no crawl picker
  const issues = useQuery({ ...issuesQuery(scope), enabled: ready, select: readList });
  const checks = issues.data?.data ?? NO_CHECKS;
  const { state, setSearch } = useIssuesState(checks);
  const words = useCheckWords();
  const router = useRouter();
  const tiers = useWorkspaceTiers(workspaceId);
  const canWrite = useCan('projects:write');
  const canNote = useCan('notes:write');
  const inView = useMemo(() => crawlInView(crawls.data?.data ?? [], null), [crawls.data]);
  // The page inspector is the one of Internal links: `?inspect=page:<id>`, stepping through the rows of the open check
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

  // The one place that decides what the page shows: with a check open (task 3) the toolbar and the strip are
  // hidden. An address that names a check that did not run, or none, shows the list.
  const openCheck =
    state.check === null ? undefined : checks.find((entry) => entry.id === state.check && entry.state === 'ran');
  const listView = state.check === null || (issues.isSuccess && openCheck === undefined);
  const chrome = ready && listView;
  // The list did not load and nothing is held from an earlier read: there is nothing to filter, count or export
  const listFailed = issues.isError && issues.data === undefined;

  const visible = useMemo(
    () =>
      visibleChecks(checks, state, {
        nameOf: words.nameOf,
        categoryNameOf: (entry) => words.categoryOf(entry.category),
      }),
    [checks, state, words],
  );
  const counts = useMemo(() => tabCounts(checks), [checks]);
  const inTab = checks.filter((entry) => tabOfApi(entry.tab) === state.tab).length;

  // How many checks show is said once the search or a filter settles
  useResultAnnouncement(
    issues.isSuccess && listView
      ? visible.length === 0
        ? t('announce.none')
        : t('announce.showing', { count: visible.length })
      : null,
    ANNOUNCE_KEY,
  );

  const open = (id: CheckId): void => setSearch({ check: id, q: null, sort: null }, { history: 'push' });
  // The check just left gets focus back once the list is on screen (20 section 4.3)
  const leftCheck = useRef<CheckId | null>(null);
  const back = (entry: IssueCheck): void => {
    leftCheck.current = entry.id;
    setSearch(
      { check: null, q: null, sort: null, tab: tabOfApi(entry.tab) === 'technical' ? null : 'on-page' },
      { history: 'push' },
    );
  };
  useEffect(() => {
    const left = leftCheck.current;
    if (left === null || openCheck !== undefined || !issues.isSuccess) return;
    leftCheck.current = null;
    // A filter may hide the row of the check just left: the heading is the place then
    (document.querySelector<HTMLElement>(`[data-check-id="${left}"]`) ?? document.getElementById(HEADING_ID))?.focus();
  }, [openCheck, issues.isSuccess]);
  const clearFilters = (): void => setSearch({ severity: null, by: null, q: null, passed: null });

  const file = useFileExport();
  const onExport = (): void => {
    const { path, query } = issuesCsv(scope, null);
    file.start(() => downloadApiFile(path, query, EXPORT_NAME));
  };

  const settingsHref = projectPath(workspaceSlug, project.slug, '/settings/links');
  const domainsHref = projectPath(workspaceSlug, project.slug, '/settings/domains');
  const integrationsHref = integrationsPath(workspaceSlug, project.slug);
  const notice =
    crawl.crawlsOff && canCrawl ? <CrawlsOffNotice pending={crawl.pending} onCheckAgain={() => crawl.start()} /> : null;
  const crawlButton = (label: string, icon?: typeof RefreshCw): ReactElement => (
    <CrawlButton
      label={label}
      icon={icon}
      canCrawl={canCrawl}
      pending={crawl.pending}
      crawlsOff={crawl.crawlsOff}
      startedAgo={running === null ? null : formatRelative(running.created_at, project.timeZone)}
      onClick={() => crawl.start()}
    />
  );

  // When the crawl in view was made: the list's meta says, else the crawl list does
  const crawledAt = issues.data?.meta.crawled_at ?? (view.kind === 'ready' ? view.latest.created_at : null);
  // What the page inspector is handed. Its links to other parts of Internal links (all linking pages, the journey) leave
  // this page for that one, with the same address keys
  const linksBase = projectPath(workspaceSlug, project.slug, '/seo/internal-links');
  const goToLinks: SetLinksSearch = (values) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) next.set(key, value);
    router.push(withQuery(linksBase, next.toString()));
  };
  const inspectorContext: LinksTabContext = {
    scope,
    workspaceSlug,
    projectSlug: project.slug,
    timeZone: project.timeZone,
    host,
    state: LINKS_STATE,
    crawl: inView,
    setSearch: goToLinks,
    tiers: tiers.data?.data ?? NO_TIERS,
    inspect: { open: (urlId) => inspector.open({ type: 'page', id: urlId }), setOrder, ...inspected },
    openJourney: (urlId) => goToLinks({ tab: 'journey', focus: urlId }),
    registerExport: () => undefined,
    openAlertSettings: null,
    hrefOf: (path) => projectPath(workspaceSlug, project.slug, path),
  };
  let inspectorHost: ReactElement | null = null;
  if (inspector.target?.type === 'page' && ready) {
    inspectorHost =
      inspected.urlId === null ? (
        <PageNotFoundInspector key={inspector.target.id} onClose={inspector.close} />
      ) : (
        <PageInspector
          key={inspected.urlId}
          context={drawerContextOf(inspectorContext, { write: canWrite, note: canNote })}
          urlId={inspected.urlId}
          positionText={stepping.positionText}
          navigation={stepping.navigation}
          onStep={stepping.onStep}
          onClose={inspector.close}
        />
      );
  }

  const foundBy = (
    <Select<IssuesFoundBy>
      size="sm"
      aria-label={t('foundBy.label')}
      value={state.by}
      onValueChange={(next) => setSearch({ by: next === 'all' ? null : next })}
      placeholder={t('foundBy.all')}
      options={FOUND_BY.map((value) =>
        value === 'all'
          ? { value, label: t('foundBy.all') }
          : { value, label: t(`foundBy.${value}.label`), description: t(`foundBy.${value}.tip`) },
      )}
    />
  );
  const crawlLine =
    issues.data === undefined ? null : (
      <p className="min-w-0 truncate type-meta text-foreground-secondary">
        {t('toolbar.crawlLine', {
          host,
          date: formatTableDate(crawledAt ?? '', project.timeZone),
          count: issues.data.summary.pages_crawled,
        })}
      </p>
    );
  const actions = (
    <>
      {crawlButton(running === null ? t('toolbar.crawlNow') : t('toolbar.crawling'), RefreshCw)}
      {listFailed ? null : (
        <Button variant="secondary" size="sm" icon={Download} loading={file.exporting} onClick={onExport}>
          {t('list.export')}
        </Button>
      )}
    </>
  );

  const tabItems: TabItem<IssuesTab>[] = TABS.map((value) => ({
    value,
    label: value === 'technical' ? t('tabs.technical') : t('tabs.onPage'),
    badge: <TabBadge count={counts[value]} text={t('tabs.found', { count: counts[value] })} tone="neutral" />,
  }));
  const tabLabel = state.tab === 'technical' ? t('tabs.technical') : t('tabs.onPage');
  const panel = (): ReactElement => {
    if (issues.data === undefined) {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {issues.isError ? (
            <InlineError
              title={t('states.loadFailed')}
              reason={t('states.loadFailedReason')}
              errorId={null}
              onRetry={() => void issues.refetch()}
              retrying={issues.isFetching}
              retryLabel={common('retry')}
            />
          ) : (
            <SkeletonRows />
          )}
        </div>
      );
    }
    return (
      <Tabs<IssuesTab>
        variant="segmented"
        label={t('labels.issueTypes')}
        value={state.tab}
        // The tab is a move of the page that makes a history entry. A `check` in the address would hold the tab
        // (a check that did not run shows the list, in its own tab), so it goes
        onValueChange={(next) =>
          setSearch({ tab: next === 'technical' ? null : next, check: null }, { history: 'push' })
        }
        items={tabItems}
        className="overflow-hidden rounded-lg border border-border bg-surface"
        renderList={(list) => (
          <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-2">
            {list}
            <span aria-hidden="true" className="hidden h-5 border-l border-border md:block" />
            <InputGroup leadingIcon={Search} size="sm" className="w-64 max-w-full min-w-0">
              <Input
                size="sm"
                // The group draws the border and the focus ring, so the field inside draws neither
                variant="bare"
                type="search"
                value={state.q}
                // Kept as typed: a trimmed copy would be written back over the box and eat the space between two words
                onValueChange={(next) => setSearch({ q: next === '' ? null : next })}
                placeholder={t('list.searchChecks')}
                maxLength={SEARCH_MAX_LENGTH}
                aria-label={t('list.searchChecks')}
              />
            </InputGroup>
            <PressedGroup<IssuesSeverity>
              label={t('labels.severity')}
              value={state.severity}
              onValueChange={(next) => setSearch({ severity: next === 'all' ? null : next })}
              items={SEVERITIES.map((value) => ({
                value,
                label: value === 'all' ? t('severity.all') : t(`severity.${value}.many`),
              }))}
            />
            <Checkbox
              checked={state.showPassed}
              onCheckedChange={(next) => setSearch({ passed: next ? null : HIDE_PASSED })}
              label={t('list.showPassed')}
            />
          </div>
        )}
      >
        <TabsPanel value={state.tab}>
          {visible.length === 0 ? (
            <EmptyState
              variant="table"
              title={t('list.noChecks.title')}
              reason={t('list.noChecks.hint')}
              headingLevel={2}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {t('list.noChecks.clear')}
                </Button>
              }
            />
          ) : (
            <ChecksTable
              checks={visible}
              pagesCrawled={issues.data.summary.pages_crawled}
              gsc={issues.data.meta.gsc.state}
              integrationsHref={integrationsHref}
              caption={t('labels.checksOfTab', { tab: tabLabel })}
              onOpen={open}
            />
          )}
          <p className="min-h-12 border-t border-border-subtle px-3 py-2 num type-meta">
            {t('list.footer', { count: visible.length, total: formatInteger(inTab) })}
          </p>
        </TabsPanel>
      </Tabs>
    );
  };

  let body: ReactNode;
  switch (view.kind) {
    case 'no-website':
      body = (
        <NoWebsite settingsHref={domainsHref} title={t('states.noWebsiteTitle')} reason={t('states.noWebsiteReason')} />
      );
      break;
    case 'loading':
      body = <SkeletonRows />;
      break;
    case 'error':
    case 'unknown':
      body = (
        <InlineError
          title={t('states.crawlsFailed')}
          reason={view.kind === 'error' ? t('states.crawlsFailedReason') : states('unknownReason')}
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
          <NeverCrawled host={host} crawlNow={crawlButton(t('toolbar.crawlNow'))} />
        </>
      );
      break;
    case 'first':
      body = <FirstCrawl run={view.run} host={host} timeZone={project.timeZone} lead={t('states.firstLead')} />;
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
            shown={view.latest}
            active={view.active}
            failed={view.failed}
            host={host}
            timeZone={project.timeZone}
            settingsHref={settingsHref}
            canCrawl={canCrawl}
            onRetry={() => crawl.start()}
            onHigherLimit={() => crawl.start(true)}
          />
          {chrome && !listFailed ? (
            <IssuesStrip
              summary={issues.data?.summary ?? null}
              status={issues.data === undefined ? 'loading' : issues.isFetching ? 'refetching' : 'ready'}
            />
          ) : null}
          {openCheck === undefined ? (
            panel()
          ) : (
            <CheckView
              // One view per check: a changed check starts with no rows, an empty draft and the first page
              key={openCheck.id}
              check={openCheck}
              scope={scope}
              state={state}
              setSearch={setSearch}
              gsc={issues.data?.meta.gsc.state ?? 'not_connected'}
              crawledAt={crawledAt}
              timeZone={project.timeZone}
              activeUrlId={inspected.urlId}
              onBack={() => back(openCheck)}
              onOpenPage={inspectorContext.inspect.open}
              onOrderChange={setOrder}
            />
          )}
        </>
      );
      break;
  }

  return (
    <InspectorLayout inspector={inspectorHost}>
      <div className={PAGE_CLASS}>
        <PageToolbar
          title={t('title')}
          headingId={HEADING_ID}
          {...(chrome ? { ...(listFailed ? {} : { filters: foundBy }), status: crawlLine, actions } : {})}
        />
        {body}
      </div>
    </InspectorLayout>
  );
}
