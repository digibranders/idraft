'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { keepOpenRows, openRows } from './model/open-state';
import {
  changeLabel,
  headingText,
  historyDate,
  isExpandable,
  isNewPage,
  isTextSwap,
  versionChanges,
  type ChangeLabel,
  type HistoryChange,
  type HistoryVersion,
  type PageHistory,
} from './model/page-history';

type Translate = ReturnType<typeof useTranslations<'pageHistory'>>;

const KIND_LOOK = {
  content: 'bg-primary-subtle text-primary-text',
  site_wide: 'bg-surface-subtle text-foreground-secondary',
  first: 'bg-positive-subtle text-positive-text',
} as const;
const KIND_KEY = { content: 'content', site_wide: 'siteWide', first: 'first' } as const;

const labelText = (t: Translate, label: ChangeLabel): string =>
  'count' in label ? t(`change.${label.key}`, { count: label.count }) : t(`change.${label.key}`);

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

function ChangeRow({ change, t }: { change: HistoryChange; t: Translate }): ReactElement {
  const heading = headingText(change);
  const level = change.level;
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        {level === null ? null : (
          <span
            className={cn(
              'inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-sm type-label',
              change.type === 'heading_removed'
                ? 'bg-negative-subtle text-negative-text'
                : 'bg-positive-subtle text-positive-text',
            )}
          >
            <span aria-hidden="true">{`H${String(level)}`}</span>
            <span className="sr-only">{t('timeline.headingLevel', { level })}</span>
          </span>
        )}
        <span className="type-body-strong text-foreground">{labelText(t, changeLabel(change))}</span>
      </div>
      {heading === null ? null : (
        <span
          className={cn(
            'type-body break-words text-foreground-secondary',
            change.type === 'heading_removed' && 'line-through',
          )}
        >
          {heading}
        </span>
      )}
      {isTextSwap(change) ? (
        <>
          {change.before === null ? null : (
            <span className="type-body break-words text-foreground-tertiary">
              <span className="sr-only">{t('change.was')}</span>
              <del>{change.before}</del>
            </span>
          )}
          {change.after === null ? null : (
            <span className="type-body break-words text-foreground">
              <span className="sr-only">{t('change.now')}</span>
              <ins className="no-underline">{change.after}</ins>
            </span>
          )}
        </>
      ) : null}
    </li>
  );
}

function summaryOf(t: Translate, version: HistoryVersion, newPage: boolean): string {
  if (version.kind === 'site_wide') return t('timeline.siteWideSummary');
  if (version.kind === 'first') return t(newPage ? 'timeline.firstFound' : 'timeline.firstKept');
  const parts = versionChanges(version).map((change) => labelText(t, changeLabel(change)));
  return parts.map((part, index) => (index === 0 ? part : lowerFirst(part))).join(', ');
}

function Row({
  version,
  open,
  onToggle,
  newPage,
  timeZone,
  t,
}: {
  version: HistoryVersion;
  open: boolean;
  onToggle: () => void;
  newPage: boolean;
  timeZone: string;
  t: Translate;
}): ReactElement {
  const detailId = useId();
  const expandable = isExpandable(version);
  const headClass = 'flex w-full items-center gap-2 py-3 text-left';
  const content = (
    <>
      {expandable ? (
        <Icon icon={ChevronDown} size="sm" className={cn('shrink-0 text-foreground-tertiary', !open && '-rotate-90')} />
      ) : (
        <span className="size-icon-sm shrink-0" />
      )}
      <span className="w-24 shrink-0 num type-body-strong text-foreground">{historyDate(version.date, timeZone)}</span>
      <span
        className={cn(
          'inline-flex h-badge shrink-0 items-center rounded-sm px-1.5 type-label whitespace-nowrap',
          KIND_LOOK[version.kind],
        )}
      >
        {t(`timeline.${KIND_KEY[version.kind]}`)}
      </span>
      <span className="min-w-0 flex-1 truncate type-meta">{summaryOf(t, version, newPage)}</span>
    </>
  );
  return (
    <li className="flex shrink-0 flex-col border-b border-border-subtle last:border-b-0">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={onToggle}
          className={cn(headClass, 'hover:bg-surface-hover focus-visible:focus-ring-inset')}
        >
          {content}
        </button>
      ) : (
        <div className={headClass}>{content}</div>
      )}
      {version.kind === 'content' ? (
        <ul id={detailId} hidden={!open} className="flex flex-col gap-3 pb-3 pl-8">
          {versionChanges(version).map((change, index) => (
            <ChangeRow key={`${change.type}-${String(index)}`} change={change} t={t} />
          ))}
        </ul>
      ) : null}
      {version.kind === 'site_wide' ? (
        <p id={detailId} hidden={!open} className="pb-3 pl-8 type-meta">
          {t('timeline.siteWideNote')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The crawls of the page, newest first. The newest content change starts open; the rows a person opens are kept for
 * the page, so stepping to another page and back leaves them as they were (the parent keys this by page).
 */
export function HistoryTimeline({
  urlId,
  history,
  timeZone,
}: {
  urlId: string;
  history: PageHistory;
  timeZone: string;
}): ReactElement {
  const t = useTranslations('pageHistory');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => openRows(urlId, history.versions));
  const newPage = isNewPage(history);
  const toggle = (runId: string): void => {
    const next = new Set(open);
    if (!next.delete(runId)) next.add(runId);
    keepOpenRows(urlId, next);
    setOpen(next);
  };
  return (
    <>
      <ol aria-label={t('timeline.label')} className="flex shrink-0 flex-col">
        {history.versions.map((version) => (
          <Row
            key={version.run_id}
            version={version}
            open={open.has(version.run_id)}
            onToggle={() => toggle(version.run_id)}
            newPage={newPage}
            timeZone={timeZone}
            t={t}
          />
        ))}
      </ol>
      {history.versions_capped ? (
        <p className="type-meta">{t('timeline.capped', { count: history.versions.length })}</p>
      ) : null}
    </>
  );
}
