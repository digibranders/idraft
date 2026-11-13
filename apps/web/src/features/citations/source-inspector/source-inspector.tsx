'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { SourceBadges, SourceDates, sourceTitle } from './source-header';
import {
  figuresOf,
  identityOf,
  pageRowOf,
  parseUrlId,
  trendOf,
  type SourceFigures,
  type SourceTrend,
} from './source-model';
import { SourceAnswersTab } from './source-answers-tab';
import { SourceOverview } from './source-overview';
import { SourcePromptsTab } from './source-prompts-tab';
import { useSourceReads, type SourceReads } from './source-reads';
import { SourceStrip, type SourceRowState } from './source-strip';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { engineTotals } from '@/lib/citations/share-model';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { EngineCode, SourceScope } from '@/lib/citations/types';
import { copyText } from '@/lib/dom/clipboard';
import { webHref } from '@/lib/format';

/** The translator of `citations.inspectors.source`, as `useTranslations` gives it. */
export type SourceTranslate = ReturnType<typeof useTranslations<'citations.inspectors.source'>>;

/** What a tab of the source inspector is handed. */
export interface SourceTabContext {
  source: SourceScope;
  filters: SourceFilters;
  timeZone: string;
  /** The engines in scope with their names, in the order the project lists them. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The prompts page of the project, where a prompt and an answer open by address. */
  promptsHref: Route;
  /** The reads: the citations of the page are what the Prompts and Answers tabs list. */
  reads: SourceReads;
  /** How the page's row is going, its figures and its weekly trend. */
  rowState: SourceRowState;
  figures: SourceFigures | null;
  trend: SourceTrend | null;
  /** A read is on its way while figures are on screen. */
  refetching: boolean;
}

export interface SourceTab {
  id: string;
  label: (t: SourceTranslate) => string;
  render: (context: SourceTabContext) => ReactNode;
}

/** The tabs, in order. Overview is first (the address leaves it out). */
const SOURCE_TABS: readonly SourceTab[] = [
  {
    id: 'overview',
    label: (t) => t('tabOverview'),
    render: ({ filters, engines, reads, rowState, figures, trend, refetching }) => (
      <SourceOverview
        state={rowState}
        figures={figures}
        trend={trend}
        range={{ from: filters.from, to: filters.to }}
        engines={engines}
        errorId={reads.page.errorId}
        retry={reads.page.retry}
        retrying={reads.page.retrying}
        refetching={refetching}
      />
    ),
  },
  {
    id: 'prompts',
    label: (t) => t('tabPrompts'),
    render: ({ source, timeZone, engines, promptsHref, reads, refetching }) => (
      <SourcePromptsTab
        source={source}
        citations={reads.citations}
        refetching={refetching}
        engines={engines}
        timeZone={timeZone}
        promptsHref={promptsHref}
      />
    ),
  },
  {
    id: 'answers',
    label: (t) => t('tabAnswers'),
    render: ({ source, timeZone, engines, promptsHref, reads, refetching }) => (
      <SourceAnswersTab
        source={source}
        citations={reads.citations}
        refetching={refetching}
        engines={engines}
        timeZone={timeZone}
        promptsHref={promptsHref}
      />
    ),
  },
];

/** The tab the address asks for when it is one of `tabs`, else the first one. */
const chosenTab = (tabs: readonly SourceTab[], requested: string): string =>
  tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? requested;

export interface SourceInspectorProps {
  source: SourceScope;
  filters: SourceFilters;
  /** The id the address wrote: the `url_id` of the page. */
  sourceId: string;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** The engines in scope with their names. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The domain inspector of the page's domain, as a real link. */
  domainHref: (registrable: string) => Route;
  /** The prompts page of the project: the Prompts and Answers tabs link to its inspectors (a feature never imports another). */
  promptsHref: Route;
  /** "3 of 12"; `null` when the page is not in the list on screen. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  /** The tab the address asks for (`?itab=`), which the inspector resolves against the tabs it shows. */
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}

/**
 * The inspector of one cited page (DS 23 4.2, WB-SRC-01; 400 px): the header names the page by its title (as text)
 * with its host, the role its domain was cited in and when it was first and last cited; the strip above the tabs
 * says its units, share, answers, prompts and engines; the Overview tab has the weekly trend (all engines together,
 * and labelled so) and the per engine table; the Prompts and Answers tabs list the page's own citations (one read). A page no answer in scope cites says so and draws no figure. The page
 * is read twice (its citations, then the pages of its domain, plan F10): the header stands on the first, so a page
 * past the 200 listed keeps its header and says its totals are not known. A window that changes keeps the last
 * figures on screen, marked busy; another page never shows the last one's.
 */
export function SourceInspector({
  source,
  filters,
  sourceId,
  timeZone,
  engines,
  domainHref,
  promptsHref,
  positionText,
  navigation,
  onStep,
  tab,
  onTabChange,
  onClose,
}: SourceInspectorProps): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const reads = useSourceReads(source, filters, parseUrlId(sourceId));
  const { citations, page, totals } = reads;

  const identity = useMemo(() => identityOf(citations.data?.data ?? []), [citations.data]);
  const cited = identity !== null;
  const pages = page.data;
  const row = useMemo(
    () => (identity === null || pages === undefined ? null : pageRowOf(pages.data, identity)),
    [identity, pages],
  );
  const rowState: SourceRowState =
    pages === undefined ? (page.status === 'error' ? 'error' : 'loading') : row === null ? 'missing' : 'ready';
  const figures = useMemo(
    () =>
      row === null || pages === undefined
        ? null
        : figuresOf(row, pages.meta, totals.data === undefined ? null : engineTotals(totals.data.meta)),
    [row, pages, totals.data],
  );
  const trend = useMemo(
    () => (row === null || pages === undefined ? null : trendOf(row.series, pages.meta.series)),
    [row, pages],
  );
  const refetching = (citations.status === 'ready' && citations.retrying) || (rowState === 'ready' && page.retrying);

  // `engines` holds the chosen engines, or every enabled one when none is chosen: only a choice is named
  const engineNames = (filters.engines ?? []).length === 0 ? [] : engines.map((engine) => engine.label);
  const engineLabels = useMemo(() => new Map(engines.map((engine) => [engine.code, engine.label])), [engines]);
  const current = chosenTab(SOURCE_TABS, tab);

  const copy = (text: string, done: string): void => {
    void copyText(text).then((copied) =>
      toast(copied ? { type: 'success', title: done } : { type: 'error', title: common('copy.failed') }),
    );
  };
  // An address that is not a web address (a script, a relative path) is never a link to follow; it can still be copied
  const pageHref = identity === null ? null : webHref(identity.url);
  const moreActions: MenuItemDef[] = [
    { id: 'copy-link', label: t('copyLink'), onSelect: () => copy(window.location.href, t('linkCopied')) },
    ...(identity === null
      ? []
      : [
          { id: 'copy-address', label: t('copyAddress'), onSelect: () => copy(identity.url, t('addressCopied')) },
          ...(pageHref === null
            ? []
            : [
                {
                  id: 'open-page',
                  kind: 'link' as const,
                  label: t('openPage'),
                  // A new tab that cannot reach back, for an address `webHref` has accepted as a web address (the
                  // typed router knows only the app's own routes, hence the cast)
                  link: <Link href={pageHref as Route} target="_blank" rel="noopener noreferrer" />,
                },
              ]),
          {
            id: 'open-domain',
            kind: 'link' as const,
            label: t('openDomain'),
            link: <Link href={domainHref(identity.registrable)} />,
          },
        ]),
  ];

  let body: ReactElement;
  if (citations.notFound) {
    body = (
      <InspectorBody>
        <EmptyState
          variant="inline"
          title={t('loadFailed')}
          reason={inspectorWords('notFound', { type: t('noun') })}
          headingLevel={3}
        />
      </InspectorBody>
    );
  } else if (citations.status === 'error') {
    body = (
      <InspectorBody>
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={citations.errorId}
          onRetry={citations.retry}
          retrying={citations.retrying}
          retryLabel={common('retry')}
        />
      </InspectorBody>
    );
  } else if (citations.data !== undefined && !cited) {
    body = (
      <InspectorBody>
        <EmptyState variant="inline" title={t('notCitedTitle')} reason={t('notCitedReason')} headingLevel={3} />
      </InspectorBody>
    );
  } else {
    const context: SourceTabContext = {
      source,
      filters,
      timeZone,
      engines,
      promptsHref,
      reads,
      rowState,
      figures,
      trend,
      refetching,
    };
    body = (
      <>
        {/* The strip stays above the tabs, whichever is shown */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-border px-4 pt-3 pb-2">
          <SourceStrip
            state={rowState}
            figures={figures}
            engineLabels={engineLabels}
            refetching={refetching}
            engineNames={engineNames}
          />
        </div>
        <InspectorTabs<string>
          label={t('tabsLabel')}
          value={current}
          onValueChange={onTabChange}
          items={SOURCE_TABS.map((entry) => ({ value: entry.id, label: entry.label(t) }))}
          overflowLabel={t('moreTabs')}
        >
          {SOURCE_TABS.map((entry) => (
            <InspectorPanel<string> key={entry.id} value={entry.id}>
              {entry.render(context)}
            </InspectorPanel>
          ))}
        </InspectorTabs>
      </>
    );
  }

  return (
    <Inspector
      type="source"
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      header={{
        title: identity === null ? t('unknownTitle', { id: sourceId }) : sourceTitle(identity, t('untitled')),
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText,
        freshness:
          identity === null ? null : (
            <SourceDates identity={identity} firstSeenAt={row?.first_seen_at ?? null} timeZone={timeZone} />
          ),
        navigation,
        badges: identity === null ? null : <SourceBadges identity={identity} />,
        moreActions,
      }}
    >
      {body}
    </Inspector>
  );
}
