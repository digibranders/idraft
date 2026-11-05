'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useId, useMemo, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { AddKeywordsResult, type AddOutcome } from './add-keywords-result';
import { addPlan, chunkKeywords, costOf, MAX_ADD_COUNTRIES, type AddDevice } from './add-plan';
import { useCheckPrice, useCountryList, useTrackedKeywordQuota } from './add-queries';
import { createInChunks } from './add-submit';
import { useEnsureGroups, useGroupMessages, useGroupPathCheck, type GroupChoice } from '../groups/group-choices';
import { GroupPicker } from '../groups/group-picker';
import type { Country } from '../keyword-filters';
import { PRIORITIES } from '../keyword-values';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { refreshGroups } from '../taxonomy-queries';
import { useTermChoices } from '../term-choices';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
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
import { formatCurrency, formatInteger, formatList } from '@/lib/format';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { MAX_KEYWORDS_PER_ADD, readKeywordLines, type KeywordLines } from '@/lib/keywords/keyword-lines';
import { MAX_KEYWORD_LENGTH, type KeywordTextProblem } from '@/lib/keywords/keyword-text';
import { quotaFacts } from '@/lib/keywords/quota';

type LocationRef = components['schemas']['LocationRef'];

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
  /** Each keyword is tracked in every one of them. */
  countries: Country[];
  language_code: string;
  /** `null` until the project's default arrives (or when it cannot be read): the API then applies it. */
  device: AddDevice | null;
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
 * dialog with the keywords one per line and what they share: countries, language, device, groups, tags and
 * priority. The list is read as the API reads it before it is sent, so a refused line is named by its
 * number. Under the fields the plan of the add: the checks a day, their cost and the plan's keyword limit
 * before and after; over the limit Add is refused, and the API still has the last word. Each keyword is
 * sent once per country, in requests of at most 1,000 items. When some keywords were tracked already or
 * refused, the dialog shows which, with "Show it" and "Unarchive".
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
  const filters = useTranslations('rankings.filters');
  const tracking = useTranslations('rankings.inspector.tracking');
  const multiSelectHints = useMultiSelectHints();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const countryList = useCountryList();
  const allCountries = countryList.countries;
  const projectPath = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const settings = useQuery({ ...apiQuery(SETTINGS, { params: { path: projectPath } }), enabled: open });
  const quota = useTrackedKeywordQuota(scope, open);
  const checkPrice = useCheckPrice(scope, open);
  const planId = useId();
  const ensureGroups = useEnsureGroups(scope);
  const checkGroupPaths = useGroupPathCheck();
  const groupMessages = useGroupMessages();
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
    countries: z
      .array(z.custom<Country>())
      .min(1, { error: t('countriesRequired') })
      .max(MAX_ADD_COUNTRIES, { error: t('countriesTooMany', { max: MAX_ADD_COUNTRIES }) }),
    language_code: z.string(),
    // Required: without the project's default (its settings could not be read) the person chooses one
    device: z
      .enum(['desktop', 'mobile', 'both'])
      .nullable()
      .refine((value) => value !== null, { error: t('deviceRequired') }),
    groups: z.array(z.custom<GroupChoice>()),
    term_ids: z.array(z.string()),
    priority: z.string(),
  });
  const initialValues = (device: AddDevice | null, country: Country | null): AddValues => ({
    keywords: '',
    countries: country === null ? [] : [country],
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
    defaultValues: initialValues(null, null),
  });
  // The project's default device arrives with its settings, and its country with the list of countries (a
  // city stands for its country, found by its ISO code); a person who chose either already keeps it. The
  // defaults may already be cached when the dialog is first rendered, before its fields exist, and
  // `resetField` does nothing for a field that is not there: `reset` sets the default of every field
  const defaultDevice = settings.data?.data.seo?.default_device ?? null;
  const projectLocation = defaults.location;
  const defaultCountry = useMemo(
    () =>
      projectLocation === null
        ? null
        : (allCountries.find((country) =>
            projectLocation.location_type === 'Country'
              ? country.location_id === projectLocation.location_id
              : country.country_iso === projectLocation.country_iso,
          ) ?? null),
    [allCountries, projectLocation],
  );
  const startOnDefaults = useEffectEvent((device: AddDevice | null, country: Country | null): void => {
    form.reset(initialValues(device, country), { keepDirtyValues: true, keepDirty: true });
  });
  useEffect(() => {
    if (defaultDevice !== null || defaultCountry !== null) startOnDefaults(defaultDevice, defaultCountry);
  }, [defaultDevice, defaultCountry]);

  const text = useWatch({ control: form.control, name: 'keywords' });
  const device = useWatch({ control: form.control, name: 'device' });
  const countries = useWatch({ control: form.control, name: 'countries' });
  const lines = useMemo(() => readKeywordLines(text), [text]);
  const keywordCount = lines.keywords.length;
  const create = useMutation(apiMutation('post', BULK_CREATE));

  // Each check a day is one tracked keyword, so the plan's use after the add grows by the checks
  const plan = addPlan({ keywords: keywordCount, device, countries: countries.length });
  const cost = costOf(plan.checksPerDay, checkPrice);
  const after = quota === null ? null : quota.used + plan.checksPerDay;
  const overPlan = quota === null || after === null ? 0 : Math.max(after - quota.limit, 0);
  const tooManyCountries = countries.length > MAX_ADD_COUNTRIES;
  const blocked = overPlan > 0 || tooManyCountries;

  const { choices: terms, byId: termById, keepOnePerSingleVocabulary } = useTermChoices(scope);

  const close = (): void => {
    form.reset(initialValues(defaultDevice, defaultCountry));
    setAlert(null);
    setOutcome(null);
    onOpenChange(false);
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      // Add is refused while the add goes over the plan; Enter in a field still submits the form. The schema
      // requires a device, so a request never leaves this dialog without one
      const chosenDevice = values.device;
      if (blocked || chosenDevice === null) return;
      setAlert(null);
      // A typed path that cannot become a group is named before anything is created or sent
      const pathError = checkGroupPaths(values.groups);
      if (pathError !== null) {
        form.setError('groups', { type: 'server', message: pathError }, { shouldFocus: true });
        return;
      }
      // Groups typed and not yet made are made now, so cancelling the form leaves none behind
      let groupIds: string[];
      let made: readonly string[];
      try {
        const ensured = await ensureGroups(values.groups);
        groupIds = ensured.groups.map((group) => group.groupId);
        made = ensured.made;
      } catch (error) {
        setAlert(groupMessages.refusal(error));
        return;
      }
      // Groups made now stay when the keywords are not added; the next try reuses them
      const withLeftover = (text: string): string => {
        const note = groupMessages.leftover(made);
        return note === null ? text : `${text} ${note}`;
      };
      const read = readKeywordLines(values.keywords);
      const perCountry = values.countries.length;
      const checks = addPlan({ keywords: read.keywords.length, device: chosenDevice, countries: perCountry });
      // Created counts tracked keywords: one per keyword, country and device
      const both = checks.devices * checks.countries > 1 ? 'yes' : 'no';
      const shared = {
        search_engine: 'google' as const,
        funnel_stage: 'unknown' as const,
        language_code: values.language_code,
        device: chosenDevice,
        priority: Number(values.priority),
        ...(groupIds.length === 0 ? {} : { group_ids: groupIds }),
        ...(values.term_ids.length === 0 ? {} : { term_ids: values.term_ids }),
      };
      // The tracked keywords the request last sent would add, for a quota problem that does not say
      let lastRequested = 0;
      try {
        const answer = await createInChunks({
          chunks: chunkKeywords(
            read.keywords.map(({ keyword }) => keyword),
            perCountry,
          ),
          countries: values.countries,
          send: async (items) => {
            lastRequested = items.length * checks.devices;
            const sent = await create.mutateAsync({
              params: { path: projectPath },
              body: {
                items: items.map(({ keyword, country }) => ({ ...shared, keyword, location_id: country.location_id })),
                on_duplicate: 'skip',
              },
            });
            return sent.data;
          },
        });
        const { created, restored, skipped, rejected, stoppedBy } = answer;
        // The quota problem's own figures, which are those of the request it refused
        const stopped =
          stoppedBy === null
            ? null
            : isApiProblem(stoppedBy, 'quota_exceeded')
              ? common('quota', { ...quotaFacts(stoppedBy, lastRequested) })
              : t('result.stoppedFailed');
        const changed = created.length + skipped.length + rejected.length > 0;
        // Over the plan before any request went through: the form stays, with the reason
        if (stopped !== null && !changed) {
          setAlert(withLeftover(stopped));
          return;
        }
        void refreshKeywords(queryClient, scope);
        void refreshGroups(queryClient, scope);
        if (stopped === null && skipped.length === 0 && rejected.length === 0) {
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
          skipped: skipped.map((item) => ({ id: item.id, keyword: item.keyword, country: item.country.name })),
          rejected: rejected.map((item) => ({
            keyword: item.keyword,
            country: item.country.name,
            reason: isKeywordProblem(item.code) ? rejectedReason(item.code) : item.message,
          })),
          stopped,
        });
      } catch (error) {
        if (isApiProblem(error, 'validation_failed')) {
          // An item's keyword is named by its line, as the person typed it: each keyword is one item per
          // country, and only the first request's failure is thrown, so the index counts from the top
          const keywordErrors = error.errors.flatMap((item) => {
            const index = /^items\.(\d+)\.keyword$/.exec(item.path)?.[1];
            const line = index === undefined ? undefined : read.keywords[Math.floor(Number(index) / perCountry)]?.line;
            return line === undefined || !isKeywordProblem(item.code)
              ? []
              : [t('lineProblem', { line, problem: problemText(item.code) })];
          });
          if (keywordErrors.length > 0) {
            setAlert(groupMessages.leftover(made));
            form.setError(
              'keywords',
              { type: 'server', message: formatList(keywordErrors, locale) },
              { shouldFocus: true },
            );
            return;
          }
        }
        setAlert(withLeftover(t('failed')));
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
  const counter = t('counter', { count: keywordCount, repeats: lines.repeats });

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
              name="countries"
              label={t('countries')}
              description={t('countriesHint')}
              render={(field) => (
                <MultiSelect<Country>
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  aria-required={field.required}
                  value={field.value}
                  onValueChange={(chosen) => field.onChange([...chosen])}
                  items={allCountries}
                  itemToString={(country) => country.name}
                  itemKey={(country) => String(country.location_id)}
                  placeholder={t('countriesPlaceholder')}
                  emptyText={(query) => (countryList.isError ? t('countriesFailed') : t('countriesEmpty', { query }))}
                  chipsLabel={t('chips', { field: t('countries') })}
                  removeLabel={(value) => t('remove', { value })}
                  {...multiSelectHints}
                />
              )}
            />
            {countryList.isError ? (
              <div className="flex items-center gap-2">
                <p role="alert" className="flex-1 type-meta text-negative-text">
                  {t('countriesFailed')}
                </p>
                <Button type="button" variant="secondary" size="sm" onClick={countryList.retry}>
                  {common('retry')}
                </Button>
              </div>
            ) : null}
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
                <RadioGroup<AddDevice>
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
                  {...multiSelectHints}
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
            <div id={planId} className="flex flex-col gap-0.5 type-meta">
              {tooManyCountries ? (
                <p className="text-negative-text">{t('countriesTooMany', { max: MAX_ADD_COUNTRIES })}</p>
              ) : null}
              {device === null ? (
                <p>{t('plan.noDevice')}</p>
              ) : plan.checksPerDay === 0 ? (
                <p>{t('plan.empty')}</p>
              ) : (
                <>
                  <p>
                    {t('plan.checks', {
                      keywords: plan.keywords,
                      devices: plan.devices,
                      countries: plan.countries,
                      checks: plan.checksPerDay,
                    })}
                  </p>
                  {cost === null ? null : (
                    <p>
                      {t('plan.cost', {
                        day: formatCurrency(cost.day, { locale }),
                        month: formatCurrency(cost.month, { locale }),
                      })}
                    </p>
                  )}
                  {quota === null || after === null ? null : (
                    <p className={overPlan > 0 ? 'text-negative-text' : undefined}>
                      {t('plan.quota', {
                        used: formatInteger(quota.used, { locale }),
                        limit: formatInteger(quota.limit, { locale }),
                        after: formatInteger(after, { locale }),
                      })}
                    </p>
                  )}
                  {overPlan > 0 ? <p className="text-negative-text">{t('plan.over', { count: overPlan })}</p> : null}
                </>
              )}
            </div>
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
              <Button
                type="submit"
                variant="primary"
                loading={create.isPending}
                disabled={blocked}
                focusableWhenDisabled
                aria-describedby={planId}
              >
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
