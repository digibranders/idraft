'use client';

import { ChevronDown, ExternalLink, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { PageMark } from './cann-parts';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import type { CannKeyword } from '@/lib/api/types';
import { formatInteger, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PagesPopoverProps {
  row: CannKeyword;
  days: number;
  /** The cell's trigger content: the two page chips and the "+N". */
  summary: ReactElement;
  triggerLabel: string;
  /** Opens the keyword's evidence, on its Pages tab. */
  onDetails: () => void;
}

/**
 * Every page that ranks for a keyword, as a list a keyboard and a screen reader reach: the page's name, its address as
 * a link, its badges and its numbers (docs/33 section 7.2). Escape closes it and returns focus to the cell.
 */
export function PagesPopover({ row, days, summary, triggerLabel, onDetails }: PagesPopoverProps): ReactElement {
  const t = useTranslations('cannibalization.popover');
  const device = useTranslations('cannibalization.toolbar');
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      aria-label={t('label', { keyword: row.keyword })}
      width="wide"
      padding="none"
      align="start"
      trigger={
        <button
          type="button"
          data-cell-action=""
          aria-label={triggerLabel}
          className="-mx-1 flex w-full min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-left outline-none hover:bg-surface-hover focus-visible:focus-ring"
        >
          {summary}
          <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary" />
        </button>
      }
      footer={
        <div className="w-full px-3 py-2">
          <button
            type="button"
            className="rounded-sm type-body text-link outline-none hover:underline focus-visible:focus-ring"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            {t('details')}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-0.5 border-b border-border-subtle px-3 pt-3 pb-2">
        <span className="type-subsection-title">{t('head')}</span>
        <span className="type-meta">
          {t('meta', { keyword: row.keyword, device: device(row.device === 'mobile' ? 'mobile' : 'desktop'), days })}
        </span>
      </div>
      <ul className="max-h-80 overflow-y-auto py-1">
        {row.pages.map((page) => (
          <li key={page.url_id} className="flex gap-2 px-3 py-2">
            <PageMark letter={page.letter} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="type-body-strong text-foreground">{page.title ?? page.path}</span>
                {page.is_primary ? <Badge>{t('best')}</Badge> : null}
                {page.is_target ? <Badge icon={Target}>{t('target')}</Badge> : null}
                {page.is_sub_result ? <Badge>{t('subResult')}</Badge> : null}
              </span>
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('openPage', { path: page.path })}
                className={cn(
                  'inline-flex items-start gap-1 rounded-sm type-meta break-all text-link outline-none',
                  'hover:underline focus-visible:focus-ring',
                )}
              >
                <span>{page.path}</span>
                <Icon icon={ExternalLink} size="xs" className="mt-0.5 shrink-0" />
              </a>
              <span className="num type-meta">
                {t('numbers', {
                  share: formatPercent(page.share, { decimals: 0 }),
                  best: formatInteger(page.best_count),
                  median: formatInteger(Math.round(page.median)),
                })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
