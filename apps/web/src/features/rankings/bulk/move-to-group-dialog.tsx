'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';

import { BulkDialog } from './bulk-dialog';
import { failureText } from './bulk-failure';
import type { ProjectScope } from '../rankings-queries';
import { useKeywordGroups } from '../taxonomy-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Select } from '@/components/ui/select';

/** "No group": group ids are UUIDs, so this never names one. */
const NO_GROUP = 'none';

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

/** Move to group: each chosen keyword leaves its other groups and joins the one chosen, or none. */
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
  const groups = useKeywordGroups(scope);
  const list = groups.data?.data ?? [];
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<{ group: string | null }>({ defaultValues: { group: null } });
  const options = [
    { value: NO_GROUP, label: t('none'), description: t('noneHint') },
    ...list.map((group) => ({ value: group.group_id, label: group.path })),
  ];
  const close = (): void => {
    form.reset({ group: null });
    setAlert(null);
    onOpenChange(false);
  };
  const submit = useSubmitOnce(
    form.handleSubmit(async ({ group }) => {
      setAlert(null);
      // A move takes the keywords out of the other groups, which it cannot name before they load
      if (!groups.isSuccess) {
        setAlert(t('groupsUnavailable'));
        return;
      }
      if (group === null) {
        form.setError('group', { type: 'required', message: t('required') }, { shouldFocus: true });
        return;
      }
      const target = group === NO_GROUP ? null : group;
      const others = list.map((candidate) => candidate.group_id).filter((id) => id !== target);
      const name = list.find((candidate) => candidate.group_id === target)?.path ?? null;
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
          <Select<string>
            {...field.controlProps}
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t('placeholder')}
            options={options}
          />
        )}
      />
    </BulkDialog>
  );
}
