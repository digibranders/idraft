'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { classifyLines, lineCounts, refusalOf, wouldCreateOf, type ClassifiedLine, type LineCounts } from './add-model';
import { lintBodyOf, useAddLint } from './add-queries';
import type { BrandedChoice } from './add-values';
import { checkRowsOf, counterText, type CheckRow, type PromptType } from './check-rows';
import { BULK_MAX, promptKeyOf, readPromptLines } from '../prompt-model';
import type { LintAnswer, PromptScope } from '../prompt-queries';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';

/** The lint asks this long after typing stops. */
export const LINT_DELAY_MS = 300;

export interface AddCheckInput {
  scope: PromptScope;
  /** The field as typed. */
  text: string;
  languageCode: string;
  countryIso: string;
  /** The project's enabled engines: their length limits apply. */
  engines: readonly ProjectEngine[];
  /** The loaded active prompts: what decides while the lint cannot say what the project tracks. */
  existing: readonly Prompt[];
  /** The type the person chose; `null` when it is set from the wording. */
  promptType: PromptType | null;
  /** The Branded choice: "never" turns a line that names the own brand into a warning. */
  branded: BrandedChoice;
}

export interface AddCheck {
  lines: ClassifiedLine[];
  counts: LineCounts;
  rows: CheckRow[];
  /** "12 lines: 9 new, 2 already tracked, and 1 repeat"; `null` for an empty field. */
  counter: string | null;
  /** The lint's answer for these lines, market and engines; `null` when none applies (not asked, failed, or another market's). */
  answer: LintAnswer | null;
  /** How many prompts the add would create: the lint's number, else the lines that look new. */
  wouldCreate: number;
  /** The typing has not settled or the lint is out: the numbers shown are the last ones and may change. */
  checking: boolean;
  /** The lint failed: the loaded prompts decide, and the server has the last word. */
  failed: boolean;
  /** No country is chosen, so the lint cannot say what is tracked and answers only the warnings. */
  needsCountry: boolean;
}

/**
 * The check of a pasted list: each line with what it becomes, from the lint (which knows the archived prompts and the
 * ones past the loaded page) and, while it cannot answer, the loaded prompts. The lint is asked for every line that
 * the API would not refuse, tracked ones included, for the language and country chosen. Plain data comes out, which
 * `CheckList` shows and the plan, the quota and the submit read.
 */
export function useAddCheck({
  scope,
  text,
  languageCode,
  countryIso,
  engines,
  existing,
  promptType,
  branded,
}: AddCheckInput): AddCheck {
  const t = useTranslations('prompts.add');
  const locale = useLocale();
  const read = useMemo(() => readPromptLines(text), [text]);
  const existingKeys = useMemo(
    () =>
      new Set(
        existing.map((prompt) =>
          promptKeyOf(prompt.current_version.text, prompt.language_code, prompt.country_iso ?? ''),
        ),
      ),
    [existing],
  );
  // A line the API would refuse fails the whole request, and so does a list longer than one add takes: those are
  // named here without it
  const texts = useMemo(
    () =>
      read.lines.length > BULK_MAX
        ? []
        : read.lines.filter((line) => refusalOf(line.text) === null).map((line) => line.text),
    [read],
  );
  const settled = useDebouncedValue(texts, LINT_DELAY_MS);
  const engineCodes = useMemo(() => engines.map((engine) => engine.engine.engine_code), [engines]);
  const input = { texts: settled, languageCode, countryIso, engineCodes };
  const query = useAddLint(scope, input);

  const answer = query.isError ? null : (query.data ?? null);
  // Only the items shape says what is tracked: its row of "not tracked" outranks the loaded page
  const itemsShape = 'items' in lintBodyOf(input);
  const lines = useMemo(
    () =>
      classifyLines({
        read,
        lint: answer?.data ?? null,
        existingKeys,
        languageCode,
        countryIso,
        authoritative: answer !== null && itemsShape,
      }),
    [read, answer, existingKeys, languageCode, countryIso, itemsShape],
  );
  const counts = useMemo(() => lineCounts(lines), [lines]);
  const engineLabels = useMemo(
    () => new Map(engines.map((engine) => [engine.engine.engine_code, engine.engine.label])),
    [engines],
  );
  const rows = useMemo(
    () => checkRowsOf(lines, answer?.data ?? null, { languageCode, engineLabels, promptType, branded }, t),
    [lines, answer, languageCode, engineLabels, promptType, branded, t],
  );
  const asking = texts.length > 0;
  return {
    lines,
    counts,
    rows,
    counter: counterText(t, locale, counts),
    answer,
    wouldCreate: wouldCreateOf(answer?.quota, counts),
    checking: asking && (settled !== texts || query.isFetching),
    failed: asking && query.isError && !query.isFetching,
    needsCountry: asking && !itemsShape,
  };
}
