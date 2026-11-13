'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';

import { ANNOUNCE_DELAY_MS, ERRORS_KEY, QUOTA_KEY, RESULT_KEY, WARNINGS_KEY } from './add-announce';
import { findingsOf, type Finding } from './add-findings';
import { linesToSend } from './add-model';
import { buildCreateBody } from './add-payload';
import type { Outcome } from './add-result';
import { addSchema, initialValues, payloadValuesOf, type AddDefaults, type AddValues } from './add-values';
import { useAddCheck, type AddCheck } from './use-add-check';
import { BULK_MAX, countriesForEngines, PROMPT_TEXT_MAX } from '../prompt-model';
import { BULK_CREATE_PROMPTS, refreshPrompts, type PromptScope } from '../prompt-queries';
import { EnsureTopicsFailure, useEnsureTopics, useTopicLeftover } from '../topic-picker/use-ensure-topics';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import type { ProjectEngine, Prompt, PromptBulkResult } from '@/lib/api/types';
import { formatInteger, formatList } from '@/lib/format';
import { useCountries, type CountryList } from '@/lib/locations/countries';

/** The lines of a refused request named in its error before the rest are counted. */
const NAMED_LINES = 3;

/** The catalog key of each code `bulk-create` rejects an item with (plan A task 8). */
const REJECT_KEYS = {
  location_not_supported: 'locationNotSupported',
  term_unknown: 'termUnknown',
  single_valued_vocabulary: 'singleValuedVocabulary',
  duplicate_in_request: 'duplicateInRequest',
  duplicate: 'duplicate',
} as const;
const isRejectCode = (code: string): code is keyof typeof REJECT_KEYS => Object.hasOwn(REJECT_KEYS, code);

export interface UseAddFormInput {
  scope: PromptScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engines: readonly ProjectEngine[];
  existing: readonly Prompt[];
  defaults: AddDefaults;
}

export interface AddForm {
  form: UseFormReturn<AddValues>;
  check: AddCheck;
  findings: Finding[];
  /** The note under the fields about the workspace limit; `null` until the lint has told the room left. */
  quota: { text: string; over: boolean } | null;
  /** How many prompts the add takes by the button's count: the lines not tracked or repeated, refused ones included. */
  sendCount: number;
  countries: CountryList;
  alert: string | null;
  outcome: Outcome | null;
  pending: boolean;
  doneRef: RefObject<HTMLButtonElement | null>;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}

/**
 * The state of the Add prompts dialog: the form, what the check says of the list (`useAddCheck`), and the submit.
 * The submit makes the typed topics first (`useEnsureTopics`), then sends one `bulk-create` with the lines the
 * check did not find tracked. `bulk-create` has the last word: what it skips is "already tracked", not an error,
 * and the lines it refuses are named by their line number.
 */
export function useAddForm({ scope, open, onOpenChange, engines, existing, defaults }: UseAddFormInput): AddForm {
  const t = useTranslations('prompts.add');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const create = useMutation(BULK_CREATE_PROMPTS);
  const ensureTopics = useEnsureTopics(scope);
  const topicLeftover = useTopicLeftover();
  const countries = useCountries();
  const [alert, setAlert] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const offeredCountries = useMemo(
    () => countriesForEngines(engines, countries.countries).map((country) => country.country_iso),
    [engines, countries.countries],
  );
  const schema = addSchema({
    offeredCountries,
    messages: {
      textRequired: t('textRequired'),
      languageRequired: t('languageRequired'),
      countryRequired: t('countryRequired'),
    },
  });
  const form = useForm<AddValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: initialValues(defaults),
  });
  const text = useWatch({ control: form.control, name: 'text' });
  const language = useWatch({ control: form.control, name: 'language_code' });
  const country = useWatch({ control: form.control, name: 'country_iso' });
  const promptType = useWatch({ control: form.control, name: 'prompt_type' });
  const branded = useWatch({ control: form.control, name: 'branded' });

  const check = useAddCheck({
    scope,
    text,
    languageCode: language,
    countryIso: country,
    engines,
    existing,
    promptType: promptType === 'auto' ? null : promptType,
  });
  const engineLabels = useMemo(
    () => new Map(engines.map((engine) => [engine.engine.engine_code, engine.engine.label])),
    [engines],
  );
  const findings = useMemo(
    () => findingsOf({ lines: check.lines, lint: check.answer?.data ?? null, engineLabels, branded, t }),
    [check.lines, check.answer, engineLabels, branded, t],
  );
  const sendCount = check.counts.new + check.counts.refused;
  const hasErrors = check.counts.refused > 0;
  const lintQuota = check.answer?.quota ?? null;
  const remaining = lintQuota === null ? null : Math.max(0, lintQuota.limit - lintQuota.used);
  // Only a note: the API has the last word, and a prompt it skips does not take a place
  const over = remaining !== null && sendCount > remaining;
  const quotaText =
    remaining === null || sendCount === 0
      ? null
      : over
        ? t('quotaOver', { count: sendCount, remaining })
        : t('quota', { count: sendCount, remaining });

  // What changes under the field is spoken once, a moment after the typing and the lint have settled
  const checking = open && outcome === null;
  const errorCount = findings.filter((finding) => finding.tone === 'error').length;
  const warningCount = findings.filter((finding) => finding.tone === 'warning').length;
  const errorsText = errorCount === 0 ? null : t('announce.errors', { count: errorCount });
  const warningsText = warningCount === 0 ? null : t('announce.warnings', { count: warningCount });
  useEffect(() => {
    if (checking && quotaText !== null) announce(quotaText, { key: QUOTA_KEY, debounceMs: ANNOUNCE_DELAY_MS });
  }, [checking, quotaText]);
  useEffect(() => {
    if (checking && errorsText !== null) announce(errorsText, { key: ERRORS_KEY, debounceMs: ANNOUNCE_DELAY_MS });
  }, [checking, errorsText]);
  useEffect(() => {
    if (checking && warningsText !== null) announce(warningsText, { key: WARNINGS_KEY, debounceMs: ANNOUNCE_DELAY_MS });
  }, [checking, warningsText]);

  // The form is gone when the result takes its place, and the focus with it: it goes to Done
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (outcome !== null) doneRef.current?.focus();
  }, [outcome]);

  const close = (): void => {
    form.reset(initialValues(defaults));
    setAlert(null);
    setOutcome(null);
    onOpenChange(false);
  };

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      if (hasErrors) {
        setAlert(t('fixLines'));
        return;
      }
      const lines = linesToSend(check.lines);
      if (lines.length > BULK_MAX) {
        form.setError(
          'text',
          {
            type: 'server',
            message: t('tooMany', { max: formatInteger(BULK_MAX), count: formatInteger(lines.length) }),
          },
          { shouldFocus: true },
        );
        return;
      }
      if (lines.length === 0) {
        setAlert(t('allTracked'));
        return;
      }
      setAlert(null);
      // Topics typed and not yet made are made now, so cancelling the form leaves none behind
      let termIds: readonly string[];
      let made: readonly string[];
      try {
        const ensured = await ensureTopics(values.topics);
        termIds = ensured.termIds;
        made = ensured.made;
      } catch (error) {
        setAlert((error instanceof EnsureTopicsFailure ? topicLeftover(error.made) : null) ?? t('failed'));
        return;
      }
      // Topics made before an add that then fails stay: the person is told, ahead of the reason
      const failedWith = (reason: string | null): void => {
        const message = [topicLeftover(made), reason].filter((part) => part !== null).join(' ');
        setAlert(message === '' ? null : message);
      };
      let result: PromptBulkResult;
      try {
        const answer = await create.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
          body: buildCreateBody(payloadValuesOf(values, termIds), lines),
        });
        result = answer.data;
      } catch (error) {
        if (isApiProblem(error, 'quota_exceeded')) {
          failedWith(
            t('quotaExceeded', {
              used: formatInteger(error.number('used') ?? 0),
              limit: formatInteger(error.number('limit') ?? 0),
            }),
          );
        } else if (isApiProblem(error, 'validation_failed')) {
          // A field error fails the whole request: each is named by the line the person typed it on
          const named = error.errors.flatMap((item): string[] => {
            const index = /^items\.(\d+)\.text$/.exec(item.path)?.[1];
            const line = index === undefined ? undefined : lines[Number(index)]?.line;
            if (line === undefined) return [];
            if (item.code === 'prompt_too_long') {
              return [t('findings.tooLong', { line, max: formatInteger(PROMPT_TEXT_MAX) })];
            }
            return item.code === 'value_error' ? [t('findings.unsupported', { line })] : [];
          });
          if (named.length === 0) failedWith(t('invalid'));
          else {
            failedWith(null);
            const more = named.length - NAMED_LINES;
            form.setError(
              'text',
              {
                type: 'server',
                message: formatList(
                  [...named.slice(0, NAMED_LINES), ...(more > 0 ? [t('moreFindings', { count: more })] : [])],
                  locale,
                ),
              },
              { shouldFocus: true },
            );
          }
        } else if (isApiProblem(error, 'forbidden')) failedWith(t('forbidden'));
        else failedWith(made.length === 0 ? t('failed') : null);
        return;
      }
      await refreshPrompts(queryClient, scope);
      const rejected = result.rejected.map((entry) => ({
        // The index counts the items sent, which are the lines the check did not find tracked, in order
        line: lines[entry.index]?.line ?? entry.index + 1,
        reason: isRejectCode(entry.code) ? t(`rejected.${REJECT_KEYS[entry.code]}`) : entry.message,
      }));
      if (rejected.length === 0 && result.skipped.length === 0) {
        toast({ type: 'success', title: t('added', { count: result.created.length }) });
        close();
        return;
      }
      const done = { created: result.created.length, skipped: result.skipped.length, rejected };
      announce(
        [
          t('resultCreated', { count: done.created }),
          done.skipped === 0 ? '' : t('resultSkipped', { count: done.skipped }),
          rejected.length === 0 ? '' : t('rejectedTitle', { count: rejected.length }),
        ]
          .filter((part) => part !== '')
          .join(' '),
        { key: RESULT_KEY },
      );
      setOutcome(done);
    }),
  );

  return {
    form,
    check,
    findings,
    quota: quotaText === null ? null : { text: quotaText, over },
    sendCount,
    countries,
    alert,
    outcome,
    pending: create.isPending,
    doneRef,
    submit,
    close,
  };
}
