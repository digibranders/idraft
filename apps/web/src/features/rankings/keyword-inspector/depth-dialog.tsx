'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { DETAIL, refreshAfterWrite, type KeywordDetail, type KeywordScope } from './inspector-queries';
import { DEPTH_KEY, DEPTH_PROFILES, OFFERED_DEPTH_PROFILES, oneOf } from '../keyword-values';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { applyServerErrors } from '@/lib/forms/apply-server-errors';
import { textLength } from '@/lib/text/length';

/** The API's limit on a change reason. */
const MAX_REASON_LENGTH = 500;

interface DepthValues {
  depth_profile: string;
  change_reason: string;
}

/**
 * A new depth profile changes how deep rank checks read the results and starts a configuration version,
 * so it is a dialog with an optional reason for the history, not an edit in place (16 section 2.5).
 */
export function DepthDialog({
  scope,
  detail,
  open,
  onOpenChange,
}: {
  scope: KeywordScope;
  detail: KeywordDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useTranslations('rankings.inspector.depthDialog');
  const inspector = useTranslations('rankings.inspector');
  const filters = useTranslations('rankings.filters');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<string | null>(null);
  // The profiles the API takes; the one the keyword holds stays named when it is not among them
  const depthOptions = useMemo(() => {
    const offered = OFFERED_DEPTH_PROFILES.map((value) => ({ value, label: filters(`depths.${DEPTH_KEY[value]}`) }));
    const held = oneOf(detail.depth_profile, DEPTH_PROFILES);
    return held === null || offered.some((option) => option.value === held)
      ? offered
      : [...offered, { value: held, label: filters(`depths.${DEPTH_KEY[held]}`), disabled: true }];
  }, [filters, detail.depth_profile]);
  const schema = useMemo(
    () =>
      z.object({
        depth_profile: z.string().refine((depth) => depth !== detail.depth_profile, { error: t('same') }),
        change_reason: z.string().refine((reason) => textLength(reason.trim()) <= MAX_REASON_LENGTH, {
          error: t('reasonTooLong', { max: MAX_REASON_LENGTH }),
        }),
      }),
    [t, detail.depth_profile],
  );
  const form = useForm<DepthValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { depth_profile: detail.depth_profile, change_reason: '' },
  });
  const reason = useWatch({ control: form.control, name: 'change_reason' });
  const patch = useMutation(apiMutation('patch', DETAIL));
  const close = (): void => {
    form.reset({ depth_profile: detail.depth_profile, change_reason: '' });
    setAlert(null);
    onOpenChange(false);
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      const depth = oneOf(values.depth_profile, DEPTH_PROFILES);
      if (depth === null) return;
      setAlert(null);
      const trimmed = values.change_reason.trim();
      try {
        await patch.mutateAsync({
          params: {
            path: {
              workspace_id: scope.workspaceId,
              project_id: scope.projectId,
              tracked_keyword_id: scope.trackedKeywordId,
            },
          },
          body: { depth_profile: depth, ...(trimmed === '' ? {} : { change_reason: trimmed }) },
        });
        await refreshAfterWrite(queryClient, scope);
        toast({ type: 'success', title: t('done') });
        close();
      } catch (error) {
        // A profile the API does not take yet is the field's problem, not a failed save
        if (isApiProblem(error, 'validation_failed')) {
          const rest = applyServerErrors(form, error.errors, {
            fields: ['depth_profile', 'change_reason'],
            messages: { depth_profile_not_available: t('notAvailable') },
          });
          if (rest.length === 0) return;
        }
        setAlert(inspector('saveFailed'));
      }
    }),
  );

  const length = textLength(reason.trim());
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!patch.isPending) close();
      }}
      size="sm"
      dirty={form.formState.isDirty}
      discard={{
        title: inspector('discard.title'),
        description: inspector('discard.description'),
        keepEditingLabel: inspector('discard.keepEditing'),
        discardLabel: inspector('discard.discard'),
      }}
    >
      <form noValidate className="contents" onSubmit={submit}>
        <DialogHeader
          title={t('title')}
          description={t('description', { keyword: detail.keyword.text, version: detail.config_version + 1 })}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <FormField
            control={form.control}
            name="depth_profile"
            label={t('depth')}
            render={(field) => (
              <Select<string>
                {...field.controlProps}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('depth')}
                options={depthOptions}
              />
            )}
          />
          <FormField
            control={form.control}
            name="change_reason"
            label={t('reason')}
            optional
            description={t('reasonHint')}
            render={(field) => (
              <Textarea
                {...field.controlProps}
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                counter={t('counter', { count: length, max: MAX_REASON_LENGTH })}
                counterOver={length > MAX_REASON_LENGTH}
              />
            )}
          />
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary">
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={patch.isPending}>
              {t('submit')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
