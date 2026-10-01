'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import { Popover } from '@/components/ui/popover';
import { announce } from '@/lib/a11y/announcer';

export interface ColumnChooserColumn {
  id: string;
  label: string;
  visible: boolean;
  /** The identity column: always shown, not movable. */
  locked: boolean;
}

export interface ColumnChooserProps {
  trigger: ReactElement;
  /** Every column in the chosen order, the hidden ones after it. */
  columns: readonly ColumnChooserColumn[];
  onToggle: (id: string, visible: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onReset: () => void;
}

/**
 * Shows, hides and reorders a table's columns (12-tables.md section 10): a checkbox per column, Move up and
 * Move down on the shown ones (the keyboard path for reordering), and Reset to default. The identity column
 * cannot be hidden or moved.
 */
export function ColumnChooser({ trigger, columns, onToggle, onMove, onReset }: ColumnChooserProps): ReactElement {
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
                label={column.label}
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
    </Popover>
  );
}
