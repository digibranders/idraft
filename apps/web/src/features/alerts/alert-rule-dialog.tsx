'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  createBodyOf,
  isRankDrop,
  MAX_NAME_LENGTH,
  newRuleValues,
  PLATFORM_CODES,
  PLATFORM_KEY,
  POSITIONS_MAX,
  POSITIONS_MIN,
  RULE_TYPE_KEY,
  RULE_TYPES,
  updateBodyOf,
  valuesOfRule,
  wholeNumber,
  type RuleValues,
} from './alert-model';
import {
  alertRuleTypesQuery,
  CREATE_ALERT_RULE,
  refreshRules,
  UPDATE_ALERT_RULE,
  type AlertScope,
} from './alert-queries';
import { useGroupChoices, type GroupChoice } from './use-group-choices';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { AlertRule, RuleType } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';

/** How the dialog ended: a rule was `created` or `saved`, was `gone` (deleted by someone else), or was `dismissed`. */
export type AlertRuleDialogOutcome = 'created' | 'saved' | 'gone' | 'dismissed';

export interface AlertRuleDialogProps {
  scope: AlertScope;
  /** `'new'` makes a rule; a rule changes it; `null` keeps the dialog closed. */
  rule: AlertRule | 'new' | null;
  onClose: (outcome: AlertRuleDialogOutcome) => void;
}

/**
 * Add or change an alert rule (19 section 3.12): its name, its type (fixed once made), the groups and, for the
 * AI types, the platforms it is narrowed to, and for a rank rule how many positions a keyword must drop by.
 * A change sends only what differs.
 */
export function AlertRuleDialog({ rule, ...props }: AlertRuleDialogProps): ReactNode {
  if (rule === null) return null;
  return <RuleForm key={rule === 'new' ? 'new' : rule.id} rule={rule} {...props} />;
}

function RuleForm({
  scope,
  rule,
  onClose,
}: Omit<AlertRuleDialogProps, 'rule'> & { rule: AlertRule | 'new' }): ReactElement {
  const t = useTranslations('alerts');
  const d = useTranslations('alerts.dialog');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const hints = useMultiSelectHints();
  const queryClient = useQueryClient();
  const create = useMutation(CREATE_ALERT_RULE);
  const update = useMutation(UPDATE_ALERT_RULE);
  const [alert, setAlert] = useState<string | null>(null);
  const editing = rule === 'new' ? null : rule;
  const choices = useGroupChoices(scope);
  const offered = useQuery(alertRuleTypesQuery());

  const schema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, { error: d('nameRequired') })
            .refine((name) => textLength(name) <= MAX_NAME_LENGTH, {
              error: d('nameTooLong', { max: MAX_NAME_LENGTH }),
            }),
          rule_type: z.enum(RULE_TYPES),
          groups: z.array(z.string()),
          platforms: z.array(z.string()),
          positions: z.string(),
        })
        .superRefine((values, context) => {
          if (isRankDrop(values.rule_type) && wholeNumber(values.positions, POSITIONS_MIN, POSITIONS_MAX) === null) {
            context.addIssue({
              code: 'custom',
              path: ['positions'],
              message: d('positionsInvalid', { min: POSITIONS_MIN, max: POSITIONS_MAX }),
            });
          }
        }),
    [d],
  );
  const form = useForm<RuleValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: editing === null ? newRuleValues() : valuesOfRule(editing),
  });
  const type = useWatch({ control: form.control, name: 'rule_type' });
  const rank = isRankDrop(type);
  const busy = create.isPending || update.isPending;

  // The types the API offers; until they are read, or if it lists none, every type this version knows
  const typeOptions = useMemo(() => {
    const served = new Set<RuleType>((offered.data?.data ?? []).map((item) => item.rule_type));
    const known = RULE_TYPES.filter((value) => served.size === 0 || served.has(value));
    return known.map((value) => ({
      value,
      label: t(`types.${RULE_TYPE_KEY[value]}.label`),
      description: t(`types.${RULE_TYPE_KEY[value]}.hint`),
    }));
  }, [offered.data, t]);
  const groupItems: readonly GroupChoice[] = rank ? choices.keyword : choices.prompt;
  const platformItems = PLATFORM_CODES.map((code): GroupChoice => ({
    id: code,
    label: t(`platforms.${PLATFORM_KEY[code]}`),
  }));

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };
      try {
        if (editing === null) {
          const made = await create.mutateAsync({ params: { path }, body: createBodyOf(values) });
          await refreshRules(queryClient, scope);
          toast({ type: 'success', title: t('created', { name: made.data.name }) });
          onClose('created');
          return;
        }
        const body = updateBodyOf(values, editing);
        if (Object.keys(body).length === 0) {
          onClose('dismissed');
          return;
        }
        const saved = await update.mutateAsync({ params: { path: { ...path, alert_rule_id: editing.id } }, body });
        await refreshRules(queryClient, scope);
        toast({ type: 'success', title: t('saved', { name: saved.data.name }) });
        onClose('saved');
      } catch (error) {
        if (isApiProblem(error, 'not_found') && editing !== null) {
          void refreshRules(queryClient, scope);
          toast({ type: 'info', title: t('gone', { name: editing.name }) });
          onClose('gone');
          return;
        }
        if (isApiProblem(error, 'invalid_params') || isApiProblem(error, 'validation_failed')) {
          setAlert(d('invalidParams'));
          return;
        }
        setAlert(isApiProblem(error, 'forbidden') ? d('forbidden') : d('saveFailed'));
      }
    }),
  );

  const labelOf = (id: string): string => groupItems.find((item) => item.id === id)?.label ?? t('removedGroup');

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose('dismissed');
      }}
      size="md"
      dirty={form.formState.isDirty}
      discard={{
        title: discard('title'),
        description: d('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form noValidate className="contents" onSubmit={submit}>
        <DialogHeader
          title={editing === null ? d('createTitle') : d('editTitle', { name: editing.name })}
          description={editing === null ? d('createDescription') : undefined}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          {choices.failed ? <FormAlert message={d('readFailed')} /> : null}
          <FormField
            control={form.control}
            name="name"
            label={d('name')}
            render={(field) => (
              <Input {...field.controlProps} autoComplete="off" value={field.value} onValueChange={field.onChange} />
            )}
          />
          {editing === null ? (
            <FormField
              control={form.control}
              name="rule_type"
              label={d('type')}
              render={(field) => (
                <Select<RuleType>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={(next) => {
                    field.onChange(next);
                    // The groups of one kind are not the groups of the other
                    form.setValue('groups', [], { shouldDirty: true });
                  }}
                  placeholder={d('type')}
                  options={typeOptions}
                />
              )}
            />
          ) : (
            <ReadOnlyList>
              <ReadOnlyField
                label={d('type')}
                value={t(`types.${RULE_TYPE_KEY[editing.rule_type]}.label`)}
                reason={d('typeFixed')}
              />
            </ReadOnlyList>
          )}
          {choices.failed ? (
            <div>
              <Button type="button" variant="secondary" onClick={choices.retry}>
                {common('retry')}
              </Button>
            </div>
          ) : (
            <FormField
              control={form.control}
              name="groups"
              label={d('groups')}
              optional
              description={rank ? d('groupsSeoHint') : d('groupsAiHint')}
              render={(field) => (
                <MultiSelect<GroupChoice>
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  value={field.value.map((id) => ({ id, label: labelOf(id) }))}
                  onValueChange={(chosen) => field.onChange(chosen.map((choice) => choice.id))}
                  items={groupItems}
                  itemToString={(choice) => choice.label}
                  itemKey={(choice) => choice.id}
                  placeholder={d('groupsPlaceholder')}
                  emptyText={(query) => d('groupsEmpty', { query })}
                  chipsLabel={d('groupsChips')}
                  removeLabel={(value) => d('removeValue', { value })}
                  {...hints}
                />
              )}
            />
          )}
          {rank ? (
            <FormField
              control={form.control}
              name="positions"
              label={d('positions')}
              description={d('positionsHint')}
              width="short"
              render={(field) => (
                <Input {...field.controlProps} inputMode="numeric" value={field.value} onValueChange={field.onChange} />
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="platforms"
              label={d('platforms')}
              optional
              description={d('platformsHint')}
              render={(field) => (
                <MultiSelect<GroupChoice>
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  value={field.value.map((id) => platformItems.find((item) => item.id === id) ?? { id, label: id })}
                  onValueChange={(chosen) => field.onChange(chosen.map((choice) => choice.id))}
                  items={platformItems}
                  itemToString={(choice) => choice.label}
                  itemKey={(choice) => choice.id}
                  placeholder={d('platformsPlaceholder')}
                  emptyText={(query) => d('platformsEmpty', { query })}
                  chipsLabel={d('platformsChips')}
                  removeLabel={(value) => d('removeValue', { value })}
                  {...hints}
                />
              )}
            />
          )}
          <p className="type-meta">{d('sent')}</p>
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
            <Button type="submit" variant="primary" loading={busy} disabled={choices.pending}>
              {editing === null ? d('create') : common('save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
