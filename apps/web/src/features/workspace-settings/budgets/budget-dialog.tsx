'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  BUDGET_GROUPS,
  DEFAULT_SOFT_LIMIT,
  editableLimit,
  GROUP_KEYS,
  isBudgetGroup,
  limitIssue,
  limitOf,
  softLimitIssue,
  WORKSPACE_SCOPE,
  type BudgetGroup,
  type BudgetsProject,
  type LimitIssue,
  type SoftLimitIssue,
} from './budget-model';
import { CREATE_BUDGET, refreshBudgets, UPDATE_BUDGET } from './budgets-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader, type DialogProps } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { RadioGroup } from '@/components/ui/radio-group';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { Budget } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/forms';

type Action = Budget['action_on_hard'];

interface BudgetValues {
  /** The project's id, or `WORKSPACE_SCOPE` for the whole workspace. */
  project_id: string;
  workload: BudgetGroup;
  limit_usd: string;
  soft_limit_pct: string;
  action_on_hard: Action;
}

/** Every control of the form, by the name the API's errors are put under. */
const FIELDS: readonly (keyof BudgetValues)[] = [
  'project_id',
  'workload',
  'limit_usd',
  'soft_limit_pct',
  'action_on_hard',
];
const ACTIONS = ['pause', 'alert_only'] as const satisfies readonly Action[];
const LIMIT_MESSAGES = {
  required: 'limitRequired',
  invalid: 'limitInvalid',
  too_large: 'limitTooLarge',
} as const satisfies Record<LimitIssue, string>;
const SOFT_MESSAGES = {
  required: 'softRequired',
  invalid: 'softInvalid',
  range: 'softRange',
} as const satisfies Record<SoftLimitIssue, string>;

/** How the dialog ended: a budget was `created` or `saved`; it was `gone` (deleted by someone else); or `dismissed`. */
export type BudgetDialogOutcome = 'created' | 'saved' | 'gone' | 'dismissed';

export interface BudgetDialogProps {
  workspaceId: string;
  /** `'new'` adds a budget; a budget changes it; `null` keeps the dialog closed. */
  budget: Budget | 'new' | null;
  /** The group a new budget starts with ("Add AI budget" starts with the AI group). */
  initialGroup: BudgetGroup;
  projects: readonly BudgetsProject[];
  /** Whether the member may budget the whole workspace: a member limited to some projects may not. */
  allowWorkspace: boolean;
  /** The name of a scope: the workspace, or a project by its id. */
  scopeName: (projectId: string | null) => string;
  /** Called once with how the dialog ended, before it goes away. */
  onClose: (outcome: BudgetDialogOutcome) => void;
  /** Where focus goes when the dialog closes; by default back to what opened it. */
  finalFocus?: DialogProps['finalFocus'];
}

/**
 * Add or change a budget (20 section 5.19.2, 16 section 4): the scope and the group (fixed once made), the
 * monthly limit in dollars, the soft limit in percent and what reaching the hard limit does. A budget only
 * stores limits: nothing here starts a run, enables an engine or spends. A change sends only what differs.
 */
export function BudgetDialog({ budget, ...props }: BudgetDialogProps): ReactNode {
  if (budget === null) return null;
  return <BudgetForm key={budget === 'new' ? 'new' : budget.budget_id} budget={budget} {...props} />;
}

function BudgetForm({
  workspaceId,
  budget,
  initialGroup,
  projects,
  allowWorkspace,
  scopeName,
  onClose,
  finalFocus,
}: Omit<BudgetDialogProps, 'budget'> & { budget: Budget | 'new' }): ReactElement {
  const t = useTranslations('budgets.dialog');
  const errors = useTranslations('budgets.dialog.errors');
  const groups = useTranslations('budgets.groups');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const create = useMutation(CREATE_BUDGET);
  const update = useMutation(UPDATE_BUDGET);
  const [alert, setAlert] = useState<string | null>(null);
  const editing = budget === 'new' ? null : budget;
  const busy = create.isPending || update.isPending;

  const defaults = useMemo(
    (): BudgetValues =>
      editing === null
        ? {
            project_id: allowWorkspace ? WORKSPACE_SCOPE : (projects[0]?.id ?? ''),
            workload: initialGroup,
            limit_usd: '',
            soft_limit_pct: String(DEFAULT_SOFT_LIMIT),
            action_on_hard: 'pause',
          }
        : {
            project_id: editing.project_id ?? WORKSPACE_SCOPE,
            workload: editing.workload,
            limit_usd: editableLimit(editing.limit_usd),
            soft_limit_pct: String(editing.soft_limit_pct),
            action_on_hard: editing.action_on_hard,
          },
    [editing, allowWorkspace, projects, initialGroup],
  );

  const schema = useMemo(
    () =>
      z.object({
        project_id: z.string().min(1, { error: errors('projectUnknown') }),
        workload: z.custom<BudgetGroup>(isBudgetGroup),
        limit_usd: z.string().superRefine((value, context) => {
          const issue = limitIssue(value);
          if (issue !== null) context.addIssue({ code: 'custom', message: errors(LIMIT_MESSAGES[issue]) });
        }),
        soft_limit_pct: z.string().superRefine((value, context) => {
          const issue = softLimitIssue(value);
          if (issue !== null) context.addIssue({ code: 'custom', message: errors(SOFT_MESSAGES[issue]) });
        }),
        action_on_hard: z.enum(ACTIONS),
      }),
    [errors],
  );
  const form = useForm<BudgetValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: defaults,
  });

  const scopeOptions = [
    ...(allowWorkspace ? [{ value: WORKSPACE_SCOPE, label: scopeName(null) }] : []),
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ];
  const groupOptions = BUDGET_GROUPS.map((value) => ({ value, label: groups(GROUP_KEYS[value]) }));

  const finish = async (title: string, outcome: BudgetDialogOutcome): Promise<void> => {
    await refreshBudgets(queryClient, workspaceId);
    toast({ type: 'success', title });
    onClose(outcome);
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      const projectId = values.project_id === WORKSPACE_SCOPE ? null : values.project_id;
      const names = { scope: scopeName(projectId), group: groups(GROUP_KEYS[values.workload]) };
      try {
        if (editing === null) {
          await create.mutateAsync({
            params: { path: { workspace_id: workspaceId } },
            body: {
              ...(projectId === null ? {} : { project_id: projectId }),
              workload: values.workload,
              limit_usd: limitOf(values.limit_usd),
              soft_limit_pct: Number(values.soft_limit_pct),
              action_on_hard: values.action_on_hard,
            },
          });
          await finish(t('created', names), 'created');
          return;
        }
        const limit = limitOf(values.limit_usd);
        const soft = Number(values.soft_limit_pct);
        const body = {
          ...(limit === editableLimit(editing.limit_usd) ? {} : { limit_usd: limit }),
          ...(soft === editing.soft_limit_pct ? {} : { soft_limit_pct: soft }),
          ...(values.action_on_hard === editing.action_on_hard ? {} : { action_on_hard: values.action_on_hard }),
        };
        if (Object.keys(body).length === 0) {
          onClose('dismissed');
          return;
        }
        await update.mutateAsync({
          params: { path: { workspace_id: workspaceId, budget_id: editing.budget_id } },
          body,
        });
        await finish(t('saved', names), 'saved');
      } catch (error) {
        if (isApiProblem(error, 'duplicate')) {
          // A budget for the same scope, group and month: the scope is what to change
          form.setError('project_id', { type: 'server', message: errors('duplicate') }, { shouldFocus: true });
          return;
        }
        if (isApiProblem(error, 'validation_failed')) {
          const rest = applyServerErrors(form, error.errors, {
            fields: FIELDS,
            messages: { project_unknown: errors('projectUnknown') },
          });
          if (rest.length > 0) setAlert(t('saveFailed'));
          return;
        }
        if (isApiProblem(error, 'not_found') && editing !== null) {
          // Deleted by someone else while it was open: the list says so
          void refreshBudgets(queryClient, workspaceId);
          toast({ type: 'info', title: t('gone') });
          onClose('gone');
          return;
        }
        setAlert(isApiProblem(error, 'forbidden') ? t('forbidden') : t('saveFailed'));
      }
    }),
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose('dismissed');
      }}
      size="md"
      {...(finalFocus === undefined ? {} : { finalFocus })}
      dirty={form.formState.isDirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form noValidate className="contents" onSubmit={submit}>
        <DialogHeader
          title={editing === null ? t('createTitle') : t('editTitle')}
          description={editing === null ? t('createDescription') : t('editDescription')}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          {editing === null ? (
            <>
              <FormField
                control={form.control}
                name="project_id"
                label={t('scope')}
                width="medium"
                render={(field) => (
                  <Select<string>
                    {...field.controlProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t('scope')}
                    options={scopeOptions}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="workload"
                label={t('group')}
                width="medium"
                render={(field) => (
                  <Select<BudgetGroup>
                    {...field.controlProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t('group')}
                    options={groupOptions}
                  />
                )}
              />
            </>
          ) : (
            <ReadOnlyList>
              <ReadOnlyField label={t('scope')} value={scopeName(editing.project_id)} />
              <ReadOnlyField
                label={t('group')}
                value={groups(GROUP_KEYS[editing.workload])}
                reason={t('fixedReason')}
              />
            </ReadOnlyList>
          )}
          <FormField
            control={form.control}
            name="limit_usd"
            label={t('limit')}
            description={t('limitHint')}
            width="medium"
            render={(field) => (
              <InputGroup prefix={t('currencySign')}>
                <Input
                  {...field.controlProps}
                  variant="bare"
                  autoComplete="off"
                  inputMode="decimal"
                  className="num"
                  value={field.value}
                  onValueChange={field.onChange}
                />
              </InputGroup>
            )}
          />
          <FormField
            control={form.control}
            name="soft_limit_pct"
            label={t('softLimit')}
            description={t('softLimitHint')}
            width="short"
            render={(field) => (
              <InputGroup suffix={t('percentSign')}>
                <Input
                  {...field.controlProps}
                  variant="bare"
                  autoComplete="off"
                  inputMode="numeric"
                  className="num"
                  value={field.value}
                  onValueChange={field.onChange}
                />
              </InputGroup>
            )}
          />
          <FormField
            control={form.control}
            name="action_on_hard"
            label={t('action')}
            kind="group"
            render={(field) => (
              <RadioGroup<Action>
                legend={field.label}
                name={field.controlProps.name}
                focusRef={field.ref}
                value={field.value}
                onValueChange={field.onChange}
                options={[
                  { value: 'pause', label: t('pause'), description: t('pauseHint') },
                  { value: 'alert_only', label: t('alertOnly'), description: t('alertOnlyHint') },
                ]}
              />
            )}
          />
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary" disabled={busy}>
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={editing !== null && !form.formState.isDirty}
            >
              {editing === null ? t('create') : common('save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
