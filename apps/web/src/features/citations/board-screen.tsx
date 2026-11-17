'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { gapsCsv, pagesCsv } from './board-export';
import { useBoardEngines, useGaps, useOverview, useTopicTerms, useTracked } from './board-reads';
import { useBoardState } from './board-state';
import { previousText, runsLabel, scopeText } from './board-text';
import { ownerRole } from './cited-pages/page-rows';
import { PagesTab } from './cited-pages/pages-tab';
import { GapDrawer } from './drawers/gap-drawer';
import { PageDrawer } from './drawers/page-drawer';
import { GapsTab } from './gaps/gaps-tab';
import { MeasuresStrip } from './measures-strip';
import { ScopeToolbar } from './scope-toolbar';
import { useSearchDraft } from './use-search-draft';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';
import { TabNav } from '@/components/app/shell/tab-nav';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { toast } from '@/components/ui/toast';
import { allCitedPagesQuery, type BoardScopeParams } from '@/lib/citations/board-queries';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { formatInteger } from '@/lib/format';
import { PromptOrderContext } from '@/lib/inspector/prompt-order';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import { useCan } from '@/lib/permissions';
import { projectPath, withQuery } from '@/lib/routes/paths';

export interface CitationsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: run days and times are its. */
  timeZone: string;
  /** `Project.primary_domain.registrable_domain`: three strip texts name it (C 214, 250, 253). */
  ownDomain: string | null;
}

export interface CitationsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: CitationsProject;
  /** The route segment: `/ai/citations` or `/ai/citations/gaps` (brief 3.1). */
  tab: 'pages' | 'gaps';
  /** The prompt inspector the route composes (`PromptDrawerHost` of the prompts feature), shown for `inspect=prompt:<id>`. */
  promptDrawer: ReactNode;
}

/** AI > Citations (WP-77, the design preview's #/citations): toolbar, measures, and the Cited pages or Gap analysis table. */
export function CitationsScreen(props: CitationsScreenProps): ReactNode {
  const t = useTranslations('citations');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className="flex flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <h1 className="sr-only">{t('title')}</h1>
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <BoardContent {...props} />;
}

function BoardContent({ workspaceId, workspaceSlug, project, tab, promptDrawer }: CitationsScreenProps): ReactElement {
  const t = useTranslations('citations');
  const source = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const { engines, read: enginesRead } = useBoardEngines(source);
  const { tracked, ownName } = useTracked(source);
  const { terms, ids: termIds } = useTopicTerms(source);
  const options = useMemo(
    () => ({
      engines: engines === null ? null : engines.map((engine) => engine.code),
      terms: termIds,
      tracked: tracked === null ? null : tracked.map((competitor) => competitor.id),
    }),
    [engines, termIds, tracked],
  );
  const { state, set, resetScope, isDefaultScope } = useBoardState(options);

  const scopeEngines = useMemo(
    () =>
      engines === null
        ? []
        : state.platform === 'all'
          ? engines
          : engines.filter((engine) => engine.code === state.platform),
    [engines, state.platform],
  );
  const scope = useMemo(
    (): BoardScopeParams => ({
      runs: state.runs,
      engines: scopeEngines.map((engine) => engine.code),
      term: state.group === 'all' ? null : state.group,
    }),
    [state.runs, scopeEngines, state.group],
  );
  // Nothing is asked before the engines are known: an empty list would mean every engine (D-4)
  const ready = scopeEngines.length > 0;
  const overview = useOverview(source, scope, ready);
  const gaps = useGaps(source, scope, state.competitors, ready);
  const runWindow = overview.data?.window;
  const latest = runWindow?.latest_answer_at ?? null;
  const previous = useMemo(
    () => previousText(state.runs, runWindow?.previous ?? [], project.timeZone, latest, t),
    [state.runs, runWindow?.previous, project.timeZone, latest, t],
  );
  const platformName = state.platform === 'all' ? t('toolbar.allPlatforms') : (scopeEngines[0]?.label ?? '');
  const groupName =
    state.group === 'all' ? t('toolbar.allGroups') : (terms?.find((term) => term.id === state.group)?.name ?? '');
  // The group's name is not known while the terms load: the header shows no empty badge
  const scopeParts = [platformName, groupName, runsLabel(state.runs, t)].filter((part) => part !== '');
  const scopeLine = scopeText({ platform: platformName, group: groupName, runs: state.runs }, t);
  const selected = useMemo(
    () => state.competitors.flatMap((id) => tracked?.find((competitor) => competitor.id === id) ?? []),
    [state.competitors, tracked],
  );

  // The search: the input keeps what is typed, the address the trimmed text a moment after the last key (C 63)
  const commitSearch = useCallback((search: string) => set({ search }), [set]);
  const [searchText, setSearchText] = useSearchDraft(state.search, commitSearch);

  // The drawers: `inspect=cited-page:<url_id>`, `inspect=gap-prompt:<prompt_id>`, `inspect=prompt:<id>` in place
  const inspector = useInspector();
  const [pageOrder, setPageOrder] = useState<readonly string[]>([]);
  const [gapOrder, setGapOrder] = useState<readonly string[]>([]);
  const [promptOrder, setPromptOrder] = useState<readonly string[]>([]);
  const pageStepping = useInspectorStepping({
    inspector,
    type: 'cited-page',
    order: pageOrder,
    typeLabel: t('pageDrawer.type'),
    typeNoun: t('pageDrawer.noun'),
  });
  const gapStepping = useInspectorStepping({
    inspector,
    type: 'gap-prompt',
    order: gapOrder,
    typeLabel: t('gapDrawer.type'),
    typeNoun: t('gapDrawer.noun'),
  });
  const { open } = inspector;
  const openPage = useCallback(
    (row: { url_id: number }) => open({ type: 'cited-page', id: String(row.url_id) }),
    [open],
  );
  const openGap = useCallback((row: { prompt_id: string }) => open({ type: 'gap-prompt', id: row.prompt_id }), [open]);
  // The prompt inspector starts on its first tab, not on the tab the drawer it replaces was on
  const openPrompt = (promptId: string, ids: readonly string[]): void => {
    setPromptOrder(ids);
    open({ type: 'prompt', id: promptId }, { tab: DEFAULT_INSPECTOR_TAB });
  };

  const target = inspector.target;
  let drawer: ReactNode = null;
  if (target?.type === 'cited-page' && ready && /^\d+$/.test(target.id)) {
    drawer = (
      <PageDrawer
        key={project.id}
        project={source}
        scope={scope}
        urlId={Number(target.id)}
        engines={scopeEngines}
        scopeParts={scopeParts}
        scopeText={scopeLine}
        stepping={pageStepping}
        tab={inspector.tab}
        onTabChange={inspector.setTab}
        onClose={inspector.close}
        onOpenPrompt={openPrompt}
        timeZone={project.timeZone}
      />
    );
  } else if (target?.type === 'gap-prompt' && ready && selected.length > 0) {
    drawer = (
      <GapDrawer
        key={project.id}
        project={source}
        scope={scope}
        competitors={selected}
        ownName={ownName ?? project.name}
        promptId={target.id}
        engines={scopeEngines}
        scopeParts={scopeParts}
        scopeText={scopeLine}
        stepping={gapStepping}
        tab={inspector.tab}
        onTabChange={inspector.setTab}
        onClose={inspector.close}
        onOpenAnswers={(promptId) => openPrompt(promptId, gapOrder)}
      />
    );
  } else if (target?.type === 'prompt') {
    drawer = promptDrawer;
  }

  // The tabs are routes; the scope and the search go with them, the drawer does not (C 266 to 269)
  const address = useSearchParams().toString();
  const hrefOf = (path: '/ai/citations' | '/ai/citations/gaps'): ReturnType<typeof projectPath> => {
    const query = new URLSearchParams(address);
    query.delete('inspect');
    query.delete('itab');
    return withQuery(projectPath(workspaceSlug, project.slug, path), query.toString());
  };
  const gapCount = state.competitors.length > 0 ? gaps.data?.meta.gaps : undefined;
  const tabs = (
    <TabNav
      variant="segmented"
      label={t('board.tabsLabel')}
      items={[
        { href: hrefOf('/ai/citations'), label: t('board.pagesTab'), current: tab === 'pages' },
        {
          href: hrefOf('/ai/citations/gaps'),
          label: t('board.gapsTab'),
          current: tab === 'gaps',
          badge:
            gapCount === undefined
              ? undefined
              : { text: formatInteger(gapCount), spoken: t('board.gapsCount', { count: gapCount }) },
        },
      ]}
    />
  );

  // Export: the tab on screen, every row the API has for Cited pages (D-6), the rows shown in their order for Gap analysis
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const exportTab = async (): Promise<void> => {
    setExporting(true);
    try {
      if (tab === 'pages') {
        const all = await queryClient.fetchQuery({
          ...allCitedPagesQuery(source, scope, { role: ownerRole(state.owner), q: state.search, sort: '-citations' }),
          staleTime: 0,
        });
        downloadBlob(csvBlob(pagesCsv(all.data, scopeEngines, project.timeZone, t)), `${t('download.pagesFile')}.csv`);
        toast({ type: 'success', title: t('download.done', { count: all.data.length }) });
      } else {
        const byId = new Map((gaps.data?.data ?? []).map((row) => [row.prompt_id, row]));
        const rows = gapOrder.flatMap((id) => byId.get(id) ?? []);
        downloadBlob(
          csvBlob(gapsCsv(rows, selected, ownName ?? project.name, scopeEngines, t)),
          `${t('download.gapsFile')}.csv`,
        );
        toast({ type: 'success', title: t('download.done', { count: rows.length }) });
      }
    } catch {
      toast({ type: 'error', title: t('download.failed'), description: t('download.failedReason') });
    } finally {
      setExporting(false);
    }
  };

  const [pickerOpen, setPickerOpen] = useState(false);

  let main: ReactNode;
  if (enginesRead.status === 'error') {
    main = (
      <InlineError
        title={t('board.loadFailedTitle')}
        reason={t('board.loadFailedReason')}
        errorId={enginesRead.errorId}
        onRetry={enginesRead.retry}
        retrying={enginesRead.retrying}
        retryLabel={t('board.retry')}
      />
    );
  } else if (engines !== null && engines.length === 0) {
    main = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('board.noEngineTitle')}
        reason={t('board.noEngineReason')}
      />
    );
  } else if (tab === 'pages') {
    main = (
      <PagesTab
        project={source}
        scope={scope}
        ready={ready}
        engines={scopeEngines}
        owner={state.owner}
        search={searchText}
        onOwnerChange={(owner) => set({ owner })}
        onSearchChange={setSearchText}
        onResetScope={resetScope}
        tabs={tabs}
        previous={previous}
        scopeText={scopeLine}
        timeZone={project.timeZone}
        activeId={target?.type === 'cited-page' ? target.id : null}
        onOpen={openPage}
        onOrderChange={setPageOrder}
      />
    );
  } else {
    main = (
      <GapsTab
        read={gaps}
        competitors={selected}
        ownName={ownName ?? project.name}
        engines={scopeEngines}
        gapsOnly={state.gapsOnly}
        search={searchText}
        onGapsOnlyChange={(gapsOnly) => set({ gapsOnly })}
        onSearchChange={setSearchText}
        onResetScope={resetScope}
        onChooseCompetitors={() => setPickerOpen(true)}
        tabs={tabs}
        scopeText={scopeLine}
        timeZone={project.timeZone}
        activeId={target?.type === 'gap-prompt' ? target.id : null}
        onOpen={openGap}
        onOrderChange={setGapOrder}
      />
    );
  }

  return (
    <PromptOrderContext.Provider value={promptOrder}>
      <InspectorLayout inspector={drawer}>
        {/* The preview's page body (index.html line 278): the table panel fills what the toolbar and the strip leave */}
        <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
          <ScopeToolbar
            state={state}
            engines={engines ?? []}
            terms={terms}
            tracked={tracked}
            trend={runWindow?.trend ?? []}
            timeZone={project.timeZone}
            latest={latest}
            isDefaultScope={isDefaultScope}
            onChange={set}
            onReset={resetScope}
            onExport={() => void exportTab()}
            exporting={exporting}
            pickerOpen={pickerOpen}
            onPickerOpenChange={setPickerOpen}
          />
          {overview.status === 'error' ? (
            <InlineError
              title={t('measures.loadFailed')}
              reason={t('board.loadFailedReason')}
              errorId={overview.errorId}
              onRetry={overview.retry}
              retrying={overview.retrying}
              retryLabel={t('board.retry')}
            />
          ) : (
            <MeasuresStrip
              overview={overview.data}
              status={overview.refetching ? 'refetching' : overview.status === 'loading' ? 'loading' : 'ready'}
              allPlatforms={state.platform === 'all'}
              ownDomain={project.ownDomain ?? project.name}
              previous={previous}
            />
          )}
          {main}
        </div>
      </InspectorLayout>
    </PromptOrderContext.Provider>
  );
}
