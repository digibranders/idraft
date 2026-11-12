'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

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
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn, RowTree, TableStatus } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { EngineSummary, ProjectEngine, PromptsSummary } from '@/lib/api/types';
import { EMPTY_VALUE } from '@/lib/format';
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
  position: number;
  /** Whether the topic's prompts can be listed: a topic the vocabulary trees do not hold (not read yet) has no place known. */
  openable: boolean;
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
  /** With `filtering`, the topics the filter keeps: the chosen ones and those below them. */
  kept: ReadonlySet<string>;
  /** Whether a topic filter is set. */
  filtering: boolean;
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
}

/**
 * The Topics tab (ADR-DS-022 decisions 2, 3 and 5): one row per topic that has prompts in scope, with its Mention
 * rate and Citation rate (the average of the engines shown), its Top engine, and per engine its Mentioned and
 * Cited counts. The rows come highest Mention rate first, a tie by name, and sort by each column that has a sort
 * (`sortText`, the address's `sort`); the table sorts the topics itself, since a tree shows its rows as given.
 * The API rolls a topic up as the prompts given it or a topic below it and weights each prompt once, so a topic's
 * count is the answers behind its prompts and its rate is the mean of theirs. A topic opens in place and lists
 * its prompts, most mentioned first on the first engine shown, eight at most and then "Show all" (decision 2).
 * Its name opens the topic drawer. Prompts without a topic share a row, "No topic". The search finds a topic by
 * its name or by one of its prompts. A topic filter keeps the topic and the topics below it, as on the Prompts tab.
 */
export function TopicsTable({
  summary,
  engines,
  descendants,
  kept,
  filtering,
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
      sortable: false,
      trailing: (row) => (row.kind === 'prompt' && row.branded ? <Badge>{t('branded')}</Badge> : null),
    });
    return [
      {
        ...name,
        // The name of a topic and the row of "Show all" are buttons: F2 reaches them from the cell
        hasControls: true,
        cell: (row) => {
          if (row.kind === 'prompt') return name.cell(row);
          const showAll = row.kind === 'more';
          return (
            <Button
              {...CELL_CONTROL}
              variant="link"
              size="sm"
              aria-label={showAll ? rowName(row) : t('topics.openTopic', { name: row.name })}
              className="max-w-full min-w-0 justify-start"
              onClick={(event) =>
                openTopic(
                  row.key,
                  showAll ? 'prompts' : 'overview',
                  event.metaKey || event.ctrlKey ? 'new-tab' : 'inspector',
                )
              }
            >
              <span className="truncate">{showAll ? t('topics.showAll', { count: row.total }) : row.name}</span>
            </Button>
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
      ...engineColumns.map(blankOnMore),
    ];
  }, [t, rowName, openTopic, rateColumns, engineColumns]);
  const sortValues = useMemo(() => new Map(columns.map((column) => [column.id, column.sortValue])), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(sortText, new Set(sortValues.keys()));
    return parsed.length === 0 ? DEFAULT_TOPIC_SORT : parsed;
  }, [sortText, sortValues]);
  const firstEngine = engines[0]?.engine.engine_code;
  const rows = useMemo((): TopicRow[] => {
    if (summary === undefined) return [];
    const query = search.trim().toLocaleLowerCase(locale);
    const groups = summary.topics
      .filter((topic) => !filtering || topicRowKept(topic.term_id, kept))
      .map((topic) => {
        const key = topic.term_id ?? NO_TOPIC;
        const members = topicMembers(topic.term_id, summary.prompts, descendants);
        const head: TopicHead = {
          kind: 'topic',
          id: `topic:${key}`,
          key,
          name: topic.name ?? t('columns.noTopic'),
          promptCount: topic.prompt_count,
          engines: topic.engines,
          position: 0,
          openable: members !== null,
        };
        return { head, members };
      })
      .filter(
        ({ head, members }) =>
          query === '' ||
          head.name.toLocaleLowerCase(locale).includes(query) ||
          (members ?? []).some((member) => member.text.toLocaleLowerCase(locale).includes(query)),
      );
    // The topics in the order of the sort; the prompts under an open topic keep theirs
    const sorted = sortByKeys(
      groups,
      sort,
      ({ head }, id) => sortValues.get(id)?.(head) ?? null,
      ({ head }) => head.name,
    );
    return sorted.flatMap(({ head: unplaced, members }, index): TopicRow[] => {
      const { key, name } = unplaced;
      const head: TopicHead = { ...unplaced, position: index + 1 };
      if (members === null || !open.has(key)) return [head];
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
    });
  }, [summary, descendants, kept, filtering, search, locale, open, t, firstEngine, sort, sortValues]);
  const topicCount = rows.filter((row) => row.kind === 'topic').length;
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
  const rowTree = (row: TopicRow): RowTree => {
    if (row.kind === 'prompt') return { level: 2, setSize: row.siblings, posInSet: row.position };
    if (row.kind === 'more') {
      return { level: 2, setSize: row.siblings, posInSet: row.position, selectable: false };
    }
    // A row without `expanded` has no prompts to show and is an ordinary row
    if (!row.openable) return { level: 1, setSize: topicCount, posInSet: row.position };
    const expanded = open.has(row.key);
    return {
      level: 1,
      expanded,
      setSize: topicCount,
      posInSet: row.position,
      label: t(expanded ? 'topics.collapse' : 'topics.expand', { name: row.name, count: row.promptCount }),
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
  const settled = status === 'ready' || status === 'refetching';
  const shownStatus: TableStatus =
    settled && rows.length === 0 ? (search.trim() === '' && !filtering ? 'empty' : 'filtered-empty') : status;
  return (
    <DataTable<TopicRow>
      caption={t('topics.caption')}
      itemNoun={{ one: t('topics.noun.one'), other: t('topics.noun.other') }}
      columns={columns}
      getRowId={rowId}
      rows={rows}
      total={topicCount}
      sort={sort}
      onSortChange={(next) => onSortTextChange(sameSort(next, DEFAULT_TOPIC_SORT) ? null : formatSort(next))}
      defaultSort={DEFAULT_TOPIC_SORT}
      density={density}
      onDensityChange={onDensityChange}
      columnState={{ visible, onChange: setVisible }}
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t('topics.search')}
      rowName={rowName}
      rowTree={rowTree}
      onToggleGroup={toggle}
      onRowOpen={(row, intent) => {
        // A topic row that opens no group (its prompts cannot be told yet) and the "Show all" row open the drawer
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
  );
}
