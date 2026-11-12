'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, MessageSquare, Plus, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { AddPromptsDialog } from './add-prompts-dialog';
import { AnswerInspector } from './answer-inspector';
import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';
import { PromptInspector, type PromptCounts } from './prompt-inspector';
import {
  collectTopicTerms,
  DEFAULT_WINDOW,
  hasAnswers,
  matchesTopics,
  NO_TOPIC,
  parseTab,
  parseTopicTab,
  parseWindow,
  PROMPTS_TABS,
  topicChoices,
  topicDescendants,
  topicPrompts,
  topicOriginOf,
  topicsBelow,
  topicSummaryRow,
  topicTermsOf,
  WINDOW_DAYS,
  windowRange,
  type PromptsTab,
  type TopicOrigin,
  type TopicTab,
} from './prompt-model';
import { enginesQuery, observationQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';
import { PromptsStrip } from './prompts-strip';
import { topicsSpanned, type StripPrompt } from './strip-model';
import { TopicInspector } from './topic-inspector';
import { TopicsTable } from './topics-table';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import type { FilterField } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { useErrorId } from '@/lib/api/use-error-id';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { formatBusinessDate, formatInteger, formatList } from '@/lib/format';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import {
  DEFAULT_DENSITY,
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

export interface PromptsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the window's days are its days. */
  timeZone: string;
  /** The project's defaults, which Add prompts starts on. */
  defaultLanguage: string | null;
  defaultCountryIso: string | null;
}

export interface PromptsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: PromptsProject;
}

/**
 * The URL's keys besides the filters': the tab (Topics has none), the window and the tables' state. They all
 * stay when the tab changes; the sort and the columns are the Prompts table's, and the Topics table ignores them.
 */
const VIEW_STATE = {
  tab: parseAsString,
  window: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
};

const promptRowId = (row: PromptRow): string => row.prompt.prompt_id;

/**
 * AI > Topics & Prompts (spec 2026-11-11 section 4.6, ADR-DS-022): the project's prompts over a window of
 * days (28 by default, in the top bar as a project-wide scope), with Mentioned and Cited per enabled engine.
 * The filter bar narrows by topic, country and engine; branded prompts are left out of the table and the
 * counts until the Branded filter includes them (16-metrics-methodology.md rule 4). A project
 * without an engine on is sent to Settings > Engines; until the first answers arrive the page says when they
 * come, so an empty table is not read as a failure.
 */
export function PromptsScreen(props: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <PromptsContent {...props} />;
}

function PromptsContent({ workspaceId, workspaceSlug, project }: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const common = useTranslations('common');
  const locale = useLocale();
  const canWrite = useCan('prompts:write');
  const [addOpen, setAddOpen] = useState(false);
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const tab = parseTab(view.tab);
  const windowDays = parseWindow(view.window);
  // The same date all UTC day; a new day is read at midnight UTC
  const now = useUtcDay();
  const range = useMemo(() => windowRange(windowDays, now, project.timeZone), [windowDays, now, project.timeZone]);

  const engines = useQuery(enginesQuery(scope));
  const enginesErrorId = useErrorId(engines.error);
  const enabled = useMemo(() => (engines.data?.data ?? []).filter((engine) => engine.is_enabled), [engines.data]);
  const { countries } = useCountries();
  const countryName = useMemo(
    () => new Map(countries.map((country) => [country.country_iso, country.name])),
    [countries],
  );
  const list = usePromptList(scope);
  const listErrorId = useErrorId(list.error);

  // The options are the topics and countries the prompts carry: a value from a link waits until every page is in
  const optionsPending = list.loading || list.fetching || list.hasMore || list.error !== null;
  const topicTerms = useMemo(() => collectTopicTerms(list.rows), [list.rows]);
  // Where a topic sits comes from the topic vocabularies' trees, not from the prompts: the summary has a row for
  // every topic above one a prompt is given too. Until the trees are read (or when they fail) a topic stands alone
  const vocabularies = useVocabularies(scope);
  const topicTree = useMemo(
    () => vocabularies.loaded.filter((entry) => entry.vocabulary.kind === 'topic').flatMap((entry) => entry.terms),
    [vocabularies.loaded],
  );
  const topicsUnknown = vocabularies.pending || vocabularies.error;
  const fields = useMemo((): FilterField[] => {
    const choices = topicChoices(topicTree, topicTerms);
    // Two topics of one name under different parents are told apart by their paths
    const nameCounts = new Map<string, number>();
    for (const choice of choices) nameCounts.set(choice.name, (nameCounts.get(choice.name) ?? 0) + 1);
    const isos = new Set(list.rows.flatMap((prompt) => (prompt.country_iso === null ? [] : [prompt.country_iso])));
    return [
      {
        id: 'topic',
        kind: 'enum',
        label: t('filters.topic'),
        multi: true,
        optionsLoading: optionsPending || topicsUnknown,
        options: choices.map((choice) => ({
          value: choice.termId,
          label:
            (nameCounts.get(choice.name) ?? 0) > 1
              ? t('filters.topicWithPath', { name: choice.name, path: choice.path })
              : choice.name,
        })),
      },
      // A topic's counts come from the API for all of its prompts, so the Topics tab takes no country filter. A
      // country in the address stays there, unread, for the Prompts tab
      ...(tab === 'prompts'
        ? [
            {
              id: 'country',
              kind: 'enum' as const,
              label: t('filters.country'),
              multi: true,
              optionsLoading: optionsPending,
              options: [...isos].map((iso) => ({ value: iso, label: countryName.get(iso) ?? iso })),
            },
          ]
        : []),
      {
        id: 'engine',
        kind: 'enum',
        label: t('filters.engine'),
        multi: true,
        // A failed read leaves the options unknown too: the link's engine is kept until they arrive
        optionsLoading: engines.data === undefined,
        options: enabled.map((engine) => ({ value: engine.engine.engine_code, label: engine.engine.label })),
      },
      {
        id: 'branded',
        kind: 'enum',
        label: t('filters.branded'),
        multi: false,
        options: [{ value: 'include', label: t('filters.brandedInclude') }],
      },
    ];
  }, [t, tab, list.rows, optionsPending, topicsUnknown, topicTree, topicTerms, countryName, enabled, engines.data]);
  // A filter of a shared link that does not read is left out, and the person is told (13 section 5)
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('droppedFilters.title', { count: dropped.length }),
        description: t('droppedFilters.description', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });
  const filtered = Object.keys(values).length > 0;
  // The topic and country narrow the rows; the engine only picks columns, and Branded adds rows
  const narrowed = values.topic !== undefined || values.country !== undefined;
  const clearFilters = useCallback(() => setValues({}), [setValues]);
  const includeBranded = enumValuesOf(values.branded).includes('include');
  // Only the engines the Engine filter names, else every engine that is on
  const shown = useMemo(() => {
    const chosen = enumValuesOf(values.engine);
    return chosen.length === 0 ? enabled : enabled.filter((engine) => chosen.includes(engine.engine.engine_code));
  }, [enabled, values.engine]);

  // The table stays on the last counts while a new window, or the Branded filter, is read
  const summary = useQuery({
    ...summaryQuery(scope, range, includeBranded),
    enabled: enabled.length > 0,
    placeholderData: keepPreviousData,
  });
  const summaryById = useMemo(
    () => new Map((summary.data?.data.prompts ?? []).map((row) => [row.prompt_id, row])),
    [summary.data],
  );
  // Counts kept from another window or branded choice are not this one's: a prompt without a row in them is unknown
  const countsLoaded = summary.data !== undefined && !summary.isPlaceholderData;
  const topicIds = useMemo(() => enumValuesOf(values.topic), [values.topic]);
  const descendants = useMemo(
    () => topicDescendants(topicTree, [...topicTerms.keys(), ...topicIds]),
    [topicTree, topicTerms, topicIds],
  );
  // The chosen topics and every topic below them: what both tabs keep
  const kept = useMemo(() => topicsBelow(topicIds, descendants), [topicIds, descendants]);
  // Branded prompts stay out of the table and the counts until included (16-metrics-methodology.md rule 4)
  const rows = useMemo((): PromptRow[] => {
    const countries = enumValuesOf(values.country);
    return list.rows
      .filter(
        (prompt) =>
          (includeBranded || !prompt.is_branded) &&
          (topicIds.length === 0 || matchesTopics(prompt, kept)) &&
          (countries.length === 0 || (prompt.country_iso !== null && countries.includes(prompt.country_iso))),
      )
      .map((prompt) => {
        const topicNames = topicTermsOf(prompt).map((term) => term.name);
        return {
          prompt,
          summary: summaryById.get(prompt.prompt_id),
          countsLoaded,
          topics: topicNames.length === 0 ? null : formatList(topicNames, locale),
          country: prompt.country_iso === null ? null : (countryName.get(prompt.country_iso) ?? prompt.country_iso),
        };
      });
  }, [list.rows, includeBranded, topicIds, kept, values.country, summaryById, countsLoaded, countryName, locale]);

  // The strip reads the prompts in scope (a search is no filter, so it does not narrow it, ADR-DS-022 decision 6)
  const stripPrompts = useMemo(
    (): StripPrompt[] =>
      rows.map((row) => ({
        topic_term_ids: row.summary?.topic_term_ids ?? topicTermsOf(row.prompt).map((term) => term.term_id),
        engines: row.summary?.engines ?? [],
      })),
    [rows],
  );
  // Without the topic trees (still being read, or failed) a topic cannot be rolled up, so the count would fall short
  const stripTopics = useMemo(
    () =>
      summary.data === undefined || topicsUnknown
        ? null
        : topicsSpanned(summary.data.data.topics, stripPrompts, descendants, topicIds.length > 0 ? kept : null),
    [summary.data, topicsUnknown, stripPrompts, descendants, topicIds, kept],
  );

  const { columns, sortFields, searchText, rowName } = usePromptColumns(shown);
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, sortFields);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort, sortFields]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['prompt']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  // The inspector: a prompt opened from either tab, stepping in the order of the table on screen
  const inspector = useInspector();
  const openPrompt = inspector.target?.type === 'prompt' ? inspector.target.id : null;
  // An answer opens from a prompt's answers and takes the inspector's place until it goes back to the prompt
  const openAnswer = inspector.target?.type === 'answer' ? inspector.target.id : null;
  // The time of the row the answer was opened from, which the API finds the answer's month by; a link has none
  const [answerRow, setAnswerRow] = useState<{ id: string; observedAt: string; promptId: string | null } | null>(null);
  const answerHint = answerRow?.id === openAnswer ? answerRow.observedAt : undefined;
  // The viewer reads the same answer: the prompt it belongs to stays marked in the tables while it is open
  const answerRead = useQuery({
    ...observationQuery(scope, openAnswer ?? '', answerHint),
    enabled: openAnswer !== null,
  });
  const selectedPrompt =
    openPrompt ??
    (openAnswer === null
      ? null
      : (answerRead.data?.data.subject.prompt_id ?? (answerRow?.id === openAnswer ? answerRow.promptId : null)));
  // The topic drawer, and the topic a prompt was opened from the drawer of: its prompts are the list J and K step
  // through and its badge leads back to the tab it left (ADR-DS-022 decision 8). A link has none, like any list it lacks
  const openTopic = inspector.target?.type === 'topic' ? inspector.target.id : null;
  const topicTab = parseTopicTab(inspector.tab);
  const [promptFrom, setPromptFrom] = useState<TopicOrigin | null>(null);
  const firstShown = shown[0]?.engine.engine_code;
  const originKey = promptFrom?.key ?? null;
  const originOrder = useMemo(
    () =>
      originKey === null
        ? null
        : (topicPrompts(summary.data?.data, originKey, descendants, firstShown)?.map((prompt) => prompt.prompt_id) ??
          null),
    [originKey, summary.data, descendants, firstShown],
  );
  // Only while the open prompt is still the one it was opened for or one the topic holds, in this project: a prompt
  // that arrives another way (Forward, an answer's Back) has no topic, so no badge and the table's own order
  const origin = topicOriginOf(promptFrom, { promptId: openPrompt, projectId: project.id, order: originOrder });
  const fromTopic = origin?.key ?? null;
  const topicOrder = origin === null ? null : originOrder;
  const topicName = (key: string): string | null =>
    key === NO_TOPIC
      ? t('columns.noTopic')
      : (topicSummaryRow(summary.data?.data, key)?.name ?? topicTree.find((term) => term.termId === key)?.name ?? null);
  const [order, setOrder] = useState<readonly string[]>([]);
  const stepOrder = topicOrder ?? order;
  const at = inspector.position(stepOrder);
  const step = (direction: 'next' | 'previous'): void => {
    if (at === null || (direction === 'next' ? at.index === at.count - 1 : at.index === 0)) return;
    inspector.step(direction, stepOrder);
  };
  /** A new browser tab on `?inspect=<target>`, without the tab of another drawer. */
  const openInNewTab = (target: { type: 'prompt' | 'topic'; id: string }, tab?: TopicTab): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('inspect', formatInspectTarget(target));
    if (tab === undefined || tab === DEFAULT_INSPECTOR_TAB) url.searchParams.delete('itab');
    else url.searchParams.set('itab', tab);
    window.open(url, '_blank', 'noopener');
  };
  /**
   * A prompt opened from a row: of the Prompts tab (flat, no `topicKey`) or under a topic of the Topics tab, whose
   * prompts are then the list J and K step through, as when it is opened from the drawer (decision 8).
   */
  const openPromptRow = (promptId: string, intent: 'inspector' | 'new-tab' = 'inspector', topicKey?: string): void => {
    if (intent === 'new-tab') {
      openInNewTab({ type: 'prompt', id: promptId });
      return;
    }
    setPromptFrom(
      topicKey === undefined ? null : { key: topicKey, tab: DEFAULT_INSPECTOR_TAB, promptId, projectId: project.id },
    );
    // A prompt has no tabs: the tab of a topic drawer that was open is not carried over
    if (promptId !== openPrompt) inspector.open({ type: 'prompt', id: promptId }, { tab: DEFAULT_INSPECTOR_TAB });
  };
  const openPromptFromTopic = (promptId: string): void => {
    if (openTopic === null) return;
    setPromptFrom({ key: openTopic, tab: topicTab, promptId, projectId: project.id });
    inspector.open({ type: 'prompt', id: promptId }, { tab: DEFAULT_INSPECTOR_TAB });
  };
  const openTopicDrawer = (key: string, tab: TopicTab, intent: 'inspector' | 'new-tab' = 'inspector'): void => {
    if (intent === 'new-tab') openInNewTab({ type: 'topic', id: key }, tab);
    else inspector.open({ type: 'topic', id: key }, { tab });
  };

  // The summary is pending only before its first answer: a new window keeps the last counts meanwhile
  // A topic or country that matches nothing so far may still match a page that is on its way
  const waiting =
    list.loading ||
    engines.isPending ||
    (enabled.length > 0 && summary.isPending) ||
    (narrowed && rows.length === 0 && list.fetching) ||
    // The topics below a chosen one are not known until the trees are read
    (topicIds.length > 0 && vocabularies.pending);
  const status = ((): TableStatus => {
    if (list.error !== null && list.rows.length === 0) return 'error';
    if (waiting) return 'loading';
    // Without a search, a topic or a country, nothing to show means no prompts (an all branded project too), not no match
    if (rows.length === 0) return view.q === '' && !narrowed ? 'empty' : 'filtered-empty';
    // Later pages of the list may still be on their way
    return summary.isFetching || list.fetching ? 'refetching' : 'ready';
  })();
  const listIncomplete = list.error !== null && list.rows.length > 0;
  // Counts of the last window are not the answer to "has any prompt an answer" for this one
  const noAnswers =
    summary.data !== undefined && !summary.isPlaceholderData && rows.length > 0 && !hasAnswers(summary.data.data);

  const summaryErrorId = useErrorId(summary.error);
  const summaryFailed = summary.isError && summary.data === undefined;
  // A topic of the link that neither a tree nor a prompt read so far holds may still be on a page on its way
  const topicUnresolved = topicIds.some((id) => !topicTerms.has(id) && !topicTree.some((term) => term.termId === id));
  const topicsStatus = ((): TableStatus => {
    // Without the prompts the topics could not be opened, which is as good as not having loaded
    if (summaryFailed || (list.error !== null && list.rows.length === 0)) return 'error';
    const waitingForTopic = topicIds.length > 0 && (vocabularies.pending || (topicUnresolved && list.fetching));
    if (list.loading || engines.isPending || (enabled.length > 0 && summary.isPending) || waitingForTopic) {
      return 'loading';
    }
    return summary.isFetching || list.fetching ? 'refetching' : 'ready';
  })();

  // Not before the engines are known: the dialog takes the enabled ones
  const addButton =
    canWrite && engines.data !== undefined ? (
      <Button variant="primary" size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
        {t('addPrompts')}
      </Button>
    ) : null;

  const listError = (
    <InlineError
      title={t('loadFailed')}
      reason={t('loadFailedReason')}
      errorId={listErrorId}
      onRetry={list.refetch}
      retrying={list.fetching}
      retryLabel={common('retry')}
      live
    />
  );
  const summaryError = (
    <InlineError
      title={t('summaryLoadFailed')}
      reason={t('loadFailedReason')}
      errorId={summaryErrorId}
      onRetry={() => void summary.refetch()}
      retrying={summary.isFetching}
      retryLabel={common('retry')}
      live
    />
  );
  const filteredEmpty = (
    <EmptyState
      title={t('emptyFiltered')}
      reason={t('emptyFilteredReason')}
      headingLevel={2}
      details={filtered ? <ReadOnlyFilterChips fields={fields} values={values} /> : undefined}
      primaryAction={
        filtered ? (
          <Button variant="secondary" onClick={clearFilters}>
            {t('clearFilters')}
          </Button>
        ) : undefined
      }
    />
  );
  const noPrompts = (
    <EmptyState
      icon={MessageSquare}
      title={t('noPromptsTitle')}
      reason={t('noPromptsReason')}
      headingLevel={2}
      primaryAction={addButton ?? undefined}
    />
  );

  let content: ReactNode;
  // The filters belong to the table: the other states have nothing to filter
  let toolbar: ReactNode;
  // A failed read in the background leaves the page as it is
  if (engines.isError && engines.data === undefined) {
    content = (
      <InlineError
        title={t('enginesFailed')}
        reason={t('loadFailedReason')}
        errorId={enginesErrorId}
        onRetry={() => void engines.refetch()}
        retrying={engines.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (engines.data !== undefined && enabled.length === 0) {
    content = (
      <EmptyState
        icon={Power}
        title={t('noEngineTitle')}
        reason={t('noEngineReason')}
        headingLevel={2}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
            {t('toEngines')}
          </TextLink>
        }
      />
    );
  } else if (engines.data !== undefined && !list.loading && list.error === null && list.rows.length === 0) {
    content = noPrompts;
  } else {
    toolbar = <FilterBar fields={fields} values={values} onChange={setValues} />;
    // Not under the empty states, nor before the engines are known (the cards are the engines)
    const stripStatus = waiting ? 'loading' : summary.isFetching || list.fetching ? 'refetching' : 'ready';
    content = (
      <>
        {engines.data !== undefined && (waiting || rows.length > 0) ? (
          <PromptsStrip
            prompts={stripPrompts}
            engines={shown}
            topics={stripTopics}
            status={stripStatus}
            countsFailed={summaryFailed}
          />
        ) : null}
        {noAnswers ? <Banner tone="info" placement="region" message={t('noAnswers')} /> : null}
        {listIncomplete ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('listPartial')}
            actions={
              <Button variant="secondary" size="sm" onClick={list.refetch} loading={list.fetching}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        <Tabs
          variant="underline"
          label={t('tabs.label')}
          value={tab}
          // A tab is a place to go back to: it is the one change of the view that makes a history entry
          onValueChange={(next: PromptsTab) =>
            void setView({ tab: next === 'topics' ? null : next }, { history: 'push' })
          }
          items={PROMPTS_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsPanel value="topics" className="flex min-h-0 flex-1 flex-col pt-3">
            {summary.isError && summary.data !== undefined ? (
              <Banner
                tone="warning"
                placement="region"
                live
                message={t('topics.refreshFailed')}
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void summary.refetch()}
                    loading={summary.isFetching}
                  >
                    {common('retry')}
                  </Button>
                }
              />
            ) : null}
            <TopicsTable
              summary={summary.data?.data}
              engines={shown}
              descendants={descendants}
              kept={kept}
              filtering={topicIds.length > 0}
              status={topicsStatus}
              errorState={summaryFailed ? summaryError : listError}
              emptyState={noPrompts}
              filteredEmptyState={filteredEmpty}
              search={view.q}
              onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
              density={density}
              onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
              activePromptId={selectedPrompt}
              activeTopicKey={openTopic ?? fromTopic}
              onOpenPrompt={openPromptRow}
              onOpenTopic={openTopicDrawer}
              onPromptOrderChange={setOrder}
            />
          </TabsPanel>
          <TabsPanel value="prompts" className="flex min-h-0 flex-1 flex-col pt-3">
            {summary.isError ? (
              <Banner
                tone="warning"
                placement="region"
                live
                message={t('summaryFailed')}
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void summary.refetch()}
                    loading={summary.isFetching}
                  >
                    {common('retry')}
                  </Button>
                }
              />
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col">
              <DataTable<PromptRow>
                caption={t('caption')}
                itemNoun={{ one: t('noun.one'), other: t('noun.other') }}
                columns={columns}
                getRowId={promptRowId}
                rows={rows}
                total={rows.length}
                sort={sort}
                onSortChange={(next) => void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) })}
                defaultSort={DEFAULT_SORT}
                density={density}
                onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
                columnState={{
                  visible,
                  onChange: (next) => void setView({ cols: next === null ? null : formatColumns(next) }),
                }}
                search={view.q}
                onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
                searchPlaceholder={t('search')}
                searchText={searchText}
                rowName={rowName}
                status={status}
                errorState={listError}
                emptyState={noPrompts}
                filteredEmptyState={filteredEmpty}
                onRowOpen={(row, intent) => openPromptRow(row.prompt.prompt_id, intent)}
                activeRowId={selectedPrompt}
                onRowOrderChange={setOrder}
              />
            </div>
          </TabsPanel>
        </Tabs>
      </>
    );
  }

  const counts: PromptCounts = {
    // The counts wait for the engines (the summary is not asked before them), and a new window keeps the last
    // counts on screen: they are not this window's until it has read
    status: summaryFailed
      ? 'failed'
      : engines.isPending || (enabled.length > 0 && (summary.isPending || summary.isPlaceholderData))
        ? 'loading'
        : 'ready',
    brandedIncluded: includeBranded,
    row: openPrompt === null ? undefined : summaryById.get(openPrompt),
    errorId: summaryErrorId,
    retry: () => void summary.refetch(),
    retrying: summary.isFetching,
  };
  const promptInspector =
    openPrompt === null ? null : (
      <PromptInspector
        // Another project's prompt is another inspector. Stepping to another prompt of the project keeps this one,
        // and with it the focus on Next or Previous
        key={project.id}
        scope={scope}
        promptId={openPrompt}
        timeZone={project.timeZone}
        range={range}
        engines={enabled}
        allEngines={engines.data?.data ?? []}
        counts={counts}
        positionText={
          at === null
            ? null
            : t('inspector.position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) })
        }
        navigation={
          at === null
            ? null
            : {
                onPrevious: () => step('previous'),
                onNext: () => step('next'),
                atFirst: at.index === 0,
                atLast: at.index === at.count - 1,
              }
        }
        onStep={at === null ? undefined : step}
        topic={
          origin === null || topicName(origin.key) === null
            ? null
            : {
                name: topicName(origin.key) ?? '',
                onOpen: () => inspector.open({ type: 'topic', id: origin.key }, { tab: origin.tab }),
              }
        }
        onClose={() => inspector.close()}
        onOpenAnswer={(observationId, observedAt) => {
          setAnswerRow({ id: observationId, observedAt, promptId: openPrompt });
          inspector.open({ type: 'answer', id: observationId });
        }}
      />
    );
  const answerInspector =
    openAnswer === null ? null : (
      <AnswerInspector
        // Another answer, or another project's, is another inspector
        key={`${project.id}:${openAnswer}`}
        scope={scope}
        observationId={openAnswer}
        observedAt={answerHint}
        timeZone={project.timeZone}
        engines={engines.data?.data ?? []}
        onBack={(promptId) => inspector.open({ type: 'prompt', id: promptId })}
        onClose={() => inspector.close()}
      />
    );

  const topicInspector =
    openTopic === null ? null : (
      <TopicInspector
        // Another project's topic is another inspector
        key={project.id}
        topicKey={openTopic}
        summary={summary.data?.data}
        counts={counts}
        engines={shown}
        descendants={descendants}
        treeName={topicTree.find((term) => term.termId === openTopic)?.name ?? null}
        treePending={vocabularies.pending}
        tab={topicTab}
        onTabChange={inspector.setTab}
        onOpenPrompt={openPromptFromTopic}
        onClose={() => inspector.close()}
      />
    );

  return (
    <InspectorLayout inspector={promptInspector ?? answerInspector ?? topicInspector}>
      <TopBarPortal>
        <div className="w-44">
          <Select<string>
            aria-label={t('window')}
            value={String(windowDays)}
            onValueChange={(next) => void setView({ window: next === String(DEFAULT_WINDOW) ? null : next })}
            placeholder={t('window')}
            options={WINDOW_DAYS.map((days) => ({ value: String(days), label: t('windowOption', { days }) }))}
          />
        </div>
      </TopBarPortal>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <PageHeader
          title={t('title')}
          meta={t('meta', {
            from: formatBusinessDate(range.from, { withYear: false }),
            to: formatBusinessDate(range.to),
          })}
          toolbar={toolbar}
          actions={list.rows.length > 0 ? addButton : undefined}
        />
        {content}
      </div>
      {canWrite ? (
        <AddPromptsDialog
          scope={scope}
          open={addOpen}
          onOpenChange={setAddOpen}
          engines={enabled}
          existing={list.rows}
          defaults={{ languageCode: project.defaultLanguage, countryIso: project.defaultCountryIso }}
        />
      ) : null}
    </InspectorLayout>
  );
}
