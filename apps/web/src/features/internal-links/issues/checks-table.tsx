'use client';

import { ChevronRight, CircleCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { useCheckWords } from './check-words';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';
import { formatInteger, formatPercent } from '@/lib/format';
import { groupByCategory } from '@/lib/issues/rows';
import type { CheckId, IssueCheck, IssueGsc, Severity } from '@/lib/issues/types';
import { cn } from '@/lib/utils';

const SEVERITY_TONE = { error: 'negative', warning: 'warning', notice: 'neutral' } as const satisfies Record<
  Severity,
  'negative' | 'warning' | 'neutral'
>;

const COLUMN_COUNT = 7;
const TAB_STOP = { tabIndex: 0 };
const CELL = 'border-t border-border-subtle px-3 first:px-4 last:px-4';
const HEAD = 'h-row-header px-3 text-left type-table-header whitespace-nowrap first:px-4 last:px-4';
/** The names of the checks are the main thing on the page: bold and in the main text colour on every row. */
const NAME = 'block truncate type-body-strong text-foreground';

export interface ChecksTableProps {
  /** The checks to draw, filtered and in order (`visibleChecks`). */
  checks: readonly IssueCheck[];
  /** Every address of the crawl, for the share of pages a check found. */
  pagesCrawled: number;
  /** Search Console as the list's meta reports it: why a Clicks figure is missing. */
  gsc: IssueGsc['state'];
  /** Where Search Console is connected. */
  integrationsHref: Route;
  /** Names the table for assistive technology. */
  caption: string;
  onOpen: (id: CheckId) => void;
}

/**
 * The checks of one tab (spec 7.2), one block per category under a header row. A check that ran opens its pages,
 * passed or not; one that did not run says why in its Pages cell and does not open. The list is short and grouped, so
 * it is its own table and not a `DataTable`, as the tier flow and the journey list are.
 */
export function ChecksTable({
  checks,
  pagesCrawled,
  gsc,
  integrationsHref,
  caption,
  onOpen,
}: ChecksTableProps): ReactElement {
  const t = useTranslations('issues');
  const words = useCheckWords();
  const header = (label: string, tip?: string): ReactElement => {
    const cell = (
      <th scope="col" className={HEAD}>
        {label}
      </th>
    );
    return tip === undefined ? (
      cell
    ) : (
      <Tooltip content={tip} side="bottom">
        {cell}
      </Tooltip>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle">
          <tr>
            <th scope="col" className={cn(HEAD, 'min-w-72')}>
              {t('columns.issue')}
            </th>
            {header(t('columns.severity'))}
            {header(t('columns.foundBy'), t('tips.foundBy'))}
            {header(t('columns.pages'), t('tips.pages'))}
            {header(t('columns.clicks'), t('tips.clicks'))}
            {header(t('columns.example'))}
            <th scope="col" className={HEAD}>
              <span className="sr-only">{t('columns.open')}</span>
            </th>
          </tr>
        </thead>
        {groupByCategory(checks).map((group) => (
          <tbody key={group.category}>
            <tr className="h-row-compact">
              <th
                scope="rowgroup"
                colSpan={COLUMN_COUNT}
                className="border-t border-border-subtle bg-surface-subtle px-4 text-left align-middle type-body-strong text-foreground"
              >
                {words.categoryOf(group.category)}
              </th>
            </tr>
            {group.checks.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                name={words.nameOf(check)}
                pagesCrawled={pagesCrawled}
                gsc={gsc}
                integrationsHref={integrationsHref}
                onOpen={onOpen}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

interface CheckRowProps {
  check: IssueCheck;
  name: string;
  pagesCrawled: number;
  gsc: IssueGsc['state'];
  integrationsHref: Route;
  onOpen: (id: CheckId) => void;
}

function CheckRow({ check, name, pagesCrawled, gsc, integrationsHref, onOpen }: CheckRowProps): ReactElement {
  const t = useTranslations('issues');
  const opens = check.state === 'ran';
  const found = check.pages !== null && check.pages > 0;
  return (
    <tr
      className={cn('h-row bg-surface', opens && 'cursor-pointer hover:bg-surface-hover')}
      // The whole row takes the click; the button in the first cell is the keyboard's way in
      onClick={
        opens
          ? (event) => {
              if (event.target instanceof Element && event.target.closest('button, a') === null) onOpen(check.id);
            }
          : undefined
      }
    >
      <td className={CELL}>
        {opens ? (
          <button
            type="button"
            aria-label={t('list.open', { name })}
            onClick={() => onOpen(check.id)}
            className="flex max-w-full min-w-0 items-center rounded-sm text-left outline-none focus-visible:focus-ring"
          >
            <span className={NAME}>{name}</span>
          </button>
        ) : (
          <span className={NAME}>{name}</span>
        )}
      </td>
      <td className={CELL}>
        <Tooltip content={t(`severity.${check.severity}.tip`)}>
          <Badge tone={SEVERITY_TONE[check.severity]}>{t(`severity.${check.severity}.label`)}</Badge>
        </Tooltip>
      </td>
      <td className={cn(CELL, 'type-table text-foreground-secondary')}>
        <Tooltip content={t(`foundBy.${check.found_by}.tip`)}>
          <span className="block truncate">{t(`foundBy.${check.found_by}.label`)}</span>
        </Tooltip>
      </td>
      <td className={CELL}>
        <PagesCell check={check} pagesCrawled={pagesCrawled} integrationsHref={integrationsHref} />
      </td>
      <td className={CELL}>
        <ClicksCell clicks={check.clicks} gsc={gsc} />
      </td>
      <td className={cn(CELL, 'type-table text-foreground-secondary')}>
        {found && check.example_path !== null ? (
          <Truncate text={check.example_path} className="block max-w-xs" />
        ) : (
          <NotApplicable />
        )}
      </td>
      <td className={cn(CELL, 'text-foreground-tertiary')}>{opens ? <Icon icon={ChevronRight} size="sm" /> : null}</td>
    </tr>
  );
}

/** n/a in the tertiary colour; with a reason it is a tab stop, so the keyboard reads the reason too. */
function NotApplicable({ reason }: { reason?: string | undefined }): ReactElement {
  const t = useTranslations('issues.states');
  const text = <span className="num type-table text-foreground-tertiary">{t('na')}</span>;
  if (reason === undefined) return text;
  return (
    <Tooltip content={reason}>
      <span
        // The reason is in a tooltip, so the figure is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why
        {...TAB_STOP}
        className="rounded-sm num type-table text-foreground-tertiary outline-none focus-visible:focus-ring-inset"
      >
        {t('na')}
      </span>
    </Tooltip>
  );
}

function PagesCell({
  check,
  pagesCrawled,
  integrationsHref,
}: {
  check: IssueCheck;
  pagesCrawled: number;
  integrationsHref: Route;
}): ReactNode {
  const t = useTranslations('issues');
  if (check.state === 'ran') {
    const pages = check.pages ?? 0;
    if (pages === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 type-table text-foreground-secondary">
          <Icon icon={CircleCheck} size="sm" className="text-positive-text" />
          {t('states.passed')}
        </span>
      );
    }
    const ratio = pagesCrawled > 0 ? pages / pagesCrawled : null;
    return (
      <Tooltip
        content={
          ratio === null
            ? ''
            : t('tips.pagesShare', {
                share: formatPercent(ratio, { decimals: ratio < 0.005 ? 1 : 0 }),
                total: formatInteger(pagesCrawled),
              })
        }
        disabled={ratio === null}
      >
        <span className="num type-table-strong text-foreground">{formatInteger(pages)}</span>
      </Tooltip>
    );
  }
  switch (check.reason) {
    case 'source_not_connected':
      return (
        <span className="inline-flex items-center gap-2 type-table text-foreground-secondary">
          {t('states.notConnected')}
          <TextLink render={<Link href={integrationsHref} />}>{t('states.connectSearchConsole')}</TextLink>
        </span>
      );
    case 'not_collected':
      return <span className="type-table text-foreground-secondary">{t('states.notCollected')}</span>;
    case 'no_sitemap':
      return <NotApplicable reason={t('states.noSitemap')} />;
    case 'links_dropped':
      return <NotApplicable reason={t('states.linksDropped')} />;
    case null:
      return <NotApplicable />;
  }
}

function ClicksCell({ clicks, gsc }: { clicks: number | null; gsc: IssueGsc['state'] }): ReactNode {
  const t = useTranslations('issues.states');
  if (clicks !== null) {
    return (
      <span className={cn('num type-table', clicks > 0 ? 'text-foreground' : 'text-foreground-tertiary')}>
        {formatInteger(clicks)}
      </span>
    );
  }
  if (gsc === 'not_connected') return <NotApplicable reason={t('gscNotConnected')} />;
  if (gsc === 'pending') return <NotApplicable reason={t('gscPending')} />;
  return <NotApplicable />;
}
