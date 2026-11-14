'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { AiTab } from './ai/ai-tab';
import { AddCompetitorControlProvider } from './add-competitor-control';
import { ComparisonTab } from './comparison/comparison-tab';
import { CompetitorsProvider, type CompetitorsContextValue, type CompetitorsProject } from './competitors-context';
import { NoEngine, ReadFailed } from './competitors-states';
import { enginesQuery } from './data/competitors-queries';
import { useCompetitorsReads, type InspectedCompetitor } from './data/use-competitors-reads';
import { CompetitorsHeader } from './header/competitors-header';
import { CompareSelect } from './scope/compare-select';
import { competitorFilterFields } from './scope/filter-fields';
import { usePromptCountries } from './scope/prompt-countries';
import type { CompetitorTab } from './scope/scope-model';
import { useCompetitorsScope } from './scope/use-competitors-scope';
import { SeoTab } from './seo/seo-tab';
import { CandidatesTabPanel, useCandidatesCount } from './tabs/candidates-tab';
import { competitorTabItems } from './tabs/competitor-tabs';
import { DateRangePicker } from '@/components/app/date-range/date-range-picker';
import { droppedMessageKey } from '@/components/app/date-range/range-model';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { CountryScopeControl, type CountryScopeLabels } from '@/components/app/scope/country-scope-control';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import type { EngineCode } from '@/lib/api/types';
import type { SourceScope } from '@/lib/citations/types';
import { formatBusinessDate, formatList } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { canWriteEntities, useCan, useMembership } from '@/lib/permissions';

export type { CompetitorsProject } from './competitors-context';

export interface CompetitorsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: CompetitorsProject;
  /**
   * The Add competitor dialog, which the route passes in (a route may import the entities feature, this feature may
   * not). It reads its open state from `useAddCompetitorControl`, and draws nothing while the control is closed.
   */
  addCompetitorSlot?: ReactNode;
}

const NO_ENGINES: readonly never[] = [];

/**
 * Competitors (WP-39, DS 24 section 9.8): the header, the filter row and the four tabs. A member without `data:read`
 * is told so and nothing is read. The date range and the country are the top bar's project-wide scope. Reads wait
 * for the engines: an engine of a link that is off is left out of the scope, and an empty list would mean every
 * engine, so nothing is asked until the engines are known.
 */
export function CompetitorsScreen(props: CompetitorsScreenProps): ReactNode {
  const t = useTranslations('competitors');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <CompetitorsContent {...props} />;
}

/** The shape of the finished page while the engines load, so no empty state is ever drawn from `loading`. */
function PageSkeleton(): ReactElement {
  return (
    <div data-testid="competitors-skeleton" aria-busy="true" className="flex flex-col gap-3">
      <Skeleton shape="block" height="row" widthPct={48} />
      <Skeleton shape="block" height="chart-140" />
      <Skeleton shape="block" height="chart-180" />
    </div>
  );
}

function CompetitorsContent({
  workspaceId,
  workspaceSlug,
  project,
  addCompetitorSlot,
}: CompetitorsScreenProps): ReactElement {
  const t = useTranslations('competitors');
  const filterWords = useTranslations('competitors.filters');
  const scopeWords = useTranslations('competitors.scope');
  const common = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const source = useMemo((): SourceScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);

  // The engines: which are on, and their names. Stable identities, so the scope is not rebuilt on every render
  const engines = useQuery(enginesQuery(source));
  const enabled = useMemo(
    () => (engines.data === undefined ? NO_ENGINES : engines.data.data.filter((engine) => engine.is_enabled)),
    [engines.data],
  );
  const enabledEngines = useMemo(
    (): readonly EngineCode[] => enabled.map((engine) => engine.engine.engine_code),
    [enabled],
  );
  const engineList = useMemo(
    () => enabled.map((engine) => ({ code: engine.engine.engine_code, label: engine.engine.label })),
    [enabled],
  );
  const labelOf = useCallback(
    (code: EngineCode): string => engineList.find((engine) => engine.code === code)?.label ?? code,
    [engineList],
  );
  // Not before the engines are known: a disabled read shows loading, and nothing is requested
  const enginesReady = engines.data !== undefined && enabledEngines.length > 0;

  const { scope, picked, range, today, setScope } = useCompetitorsScope(project.timeZone, enabledEngines);

  // The inspector is T7's: its address keys decide which competitor's reads are asked
  const inspector = useInspector();
  const inspect = useMemo((): InspectedCompetitor | null => {
    if (inspector.target?.type !== 'competitor') return null;
    return { id: inspector.target.id, tab: inspector.tab === 'sources' ? 'sources' : 'overview' };
  }, [inspector.target, inspector.tab]);

  const reads = useCompetitorsReads({ project: source, scope, range, enabledEngines, enginesReady, inspect });

  // Add competitor: the route's dialog, opened from the header or the empty state, then the reads of the set again
  const canAdd = canWriteEntities(useMembership());
  const canManageEngines = useCan('projects:write');
  const [adding, setAdding] = useState(false);
  const addCompetitor = useMemo(() => (canAdd ? () => setAdding(true) : null), [canAdd]);
  const closeAdd = useCallback((): void => {
    setAdding(false);
    // The tracked set, and share of voice with it, changed from today
    void queryClient.invalidateQueries({ queryKey: [...projectKey(workspaceId, project.id), 'ai'] });
  }, [queryClient, workspaceId, project.id]);

  // The country is scope, like the date range: the top bar chooses it and the filter bar's Clear leaves it
  const countries = usePromptCountries(source, scope.country);
  const countryLabels = useMemo(
    (): CountryScopeLabels => ({
      country: (name) => scopeWords('country', { country: name }),
      allCountries: scopeWords('allCountries'),
      search: scopeWords('search'),
      empty: (query) => scopeWords('countryEmpty', { query }),
      clear: scopeWords('clear'),
      open: scopeWords('open'),
    }),
    [scopeWords],
  );

  // The filter bar: Engine waits for the engines and Topic for the vocabularies, so a link's value is kept until then
  const vocabularies = useVocabularies(source);
  const topics = useMemo(
    () => vocabularies.loaded.filter((entry) => entry.vocabulary.kind === 'topic').flatMap((entry) => entry.terms),
    [vocabularies.loaded],
  );
  const fields = useMemo(
    () =>
      competitorFilterFields({
        t: filterWords,
        engines: engineList,
        enginesLoading: engines.data === undefined,
        topics,
        topicsLoading: vocabularies.pending || vocabularies.error,
      }),
    [filterWords, engineList, engines.data, topics, vocabularies.pending, vocabularies.error],
  );
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: filterWords('droppedTitle', { count: dropped.length }),
        description: filterWords('droppedDescription', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });

  const candidatesCount = useCandidatesCount();
  const tabItems = useMemo(() => competitorTabItems((id) => t(`tabs.${id}`), candidatesCount), [t, candidatesCount]);

  const context: CompetitorsContextValue = {
    workspaceId,
    workspaceSlug,
    project,
    source,
    scope,
    setScope,
    range,
    today,
    engines: engineList,
    labelOf,
    reads,
    addCompetitor,
  };

  // A link whose range was not used says why, for as long as the address keeps it (13 section 5)
  const { dropped } = picked;
  const droppedWords =
    dropped === null
      ? null
      : common(`dateRange.${droppedMessageKey(dropped)}`, {
          max: dropped.code === 'too_long' ? dropped.max : 0,
          date: dropped.code === 'before_start' ? formatBusinessDate(dropped.earliest) : '',
        });

  // The meta line counts what the engines answered: a skeleton while they load, nothing once they failed or none is on
  const metaWanted = engines.data === undefined ? !engines.isError : enabledEngines.length > 0;

  // The tabs that read the scope say they are reading again while they keep the last figures on screen
  const filtered = scope.tab === 'comparison' || scope.tab === 'ai';
  const refetching =
    scope.tab === 'comparison'
      ? [reads.competitors, reads.lost, reads.topics].some((read) => read.status === 'refetching')
      : [reads.competitors, reads.series].some((read) => read.status === 'refetching');

  const panels: Record<CompetitorTab, ReactNode> = {
    comparison: <ComparisonTab />,
    seo: <SeoTab workspaceSlug={workspaceSlug} projectSlug={project.slug} />,
    ai: <AiTab />,
    candidates: <CandidatesTabPanel />,
  };

  let body: ReactNode;
  if (engines.isError && engines.data === undefined) {
    // Never an empty list: that would read as every engine
    body = (
      <ReadFailed
        title={t('loadFailedTitle')}
        reason={t('loadFailedReason')}
        errorId={isApiProblem(engines.error) ? engines.error.requestId : null}
        onRetry={() => void engines.refetch()}
        retrying={engines.isFetching}
      />
    );
  } else if (engines.data === undefined) {
    body = <PageSkeleton />;
  } else if (enabledEngines.length === 0) {
    body = <NoEngine workspaceSlug={workspaceSlug} projectSlug={project.slug} canManage={canManageEngines} />;
  } else {
    body = (
      <Tabs
        variant="underline"
        label={t('tabs.label')}
        value={scope.tab}
        // A tab is a place to go back to: the one change of the page that makes a history entry
        onValueChange={(next) => setScope({ tab: next })}
        items={tabItems}
        className="gap-3"
      >
        {filtered ? (
          <>
            {/* The bar overlays the gap under the filter row, so it takes no room when it appears */}
            <div className="relative flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-24">
                <FilterBar fields={fields} values={values} onChange={setValues} />
              </div>
              <div className="ml-auto flex h-control shrink-0 items-center">
                <CompareSelect compare={scope.compare} onCompareChange={(next) => setScope({ compare: next })} />
              </div>
              <RefetchBar active={refetching} position="under-filter-bar" />
            </div>
            {scope.country === null ? null : (
              <p className="type-meta">{scopeWords('note', { country: countries.nameOf(scope.country) })}</p>
            )}
            {reads.competitors.stale ? (
              <Banner tone="warning" placement="region" live message={t('states.stale')} />
            ) : null}
          </>
        ) : null}
        <TabsPanel value={scope.tab} aria-busy={refetching || undefined} className="flex flex-col gap-3">
          {panels[scope.tab]}
        </TabsPanel>
      </Tabs>
    );
  }

  return (
    <CompetitorsProvider value={context}>
      <AddCompetitorControlProvider open={adding} onClose={closeAdd}>
        <InspectorLayout inspector={null}>
          <TopBarPortal>
            <DateRangePicker
              value={picked.value}
              onValueChange={picked.onValueChange}
              today={today}
              timeZone={project.timeZone}
            />
            <CountryScopeControl
              country={scope.country}
              isos={countries.isos}
              nameOf={countries.nameOf}
              labels={countryLabels}
              onCountryChange={(iso) => setScope({ country: iso })}
            />
          </TopBarPortal>
          <div className={PAGE_CLASS}>
            <CompetitorsHeader metaWanted={metaWanted} />
            {droppedWords === null ? null : <Banner tone="info" placement="region" message={droppedWords} />}
            {body}
          </div>
        </InspectorLayout>
        {addCompetitorSlot}
      </AddCompetitorControlProvider>
    </CompetitorsProvider>
  );
}
