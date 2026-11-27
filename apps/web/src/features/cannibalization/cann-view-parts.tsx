'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { viewsOf, type CannTab, type CannView } from './cann-model';
import type { CannRead } from './cann-reads';
import { PressedGroup } from '@/components/app/filters/pressed-group';
import type { BoardColumn, BoardResize } from '@/components/app/table/board-table';
import { widthsDiffer } from '@/components/app/table/board-widths';
import { useColumnWidths } from '@/components/app/table/use-column-widths';
import { InlineError } from '@/components/app/status/inline-error';
import { Icon } from '@/components/ui/icon';

/** The switch between the tab's tables: By keyword and By page pair, or Changes and By keyword. */
export function ViewSwitch({
  tab,
  view,
  onChange,
}: {
  tab: CannTab;
  view: CannView;
  onChange: (view: CannView) => void;
}): ReactElement {
  const t = useTranslations('cannibalization.views');
  return (
    <PressedGroup<CannView>
      label={t('label')}
      value={view}
      onValueChange={onChange}
      items={viewsOf(tab).map((value) => ({ value, label: t(value) }))}
    />
  );
}

/** What the table panel shows when its read failed. */
export function ReadError({ read }: { read: CannRead<unknown> }): ReactElement {
  const t = useTranslations('cannibalization.states');
  return (
    <InlineError
      title={t('loadFailedTitle')}
      reason={t('loadFailedReason')}
      errorId={read.errorId}
      onRetry={read.retry}
      retrying={read.retrying}
      retryLabel={t('retry')}
    />
  );
}

/** The chip of the page pair a By keyword table is narrowed to, with its clear button. */
export function PairChip({
  pair,
  onClear,
  label,
}: {
  pair: string;
  onClear: () => void;
  label: ReactNode;
}): ReactElement | null {
  const t = useTranslations('cannibalization.pairFilter');
  if (pair === '') return null;
  return (
    <span className="inline-flex h-badge items-center gap-1.5 rounded-sm border border-neutral-border bg-neutral-subtle pr-1 pl-2 type-micro text-neutral-text">
      <span>{label}</span>
      <button
        type="button"
        aria-label={t('clear')}
        onClick={onClear}
        className="flex size-4 items-center justify-center rounded-sm text-foreground-secondary outline-none hover:bg-surface-hover focus-visible:focus-ring"
      >
        <Icon icon={X} size="sm" />
      </button>
    </span>
  );
}

/** The adjustable widths of one table: what its BoardTable takes, and the reset the panel shows while any differ. */
export function useCannWidths(
  tableId: string,
  columns: readonly Pick<BoardColumn<unknown>, 'id' | 'width' | 'least' | 'widest'>[],
): { resize: BoardResize; onResetWidths: (() => void) | undefined } {
  const t = useTranslations('cannibalization.widths');
  const { widths, setWidth, reset } = useColumnWidths(`cannibalization-${tableId}`);
  const resize = useMemo(
    (): BoardResize => ({
      widths,
      onChange: setWidth,
      label: (column) => t('separator', { column }),
      valueText: (count) => t('value', { count }),
    }),
    [widths, setWidth, t],
  );
  return { resize, onResetWidths: widthsDiffer(columns, widths) ? reset : undefined };
}
