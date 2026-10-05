'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';

import { BulkDialog } from './bulk-dialog';
import { failureText } from './bulk-failure';
import { useEnsureGroups, useGroupChoices, type GroupChoice } from '../groups/group-choices';
import { GroupSelect } from '../groups/group-picker';
import { groupRefusal } from '../groups/group-refusals';
import type { ProjectScope } from '../rankings-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';

export interface MoveToGroupDialogProps {
  scope: ProjectScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countText: string;
  /**
   * Moves the keywords into the group, out of every other (or out of all with `null`); `others` are the
   * project's other groups. A rejection's message is shown in the dialog.
   */
  onApply: (groupId: string | null, others: string[], groupName: string | null) => Promise<void>;
  finalFocus: RefObject<HTMLElement | null>;
}

/**
 * Move to group: each chosen keyword leaves its other groups and joins the one chosen, or none. A path
 * typed for a group that does not exist is created when the form is saved, parents first.
 */
export function MoveToGroupDialog({
  scope,
  open,
  onOpenChange,
  countText,
  onApply,
  finalFocus,
}: MoveToGroupDialogProps): ReactElement {
  const t = useTranslations('rankings.bulk.groupDialog');
  const bulk = useTranslations('rankings.bulk');
  const refusals = useTranslations('rankings.groups.refusals');
  const groups = useGroupChoices(scope);
  const ensure = useEnsureGroups(scope);
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<{ group: GroupChoice | null }>({ defaultValues: { group: null } });
  const close = (): void => {
    form.reset({ group: null });
    setAlert(null);
    onOpenChange(false);
  };
  const submit = useSubmitOnce(
    form.handleSubmit(async ({ group }) => {
      setAlert(null);
      // A move takes the keywords out of the other groups, which it cannot name before they load
      if (!groups.ready) {
        setAlert(t('groupsUnavailable'));
        return;
      }
      if (group === null) {
        form.setError('group', { type: 'required', message: t('required') }, { shouldFocus: true });
        return;
      }
      let target: string | null = null;
      if (group.kind === 'existing') {
        target = group.groupId;
      } else if (group.kind === 'new') {
        try {
          target = (await ensure([group]))[0] ?? null;
        } catch (error) {
          setAlert(groupRefusal(error, refusals).message);
          return;
        }
      }
      // A group made just now has no members to leave
      const others = groups.choices.map((candidate) => candidate.groupId).filter((id) => id !== target);
      const name = group.kind === 'none' ? null : group.path;
      try {
        await onApply(target, others, name);
        close();
      } catch (error) {
        setAlert(failureText(error, bulk('failed')));
      }
    }),
  );
  return (
    <BulkDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('title', { count: countText })}
      description={t('description')}
      submitLabel={t('submit', { count: countText })}
      pending={form.formState.isSubmitting}
      alert={alert}
      dirty={form.formState.isDirty}
      onSubmit={submit}
      finalFocus={finalFocus}
    >
      <FormField
        control={form.control}
        name="group"
        label={t('group')}
        render={(field) => (
          <GroupSelect
            scope={scope}
            value={field.value}
            onValueChange={field.onChange}
            inputRef={field.controlProps.ref}
            onBlur={field.controlProps.onBlur}
            aria-required={field.controlProps['aria-required']}
          />
        )}
      />
    </BulkDialog>
  );
}
