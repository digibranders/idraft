'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Ban,
  Download,
  Link2,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  PanelRight,
  Play,
  Plus,
  Power,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { AddPromptsDialog } from './add-prompts-dialog';
import { AnswerInspector } from './answer-inspector';
import {
  ComparedWindowProvider,
  CompareSelect,
  comparedRowCount,
  DetectableEmpty,
  detectableField,
  isDetectableOnly,
  keepPromptRows,
  narrowSummary,
  useCompare,
} from './compare';
import { asRecordActions, type PromptAction } from './prompt-action';
import { usePromptColumns, type PromptRow } from './prompt-columns';
import { PromptInspector, type PromptCounts } from './prompt-inspector';
import {
  collectTopicTerms,
  countryChoices,
  DEFAULT_PROMPT_SORT,
  hasAnswers,
  lastObservedAt,
  matchesTopics,
  NO_TOPIC,
  parseCountry,
  parseMetric,
  parseTab,
  PROMPTS_TABS,
  RATE_METRICS,
  topicChoices,
  topicDescendants,
  topicPrompts,
  topicOriginOf,
  topicsBelow,
  topicsSpanned,
  topicSummaryRow,
  topicTermsOf,
  type DateRange,
  type PromptsTab,
  type RateMetric,
  type TopicOrigin,
  type TopicTab,
} from './prompt-model';
import { enginesQuery, observationQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';
import { PromptsCountryControl } from './prompts-scope';
import { PromptsStrip } from './prompts-strip';
import { PROMPT_ACTION_ENTRIES, withActionEntries } from './seams/actions';
import { PROMPTS_TOOLBAR_ENTRIES, promptsToolbarItems } from './seams/toolbar';
import { usePromptActions } from './use-prompt-actions';
import { TopicInspector } from './topic-inspector';
import { selectionKeyOf } from './selection-model';
import { DRAWER_ENTRY_KEYS } from './topics-by-engine/drill';
import { TopicsView } from './topics-by-engine/topics-view';
import type { TopicMenuTarget } from './topics-table';
import { DateRangePicker } from '@/components/app/date-range/date-range-picker';
import { droppedMessageKey } from '@/components/app/date-range/range-model';
import { useDateRangeParams } from '@/components/app/date-range/use-date-range-params';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import type { FocusHandle } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import type { SummaryEntity } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { comparedWindow, isCompared } from '@/lib/compare/compare-model';
import { copyText } from '@/lib/dom/clipboard';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { formatBusinessDate, formatInteger, formatList, formatRelative } from '@/lib/format';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { useCountries } from '@/lib/locations/countries';
import { useCan, useMembership } from '@/lib/permissions';
import type { StripPrompt } from '@/lib/rates/strip-model';
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
 * The URL's keys besides the filters': the tab (Topics has none), the country of the top bar and the tables'
 * state. They all stay when the tab changes, and so do the date range's own keys (`useDateRangeParams`). Each table
 * reads the sort ids it has and ignores the others (`SORT_ID` in prompt-model.ts); the columns and the metric of
 * the engine columns are the Prompts table's.
 */
const VIEW_STATE = {
  tab: parseAsString,
  country: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
  metric: parseAsString,
};

/** The weekly series, asked of the summary for the Trend column. Module level, so the query's key stays the same. */
const SERIES: readonly ['series'] = ['series'];
const NO_ENTITIES: readonly SummaryEntity[] = [];

const promptRowId = (row: PromptRow): string => row.prompt.prompt_id;
const NO_PROMPTS: ReadonlySet<string> = new Set();
const nothing = (): void => undefined;
/** The id of the More actions item that copies the link. */
const COPY_LINK = 'copy-link';

/**
 * AI > Topics & Prompts (spec 2026-11-11 section 4.6, ADR-DS-022): the project's prompts over a window of
 * days (28 by default) and a country, both in the top bar as project-wide scope, with Mentioned and Cited per
 * enabled engine. The country narrows both tabs and the counts. The filter bar narrows by topic and engine;
 * branded prompts are left out of the table and the
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
  const root = useTranslations();
  const common = useTranslations('common');
  const locale = useLocale();
  const canWrite = useCan('prompts:write');
  const { permissions } = useMembership();
  const [addOpen, setAddOpen] = useState(false);
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const tab = parseTab(view.tab);
  // The market of the top bar: every country unless the address names one
  const country = parseCountry(view.country);
  // The period before: on unless the address says `cmp=off` (D-03). Scope like the country, so Clear filters leaves it
  const { compare, setCompare } = useCompare();
  // The range of every query of the page, from the picker's keys (`win`, `from`, `to`; `window` of older links).
  // `today` is a day of the project's zone, the one place the clock is read; it turns at that zone's midnight
  const today = useZoneDay(project.timeZone);
  const picked = useDateRangeParams({ today, legacyWindowKey: 'window' });
  const range = useMemo((): DateRange => ({ from: picked.range.from, to: picked.range.to }), [picked.range]);

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
  const topicPaths = useMemo(() => new Map(topicTree.map((term) => [term.termId, term.path])), [topicTree]);
  const topicsUnknown = vocabularies.pending || vocabularies.error;
  const fields = useMemo((): FilterField[] => {
    const choices = topicChoices(topicTree, topicTerms);
    // Two topics of one name under different parents are told apart by their paths
    const nameCounts = new Map<string, number>();
    for (const choice of choices) nameCounts.set(choice.name, (nameCounts.get(choice.name) ?? 0) + 1);
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
      detectableField({ field: t('compare.detectable.field'), option: t('compare.detectable.option') }),
    ];
  }, [t, optionsPending, topicsUnknown, topicTree, topicTerms, enabled, engines.data]);
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
  // The country is scope, not a filter: the bar's chips and Clear filters leave it, an empty state names it and leaves it
  // together with the filters
  const nameOfCountry = useCallback((iso: string): string => countryName.get(iso) ?? iso, [countryName]);
  const filtered = Object.keys(values).length > 0;
  const countryIsos = useMemo(() => countryChoices(list.rows, country), [list.rows, country]);
  const emptyFields = useMemo(
    (): FilterField[] => [
      ...fields,
      {
        id: 'country',
        kind: 'enum',
        label: t('filters.country'),
        multi: false,
        options: countryIsos.map((iso) => ({ value: iso, label: nameOfCountry(iso) })),
      },
    ],
    [fields, t, countryIsos, nameOfCountry],
  );
  const emptyValues = useMemo(
    (): FilterValues => (country === null ? values : { ...values, country: { kind: 'enum', values: [country] } }),
    [values, country],
  );
  // The topic, country and Detectable changes only narrow the rows; the engine only picks columns, and Branded adds rows
  const detectableOnly = isDetectableOnly(values);
  const narrowed = values.topic !== undefined || country !== null || detectableOnly;
  const clearFilters = useCallback(() => {
    setValues({});
    void setView({ country: null });
  }, [setValues, setView]);
  const includeBranded = enumValuesOf(values.branded).includes('include');
  // Only the engines the Engine filter names, else every engine that is on
  const shown = useMemo(() => {
    const chosen = enumValuesOf(values.engine);
    return chosen.length === 0 ? enabled : enabled.filter((engine) => chosen.includes(engine.engine.engine_code));
  }, [enabled, values.engine]);

  // The table stays on the last counts while a new window, or the Branded filter, is read. The weekly series of the
  // Trend column comes with them in the one read, which the strip and the drawers use too: a failed series cannot
  // be told from a failed summary, and a summary without series (an older API) leaves the Trend cells blank
  const summary = useQuery({
    ...summaryQuery(scope, range, includeBranded, {
      ...(country === null ? {} : { country }),
      include: SERIES,
      compare,
    }),
    enabled: enabled.length > 0,
    placeholderData: keepPreviousData,
  });
  const summaryData = summary.data?.data;
  const codes = useMemo(() => shown.map((engine) => engine.engine.engine_code), [shown]);
  // Counts held from a read made without the comparison carry no `previous`: while the new read is on its way the chip
  // waits for it, so it does not empty the table for a moment. A read that failed has no counts to judge by either:
  // the rows stay and the banner says so, rather than the chip claiming there is nothing to compare
  const detectableHeld = detectableOnly && compare && !isCompared(summaryData) && summary.isFetching;
  const readFailed = summary.isError && summaryData === undefined;
  const detectableIds = useMemo(
    (): ReadonlySet<string> | null =>
      detectableOnly && !detectableHeld && !readFailed
        ? new Set(keepPromptRows(summaryData?.prompts ?? [], codes, compare).map((row) => row.prompt_id))
        : null,
    [detectableOnly, detectableHeld, readFailed, summaryData, codes, compare],
  );
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
    return list.rows
      .filter(
        (prompt) =>
          (includeBranded || !prompt.is_branded) &&
          (topicIds.length === 0 || matchesTopics(prompt, kept)) &&
          (country === null || prompt.country_iso === country) &&
          (detectableIds === null || detectableIds.has(prompt.prompt_id)),
      )
      .map((prompt) => {
        // Where a topic sits comes from the tree; until it is read the name is all there is
        const topicList = topicTermsOf(prompt).map((term) => ({
          name: term.name,
          path: topicPaths.get(term.term_id) ?? term.name,
        }));
        return {
          prompt,
          summary: summaryById.get(prompt.prompt_id),
          countsLoaded,
          topics:
            topicList.length === 0
              ? null
              : formatList(
                  topicList.map((topic) => topic.name),
                  locale,
                ),
          topicList,
          country: prompt.country_iso === null ? null : (countryName.get(prompt.country_iso) ?? prompt.country_iso),
        };
      });
  }, [
    list.rows,
    includeBranded,
    topicIds,
    kept,
    country,
    detectableIds,
    summaryById,
    countsLoaded,
    countryName,
    topicPaths,
    locale,
  ]);
  // The Topics views read the topic rows that changed by more than normal variation; the prompt rows stay whole
  const topicsSummary = useMemo(
    () =>
      summaryData === undefined || detectableIds === null ? summaryData : narrowSummary(summaryData, codes, compare),
    [summaryData, detectableIds, codes, compare],
  );

  // The prompts chosen, by id: kept through sorting, searching and opening topics, and dropped for good when the rows
  // asked for change (the project, the tab, the topic filter, the country, the Branded filter), as Rankings drops its
  // choice when its filters change. Prompts that left the rows (archived, or off a new page) are not chosen any more
  const selectionKey = selectionKeyOf({ projectId: project.id, tab, country, topicIds, includeBranded });
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: selectionKey,
    ids: NO_PROMPTS,
  });
  if (selection.key !== selectionKey) setSelection({ key: selectionKey, ids: NO_PROMPTS });
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.prompt.prompt_id, row])), [rows]);
  const chosen = useMemo(
    (): ReadonlySet<string> =>
      selection.key === selectionKey ? new Set([...selection.ids].filter((id) => rowsById.has(id))) : NO_PROMPTS,
    [selection, selectionKey, rowsById],
  );
  const setChosen = useCallback(
    (ids: ReadonlySet<string>): void => setSelection({ key: selectionKey, ids }),
    [selectionKey],
  );
  const actions = usePromptActions({
    scope,
    rowsById,
    engines: enabled,
    shown,
    range,
    // Only the prompts an action changed leave the choice: the rest of it stays, a row's own action included
    onDone: (done) =>
      setSelection((current) => {
        if (current.key !== selectionKey) return current;
        const changed = new Set(done);
        return { key: current.key, ids: new Set([...current.ids].filter((id) => !changed.has(id))) };
      }),
  });
  // In the order of the list, as the table shows them
  const bulkActions: readonly PromptAction[] = actions.bar(
    [...rowsById.keys()].filter((promptId) => chosen.has(promptId)),
  );

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

  const metric = parseMetric(view.metric);
  const { columns, sortFields, searchText, rowName } = usePromptColumns(shown, metric, comparedWindow(summaryData));
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, sortFields);
    return parsed.length === 0 ? DEFAULT_PROMPT_SORT : parsed;
  }, [view.sort, sortFields]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['prompt']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  // The inspector: a prompt opened from either tab, stepping in the order of the table on screen
  // The topic drawer's engine filter (`?eng=`) belongs to its entry: Close after a drill-down goes back and drops it
  const inspector = useInspector({ entryKeys: DRAWER_ENTRY_KEYS });
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
  const topicTab = inspector.tab;
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

  // Add prompts, from the header (no topic) or from a topic's menu (that topic chosen). The form is made once, so a
  // new topic is a new dialog
  const [addTopic, setAddTopic] = useState<string | null>(null);
  const openAdd = (termId: string | null): void => {
    setAddTopic(termId);
    setAddOpen(true);
  };
  /** The Prompts tab with this topic as its topic filter, the other filters, the window and the country kept. */
  const showInPrompts = (key: string): void => {
    void setValues({ ...values, topic: { kind: 'enum', values: [key] } });
    void setView({ tab: 'prompts' }, { history: 'push' });
  };
  const canRun = useCan('runs:trigger');
  // A topic's prompts come from the summary, and an action reads them from the list: until the list is whole (or when
  // it failed) some of them are not in it, so the actions that read them wait
  const listReason = optionsPending ? t('bulk.listLoading') : null;
  /** The "More" menu of a row of the Topics tab: a topic's, or the prompt listed under a topic's. */
  const topicMenu = (target: TopicMenuTarget): readonly PromptAction[] => {
    if (target.kind === 'prompt') {
      return actions.forPrompt(target.promptId, () => openPromptRow(target.promptId, 'inspector', target.topicKey));
    }
    // The prompts without a topic are no topic to filter by or to add a prompt to
    const real = target.key !== NO_TOPIC;
    const held = target.promptIds.length > 0;
    const builtIns: PromptAction[] = [
      {
        id: 'open',
        label: t('rowMenu.open'),
        icon: PanelRight,
        group: 'open',
        run: () => openTopicDrawer(target.key, 'overview'),
      },
      ...(real
        ? [
            {
              id: 'show-in-prompts',
              label: t('rowMenu.showInPrompts'),
              icon: MessageSquare,
              group: 'open' as const,
              run: () => showInPrompts(target.key),
            },
          ]
        : []),
      ...(canRun && held
        ? [
            {
              id: 'run-now',
              label: t('bulk.run'),
              icon: Play,
              group: 'object' as const,
              disabledReason: actions.busyReason ?? listReason,
              run: () => actions.run(target.promptIds),
            },
          ]
        : []),
      ...(canWrite && real && engines.data !== undefined
        ? [
            {
              id: 'add-prompt',
              label: t('rowMenu.addPrompt'),
              icon: Plus,
              group: 'object' as const,
              run: () => openAdd(target.key),
            },
          ]
        : []),
      ...(held
        ? [
            {
              id: 'export',
              label: t('bulk.export'),
              icon: Download,
              group: 'copy' as const,
              disabledReason: listReason,
              run: () => actions.exportPrompts(target.promptIds),
            },
          ]
        : []),
    ];
    return withActionEntries(
      builtIns,
      PROMPT_ACTION_ENTRIES,
      {
        surface: 'topicRow',
        scope,
        promptIds: target.promptIds,
        prompts: target.promptIds.flatMap((id) => rowsById.get(id)?.prompt ?? []),
        topicKey: target.key,
        busyReason: actions.busyReason,
        t: root,
      },
      permissions,
    );
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
      <Button variant="primary" size="sm" icon={Plus} onClick={() => openAdd(null)}>
        {t('addPrompts')}
      </Button>
    ) : null;
  // In the header row the label gives way to the icon below 640 px, and stays the button's name
  const headerAdd =
    addButton === null ? null : (
      <Button variant="primary" size="sm" icon={Plus} onClick={() => openAdd(null)}>
        <span className="sr-only sm:not-sr-only">{t('addPrompts')}</span>
      </Button>
    );

  // The views of the page, in the toolbar of whichever table is shown, so the table is drawn again when the view
  // changes and the switch with it: the focus is put back on it when the change was made from it
  const keepSwitchFocus = useRef(false);
  const focusSwitch = useCallback((handle: FocusHandle | null): void => {
    if (handle === null || !keepSwitchFocus.current) return;
    keepSwitchFocus.current = false;
    // After the commit: the radio group registers its segments in an effect, and arrow keys need them
    queueMicrotask(() => handle.focus());
  }, []);
  const viewSwitch = (
    <SegmentedControl<PromptsTab>
      semantics="view"
      label={t('tabs.label')}
      value={tab}
      onValueChange={(next) => {
        keepSwitchFocus.current = (document.activeElement?.closest('[data-slot="segmented-control"]') ?? null) !== null;
        // A view is a place to go back to: it is the one change of the page that makes a history entry
        void setView({ tab: next === 'topics' ? null : next }, { history: 'push' });
      }}
      size="sm"
      focusRef={focusSwitch}
      items={PROMPTS_TABS.map((value) => ({
        value,
        label: t(`tabs.${value}`),
        icon: value === 'topics' ? ListTree : MessageSquare,
      }))}
    />
  );

  // When the newest answer of the summary was read, and the window's dates: the toolbar shows the first from 1280 px
  // (its container's width) and a tooltip carries the second, a narrower toolbar has both in the More actions menu
  const updatedAt = lastObservedAt(summary.data?.data);
  const updatedText = updatedAt === null ? null : t('updated', { time: formatRelative(updatedAt, project.timeZone) });
  const windowCaption = t('meta', {
    from: formatBusinessDate(range.from, { withYear: false }),
    to: formatBusinessDate(range.to),
  });
  // A link whose range was not used says why, for as long as the address keeps it (13 section 5)
  const { dropped } = picked;
  const droppedWords =
    dropped === null
      ? null
      : common(`dateRange.${droppedMessageKey(dropped)}`, {
          max: dropped.code === 'too_long' ? dropped.max : 0,
          date: dropped.code === 'before_start' ? formatBusinessDate(dropped.earliest) : '',
        });
  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  // What later packages add to the header: items of the More actions menu, and controls before it
  const extras = promptsToolbarItems(PROMPTS_TOOLBAR_ENTRIES, { scope, project, t: root }, permissions);
  const extraControls = extras.actions.map(({ id, node }) => <Fragment key={id}>{node}</Fragment>);
  const moreMenu = (
    <Menu
      align="end"
      trigger={<IconButton icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
      header={
        <div className="flex flex-col gap-0.5 type-meta">
          {updatedText === null ? null : <span>{updatedText}</span>}
          <span>{windowCaption}</span>
        </div>
      }
      items={[{ id: COPY_LINK, label: t('copyLink'), icon: Link2, onSelect: copyLink }, ...extras.more]}
    />
  );

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
  const filteredEmpty =
    // A search that finds nothing is the generic state; otherwise the chip says why no row is left
    detectableOnly && view.q === '' ? (
      <DetectableEmpty
        compare={compare}
        compared={comparedRowCount(summaryData, tab, topicIds.length > 0 ? kept : null, codes)}
        previousAnswers={summaryData?.previous_answers ?? null}
        details={<ReadOnlyFilterChips fields={emptyFields} values={emptyValues} />}
        onTurnOn={() => setCompare(true)}
        onClear={clearFilters}
      />
    ) : (
      <EmptyState
        title={t('emptyFiltered')}
        reason={t('emptyFilteredReason')}
        headingLevel={2}
        details={
          filtered || country !== null ? <ReadOnlyFilterChips fields={emptyFields} values={emptyValues} /> : undefined
        }
        primaryAction={
          filtered || country !== null ? (
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

  const showAdd = list.rows.length > 0 && headerAdd !== null;
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
    // Not under the empty states, nor before the engines are known (the chips are the engines)
    const stripStatus = waiting ? 'loading' : summary.isFetching || list.fetching ? 'refetching' : 'ready';
    // The chips, then the filters: chips of the filters set wrap under them, and a bar without filters is one button
    // On a phone: the chips on one line of their own (they scroll sideways when they do not fit), then the Filter
    // button with the menu and Add prompts at the end of the same row. From 768 px it is one row, wrapping when full
    toolbar = (
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {engines.data !== undefined && (waiting || rows.length > 0) ? (
          <div className="scrollbar-none flex min-h-control w-full items-center overflow-x-auto md:w-auto">
            <PromptsStrip
              prompts={stripPrompts}
              engines={shown}
              topics={stripTopics}
              status={stripStatus}
              countsFailed={summaryFailed}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 basis-24">
          <FilterBar fields={fields} values={values} onChange={setValues} />
        </div>
        <div className="ml-auto flex h-control shrink-0 items-center gap-3">
          <CompareSelect window={comparedWindow(summaryData)} />
          {updatedText === null ? null : (
            // Shown while the header's container is at least 64rem wide (about a 1280 px window with the sidebar open); a narrower one has it in the More actions menu
            <Tooltip content={windowCaption} purpose="label" side="bottom">
              <span className="hidden type-meta whitespace-nowrap @5xl:inline">{updatedText}</span>
            </Tooltip>
          )}
          {extraControls}
          {moreMenu}
          {showAdd ? headerAdd : null}
        </div>
      </div>
    );
    content = (
      <>
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
        {tab === 'topics' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
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
            <TopicsView
              scope={scope}
              range={range}
              includeBranded={includeBranded}
              country={country}
              summary={topicsSummary}
              engines={shown}
              descendants={descendants}
              tree={topicTree}
              kept={kept}
              filtering={topicIds.length > 0}
              // shortcut: the prop means "a scope narrowed the rows that is not a topic filter", so the chip rides on it
              // (an empty table is then filtered-empty, not empty); rename it when a third such narrowing appears
              countryChosen={country !== null || detectableOnly}
              status={topicsStatus}
              errorState={summaryFailed ? summaryError : listError}
              emptyState={noPrompts}
              filteredEmptyState={filteredEmpty}
              sortText={view.sort}
              onSortTextChange={(next) => void setView({ sort: next })}
              search={view.q}
              onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
              density={density}
              onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
              activePromptId={selectedPrompt}
              activeTopicKey={openTopic ?? fromTopic}
              onOpenPrompt={openPromptRow}
              onOpenTopic={openTopicDrawer}
              onPromptOrderChange={setOrder}
              viewSwitch={viewSwitch}
              chosen={chosen}
              onChosenChange={setChosen}
              bulkActions={bulkActions}
              rowMenu={topicMenu}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
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
                onSortChange={(next) =>
                  void setView({ sort: sameSort(next, DEFAULT_PROMPT_SORT) ? null : formatSort(next) })
                }
                defaultSort={DEFAULT_PROMPT_SORT}
                // The metric of the engine columns, then the view switch, as Rankings has its switch before the icons
                toolbarEnd={
                  <>
                    <div className="w-44">
                      <Select<RateMetric>
                        aria-label={t('metric.label')}
                        size="sm"
                        value={metric}
                        onValueChange={(next) => void setView({ metric: next === 'mention' ? null : next })}
                        placeholder={t('metric.placeholder')}
                        options={RATE_METRICS.map((value) => ({ value, label: t(`metric.${value}`) }))}
                      />
                    </div>
                    {viewSwitch}
                  </>
                }
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
                compactToolbar
                selection={{
                  selectedIds: chosen,
                  onChange: setChosen,
                  // The list holds every prompt the filters match, so there is no "all matching" beyond the rows
                  matchingTotal: null,
                  allMatching: false,
                  onAllMatchingChange: nothing,
                }}
                bulkActions={asRecordActions<PromptRow>(bulkActions)}
                rowActions={(row) =>
                  asRecordActions<PromptRow>(
                    actions.forPrompt(row.prompt.prompt_id, () => openPromptRow(row.prompt.prompt_id)),
                  )
                }
              />
            </div>
          </div>
        )}
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
    entities: summary.data?.data.entities ?? NO_ENTITIES,
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
        tab={inspector.tab}
        // Latest is the inspector's first tab, which the address leaves out
        onTabChange={(next) => inspector.setTab(next === 'latest' ? DEFAULT_INSPECTOR_TAB : next)}
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
        extras={{
          scope,
          range,
          includeBranded,
          country,
          workspaceSlug,
          projectSlug: project.slug,
          tree: topicTree,
          countryName: nameOfCountry,
          onAddPrompt: canWrite && engines.data !== undefined ? openAdd : null,
          run: canRun ? { onRun: actions.run, blockedReason: actions.busyReason ?? listReason } : null,
        }}
        tab={topicTab}
        onTabChange={inspector.setTab}
        onOpenPrompt={openPromptFromTopic}
        onClose={() => inspector.close()}
      />
    );

  // With neither Add prompts nor a control of the seam nothing is passed, so no wrapper is drawn
  const addInEmpty = showAdd ? headerAdd : undefined;
  const emptyActions: ReactNode =
    extraControls.length === 0 ? (
      addInEmpty
    ) : (
      <>
        {extraControls}
        {addInEmpty}
      </>
    );

  return (
    <ComparedWindowProvider value={comparedWindow(summaryData)}>
      <InspectorLayout inspector={promptInspector ?? answerInspector ?? topicInspector}>
        <TopBarPortal>
          <DateRangePicker
            value={picked.value}
            onValueChange={picked.onValueChange}
            today={today}
            timeZone={project.timeZone}
          />
          <PromptsCountryControl
            country={country}
            isos={countryIsos}
            nameOf={nameOfCountry}
            onCountryChange={(iso) => void setView({ country: iso })}
          />
        </TopBarPortal>
        <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
          <PageHeader
            title={t('title')}
            titleHidden
            toolbar={toolbar}
            // Without the table (an empty state) only Add prompts is left of the header's right side, and the controls
            // of the toolbar seam before it
            actions={toolbar === undefined ? emptyActions : undefined}
          />
          {droppedWords === null ? null : <Banner tone="info" placement="region" message={droppedWords} />}
          {content}
        </div>
        {actions.dialogs}
        {canWrite ? (
          <AddPromptsDialog
            key={addTopic ?? 'no-topic'}
            scope={scope}
            open={addOpen}
            onOpenChange={setAddOpen}
            engines={enabled}
            existing={list.rows}
            defaults={{
              languageCode: project.defaultLanguage,
              countryIso: project.defaultCountryIso,
              termId: addTopic,
            }}
          />
        ) : null}
      </InspectorLayout>
    </ComparedWindowProvider>
  );
}
