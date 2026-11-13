'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ComponentProps, type ReactElement } from 'react';

import { GROUP_KEYS } from './budget-model';
import { DELETE_BUDGET, refreshBudgets } from './budgets-queries';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { Budget } from '@/lib/api/types';

export interface DeleteBudgetDialogProps {
  workspaceId: string;
  /** The budget being deleted; the question is closed while it is `null`. */
  budget: Budget | null;
  /** The name of a scope: the workspace, or a project by its id. */
  scopeName: (projectId: string | null) => string;
  /** The budget is gone (deleted here or by someone else), and its row with its menu: focus has to go elsewhere. */
  onRemoved: () => void;
  onClose: () => void;
  finalFocus: ComponentProps<typeof ConfirmDialog>['finalFocus'];
}

/**
 * "Delete this budget?" (16 section 4.5): the budget stops capping spend, and the runs it blocked stay
 * blocked. Nothing is sent until the person confirms.
 */
export function DeleteBudgetDialog({
  workspaceId,
  budget,
  scopeName,
  onRemoved,
  onClose,
  finalFocus,
}: DeleteBudgetDialogProps): ReactElement {
  const t = useTranslations('budgets.delete');
  const groups = useTranslations('budgets.groups');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const remove = useMutation(DELETE_BUDGET);
  const [error, setError] = useState<string | null>(null);
  const names = {
    scope: scopeName(budget?.project_id ?? null),
    group: budget === null ? '' : groups(GROUP_KEYS[budget.workload]),
  };

  const confirm = async (): Promise<void> => {
    if (budget === null) return;
    setError(null);
    try {
      await remove.mutateAsync({ params: { path: { workspace_id: workspaceId, budget_id: budget.budget_id } } });
    } catch (failure) {
      if (isApiProblem(failure, 'not_found')) {
        // Deleted meanwhile, by someone else: the list catches up and the question closes
        toast({ type: 'info', title: t('gone') });
        onRemoved();
        await refreshBudgets(queryClient, workspaceId);
        return;
      }
      setError(isApiProblem(failure, 'forbidden') ? t('forbidden') : t('failed'));
      throw failure;
    }
    toast({ type: 'success', title: t('deleted', names) });
    onRemoved();
    await refreshBudgets(queryClient, workspaceId);
  };

  return (
    <ConfirmDialog
      open={budget !== null}
      onOpenChange={(open) => {
        if (open) return;
        setError(null);
        onClose();
      }}
      finalFocus={finalFocus}
      title={t('title')}
      description={t('description', names)}
      confirmLabel={t('confirm')}
      cancelLabel={common('cancel')}
      onConfirm={confirm}
      error={error}
    />
  );
}
