'use client';

import { ChevronDown, Undo2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactElement } from 'react';

import { useLayoutAnnouncer } from '../announcements';
import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';

/**
 * What a team default that was saved says: the toast, and the live region, which also replaces the "Layout saved"
 * of the write. The menu and the conflict dialog (Keep mine after a team 412) both end a save this way.
 */
export function useTeamSetNotice(): () => void {
  const t = useTranslations('layouts.customize');
  const { definition } = useLayoutScreen();
  const { workspaceName } = useCustomize();
  const { say } = useLayoutAnnouncer();
  return (): void => {
    say(t('announce.teamSet'));
    toast({
      type: 'success',
      title: t('team.setToast'),
      description: t('team.setToastBody', { screen: definition.title, workspace: workspaceName }),
    });
  };
}

type Question = 'set' | 'remove';

/**
 * The other half of the Save button (plan T6, spec 5.6): a menu for owners and admins (`layouts:manage`) with
 * Save as team default, and Remove team default while one exists. Each asks first. The write itself is the
 * provider's, which reads the draft when it writes, so nothing is copied here and a confirm that outlives the
 * mode writes nothing: the dialog goes with the mode.
 */
export function TeamDefaultMenu(): ReactElement | null {
  const t = useTranslations('layouts.customize');
  const { canManage, resolved, saving, dirty, actions } = useLayoutScreen();
  const { workspaceName, conflictPending, setConflict } = useCustomize();
  const noticeSet = useTeamSetNotice();
  const chevron = useRef<HTMLButtonElement>(null);
  // The kind stays when the dialog closes, so the closing dialog keeps its words
  const [asking, setAsking] = useState<{ kind: Question; open: boolean }>({ kind: 'set', open: false });
  if (!canManage) return null;

  /** A write met a changed layout and has not been answered: no team write goes out before it is. */
  const refusedForConflict = (): boolean => {
    if (conflictPending === null) return false;
    setConflict(conflictPending);
    return true;
  };

  const ask = (kind: Question): void => {
    if (refusedForConflict()) return;
    setAsking({ kind, open: true });
  };

  const confirm = async (): Promise<void> => {
    if (refusedForConflict()) return;
    const keepsDraft = dirty;
    if (asking.kind === 'set') {
      const outcome = await actions.saveTeamDefault();
      if (outcome.kind === 'saved') noticeSet();
      else if (outcome.kind === 'conflict') setConflict('team');
      else if (outcome.kind === 'failed') toast({ type: 'error', title: t('team.failedToast') });
      return;
    }
    const outcome = await actions.removeTeamDefault();
    if (outcome.kind === 'saved') {
      // The toast is announced by its own region
      toast({
        type: 'info',
        title: t('team.removedToast'),
        ...(keepsDraft ? { description: t('team.removedKeptBody') } : {}),
      });
      // Removing writes no draft and sends no ETag: a conflict here would be the answer to nothing, so it is a failure
    } else if (outcome.kind !== 'unchanged') {
      toast({ type: 'error', title: t('team.removeFailedToast') });
    }
  };

  const items: MenuItemDef[] = [
    {
      id: 'save',
      label: t('team.save'),
      icon: Users,
      onSelect: () => {
        ask('set');
      },
    },
    ...(resolved.teamDefaultExists
      ? [
          {
            id: 'remove',
            label: t('team.remove'),
            icon: Undo2,
            onSelect: () => {
              ask('remove');
            },
          },
        ]
      : []),
  ];
  const setting = asking.kind === 'set';

  return (
    <>
      <Menu
        align="end"
        items={items}
        trigger={
          <IconButton
            ref={chevron}
            icon={ChevronDown}
            label={t('saveBar.moreSave')}
            variant="primary"
            size="icon"
            disabled={saving}
            focusableWhenDisabled
            className="-ml-px rounded-l-none border-l border-l-primary-hover"
          />
        }
      />
      <ConfirmDialog
        open={asking.open}
        onOpenChange={(open) => {
          setAsking((current) => ({ ...current, open }));
        }}
        title={setting ? t('team.setTitle', { workspace: workspaceName }) : t('team.removeTitle')}
        description={setting ? t('team.setBody') : t('team.removeBody', { workspace: workspaceName })}
        confirmLabel={setting ? t('team.setConfirm') : t('team.removeConfirm')}
        cancelLabel={t('team.cancel')}
        tone={setting ? 'neutral' : 'destructive'}
        finalFocus={chevron}
        onConfirm={confirm}
      />
    </>
  );
}
