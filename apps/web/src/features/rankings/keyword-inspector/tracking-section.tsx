'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { DETAIL, refreshAfterWrite, type KeywordDetail, type KeywordScope } from './inspector-queries';
import { KeyValues, type KeyValue } from './key-values';
import { EditButton, useEditFocus, type SectionEdit } from './section-edit';
import { DEPTH_KEY, FUNNEL_STAGES, INTENTS, PRIORITIES, SOURCE_KEY, oneOf } from '../keyword-values';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { formatDetailDateTime } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { isWebUrl, MAX_URL_LENGTH } from '@/lib/urls/web-url';

interface TrackingValues {
  target_url: string;
  priority: string;
  intent: string;
  funnel_stage: string;
}

const valuesOf = (detail: KeywordDetail): TrackingValues => ({
  target_url: detail.target_url?.canonical_url ?? '',
  priority: String(detail.priority),
  intent: detail.intent,
  funnel_stage: detail.funnel_stage,
});

/**
 * How the keyword is tracked: target URL, priority, intent and funnel stage edit in place (16 section
 * 2.5, pessimistic: they shape what is measured); depth profile, schedule, source and who added it read
 * here. The depth profile changes through its own dialog, since it starts a configuration version.
 */
export function TrackingSection({
  scope,
  detail,
  timeZone,
  edit,
}: {
  scope: KeywordScope;
  detail: KeywordDetail;
  timeZone: string;
  edit: SectionEdit;
}): ReactElement {
  const t = useTranslations('rankings.inspector.tracking');
  const filters = useTranslations('rankings.filters');
  const focus = useEditFocus(edit.active);
  const intent = filters(`intents.${detail.intent}`);
  const added = formatDetailDateTime(detail.created_at, timeZone);
  const facts: KeyValue[] = [
    { id: 'target', label: t('targetUrl'), value: detail.target_url?.canonical_url ?? t('none') },
    { id: 'priority', label: t('priority'), value: t('priorityValue', { priority: String(detail.priority) }) },
    {
      id: 'intent',
      label: t('intent'),
      value: detail.intent_source === 'manual' ? t('intentManual', { intent }) : intent,
    },
    { id: 'stage', label: t('stage'), value: filters(`stages.${detail.funnel_stage}`) },
    { id: 'depth', label: t('depth'), value: filters(`depths.${DEPTH_KEY[detail.depth_profile]}`) },
    {
      id: 'schedule',
      label: t('schedule'),
      value:
        detail.schedule === null
          ? t('noSchedule')
          : t('scheduleValue', {
              name: detail.schedule.name,
              time: formatDetailDateTime(detail.schedule.next_run_at, timeZone),
            }),
    },
    { id: 'source', label: t('source'), value: filters(`sources.${SOURCE_KEY[detail.source]}`) },
    {
      id: 'added',
      label: t('added'),
      value: detail.created_by === null ? added : t('addedBy', { date: added, name: detail.created_by.name }),
    },
  ];
  return (
    <InspectorSection
      title={t('title')}
      icon={SlidersHorizontal}
      status="ready"
      action={edit.active ? null : <EditButton section={t('title')} edit={edit} buttonRef={focus.edit} />}
    >
      {edit.active ? (
        <TrackingForm scope={scope} detail={detail} edit={edit} formRef={focus.form} />
      ) : (
        <KeyValues items={facts} />
      )}
    </InspectorSection>
  );
}

function TrackingForm({
  scope,
  detail,
  edit,
  formRef,
}: {
  scope: KeywordScope;
  detail: KeywordDetail;
  edit: SectionEdit;
  formRef: RefObject<HTMLFormElement | null>;
}): ReactElement {
  const t = useTranslations('rankings.inspector.tracking');
  const inspector = useTranslations('rankings.inspector');
  const filters = useTranslations('rankings.filters');
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<string | null>(null);
  const priorityOptions = PRIORITIES.map((priority) => ({
    value: String(priority),
    label: t('priorityValue', { priority: String(priority) }),
  }));
  const intentOptions = INTENTS.map((value) => ({ value, label: filters(`intents.${value}`) }));
  const stageOptions = FUNNEL_STAGES.map((value) => ({ value, label: filters(`stages.${value}`) }));
  const schema = useMemo(
    () =>
      z.object({
        target_url: z
          .string()
          .trim()
          .max(MAX_URL_LENGTH, { error: t('targetUrlTooLong', { max: MAX_URL_LENGTH }) })
          .refine((url) => url === '' || isWebUrl(url), { error: t('targetUrlInvalid') }),
        priority: z.string(),
        intent: z.string(),
        funnel_stage: z.string(),
      }),
    [t],
  );
  const form = useForm<TrackingValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: valuesOf(detail),
  });
  const patch = useMutation(apiMutation('patch', DETAIL));
  const { isDirty, dirtyFields } = form.formState;
  const { setDirty, setSaving, stop } = edit;
  useEffect(() => setDirty(isDirty), [isDirty, setDirty]);

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      const targetUrl = values.target_url.trim();
      const intent = oneOf(values.intent, INTENTS);
      const stage = oneOf(values.funnel_stage, FUNNEL_STAGES);
      const body = {
        ...(dirtyFields.target_url === true ? { target_url: targetUrl === '' ? null : targetUrl } : {}),
        ...(dirtyFields.priority === true ? { priority: Number(values.priority) } : {}),
        ...(dirtyFields.intent === true && intent !== null ? { intent } : {}),
        ...(dirtyFields.funnel_stage === true && stage !== null ? { funnel_stage: stage } : {}),
      };
      if (Object.keys(body).length === 0) {
        stop();
        return;
      }
      setSaving(true);
      try {
        await patch.mutateAsync({
          params: {
            path: {
              workspace_id: scope.workspaceId,
              project_id: scope.projectId,
              tracked_keyword_id: scope.trackedKeywordId,
            },
          },
          body,
        });
        await refreshAfterWrite(queryClient, scope);
        announce(inspector('savedAnnouncement', { section: t('title') }));
        stop();
      } catch (error) {
        if (isApiProblem(error, 'validation_failed')) {
          const rest = applyServerErrors(form, error.errors, {
            fields: ['target_url', 'priority', 'intent', 'funnel_stage'],
            messages: { invalid_url: t('targetUrlInvalid') },
          });
          if (rest.length > 0) setAlert(inspector('saveFailed'));
          return;
        }
        setAlert(inspector('saveFailed'));
      } finally {
        setSaving(false);
      }
    }),
  );

  return (
    <form ref={formRef} id={edit.formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      {alert === null ? null : <FormAlert message={alert} />}
      <FormField
        control={form.control}
        name="target_url"
        label={t('targetUrl')}
        optional
        description={t('targetUrlHint')}
        render={(field) => (
          <Input
            {...field.controlProps}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      <FormField
        control={form.control}
        name="priority"
        label={t('priority')}
        render={(field) => (
          <Select<string>
            {...field.controlProps}
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t('priority')}
            options={priorityOptions}
          />
        )}
      />
      <FormField
        control={form.control}
        name="intent"
        label={t('intent')}
        description={t('intentHint')}
        render={(field) => (
          <Select<string>
            {...field.controlProps}
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t('intent')}
            options={intentOptions}
          />
        )}
      />
      <FormField
        control={form.control}
        name="funnel_stage"
        label={t('stage')}
        render={(field) => (
          <Select<string>
            {...field.controlProps}
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t('stage')}
            options={stageOptions}
          />
        )}
      />
    </form>
  );
}
