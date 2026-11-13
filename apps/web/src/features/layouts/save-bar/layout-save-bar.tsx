'use client';

import { Redo2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
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

/**
 * The bar of customize mode (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, T5): how many
 * changes the draft has, Undo and Redo, what the layout applies to, and the ways out: Reset to default, Cancel
 * and Save layout. It is a group named by the count, and it exists only while the screen is in customize mode.
 * Save stores the personal layout and ends the mode with no toast, because the page is the confirmation.
 */
export function LayoutSaveBar({ variant = 'page' }: LayoutSaveBarProps): ReactElement | null {
  const t = useTranslations('layouts.customize');
  const countId = useId();
  const { mode, document, defaultDocument, resolved, changes, canUndo, canRedo, saving, actions } = useLayoutScreen();
  const { requestExit, saveError, setSaveError, setConflict } = useCustomize();
  if (mode !== 'customize') return null;

  const differs = resolved.source === 'personal' && resolved.teamDefaultExists;

  const save = async (): Promise<void> => {
    setSaveError(false);
    const outcome = await actions.save();
    if (outcome.kind === 'failed') setSaveError(true);
    // The dialog that asks what to do about it is the team default task's; the state is what it reads
    else if (outcome.kind === 'conflict') setConflict('personal');
  };

  return (
    <div
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
      <span className="hidden min-w-0 truncate type-meta lg:block">
        {differs ? t('saveBar.differs') : t('saveBar.scope')}
      </span>
      <span className="ml-auto flex items-center gap-2">
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
        {/* The team default menu joins Save here, as the other half of one split button */}
        <div className="flex">
          <Button
            variant="primary"
            disabled={changes === 0}
            loading={saving}
            onClick={() => {
              void save();
            }}
          >
            {t('saveBar.save')}
          </Button>
        </div>
      </span>
    </div>
  );
}
