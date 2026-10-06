'use client';

import { Ellipsis, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { use, useLayoutEffect, useRef, useState, type JSX, type ReactElement } from 'react';

import { toneOf } from './action-tone';
import type { ActionScope, RecordAction } from './types';
import { InspectorOverlayContext } from '@/components/app/inspector/inspector-layout';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/components/ui/tooltip';
import { formatInteger } from '@/lib/format';
import { fitCount } from '@/lib/tables/bulk-fit';

export interface BulkActionBarProps<TRow> {
  selectedCount: number;
  /** Rows the filters match, when more exist than are loaded. */
  matchingTotal: number | null;
  /** Every loaded row in view is selected: the condition for offering every matching row. */
  allLoadedSelected: boolean;
  allMatching: boolean;
  onSelectAllMatching: () => void;
  /** Selected rows not in view. */
  hiddenCount: number;
  /** Why they are not in view: filtered out in client mode, on other pages in server mode. */
  hiddenReason: 'filters' | 'pages';
  actions: readonly RecordAction<TRow>[];
  /** The selected rows that are loaded. */
  selectedRows: readonly TRow[];
  scope: ActionScope;
  onClear: () => void;
}

const ORDER: Readonly<Record<RecordAction<unknown>['group'], number>> = { open: 0, object: 1, copy: 2, destructive: 3 };
/** The space between the bar's buttons: `gap-2`. */
const GAP_PX = 8;
/** The bar's side padding: `px-3`. */
const BAR_PADDING_PX = 12;

const sameWidths = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((width, index) => width === b[index]);

/**
 * Replaces the toolbar in place while rows are selected (12-tables.md section 14): the count, "Select all
 * N matching" once every loaded row is selected and more match, the actions with the destructive ones last
 * and set apart, and Clear. Destructive actions and actions on more than 100 rows confirm in the action
 * itself. The actions that do not fit the width go into a "More actions" menu in the same order, so none
 * is clipped out of sight while still reachable by keyboard: each action's width is measured in a hidden
 * copy, and the bar's room for them is observed.
 */
export function BulkActionBar<TRow>({
  selectedCount,
  matchingTotal,
  allLoadedSelected,
  allMatching,
  onSelectAllMatching,
  hiddenCount,
  hiddenReason,
  actions,
  selectedRows,
  scope,
  onClear,
}: BulkActionBarProps<TRow>): ReactElement {
  const t = useTranslations('dataTable');
  const selectedText =
    allMatching && matchingTotal !== null
      ? t('allMatchingSelected', { count: formatInteger(matchingTotal) })
      : t('selected', { count: formatInteger(selectedCount) });
  const ordered = [...actions].sort((a, b) => ORDER[a.group] - ORDER[b.group]);
  const firstDestructive = ordered.findIndex((action) => action.group === 'destructive');

  // An inspector laid over the list covers the bar's right side: the bar's content stops where the card
  // begins, so the actions and Clear stay in sight, and the actions that no longer fit go into More
  const overlayLeft = use(InspectorOverlayContext);
  const bar = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(0);
  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null || overlayLeft === null) {
      setCovered(0);
      return undefined;
    }
    const update = (): void => setCovered(Math.max(0, Math.round(element.getBoundingClientRect().right - overlayLeft)));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [overlayLeft]);

  // The room for the actions beside the count and Clear, and the width each action and the More button need
  const room = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [measured, setMeasured] = useState<{ actions: readonly number[]; more: number } | null>(null);
  const signature = ordered.map((action) => `${action.id}|${action.label}|${action.disabledReason ?? ''}`).join('\n');
  useLayoutEffect(() => {
    const roomElement = room.current;
    const probeElement = probe.current;
    if (roomElement === null || probeElement === null) return undefined;
    const measure = (): void => {
      const widths = [...probeElement.querySelectorAll<HTMLElement>('[data-measure="action"]')].map(
        (element) => element.offsetWidth,
      );
      const more = probeElement.querySelector<HTMLElement>('[data-measure="more"]')?.offsetWidth ?? 0;
      setMeasured((last) =>
        last !== null && last.more === more && sameWidths(last.actions, widths) ? last : { actions: widths, more },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) if (entry.target === roomElement) setAvailable(entry.contentRect.width);
      // A label that changes width (a font arriving) changes the fit too
      measure();
    });
    observer.observe(roomElement);
    observer.observe(probeElement);
    return () => observer.disconnect();
  }, [signature]);
  // Until both are known, and while the measure is of other actions, every action is a button
  const buttonCount =
    available === null || measured === null || measured.actions.length !== ordered.length
      ? ordered.length
      : fitCount(measured.actions, measured.more, available, GAP_PX);
  const buttons = ordered.slice(0, buttonCount);
  const overflow = ordered.slice(buttonCount);
  const select = (action: RecordAction<TRow>): void => action.onSelect(selectedRows, scope);
  const overflowItems: MenuItemDef[] = overflow.map((action) => ({
    id: action.id,
    label: action.label,
    icon: action.icon,
    tone: toneOf(action),
    disabledReason: action.disabledReason ?? undefined,
    onSelect: () => select(action),
  }));
  const separated = (index: number): boolean => index === firstDestructive && index > 0;
  return (
    <div
      ref={bar}
      role="group"
      aria-label={t('bulkActions', { selected: selectedText })}
      // The bar's own 12 px (`px-3`) beside what the card covers
      style={covered === 0 ? undefined : { paddingRight: covered + BAR_PADDING_PX }}
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-selected px-3"
    >
      <p className="shrink-0 num type-body-strong">{selectedText}</p>
      {matchingTotal !== null && allLoadedSelected && !allMatching && matchingTotal > selectedCount ? (
        <Button variant="link" size="sm" onClick={onSelectAllMatching}>
          {t('selectAllMatching', { count: formatInteger(matchingTotal) })}
        </Button>
      ) : null}
      {hiddenCount > 0 && !allMatching ? (
        <p className="min-w-0 truncate type-meta">
          {hiddenReason === 'pages'
            ? t('otherPagesSelected', { count: hiddenCount })
            : t('hiddenSelected', { count: hiddenCount })}
        </p>
      ) : null}
      <div ref={room} data-slot="bulk-actions" className="relative flex min-w-0 flex-1 items-center justify-end gap-2">
        {buttons.map((action, index) => (
          <span key={action.id} className="flex items-center gap-2">
            {separated(index) ? <Separator orientation="vertical" className="my-3" /> : null}
            <ActionButton action={action} onSelect={() => select(action)} />
          </span>
        ))}
        {overflow.length === 0 ? null : (
          <Menu
            align="end"
            trigger={<IconButton icon={Ellipsis} variant="secondary" size="icon-sm" label={t('moreActions')} />}
            items={overflowItems}
          />
        )}
        {/* A copy of every action and of the More button, out of sight and out of reach, to read their widths from */}
        <div
          ref={probe}
          aria-hidden="true"
          inert
          className="pointer-events-none invisible absolute top-0 right-0 flex w-max items-center gap-2"
        >
          {ordered.map((action, index) => (
            <span key={action.id} data-measure="action" className="flex items-center gap-2">
              {separated(index) ? <Separator orientation="vertical" className="my-3" /> : null}
              {actionButton(action, () => undefined)}
            </span>
          ))}
          <span data-measure="more">
            <IconButton icon={Ellipsis} variant="secondary" size="icon-sm" label={t('moreActions')} />
          </span>
        </div>
      </div>
      <IconButton icon={X} variant="ghost" label={t('clearSelection')} onClick={onClear} />
    </div>
  );
}

/** A bulk action's button: neutral, or destructive in tone. A disabled one stays focusable. */
function actionButton<TRow>(action: RecordAction<TRow>, onSelect: () => void): JSX.Element {
  return (
    <Button
      size="sm"
      variant={toneOf(action) === 'destructive' ? 'destructive' : 'secondary'}
      icon={action.icon}
      disabled={action.disabledReason !== null && action.disabledReason !== undefined}
      focusableWhenDisabled
      onClick={onSelect}
    >
      {action.label}
    </Button>
  );
}

/** A bulk action; a disabled one stays focusable and says why (08-interaction-states.md section 1). */
function ActionButton<TRow>({ action, onSelect }: { action: RecordAction<TRow>; onSelect: () => void }): ReactElement {
  const reason = action.disabledReason ?? null;
  const button = actionButton(action, onSelect);
  return reason === null ? button : <Tooltip content={reason}>{button}</Tooltip>;
}
