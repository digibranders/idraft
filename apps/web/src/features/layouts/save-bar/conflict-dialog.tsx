'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { useTeamSetNotice } from './team-default-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { browserTimeZone, formatRelative } from '@/lib/format';

/**
 * "This layout was changed somewhere else" (spec section 8, plan T6): the question a write that met a 412 leaves
 * open. It is a 400 px dialog, not the side by side one of the design system, because a layout has no version
 * to show. It is open exactly while the controller's `conflict` is set; Escape and Close only put it away (the
 * conflict stays pending, so Save asks again), and the two answers clear the conflict.
 *
 * - Keep mine writes the draft again: `saveAnyway()` for the personal layout, which reads the layout and puts the
 *   draft with the fresh ETag, or `saveTeamDefault()` for the team default. A plain `save()` here would overwrite
 *   the other version without asking, so it is never called.
 * - Load the other version makes the layout as read after the 412 the draft.
 */
export function LayoutConflictDialog(): ReactElement {
  const t = useTranslations('layouts.customize');
  const { resolved, saving, actions } = useLayoutScreen();
  const { conflict, setConflict, dismissConflict, resolveConflict, setSaveError } = useCustomize();
  const noticeTeamSet = useTeamSetNotice();
  const loadOther = useRef<HTMLButtonElement>(null);
  const { updatedBy, updatedAt } = resolved;

  // The question is modal, so focus stays in it. A team write answered with a 412 comes from a confirm dialog, which
  // returns focus to the chevron once its exit has finished, that is after this dialog has opened: it comes back here.
  useEffect(() => {
    if (conflict === null) return undefined;
    const keepInside = (event: FocusEvent): void => {
      const { target } = event;
      if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') === null) {
        loadOther.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', keepInside);
    return () => {
      document.removeEventListener('focusin', keepInside);
    };
  }, [conflict]);

  const keepMine = async (): Promise<void> => {
    if (conflict === null) return;
    const kind = conflict;
    const outcome = await (kind === 'team' ? actions.saveTeamDefault() : actions.saveAnyway());
    if (outcome.kind === 'conflict') {
      // Changed again while the question was open: ask again
      setConflict(kind);
    } else if (outcome.kind === 'failed') {
      // The draft is kept and the conflict stays pending, so the next Save asks again
      setSaveError(true);
      dismissConflict();
    } else {
      if (outcome.kind === 'saved' && kind === 'team') noticeTeamSet();
      resolveConflict();
    }
  };

  return (
    <Dialog
      open={conflict !== null}
      onOpenChange={(open) => {
        // A write is under way and this dialog is where its outcome is answered
        if (!open && !saving) dismissConflict();
      }}
      size="sm"
      initialFocus={loadOther}
    >
      <DialogHeader title={t('conflict.title')} description={t('conflict.body')} closeLabel={t('conflict.close')} />
      {updatedBy !== null && updatedAt !== null ? (
        <DialogBody>
          <p className="type-meta">
            {t('conflict.savedBy', { name: updatedBy.name, when: formatRelative(updatedAt, browserTimeZone()) })}
          </p>
        </DialogBody>
      ) : null}
      <DialogFooter
        secondary={
          <Button
            loading={saving}
            onClick={() => {
              void keepMine();
            }}
          >
            {t('conflict.keepMine')}
          </Button>
        }
        primary={
          <Button
            ref={loadOther}
            variant="primary"
            disabled={saving}
            onClick={() => {
              actions.loadRemote();
              resolveConflict();
            }}
          >
            {t('conflict.loadOther')}
          </Button>
        }
      />
    </Dialog>
  );
}
