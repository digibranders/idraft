'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { CrawlButton } from './crawl-button';
import { crawlView, useCrawlNow, useCrawls, useWorkspaceTiers, type CrawlView } from './crawl-reads';
import { CrawlBanners, CrawlsOffNotice, FirstCrawl, NeverCrawled, NoWebsite, SkeletonRows } from './crawl-states';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { crawlInView, type CrawlInView } from '@/lib/internal-links/crawl-choice';
import { failedText } from '@/lib/internal-links/crawl-failure';
import type { CrawlRun, LinksScope, PageTier } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { projectPath, workspaceSettingsPath } from '@/lib/routes/paths';

/** One empty list for every render: a new one each time re-runs the tabs' effects that depend on the tiers. */
const NO_TIERS: readonly PageTier[] = [];
const NO_RUNS: readonly CrawlRun[] = [];

/** The project a crawl shell reads; the same shape the Internal links screen takes. */
export interface CrawlShellProject {
  id: string;
  slug: string;
  timeZone: string;
  /** The project's website; `null` when none is set (spec 9 "No website"). */
  host: string | null;
}

export interface CrawlShellInput {
  workspaceId: string;
  workspaceSlug: string;
  project: CrawlShellProject;
  /** The crawl the address chooses, or null for the latest. */
  run: string | null;
  /** Buttons of the first crawl state (tier rules, import); the screen decides. */
  firstCrawlActions?: ReactNode;
}

export interface CrawlShell {
  scope: LinksScope;
  host: string;
  view: CrawlView;
  /** The crawl every read is made against. */
  inView: CrawlInView;
  runs: readonly CrawlRun[];
  tiers: readonly PageTier[];
  /** How many tiers the workspace has; `null` until they are read. */
  tierCount: number | null;
  crawl: ReturnType<typeof useCrawlNow>;
  canCrawl: boolean;
  canEditTiers: boolean;
  /** The "crawls are not switched on" notice, or null. */
  notice: ReactElement | null;
  /** The body of every state but `ready`; null when the crawl can be read. */
  stateBody: ReactNode | null;
  /** The banners over a crawl that can be read (a newer crawl running or failed). */
  banners: ReactNode;
  hrefs: { settings: Route; tiers: Route; domains: Route };
}

/**
 * What both crawl screens share (spec 6.4): the crawls and their announcement, the tiers, the state of the project's
 * crawls, the crawl in view, Crawl now with its "crawls are not switched on" notice, and the body of every state
 * the screen does not draw itself.
 */
export function useCrawlShell({
  workspaceId,
  workspaceSlug,
  project,
  run,
  firstCrawlActions,
}: CrawlShellInput): CrawlShell {
  const states = useTranslations('internalLinks.states');
  const header = useTranslations('internalLinks.header');
  const common = useTranslations('common');
  const scope = useMemo((): LinksScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const host = project.host ?? '';
  const canCrawl = useCan('runs:trigger');
  const canEditTiers = useCan('workspace:update');
  // The end of a crawl is spoken once, when the poll sees it: a cancel is the person's own act and is not
  const announceEnd = useCallback(
    (ended: CrawlRun): void => {
      if (ended.state === 'failed') announce(states('endedFailed'), { key: 'internal-links-crawl' });
      else if (ended.state !== 'cancelled') {
        announce(states('endedFinished', { count: ended.pages }), { key: 'internal-links-crawl' });
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
  // The crawl every read is made against: the one `run` names, else the latest (an unknown id reads the latest, never wider)
  const inView = useMemo(() => crawlInView(crawls.data?.data ?? [], run), [crawls.data, run]);

  const hrefs = {
    settings: projectPath(workspaceSlug, project.slug, '/settings/links'),
    tiers: workspaceSettingsPath(workspaceSlug, 'tiers'),
    domains: projectPath(workspaceSlug, project.slug, '/settings/domains'),
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

  let stateBody: ReactNode | null = null;
  let banners: ReactNode = null;
  switch (view.kind) {
    case 'no-website':
      stateBody = <NoWebsite settingsHref={hrefs.domains} />;
      break;
    case 'loading':
      stateBody = <SkeletonRows />;
      break;
    case 'error':
    case 'unknown':
      stateBody = (
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
      stateBody = (
        <>
          {notice}
          <NeverCrawled host={host} crawlNow={crawlButton(header('crawlNow'))} />
        </>
      );
      break;
    case 'first':
      stateBody = <FirstCrawl run={view.run} host={host} timeZone={project.timeZone} actions={firstCrawlActions} />;
      break;
    case 'failed-first':
      stateBody = (
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
      banners = (
        <CrawlBanners
          latest={view.latest}
          shown={inView.crawl}
          active={view.active}
          failed={view.failed}
          host={host}
          timeZone={project.timeZone}
          settingsHref={hrefs.settings}
          canCrawl={canCrawl}
          onRetry={() => crawl.start()}
          onHigherLimit={() => crawl.start(true)}
        />
      );
      break;
  }
  return {
    scope,
    host,
    view,
    inView,
    runs: crawls.data?.data ?? NO_RUNS,
    tiers: tiers.data?.data ?? NO_TIERS,
    tierCount: tiers.data?.data.length ?? null,
    crawl,
    canCrawl,
    canEditTiers,
    notice,
    stateBody,
    banners,
    hrefs,
  };
}

/** The page's Export: a tab registers its download, the header runs it once at a time. */
export function usePageExport(): {
  registerExport: (run: (() => Promise<void>) | null) => void;
  onExport: (() => void) | null;
  exporting: boolean;
} {
  const header = useTranslations('internalLinks.header');
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
  return { registerExport, onExport, exporting };
}
