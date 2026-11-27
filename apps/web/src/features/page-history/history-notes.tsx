'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { historyDate, type PageHistory } from './model/page-history';

const TERMS = [
  ['lastEditedTerm', 'lastEdited'],
  ['lastChangeTerm', 'lastChange'],
  ['googleTerm', 'google'],
  ['unusedTerm', 'unused'],
] as const;

/** The folded note on how each date is read. */
export function HowDatesAreRead(): ReactElement {
  const t = useTranslations('pageHistory.howRead');
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-surface-hover focus-visible:focus-ring-inset"
        >
          <Icon
            icon={ChevronDown}
            size="sm"
            className={cn('shrink-0 text-foreground-tertiary', !open && '-rotate-90')}
          />
          <span className="type-body-strong text-foreground">{t('title')}</span>
        </button>
      </h3>
      <div id={bodyId} hidden={!open} className="border-t border-border-subtle px-3 py-3">
        <dl className="flex flex-col gap-2">
          {TERMS.map(([term, text]) => (
            <div key={term} className="flex flex-col gap-0.5">
              <dt className="type-label text-foreground-tertiary">{t(term)}</dt>
              <dd className="type-body text-foreground-secondary">{t(text)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const LIMITS = ['exact', 'scripts', 'login', 'rotating', 'sitemapDate'] as const;

/** Where the history starts, and what it cannot show. */
export function HistoryFooter({ history, timeZone }: { history: PageHistory; timeZone: string }): ReactElement {
  const t = useTranslations('pageHistory.footer');
  return (
    <div className="flex flex-col gap-2">
      <p className="type-meta">
        {history.history_starts === null
          ? t('startsNone')
          : t('starts', { date: historyDate(history.history_starts, timeZone) })}
      </p>
      <p className="type-label text-foreground-tertiary">{t('limitsTitle')}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 type-meta">
        {LIMITS.map((limit) => (
          <li key={limit}>{t(limit)}</li>
        ))}
      </ul>
    </div>
  );
}
