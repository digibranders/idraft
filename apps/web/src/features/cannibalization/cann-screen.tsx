'use client';

import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import type { ExportSpec } from './cann-export';
import { ExportButton } from './cann-export-button';
import { ConflictStrip, SwitchStrip } from './cann-strip';
import { KeywordView } from './keyword-view';
import { PairView } from './pair-view';
import { isKeywordGone, type CannTab } from './cann-model';
import { useConflicts, usePairs, useSwitches } from './cann-reads';
import { useCannState } from './cann-state';
import { ReadError } from './cann-view-parts';
import { ScopeToolbar, type GroupChoice } from './scope-toolbar';
import { SwitchingView } from './switching-view';
import { useFocusReturn } from './use-focus-return';
import { useSearchDraft } from './use-search-draft';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { TabNav } from '@/components/app/shell/tab-nav';
import { EmptyState } from '@/components/app/status/empty-state';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { formatInteger } from '@/lib/format';
import { CannOrderContext } from '@/lib/inspector/cann-order';
import { useKeywordGroups } from '@/lib/keywords/taxonomy-reads';
import { useCan } from '@/lib/permissions';
import { projectPath, rankingsPath, withQuery } from '@/lib/routes/paths';

export interface CannProject {
  id: string;
  slug: string;
  name: string;
}

export interface CannScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: CannProject;
  /** The route segment: `/seo/cannibalization` or `/seo/cannibalization/switching` (docs/33 section 7.1). */
  tab: CannTab;
  /**
   * The keyword inspector (`inspect=cann-keyword:<id>`), which the route composes (`CannKeywordInspector`), as the
   * Citations route does for the prompt inspector. It reads the table's order from `CannOrderContext`.
   */
  keywordInspector?: ReactNode;
}

const PATHS = { cannibalization: '/seo/cannibalization', switching: '/seo/cannibalization/switching' } as const;
const NO_GROUPS: readonly GroupChoice[] = [];

/** SEO > Cannibalization (docs/33 section 7): the scope toolbar, the strip of the tab and the table panel. */
export function CannScreen(props: CannScreenProps): ReactNode {
  const t = useTranslations('cannibalization');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className="flex flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <h1 className="sr-only">{t('title')}</h1>
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <CannContent {...props} />;
}

function CannContent({ workspaceId, workspaceSlug, project, tab, keywordInspector }: CannScreenProps): ReactElement {
  const t = useTranslations('cannibalization');
  const scope = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const { state, set, resetScope, isDefaultScope } = useCannState(tab);
  const groups = useKeywordGroups(scope);
  const groupChoices = useMemo(
    (): readonly GroupChoice[] | null =>
      groups.data === undefined
        ? groups.isError
          ? NO_GROUPS
          : null
        : groups.data.data.map((group) => ({ id: group.group_id, name: group.path })),
    [groups.data, groups.isError],
  );

  // Both tabs' counts are in the tab labels, so both reads are made; the pairs only when their table is open
  const conflicts = useConflicts(scope, state);
  const switches = useSwitches(scope, state, true);
  const pairs = usePairs(scope, state, tab === 'cannibalization' && state.view === 'pairs');

  const commitSearch = useCallback((search: string) => set({ search }), [set]);
  const [searchText, setSearchText] = useSearchDraft(state.search, commitSearch);

  // The table in view registers itself here, so the Export button in the toolbar saves that table
  const [exportSpec, setExportSpec] = useState<ExportSpec | null>(null);
  const onExportChange = useCallback((spec: ExportSpec | null) => setExportSpec(spec), []);

  const inspector = useInspector();
  const [order, setOrder] = useState<readonly string[]>([]);
  const openId = inspector.target?.type === 'cann-keyword' ? inspector.target.id : null;
  // The inspector is a new object on every render; the table's columns must not rebuild with it
  const inspectorRef = useRef(inspector);
  useEffect(() => {
    inspectorRef.current = inspector;
  });
  // Closing the drawer returns focus to the row it opened from, or to the row of the keyword it was stepped to
  const rememberOpener = useFocusReturn(openId);
  const openKeyword = useCallback(
    (id: string, opener: HTMLElement | null, tabId?: string): void => {
      rememberOpener(opener);
      inspectorRef.current.open({ type: 'cann-keyword', id }, tabId === undefined ? undefined : { tab: tabId });
    },
    [rememberOpener],
  );
  const openRow = useCallback(
    (row: { tracked_keyword_id: string }, opener: HTMLElement | null, tabId?: string): void =>
      openKeyword(row.tracked_keyword_id, opener, tabId),
    [openKeyword],
  );
  const drawer = openId === null ? null : (keywordInspector ?? null);

  // A keyword that the scope or the group no longer holds has nothing to show: the drawer closes (no raw load error)
  const gone =
    openId !== null &&
    isKeywordGone({
      ready: conflicts.status === 'ready' && conflicts.data !== undefined,
      refetching: conflicts.refetching,
      ids: conflicts.data?.items.map((row) => row.tracked_keyword_id) ?? [],
      total: conflicts.data?.meta.total,
      id: openId,
    });
  useEffect(() => {
    if (gone) inspectorRef.current.close();
  }, [gone]);

  // The tabs are routes; the scope goes with them, the view and the filters do not
  const scopeQuery = new URLSearchParams();
  if (state.device !== 'desktop') scopeQuery.set('device', state.device);
  if (state.group !== 'all') scopeQuery.set('group', state.group);
  if (state.days !== 30) scopeQuery.set('days', String(state.days));
  const hrefOf = (id: CannTab): ReturnType<typeof projectPath> =>
    withQuery(projectPath(workspaceSlug, project.slug, PATHS[id]), scopeQuery.toString());
  const conflictCount = conflicts.data?.counts.conflicts;
  const switchCount = switches.data?.headline.switches.value;
  const tabs = (
    <TabNav
      variant="segmented"
      label={t('tabs.label')}
      items={[
        {
          href: hrefOf('cannibalization'),
          label: t('tabs.cannibalization'),
          current: tab === 'cannibalization',
          badge:
            conflictCount === undefined
              ? undefined
              : { text: formatInteger(conflictCount), spoken: t('tabs.keywordsCount', { count: conflictCount }) },
        },
        {
          href: hrefOf('switching'),
          label: t('tabs.switching'),
          current: tab === 'switching',
          badge:
            switchCount === undefined
              ? undefined
              : { text: formatInteger(switchCount), spoken: t('tabs.switchesCount', { count: switchCount }) },
        },
      ]}
    />
  );

  const keywordsHref = rankingsPath(workspaceSlug, project.slug);
  const active = tab === 'cannibalization' ? conflicts : switches;
  const stripStatus = active.refetching ? 'refetching' : 'ready';
  let main: ReactNode;
  if (tab === 'switching') {
    main = (
      <SwitchingView
        switches={switches}
        keywords={conflicts}
        state={state}
        set={set}
        tabs={tabs}
        search={searchText}
        onSearchChange={setSearchText}
        activeId={openId}
        onOpen={openKeyword}
        onOrderChange={setOrder}
        onExportChange={onExportChange}
      />
    );
  } else if (state.view === 'pairs') {
    main = (
      <PairView
        read={pairs}
        state={state}
        set={set}
        tabs={tabs}
        search={searchText}
        onSearchChange={setSearchText}
        onExportChange={onExportChange}
      />
    );
  } else {
    main = (
      <KeywordView
        read={conflicts}
        state={state}
        set={set}
        tabs={tabs}
        search={searchText}
        onSearchChange={setSearchText}
        activeId={openId}
        onOpen={openRow}
        onOrderChange={setOrder}
        onExportChange={onExportChange}
        keywordsHref={keywordsHref}
      />
    );
  }

  return (
    <CannOrderContext.Provider value={order}>
      <InspectorLayout inspector={drawer}>
        {/* The table panel fills what the toolbar and the strip leave, so the table is in view without scrolling the page */}
        <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
          <ScopeToolbar
            state={state}
            groups={groupChoices}
            isDefaultScope={isDefaultScope}
            dateTo={(tab === 'cannibalization' ? conflicts : switches).data?.meta.date_to ?? null}
            actions={<ExportButton spec={exportSpec} />}
            onChange={set}
            onReset={resetScope}
          />
          {active.status === 'error' ? (
            <ReadError read={active} />
          ) : (
            <div className="relative">
              {tab === 'cannibalization' ? (
                <ConflictStrip list={conflicts.data} status={stripStatus} days={state.days} />
              ) : (
                <SwitchStrip list={switches.data} status={stripStatus} days={state.days} />
              )}
              <RefetchBar active={active.refetching} position="under-section-heading" />
            </div>
          )}
          {main}
        </div>
      </InspectorLayout>
    </CannOrderContext.Provider>
  );
}
