'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { CitedWithSection } from './cited-with';
import { DomainBadges, LastCited } from './domain-header';
import { domainFigures, type DomainFigures } from './domain-model';
import { useDomainDetail, type DomainDetailRead } from './domain-reads';
import { DomainSeoShare } from './domain-seo-share';
import { DomainStrip } from './domain-strip';
import { EngineTable } from './engine-table';
import { ShareTrend } from './share-trend';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { EngineCode, SourceDomainDetailData, SourceScope } from '@/lib/citations/types';
import { copyText } from '@/lib/dom/clipboard';

/** The translator of `citations.inspectors.domain`, as `useTranslations` gives it. */
export type DomainTranslate = ReturnType<typeof useTranslations<'citations.inspectors.domain'>>;

/** What a tab of the domain inspector is handed. */
export interface DomainTabContext {
  source: SourceScope;
  filters: SourceFilters;
  registrable: string;
  timeZone: string;
  /** The Rankings of the project, which the search share of voice card points to. */
  rankingsHref: Route;
  /** The engines in scope with their names, in the order the project lists them. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The domain's read; `null` data while it has nothing yet. */
  read: DomainDetailRead;
  data: SourceDomainDetailData | null;
  /** The strip's figures; `null` while there are none. */
  figures: DomainFigures | null;
  /** A read is on its way while figures are on screen. */
  refetching: boolean;
}

export interface DomainTab {
  id: string;
  label: (t: DomainTranslate) => string;
  render: (context: DomainTabContext) => ReactNode;
}

/**
 * The tabs, in order: Overview first (the address leaves it out). The Pages and Prompts tabs are added here. The
 * Overview is the trend by engine, the breakdown by engine, the entities named when the domain is cited, and the
 * search share of voice.
 */
const DOMAIN_TABS: readonly DomainTab[] = [
  {
    id: 'overview',
    label: (t) => t('tabOverview'),
    render: ({ source, filters, registrable, rankingsHref, read, data, figures, engines, refetching }) => (
      <>
        <ShareTrend
          domain={registrable}
          data={data}
          range={{ from: filters.from, to: filters.to }}
          engines={engines}
          read={read}
          refetching={refetching}
        />
        <EngineTable data={data} engines={engines} refetching={refetching} />
        <CitedWithSection source={source} data={data} answers={figures?.answers ?? null} />
        <DomainSeoShare rankingsHref={rankingsHref} />
      </>
    ),
  },
];

/** The tab the address asks for when it is one of `tabs`, else the first one. */
const chosenTab = (tabs: readonly DomainTab[], requested: string): string =>
  tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? requested;

export interface DomainInspectorProps {
  source: SourceScope;
  filters: SourceFilters;
  /** The domain asked for, as the address wrote it. */
  registrable: string;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** The engines in scope with their names. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The Pages tab of the page filtered to this domain: a real link, so a middle click opens a new tab. */
  pagesHref: Route;
  /** The project's Rankings page, for the search share of voice card. */
  rankingsHref: Route;
  /** "3 of 12"; `null` when the domain is not in the list on screen. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  /** The tab the address asks for (`?itab=`), which the inspector resolves against the tabs it shows. */
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}

/**
 * The inspector of one cited domain (DS 23 4.2, WB-DOM-01, 02 and 04; 400 px): the header names the domain with a
 * badge for each role it was cited in and when it was last cited; the strip above the tabs says its units, share,
 * answers and prompts; the Overview tab has the per engine table. A domain no answer in scope cites says so and
 * draws no figure. Each part loads and fails with the one read: while it is read the labels stay and the values
 * are bars, an error keeps the header and offers Retry, and a window or filter that changes keeps the last figures
 * on screen, marked busy.
 */
export function DomainInspector({
  source,
  filters,
  registrable,
  timeZone,
  engines,
  pagesHref,
  rankingsHref,
  positionText,
  navigation,
  onStep,
  tab,
  onTabChange,
  onClose,
}: DomainInspectorProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const common = useTranslations('common');
  const inspectorWords = useTranslations('inspector');
  const read = useDomainDetail(source, registrable, filters);
  const data = read.data?.data ?? null;
  const meta = read.data?.meta ?? null;
  const rows = data?.rows ?? [];
  const cited = data !== null && rows.length > 0;
  const refetching = read.status === 'ready' && read.retrying;
  const figures = useMemo(
    () => (data === null || meta === null || !cited ? null : domainFigures(data, meta)),
    [data, meta, cited],
  );

  // `engines` holds the chosen engines, or every enabled one when none is chosen: only a choice is named
  const engineNames = (filters.engines ?? []).length === 0 ? [] : engines.map((engine) => engine.label);

  const context: DomainTabContext = {
    source,
    filters,
    registrable,
    timeZone,
    rankingsHref,
    engines,
    read,
    data,
    figures,
    refetching,
  };
  const current = chosenTab(DOMAIN_TABS, tab);

  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  const moreActions: MenuItemDef[] = [
    { id: 'view-pages', kind: 'link', label: t('viewPages'), link: <Link href={pagesHref} /> },
    { id: 'copy-link', label: t('copyLink'), onSelect: copyLink },
  ];

  let body: ReactElement;
  if (read.notFound) {
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
  } else if (read.status === 'error') {
    body = (
      <InspectorBody>
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={read.errorId}
          onRetry={read.retry}
          retrying={read.retrying}
          retryLabel={common('retry')}
        />
      </InspectorBody>
    );
  } else if (data !== null && !cited) {
    body = (
      <InspectorBody>
        <EmptyState
          variant="inline"
          title={t('notCitedTitle')}
          reason={t('notCitedReason', { domain: registrable })}
          headingLevel={3}
        />
      </InspectorBody>
    );
  } else {
    body = (
      <>
        {/* The strip stays above the tabs, whichever is shown */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-border px-4 pt-3 pb-2">
          <DomainStrip figures={figures} refetching={refetching} engineNames={engineNames} />
        </div>
        <InspectorTabs<string>
          label={t('tabsLabel')}
          value={current}
          onValueChange={onTabChange}
          items={DOMAIN_TABS.map((entry) => ({ value: entry.id, label: entry.label(t) }))}
          overflowLabel={t('moreTabs')}
        >
          {DOMAIN_TABS.map((entry) => (
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
      type="domain"
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      header={{
        title: registrable,
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText,
        freshness: cited ? <LastCited rows={rows} timeZone={timeZone} /> : null,
        navigation,
        badges: cited ? <DomainBadges rows={rows} /> : null,
        moreActions,
      }}
    >
      {body}
    </Inspector>
  );
}
