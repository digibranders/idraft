'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, Link2, MoreHorizontal, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';

import { CompareSelect } from './compare-select';
import { useChangeCounts, useDiversity, useLatestCitation, usePreviousMeta, useScopeMeta } from './citation-reads';
import { useCitationScope, toFilters } from './citation-scope';
import { activeCitationTab, CITATION_TABS, type CitationTabContext } from './citation-tabs';
import { CITATION_VIEW_KEYS, citationViews } from './citation-views';
import { citationFilterFields } from './citations-filters';
import { CitationsStrip } from './citations-strip';
import type { StripReads } from './strip-model';
import { DateRangePicker } from '@/components/app/date-range/date-range-picker';
import { droppedMessageKey } from '@/components/app/date-range/range-model';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { SavedViewMenu } from '@/components/app/views/saved-view-menu';
import { useSavedView } from '@/components/app/views/use-saved-view';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { apiQuery } from '@/lib/api/query';
import { roleUnits } from '@/lib/citations/share-model';
import type { EngineCode, SourceScope } from '@/lib/citations/types';
import { copyText } from '@/lib/dom/clipboard';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import {
  EMPTY_VALUE,
  formatBusinessDate,
  formatIsoDate,
  formatList,
  formatRelative,
  formatTableDateTime,
} from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

export interface CitationsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the window's days are its days. */
  timeZone: string;
}

export interface CitationsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: CitationsProject;
}

const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines';
/** The id of the More actions item that copies the link. */
const COPY_LINK = 'copy-link';
const DAY_MS = 86_400_000;
/** The address's `cmp` for a comparison that is on (no key, the default) or off. */
const cmpOf = (compare: boolean): string | null => (compare ? null : 'off');
// shortcut: stale from 7 days on, the same rule as the prompt History's `STALE_AFTER_DAYS` (features/prompts/
// history-model.ts, which a feature may not import); replace both with the shared stale rule of WP-18 (CF-27)
const STALE_AFTER_DAYS = 7;
const NO_ENGINES: readonly never[] = [];

/**
 * AI > Citations (DS 9.6 and 9.7, WB-CIT-02 to 05): the header, the summary strip of the whole scope, the filter
 * row and the tabs whose panels `CITATION_TABS` lists. The date range is the top bar's project-wide scope. Reads
 * wait for the engines: an engine of a link that is off is left out of the scope, and an empty list would mean
 * every engine, so nothing is asked until the engines are known.
 */
export function CitationsScreen(props: CitationsScreenProps): ReactNode {
  const t = useTranslations('citations');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <CitationsContent {...props} />;
}

function CitationsContent({ workspaceId, workspaceSlug, project }: CitationsScreenProps): ReactElement {
  const t = useTranslations('citations');
  const filterWords = useTranslations('citations.filters');
  const common = useTranslations('common');
  const locale = useLocale();
  const source = useMemo((): SourceScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);

  // The engines: which are on, and their names. Stable identities, so the scope is not rebuilt on every render
  const engines = useQuery(
    apiQuery(ENGINES, { params: { path: { workspace_id: workspaceId, project_id: project.id } } }),
  );
  const enabled = useMemo(
    () => (engines.data === undefined ? NO_ENGINES : engines.data.data.filter((engine) => engine.is_enabled)),
    [engines.data],
  );
  const enabledEngines = useMemo(
    (): readonly EngineCode[] => enabled.map((engine) => engine.engine.engine_code),
    [enabled],
  );
  const engineLabels = useMemo(
    () => new Map((engines.data?.data ?? []).map((engine) => [engine.engine.engine_code, engine.engine.label])),
    [engines.data],
  );
  const labelOf = useCallback((code: EngineCode): string => engineLabels.get(code) ?? code, [engineLabels]);
  // Not before the engines are known: a disabled read shows loading, and nothing is requested
  const enginesReady = engines.data !== undefined && enabledEngines.length > 0;

  const { scope, picked, range, setSearch } = useCitationScope(project.timeZone, enabledEngines);
  // The same day the scope's window ends on: a day of the project's zone, the one place the clock is read
  const today = useZoneDay(project.timeZone);
  const filters = useMemo(() => toFilters(scope, range), [scope, range]);

  // The strip: each read loads and fails alone, and none takes the role filter
  const scopeMeta = useScopeMeta(source, filters, enginesReady);
  const previousMeta = usePreviousMeta(source, filters, scopeMeta.data?.meta, scope.compare);
  const diversity = useDiversity(source, filters, enginesReady);
  const newSources = useChangeCounts(source, filters, { kind: 'new', minSupport: scope.minSupport }, enginesReady);
  const lostSources = useChangeCounts(source, filters, { kind: 'lost', minSupport: scope.minSupport }, enginesReady);
  const latest = useLatestCitation(source, filters, enginesReady);
  const stripReads: StripReads = {
    scope: scopeMeta,
    previous: previousMeta,
    diversity,
    newSources,
    lostSources,
  };

  // The filter bar: Engine waits for the engines and Topic for the vocabularies, so a link's value is kept until then
  const vocabularies = useVocabularies(source);
  const topics = useMemo(
    () => vocabularies.loaded.filter((entry) => entry.vocabulary.kind === 'topic').flatMap((entry) => entry.terms),
    [vocabularies.loaded],
  );
  const meta = scopeMeta.data?.meta;
  const byRole = useMemo(() => (meta === undefined ? null : roleUnits(meta)), [meta]);
  // The tab shown: the one asked for, or Domains while that one is not listed. Its filters and context follow it
  const tab = useMemo(() => activeCitationTab(CITATION_TABS, scope.tab), [scope.tab]);
  const activeId = tab?.id ?? 'domains';
  const fields = useMemo(
    () =>
      citationFilterFields({
        t: filterWords,
        tab: activeId,
        engines: enabledEngines.map((code) => ({ code, label: labelOf(code) })),
        enginesLoading: engines.data === undefined,
        roleUnits: byRole,
        topics,
        topicsLoading: vocabularies.pending || vocabularies.error,
      }),
    [
      filterWords,
      activeId,
      enabledEngines,
      labelOf,
      engines.data,
      byRole,
      topics,
      vocabularies.pending,
      vocabularies.error,
    ],
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

  // The saved view menu and the header
  const views = useMemo(() => citationViews((key) => t(`views.${key}`)), [t]);
  const savedView = useSavedView({ views, viewKeys: CITATION_VIEW_KEYS });
  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };

  // "Updated ..." is the newest citation in scope; a week old or more it says so
  const newest = latest.data?.data[0]?.observed_at;
  const metaLine = ((): string => {
    if (meta === undefined) return EMPTY_VALUE;
    if (meta.citation_units === 0) return t('metaNone');
    const counts = { units: meta.citation_units, answers: meta.answers };
    if (newest === undefined) return t('metaCounts', counts);
    // Whole project days since the newest citation, so the clock is read in one place (`useZoneDay`)
    if ((Date.parse(today) - Date.parse(formatIsoDate(newest, project.timeZone))) / DAY_MS >= STALE_AFTER_DAYS) {
      return t('metaStale', { date: formatTableDateTime(newest, project.timeZone) });
    }
    return t('meta', { time: formatRelative(newest, project.timeZone), ...counts });
  })();

  // A link whose range was not used says why, for as long as the address keeps it (13 section 5)
  const { dropped } = picked;
  const droppedWords =
    dropped === null
      ? null
      : common(`dateRange.${droppedMessageKey(dropped)}`, {
          max: dropped.code === 'too_long' ? dropped.max : 0,
          date: dropped.code === 'before_start' ? formatBusinessDate(dropped.earliest) : '',
        });

  const header = (
    <PageHeader
      title={t('title')}
      meta={enginesReady ? metaLine : undefined}
      actions={
        <>
          <SavedViewMenu
            views={views}
            current={savedView.view}
            viewKeys={CITATION_VIEW_KEYS}
            edited={savedView.edited}
            onApply={savedView.apply}
            onReset={savedView.reset}
          />
          <Menu
            align="end"
            trigger={<IconButton icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
            items={[{ id: COPY_LINK, label: t('copyLink'), icon: Link2, onSelect: copyLink }]}
          />
        </>
      }
    />
  );

  let body: ReactNode;
  if (engines.isError && engines.data === undefined) {
    // Never an empty list: that would read as every engine
    body = (
      <InlineError
        title={t('empty.failedTitle')}
        reason={t('empty.failedReason')}
        errorId={null}
        onRetry={() => void engines.refetch()}
        retrying={engines.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (engines.data !== undefined && enabledEngines.length === 0) {
    body = (
      <EmptyState
        icon={Power}
        title={t('empty.noEngineTitle')}
        reason={t('empty.noEngineReason')}
        headingLevel={2}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
            {t('empty.toEngines')}
          </TextLink>
        }
      />
    );
  } else {
    const context: CitationTabContext = {
      source,
      workspaceSlug,
      projectSlug: project.slug,
      timeZone: project.timeZone,
      scope: { ...scope, tab: activeId },
      filters,
      range,
      enabledEngines,
      labelOf,
      meta: scopeMeta,
      previousMeta,
      setSearch,
      filterBar: { fields, values, onClear: () => setValues({}) },
    };
    // The scope read failing leaves nothing to show a panel against; any other read fails alone, and the strip says so.
    // A refetch that failed keeps its data and has an error id, so the read is failed whenever it has one
    const scopeFailed = scopeMeta.status === 'error';
    // With the comparison off the read of the previous period has nothing to ask, so it has no error to count
    const failed = Object.values(stripReads).filter((read) => read.errorId !== null);
    const partial = !scopeFailed && failed.length > 0;
    body = (
      <Tabs
        variant="underline"
        label={t('tabs.label')}
        value={activeId}
        // A view is a place to go back to: the tab is the one change of the page that makes a history entry
        onValueChange={(next) => setSearch({ tab: next === 'domains' ? null : next }, { history: 'push' })}
        items={CITATION_TABS.map((entry) => ({ value: entry.id, label: entry.label(t) }))}
        className="min-h-0 flex-1 gap-3"
      >
        {scopeFailed ? (
          <InlineError
            title={t('empty.failedTitle')}
            reason={t('empty.failedReason')}
            errorId={scopeMeta.errorId}
            onRetry={scopeMeta.retry}
            retrying={scopeMeta.retrying}
            retryLabel={common('retry')}
            live
          />
        ) : (
          <CitationsStrip reads={stripReads} scope={scope} labelOf={labelOf} />
        )}
        {partial ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('strip.partial')}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={failed.some((read) => read.retrying)}
                onClick={() => {
                  for (const read of failed) read.retry();
                }}
              >
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-24">
            <FilterBar fields={fields} values={values} onChange={setValues} />
          </div>
          <div className="ml-auto flex h-control shrink-0 items-center">
            <CompareSelect compare={scope.compare} onCompareChange={(next) => setSearch({ cmp: cmpOf(next) })} />
          </div>
        </div>
        {scopeFailed || tab === null ? null : (
          <TabsPanel value={tab.id} className="flex min-h-0 flex-1 flex-col gap-3">
            {tab.render(context)}
          </TabsPanel>
        )}
      </Tabs>
    );
  }

  return (
    <InspectorLayout inspector={null}>
      <TopBarPortal>
        <DateRangePicker
          value={picked.value}
          onValueChange={picked.onValueChange}
          today={today}
          timeZone={project.timeZone}
        />
      </TopBarPortal>
      {/* The window's height, as the Prompts page has it: the table of a tab fills what the strip and the filters leave */}
      <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        {header}
        {droppedWords === null ? null : <Banner tone="info" placement="region" message={droppedWords} />}
        {body}
      </div>
    </InspectorLayout>
  );
}
