'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { CREATE_SCHEDULE, refreshSchedules, UPDATE_SCHEDULE, type ScheduleScope } from './schedule-queries';
import {
  CADENCES,
  createBodyOf,
  DEFAULT_SELECTOR_MODE,
  errorMessageKey,
  errorTarget,
  isClock,
  KEYWORD_PRIORITIES,
  MAX_NAME_LENGTH,
  MAX_STALE_DAYS,
  MONTH_DAYS,
  newScheduleValues,
  PROVIDER_MODE_KEYS,
  PROVIDER_MODES,
  SCHEDULE_PRIORITIES,
  SCHEDULE_WORKLOADS,
  SELECTOR_MODES,
  updateBodyOf,
  valuesOfSchedule,
  WEEKDAYS,
  WINDOW_HOURS,
  wholeNumber,
  WORKLOAD_SELECTOR_MODES,
  type EditableSchedule,
  type ScheduleValues,
  type SelectorMode,
} from './schedule-model';
import { FormField } from '@/components/app/forms/form-field';
import { TimeZoneCombobox } from '@/components/app/forms/time-zone-combobox';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup } from '@/components/ui/radio-group';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { ApiProblem, isApiProblem } from '@/lib/api/problem';
import type { Schedule, ValidationItem } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/forms';
import { formatTableDateTime } from '@/lib/format';
import { useKeywordGroups, useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';
import { textLength } from '@/lib/text/length';

/** The weekdays in the order a week is read, Monday first; the API's numbers are Sunday 0. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Every control of the form, by the name the API's errors are put under. */
const FIELDS: readonly (keyof ScheduleValues)[] = [
  'name',
  'workload',
  'cadence',
  'weekday',
  'month_day',
  'window_start_local',
  'window_hours',
  'timezone',
  'priority',
  'provider_mode',
  'selector_mode',
  'stale_days',
  'priority_lte',
  'groups',
  'terms',
];

/** A group or a term a selector can name, as its chip shows it. */
interface Choice {
  id: string;
  label: string;
}

export interface ScheduleDialogProps {
  scope: ScheduleScope;
  /** `'new'` makes a schedule; a schedule changes it; `null` keeps the dialog closed. */
  schedule: EditableSchedule | 'new' | null;
  /** The project's time zone, which a new schedule starts in. */
  timeZone: string;
  onClose: () => void;
  /**
   * Where focus goes when the dialog closes, when what opened it may be gone by then (the button of an empty
   * list); by default back to what opened it.
   */
  finalFocus?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Create or change a schedule (20 section 5.19.8, 16 section 4): its name, workload (fixed once made),
 * cadence with its day, time and window in a time zone, priority, provider mode (rank schedules only) and the
 * selector of the keywords it collects. A change sends only what differs, since any change of the rule moves
 * the next run.
 */
export function ScheduleDialog({ schedule, ...props }: ScheduleDialogProps): ReactNode {
  if (schedule === null) return null;
  return <ScheduleForm key={schedule === 'new' ? 'new' : schedule.schedule_id} schedule={schedule} {...props} />;
}

function ScheduleForm({
  scope,
  schedule,
  timeZone,
  onClose,
  finalFocus,
}: Omit<ScheduleDialogProps, 'schedule'> & { schedule: EditableSchedule | 'new' }): ReactElement {
  const t = useTranslations('projectSettings.schedules.dialog');
  const errors = useTranslations('projectSettings.schedules.errors');
  const toasts = useTranslations('projectSettings.schedules');
  const days = useTranslations('common.weekdays');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const workloadName = useWorkloadName();
  const create = useMutation(CREATE_SCHEDULE);
  const update = useMutation(UPDATE_SCHEDULE);
  const [alert, setAlert] = useState<string | null>(null);
  const editing = schedule === 'new' ? null : schedule;
  const defaults = useMemo(
    () => (editing === null ? newScheduleValues(timeZone) : valuesOfSchedule(editing)),
    [editing, timeZone],
  );
  const groups = useKeywordGroups(scope);
  const vocabularies = useVocabularies(scope);

  const schema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, { error: t('nameRequired') })
            .refine((name) => textLength(name) <= MAX_NAME_LENGTH, {
              error: t('nameTooLong', { max: MAX_NAME_LENGTH }),
            }),
          workload: z.enum(SCHEDULE_WORKLOADS),
          cadence: z.enum(CADENCES),
          weekday: z.string(),
          month_day: z.string(),
          window_start_local: z.string().trim(),
          window_hours: z.string(),
          timezone: z.string().min(1, { error: errors('timezoneUnknown') }),
          priority: z.enum(SCHEDULE_PRIORITIES),
          provider_mode: z.enum(PROVIDER_MODES),
          selector_mode: z.enum(SELECTOR_MODES),
          stale_days: z.string(),
          priority_lte: z.string(),
          groups: z.array(z.string()),
          terms: z.array(z.string()),
        })
        .superRefine((values, context) => {
          if (!isClock(values.window_start_local)) {
            context.addIssue({ code: 'custom', path: ['window_start_local'], message: errors('timeInvalid') });
          }
          if (values.selector_mode === 'stale' && wholeNumber(values.stale_days, 1, MAX_STALE_DAYS) === null) {
            context.addIssue({ code: 'custom', path: ['stale_days'], message: t('staleDaysInvalid') });
          }
          if (values.selector_mode === 'groups' && values.groups.length === 0 && values.terms.length === 0) {
            context.addIssue({ code: 'custom', path: ['groups'], message: t('groupsOrTermsRequired') });
          }
        }),
    [t, errors],
  );
  const form = useForm<ScheduleValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: defaults,
  });
  const cadence = useWatch({ control: form.control, name: 'cadence' });
  const workload = useWatch({ control: form.control, name: 'workload' });
  const selectorMode = useWatch({ control: form.control, name: 'selector_mode' });
  const busy = create.isPending || update.isPending;

  const groupChoices = useMemo(
    (): Choice[] => (groups.data?.data ?? []).map((group) => ({ id: group.group_id, label: group.path })),
    [groups.data],
  );
  const termChoices = useMemo(
    (): Choice[] =>
      vocabularies.loaded.flatMap(({ vocabulary, terms }) =>
        terms.map((term) => ({
          id: term.termId,
          label: toasts('selector.termName', { vocabulary: vocabulary.name, term: term.path }),
        })),
      ),
    [vocabularies.loaded, toasts],
  );
  const taxonomyPending = groups.isPending || vocabularies.pending;
  const taxonomyFailed = groups.isError || vocabularies.error;

  const weekdayOptions = WEEK_ORDER.map((index) => ({ value: String(index), label: days(WEEKDAYS[index]) }));
  const modeOptions = WORKLOAD_SELECTOR_MODES[workload].map((mode) => ({
    value: mode,
    label: t(`selectorModes.${mode}`),
    description: t(`selectorModeHints.${mode}`),
  }));

  const finish = async (saved: Schedule, title: string): Promise<void> => {
    await refreshSchedules(queryClient, scope);
    toast({
      type: 'success',
      title,
      description: toasts('nextRun', { when: formatTableDateTime(saved.next_run_at, saved.timezone) }),
    });
    onClose();
  };

  const showErrors = (items: readonly ValidationItem[]): void => {
    const onFields: ValidationItem[] = [];
    const others: ValidationItem[] = [];
    for (const item of items) {
      const target = errorTarget(item);
      if (target.field === null) {
        others.push(item);
        continue;
      }
      const key = errorMessageKey(target.key);
      onFields.push({
        ...item,
        path: target.field,
        code: target.key,
        message: key === null ? item.message : errors(key),
      });
    }
    const rest = [...others, ...applyServerErrors(form, onFields, { fields: FIELDS })];
    if (rest.length === 0) return;
    setAlert(
      rest.some((item) => item.path === '' && item.code === 'value_error') ? t('daysMismatch') : t('saveFailed'),
    );
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      try {
        if (editing === null) {
          const made = await create.mutateAsync({
            params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
            body: createBodyOf(values),
          });
          await finish(made.data, toasts('created', { name: made.data.name }));
          return;
        }
        const body = updateBodyOf(values, editing);
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const saved = await update.mutateAsync({
          params: {
            path: {
              workspace_id: scope.workspaceId,
              project_id: scope.projectId,
              schedule_id: editing.schedule_id,
            },
          },
          body,
        });
        await finish(saved.data, toasts('saved', { name: saved.data.name }));
      } catch (error) {
        if (isApiProblem(error, 'validation_failed')) {
          showErrors(error.errors);
          return;
        }
        if (isApiProblem(error, 'not_found') && editing !== null) {
          // Deleted by someone else while it was open: the list says so
          void refreshSchedules(queryClient, scope);
          toast({ type: 'info', title: toasts('gone', { name: editing.name }) });
          onClose();
          return;
        }
        if (error instanceof ApiProblem && error.status === 409) {
          void refreshSchedules(queryClient, scope);
          setAlert(t('conflict'));
          return;
        }
        setAlert(isApiProblem(error, 'forbidden') ? t('forbidden') : t('saveFailed'));
      }
    }),
  );

  const changeWorkload = (next: ScheduleValues['workload']): void => {
    form.setValue('workload', next, { shouldDirty: true });
    // A selector the new workload does not take gives way to its own first choice
    const current = form.getValues('selector_mode');
    if (!WORKLOAD_SELECTOR_MODES[next].includes(current)) form.setValue('selector_mode', DEFAULT_SELECTOR_MODE[next]);
    form.setValue('provider_mode', 'standard_queue');
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
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
          title={editing === null ? t('createTitle') : t('editTitle', { name: editing.name })}
          description={editing === null ? t('createDescription') : undefined}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <FormField
            control={form.control}
            name="name"
            label={t('name')}
            render={(field) => (
              <Input {...field.controlProps} autoComplete="off" value={field.value} onValueChange={field.onChange} />
            )}
          />
          {editing === null ? (
            <FormField
              control={form.control}
              name="workload"
              label={t('workload')}
              width="medium"
              render={(field) => (
                <Select<ScheduleValues['workload']>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={changeWorkload}
                  placeholder={t('workload')}
                  options={SCHEDULE_WORKLOADS.map((value) => ({ value, label: workloadName(value) }))}
                />
              )}
            />
          ) : (
            <ReadOnlyList>
              <ReadOnlyField label={t('workload')} value={workloadName(editing.workload)} reason={t('workloadFixed')} />
            </ReadOnlyList>
          )}
          <div className="flex flex-wrap gap-4">
            <FormField
              control={form.control}
              name="cadence"
              label={t('cadence')}
              width="medium"
              render={(field) => (
                <Select<ScheduleValues['cadence']>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('cadence')}
                  options={CADENCES.map((value) => ({ value, label: t(`cadences.${value}`) }))}
                />
              )}
            />
            {cadence === 'weekly' ? (
              <FormField
                control={form.control}
                name="weekday"
                label={t('weekday')}
                width="medium"
                render={(field) => (
                  <Select<string>
                    {...field.controlProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t('weekday')}
                    options={weekdayOptions}
                  />
                )}
              />
            ) : null}
            {cadence === 'monthly' ? (
              <FormField
                control={form.control}
                name="month_day"
                label={t('monthDay')}
                description={t('monthDayHint')}
                width="medium"
                render={(field) => (
                  <Select<string>
                    {...field.controlProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t('monthDay')}
                    options={MONTH_DAYS.map((day) => ({ value: String(day), label: t('monthDayOption', { day }) }))}
                  />
                )}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4">
            <FormField
              control={form.control}
              name="window_start_local"
              label={t('time')}
              description={t('timeHint')}
              width="medium"
              render={(field) => (
                <Input
                  {...field.controlProps}
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="06:00"
                  value={field.value}
                  onValueChange={field.onChange}
                />
              )}
            />
            <FormField
              control={form.control}
              name="window_hours"
              label={t('window')}
              description={t('windowHint')}
              width="medium"
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('window')}
                  options={WINDOW_HOURS.map((hours) => ({
                    value: String(hours),
                    label: t('windowOption', { hours }),
                  }))}
                />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="timezone"
            label={t('timezone')}
            description={t('timezoneHint')}
            render={(field) => (
              <TimeZoneCombobox
                name={field.controlProps.name}
                inputRef={field.controlProps.ref}
                onBlur={field.controlProps.onBlur}
                disabled={field.controlProps.disabled}
                aria-required={field.controlProps['aria-required']}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
          <div className="flex flex-wrap gap-4">
            <FormField
              control={form.control}
              name="priority"
              label={t('priority')}
              description={t('priorityHint')}
              width="medium"
              render={(field) => (
                <Select<ScheduleValues['priority']>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('priority')}
                  options={SCHEDULE_PRIORITIES.map((value) => ({ value, label: t(`priorities.${value}`) }))}
                />
              )}
            />
            {workload === 'seo_rank' ? (
              <FormField
                control={form.control}
                name="provider_mode"
                label={t('providerMode')}
                width="medium"
                render={(field) => (
                  <Select<ScheduleValues['provider_mode']>
                    {...field.controlProps}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={t('providerMode')}
                    options={PROVIDER_MODES.map((value) => ({
                      value,
                      label: t(`providerModes.${PROVIDER_MODE_KEYS[value]}`),
                      description: t(`providerModeHints.${PROVIDER_MODE_KEYS[value]}`),
                    }))}
                  />
                )}
              />
            ) : null}
          </div>
          <FormField
            control={form.control}
            name="selector_mode"
            label={t('selector')}
            kind="group"
            render={(field) => (
              <RadioGroup<SelectorMode>
                legend={field.label}
                name={field.controlProps.name}
                focusRef={field.ref}
                value={field.value}
                onValueChange={field.onChange}
                options={modeOptions}
              />
            )}
          />
          {selectorMode === 'stale' ? (
            <FormField
              control={form.control}
              name="stale_days"
              label={t('staleDays')}
              description={t('staleDaysHint')}
              width="short"
              render={(field) => (
                <Input {...field.controlProps} inputMode="numeric" value={field.value} onValueChange={field.onChange} />
              )}
            />
          ) : null}
          {selectorMode === 'priority' ? (
            <FormField
              control={form.control}
              name="priority_lte"
              label={t('priorityLte')}
              width="medium"
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('priorityLte')}
                  options={KEYWORD_PRIORITIES.map((priority) => ({
                    value: String(priority),
                    label: t('priorityOption', { priority }),
                  }))}
                />
              )}
            />
          ) : null}
          {selectorMode === 'groups' ? (
            taxonomyPending ? (
              <p className="type-meta">{t('reading')}</p>
            ) : taxonomyFailed ? (
              <FormAlert message={t('readFailed')} />
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="groups"
                  label={t('groups')}
                  optional
                  render={(field) => (
                    <MultiSelect<Choice>
                      inputRef={field.ref}
                      onBlur={field.onBlur}
                      value={field.value.map(
                        (id) => groupChoices.find((choice) => choice.id === id) ?? { id, label: t('removedGroup') },
                      )}
                      onValueChange={(chosen) => field.onChange(chosen.map((choice) => choice.id))}
                      items={groupChoices}
                      itemToString={(choice) => choice.label}
                      itemKey={(choice) => choice.id}
                      placeholder={t('groupsPlaceholder')}
                      emptyText={(query) => t('groupsEmpty', { query })}
                      chipsLabel={t('groupsChips')}
                      removeLabel={(value) => t('removeValue', { value })}
                      chipsHint={(count) => t('chipsHint', { count })}
                      chipHint={t('chipHint')}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="terms"
                  label={t('terms')}
                  optional
                  render={(field) => (
                    <MultiSelect<Choice>
                      inputRef={field.ref}
                      onBlur={field.onBlur}
                      value={field.value.map(
                        (id) => termChoices.find((choice) => choice.id === id) ?? { id, label: t('removedTerm') },
                      )}
                      onValueChange={(chosen) => field.onChange(chosen.map((choice) => choice.id))}
                      items={termChoices}
                      itemToString={(choice) => choice.label}
                      itemKey={(choice) => choice.id}
                      placeholder={t('termsPlaceholder')}
                      emptyText={(query) => t('termsEmpty', { query })}
                      chipsLabel={t('termsChips')}
                      removeLabel={(value) => t('removeValue', { value })}
                      chipsHint={(count) => t('chipsHint', { count })}
                      chipHint={t('chipHint')}
                    />
                  )}
                />
              </>
            )
          ) : null}
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
            <Button type="submit" variant="primary" loading={busy}>
              {editing === null ? t('create') : common('save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
