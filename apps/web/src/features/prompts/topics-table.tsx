'use client';

import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { brandsColumn } from './columns/brands-column';
import { positionColumn } from './columns/position-column';
import { recommendationColumn } from './columns/recommendation-column';
import { sentimentColumn } from './columns/sentiment-column';
import { shareOfVoiceColumn } from './columns/sov-column';
import { volumeColumn } from './columns/volume-column';
import { asRecordActions, type PromptAction } from './prompt-action';
import { useEngineColumns } from './prompt-columns';
import { distinctPrompts, groupCoverage, groupsOfSummary, searchGroups, type Group } from './group-model';
import { DEFAULT_TOPIC_SORT, SORT_ID, TOPIC_TAB, type TopicDescendants, type TopicTab } from './prompt-model';
import { useRateColumns } from './rate-columns';
import { applyRowChange, groupsChosen, rowSelection, type RowPrompts } from './selection-model';
import {
  groupVolumeOf,
  promptVolumeOf,
  type FactsRow,
  type GroupVolumeReading,
  type LinkedKeywordVolume,
  type PromptFacts,
  type VolumeReading,
} from './facts';
import type { PromptScope } from './prompt-queries';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import { effectiveSort } from '@/components/app/data-table/sort-fallback';
import type { DataTableColumn, RowTree, TableStatus } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineSummary, ProjectEngine, PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatList } from '@/lib/format';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { sortByKeys } from '@/lib/rates/rate-model';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { formatSort, parseSort, sameSort, type SortKey } from '@/lib/tables/table-state';

/** A group of the table (PR-TOPICS-01): a row that opens onto its prompts, with the numbers of the group. */
export type GroupRow = {
  kind: 'topic';
  id: string;
  /** The term id. */
  key: string;
  name: string;
  promptCount: number;
  engines: readonly EngineSummary[];
  /** The prompts the group holds, most mentioned first; `null` while the trees do not hold it (not read yet). */
  members: readonly PromptSummaryRow[] | null;
  /** The prompts it lists while it is open, after the search. */
  listed: readonly PromptSummaryRow[];
  position: number;
  siblings: number;
};

/** A group, or one of its prompts while the group is open. */
export type TopicRow =
  | GroupRow
  | {
      kind: 'prompt';
      /** Group and prompt: a prompt of two groups is a row under each. */
      id: string;
      /** The group the row is listed under. */
      topicKey: string;
      promptId: string;
      name: string;
      branded: boolean;
      engines: readonly EngineSummary[];
      position: number;
      siblings: number;
    };

const rowId = (row: TopicRow): string => row.id;
const idsOf = (members: readonly PromptSummaryRow[] | null): string[] => (members ?? []).map((m) => m.prompt_id);
const nothing = (): void => undefined;
const cellsOf = (row: TopicRow): readonly EngineSummary[] => row.engines;
/** A group's rate on a platform is the mean of its prompts' rates; a prompt row's is its own. */
const isGroupRow = (row: TopicRow): boolean => row.kind === 'topic';
const NO_ANSWERS: FactsRow = { engines: [] };

export interface TopicsTableProps {
  /** The prompts summary of the window; `undefined` while it loads. */
  summary: PromptsSummary | undefined;
  /** The platforms shown, in order. */
  engines: readonly ProjectEngine[];
  /** Each topic and the topics below it, from the vocabularies' trees: which prompts a group holds. */
  descendants: TopicDescendants;
  /** The terms of the topic vocabularies' trees: which topics are groups (those with no topic below them that has a prompt). */
  tree: readonly NamedTerm[];
  /** With `filtering`, the topics the filter keeps: the chosen ones and those below them. */
  kept: ReadonlySet<string>;
  /** Whether a group filter is set. */
  filtering: boolean;
  /** A country of the top bar narrows the summary, so no group left is a match that found nothing, not no prompts. */
  countryChosen: boolean;
  /** With "Detectable changes only", the term ids of the groups that changed by more than normal variation; else `null`. */
  detectable: ReadonlySet<string> | null;
  /** The facts of every group and prompt row (position, sentiment, brands, volume); `undefined` until the API sends them. */
  facts: PromptFacts | undefined;
  /** The workspace and project of the table, for the Brands list that writes (Add as competitor). */
  project: PromptScope;
  /** The Location column: only while the top bar says All locations. */
  showLocation: boolean;
  /** The location of each prompt by id (its name); `null` for a prompt without one. */
  locations: ReadonlyMap<string, string | null>;
  status: TableStatus;
  errorState: ReactNode;
  /** No group at all, and no search or group filter to blame. */
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
  /** The `sort` of the address (`-id` for descending), or `null`: the table reads the ids it has (`SORT_ID`). */
  sortText: string | null;
  onSortTextChange: (sort: string | null) => void;
  search: string;
  onSearchChange: (search: string) => void;
  /** The prompt open in the inspector; its row is marked. */
  activePromptId: string | null;
  /** The group whose drawer is open, or the one the open prompt was opened from; its row is marked when no prompt row is. */
  activeTopicKey: string | null;
  /** `topicKey` is the group the row is listed under: its prompts are the list the inspector steps through. */
  onOpenPrompt: (promptId: string, intent: 'inspector' | 'new-tab', topicKey: string) => void;
  /** Opens the group's drawer. */
  onOpenTopic: (key: string, tab: TopicTab, intent: 'inspector' | 'new-tab') => void;
  /** The prompts the open groups list, in the order of the rows, each once: what the inspector steps through. */
  onPromptOrderChange: (promptIds: readonly string[]) => void;
  /** The switch between the views of the page, at the end of the toolbar before the columns, as on Rankings. */
  viewSwitch?: ReactNode;
  /** Columns that take the place of the metric columns (the By platform view); the table's own ones when left out. */
  viewColumns?: readonly DataTableColumn<TopicRow>[] | undefined;
  /** The groups in the order the table lists them: what the group drawer steps through. */
  onTopicOrderChange?: ((keys: readonly string[]) => void) | undefined;
  /** The prompts chosen, by prompt id: a group's box chooses the prompts it holds (`selection-model.ts`). */
  chosen: ReadonlySet<string>;
  onChosenChange: (ids: ReadonlySet<string>) => void;
  /** The bulk bar's actions, on the chosen prompts. */
  bulkActions: readonly PromptAction[];
  /** The actions of a row's "More" menu: a group's, or a prompt listed under a group. */
  rowMenu: (target: TopicMenuTarget) => readonly PromptAction[];
}

/** What a row's menu is asked for. */
export type TopicMenuTarget =
  | {
      kind: 'topic';
      /** The term id. */
      key: string;
      name: string;
      /** The prompts the group holds; empty while they cannot be told. */
      promptIds: readonly string[];
    }
  | { kind: 'prompt'; promptId: string; topicKey: string };

/**
 * The Groups tab (PR-TOPICS, owner decision 1 of 2026-11-16): one flat level of groups, each a row with its numbers
 * (the API's prompt weighted cells; the average of the platforms in view) that opens onto the prompts inside it, most
 * mentioned first. A group is a topic with a prompt and none with a prompt below it (`groupsOf`); there are no parent
 * rows. A prompt in two groups is a row under each, so the rows may overlap, and the footnote says so. The columns are
 * those of the Prompts tab that apply to a group (not Intent, Cited links or Screenshot), computed per group; a prompt
 * row shows its own values in the same cells. A click on a group row opens its drawer, its chevron opens its prompts.
 * The search finds a group by its name (all its prompts) or by the text of one of its prompts (those only), and while
 * it finds prompts every group is open. The table sorts the groups itself, since a tree shows its rows as given; the
 * prompts under an open group keep their order, most mentioned first.
 */
export function TopicsTable({
  summary,
  engines,
  descendants,
  tree,
  kept,
  filtering,
  countryChosen,
  detectable,
  facts,
  project,
  showLocation,
  locations,
  status,
  errorState,
  emptyState,
  filteredEmptyState,
  sortText,
  onSortTextChange,
  search,
  onSearchChange,
  activePromptId,
  activeTopicKey,
  onOpenPrompt,
  onOpenTopic,
  onPromptOrderChange,
  viewSwitch,
  viewColumns,
  onTopicOrderChange,
  chosen,
  onChosenChange,
  bulkActions,
  rowMenu,
}: TopicsTableProps): ReactElement {
  const t = useTranslations('prompts');
  const groupsText = useTranslations('prompts.groupsTab');
  const root = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // The prompt row that was clicked, which two groups may both show
  const [clicked, setClicked] = useState<string | null>(null);
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const codes = useMemo(() => engines.map((engine) => engine.engine.engine_code), [engines]);
  const rateColumns = useRateColumns(engines, cellsOf, { byPrompts: isGroupRow });
  const countColumns = useEngineColumns(engines, cellsOf, { sortable: true, defaultVisible: false, marks: true });
  // The latest handler, so the columns (which the table keys its work by) do not change with every render
  const latestOpenTopic = useRef(onOpenTopic);
  useEffect(() => {
    latestOpenTopic.current = onOpenTopic;
  }, [onOpenTopic]);
  const openTopic = useCallback(
    (key: string, tab: TopicTab, intent: 'inspector' | 'new-tab') => latestOpenTopic.current(key, tab, intent),
    [],
  );
  const rowName = useCallback((row: TopicRow): string => row.name, []);
  const columns = useMemo((): DataTableColumn<TopicRow>[] => {
    const shared = { t: root, locale, engines, scope: codes };
    /** The facts of a row: a prompt's own summary row, a group's topic row; a row the read has none for has no answers. */
    const factsOf = (row: TopicRow): FactsRow | undefined => {
      if (facts === undefined) return undefined;
      return (row.kind === 'prompt' ? facts.prompts.get(row.promptId) : facts.topics.get(row.key)) ?? NO_ANSWERS;
    };
    /** The keyword a prompt row is linked to, for the reason of a Google AI Overview without answers. */
    const linkOf = (row: TopicRow): LinkedKeywordVolume | null | undefined =>
      row.kind === 'prompt' ? facts?.prompts.get(row.promptId)?.linked_keyword : undefined;
    const volumeOf = (row: TopicRow): VolumeReading | GroupVolumeReading => {
      if (row.kind === 'prompt') return promptVolumeOf(linkOf(row));
      if (row.members === null) return { state: 'unknown', reason: 'not_collected', keywords: 0, prompts: 0 };
      return groupVolumeOf(
        row.members.map((member) =>
          facts === undefined ? undefined : facts.prompts.get(member.prompt_id)?.linked_keyword,
        ),
      );
    };
    /** The prompt rows a row's lists are over: its own, or the prompts of the group. */
    const factRowsOf = (row: TopicRow): readonly FactsRow[] => {
      if (facts === undefined) return [];
      if (row.kind === 'prompt') {
        const own = facts.prompts.get(row.promptId);
        return own === undefined ? [] : [own];
      }
      return (row.members ?? []).flatMap((member) => facts.prompts.get(member.prompt_id) ?? []);
    };
    const locationOf = (row: TopicRow): readonly string[] => {
      const ids = row.kind === 'prompt' ? [row.promptId] : idsOf(row.members);
      return [...new Set(ids.flatMap((id) => locations.get(id) ?? []))];
    };
    const name = col.keyword<TopicRow>('topic', rowName, {
      header: t('topics.topic'),
      // The preview's 260 px is the least; a name such as "Compliance and regulation" with its count after it needs about
      // 320 px, and the header drags wider
      width: 320,
      minWidth: 260,
      trailing: (row) => (row.kind === 'prompt' && row.branded ? <Badge>{t('branded')}</Badge> : null),
    });
    const identity: DataTableColumn<TopicRow> = {
      ...name,
      // The name of a group is a button: F2 reaches it from the cell
      hasControls: true,
      cell: (row) => {
        if (row.kind === 'prompt') return name.cell(row);
        const count = t('topics.promptCount', { count: row.promptCount });
        return (
          <span className="flex min-w-0 items-baseline gap-2">
            <Button
              {...CELL_CONTROL}
              variant="link"
              size="sm"
              aria-label={t('topics.openTopic', { name: row.name })}
              // The text color of a group's name on Rankings; the link color shows on hover. The count gives way first
              className="max-w-full min-w-0 shrink-0 justify-start text-foreground"
              onClick={(event) =>
                openTopic(row.key, TOPIC_TAB.overview, event.metaKey || event.ctrlKey ? 'new-tab' : 'inspector')
              }
            >
              <span className="truncate">{row.name}</span>
            </Button>
            {/* Only a row that opens (its prompts are known) has the count of what it opens onto */}
            {row.members === null ? null : (
              <Tooltip content={count} purpose="label">
                <span className="min-w-0 truncate num font-normal text-foreground-tertiary">{count}</span>
              </Tooltip>
            )}
          </span>
        );
      },
    };
    const location = col.text<TopicRow>(
      SORT_ID.country,
      (row) => {
        const names = locationOf(row);
        return names.length === 0
          ? null
          : names.length === 1
            ? (names[0] ?? null)
            : groupsText('locationCount', { count: names.length });
      },
      {
        header: t('columns.country'),
        headerTooltip: root('prompts.shell.columns.locationTip'),
        priority: 3,
        width: 120,
        sortable: false,
        unknown: () => ({ label: EMPTY_VALUE, tooltip: groupsText('locationNoneTip') }),
      },
    );
    const locationColumn: DataTableColumn<TopicRow> = {
      ...location,
      cellTip: (row) => {
        const names = locationOf(row);
        if (names.length === 0) return location.cellTip?.(row);
        return {
          content:
            names.length === 1
              ? groupsText('locationTip')
              : groupsText('locationListTip', { locations: formatList(names, locale) }),
        };
      },
    };
    const metricColumns = [
      volumeColumn<TopicRow>(root, volumeOf),
      positionColumn<TopicRow>(shared, { facts: factsOf, link: linkOf }),
      rateColumns.mention,
      rateColumns.citation,
      recommendationColumn<TopicRow>(shared, { facts: factsOf, link: linkOf }),
      shareOfVoiceColumn<TopicRow>(shared, { cells: cellsOf, link: linkOf }),
      sentimentColumn<TopicRow>(shared, { facts: factsOf, link: linkOf }),
      brandsColumn<TopicRow>({
        rowsOf: factRowsOf,
        labelOf: (row) => (row.kind === 'prompt' ? root('prompts.lists.thisPrompt') : row.name),
        loaded: facts !== undefined,
        scope: codes,
        entities: facts?.entities ?? [],
        project,
        platformName: (code) => engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code,
        t: root,
      }),
      { ...rateColumns.topEngine, defaultVisible: false },
      ...countColumns,
    ];
    // The By platform view: the group, its Mention rate, then the columns of that view
    if (viewColumns !== undefined) return [identity, rateColumns.mention, ...viewColumns];
    return [identity, ...(showLocation ? [locationColumn] : []), ...metricColumns];
  }, [
    t,
    groupsText,
    root,
    locale,
    engines,
    codes,
    rowName,
    openTopic,
    rateColumns,
    countColumns,
    viewColumns,
    facts,
    project,
    showLocation,
    locations,
  ]);
  // Only the columns that sort: `?sort=-topic` of the Prompts tab names a column here that does not
  const sortValues = useMemo(
    () =>
      new Map(
        columns.flatMap((column) => (column.sortValue === undefined ? [] : [[column.id, column.sortValue] as const])),
      ),
    [columns],
  );
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(sortText, new Set(sortValues.keys()));
    return parsed.length === 0 ? DEFAULT_TOPIC_SORT : parsed;
  }, [sortText, sortValues]);
  // A sort on a column that is not shown (turned off in the chooser, or left out of this view) falls back to the default
  const shownIds = useMemo(
    () => visible ?? columns.filter((column) => column.defaultVisible !== false).map((column) => column.id),
    [visible, columns],
  );
  const sorting = useMemo(() => effectiveSort(sort, DEFAULT_TOPIC_SORT, shownIds), [sort, shownIds]);
  const groups = useMemo(
    (): Group[] =>
      summary === undefined
        ? []
        : groupsOfSummary({ summary, tree, descendants, kept, filtering, codes, only: detectable }),
    [summary, tree, descendants, kept, filtering, codes, detectable],
  );
  // The groups the search keeps, in the order of the sort; open or not, the prompts under a group keep theirs
  const found = useMemo(() => {
    const head = (group: Group): GroupRow => ({
      kind: 'topic',
      id: `topic:${group.key}`,
      key: group.key,
      name: group.name,
      promptCount: group.promptCount,
      engines: group.engines,
      members: group.members,
      listed: [],
      position: 0,
      siblings: 0,
    });
    const ordered = sortByKeys(
      searchGroups(groups, search, locale).map((entry) => ({ entry, head: head(entry.group) })),
      sorting,
      (item, id) => sortValues.get(id)?.(item.head) ?? null,
      (item) => item.head.name,
    );
    return ordered.map(({ entry }, index) => ({
      ...entry,
      head: { ...head(entry.group), listed: entry.listed, position: index + 1, siblings: ordered.length },
    }));
  }, [groups, search, locale, sorting, sortValues]);
  const searching = search.trim() !== '';
  // Only the List opens its groups, and while the search finds prompts every group is open so they are in sight
  const opens = viewColumns === undefined;
  const groupKeys = useMemo(
    () => found.filter(({ head }) => head.members !== null).map(({ head }) => head.key),
    [found],
  );
  const openKeys = useMemo(
    (): ReadonlySet<string> => (!opens ? new Set() : searching ? new Set(groupKeys) : open),
    [opens, searching, groupKeys, open],
  );
  const isOpen = (key: string): boolean => openKeys.has(key);
  const allOpen = groupKeys.length > 0 && groupKeys.every(isOpen);
  const rows = useMemo(
    (): TopicRow[] =>
      found.flatMap(({ head }): TopicRow[] => {
        if (head.members === null || !openKeys.has(head.key)) return [head];
        return [
          head,
          ...head.listed.map((member, at): TopicRow => ({
            kind: 'prompt',
            id: `${head.key}:${member.prompt_id}`,
            topicKey: head.key,
            promptId: member.prompt_id,
            name: member.text,
            branded: member.is_branded,
            engines: member.engines,
            position: at + 1,
            siblings: head.listed.length,
          })),
        ];
      }),
    [found, openKeys],
  );
  // A prompt of two open groups is two rows and one step
  const promptOrder = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.kind === 'prompt' ? [row.promptId] : [])))],
    [rows],
  );
  useEffect(() => onPromptOrderChange(promptOrder), [promptOrder, onPromptOrderChange]);
  // Every group in the order of the sort, open or closed: what the group drawer steps through
  const topicOrder = useMemo(() => found.map(({ head }) => head.key), [found]);
  useEffect(() => onTopicOrderChange?.(topicOrder), [topicOrder, onTopicOrderChange]);
  // A prompt of two open groups is two rows: the one clicked is the open one while it still shows the open prompt
  // (stepping or a link name it without a row, and the first row of the prompt stands for it)
  const ofOpenPrompt = (row: TopicRow): boolean => row.kind === 'prompt' && row.promptId === activePromptId;
  const promptRowId =
    activePromptId === null
      ? null
      : ((rows.find((row) => row.id === clicked && ofOpenPrompt(row)) ?? rows.find(ofOpenPrompt))?.id ?? null);
  // A drawer opens from a group, and a prompt from the drawer may have no row of its own: the group's row stands for it
  const activeRowId = promptRowId ?? (activeTopicKey === null ? null : `topic:${activeTopicKey}`);
  // The prompts each group row stands for: a group whose prompts are not known, or that holds none, has no box
  const rowPrompts = useMemo(
    (): RowPrompts =>
      new Map(
        rows.flatMap((row): [string, readonly string[]][] =>
          row.kind === 'topic' ? [[row.id, idsOf(row.members)]] : [],
        ),
      ),
    [rows],
  );
  const picked = useMemo(() => rowSelection(chosen, rowPrompts), [chosen, rowPrompts]);
  // Every group counts, the closed ones and those a search hides too: the choice is of prompts
  const chosenGroups = useMemo(
    () =>
      groupsChosen(
        groups.map((group) => idsOf(group.members)),
        chosen,
      ),
    [groups, chosen],
  );
  const rowTree = (row: TopicRow): RowTree => {
    // A prompt is listed under its group and has no box: the group is what is chosen
    if (row.kind === 'prompt') return { level: 2, setSize: row.siblings, posInSet: row.position, selectable: false };
    const hasBox = (row.members?.length ?? 0) > 0;
    // A row without `expanded` has nothing to show and is an ordinary row
    if (row.members === null || !opens) {
      return { level: 1, setSize: row.siblings, posInSet: row.position, selectable: hasBox };
    }
    const expanded = isOpen(row.key);
    return {
      level: 1,
      expanded,
      selectable: hasBox,
      setSize: row.siblings,
      posInSet: row.position,
      label: t(expanded ? 'topics.collapse' : 'topics.expand', { name: row.name, count: row.promptCount }),
    };
  };
  const toggle = (row: TopicRow): void => {
    if (row.kind !== 'topic' || searching) return;
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };
  // One button for both: it opens every group, or closes them once all are open. The open groups are in memory only
  const toggleAll = (): void => setOpen(allOpen ? new Set() : new Set(groupKeys));
  const settled = status === 'ready' || status === 'refetching';
  const shownStatus: TableStatus =
    settled && rows.length === 0 ? (!searching && !filtering && !countryChosen ? 'empty' : 'filtered-empty') : status;
  // The prompts in scope, each once (the group filter narrows them, a search does not): what the footnote counts
  const promptsInScope = useMemo(
    () =>
      summary === undefined
        ? []
        : summary.prompts.filter((prompt) => !filtering || prompt.topic_term_ids.some((id) => kept.has(id))),
    [summary, filtering, kept],
  );
  const coverage = useMemo(() => groupCoverage(promptsInScope, groups), [promptsInScope, groups]);
  const footnote =
    coverage.overlapping === 0 && coverage.outside === 0
      ? null
      : [
          coverage.overlapping === 0 ? null : groupsText('overlap'),
          coverage.overlapping === 0 ? null : groupsText('overlapCount', { count: coverage.overlapping }),
          coverage.outside === 0 ? null : groupsText('outsideCount', { count: coverage.outside }),
        ]
          .filter((sentence) => sentence !== null)
          .join(' ');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <DataTable<TopicRow>
        caption={t('topics.caption')}
        itemNoun={{ one: t('topics.noun.one'), other: t('topics.noun.other') }}
        columns={columns}
        getRowId={rowId}
        rows={rows}
        total={found.length}
        footerNote={summary === undefined ? undefined : t('topics.footerPrompts', { count: distinctPrompts(found) })}
        sort={sort}
        sortFallback={DEFAULT_TOPIC_SORT}
        onSortChange={(next) => onSortTextChange(sameSort(next, DEFAULT_TOPIC_SORT) ? null : formatSort(next))}
        defaultSort={DEFAULT_TOPIC_SORT}
        compactToolbar
        // Rows are always compact: no density menu and no sort note (the footer counts)
        toolbarParts={{ density: false, sortNote: false }}
        density="compact"
        onDensityChange={nothing}
        toolbarEnd={
          <>
            {opens && groupKeys.length > 0 ? (
              <Tooltip content={groupsText('searchOpensAll')} disabled={!searching}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={allOpen ? ChevronsDownUp : ChevronsUpDown}
                  onClick={toggleAll}
                  disabled={searching}
                  focusableWhenDisabled
                >
                  {/* Icon only on a phone, where the end of the toolbar also holds the switch and two icons */}
                  <span className="sr-only sm:not-sr-only">
                    {t(allOpen ? 'topics.collapseAll' : 'topics.expandAll')}
                  </span>
                </Button>
              </Tooltip>
            ) : null}
            {viewSwitch}
          </>
        }
        columnState={{
          visible,
          // Hiding the sorted column drops its sort from the address too, so the link says what the table does
          onChange: (next) => {
            setVisible(next);
            if (next !== null && sort.some((key) => !next.includes(key.id))) onSortTextChange(null);
          },
        }}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={t('topics.search')}
        rowName={rowName}
        rowTree={rowTree}
        onToggleGroup={toggle}
        groupRowOpens
        selection={{
          selectedIds: picked.selectedIds,
          indeterminateIds: picked.indeterminateIds,
          onChange: (next) => onChosenChange(applyRowChange(chosen, picked.selectedIds, next, rowPrompts)),
          // Every prompt a group holds is in the table's list: there is no "all matching" beyond the rows
          matchingTotal: null,
          allMatching: false,
          onAllMatchingChange: nothing,
          // A choice made through a group that is now closed has no box to untick: Clear empties it
          onClear: () => onChosenChange(new Set()),
          selectedCount: chosen.size,
          selectedLabel:
            chosenGroups === 0 ? undefined : groupsText('selected', { groups: chosenGroups, prompts: chosen.size }),
          headerCoversGroups: true,
        }}
        bulkActions={asRecordActions<TopicRow>(bulkActions)}
        rowActions={(row) =>
          asRecordActions<TopicRow>(
            rowMenu(
              row.kind === 'prompt'
                ? { kind: 'prompt', promptId: row.promptId, topicKey: row.topicKey }
                : { kind: 'topic', key: row.key, name: row.name, promptIds: idsOf(row.members) },
            ),
          )
        }
        onRowOpen={(row, intent) => {
          if (row.kind === 'topic') {
            openTopic(row.key, TOPIC_TAB.overview, intent);
            return;
          }
          setClicked(row.id);
          onOpenPrompt(row.promptId, intent, row.topicKey);
        }}
        activeRowId={activeRowId}
        status={shownStatus}
        errorState={errorState}
        emptyState={emptyState}
        filteredEmptyState={filteredEmptyState}
      />
      {footnote === null ? null : <p className="type-meta">{footnote}</p>}
    </div>
  );
}
