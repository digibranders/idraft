'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, type ReactElement, type ReactNode } from 'react';

import { useCheckWords } from './check-words';
import { CELL, HeaderCell, NotApplicable, SEVERITY_TONE } from './checks-table';
import { useFileExport } from './use-file-export';
import { useResultAnnouncement } from './use-result-announcement';
import { LinksDropped } from '../links-dropped';
import { SkeletonRows } from '../crawl-states';
import { pageRange, useCursorPaging } from '../pages/cursor-paging';
import { useSearchDraft } from '../pages/search-draft';
import { StatusBadge } from '../status-badge';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';
import { downloadApiFile } from '@/lib/api/download';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger, formatTableDate } from '@/lib/format';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { isPageRowPage } from '@/lib/internal-links/queries';
import type { LinksScope, PageRow, PageRowPage, PageSort } from '@/lib/internal-links/types';
import { detailMessage } from '@/lib/issues/detail';
import { ISSUE_PAGE_LIMIT, issuePagesCsv, issuePagesQuery } from '@/lib/issues/queries';
import { idKey, type IssueCheck, type IssueGsc } from '@/lib/issues/types';
import { SEARCH_DELAY_MS, SEARCH_MAX_LENGTH, type IssuesState } from '@/lib/issues/url-state';
import { cn } from '@/lib/utils';
import type { SetIssuesSearch } from './use-issues-state';

/** One empty list for every render, so the effects that read the rows do not see new ones while nothing has loaded. */
const NO_ROWS: readonly PageRow[] = [];
const EXPORT_NAME = 'issue-pages.csv';
const ANNOUNCE_KEY = 'issues-pages-results';

/** The page button of a row, found by the url id it carries. */
function pageButtonOf(region: HTMLElement | null, urlId: string): HTMLElement | null {
  const buttons = Array.from(region?.querySelectorAll<HTMLElement>('[data-url-id]') ?? []);
  return buttons.find((button) => button.dataset.urlId === urlId) ?? null;
}

/** The answer as a page of rows (its generated type is `unknown`, see `isPageRowPage`). */
function readPage(data: unknown): PageRowPage {
  if (isPageRowPage(data)) return data;
  throw new Error('The pages answer is not a page of rows');
}

export interface CheckViewProps {
  /** A check that ran. */
  check: IssueCheck;
  scope: LinksScope;
  /** The part of the address the open check owns: the search as typed and the sort. */
  state: Pick<IssuesState, 'q' | 'sort'>;
  setSearch: SetIssuesSearch;
  /** Search Console as the list's meta reports it: decides the default sort. */
  gsc: IssueGsc['state'];
  /** When the crawl was made, for the footer. */
  crawledAt: string | null;
  timeZone: string;
  /** The url id of the page the inspector shows, for the row it marks. */
  activeUrlId: string | null;
  /** Back to the list: clears the check, the search and the sort from the address. */
  onBack: () => void;
  onOpenPage: (urlId: string) => void;
  /** The url ids on screen in order, for the inspector's "3 of 50" and its J and K. */
  onOrderChange: (urlIds: readonly string[]) => void;
}

/**
 * One open check (spec 7.3): a bar, two short lines and the table of the pages the check found, in one panel. The
 * pages are the work, so nothing else stands between the top of the page and the first row. The server searches,
 * sorts and pages (cursors, 50 rows a page).
 */
export function CheckView({
  check,
  scope,
  state,
  setSearch,
  gsc,
  crawledAt,
  timeZone,
  activeUrlId,
  onBack,
  onOpenPage,
  onOrderChange,
}: CheckViewProps): ReactElement {
  const t = useTranslations('issues');
  const c = useTranslations('issues.check');
  const common = useTranslations('common');
  const words = useCheckWords();
  const headingId = useId();
  const name = words.nameOf(check);
  const sort: PageSort = state.sort ?? (gsc === 'ok' ? '-clicks' : 'path');
  const search = state.q.trim();
  const selection = { check: check.id, q: state.q, sort };

  // A new query starts again at the first page
  const paging = useCursorPaging(JSON.stringify([check.id, search, sort]));
  const read = useQuery({
    ...issuePagesQuery(scope, { ...selection, cursor: paging.cursor }),
    placeholderData: keepPreviousData,
    // An answer that is not a page of rows is a failed read, shown as one
    select: readPage,
  });
  const rows = read.data?.data ?? NO_ROWS;
  const total = read.data?.meta.total ?? 0;
  const settled = !read.isPlaceholderData;
  const failed = read.isError && read.data === undefined;
  const range = pageRange({ pageIndex: paging.pageIndex, rows: rows.length, limit: ISSUE_PAGE_LIMIT });
  // A cursor belongs to one crawl: a crawl that ends while a later page is open makes the API refuse the old cursor
  const { reset: startAgain, noteRun } = paging;
  const refused = isApiProblem(read.error, 'invalid_cursor');
  useEffect(() => {
    if (refused) startAgain();
  }, [refused, startAgain]);
  const run = read.data?.meta.run_id ?? null;
  useEffect(() => {
    noteRun(run);
  }, [run, noteRun]);

  // Leaving the check takes its rows with it: the inspector must not step through a list that is not on screen
  const order = useMemo(() => rows.map((row) => row.url_id), [rows]);
  useEffect(() => {
    onOrderChange(order);
    return () => onOrderChange([]);
  }, [order, onOrderChange]);

  // The box keeps what is typed; the address and so the request follow once typing pauses
  const { draft, setDraft } = useSearchDraft(state.q === '' ? null : state.q, (q) => setSearch({ q }), SEARCH_DELAY_MS);

  // The file holds what the box shows, even before the pause that writes the address
  const file = useFileExport();
  const onExport = (): void => {
    const { path, query } = issuePagesCsv(scope, { check: check.id, q: draft.trim(), sort, cursor: null }, null);
    file.start(() => downloadApiFile(path, query, EXPORT_NAME));
  };

  // How many pages match is said once the search settles, for the answer to the search on screen only
  useResultAnnouncement(
    failed || read.isPending || !settled
      ? null
      : total === 0
        ? t('announce.pagesNone')
        : t('announce.pagesShowing', { count: total, formatted: formatInteger(total) }),
    ANNOUNCE_KEY,
  );

  // The row of the open page stays in view as J and K step through the rows, and when a shared link's rows arrive
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (activeUrlId === null) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === activeUrlId) return;
    const row = pageButtonOf(bodyRef.current, activeUrlId)?.closest('tr');
    if (row === null || row === undefined) return;
    scrolledTo.current = activeUrlId;
    row.scrollIntoView({ block: 'nearest' });
  }, [activeUrlId, order]);

  // The inspector closed: focus returns to the page button of the row it showed, or to the title when the row is
  // gone (20 section 4.3, 16 section 2.8). Focus that already sits somewhere is left there.
  const lastActive = useRef(activeUrlId);
  useEffect(() => {
    const before = lastActive.current;
    lastActive.current = activeUrlId;
    if (activeUrlId !== null || before === null) return;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    (pageButtonOf(bodyRef.current, before) ?? titleRef.current)?.focus();
  }, [activeUrlId]);

  // A check that opens takes focus to its title, unless focus is already somewhere the person put it (the inspector
  // of a shared link)
  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) titleRef.current?.focus();
  }, []);

  let body: ReactNode;
  if (failed) {
    body = isLinksDropped(read.error) ? (
      <LinksDropped />
    ) : (
      <InlineError
        title={c('loadFailed')}
        reason={c('loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (read.isPending) {
    body = <SkeletonRows />;
  } else if (rows.length === 0) {
    body =
      search === '' ? (
        <EmptyState
          variant="table"
          title={c('noPages.title')}
          reason={c('noPages.hint')}
          headingLevel={3}
          primaryAction={
            <Button variant="secondary" size="sm" onClick={onBack}>
              {c('back')}
            </Button>
          }
        />
      ) : (
        <EmptyState
          variant="table"
          title={c('noMatch.title')}
          reason={c('noMatch.hint')}
          headingLevel={3}
          primaryAction={
            <Button variant="secondary" size="sm" onClick={() => setSearch({ q: null })}>
              {c('noMatch.clear')}
            </Button>
          }
        />
      );
  } else {
    body = (
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-max">
          <caption className="sr-only">{t('labels.pagesOfCheck', { name })}</caption>
          <thead className="bg-surface-subtle">
            <tr>
              <HeaderCell label={t('columns.page')} className="min-w-64" />
              <HeaderCell label={t('columns.found')} className="min-w-64" />
              <HeaderCell label={t('columns.clicks')} tip={t('tips.clicksPage')} />
              <HeaderCell label={t('columns.status')} />
              <HeaderCell label={t('columns.tier')} />
              <HeaderCell label={t('columns.linksIn')} tip={t('tips.linksIn')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PageLine
                key={row.url_id}
                row={row}
                check={check}
                active={row.url_id === activeUrlId}
                onOpen={onOpenPage}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-3 py-1.5">
        <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={onBack}>
          {c('back')}
        </Button>
        <h2
          ref={titleRef}
          id={headingId}
          tabIndex={-1}
          className="min-w-0 truncate type-subsection-title text-foreground outline-none"
        >
          {name}
        </h2>
        <Tooltip content={t(`severity.${check.severity}.tip`)}>
          <Badge tone={SEVERITY_TONE[check.severity]}>{t(`severity.${check.severity}.label`)}</Badge>
        </Tooltip>
        <Tooltip content={t(`foundBy.${check.found_by}.tip`)}>
          <Badge tone="neutral">{t('foundBy.badge', { name: t(`foundBy.${check.found_by}.label`) })}</Badge>
        </Tooltip>
        <InputGroup leadingIcon={Search} size="sm" className="w-64 max-w-full min-w-0">
          <Input
            size="sm"
            // The group draws the border and the focus ring, so the field inside draws neither
            variant="bare"
            type="search"
            value={draft}
            onValueChange={setDraft}
            placeholder={c('searchPages')}
            maxLength={SEARCH_MAX_LENGTH}
            aria-label={c('searchPages')}
          />
        </InputGroup>
        {failed ? null : (
          <Button
            className="ml-auto"
            variant="secondary"
            size="sm"
            icon={Download}
            loading={file.exporting}
            onClick={onExport}
          >
            {c('export')}
          </Button>
        )}
      </div>
      {/* The bar sits on the lower edge of these lines: the top of the table */}
      <div className="relative grid gap-x-8 gap-y-1 border-b border-border-subtle px-3 py-2 md:grid-cols-2">
        <RefetchBar active={read.isPlaceholderData} position="under-section-heading" />
        <p className="min-w-0 type-body text-foreground">
          <span className="type-body-strong">{c('labelled', { label: c('why') })}</span>{' '}
          {t(`checks.${idKey(check.id)}.why`)}
        </p>
        <p className="min-w-0 type-body text-foreground">
          <span className="type-body-strong">{c('labelled', { label: c('fix') })}</span>{' '}
          {t(`checks.${idKey(check.id)}.fix`)}
        </p>
      </div>
      <div ref={bodyRef} aria-busy={read.isPlaceholderData ? true : undefined}>
        {body}
      </div>
      {rows.length === 0 || failed ? null : (
        <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle px-3 py-2">
          <p className="num type-meta">
            {c('range', {
              from: formatInteger(range.from),
              to: formatInteger(range.to),
              count: total,
              total: formatInteger(total),
            })}
          </p>
          {crawledAt === null ? null : (
            <p className="type-meta">{c('crawlOf', { date: formatTableDate(crawledAt, timeZone) })}</p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <IconButton
              icon={ChevronLeft}
              variant="secondary"
              label={c('previousPage')}
              // Stays focusable when there is no page to go to, so pressing the last page's Next does not drop focus
              disabled={!settled || paging.pageIndex === 0}
              focusableWhenDisabled
              onClick={paging.previous}
            />
            <IconButton
              icon={ChevronRight}
              variant="secondary"
              label={c('nextPage')}
              disabled={!settled || !(read.data?.page.has_more ?? false)}
              focusableWhenDisabled
              onClick={() => {
                const next = read.data?.page.next_cursor;
                if (settled && next !== null && next !== undefined) paging.next(next);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function PageLine({
  row,
  check,
  active,
  onOpen,
}: {
  row: PageRow;
  check: IssueCheck;
  active: boolean;
  onOpen: (urlId: string) => void;
}): ReactElement {
  const t = useTranslations('issues');
  const found = detailMessage(check.id, { status: row.status_code, issue: row.extras?.issue ?? null });
  return (
    <tr
      className={cn(
        'h-row-compact cursor-pointer hover:bg-surface-hover',
        active ? 'bg-surface-selected' : 'bg-surface',
      )}
      aria-current={active ? 'true' : undefined}
      // The whole row takes the click; the button in the first cell is the keyboard's way in
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, a') === null) onOpen(row.url_id);
      }}
    >
      <th scope="row" className={cn(CELL, 'text-left font-normal')}>
        <button
          type="button"
          data-url-id={row.url_id}
          aria-label={t('check.openPage', { path: row.path })}
          onClick={() => onOpen(row.url_id)}
          className="flex max-w-full min-w-0 items-center rounded-sm text-left outline-none focus-visible:focus-ring"
        >
          <Truncate text={row.path} className="block max-w-sm font-mono type-table text-foreground" />
        </button>
      </th>
      <td className={cn(CELL, 'type-table text-foreground-secondary')}>
        {found === null ? (
          <NotApplicable reason={t('states.noDetail')} />
        ) : (
          <Truncate text={t(`found.${found.key}`, found.values)} className="block max-w-lg" />
        )}
      </td>
      <td className={CELL}>
        <ClicksCell gsc={row.extras?.gsc ?? null} />
      </td>
      <td className={CELL}>
        {row.status_code === 200 ? (
          <span className="num type-table text-foreground-secondary">200</span>
        ) : row.status_code === null ? (
          <NotApplicable reason={t('states.noStatus')} />
        ) : (
          <StatusBadge status={row.status_code} />
        )}
      </td>
      <td className={CELL}>
        <TierBadge tier={row.tier} />
      </td>
      <td className={cn(CELL, 'num type-table text-foreground')}>{formatInteger(row.linking_pages_all)}</td>
    </tr>
  );
}

/**
 * The clicks of a page; n/a with the reason when Search Console has no number for it. The real reasons are the two
 * states Search Console reports; no block, or a number that is not there in a state that has them, is neutral.
 */
function ClicksCell({ gsc }: { gsc: NonNullable<PageRow['extras']>['gsc'] | null }): ReactNode {
  const t = useTranslations('issues.states');
  if (gsc?.state === 'ok' && gsc.clicks !== null) {
    return (
      <span className={cn('num type-table', gsc.clicks > 0 ? 'text-foreground' : 'text-foreground-tertiary')}>
        {formatInteger(gsc.clicks)}
      </span>
    );
  }
  if (gsc?.state === 'not_connected') return <NotApplicable reason={t('gscNotConnected')} />;
  if (gsc?.state === 'pending') return <NotApplicable reason={t('gscPending')} />;
  return <NotApplicable reason={t('gscNoNumber')} />;
}
