'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, type ReactElement } from 'react';

import { ChangesPanel, PageButton } from './changes-panel';
import { rangeOf, nextOffset, useOffsetPaging } from './offset-paging';
import { LinksDropped } from '../links-dropped';
import type { LinksTabContext } from '../tabs';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu } from '@/components/ui/menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Truncate } from '@/components/ui/truncate';
import { TableFooter } from '@/components/app/data-table/table-footer';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger } from '@/lib/format';
import { priorityTone } from '@/lib/internal-links/changes-format';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { changeLinksQuery, isChangeLinkPage } from '@/lib/internal-links/queries';
import { PLACEMENT_KEY } from '@/lib/internal-links/scopes';
import type { ChangeKind, ChangeLink, ChangeLinkPage, ChangeOnly, ChangeScope } from '@/lib/internal-links/types';
import { reasonOf } from '@/lib/internal-links/problem-reason';

const SCOPES: readonly ChangeScope[] = ['editorial', 'all'];
const PRIORITY_KEY = { lost_to_t1: 'lostToT1', lost_to_t2: 'lostToT2', lower: 'lower' } as const;
const PAGE_SIZES = [100, 200] as const;

/** The answer as a page of changed links (its generated type is `unknown`, see `isChangeLinkPage`). */
function readLinks(data: unknown): ChangeLinkPage {
  if (isChangeLinkPage(data)) return data;
  throw new Error('The changes answer is not a page of links');
}

export interface ChangeLinksPanelProps {
  context: LinksTabContext;
  change: ChangeKind;
  onChange: (change: ChangeKind) => void;
  linkScope: ChangeScope;
  /** What the table asks for: the important tiers only, or every link. */
  only: ChangeOnly;
  onOnlyChange: (only: ChangeOnly) => void;
  /** "T1 and T2". */
  tiers: string;
  /** "7 Nov", or "none" when the previous crawl has no date. */
  date: string;
}

/**
 * The links the crawl lost or gained against the previous one (mock `linksPanel`), one table with a Lost and Added
 * switch, the link scope, and for lost links the filter to the important tiers. One row per source and target page.
 * No equity column: the API's equity figures are not read.
 */
export function ChangeLinksPanel({
  context,
  change,
  onChange,
  linkScope,
  only,
  onOnlyChange,
  tiers,
  date,
}: ChangeLinksPanelProps): ReactElement {
  const t = useTranslations('internalLinks');
  const c = useTranslations('internalLinks.changes');
  const common = useTranslations('common');
  const switchId = useId();
  const lost = change === 'lost';
  const chosenRun = context.crawl.run;
  const paging = useOffsetPaging(JSON.stringify([change, linkScope, only, chosenRun]));
  const read = useQuery({
    ...changeLinksQuery(
      context.scope,
      { change, linkScope, only, offset: paging.offset, limit: paging.size },
      chosenRun,
    ),
    placeholderData: keepPreviousData,
    select: readLinks,
  });
  const rows = read.data?.data ?? [];
  const total = read.data?.meta.total ?? 0;
  const settled = !read.isPlaceholderData;
  // A list that shrank under a later page (a crawl ended) starts again at the first page
  const { reset } = paging;
  const stale = settled && read.isSuccess && rows.length === 0 && paging.offset > 0;
  useEffect(() => {
    if (stale) reset();
  }, [stale, reset]);

  const kind = linkScope === 'all' ? c('kindAll') : c('kindEditorial');
  const kindLower = linkScope === 'all' ? c('kindLowerAll') : c('kindLowerEditorial');
  const open = (urlId: string) => () => context.inspect.open(urlId);
  const placement = (value: ChangeLink['placement']): string => t(`placement.${PLACEMENT_KEY[value]}`);
  const priorityLabel = (priority: Exclude<ChangeLink['priority'], 'none'>): string =>
    c(`priority.${PRIORITY_KEY[priority]}`);
  const columns: PlainColumn<ChangeLink>[] = [
    {
      id: 'source',
      header: c('columns.source'),
      cell: (row) => <PageButton path={row.source.path} onOpen={open(row.source.url_id)} />,
    },
    { id: 'sourceTier', header: c('columns.sourceTier'), cell: (row) => <TierBadge tier={row.source.tier} /> },
    {
      id: 'target',
      header: c('columns.target'),
      cell: (row) => <PageButton path={row.target.path} onOpen={open(row.target.url_id)} />,
    },
    { id: 'targetTier', header: c('columns.targetTier'), cell: (row) => <TierBadge tier={row.target.tier} /> },
    {
      id: 'anchor',
      header: c('columns.anchor'),
      cell: (row) =>
        row.anchor === '' ? (
          <span className="type-table text-foreground-tertiary">{c('noAnchor')}</span>
        ) : (
          <Truncate text={c('anchorQuoted', { anchor: row.anchor })} className="max-w-64 type-table text-foreground" />
        ),
    },
    { id: 'linkType', header: c('columns.linkType'), cell: (row) => placement(row.placement) },
    ...(lost
      ? [
          {
            id: 'priority',
            header: c('columns.priority'),
            cell: (row: ChangeLink) =>
              row.priority === 'none' ? null : (
                <Badge tone={priorityTone(row.priority, row.still_linked_by)}>{priorityLabel(row.priority)}</Badge>
              ),
          },
          {
            id: 'stillLinked',
            header: c('columns.stillLinked'),
            cell: (row: ChangeLink) =>
              row.still_linked_by === null ? (
                <span className="text-negative-text">{c('noLonger')}</span>
              ) : (
                c('stillLinked', { placement: placement(row.still_linked_by) })
              ),
          },
        ]
      : []),
  ];

  const dropped = isLinksDropped(read.error);
  const range = rangeOf(paging.offset, rows.length, total);
  const rangeText = c('range', {
    from: formatInteger(range.from),
    to: formatInteger(range.to),
    total: formatInteger(range.total),
  });
  const emptyText =
    change === 'added'
      ? c('emptyAdded', { kind: kindLower })
      : only === 'top'
        ? c('emptyLostTop', { tiers })
        : c('emptyLost', { kind: kindLower });
  const title = lost ? c('lostTitle') : c('addedTitle');
  const status = read.isError && read.data === undefined ? 'error' : read.isPending ? 'loading' : 'ready';
  const showAll = lost && only === 'top' && status === 'ready' && rows.length === 0;
  const hasNext = settled && nextOffset(paging.offset, paging.size, total) !== null;
  // The API takes no offset past MAX_OFFSET: the last reachable page of a longer list says so
  const capped = settled && rows.length > 0 && !hasNext && paging.offset + rows.length < total;
  // Identical lost links are all kept; the index keeps their keys apart
  const keys = new Map(
    rows.map((row, index) => [
      row,
      [index, row.source.url_id, row.target.url_id, row.placement, row.anchor, row.still_linked_by ?? ''].join('|'),
    ]),
  );

  return (
    <ChangesPanel
      id="il-changes-links-title"
      title={title}
      meta={lost ? c('lostMeta', { kind, date }) : c('addedMeta', { kind, date })}
      controls={
        <>
          <SegmentedControl
            semantics="view"
            size="sm"
            label={c('changeLabel')}
            value={change}
            onValueChange={onChange}
            items={[
              { value: 'lost', label: c('lost') },
              { value: 'added', label: c('added') },
            ]}
          />
          <Menu
            trigger={
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('scope.menuName', { scope: t(linkScope === 'all' ? 'scope.all' : 'scope.editorial') })}
              >
                {t('scope.chip', { scope: t(linkScope === 'all' ? 'scope.all' : 'scope.editorial') })}
                <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
              </Button>
            }
            items={SCOPES.map((value) => ({
              id: value,
              kind: 'radio' as const,
              label: t(value === 'all' ? 'scope.all' : 'scope.editorial'),
              checked: value === linkScope,
              onSelect: () => context.setSearch({ cs: value === 'editorial' ? null : value }),
            }))}
          />
          {lost ? (
            <span className="flex items-center gap-2">
              <Switch
                aria-labelledby={switchId}
                checked={only === 'top'}
                onCheckedChange={(checked) => onOnlyChange(checked ? 'top' : 'all')}
              />
              <span id={switchId} className="type-body">
                {c('onlyTop', { tiers })}
              </span>
            </span>
          ) : null}
        </>
      }
    >
      {dropped ? (
        <LinksDropped />
      ) : (
        <>
          {/* The rows of the last page stay while the next loads: dimmed and marked busy */}
          <div aria-busy={read.isPlaceholderData} className={read.isPlaceholderData ? 'opacity-60' : undefined}>
            <PlainTable<ChangeLink>
              caption={title}
              columns={columns}
              rows={rows}
              rowKey={(row) => keys.get(row) ?? ''}
              status={status}
              skeletonRows={6}
              emptyText={emptyText}
              errorState={
                <InlineError
                  title={lost ? c('lostLoadFailed') : c('addedLoadFailed')}
                  reason={
                    isApiProblem(read.error) ? reasonOf(read.error) || c('loadFailedReason') : c('loadFailedReason')
                  }
                  errorId={null}
                  onRetry={() => void read.refetch()}
                  retrying={read.isFetching}
                  retryLabel={common('retry')}
                />
              }
            />
          </div>
          {showAll ? (
            <div>
              <Button variant="secondary" size="sm" onClick={() => onOnlyChange('all')}>
                {c('showAllButton')}
              </Button>
            </div>
          ) : null}
          {read.data?.meta.truncated === true ? (
            <p className="type-meta text-foreground-secondary">{c('truncated')}</p>
          ) : null}
          {capped ? <p className="type-meta text-foreground-secondary">{c('pagingLimit')}</p> : null}
          {status === 'ready' && (total > PAGE_SIZES[0] || paging.offset > 0) ? (
            // The footer brings its own top border, so the frame leaves its top edge to it
            <div className="rounded-lg border border-border bg-surface *:border-t-0">
              <TableFooter
                countText={rangeText}
                server={{
                  rangeText,
                  offset: paging.offset,
                  hasPrevious: settled && paging.offset > 0,
                  hasNext,
                  onPrevious: paging.previous,
                  onNext: () => paging.next(total),
                  pageSize: paging.size,
                  onPageSizeChange: paging.setSize,
                  pageSizes: PAGE_SIZES,
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </ChangesPanel>
  );
}
