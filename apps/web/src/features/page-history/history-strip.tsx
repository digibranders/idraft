'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { historyDate, stripCells, type PageHistory, type StripCell, type StripNote } from './model/page-history';

type Translate = ReturnType<typeof useTranslations<'pageHistory'>>;

function noteText(t: Translate, note: StripNote): string {
  switch (note.key) {
    case 'editedFrom':
      return t('note.editedFrom', { origin: note.origin });
    case 'changeCount':
      return t('note.changeCount', { count: note.count });
    case 'changeSince':
    case 'firstStarts':
      return t(`note.${note.key}`, { date: note.date });
    default:
      return t(`note.${note.key}`);
  }
}

function Cell({ cell, t }: { cell: StripCell; t: Translate }): ReactElement {
  const empty = cell.date === null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-3 py-3">
      <dt className="truncate type-label text-foreground-tertiary">{t(`strip.${cell.id}`)}</dt>
      <dd
        className={cn(
          'num type-subsection-title',
          cell.warn ? 'text-warning-text' : empty ? 'text-foreground-tertiary' : 'text-foreground',
        )}
      >
        {cell.date ?? t('strip.none')}
      </dd>
      <dd className="type-micro text-foreground-tertiary">{noteText(t, cell.note)}</dd>
    </div>
  );
}

/** The four dates of the page, and the warning when Google has not crawled the page since its last change. */
export function HistoryStrip({ history, timeZone }: { history: PageHistory; timeZone: string }): ReactElement {
  const t = useTranslations('pageHistory');
  const crawled = history.google?.behind === true ? history.google.crawled_at : null;
  return (
    <>
      {/* The drawer is 360 to 640 px wide whatever the window is, so the columns follow the drawer, not the window */}
      <div className="@container shrink-0">
        <dl
          aria-label={t('strip.label')}
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border-subtle @lg:grid-cols-4"
        >
          {stripCells(history, timeZone).map((cell) => (
            <Cell key={cell.id} cell={cell} t={t} />
          ))}
        </dl>
      </div>
      {crawled !== null && history.last_change !== null ? (
        <div className="flex shrink-0 items-start gap-2 rounded-md bg-warning-subtle px-3 py-2">
          <Icon icon={TriangleAlert} size="sm" className="mt-0.5 shrink-0 text-warning-text" />
          <p className="min-w-0 flex-1 type-body text-foreground">
            {t('behind', {
              crawled: historyDate(crawled, timeZone),
              changed: historyDate(history.last_change, timeZone),
            })}
          </p>
        </div>
      ) : null}
    </>
  );
}
