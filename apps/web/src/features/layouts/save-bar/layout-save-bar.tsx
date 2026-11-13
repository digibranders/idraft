'use client';

import { Redo2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';

import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { LayoutConflictDialog } from './conflict-dialog';
import { TeamDefaultMenu } from './team-default-menu';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { sameLayout } from '@/lib/layouts';
import { cn } from '@/lib/utils';

export interface LayoutSaveBarProps {
  /** `page`: pinned to the bottom of the screen. `drawer`: in the flow, for the footer of a drawer. */
  variant?: 'page' | 'drawer';
}

/** The keys the tooltips name; `use-undo-keys` listens for them. */
const UNDO_KEYS = ['mod', 'z'];
const REDO_KEYS = ['mod', 'shift', 'z'];

/** The look of the form save bar (`components/ui/save-bar`), which cannot hold these controls. */
const BAR_CLASS =
  'flex min-h-save-bar flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-surface py-2 transition-opacity duration-(--duration-base) ease-standard starting:opacity-0';
const VARIANT_CLASS = {
  page: 'sticky bottom-0 z-(--z-sticky) px-3 md:px-4 lg:px-5',
  drawer: 'px-4',
} as const satisfies Record<NonNullable<LayoutSaveBarProps['variant']>, string>;

/** The element the page scrolls in: the nearest ancestor that scrolls, else the document. */
function scrollerOf(node: HTMLElement): HTMLElement {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return document.documentElement;
}

/**
 * Keeps what has focus out from under a bar that is pinned to the bottom (WCAG 2.4.11): while the bar is shown,
 * the scroller reserves the bar's height, so a control reached by Tab or by `focus()` scrolls to just above it.
 * The height is read from the bar, so a bar that wraps to two rows reserves two.
 */
function useReserveBarHeight(bar: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const node = bar.current;
    if (!enabled || node === null) return undefined;
    const scroller = scrollerOf(node);
    const before = scroller.style.scrollPaddingBottom;
    const reserve = (): void => {
      scroller.style.scrollPaddingBottom = `${String(node.getBoundingClientRect().height)}px`;
    };
    reserve();
    // jsdom and old browsers have no ResizeObserver: the height read once is what they get
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      scroller.style.scrollPaddingBottom = before;
    };
  }, [bar, enabled]);
}

/**
 * The bar of customize mode (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, T5): how many
 * changes the draft has, Undo and Redo, what the layout applies to, and the ways out: Reset to default, Cancel
 * and Save layout. It is a group named by the count, and it exists only while the screen is in customize mode.
 * Save stores the personal layout and ends the mode with no toast, because the page is the confirmation.
 */
export function LayoutSaveBar({ variant = 'page' }: LayoutSaveBarProps): ReactElement | null {
  const t = useTranslations('layouts.customize');
  const countId = useId();
  const { mode, document, defaultDocument, resolved, changes, canUndo, canRedo, saving, canManage, actions } =
    useLayoutScreen();
  const { requestExit, saveError, setSaveError, conflictPending, setConflict } = useCustomize();
  const barRef = useRef<HTMLDivElement>(null);
  const customizing = mode === 'customize';
  useReserveBarHeight(barRef, customizing && variant === 'page');
  if (!customizing) return null;

  const differs = resolved.source === 'personal' && resolved.teamDefaultExists;
  const scope = differs ? t('saveBar.differs') : t('saveBar.scope');

  const save = async (): Promise<void> => {
    // A write met a changed layout and has not been answered: the API has read that layout again, so another
    // save would send its fresh ETag and overwrite it without asking. Ask again instead.
    if (conflictPending !== null) {
      setConflict(conflictPending);
      return;
    }
    setSaveError(false);
    const outcome = await actions.save();
    if (outcome.kind === 'failed') setSaveError(true);
    // The conflict dialog is open while this is set
    else if (outcome.kind === 'conflict') setConflict('personal');
  };

  return (
    <div
      ref={barRef}
      role="group"
      aria-labelledby={countId}
      data-slot="layout-save-bar"
      className={cn(BAR_CLASS, VARIANT_CLASS[variant])}
    >
      {saveError ? (
        <p role="alert" className="w-full type-meta text-negative-text">
          {t('saveBar.failed')}
        </p>
      ) : null}
      <span id={countId} className="type-body-strong whitespace-nowrap text-foreground">
        {t('saveBar.changes', { count: changes })}
      </span>
      <span className="flex items-center gap-1">
        <IconButton
          icon={Undo2}
          label={t('saveBar.undo')}
          shortcut={UNDO_KEYS}
          disabled={!canUndo || saving}
          focusableWhenDisabled
          onClick={() => {
            actions.undo();
          }}
        />
        <IconButton
          icon={Redo2}
          label={t('saveBar.redo')}
          shortcut={REDO_KEYS}
          disabled={!canRedo || saving}
          focusableWhenDisabled
          onClick={() => {
            actions.redo();
          }}
        />
      </span>
      {/* Takes what is left of the row, so the bar stays one row; the full text is the title when it is cut. The
          two lines of the differs line are 40 px: the negative margin keeps them inside the bar's own height. */}
      <span
        title={scope}
        className={cn(
          'hidden min-w-0 flex-1 type-meta',
          differs ? 'lg:-my-0.5 lg:line-clamp-2' : 'lg:block lg:truncate',
        )}
      >
        {scope}
      </span>
      {/* A narrowed window (customize mode starts at 768 px) may not fit the actions, the team menu included */}
      <span className="ml-auto flex shrink-0 items-center justify-end gap-2 max-md:max-w-full max-md:flex-wrap">
        <Button
          variant="ghost"
          disabled={saving || sameLayout(document, defaultDocument)}
          focusableWhenDisabled
          onClick={() => {
            actions.replaceDraft(defaultDocument, t('announce.reset'));
          }}
        >
          {t('saveBar.reset')}
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            requestExit();
          }}
        >
          {t('saveBar.cancel')}
        </Button>
        {/* The team default menu joins Save as the other half of one split button, for whoever may manage it */}
        <div className="flex">
          <Button
            variant="primary"
            disabled={changes === 0}
            loading={saving}
            className={cn(canManage && 'rounded-r-none')}
            onClick={() => {
              void save();
            }}
          >
            {t('saveBar.save')}
          </Button>
          <TeamDefaultMenu />
        </div>
      </span>
      {/* Portalled: it is the bar's own because the bar is what a conflict is answered from */}
      <LayoutConflictDialog />
    </div>
  );
}
