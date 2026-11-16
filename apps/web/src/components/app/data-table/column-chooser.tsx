'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import { Popover } from '@/components/ui/popover';
import { announce } from '@/lib/a11y/announcer';
import { cn } from '@/lib/utils';

export interface ColumnChooserColumn {
  id: string;
  label: string;
  /** A mark drawn before the name (a platform's logo); hidden from assistive technology, the name stays `label`. */
  icon?: ReactNode;
  visible: boolean;
  /** The identity column: always shown, not movable. */
  locked: boolean;
}

/** The width of the identity column, which a person can set from here as well as by dragging its edge. */
export interface ColumnChooserWidth {
  /** The identity column's name, for "{column} column width". */
  column: string;
  atMin: boolean;
  atMax: boolean;
  /** No width of the person's own is set. */
  isDefault: boolean;
  onNarrower: () => void;
  onWider: () => void;
  onReset: () => void;
}

export interface ColumnChooserProps {
  trigger: ReactElement;
  /** Every column in the chosen order, the hidden ones after it. */
  columns: readonly ColumnChooserColumn[];
  onToggle: (id: string, visible: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onReset: () => void;
  /** Adds the Narrower, Wider and Reset row for the identity column; a table without one passes nothing. */
  width?: ColumnChooserWidth | undefined;
  /** The narrow popover (280 px) where the default takes the width of its content: the width row then wraps under its label. */
  compact?: boolean | undefined;
}

/**
 * Shows, hides and reorders a table's columns (12-tables.md section 10): a checkbox per column, Move up and
 * Move down on the shown ones (the keyboard path for reordering), and Reset to default. The identity column
 * cannot be hidden or moved; its width is set from the row under the list.
 */
export function ColumnChooser({
  trigger,
  columns,
  onToggle,
  onMove,
  onReset,
  width,
  compact = false,
}: ColumnChooserProps): ReactElement {
  const t = useTranslations('dataTable');
  const shown = columns.filter((column) => column.visible);
  const firstMovable = shown.findIndex((column) => !column.locked);
  const move = (column: ColumnChooserColumn, direction: -1 | 1): void => {
    onMove(column.id, direction);
    const position = shown.findIndex((candidate) => candidate.id === column.id) + direction + 1;
    announce(t('moved', { column: column.label, position, count: shown.length }));
  };
  return (
    <Popover
      trigger={trigger}
      title={t('columns')}
      padding="list"
      {...(compact ? { width: 'min' as const } : {})}
      align="end"
      footer={
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('resetColumns')}
        </Button>
      }
    >
      <ul className="flex flex-col">
        {columns.map((column) => {
          const index = shown.findIndex((candidate) => candidate.id === column.id);
          return (
            <li key={column.id} className="group flex h-control-sm items-center gap-1">
              <Checkbox
                checked={column.visible}
                label={
                  column.icon === undefined ? (
                    column.label
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden="true" className="flex shrink-0 items-center">
                        {column.icon}
                      </span>
                      <span className="truncate">{column.label}</span>
                    </span>
                  )
                }
                disabled={column.locked}
                onCheckedChange={(checked) => onToggle(column.id, checked)}
                className="min-w-0 flex-1"
              />
              {column.visible && !column.locked ? (
                <>
                  <IconButton
                    icon={ArrowUp}
                    size="icon-xs"
                    variant="ghost"
                    label={t('moveUp', { column: column.label })}
                    disabled={index <= firstMovable}
                    onClick={() => move(column, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="icon-xs"
                    variant="ghost"
                    label={t('moveDown', { column: column.label })}
                    disabled={index === shown.length - 1}
                    onClick={() => move(column, 1)}
                  />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {width === undefined ? null : (
        <div
          role="group"
          aria-label={t('chooser.columnWidth', { column: width.column })}
          className={cn('mt-1 flex items-center gap-1 border-t border-border-subtle px-2 pt-2', compact && 'flex-wrap')}
        >
          <span aria-hidden="true" className={cn('min-w-0 truncate type-meta', compact ? 'basis-full' : 'flex-1')}>
            {t('chooser.columnWidth', { column: width.column })}
          </span>
          <Button variant="secondary" size="sm" disabled={width.atMin} focusableWhenDisabled onClick={width.onNarrower}>
            {t('narrower')}
          </Button>
          <Button variant="secondary" size="sm" disabled={width.atMax} focusableWhenDisabled onClick={width.onWider}>
            {t('wider')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={width.isDefault}
            focusableWhenDisabled
            onClick={width.onReset}
          >
            {t('resetWidth')}
          </Button>
        </div>
      )}
    </Popover>
  );
}
