'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useCitedPages, type BoardEngine } from '../board-reads';
import { BoardPanel } from '../board-panel';
import { OWNERS, type Owner } from '../board-state';
import { updatedText, type PreviousText } from '../board-text';
import { pageColumns, pageIdentity } from './page-columns';
import { apiSort, ownerRole, PAGE_SORT_DEFAULT } from './page-rows';
import { PromptsPopover } from './prompts-popover';
import { PressedGroup } from '@/components/app/filters/pressed-group';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { BoardTable, BoardTableSkeleton, type BoardSort } from '@/components/app/table/board-table';
import { Button } from '@/components/ui/button';
import type { BoardScopeParams, CitedPageRow } from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatInteger } from '@/lib/format';

/** How long the search waits for the next keystroke before it asks the API. */
const SEARCH_DELAY_MS = 250;

export interface PagesTabProps {
  project: SourceScope;
  scope: BoardScopeParams;
  /** The engines are known and at least one is in scope; the read waits until then. */
  ready: boolean;
  /** The engines in scope, in code order. */
  engines: readonly BoardEngine[];
  owner: Owner;
  search: string;
  onOwnerChange: (owner: Owner) => void;
  onSearchChange: (search: string) => void;
  onResetScope: () => void;
  tabs: ReactNode;
  previous: PreviousText;
  /** "<platform>, <group>, <runs label>" (C 106). */
  scopeText: string;
  timeZone: string;
  activeId: string | null;
  /** Opens the page drawer, which starts on its Prompts tab; `opener` is where focus returns when it closes. */
  onOpen: (row: CitedPageRow, opener: HTMLElement | null) => void;
  /** The rows in the table's order, for the drawer's J and K and "i of n". */
  onOrderChange: (ids: readonly string[]) => void;
}

/**
 * Cited pages (C 410 to 571, D-6): the API sorts, searches and pages (200 rows a page, the next at the end of the
 * scroll); the owner filter's counts are the API's, whatever the filter and the search. Changing the owner resets
 * the sort (C 555).
 */
export function PagesTab(props: PagesTabProps): ReactElement {
  const t = useTranslations('citations');
  const { owner, search, engines, previous, timeZone, onOwnerChange, onOrderChange, onOpen } = props;
  const [sort, setSort] = useState<BoardSort>(PAGE_SORT_DEFAULT);
  const q = useDebouncedValue(search, SEARCH_DELAY_MS);
  const list = useMemo(() => ({ role: ownerRole(owner), q, sort: apiSort(sort) }), [owner, q, sort]);
  // Not before the engines are known: an empty engine list would mean every engine (D-4)
  const read = useCitedPages(props.project, props.scope, list, props.ready);
  const runWindow = read.meta?.window;
  const latest = runWindow?.latest_answer_at ?? null;

  useEffect(() => {
    onOrderChange(read.rows.map((row) => String(row.url_id)));
  }, [read.rows, onOrderChange]);

  const changeOwner = useCallback(
    (next: Owner): void => {
      setSort(PAGE_SORT_DEFAULT);
      onOwnerChange(next);
    },
    [onOwnerChange],
  );
  // The popover's foot opens the drawer from the row, so focus comes back to the row's button
  const openFromPopover = useCallback(
    (row: CitedPageRow): void =>
      onOpen(row, document.querySelector<HTMLElement>(`[data-id="${String(row.url_id)}"] button`)),
    [onOpen],
  );

  const trendSlots = runWindow?.trend.length ?? 8;
  const columns = useMemo(
    () =>
      pageColumns({
        t,
        owner,
        engines,
        previous,
        trendSlots,
        timeZone,
        latest,
        promptsPopover: (row, chip) => <PromptsPopover row={row} chip={chip} onDetails={() => openFromPopover(row)} />,
      }),
    [t, owner, engines, previous, trendSlots, timeZone, latest, openFromPopover],
  );

  const counts = read.meta?.owners;
  const controls = (
    <PressedGroup<Owner>
      label={t('pages.ownerLabel')}
      value={owner}
      onValueChange={changeOwner}
      items={OWNERS.map((value) => ({
        value,
        label: t(`pages.owners.${value}`),
        count:
          counts === undefined
            ? undefined
            : formatInteger(value === 'third' ? counts.third_party : value === 'all' ? counts.all : counts[value]),
      }))}
    />
  );

  const noun = owner === 'competitor' || owner === 'third' ? t(`pages.nouns.${owner}`) : null;
  let body: ReactNode;
  if (read.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} />;
  } else if (read.status === 'error') {
    body = (
      <InlineError
        title={t('board.loadFailedTitle')}
        reason={t('board.loadFailedReason')}
        errorId={read.errorId}
        onRetry={read.retry}
        retrying={read.retrying}
        retryLabel={t('board.retry')}
      />
    );
  } else if ((counts?.all ?? 0) === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('pages.emptyTitle')}
        reason={t('pages.emptyReason', { scope: props.scopeText })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={props.onResetScope}>
            {t('pages.resetScope')}
          </Button>
        }
      />
    );
  } else if (read.total === 0) {
    const searching = search !== '';
    let reason: string;
    if (searching) {
      if (owner === 'own') reason = t('pages.noMatchSearchOwn', { query: search });
      else if (noun === null) reason = t('pages.noMatchSearchAll', { query: search });
      else reason = t('pages.noMatchSearch', { noun, query: search });
    } else if (owner === 'own') {
      reason = t('pages.noMatchOwnerOwn', { scope: props.scopeText });
    } else {
      reason = t('pages.noMatchOwner', { noun: noun ?? '', scope: props.scopeText });
    }
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('pages.noMatchTitle')}
        reason={reason}
        primaryAction={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (searching) props.onSearchChange('');
              // Not changeOwner: only the owner group resets the sort (C 555), this link keeps it (C 568)
              else onOwnerChange('all');
            }}
          >
            {searching ? t('pages.clearSearch') : t('pages.showAll')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <BoardTable<CitedPageRow>
        caption={t('pages.caption')}
        columns={columns}
        rows={read.rows}
        rowId={(row) => String(row.url_id)}
        rowLabel={(row) => pageIdentity(row, t, previous).label}
        identityTip={(row) => pageIdentity(row, t, previous).tip}
        onOpen={onOpen}
        activeId={props.activeId}
        sort={sort}
        onSortChange={setSort}
        onEndReached={read.hasMore ? read.loadMore : undefined}
        busy={read.refetching || read.loadingMore}
      />
    );
  }

  return (
    <BoardPanel
      tabs={props.tabs}
      search={search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('board.searchPages')}
      controls={controls}
      refetching={read.refetching}
      footerText={
        read.total === null || read.meta === undefined
          ? null
          : t('pages.footer', { pages: read.total, citations: read.meta.citations })
      }
      updated={runWindow === undefined ? null : updatedText(runWindow, timeZone, t)}
    >
      {body}
    </BoardPanel>
  );
}
