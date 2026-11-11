import type { ProjectEngine, Prompt } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';
import type { Country } from '@/lib/locations/countries';

/**
 * Plain data and functions of Topics & Prompts (spec 2026-11-11 section 4.6): the window, the tabs, a pasted
 * list of prompts and the countries a prompt may stand for. The screens put words to it.
 */

/** The windows offered; the API takes at most 92 days. */
export const WINDOW_DAYS = [7, 28, 90] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];
export const DEFAULT_WINDOW: WindowDays = 28;

export const parseWindow = (value: string | null): WindowDays =>
  WINDOW_DAYS.find((days) => String(days) === value) ?? DEFAULT_WINDOW;

/** Project dates, `to` included, as the API's `from` and `to` take them. */
export interface DateRange {
  from: string;
  to: string;
}

/** The last `days` days in the project's time zone, today included. */
export function windowRange(days: WindowDays, now: Date, timeZone: string): DateRange {
  const to = formatIsoDate(now, timeZone);
  const [year = 1970, month = 1, day = 1] = to.split('-').map(Number);
  // Calendar arithmetic in UTC, so a clock change in the project's zone moves no day
  const from = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return { from: from.toISOString().slice(0, 10), to };
}

/** The tabs of slice 1 (ADR-DS-022): Panels and Versions wait for slice 4. */
export const PROMPTS_TABS = ['topics', 'prompts'] as const;
export type PromptsTab = (typeof PROMPTS_TABS)[number];
export const parseTab = (value: string | null): PromptsTab => (value === 'prompts' ? 'prompts' : 'topics');

/** The prompt's topics: its terms of a topic vocabulary. */
export const topicTermsOf = (prompt: Prompt): Prompt['terms'] =>
  prompt.terms.filter((term) => term.vocabulary_kind === 'topic');

/** The most prompts one add takes (plan A `BULK_CREATE_MAX`). */
export const BULK_MAX = 1000;

export interface PromptLine {
  text: string;
  /** From 1, as the person sees the line in the field. */
  line: number;
}

export interface PromptLines {
  lines: PromptLine[];
  /** A line that repeats an earlier one, which is left out. */
  repeats: { line: number; first: number }[];
}

/** What the API compares: composed (NFC) and trimmed. */
const tidy = (text: string): string => text.normalize('NFC').trim();

/**
 * One line as a prompt: control characters that are not white space are dropped (the API refuses them), and
 * every run of white space, a tab included, becomes one space.
 */
const cleanLine = (raw: string): string =>
  tidy(raw.replace(/\p{Cc}/gu, (char) => (/\s/.test(char) ? char : '')).replace(/\s+/g, ' '));

/**
 * One prompt per line, cleaned as the API stores it; blank lines and repeats are left out. A zero width joiner
 * or non-joiner is kept: the API refuses it and the dialog shows that.
 */
export function readPromptLines(text: string): PromptLines {
  const seen = new Map<string, number>();
  const lines: PromptLine[] = [];
  const repeats: { line: number; first: number }[] = [];
  text.split('\n').forEach((raw, index) => {
    const value = cleanLine(raw);
    if (value === '') return;
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, index + 1);
      lines.push({ text: value, line: index + 1 });
    } else {
      repeats.push({ line: index + 1, first });
    }
  });
  return { lines, repeats };
}

/** What makes two prompts the same one for the API (plan A decision A2): text, language and country. */
export const promptKeyOf = (text: string, languageCode: string, countryIso: string): string =>
  `${tidy(text)}\u0000${languageCode}\u0000${countryIso}`;

/** Whether the engine takes the prompt: its limit counts characters (code points), as Python does. */
export const fitsEngine = (text: string, engine: ProjectEngine): boolean =>
  [...text].length <= engine.engine.max_prompt_chars;

/**
 * The countries a prompt may stand for: those every enabled engine has a location in (plan A decision A5), or
 * every country while no engine is on.
 */
export function countriesForEngines(
  engines: readonly ProjectEngine[],
  countries: readonly Country[],
): readonly Country[] {
  if (engines.length === 0) return countries;
  const isoOf = new Map(countries.map((country) => [country.location_id, country.country_iso]));
  const reach = engines.map(
    (engine) =>
      new Set(
        engine.location_ids.flatMap((id) => {
          const iso = isoOf.get(id);
          return iso === undefined ? [] : [iso];
        }),
      ),
  );
  return countries.filter((country) => reach.every((isos) => isos.has(country.country_iso)));
}
