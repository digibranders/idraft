'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactElement, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { formatInteger } from '@/lib/format';

export interface FiltersSheetProps {
  /** How many filters differ from the default: the badge on the button, which is not drawn for none. */
  count: number;
  /** The scope controls, as the page draws them from 768 px. */
  children: ReactNode;
}

/**
 * Below 768 px the scope bar is one "Filters" button with the count of filters that differ, opening a full height
 * sheet with the same controls (19-responsive-behavior.md section 4). A choice takes effect at once, as it does on
 * the page, so Done only closes the sheet.
 * shortcut: the design system stages the changes and shows "Show N results"; the page refetches on every change,
 * so there is nothing to stage, revisit if the sheet ever needs a cheaper preview of a change.
 */
export function FiltersSheet({ count, children }: FiltersSheetProps): ReactElement {
  const t = useTranslations('aiOverview.scope');
  const titleId = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        aria-label={count === 0 ? t('filters') : t('filtersActive', { count })}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="self-start"
      >
        {t('filters')}
        {count === 0 ? null : <Badge>{formatInteger(count)}</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} aria-labelledby={titleId}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
          <h2 id={titleId} className="min-w-0 flex-1 type-section-title">
            {t('filters')}
          </h2>
          <IconButton icon={X} label={t('filtersClose')} onClick={() => setOpen(false)} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
        <div className="flex shrink-0 justify-end border-t border-border-subtle p-4">
          <Button variant="primary" onClick={() => setOpen(false)}>
            {t('filtersDone')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** A control of the sheet under its name, so the sheet reads as a list of settings. */
export function SheetRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-label text-foreground-secondary">{label}</p>
      <div className="flex">{children}</div>
    </div>
  );
}
