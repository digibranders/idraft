'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, Download, RefreshCw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { CheckView } from './check-view';
import { useCheckWords } from './check-words';
import { ChecksTable } from './checks-table';
import { IssuesStrip } from './issues-strip';
import { useIssuesState } from './use-issues-state';
import { CrawlButton } from '../crawl-button';
import { crawlView, useCrawlNow, useCrawls } from '../crawl-reads';
import { CrawlBanners, CrawlsOffNotice, FirstCrawl, NeverCrawled, NoWebsite, SkeletonRows } from '../crawl-states';
import type { InternalLinksScreenProps } from '../internal-links-screen';
import { TabBadge } from '../tab-badge';
import { PressedGroup } from '@/components/app/filters/pressed-group';
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
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { downloadApiFile } from '@/lib/api/download';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger, formatRelative, formatTableDate } from '@/lib/format';
import { failedText } from '@/lib/internal-links/crawl-failure';
import type { CrawlRun, LinksScope } from '@/lib/internal-links/types';
import { isIssueListResponse, issuesCsv, issuesQuery } from '@/lib/issues/queries';
import { tabCounts, visibleChecks } from '@/lib/issues/rows';
import type { CheckId, IssueCheck, IssueListResponse } from '@/lib/issues/types';
import { tabOfApi, type IssuesFoundBy, type IssuesSeverity, type IssuesTab } from '@/lib/issues/url-state';
import { useCan } from '@/lib/permissions';
import { integrationsPath, projectPath } from '@/lib/routes/paths';

const HEADING_ID = 'issues-heading';
const EXPORT_NAME = 'issues.csv';
/** What `passed` holds in the address when the passed checks are hidden. */
const HIDE_PASSED = 'hide';
/** The longest search the address takes (the API's text filters take 200 characters). */
const SEARCH_MAX_LENGTH = 200;
const NO_CHECKS: readonly IssueCheck[] = [];
const TABS: readonly IssuesTab[] = ['technical', 'on-page'];
const FOUND_BY: readonly IssuesFoundBy[] = ['all', 'crawl', 'ranks', 'gsc', 'ai'];
const SEVERITIES: readonly IssuesSeverity[] = ['all', 'error', 'warning', 'notice'];

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

  // The one place that decides what the page shows: with a check open (task 3) the toolbar and the strip are
  // hidden. An address that names a check that did not run, or none, shows the list.
  const openCheck =
    state.check === null ? undefined : checks.find((entry) => entry.id === state.check && entry.state === 'ran');
  const listView = state.check === null || (issues.isSuccess && openCheck === undefined);
  const chrome = ready && listView;

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

  const open = (id: CheckId): void => setSearch({ check: id, q: null, sort: null }, { history: 'push' });
  const back = (entry: IssueCheck): void =>
    setSearch(
      { check: null, q: null, sort: null, tab: tabOfApi(entry.tab) === 'technical' ? null : 'on-page' },
      { history: 'push' },
    );
  const clearFilters = (): void => setSearch({ severity: null, by: null, q: null, passed: null });

  const [exporting, setExporting] = useState(false);
  const exportingNow = useRef(false);
  // One download at a time: a second press while the file is being made would start the same file again
  const onExport = (): void => {
    if (exportingNow.current) return;
    exportingNow.current = true;
    setExporting(true);
    const { path, query } = issuesCsv(scope, null);
    downloadApiFile(path, query, EXPORT_NAME)
      .catch((error: unknown) => {
        // What the API said, when it said something (a problem's detail, else its title)
        const reason = isApiProblem(error) ? (error.detail ?? error.string('title')) : null;
        toast({
          type: 'error',
          title: t('list.exportFailed'),
          ...(reason === null ? {} : { description: reason }),
        });
      })
      .finally(() => {
        exportingNow.current = false;
        setExporting(false);
      });
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

  const foundBy = (
    <Select<IssuesFoundBy>
      size="sm"
      aria-label={t('foundBy.label')}
      value={state.by}
      onValueChange={(next) => setSearch({ by: next === 'all' ? null : next })}
      placeholder={t('foundBy.all')}
      triggerPrefix={`${t('foundBy.label')}:`}
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
          date: formatTableDate(
            issues.data.meta.crawled_at ?? (view.kind === 'ready' ? view.latest.created_at : ''),
            project.timeZone,
          ),
          count: issues.data.summary.pages_crawled,
        })}
      </p>
    );
  const actions = (
    <>
      {crawlButton(running === null ? t('toolbar.crawlNow') : t('toolbar.crawling'), RefreshCw)}
      <Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={onExport}>
        {t('list.export')}
      </Button>
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
        // The tab is a move of the page that makes a history entry
        onValueChange={(next) => setSearch({ tab: next === 'technical' ? null : next }, { history: 'push' })}
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
              headingLevel={3}
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
          <NeverCrawled host={host} crawlNow={crawlButton(t('toolbar.crawlNow'))} />
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
          {chrome && !issues.isError ? (
            <IssuesStrip
              summary={issues.data?.summary ?? null}
              status={issues.data === undefined ? 'loading' : issues.isFetching ? 'refetching' : 'ready'}
            />
          ) : null}
          {openCheck === undefined ? panel() : <CheckView check={openCheck} onBack={() => back(openCheck)} />}
        </>
      );
      break;
  }

  return (
    <div className={PAGE_CLASS}>
      <PageToolbar
        title={t('title')}
        headingId={HEADING_ID}
        {...(chrome ? { filters: foundBy, status: crawlLine, actions } : {})}
      />
      {body}
    </div>
  );
}
