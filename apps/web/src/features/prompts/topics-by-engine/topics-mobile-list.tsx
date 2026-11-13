'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { heatOrder } from './heat-model';
import { topicListLines } from './list-lines';
import type { TopicHead } from './topic-rows';
import { col } from '@/components/app/data-table/columns';
import {
  DataTableList,
  DataTableListSort,
  type ListLine1,
  type ListLine2,
} from '@/components/app/data-table/data-table-list';
import type { DataTableColumn, TableStatus } from '@/components/app/data-table/types';
import { InsufficientPill } from '@/components/app/metric/insufficient-pill';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { averageRate } from '@/lib/rates/rate-model';
import type { SortKey } from '@/lib/tables/table-state';

export interface TopicsMobileListProps {
  /** The topics of the page as the filters and the search leave them. */
  heads: readonly TopicHead[];
  /** The engines shown, in order. */
  engines: readonly ProjectEngine[];
  status: TableStatus;
  search: string;
  onSearchChange: (search: string) => void;
  /** The topic whose drawer is open; its row is marked. */
  activeTopicKey: string | null;
  /** Opens the topic's drawer on its Overview. */
  onOpenTopic: (key: string) => void;
  /** The topics in the order listed: what the drawer's Previous and Next step through. */
  onTopicOrderChange: (keys: readonly string[]) => void;
  /** The view switches, at the end of the toolbar. */
  toolbarEnd: ReactNode;
  errorState: ReactNode;
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
}

const rowId = (head: TopicHead): string => head.key;
const SEARCH_MAX_LENGTH = 200;

/**
 * The Topics tab below 768 px (19-responsive-behavior.md section 6.7, WB-TPE-17): two line rows, each one button that
 * opens the topic's drawer. Line 1 is the topic (a topic under a parent by its path) and its mention rate, the average
 * of the engines shown; line 2 the engine where it is best, with the answers behind that rate, and how many engines
 * show a rate. The List and the By engine view are this one list. The topics come highest mention rate first, the
 * topics under a parent after it; the sort menu orders them by one column.
 */
export function TopicsMobileList({
  heads,
  engines,
  status,
  search,
  onSearchChange,
  activeTopicKey,
  onOpenTopic,
  onTopicOrderChange,
  toolbarEnd,
  errorState,
  emptyState,
  filteredEmptyState,
}: TopicsMobileListProps): ReactElement {
  const t = useTranslations('prompts');
  const view = useTranslations('prompts.topicDrawer.byEngineView');
  const compare = useTranslations('prompts.topicDrawer.compare');
  const table = useTranslations('dataTable');
  // Nothing sorts until the person picks a column: the rows keep the order above, children after their parent
  const [sort, setSort] = useState<readonly SortKey[]>([]);
  const codes = useMemo(() => engines.map(({ engine }) => engine.engine_code), [engines]);
  const rows = useMemo(
    () => heatOrder(heads, 'avg_rate', 'mentioned', codes).flatMap((head) => [head, ...head.children]),
    [heads, codes],
  );
  const averageOf = useMemo(
    () => (head: TopicHead) =>
      averageRate(codes.map((code) => head.engines.find((cell) => cell.engine_code === code)?.mentioned)),
    [codes],
  );
  const columns = useMemo(
    (): DataTableColumn<TopicHead>[] => [
      col.keyword<TopicHead>('topic', (head) => head.path, { header: t('topics.topic') }),
      col.volumeTrend<TopicHead>('mention', (head) => averageOf(head).value, {
        header: t('columns.mentionRate'),
        known: () => null,
      }),
      col.count<TopicHead>('prompts', (head) => head.promptCount, { header: t('topics.prompts') }),
    ],
    [t, averageOf],
  );
  const percent = (value: number): string => formatPercent(value, { decimals: 0 });
  const labelOf = (code: string): string =>
    engines.find(({ engine }) => engine.engine_code === code)?.engine.label ?? code;

  const line1 = (head: TopicHead): ListLine1 => {
    const average = averageOf(head);
    return {
      identity: head.path,
      // Spoken before the value: the average says how many engines took part, and none when no engine has a rate
      valueLabel: view('listAvgRate', { metric: t('columns.mentionRate'), count: average.engines }),
      value:
        average.state === 'ok' && average.value !== null ? (
          percent(average.value)
        ) : average.state === 'insufficient' ? (
          <InsufficientPill answers={average.answers} tip={false} />
        ) : (
          <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>
        ),
    };
  };
  const line2 = (head: TopicHead): ListLine2 => {
    const { best, engines: rated } = topicListLines(head, engines);
    if (best !== null) {
      const basis =
        best.successes === null
          ? t('rate.basisAnswers', { answers: best.answers })
          : t('rate.basis', { successes: best.successes, answers: best.answers });
      return {
        context: view('listContext', {
          engine: labelOf(best.code),
          rate: view('listRate', { rate: percent(best.value), basis }),
          count: rated,
        }),
        delta: null,
      };
    }
    // Engines that show a rate of 0 are no best engine: nobody names the brand there
    return { context: rated > 0 ? compare('zero') : view('listNone'), delta: null };
  };

  return (
    <DataTableList<TopicHead>
      caption={t('topics.caption')}
      itemNoun={{ one: t('topics.noun.one'), other: t('topics.noun.other') }}
      columns={columns}
      rows={rows}
      total={rows.length}
      getRowId={rowId}
      sort={sort}
      // The rows are searched already, by name and by the text of their prompts
      search=""
      line1={line1}
      line2={line2}
      onRowOpen={(head) => onOpenTopic(head.key)}
      activeRowId={activeTopicKey}
      onRowOrderChange={onTopicOrderChange}
      status={status}
      errorState={errorState}
      emptyState={emptyState}
      filteredEmptyState={filteredEmptyState}
      toolbar={
        <>
          <InputGroup leadingIcon={Search} size="sm" className="w-full min-w-0">
            <Input
              size="sm"
              // The group draws the border and the focus ring, so the field inside draws neither
              variant="bare"
              type="search"
              value={search}
              // The field also passes the event details, which the caller's callback does not take
              onValueChange={(next) => onSearchChange(next)}
              placeholder={t('topics.search')}
              maxLength={SEARCH_MAX_LENGTH}
              aria-label={table('search')}
            />
          </InputGroup>
          <DataTableListSort columns={columns} sort={sort} onSortChange={setSort} />
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1">{toolbarEnd}</div>
        </>
      }
    />
  );
}
