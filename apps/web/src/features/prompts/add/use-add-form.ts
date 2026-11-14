'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';

import { RESULT_KEY } from './add-announce';
import { linesToSend } from './add-model';
import { needsResultView, outcomeOf } from './add-outcome';
import { buildCreateBody, restoreIds } from './add-payload';
import type { Outcome } from './add-result';
import { addSchema, initialValues, payloadValuesOf, type AddDefaults, type AddValues } from './add-values';
import { askCostText } from './plan-block';
import { markJustAdded } from './just-added-store';
import { CONFIRM_ABOVE, useAfterAdd, type AskEstimate } from './use-after-add';
import { useAddCheck, type AddCheck } from './use-add-check';
import { useAddPlan, type AddPlan } from './use-add-plan';
import { BULK_MAX, countriesForEngines, PROMPT_TEXT_MAX } from '../prompt-model';
import { BULK_CREATE_PROMPTS, bulkArchive, refreshPrompts, type PromptScope } from '../prompt-queries';
import type { TopicSelection } from '../topic-picker/topic-picker-model';
import { EnsureTopicsFailure, useEnsureTopics, useTopicLeftover } from '../topic-picker/use-ensure-topics';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import type { ProjectEngine, Prompt, PromptBulkResult } from '@/lib/api/types';
import { formatInteger, formatList } from '@/lib/format';
import { useCountries, type CountryList } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';

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

/** The inspector the add opened, the title of which takes the focus when the dialog is out of the way (PD-POST-07). */
const inspectorTitle = (): HTMLElement | null => {
  const frame = document.querySelector('aside[aria-labelledby], [data-slot="sheet"][aria-labelledby]');
  const titleId = frame?.getAttribute('aria-labelledby');
  return titleId === null || titleId === undefined ? null : document.getElementById(titleId);
};

/** The topics the save made, held as the terms they now are: each typed path that was made becomes its term. */
const madeTopicsAsTerms = (
  topics: readonly TopicSelection[],
  madeTermIds: ReadonlyMap<string, string>,
): TopicSelection[] =>
  topics.map((selection): TopicSelection => {
    const termId = selection.kind === 'new' ? madeTermIds.get(selection.path) : undefined;
    return termId === undefined ? selection : { kind: 'existing', termId };
  });

/** How often and how long to look for an inspector that is on its way: the URL changes, then the record loads. */
const INSPECTOR_POLL_MS = 50;
const INSPECTOR_POLLS = 40;

/** The one poll in flight: a new Show it replaces it, and leaving the page cancels it. */
let inspectorPoll: number | undefined;

function cancelInspectorFocus(): void {
  if (inspectorPoll !== undefined) window.clearTimeout(inspectorPoll);
  inspectorPoll = undefined;
}

/** shortcut: polls for 2 seconds; the inspector could tell a page when it is shown, which this has no way to hear. */
function focusInspectorTitleWhenShown(polls = 0): void {
  cancelInspectorFocus();
  const title = inspectorTitle();
  if (title !== null) title.focus({ preventScroll: true });
  else if (polls < INSPECTOR_POLLS) {
    inspectorPoll = window.setTimeout(() => focusInspectorTitleWhenShown(polls + 1), INSPECTOR_POLL_MS);
  }
}

export interface UseAddFormInput {
  scope: PromptScope;
  /** The dialog is open: the limits and the schedules are read only then. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engines: readonly ProjectEngine[];
  existing: readonly Prompt[];
  defaults: AddDefaults;
}

export interface AddControl {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface AddForm {
  form: UseFormReturn<AddValues>;
  check: AddCheck;
  plan: AddPlan;
  /** How many prompts the add takes by the button's count: the lines not tracked or repeated, refused ones and the restored included. */
  sendCount: number;
  countries: CountryList;
  alert: string | null;
  outcome: Outcome | null;
  pending: boolean;
  doneRef: RefObject<HTMLButtonElement | null>;
  /** "Restore archived": the archived lines come back with the add. */
  restore: AddControl;
  /** "Ask them now as well": the created prompts are asked right after the add. */
  ask: AddControl;
  /** The result view's "Ask them now"; `null` when the person cannot, there is nothing to ask, or the add asked. */
  askFromResult: (() => void) | null;
  /** Closes the dialog and opens the inspector of a tracked prompt. */
  show: (promptId: string) => void;
  /** Where focus goes when the dialog closes: the inspector after "Show it", else back to what opened it. */
  finalFocus: () => boolean | HTMLElement;
  /** The confirms of what follows an add; rendered once, beside the dialog. */
  followUps: ReactNode;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}

/**
 * The state of the Add prompts dialog: the form, what the check says of the list (`useAddCheck`), the plan, and the
 * submit. The submit makes the typed topics first (`useEnsureTopics`), sends one `bulk-create` with the lines the
 * check did not find tracked, then brings back the archived lines left ticked (`bulk-archive`). `bulk-create` has the
 * last word: what it skips is "already tracked", not an error, and the lines it refuses are named by their line
 * number. A restore that fails after the create does not undo it: the result says so. What follows is
 * `useAfterAdd`'s: the toast with Undo and asking the new prompts.
 */
export function useAddForm({ scope, open, onOpenChange, engines, existing, defaults }: UseAddFormInput): AddForm {
  const t = useTranslations('prompts.add');
  const planT = useTranslations('prompts.add.plan');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const create = useMutation(BULK_CREATE_PROMPTS);
  const ensureTopics = useEnsureTopics(scope);
  const topicLeftover = useTopicLeftover();
  const countries = useCountries();
  const inspector = useInspector();
  const canRun = useCan('runs:trigger');
  const afterAdd = useAfterAdd({ scope, open, engines });
  // Leaving the page ends a poll for the inspector title that Show it started
  useEffect(() => cancelInspectorFocus, []);
  const [alert, setAlert] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A result stays drawn while the dialog fades out; the next open starts from the form, before anything is drawn
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) setOutcome(null);
  }
  const [restoreOn, setRestoreOn] = useState(true);
  const [askOn, setAskOn] = useState(false);
  // The add asked the prompts already, so the result view does not offer it again
  const [asked, setAsked] = useState(false);

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
    branded,
  });
  const restoreCount = restoreOn ? check.counts.archived : 0;
  const plan = useAddPlan({ scope, open, check, engines, restore: restoreCount });
  const sendCount = check.counts.new + check.counts.refused + restoreCount;
  const hasErrors = check.counts.refused > 0;
  // Only while the plan says asking is possible: a box ticked before the day's runs ran out asks nothing
  const askTicked = askOn && plan.ask !== null && plan.askReason === null;

  // The form is gone when the result takes its place, and the focus with it: it goes to Done
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (outcome !== null) doneRef.current?.focus();
  }, [outcome]);

  const close = (): void => {
    form.reset(initialValues(defaults));
    setAlert(null);
    setAsked(false);
    setRestoreOn(true);
    setAskOn(false);
    onOpenChange(false);
  };

  /** What asking the created prompts takes, as the plan said it: the answers and cost only while the add made the prompts it counted. */
  const askEstimate = (created: number): AskEstimate | null =>
    plan.ask === null
      ? null
      : {
          cost:
            created === check.wouldCreate
              ? { answers: plan.ask.answers, text: askCostText(plan.ask, planT, locale) }
              : null,
          used: plan.ask.used,
          limit: plan.ask.limit,
        };

  const showing = useRef(false);
  const show = (promptId: string): void => {
    showing.current = true;
    inspector.open({ type: 'prompt', id: promptId });
    // The list is kept for a peek from the check; a result has nothing left to keep
    if (outcome === null) onOpenChange(false);
    else close();
  };
  const finalFocus = (): boolean | HTMLElement => {
    if (!showing.current) return true;
    showing.current = false;
    const title = inspectorTitle();
    if (title !== null) return title;
    // The inspector follows the URL a moment later: it takes the focus when it is there, and the trigger does not
    focusInspectorTitleWhenShown();
    return false;
  };

  const restoreFailure = (error: unknown): string =>
    isApiProblem(error, 'quota_exceeded')
      ? t('restoreFailedQuota', {
          used: formatInteger(error.number('used') ?? 0),
          limit: formatInteger(error.number('limit') ?? 0),
        })
      : t('restoreFailedTryAgain');

  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      if (hasErrors) {
        setAlert(t('fixLines'));
        return;
      }
      const lines = linesToSend(check.lines);
      const bringBack = restoreIds(check.lines, restoreOn);
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
      if (lines.length === 0 && bringBack.length === 0) {
        setAlert(t('allTracked'));
        return;
      }
      setAlert(null);
      // Topics typed and not yet made are made now, so cancelling the form leaves none behind
      let termIds: readonly string[];
      let made: readonly string[];
      let madeTermIds: ReadonlyMap<string, string>;
      try {
        const ensured = await ensureTopics(values.topics);
        termIds = ensured.termIds;
        made = ensured.made;
        madeTermIds = ensured.madeTermIds;
      } catch (error) {
        setAlert((error instanceof EnsureTopicsFailure ? topicLeftover(error.made) : null) ?? t('failed'));
        return;
      }
      // A topic made here is a term now: held as one, a failed add tried again does not make it a second time
      if (madeTermIds.size > 0) form.setValue('topics', madeTopicsAsTerms(form.getValues('topics'), madeTermIds));
      // Topics made before an add that then fails stay: the person is told, ahead of the reason
      const failedWith = (reason: string | null): void => {
        const message = [topicLeftover(made), reason].filter((part) => part !== null).join(' ');
        setAlert(message === '' ? null : message);
      };
      let result: PromptBulkResult = { created: [], skipped: [], rejected: [] };
      if (lines.length > 0) {
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
      }
      // The restore comes second, and its failure leaves what the create made: the result says so
      let restored = 0;
      let restoreProblem: string | null = null;
      if (bringBack.length > 0) {
        try {
          restored = (await bulkArchive(scope, bringBack, false)).data.updated;
        } catch (error) {
          restoreProblem = restoreFailure(error);
        }
      }
      await refreshPrompts(queryClient, scope);
      markJustAdded(result.created);
      const done = outcomeOf({
        language: values.language_code,
        lines: check.lines,
        sent: lines,
        result,
        reasonOf: (entry) =>
          // The API's own words name the engine that asks in no location of the country (PD-ERR-04)
          entry.code === 'location_not_supported' && entry.message !== ''
            ? entry.message
            : isRejectCode(entry.code)
              ? t(`rejected.${REJECT_KEYS[entry.code]}`)
              : entry.message,
        restore: { on: restoreOn, done: restored, failure: restoreProblem },
      });
      const resultView = needsResultView(result, done);
      afterAdd.added({
        created: result.created,
        restored: done.restored,
        resultView,
        ask: askTicked,
        estimate: askEstimate(result.created.length),
      });
      if (!resultView) {
        close();
        return;
      }
      if (askTicked && result.created.length > 0 && result.created.length <= CONFIRM_ABOVE) setAsked(true);
      announce(
        [
          t('resultCreated', { count: done.created.length }),
          done.tracked.length === 0 ? '' : t('resultTracked', { count: done.tracked.length }),
          done.rejected.length === 0 ? '' : t('rejectedTitle', { count: done.rejected.length }),
          done.restoreFailed === null ? '' : t('restoreFailedTitle', { count: done.restoreFailed.lines.length }),
        ]
          .filter((part) => part !== '')
          .join(' '),
        { key: RESULT_KEY },
      );
      setOutcome(done);
    }),
  );

  const askFromResult =
    outcome === null || outcome.created.length === 0 || asked || !canRun || engines.length === 0
      ? null
      : () => {
          const ids = outcome.created;
          close();
          afterAdd.confirmAsk(ids, askEstimate(ids.length));
        };

  return {
    form,
    check,
    plan,
    sendCount,
    countries,
    alert,
    outcome,
    // The whole submit: topics, create, restore and refresh. The dialog cannot be closed under it
    pending: create.isPending || form.formState.isSubmitting,
    doneRef,
    restore: { checked: restoreOn, onCheckedChange: setRestoreOn },
    ask: { checked: askTicked, onCheckedChange: setAskOn },
    askFromResult,
    show,
    finalFocus,
    followUps: afterAdd.dialogs,
    submit,
    close,
  };
}
