'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactElement } from 'react';

import type { RecordAction } from './types';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/components/ui/tooltip';
import { formatInteger } from '@/lib/format';

export interface BulkActionBarProps<TRow> {
  selectedCount: number;
  /** Rows the filters match, when more exist than are loaded. */
  matchingTotal: number | null;
  allMatching: boolean;
  onAllMatchingChange: (allMatching: boolean) => void;
  /** Selected rows the search hides. */
  hiddenCount: number;
  actions: readonly RecordAction<TRow>[];
  selectedRows: readonly TRow[];
  onClear: () => void;
}

const ORDER: Readonly<Record<RecordAction<unknown>['group'], number>> = { open: 0, object: 1, copy: 2, destructive: 3 };

/**
 * Replaces the toolbar in place while rows are selected (12-tables.md section 14): the count, "Select all
 * N matching" when more rows match than are loaded, the actions with the destructive ones last and set
 * apart, and Clear. Destructive actions and actions on more than 100 rows confirm in the action itself.
 */
export function BulkActionBar<TRow>({
  selectedCount,
  matchingTotal,
  allMatching,
  onAllMatchingChange,
  hiddenCount,
  actions,
  selectedRows,
  onClear,
}: BulkActionBarProps<TRow>): ReactElement {
  const t = useTranslations('dataTable');
  const count = allMatching && matchingTotal !== null ? matchingTotal : selectedCount;
  const selectedText =
    allMatching && matchingTotal !== null
      ? t('allMatchingSelected', { count: formatInteger(matchingTotal) })
      : t('selected', { count: formatInteger(count) });
  const ordered = [...actions].sort((a, b) => ORDER[a.group] - ORDER[b.group]);
  const firstDestructive = ordered.findIndex((action) => action.group === 'destructive');
  return (
    <div
      role="group"
      aria-label={t('bulkActions', { selected: selectedText })}
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-selected px-3"
    >
      <p className="num type-body-strong">{selectedText}</p>
      {matchingTotal !== null && matchingTotal > selectedCount && !allMatching ? (
        <Button variant="link" size="sm" onClick={() => onAllMatchingChange(true)}>
          {t('selectAllMatching', { count: formatInteger(matchingTotal) })}
        </Button>
      ) : null}
      {hiddenCount > 0 ? <p className="type-meta">{t('hiddenSelected', { count: hiddenCount })}</p> : null}
      <div className="ml-auto flex items-center gap-2">
        {ordered.map((action, index) => (
          <Fragment key={action.id}>
            {index === firstDestructive && index > 0 ? <Separator orientation="vertical" className="my-3" /> : null}
            <ActionButton action={action} onSelect={() => action.onSelect(selectedRows)} />
          </Fragment>
        ))}
        <IconButton icon={X} variant="ghost" label={t('clearSelection')} onClick={onClear} />
      </div>
    </div>
  );
}

/** A bulk action; a disabled one stays focusable and says why (08-interaction-states.md section 1). */
function ActionButton<TRow>({ action, onSelect }: { action: RecordAction<TRow>; onSelect: () => void }): ReactElement {
  const reason = action.disabledReason ?? null;
  const button = (
    <Button
      size="sm"
      variant={action.group === 'destructive' ? 'destructive' : 'secondary'}
      icon={action.icon}
      disabled={reason !== null}
      focusableWhenDisabled
      onClick={onSelect}
    >
      {action.label}
    </Button>
  );
  return reason === null ? button : <Tooltip content={reason}>{button}</Tooltip>;
}
