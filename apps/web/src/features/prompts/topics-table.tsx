'use client';

import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { asRecordActions, type PromptAction } from './prompt-action';
import { useEngineColumns } from './prompt-columns';
import {
  DEFAULT_TOPIC_SORT,
  mostMentionedFirst,
  NO_TOPIC,
  SORT_ID,
  topicMembers,
  topicRowKept,
  TOPIC_ROW_PROMPTS,
  type TopicDescendants,
  type TopicTab,
} from './prompt-model';
import { useRateColumns } from './rate-columns';
import { sortByKeys } from './rate-model';
import { applyRowChange, rowSelection, topicsChosen, type RowPrompts } from './selection-model';
import { buildTopicTree, countTopicRows, sortTopicTree, type TopicBranch } from './topic-tree';
import { useTrendColumn } from './trend-column';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn, RowTree, TableStatus } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { EngineSummary, ProjectEngine, PromptsSummary, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE } from '@/lib/format';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { formatSort, parseSort, sameSort, type Density, type SortKey } from '@/lib/tables/table-state';

type TopicHead = {
  kind: 'topic';
  id: string;
  /** The term id, or `__none` for the prompts without a topic. */
  key: string;
  name: string;
  promptCount: number;
  engines: readonly EngineSummary[];
  /** 1 for a top level topic, 2 for a topic listed under its parent. */
  level: 1 | 2;
  /** Level 1: the topics listed under it; with any, it opens onto them and not onto its prompts. */
  childCount: number;
  /** The place among the topics of its level, and how many there are (a level 2 topic counts its parent's "Show all" row too). */
  position: number;
  siblings: number;
  /** The prompts the topic holds; `null` while the trees do not hold the topic (not read yet), when its prompts cannot be told. */
  members: readonly PromptSummaryRow[] | null;
};

/** A topic, one of its prompts while the topic is open, or the row that offers the rest of them. */
type TopicRow =
  | TopicHead
  | {
      kind: 'prompt';
      /** Topic and prompt: a prompt of two topics is a row under each. */
      id: string;
      /** The topic the row is listed under. */
      topicKey: string;
      promptId: string;
      name: string;
      branded: boolean;
      engines: readonly EngineSummary[];
      position: number;
      siblings: number;
    }
  | {
      kind: 'more';
      id: string;
      key: string;
      /** The topic's name. */
      name: string;
      /** The prompts the topic holds, all of them: the row's button says it opens them. */
      total: number;
      position: number;
      siblings: number;
    };

const rowId = (row: TopicRow): string => row.id;
const idsOf = (members: readonly PromptSummaryRow[] | null): string[] => (members ?? []).map((m) => m.prompt_id);
const nothing = (): void => undefined;
const cellsOf = (row: TopicRow): readonly EngineSummary[] => (row.kind === 'more' ? [] : row.engines);

/** A column that says nothing on the row that offers the rest of a topic's prompts. */
const blankOnMore = (column: DataTableColumn<TopicRow>): DataTableColumn<TopicRow> => ({
  ...column,
  cellTip: (row) => (row.kind === 'more' ? undefined : column.cellTip?.(row)),
  cell: (row) => (row.kind === 'more' ? null : column.cell(row)),
});

export interface TopicsTableProps {
  /** The prompts summary of the window; `undefined` while it loads. */
  summary: PromptsSummary | undefined;
  /** The engines shown, in order. */
  engines: readonly ProjectEngine[];
  /** Each topic and the topics below it, from the vocabularies' trees: which prompts a topic holds. */
  descendants: TopicDescendants;
  /** The terms of the topic vocabularies' trees: where each topic sits, so a topic is listed under its parent. */
  tree: readonly NamedTerm[];
  /** With `filtering`, the topics the filter keeps: the chosen ones and those below them. */
  kept: ReadonlySet<string>;
  /** Whether a topic filter is set. */
  filtering: boolean;
  /** A country of the top bar narrows the summary, so no topic left is a match that found nothing, not no prompts. */
  countryChosen: boolean;
  status: TableStatus;
  errorState: ReactNode;
  /** No topic at all, and no search or topic filter to blame. */
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
  /** The `sort` of the address (`-id` for descending), or `null`: the table reads the ids it has (`SORT_ID`). */
  sortText: string | null;
  onSortTextChange: (sort: string | null) => void;
  search: string;
  onSearchChange: (search: string) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
  /** The prompt open in the inspector; its row is marked. */
  activePromptId: string | null;
  /** The topic whose drawer is open, or the one the open prompt was opened from; its row is marked when no prompt row is. */
  activeTopicKey: string | null;
  /** `topicKey` is the topic the row is listed under: its prompts are the list the inspector steps through. */
  onOpenPrompt: (promptId: string, intent: 'inspector' | 'new-tab', topicKey: string) => void;
  /** Opens the topic's drawer: on Overview from its name, on Prompts from "Show all". */
  onOpenTopic: (key: string, tab: TopicTab, intent: 'inspector' | 'new-tab') => void;
  /** The prompts the open topics list, in the order of the rows, each once: what the inspector steps through. */
  onPromptOrderChange: (promptIds: readonly string[]) => void;
  /** The switch between the views of the page, at the end of the toolbar before the density and columns, as on Rankings. */
  viewSwitch?: ReactNode;
  /** The prompts chosen, by prompt id: a topic's box chooses the prompts it holds (`selection-model.ts`). */
  chosen: ReadonlySet<string>;
  onChosenChange: (ids: ReadonlySet<string>) => void;
  /** The bulk bar's actions, on the chosen prompts. */
  bulkActions: readonly PromptAction[];
  /** The actions of a row's "More" menu: a topic's, or a prompt listed under a topic's. */
  rowMenu: (target: TopicMenuTarget) => readonly PromptAction[];
}

/** What a row's menu is asked for. */
export type TopicMenuTarget =
  | {
      kind: 'topic';
      /** The term id, or `__none` for the prompts without a topic. */
      key: string;
      name: string;
      /** The prompts the topic holds, a parent's with those of its topics; empty while they cannot be told. */
      promptIds: readonly string[];
    }
  | { kind: 'prompt'; promptId: string; topicKey: string };

/**
 * The Topics tab (ADR-DS-022 decisions 2, 3 and 5, parity spec D-3): a tree of two levels, with each topic's Mention
 * rate and Citation rate (the average of the engines shown), its Top engine, its weekly Trend, and per engine its Mentioned and
 * Cited counts. The rows come highest Mention rate first, a tie by name, and sort by each column that has a sort
 * (`sortText`, the address's `sort`); the table sorts the topics itself, since a tree shows its rows as given, the
 * top level among itself and the topics under a parent among theirs.
 * The API rolls a topic up as the prompts given it or a topic below it and weights each prompt once, so a topic's
 * count is the answers behind its prompts and its rate is the mean of theirs, and a parent's row is not the sum
 * of the rows under it (a note says so). A topic with topics below it opens onto them, and a topic without opens
 * onto its prompts, most mentioned first on the first engine shown, eight at most and then "Show all" (decision 2).
 *
 * shortcut: `RowTree.level` is 1 or 2 and only a level 1 row can open, so the tree has the parent as its group and
 * one level of rows under it. A parent's rows are therefore the topics below it, not their prompts: a child topic
 * is a row of its own that opens the drawer, and the prompts of a parent (those of its children among them) are
 * one "Show all" away in the drawer's Prompts tab. Upgrade when `RowTree` gets a third level: a child then opens
 * onto its prompts, as a topic without children does here.
 *
 * Its name opens the topic drawer. Prompts without a topic share a row, "No topic". The search finds a topic by
 * its name or by one of its prompts. A topic filter keeps the topic and the topics below it, as on the Prompts tab.
 */
export function TopicsTable({
  summary,
  engines,
  descendants,
  tree,
  kept,
  filtering,
  countryChosen,
  status,
  errorState,
  emptyState,
  filteredEmptyState,
  sortText,
  onSortTextChange,
  search,
  onSearchChange,
  density,
  onDensityChange,
  activePromptId,
  activeTopicKey,
  onOpenPrompt,
  onOpenTopic,
  onPromptOrderChange,
  viewSwitch,
  chosen,
  onChosenChange,
  bulkActions,
  rowMenu,
}: TopicsTableProps): ReactElement {
  const t = useTranslations('prompts');
  const locale = useLocale();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // The prompt row that was clicked, which two topics may both show
  const [clicked, setClicked] = useState<string | null>(null);
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  // The rates are prompt weighted while the counts shown are answers: the header says so
  const note = t('topics.weighted');
  const rateColumns = useRateColumns(engines, cellsOf, { note });
  const trendColumn = useTrendColumn(engines, cellsOf);
  const engineColumns = useEngineColumns(engines, cellsOf, { sortable: true, note });
  // The latest handler, so the columns (which the table keys its work by) do not change with every render
  const latestOpenTopic = useRef(onOpenTopic);
  useEffect(() => {
    latestOpenTopic.current = onOpenTopic;
  }, [onOpenTopic]);
  const openTopic = useCallback(
    (key: string, tab: TopicTab, intent: 'inspector' | 'new-tab') => latestOpenTopic.current(key, tab, intent),
    [],
  );
  const rowName = useCallback(
    (row: TopicRow): string =>
      row.kind === 'more' ? t('topics.showAllFor', { count: row.total, name: row.name }) : row.name,
    [t],
  );
  const columns = useMemo((): DataTableColumn<TopicRow>[] => {
    const name = col.keyword<TopicRow>('topic', rowName, {
      header: t('topics.topic'),
      // Room for a name and the count after it, which the identity column's default leaves too little of: a topic such
      // as "Compliance and regulation" with "3 topics" after it needs about 320 px, and 260 px is where it stays when
      // the other columns want the room
      width: 320,
      minWidth: 260,
      sortable: false,
      trailing: (row) => (row.kind === 'prompt' && row.branded ? <Badge>{t('branded')}</Badge> : null),
    });
    return [
      {
        ...name,
        // The name of a top level topic and the row of "Show all" are buttons: F2 reaches them from the cell
        hasControls: true,
        // As Rankings draws its rows: a prompt and a topic under a topic are text, as a keyword is (a click on the row
        // opens them), a parent is a name with a muted count after it, and "Show all" is a link like "Show more"
        cell: (row) => {
          if (row.kind === 'prompt' || (row.kind === 'topic' && row.level === 2)) return name.cell(row);
          if (row.kind === 'more') {
            return (
              <Button
                {...CELL_CONTROL}
                variant="link"
                size="sm"
                aria-label={rowName(row)}
                className="max-w-full min-w-0 justify-start"
                onClick={(event) =>
                  openTopic(row.key, 'prompts', event.metaKey || event.ctrlKey ? 'new-tab' : 'inspector')
                }
              >
                <span className="truncate">{t('topics.showAll', { count: row.total })}</span>
              </Button>
            );
          }
          return (
            <span className="flex min-w-0 items-baseline gap-2">
              <Button
                {...CELL_CONTROL}
                variant="link"
                size="sm"
                aria-label={t('topics.openTopic', { name: row.name })}
                // The text color of a group's name on Rankings; the link color shows on hover. It does not shrink for the
                // count: the name is cut only when it is longer than the cell, and the count gives way first
                className="max-w-full min-w-0 shrink-0 justify-start text-foreground"
                onClick={(event) =>
                  openTopic(row.key, 'overview', event.metaKey || event.ctrlKey ? 'new-tab' : 'inspector')
                }
              >
                <span className="truncate">{row.name}</span>
              </Button>
              {/* Only a row that opens (its prompts are known) has the count of what it opens onto */}
              {row.members === null ? null : (
                <span className="min-w-0 truncate num font-normal text-foreground-tertiary">
                  {row.childCount > 0
                    ? t('topics.childTopics', { count: row.childCount })
                    : t('topics.promptCount', { count: row.promptCount })}
                </span>
              )}
            </span>
          );
        },
      },
      blankOnMore(
        col.count<TopicRow>(SORT_ID.prompts, (row) => (row.kind === 'topic' ? row.promptCount : null), {
          header: t('topics.prompts'),
          minWidth: 100,
          unknown: () => ({ label: EMPTY_VALUE }),
        }),
      ),
      blankOnMore(rateColumns.mention),
      blankOnMore(rateColumns.citation),
      blankOnMore(rateColumns.topEngine),
      blankOnMore(trendColumn),
      ...engineColumns.map(blankOnMore),
    ];
  }, [t, rowName, openTopic, rateColumns, trendColumn, engineColumns]);
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
  const firstEngine = engines[0]?.engine.engine_code;
  // The topics as a tree of two levels, searched and in the order of the sort; open or not, the prompts under a topic keep theirs
  const branches = useMemo((): TopicBranch<TopicHead>[] => {
    if (summary === undefined) return [];
    const query = search.trim().toLocaleLowerCase(locale);
    const headOf = (topic: TopicSummaryRow, level: 1 | 2): TopicHead => {
      const key = topic.term_id ?? NO_TOPIC;
      return {
        kind: 'topic',
        id: `topic:${key}`,
        key,
        name: topic.name ?? t('columns.noTopic'),
        promptCount: topic.prompt_count,
        engines: topic.engines,
        level,
        childCount: 0,
        position: 0,
        siblings: 0,
        members: topicMembers(topic.term_id, summary.prompts, descendants),
      };
    };
    const nameMatches = (head: TopicHead): boolean => head.name.toLocaleLowerCase(locale).includes(query);
    const matches = (head: TopicHead): boolean =>
      query === '' ||
      nameMatches(head) ||
      (head.members ?? []).some((member) => member.text.toLocaleLowerCase(locale).includes(query));
    const found = buildTopicTree(summary.topics, tree, (termId) => !filtering || topicRowKept(termId, kept)).flatMap(
      ({ row, children }): TopicBranch<TopicHead>[] => {
        const parent = headOf(row, 1);
        const below = children.map((child) => headOf(child, 2));
        // A topic below is found by its own name even when the parent's name is not: the parent stays to hold it
        if (!matches(parent) && !below.some(nameMatches)) return [];
        // A parent that the search finds by its own name keeps all of its topics; otherwise those the search finds.
        // A parent found only by the text of its prompts may keep none: it then opens onto its prompts, as a topic
        // without topics below does, and its chevron says so
        return [{ row: parent, children: nameMatches(parent) ? below : below.filter(matches) }];
      },
    );
    return sortTopicTree(found, (heads) =>
      sortByKeys(
        heads,
        sort,
        (head, id) => sortValues.get(id)?.(head) ?? null,
        (head) => head.name,
      ),
    );
  }, [summary, descendants, tree, kept, filtering, search, locale, t, sort, sortValues]);
  const topicCount = countTopicRows(branches);
  // The parents that open: onto their topics, or, with none below, onto their prompts (a topic the trees do not hold yet has none to show)
  const groupKeys = useMemo(
    () => branches.filter(({ row, children }) => children.length > 0 || row.members !== null).map(({ row }) => row.key),
    [branches],
  );
  const allOpen = groupKeys.length > 0 && groupKeys.every((key) => open.has(key));
  const rows = useMemo(
    (): TopicRow[] =>
      branches.flatMap(({ row: top, children }, index): TopicRow[] => {
        const head: TopicHead = { ...top, childCount: children.length, position: index + 1, siblings: branches.length };
        const { key, name, members } = top;
        if (members === null || !open.has(key)) return [head];
        if (children.length > 0) {
          // The topics under the parent, and its prompts one "Show all" away
          const siblings = children.length + 1;
          return [
            head,
            ...children.map((child, at): TopicRow => ({ ...child, position: at + 1, siblings })),
            { kind: 'more', id: `${key}:more`, key, name, total: members.length, position: siblings, siblings },
          ];
        }
        const ordered = mostMentionedFirst(members, firstEngine);
        const listed = ordered.slice(0, TOPIC_ROW_PROMPTS);
        const more = ordered.length > listed.length;
        const siblings = listed.length + (more ? 1 : 0);
        return [
          head,
          ...listed.map((member, at): TopicRow => ({
            kind: 'prompt',
            id: `${key}:${member.prompt_id}`,
            topicKey: key,
            promptId: member.prompt_id,
            name: member.text,
            branded: member.is_branded,
            engines: member.engines,
            position: at + 1,
            siblings,
          })),
          ...(more
            ? [
                {
                  kind: 'more' as const,
                  id: `${key}:more`,
                  key,
                  name,
                  total: ordered.length,
                  position: siblings,
                  siblings,
                },
              ]
            : []),
        ];
      }),
    [branches, open, firstEngine],
  );
  // A prompt of two open topics is two rows and one step
  const promptOrder = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.kind === 'prompt' ? [row.promptId] : [])))],
    [rows],
  );
  useEffect(() => onPromptOrderChange(promptOrder), [promptOrder, onPromptOrderChange]);
  // A prompt of two open topics is two rows: the one clicked is the open one while it still shows the open prompt
  // (stepping or a link name it without a row, and the first row of the prompt stands for it)
  const ofOpenPrompt = (row: TopicRow): boolean => row.kind === 'prompt' && row.promptId === activePromptId;
  const promptRowId =
    activePromptId === null
      ? null
      : ((rows.find((row) => row.id === clicked && ofOpenPrompt(row)) ?? rows.find(ofOpenPrompt))?.id ?? null);
  // A drawer opens from a topic, and a prompt from the drawer may have no row of its own: the topic's row stands for it
  const activeRowId = promptRowId ?? (activeTopicKey === null ? null : `topic:${activeTopicKey}`);
  // The prompts each row stands for, and the rows a choice of prompts selects (a topic whose prompts are not known,
  // or that holds none, has no box)
  const rowPrompts = useMemo(
    (): RowPrompts =>
      new Map(
        rows.flatMap((row): [string, readonly string[]][] => {
          if (row.kind === 'more') return [];
          return [[row.id, row.kind === 'prompt' ? [row.promptId] : idsOf(row.members)]];
        }),
      ),
    [rows],
  );
  const picked = useMemo(() => rowSelection(chosen, rowPrompts), [chosen, rowPrompts]);
  // Every topic of the tree counts, the closed ones and those a search hides too: the choice is of prompts
  const chosenTopics = useMemo(
    () =>
      topicsChosen(
        // The prompts without a topic share a row, but are no topic
        branches
          .filter(({ row }) => row.key !== NO_TOPIC)
          .map(({ row, children }) => ({
            ids: idsOf(row.members),
            children: children.map((child) => ({ ids: idsOf(child.members) })),
          })),
        chosen,
      ),
    [branches, chosen],
  );
  const hasBox = (row: TopicHead): boolean => (row.members?.length ?? 0) > 0;
  const rowTree = (row: TopicRow): RowTree => {
    if (row.kind === 'prompt') return { level: 2, setSize: row.siblings, posInSet: row.position };
    if (row.kind === 'more') {
      return { level: 2, setSize: row.siblings, posInSet: row.position, selectable: false };
    }
    // A topic listed under its parent opens the drawer: only a level 1 row can open (see the shortcut above)
    if (row.level === 2) return { level: 2, setSize: row.siblings, posInSet: row.position, selectable: hasBox(row) };
    // A row without `expanded` has nothing to show and is an ordinary row
    if (row.members === null) return { level: 1, setSize: row.siblings, posInSet: row.position, selectable: false };
    const expanded = open.has(row.key);
    const withTopics = row.childCount > 0;
    return {
      level: 1,
      expanded,
      selectable: hasBox(row),
      setSize: row.siblings,
      posInSet: row.position,
      label: withTopics
        ? t(expanded ? 'topics.collapseTopics' : 'topics.expandTopics', { name: row.name, count: row.childCount })
        : t(expanded ? 'topics.collapse' : 'topics.expand', { name: row.name, count: row.promptCount }),
    };
  };
  const toggle = (row: TopicRow): void => {
    if (row.kind !== 'topic') return;
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };
  // One button for both: it opens every parent, or closes them once all are open. The open parents are in memory only
  const toggleAll = (): void => setOpen(allOpen ? new Set() : new Set(groupKeys));
  const settled = status === 'ready' || status === 'refetching';
  const shownStatus: TableStatus =
    settled && rows.length === 0
      ? search.trim() === '' && !filtering && !countryChosen
        ? 'empty'
        : 'filtered-empty'
      : status;
  // The prompts in scope, each once (the topic filter narrows them, a search does not): the footer's second count
  const promptsInScope =
    summary === undefined
      ? null
      : summary.prompts.filter((prompt) => !filtering || prompt.topic_term_ids.some((id) => kept.has(id))).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <DataTable<TopicRow>
        caption={t('topics.caption')}
        itemNoun={{ one: t('topics.noun.one'), other: t('topics.noun.other') }}
        columns={columns}
        getRowId={rowId}
        rows={rows}
        total={topicCount}
        footerNote={promptsInScope === null ? undefined : t('topics.footerPrompts', { count: promptsInScope })}
        sort={sort}
        onSortChange={(next) => onSortTextChange(sameSort(next, DEFAULT_TOPIC_SORT) ? null : formatSort(next))}
        defaultSort={DEFAULT_TOPIC_SORT}
        compactToolbar
        toolbarEnd={
          <>
            {groupKeys.length === 0 ? null : (
              <Button variant="ghost" size="sm" icon={allOpen ? ChevronsDownUp : ChevronsUpDown} onClick={toggleAll}>
                {/* Icon only on a phone, where the end of the toolbar also holds the switch and two icons */}
                <span className="sr-only sm:not-sr-only">{t(allOpen ? 'topics.collapseAll' : 'topics.expandAll')}</span>
              </Button>
            )}
            {viewSwitch}
          </>
        }
        density={density}
        onDensityChange={onDensityChange}
        columnState={{ visible, onChange: setVisible }}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={t('topics.search')}
        rowName={rowName}
        rowTree={rowTree}
        onToggleGroup={toggle}
        selection={{
          selectedIds: picked.selectedIds,
          indeterminateIds: picked.indeterminateIds,
          onChange: (next) => onChosenChange(applyRowChange(chosen, picked.selectedIds, next, rowPrompts)),
          // Every prompt a topic holds is in the table's list: there is no "all matching" beyond the rows
          matchingTotal: null,
          allMatching: false,
          onAllMatchingChange: nothing,
          // A choice made through a topic that is now closed has no box to untick: Clear empties it
          onClear: () => onChosenChange(new Set()),
          selectedCount: chosen.size,
          selectedLabel:
            chosenTopics === 0 ? undefined : t('bulk.topicsSelected', { topics: chosenTopics, prompts: chosen.size }),
          headerCoversGroups: true,
        }}
        bulkActions={asRecordActions<TopicRow>(bulkActions)}
        rowActions={(row) => {
          if (row.kind === 'more') return [];
          return asRecordActions<TopicRow>(
            rowMenu(
              row.kind === 'prompt'
                ? { kind: 'prompt', promptId: row.promptId, topicKey: row.topicKey }
                : { kind: 'topic', key: row.key, name: row.name, promptIds: idsOf(row.members) },
            ),
          );
        }}
        onRowOpen={(row, intent) => {
          // A topic row that opens no group (a topic under its parent, or one whose prompts cannot be told yet) and
          // the "Show all" row open the drawer
          if (row.kind !== 'prompt') {
            openTopic(row.key, row.kind === 'more' ? 'prompts' : 'overview', intent);
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
      {branches.some(({ children }) => children.length > 0) ? (
        <p className="type-meta">{t('topics.rollupNote')}</p>
      ) : null}
    </div>
  );
}
