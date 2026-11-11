'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useEngineColumns } from './prompt-columns';
import { topicMembers, topicRowKept, type TopicDescendants } from './prompt-model';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn, RowTree, TableStatus } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import type { EngineSummary, ProjectEngine, PromptsSummary } from '@/lib/api/types';
import { EMPTY_VALUE } from '@/lib/format';
import type { Density, SortKey } from '@/lib/tables/table-state';

/** A topic, or one of its prompts while the topic is open. */
type TopicRow =
  | {
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
    }
  | {
      kind: 'prompt';
      /** Topic and prompt: a prompt of two topics is a row under each. */
      id: string;
      promptId: string;
      name: string;
      branded: boolean;
      engines: readonly EngineSummary[];
      position: number;
      siblings: number;
    };

const NO_TOPIC = '__none';
const NO_SORT: readonly SortKey[] = [];
const rowId = (row: TopicRow): string => row.id;
const rowName = (row: TopicRow): string => row.name;
const cellsOf = (row: TopicRow): readonly EngineSummary[] => row.engines;
/** The mention rate on the engine; a prompt without one comes last. */
const mentionedOn = (engines: readonly EngineSummary[], code: string | undefined): number =>
  engines.find((engine) => engine.engine_code === code)?.mentioned.value ?? -1;

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
  search: string;
  onSearchChange: (search: string) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
  /** The prompt open in the inspector; its row is marked. */
  activePromptId: string | null;
  onOpenPrompt: (promptId: string, intent: 'inspector' | 'new-tab') => void;
  /** The prompts the open topics list, in the order of the rows, each once: what the inspector steps through. */
  onPromptOrderChange: (promptIds: readonly string[]) => void;
}

/**
 * The Topics tab (ADR-DS-022 decisions 2 and 3): one row per topic that has prompts in scope, the largest
 * first (as the API sends them when two are equal), and per engine its Mentioned and Cited counts. The API
 * rolls a topic up as the prompts given it or a topic below it and weights each prompt once, so a topic's
 * count is the answers behind its prompts and its rate is the mean of theirs. A topic opens in place and lists
 * those prompts, most mentioned first on the first engine shown. Prompts without a topic share a row, "No
 * topic". The search finds a topic by its name or by one of its prompts. A topic filter keeps the topic and the
 * topics below it, as on the Prompts tab.
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
  search,
  onSearchChange,
  density,
  onDensityChange,
  activePromptId,
  onOpenPrompt,
  onPromptOrderChange,
}: TopicsTableProps): ReactElement {
  const t = useTranslations('prompts');
  const locale = useLocale();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  // The rates are prompt weighted while the counts shown are answers: the header says so
  const engineColumns = useEngineColumns(engines, cellsOf, { sortable: false, note: t('topics.weighted') });
  const columns = useMemo(
    (): DataTableColumn<TopicRow>[] => [
      col.keyword<TopicRow>('topic', rowName, {
        header: t('topics.topic'),
        sortable: false,
        trailing: (row) => (row.kind === 'prompt' && row.branded ? <Badge>{t('branded')}</Badge> : null),
      }),
      col.count<TopicRow>('prompts', (row) => (row.kind === 'topic' ? row.promptCount : null), {
        header: t('topics.prompts'),
        sortable: false,
        minWidth: 100,
        unknown: () => ({ label: EMPTY_VALUE }),
      }),
      ...engineColumns,
    ],
    [t, engineColumns],
  );
  const firstEngine = engines[0]?.engine.engine_code;
  const rows = useMemo((): TopicRow[] => {
    if (summary === undefined) return [];
    const query = search.trim().toLocaleLowerCase(locale);
    const groups = summary.topics
      .filter((topic) => !filtering || topicRowKept(topic.term_id, kept))
      .map((topic) => ({
        topic,
        name: topic.name ?? t('columns.noTopic'),
        members: topicMembers(topic.term_id, summary.prompts, descendants),
      }))
      .filter(
        ({ name, members }) =>
          query === '' ||
          name.toLocaleLowerCase(locale).includes(query) ||
          (members ?? []).some((member) => member.text.toLocaleLowerCase(locale).includes(query)),
      )
      // The sort is stable: topics of one size stay in the order the API sent them
      .sort((a, b) => b.topic.prompt_count - a.topic.prompt_count);
    return groups.flatMap(({ topic, name, members }, index): TopicRow[] => {
      const key = topic.term_id ?? NO_TOPIC;
      const head: TopicRow = {
        kind: 'topic',
        id: `topic:${key}`,
        key,
        name,
        promptCount: topic.prompt_count,
        engines: topic.engines,
        position: index + 1,
        openable: members !== null,
      };
      if (members === null || !open.has(key)) return [head];
      // shortcut: every prompt of an open topic, not the eight of ADR-DS-022 decision 2 with "Show all"; add the cap with the topic drawer
      const ordered = [...members].sort(
        (a, b) => mentionedOn(b.engines, firstEngine) - mentionedOn(a.engines, firstEngine),
      );
      return [
        head,
        ...ordered.map((member, at): TopicRow => ({
          kind: 'prompt',
          id: `${key}:${member.prompt_id}`,
          promptId: member.prompt_id,
          name: member.text,
          branded: member.is_branded,
          engines: member.engines,
          position: at + 1,
          siblings: ordered.length,
        })),
      ];
    });
  }, [summary, descendants, kept, filtering, search, locale, open, t, firstEngine]);
  const topicCount = rows.filter((row) => row.kind === 'topic').length;
  // A prompt of two open topics is two rows and one step
  const promptOrder = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.kind === 'prompt' ? [row.promptId] : [])))],
    [rows],
  );
  useEffect(() => onPromptOrderChange(promptOrder), [promptOrder, onPromptOrderChange]);
  const activeRowId =
    activePromptId === null
      ? null
      : (rows.find((row) => row.kind === 'prompt' && row.promptId === activePromptId)?.id ?? null);
  const rowTree = (row: TopicRow): RowTree => {
    if (row.kind === 'prompt') return { level: 2, setSize: row.siblings, posInSet: row.position };
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
      sort={NO_SORT}
      onSortChange={() => undefined}
      defaultSort={NO_SORT}
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
        if (row.kind === 'prompt') onOpenPrompt(row.promptId, intent);
      }}
      activeRowId={activeRowId}
      status={shownStatus}
      errorState={errorState}
      emptyState={emptyState}
      filteredEmptyState={filteredEmptyState}
    />
  );
}
