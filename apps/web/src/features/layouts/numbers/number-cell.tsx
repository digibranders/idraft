'use client';

/**
 * One headline number in customize mode: the number as the strip shows it, under a row of controls (reorder, Remove,
 * Move). The controls are the same as a card's, in the same order. The value is not a link here: the cell is being
 * arranged, not read.
 */
import { useSortable } from '@dnd-kit/sortable';
import { EllipsisVertical, GripVertical, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, type ReactElement, type ReactNode } from 'react';

import { useLayoutScreen } from '../layout-provider';
import { MOVE_COMMANDS, moveTargetIndex, type MoveCommand } from '../move-menu';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { MetricStripItem, MetricStripProps } from '@/components/app/metric/metric-strip';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';
import { engineLabel, numberName, numberType, type NumberItem } from '@/lib/layouts';
import { cn } from '@/lib/utils';

/** The words of each move, and what to say when it cannot be made (the card's own, `layouts.core`). */
const MOVES = {
  earlier: { label: 'moveEarlier', reason: 'alreadyFirst' },
  later: { label: 'moveLater', reason: 'alreadyLast' },
  start: { label: 'moveStart', reason: 'alreadyFirst' },
  end: { label: 'moveEnd', reason: 'alreadyLast' },
} as const satisfies Record<MoveCommand, { label: string; reason: string }>;

const COARSE_ICON = 'pointer-coarse:size-control-touch';

/**
 * What the page says of a number's value: a `MetricStrip` item without what the strip makes of the layout (its id,
 * its label, the engine mark). In customize mode `href`, `tip` and `meter` are not drawn: the cell is arranged.
 */
export type NumberValue = Omit<MetricStripItem, 'id' | 'label' | 'labelAddon'>;

/** How the cell looks while it is dragged: `picked` is a keyboard pick up, `dragging` a pointer drag. */
export type NumberDragState = 'idle' | 'dragging' | 'picked';

/** The label of a number's metric, without its engine: "Mention rate". Both modes show the engine as a mark and a name after it. */
export const metricLabelOf = (item: NumberItem): string => numberType(item.metric)?.label ?? item.metric;

/** The engine of an AI number as its mark with its name beside it (the name is never left out), else nothing. */
export function engineOf(item: NumberItem): ReactNode {
  // The engine keeps its width and its line, so in a narrow cell the metric label shortens first (the label is a
  // `Truncate`) and the values of a row stay level
  return item.engine === undefined ? null : (
    <span data-slot="number-engine" className="shrink-0 whitespace-nowrap">
      <EngineLogo engine={item.engine} name={engineLabel(item.engine)} />
    </span>
  );
}

/** The value, delta and context of a number as `MetricStrip` draws them in its page strip. */
function CellValue({ value, status }: { value: NumberValue; status: MetricStripProps['status'] }): ReactElement {
  const unknown = value.unknown ?? null;
  return (
    <dd className="flex min-w-0 flex-col">
      {status === 'loading' ? (
        <span className="flex h-8 w-16 items-center">
          <Skeleton shape="text-14" widthPct={100} />
        </span>
      ) : (
        <span className="flex min-w-0 items-baseline gap-2">
          {unknown === null && value.text === true ? (
            <span className="flex h-8 min-w-0 items-center type-body-strong text-foreground">{value.value}</span>
          ) : unknown === null ? (
            <span className="shrink-0 num type-metric text-foreground">{value.value}</span>
          ) : (
            <span
              className={cn(
                'flex h-8 shrink-0 items-center type-body text-foreground-tertiary',
                unknown.kind === 'insufficient' && 'bg-insufficient',
              )}
            >
              {value.value}
            </span>
          )}
          {value.delta === undefined || value.delta === null ? null : (
            <span className="shrink-0 num type-body-strong">{value.delta}</span>
          )}
        </span>
      )}
      {value.context === undefined || value.context === null ? null : (
        <Truncate text={value.context} className="type-meta text-foreground-tertiary" />
      )}
    </dd>
  );
}

export interface NumberCellProps {
  item: NumberItem;
  /** The number before this one, for the divider where the channel changes. */
  previous: NumberItem | undefined;
  value: NumberValue;
  status: MetricStripProps['status'];
  dragState: NumberDragState;
  /** Tells the strip which element is the cell, for the drop line. */
  register: (id: string, node: HTMLElement | null) => void;
}

export function NumberCell({ item, previous, value, status, dragState, register }: NumberCellProps): ReactElement {
  const t = useTranslations('layouts.customize.numbers');
  const tCore = useTranslations('layouts.core');
  const { actions, document, saving } = useLayoutScreen();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useSortable({ id: item.id, disabled: saving });
  // transform and transition are not used: nothing shifts, so there is nothing to animate
  const ref = useCallback(
    (node: HTMLDivElement | null): void => {
      setNodeRef(node);
      register(item.id, node);
    },
    [setNodeRef, register, item.id],
  );
  const name = numberName(item);
  const numbers = document.numbers ?? [];
  const index = numbers.findIndex((number) => number.id === item.id);
  const channel = numberType(item.metric)?.channel;
  // The stronger line where SEO and AI numbers meet, drawn when the strip is one row (the preview's rule)
  const startsChannel = previous !== undefined && numberType(previous.metric)?.channel !== channel;

  const moveItems: MenuItemDef[] = MOVE_COMMANDS.map((command) => {
    const target = moveTargetIndex(command, index, numbers.length);
    return {
      id: command,
      label: tCore(MOVES[command].label),
      // Kept in the menu and reachable, with the reason, so a person learns the number is already there
      disabledReason: target === null ? tCore(MOVES[command].reason) : undefined,
      onSelect: () => {
        if (target !== null) actions.moveNumber(item.id, target, 'more');
      },
    };
  });

  return (
    <div
      ref={ref}
      data-layout-number={item.id}
      className={cn(
        'relative min-w-0 border-r border-b border-border-subtle px-4 py-3 @5xl:px-5',
        startsChannel && '@5xl:-ml-px @5xl:border-l @5xl:border-l-border',
        dragState === 'dragging' && 'opacity-50',
        dragState === 'picked' && 'ring-2 ring-primary ring-inset',
      )}
    >
      {/* A group, as a card's controls are: every control is an ordinary tab stop */}
      <div role="group" aria-label={t('group', { number: name })} className="-mx-2 -mt-1 mb-1 flex items-center">
        {/* The tooltip repeats the name for the eye; while the number is held an open one would take the first Escape */}
        <Tooltip content={tCore('reorderTip')} purpose="label" disabled={dragState !== 'idle'}>
          <Button
            {...attributes}
            {...listeners}
            ref={setActivatorNodeRef}
            data-part="handle"
            variant="ghost"
            size="icon-sm"
            icon={GripVertical}
            disabled={saving}
            aria-label={t('reorder', { number: name })}
            aria-pressed={dragState === 'picked'}
            // "sortable" is dnd-kit's own English word: the name and the description say it in the page's language
            aria-roledescription={undefined}
            className={cn('cursor-grab touch-none', COARSE_ICON)}
          />
        </Tooltip>
        <Tooltip content={t('removeTip')}>
          <Button
            variant="ghost"
            size="icon-sm"
            icon={X}
            disabled={saving}
            aria-label={t('remove', { number: name })}
            className={cn('ml-auto', COARSE_ICON)}
            onClick={() => {
              actions.removeNumber(item.id);
            }}
          />
        </Tooltip>
        <Menu
          align="end"
          items={moveItems}
          trigger={
            <IconButton
              icon={EllipsisVertical}
              label={t('move', { number: name })}
              data-part="more"
              disabled={saving}
              className={COARSE_ICON}
            />
          }
        />
      </div>
      <dl>
        <dt className="flex min-w-0 items-center gap-1 type-meta">
          <Truncate text={metricLabelOf(item)} className="text-foreground-tertiary" />
          {engineOf(item)}
        </dt>
        <CellValue value={value} status={status} />
      </dl>
    </div>
  );
}

/** A copy of the number's name that follows the pointer, as big as the cell (dnd-kit measures the overlay for what it is over). */
export function NumberOverlayCopy({ item }: { item: NumberItem }): ReactElement {
  return (
    <div data-slot="layout-drag-overlay" aria-hidden="true" className="h-full">
      <div
        data-slot="layout-drag-copy"
        className="flex h-control-sm items-center gap-2 rounded-lg bg-surface px-2 type-body-strong text-foreground shadow-drag"
      >
        <Icon icon={GripVertical} size="sm" />
        <span className="truncate">{numberName(item)}</span>
      </div>
    </div>
  );
}
