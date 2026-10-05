'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { AddKeywordsResult, type AddOutcome } from './add-keywords-result';
import { useEnsureGroups, useGroupPathCheck, type GroupChoice } from '../groups/group-choices';
import { GroupPicker } from '../groups/group-picker';
import { groupRefusal } from '../groups/group-refusals';
import { PRIORITIES } from '../keyword-values';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { refreshGroups } from '../taxonomy-queries';
import { useTermChoices } from '../term-choices';
import { FormField } from '@/components/app/forms/form-field';
import { LocationCombobox } from '@/components/app/forms/location-combobox';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';
import { formatInteger, formatList } from '@/lib/format';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { MAX_KEYWORDS_PER_ADD, readKeywordLines, type KeywordLines } from '@/lib/keywords/keyword-lines';
import { MAX_KEYWORD_LENGTH, type KeywordTextProblem } from '@/lib/keywords/keyword-text';
import { useLocationSearch } from '@/lib/locations/use-location-search';

type LocationRef = components['schemas']['LocationRef'];
type Device = 'desktop' | 'mobile' | 'both';

const BULK_CREATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-create';
const SETTINGS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings';
/** A new keyword's priority unless the person picks another, as the API defaults it. */
const DEFAULT_PRIORITY = '3';
/** The lines a refused list names before it counts the rest. */
const NAMED_PROBLEMS = 3;

const PROBLEM_KEY = {
  keyword_invalid: 'keywordInvalid',
  keyword_missing: 'keywordMissing',
  keyword_too_long: 'keywordTooLong',
  search_operator_not_allowed: 'searchOperatorNotAllowed',
} as const satisfies Record<KeywordTextProblem, string>;

const isKeywordProblem = (code: string): code is KeywordTextProblem => Object.hasOwn(PROBLEM_KEY, code);

interface AddValues {
  keywords: string;
  location: LocationRef | null;
  language_code: string;
  /** `null` until the project's default arrives (or when it cannot be read): the API then applies it. */
  device: Device | null;
  /** Groups that exist, and paths typed to be created when the form is saved. */
  groups: GroupChoice[];
  term_ids: string[];
  priority: string;
}

/** A term as a choice: its id and the label the list shows. */
interface Choice {
  id: string;
  label: string;
}

export interface ProjectDefaults {
  /** Where rank checks look unless a keyword says otherwise. */
  location: LocationRef | null;
  languageCode: string | null;
}

export interface AddKeywordsDialogProps {
  scope: ProjectScope;
  defaults: ProjectDefaults;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a keyword the project tracks already, from the result: "Show it". */
  onShowKeyword: (trackedKeywordId: string, archived: boolean) => void;
}

/**
 * Add keywords (24-page-templates.md section 9.3, 16-drawers-dialogs-popovers.md section 4.6): a 560 px
 * dialog with the keywords one per line and what they share: location, language, device, groups, tags and
 * priority. The list is read as the API reads it before it is sent, so a refused line is named by its
 * number. Over the plan's keyword limit nothing is added and the dialog says by how much. When some
 * keywords were tracked already or refused, the dialog shows which, with "Show it" and "Unarchive".
 */
export function AddKeywordsDialog({
  scope,
  defaults,
  open,
  onOpenChange,
  onShowKeyword,
}: AddKeywordsDialogProps): ReactElement {
  const t = useTranslations('rankings.add');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const refusals = useTranslations('rankings.groups.refusals');
  const filters = useTranslations('rankings.filters');
  const tracking = useTranslations('rankings.inspector.tracking');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const locations = useLocationSearch();
  const projectPath = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const settings = useQuery({ ...apiQuery(SETTINGS, { params: { path: projectPath } }), enabled: open });
  const ensureGroups = useEnsureGroups(scope);
  const checkGroupPaths = useGroupPathCheck();
  const [alert, setAlert] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AddOutcome | null>(null);

  const problemText = (problem: KeywordTextProblem): string =>
    problem === 'keyword_too_long'
      ? t('problems.keywordTooLong', { max: MAX_KEYWORD_LENGTH })
      : t(`problems.${PROBLEM_KEY[problem]}`);
  /** The same problem as a sentence of its own, under a keyword the API refused. */
  const rejectedReason = (problem: KeywordTextProblem): string =>
    problem === 'keyword_too_long'
      ? t('rejectedReasons.keywordTooLong', { max: MAX_KEYWORD_LENGTH })
      : t(`rejectedReasons.${PROBLEM_KEY[problem]}`);
  const listError = (lines: KeywordLines): string | null => {
    if (lines.problems.length > 0) {
      const named = lines.problems
        .slice(0, NAMED_PROBLEMS)
        .map(({ line, problem }) => t('lineProblem', { line, problem: problemText(problem) }));
      const more = lines.problems.length - NAMED_PROBLEMS;
      return formatList([...named, ...(more > 0 ? [t('moreProblems', { count: more })] : [])], locale);
    }
    if (lines.keywords.length === 0) return t('keywordsRequired');
    if (lines.keywords.length > MAX_KEYWORDS_PER_ADD) {
      return t('tooMany', { max: formatInteger(MAX_KEYWORDS_PER_ADD), count: formatInteger(lines.keywords.length) });
    }
    return null;
  };

  const schema = z.object({
    keywords: z.string().superRefine((text, context) => {
      const error = listError(readKeywordLines(text));
      if (error !== null) context.addIssue({ code: 'custom', message: error });
    }),
    location: z.custom<LocationRef | null>().refine((location) => location !== null, { error: t('locationRequired') }),
    language_code: z.string(),
    device: z.enum(['desktop', 'mobile', 'both']).nullable(),
    groups: z.array(z.custom<GroupChoice>()),
    term_ids: z.array(z.string()),
    priority: z.string(),
  });
  const initialValues = (device: Device | null): AddValues => ({
    keywords: '',
    location: defaults.location,
    language_code: defaults.languageCode ?? 'en',
    device,
    groups: [],
    term_ids: [],
    priority: DEFAULT_PRIORITY,
  });
  const form = useForm<AddValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: initialValues(null),
  });
  // The project's default device arrives with its settings; a person who chose one already keeps it
  const defaultDevice = settings.data?.data.seo?.default_device ?? null;
  useEffect(() => {
    if (defaultDevice !== null && !form.getFieldState('device').isDirty) {
      form.resetField('device', { defaultValue: defaultDevice });
    }
  }, [defaultDevice, form]);

  const text = useWatch({ control: form.control, name: 'keywords' });
  const device = useWatch({ control: form.control, name: 'device' });
  const lines = useMemo(() => readKeywordLines(text), [text]);
  const keywordCount = lines.keywords.length;
  const create = useMutation(apiMutation('post', BULK_CREATE));

  const { choices: terms, byId: termById, keepOnePerSingleVocabulary } = useTermChoices(scope);

  const close = (): void => {
    form.reset(initialValues(defaultDevice));
    setAlert(null);
    setOutcome(null);
    onOpenChange(false);
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      // A typed path that cannot become a group is named before anything is created or sent
      const pathError = checkGroupPaths(values.groups);
      if (pathError !== null) {
        form.setError('groups', { type: 'server', message: pathError }, { shouldFocus: true });
        return;
      }
      // Groups typed and not yet made are made now, so cancelling the form leaves none behind
      let groupIds: string[];
      try {
        groupIds = await ensureGroups(values.groups);
      } catch (error) {
        setAlert(groupRefusal(error, refusals).message);
        return;
      }
      const read = readKeywordLines(values.keywords);
      // Created counts tracked keywords: with both devices, two of each keyword
      const both = values.device === 'both' ? 'yes' : 'no';
      const items = read.keywords.map(({ keyword }) => ({
        keyword,
        search_engine: 'google' as const,
        funnel_stage: 'unknown' as const,
        location_id: values.location?.location_id ?? null,
        language_code: values.language_code,
        ...(values.device === null ? {} : { device: values.device }),
        priority: Number(values.priority),
        ...(groupIds.length === 0 ? {} : { group_ids: groupIds }),
        ...(values.term_ids.length === 0 ? {} : { term_ids: values.term_ids }),
      }));
      try {
        const answer = await create.mutateAsync({
          params: { path: projectPath },
          body: { items, on_duplicate: 'skip' },
        });
        void refreshKeywords(queryClient, scope);
        void refreshGroups(queryClient, scope);
        const { created, restored, skipped, rejected } = answer.data;
        if (skipped.length === 0 && rejected.length === 0) {
          // A deleted keyword comes back with its old settings and history, which the person is told (D3)
          toast({
            type: 'success',
            title: t('added', { count: created.length, both }),
            description:
              restored.length === 0
                ? t('addedDescription')
                : t('restoredDescription', { count: restored.length, fresh: created.length - restored.length }),
          });
          close();
          return;
        }
        setOutcome({
          added: created.length,
          restored: restored.length,
          both: both === 'yes',
          skipped: skipped.map((item) => ({ id: item.existing_id, keyword: items[item.index]?.keyword ?? '' })),
          rejected: rejected.map((item) => ({
            keyword: items[item.index]?.keyword ?? '',
            reason: isKeywordProblem(item.code) ? rejectedReason(item.code) : item.message,
          })),
        });
      } catch (error) {
        if (isApiProblem(error, 'quota_exceeded')) {
          const limit = error.number('limit') ?? 0;
          const used = error.number('used') ?? 0;
          setAlert(
            t('quota', {
              requested: formatInteger(error.number('requested') ?? items.length * (both === 'yes' ? 2 : 1)),
              room: formatInteger(Math.max(limit - used, 0)),
              used: formatInteger(used),
              limit: formatInteger(limit),
            }),
          );
          return;
        }
        if (isApiProblem(error, 'validation_failed')) {
          // An item's keyword is named by its line, as the person typed it
          const keywordErrors = error.errors.flatMap((item) => {
            const index = /^items\.(\d+)\.keyword$/.exec(item.path)?.[1];
            const line = index === undefined ? undefined : read.keywords[Number(index)]?.line;
            return line === undefined || !isKeywordProblem(item.code)
              ? []
              : [t('lineProblem', { line, problem: problemText(item.code) })];
          });
          if (keywordErrors.length > 0) {
            form.setError(
              'keywords',
              { type: 'server', message: formatList(keywordErrors, locale) },
              { shouldFocus: true },
            );
            return;
          }
        }
        setAlert(t('failed'));
      }
    }),
  );

  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale) })),
    [locale],
  );
  const deviceOptions = (['desktop', 'mobile', 'both'] as const).map((value) => ({
    value,
    label: t(`devices.${value}`),
  }));
  const priorityOptions = PRIORITIES.map((priority) => ({
    value: String(priority),
    label: tracking('priorityValue', { priority: String(priority) }),
  }));
  // Both devices make two tracked keywords of each, and the quota counts both (backend plan D4)
  const counter = t('counter', {
    count: keywordCount,
    repeats: lines.repeats,
    rows: device === 'both' ? keywordCount * 2 : 0,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!create.isPending) close();
      }}
      size="md"
      dirty={outcome === null && form.formState.isDirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      {outcome === null ? (
        <form noValidate className="contents" onSubmit={submit}>
          <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
          <DialogBody>
            {alert === null ? null : <FormAlert message={alert} />}
            <FormField
              control={form.control}
              name="keywords"
              label={t('keywords')}
              description={t('keywordsHint', { max: formatInteger(MAX_KEYWORDS_PER_ADD) })}
              render={(field) => (
                <Textarea
                  {...field.controlProps}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  spellCheck={false}
                  counter={counter}
                  counterOver={keywordCount > MAX_KEYWORDS_PER_ADD}
                />
              )}
            />
            <FormField
              control={form.control}
              name="location"
              label={t('location')}
              render={(field) => (
                <LocationCombobox
                  name={field.controlProps.name}
                  inputRef={field.controlProps.ref}
                  onBlur={field.controlProps.onBlur}
                  disabled={field.controlProps.disabled}
                  aria-required={field.controlProps['aria-required']}
                  value={field.value}
                  onValueChange={field.onChange}
                  items={locations.items}
                  loading={locations.loading}
                  onQueryChange={locations.onQueryChange}
                />
              )}
            />
            <FormField
              control={form.control}
              name="language_code"
              label={t('language')}
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('language')}
                  options={languageOptions}
                />
              )}
            />
            <FormField
              control={form.control}
              name="device"
              label={t('device')}
              kind="group"
              render={(field) => (
                <RadioGroup<Device>
                  legend={field.label}
                  name={field.controlProps.name}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={deviceOptions}
                />
              )}
            />
            <FormField
              control={form.control}
              name="groups"
              label={t('groups')}
              optional
              render={(field) => (
                <GroupPicker
                  scope={scope}
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  value={field.value}
                  onValueChange={(chosen) => field.onChange([...chosen])}
                />
              )}
            />
            <FormField
              control={form.control}
              name="term_ids"
              label={t('tags')}
              optional
              description={t('tagsHint')}
              render={(field) => (
                <MultiSelect<Choice>
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  value={field.value.flatMap((id) => termById.get(id) ?? [])}
                  onValueChange={(chosen) => field.onChange(keepOnePerSingleVocabulary(chosen.map((c) => c.id)))}
                  items={terms}
                  itemToString={(choice) => choice.label}
                  itemKey={(choice) => choice.id}
                  placeholder={t('tagsPlaceholder')}
                  emptyText={(query) => t('tagsEmpty', { query })}
                  chipsLabel={t('chips', { field: t('tags') })}
                  removeLabel={(value) => t('remove', { value })}
                  chipsHint={(count) => t('chipsHint', { count })}
                  chipHint={t('chipHint')}
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
                  placeholder={filters('priority')}
                  options={priorityOptions}
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
              <Button type="submit" variant="primary" loading={create.isPending}>
                {t('submit', { count: keywordCount })}
              </Button>
            }
          />
        </form>
      ) : (
        <AddKeywordsResult
          scope={scope}
          outcome={outcome}
          onShowKeyword={(id, archived) => {
            close();
            onShowKeyword(id, archived);
          }}
          onDone={close}
        />
      )}
    </Dialog>
  );
}
