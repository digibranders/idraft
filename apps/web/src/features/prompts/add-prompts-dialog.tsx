'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  BULK_MAX,
  countriesForEngines,
  promptKeyOf,
  PROMPT_TEXT_MAX,
  readPromptLines,
  type PromptLine,
} from './prompt-model';
import { BULK_CREATE_PROMPTS, refreshPrompts, usePromptLint, type PromptScope } from './prompt-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import type { ProjectEngine, Prompt, PromptBulkResult } from '@/lib/api/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatInteger, formatList } from '@/lib/format';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { useCountries } from '@/lib/locations/countries';
import { textLength } from '@/lib/text/length';
import { cn } from '@/lib/utils';

interface AddValues {
  text: string;
  /** A topic term, or `none`. */
  term_id: string;
  language_code: string;
  country_iso: string;
}

const NO_TOPIC = 'none';
/** The findings named under the field before the rest are counted. */
const SHOWN_FINDINGS = 5;
/** The lint asks this long after typing stops. */
const LINT_DELAY_MS = 300;
/** The lines of a refused request named in its error before the rest are counted. */
const NAMED_LINES = 3;
/** What the API gives a prompt added by hand (plan A `PromptCreate`); the generated type asks for them. */
const API_DEFAULTS = { intent: 'unknown', funnel_stage: 'unknown', prompt_type: 'question', importance: 3 } as const;
/** What the API refuses in a prompt (its `printable` rule): control, format and line or paragraph separator characters. */
const UNSAVABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

type FindingTone = 'error' | 'warning' | 'note';
interface Finding {
  line: number;
  tone: FindingTone;
  text: string;
}
const FINDING_ICON = { error: CircleAlert, warning: TriangleAlert, note: Info } as const;
const FINDING_CLASS: Readonly<Record<FindingTone, string>> = {
  error: cn('text-negative-text'),
  warning: cn('text-warning-text'),
  note: cn('text-foreground-secondary'),
};
/** Errors come first, so a line that blocks the add is never the one hidden behind "and more". */
const TONE_ORDER: Readonly<Record<FindingTone, number>> = { error: 0, warning: 1, note: 2 };

/** Why the API would refuse the whole request for this line, found here before anything is sent. */
const refusalOf = (text: string): 'tooLong' | 'unsupported' | null => {
  if (textLength(text) > PROMPT_TEXT_MAX) return 'tooLong';
  return UNSAVABLE.test(text) ? 'unsupported' : null;
};

/** The lines of a text that are new to the project for a language and a country: these are the items sent. */
const freshLines = (
  value: string,
  languageCode: string,
  countryIso: string,
  tracked: ReadonlySet<string>,
): PromptLine[] =>
  readPromptLines(value).lines.filter((line) => !tracked.has(promptKeyOf(line.text, languageCode, countryIso)));

/** Messages about one thing share a key, so the announcer speaks the newest once (20-accessibility.md section 10.1). */
const QUOTA_KEY = 'add-prompts-quota';
const ERRORS_KEY = 'add-prompts-errors';
const WARNINGS_KEY = 'add-prompts-warnings';
const RESULT_KEY = 'add-prompts-result';
/** Typing and the lint settle before the quota and the problems are spoken. */
const ANNOUNCE_DELAY_MS = 800;

/** The catalog key of each code `bulk-create` rejects an item with (plan A task 8). */
const REJECT_KEYS = {
  location_not_supported: 'locationNotSupported',
  term_unknown: 'termUnknown',
  single_valued_vocabulary: 'singleValuedVocabulary',
  duplicate_in_request: 'duplicateInRequest',
  duplicate: 'duplicate',
} as const;
const isRejectCode = (code: string): code is keyof typeof REJECT_KEYS => Object.hasOwn(REJECT_KEYS, code);

interface Outcome {
  created: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
}

export interface AddPromptsDialogProps {
  scope: PromptScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project's enabled engines: their countries and their length limits apply. */
  engines: readonly ProjectEngine[];
  /** The project's active prompts, to leave out what it already tracks. */
  existing: readonly Prompt[];
  /**
   * What the form starts on: the project's language and country, and a topic when the dialog opens from one
   * (a new topic means a new dialog: give it a `key`, as the form is made once).
   */
  defaults: { languageCode: string | null; countryIso: string | null; termId?: string | null };
}

/**
 * Add prompts (spec 2026-11-11 section 4.6): one field for one prompt or a pasted list, one per line, with a
 * shared topic, language and country. Before it saves, each line is checked: a repeat of an earlier line and a
 * prompt the project tracks are left out, a line the API would refuse for the whole request (over the length
 * every engine takes, or with a character it cannot save) blocks the add, the lint names a line that names the
 * own brand (it counts as branded) and one too long for an enabled engine, and the quota line says how many of
 * the workspace's remaining prompts the add takes. The add goes through `bulk-create`, which has the last word:
 * a prompt it skips (one the project tracks, an archived one included) is "already tracked", not an error, and
 * the lines it refuses are listed by their line number.
 */
export function AddPromptsDialog({
  scope,
  open,
  onOpenChange,
  engines,
  existing,
  defaults,
}: AddPromptsDialogProps): ReactElement {
  const t = useTranslations('prompts.add');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const create = useMutation(BULK_CREATE_PROMPTS);
  const { countries } = useCountries();
  const vocabularies = useVocabularies(scope);
  const [alert, setAlert] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const countryOptions = useMemo(
    () =>
      countriesForEngines(engines, countries).map((country) => ({ value: country.country_iso, label: country.name })),
    [engines, countries],
  );
  const topicOptions = useMemo(
    () => [
      { value: NO_TOPIC, label: t('noTopic') },
      ...vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'topic')
        .flatMap((entry) => entry.terms.map((term) => ({ value: term.termId, label: term.path }))),
    ],
    [vocabularies.loaded, t],
  );
  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale) })),
    [locale],
  );

  const tracked = useMemo(
    () =>
      new Set(
        existing.map((prompt) =>
          promptKeyOf(prompt.current_version.text, prompt.language_code, prompt.country_iso ?? ''),
        ),
      ),
    [existing],
  );

  const schema = z
    .object({
      text: z.string(),
      term_id: z.string(),
      language_code: z.string().min(1, { error: t('languageRequired') }),
      country_iso: z
        .string()
        .refine((value) => countryOptions.some((option) => option.value === value), { error: t('countryRequired') }),
    })
    .superRefine((values, context) => {
      if (readPromptLines(values.text).lines.length === 0) {
        context.addIssue({ code: 'custom', path: ['text'], message: t('textRequired') });
        return;
      }
      // The API counts the items sent: the lines the project tracks are not among them
      const sent = freshLines(values.text, values.language_code, values.country_iso, tracked).length;
      if (sent > BULK_MAX) {
        context.addIssue({
          code: 'custom',
          path: ['text'],
          message: t('tooMany', { max: formatInteger(BULK_MAX), count: formatInteger(sent) }),
        });
      }
    });
  const initialValues = (): AddValues => ({
    text: '',
    term_id: defaults.termId ?? NO_TOPIC,
    language_code: defaults.languageCode ?? 'en',
    country_iso: defaults.countryIso ?? '',
  });
  const form = useForm<AddValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: initialValues(),
  });
  const text = useWatch({ control: form.control, name: 'text' });
  const language = useWatch({ control: form.control, name: 'language_code' });
  const country = useWatch({ control: form.control, name: 'country_iso' });

  const read = useMemo(() => readPromptLines(text), [text]);
  const fresh = useMemo(() => freshLines(text, language, country, tracked), [text, language, country, tracked]);
  const isFresh = new Set(fresh.map((line) => line.line));
  // The lint takes the lines that would be sent, as far as the API accepts them: a line it would refuse fails
  // the whole request, and so does a list longer than one add takes. Those are named here, without it
  const lintTexts = useMemo(
    () =>
      fresh.length > BULK_MAX ? [] : fresh.filter((line) => refusalOf(line.text) === null).map((line) => line.text),
    [fresh],
  );
  const lint = usePromptLint(
    scope,
    useDebouncedValue(lintTexts, LINT_DELAY_MS),
    engines.map((engine) => engine.engine.engine_code),
  );
  // The lint answers with each text as it would be saved, which is how the lines were read
  const lintOf = new Map((lint.data?.data ?? []).map((result) => [result.text, result]));
  const engineLabel = new Map(engines.map((engine) => [engine.engine.engine_code, engine.engine.label]));
  const findings: Finding[] = [
    ...read.repeats.map(({ line, first }): Finding => ({
      line,
      tone: 'note',
      text: t('findings.repeat', { line, first }),
    })),
    ...read.lines.flatMap((line): Finding[] => {
      const refusal = refusalOf(line.text);
      if (refusal !== null) {
        const message =
          refusal === 'tooLong'
            ? t('findings.tooLong', { line: line.line, max: formatInteger(PROMPT_TEXT_MAX) })
            : t('findings.unsupported', { line: line.line });
        return [{ line: line.line, tone: 'error', text: message }];
      }
      if (!isFresh.has(line.line)) {
        return [{ line: line.line, tone: 'note', text: t('findings.tracked', { line: line.line }) }];
      }
      const result = lintOf.get(line.text);
      return (result?.warnings ?? []).flatMap((warning): Finding[] => {
        if (warning.rule === 'contains_brand_alias') {
          const brand = result?.matched_aliases[0]?.entity.canonical_name ?? '';
          return [{ line: line.line, tone: 'note', text: t('findings.branded', { line: line.line, brand }) }];
        }
        // A limit of an engine that is off is not the project's concern
        const engine = warning.engine_code === null ? undefined : engineLabel.get(warning.engine_code);
        return engine === undefined
          ? []
          : [{ line: line.line, tone: 'warning', text: t('findings.engineLimit', { line: line.line, engine }) }];
      });
    }),
  ].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.line - b.line);
  const hasErrors = findings.some((finding) => finding.tone === 'error');
  const quota = lint.data?.quota ?? null;
  const remaining = quota === null ? null : Math.max(0, quota.limit - quota.used);
  // Only a note: the API has the last word, and a prompt it skips does not take a place
  const over = remaining !== null && fresh.length > remaining;
  const quotaText =
    remaining === null || fresh.length === 0
      ? null
      : over
        ? t('quotaOver', { count: fresh.length, remaining })
        : t('quota', { count: fresh.length, remaining });

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
    form.reset(initialValues());
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
      const lines = freshLines(values.text, values.language_code, values.country_iso, tracked);
      if (lines.length === 0) {
        setAlert(t('allTracked'));
        return;
      }
      setAlert(null);
      let result: PromptBulkResult;
      try {
        const answer = await create.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
          body: {
            items: lines.map((line) => ({
              text: line.text,
              language_code: values.language_code,
              country_iso: values.country_iso,
              term_ids: values.term_id === NO_TOPIC ? [] : [values.term_id],
              ...API_DEFAULTS,
            })),
            on_duplicate: 'skip',
          },
        });
        result = answer.data;
      } catch (error) {
        if (isApiProblem(error, 'quota_exceeded')) {
          setAlert(
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
          if (named.length === 0) setAlert(t('invalid'));
          else {
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
        } else if (isApiProblem(error, 'forbidden')) setAlert(t('forbidden'));
        else setAlert(t('failed'));
        return;
      }
      await refreshPrompts(queryClient, scope);
      const rejected = result.rejected.map((entry) => ({
        // The index counts the items sent, which are the lines the project did not track, in order
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
              name="text"
              label={t('prompts')}
              description={t('promptsHint', { max: formatInteger(BULK_MAX) })}
              render={(field) => (
                <Textarea
                  {...field.controlProps}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  spellCheck={false}
                  submitOnModEnter
                  counter={read.lines.length === 0 ? null : t('counter', { count: read.lines.length })}
                  counterOver={read.lines.length > BULK_MAX}
                />
              )}
            />
            {findings.length === 0 ? null : (
              <ul aria-label={t('findingsLabel')} className="flex flex-col gap-1">
                {findings.slice(0, SHOWN_FINDINGS).map((finding) => (
                  <li
                    key={`${String(finding.line)} ${finding.text}`}
                    className={cn('flex items-start gap-1.5 type-meta', FINDING_CLASS[finding.tone])}
                  >
                    <Icon icon={FINDING_ICON[finding.tone]} size="sm" className="mt-0.5" />
                    {finding.text}
                  </li>
                ))}
                {findings.length > SHOWN_FINDINGS ? (
                  <li className="type-meta">{t('moreFindings', { count: findings.length - SHOWN_FINDINGS })}</li>
                ) : null}
              </ul>
            )}
            <FormField
              control={form.control}
              name="term_id"
              label={t('topic')}
              optional
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('topic')}
                  options={topicOptions}
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
              name="country_iso"
              label={t('country')}
              description={t('countryHint')}
              render={(field) => (
                <Select<string>
                  {...field.controlProps}
                  // A project country no enabled engine asks in is not offered, so it is not shown as chosen
                  value={countryOptions.some((option) => option.value === field.value) ? field.value : null}
                  onValueChange={field.onChange}
                  placeholder={t('country')}
                  options={countryOptions}
                />
              )}
            />
            {quotaText === null ? null : <p className={cn('type-meta', over && 'text-negative-text')}>{quotaText}</p>}
          </DialogBody>
          <DialogFooter
            primary={
              <Button type="submit" variant="primary" loading={create.isPending}>
                {t('submit', { count: fresh.length })}
              </Button>
            }
            secondary={
              <DialogClose>
                <Button variant="secondary">{common('cancel')}</Button>
              </DialogClose>
            }
          />
        </form>
      ) : (
        <>
          <DialogHeader title={t('resultTitle')} closeLabel={common('close')} />
          <DialogBody>
            <p className="type-body">{t('resultCreated', { count: outcome.created })}</p>
            {outcome.skipped === 0 ? null : (
              <p className="type-body">{t('resultSkipped', { count: outcome.skipped })}</p>
            )}
            {outcome.rejected.length === 0 ? null : (
              <>
                <p className="type-body-strong">{t('rejectedTitle', { count: outcome.rejected.length })}</p>
                <ul className="flex flex-col gap-1">
                  {outcome.rejected.map((entry) => (
                    <li key={entry.line} className="type-meta">
                      {t('rejectedLine', { line: entry.line, reason: entry.reason })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DialogBody>
          <DialogFooter
            primary={
              <Button ref={doneRef} variant="primary" onClick={close}>
                {t('done')}
              </Button>
            }
          />
        </>
      )}
    </Dialog>
  );
}
