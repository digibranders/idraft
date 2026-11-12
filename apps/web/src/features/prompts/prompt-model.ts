import type {
  MetricCell,
  ObservationSummary,
  ProjectEngine,
  Prompt,
  PromptsSummary,
  PromptSummaryRow,
  TopicSummaryRow,
} from '@/lib/api/types';
import { formatIsoDate, formatSampleCount } from '@/lib/format';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
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

/**
 * "4 of 8": the valid answers that count over the valid answers of a cell, for Mentioned, Cited and the
 * outcome cells; `null` where none is valid (the API sends `value` null for a denominator of 0), never
 * "0 of 0". A prompt's cell counts answers in `numerator` and `denominator`. A topic's cell is prompt weighted:
 * its numerator is a sum of rates (2.5 is possible) over the prompts with a valid answer, so it reads the
 * answers from `pooled`. Share of voice is not a count (its numerator is a sum of shares): it is not for this
 * function, and a numerator that is no whole number without `pooled` gives `null` rather than a rounded count.
 */
export function countText(cell: MetricCell | undefined): string | null {
  if (cell === undefined || cell.value === null) return null;
  if (cell.pooled != null) return formatSampleCount(cell.pooled.successes, cell.pooled.trials);
  return Number.isInteger(cell.numerator) ? formatSampleCount(cell.numerator, cell.denominator) : null;
}

/** The prompt's topics: its terms of a topic vocabulary. */
export const topicTermsOf = (prompt: Prompt): Prompt['terms'] =>
  prompt.terms.filter((term) => term.vocabulary_kind === 'topic');

export type TopicTerm = Prompt['terms'][number];

/** Each topic term the prompts carry, once, by id: the choices of a topic filter. */
export function collectTopicTerms(prompts: readonly Prompt[]): Map<string, TopicTerm> {
  const terms = new Map<string, TopicTerm>();
  for (const prompt of prompts) for (const term of topicTermsOf(prompt)) terms.set(term.term_id, term);
  return terms;
}

/** A topic and the topics below it, by term id; each topic is in its own set. */
export type TopicDescendants = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The topics below each topic of the vocabularies' trees (`tree`, from the topic vocabularies only), as the
 * summary's rows roll a prompt up: a prompt given a term counts under it and under every term above it. A
 * term in `extra` that the tree does not hold (one a prompt carries before the tree is read) stands alone.
 */
export function topicDescendants(tree: readonly NamedTerm[], extra: Iterable<string>): Map<string, Set<string>> {
  const children = new Map<string, string[]>();
  for (const term of tree) {
    if (term.parentId !== null) children.set(term.parentId, [...(children.get(term.parentId) ?? []), term.termId]);
  }
  const below = new Map<string, Set<string>>();
  const ids = [...tree.map((term) => term.termId), ...extra];
  for (const id of ids) {
    const found = new Set<string>();
    const pending = [id];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (found.has(next)) continue;
      found.add(next);
      pending.push(...(children.get(next) ?? []));
    }
    below.set(id, found);
  }
  return below;
}

/** The chosen topics and every topic below them. A chosen topic the tree does not hold stands for itself. */
export function topicsBelow(chosen: readonly string[], descendants: TopicDescendants): Set<string> {
  const kept = new Set<string>();
  for (const id of chosen) for (const below of descendants.get(id) ?? [id]) kept.add(below);
  return kept;
}

/** Whether the prompt carries a topic of `kept` (the topics a filter keeps). The caller sends every prompt when none is chosen. */
export const matchesTopics = (prompt: Prompt, kept: ReadonlySet<string>): boolean =>
  topicTermsOf(prompt).some((term) => kept.has(term.term_id));

/** Whether the summary's topic row stays under a topic filter: it is in `kept`. The row of no topic never is. */
export const topicRowKept = (termId: string | null, kept: ReadonlySet<string>): boolean =>
  termId !== null && kept.has(termId);

/**
 * The prompts of the summary a topic row holds, as the API rolls them up: those given the topic or a topic
 * below it, each once, though no prompt carries the topic itself; `null` termId is the prompts without a
 * topic. `null` when the tree does not hold the topic (it is not read yet), so its prompts cannot be told.
 */
export function topicMembers(
  termId: string | null,
  prompts: readonly PromptSummaryRow[],
  descendants: TopicDescendants,
): PromptSummaryRow[] | null {
  if (termId === null) return prompts.filter((prompt) => prompt.topic_term_ids.length === 0);
  const below = descendants.get(termId);
  if (below === undefined) return null;
  return prompts.filter((prompt) => prompt.topic_term_ids.some((id) => below.has(id)));
}

/** The topic key of the prompts without a topic, in the address (`topic:__none`) and in the table's row ids. */
export const NO_TOPIC = '__none';

/** The most prompts an opened topic lists in the table, before "Show all" (ADR-DS-022 decision 2). */
export const TOPIC_ROW_PROMPTS = 8;

/** The prompts the topic drawer's Overview lists. */
export const TOPIC_TOP_PROMPTS = 5;

/** The mention rate of the prompts on the engine; one without a rate comes after every one that has. */
const mentionedOn = (prompt: PromptSummaryRow, engineCode: string | undefined): number =>
  prompt.engines.find((engine) => engine.engine_code === engineCode)?.mentioned.value ?? -1;

/** The prompts, most mentioned on the engine first (a stable sort: equals keep their order). */
export const mostMentionedFirst = (
  prompts: readonly PromptSummaryRow[],
  engineCode: string | undefined,
): PromptSummaryRow[] => [...prompts].sort((a, b) => mentionedOn(b, engineCode) - mentionedOn(a, engineCode));

/**
 * The prompts of a topic as its row lists them and its drawer does, most mentioned on `engineCode` first;
 * `null` while they cannot be told (no summary, or a topic the tree does not hold yet).
 */
export function topicPrompts(
  summary: PromptsSummary | undefined,
  key: string,
  descendants: TopicDescendants,
  engineCode: string | undefined,
): PromptSummaryRow[] | null {
  if (summary === undefined) return null;
  const members = topicMembers(key === NO_TOPIC ? null : key, summary.prompts, descendants);
  return members === null ? null : mostMentionedFirst(members, engineCode);
}

/** The summary's row of a topic by its key: the term id, or `NO_TOPIC` for the prompts without one. */
export const topicSummaryRow = (summary: PromptsSummary | undefined, key: string): TopicSummaryRow | undefined =>
  summary?.topics.find((topic) => (topic.term_id ?? NO_TOPIC) === key);

/** The tabs of the topic drawer built in slice 1: Competitors and Related wait for slices 2 and 3. */
export const TOPIC_TABS = ['overview', 'prompts'] as const;
export type TopicTab = (typeof TOPIC_TABS)[number];
export const parseTopicTab = (value: string): TopicTab => (value === 'prompts' ? 'prompts' : 'overview');

/**
 * The equal-weight average of the engines' rates, and how many engines took part (ADR-DS-022 decision 3): an
 * engine with no valid answer has no rate and is left out, not counted as 0. `null` when no engine has one.
 */
export function acrossEngines(cells: readonly MetricCell[]): { value: number; engines: number } | null {
  const values = cells.flatMap((cell) => (cell.value === null ? [] : [cell.value]));
  if (values.length === 0) return null;
  return { value: values.reduce((sum, value) => sum + value, 0) / values.length, engines: values.length };
}

export interface TopicChoice {
  termId: string;
  name: string;
  /** Where the topic sits, to tell two of one name apart. */
  path: string;
}

/**
 * The topics a filter offers: those the prompts carry and every topic above them, so a topic no prompt is
 * given itself can be chosen (the summary has a row for it). The tree's order first; a carried topic the tree
 * does not hold comes after, as the prompt describes it.
 */
export function topicChoices(tree: readonly NamedTerm[], carried: ReadonlyMap<string, TopicTerm>): TopicChoice[] {
  const byId = new Map(tree.map((term) => [term.termId, term]));
  const wanted = new Set<string>();
  for (const id of carried.keys()) {
    for (let at = byId.get(id); at !== undefined && !wanted.has(at.termId); at = byId.get(at.parentId ?? '')) {
      wanted.add(at.termId);
    }
  }
  return [
    ...tree.filter((term) => wanted.has(term.termId)).map(({ termId, name, path }) => ({ termId, name, path })),
    ...[...carried.values()]
      .filter((term) => !byId.has(term.term_id))
      .map((term) => ({ termId: term.term_id, name: term.name, path: term.path })),
  ];
}

/** Whether any prompt has an answer on an engine in the window, valid or not: until one has, the page says when the first arrive. */
export const hasAnswers = (summary: PromptsSummary): boolean =>
  summary.prompts.some((row) => row.engines.some((engine) => engine.mentioned.n_observations > 0));

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

/** The most characters (code points) a prompt may have; a longer one fails the whole request (`prompt_too_long`). */
export const PROMPT_TEXT_MAX = 2000;

/** The zero width non-joiner and joiner: they hold emoji sequences and some scripts together. */
const JOINERS = new Set([String.fromCodePoint(0x200c), String.fromCodePoint(0x200d)]);
/** A line break of a pasted list: CR LF, or any one of LF, CR, the line separator and the paragraph separator. */
const LINE_BREAK = new RegExp(`\\r\\n|[\\n\\r${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}]`);

/** White space stays (it becomes a space); a joiner stays; every other control or format character goes. */
const keepsInvisible = (char: string): boolean => JOINERS.has(char) || (/\s/.test(char) && !/\p{Cf}/u.test(char));

/**
 * One line as a prompt: control and format characters are dropped (the API refuses them; a zero width space,
 * a soft hyphen or a byte order mark comes along with text pasted from the web), except the joiners, and every
 * run of white space, a tab included, becomes one space.
 */
const cleanLine = (raw: string): string =>
  tidy(raw.replace(/[\p{Cc}\p{Cf}]/gu, (char) => (keepsInvisible(char) ? char : '')).replace(/\s+/g, ' '));

/**
 * One prompt per line, cleaned as the API stores it; blank lines and repeats are left out. A zero width joiner
 * or non-joiner is kept: the API refuses it and the dialog shows that.
 */
export function readPromptLines(text: string): PromptLines {
  const seen = new Map<string, number>();
  const lines: PromptLine[] = [];
  const repeats: { line: number; first: number }[] = [];
  text.split(LINE_BREAK).forEach((raw, index) => {
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
 * Whether the engine has a location in the country: a prompt is asked in the locations of its country, and an
 * engine without one is refused by Run now (`location_not_enabled`). A prompt without a country goes anywhere.
 */
export const asksIn = (engine: ProjectEngine, countries: readonly Country[], countryIso: string | null): boolean =>
  countryIso === null ||
  countries.some((country) => country.country_iso === countryIso && engine.location_ids.includes(country.location_id));

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

/** The catalog key of each outcome: the API's values are snake case, catalog keys camel case. */
const OUTCOME_KEYS = {
  mentioned_and_cited: 'mentionedAndCited',
  mentioned_only: 'mentionedOnly',
  cited_only: 'citedOnly',
  neither: 'neither',
} as const;

/**
 * The catalog key (`prompts.inspector.outcomes`) of what an answer came to. An answer that came back has its
 * facts read a moment later, so it is `pending` until then; one that failed or was refused never has any, and
 * an answer that is not valid is in no bucket: both are `notCounted`.
 */
export function outcomeKey(
  status: ObservationSummary['status'],
  facts: ObservationSummary['facts'],
): (typeof OUTCOME_KEYS)[keyof typeof OUTCOME_KEYS] | 'pending' | 'notCounted' {
  if (facts === null) return status === 'complete' || status === 'partial' ? 'pending' : 'notCounted';
  return !facts.is_valid || facts.outcome === null ? 'notCounted' : OUTCOME_KEYS[facts.outcome];
}
