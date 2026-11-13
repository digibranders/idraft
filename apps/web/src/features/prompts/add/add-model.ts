import { promptKeyOf, PROMPT_TEXT_MAX, type PromptLines } from '../prompt-model';
import { money } from '@/lib/format/money';
import type { EngineCode, PromptLint, Schemas } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';

/**
 * Plain data and functions of the Add prompts dialog (prompt-dialogs 4.3 to 4.5): what each pasted line becomes, how
 * many places an add takes of the workspace's limit, the numbers of the plan and why the add is off. No React and no
 * request: the dialog hands over the lines it read and the answer of the lint, and puts words to what comes back.
 * WP-28 reads CSV rows through the same functions.
 */

/** What the API refuses in a prompt (its `printable` rule): control, format and line or paragraph separator characters. */
const UNSAVABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type Refusal = 'tooLong' | 'unsupported';

/** Why the API would refuse the whole request for this line, found here before anything is sent. */
export const refusalOf = (text: string): Refusal | null => {
  if (textLength(text) > PROMPT_TEXT_MAX) return 'tooLong';
  return UNSAVABLE.test(text) ? 'unsupported' : null;
};

/**
 * `new`: would be created. `tracked`: the project has it active. `archived`: the project has it archived (it counts
 * as tracked, and can be brought back). `repeat`: an earlier line is the same. `refused`: the API would refuse it.
 */
export type LineGroup = 'new' | 'tracked' | 'archived' | 'repeat' | 'refused';

export interface ClassifiedLine {
  /** From 1, as the person sees the line in the field. */
  line: number;
  text: string;
  group: LineGroup;
  /** `tracked` and `archived`: the project's prompt. */
  promptId: string | null;
  /** `repeat`: the line it repeats. */
  first: number | null;
  refusal: Refusal | null;
  /** `new`: a prompt of the market that differs only in case and spacing, which is no duplicate. */
  nearDuplicate: { promptId: string; text: string } | null;
}

export interface ClassifyInput {
  read: PromptLines;
  /** The lint's rows; `null` while the lint is pending or failed. */
  lint: readonly PromptLint[] | null;
  /** The keys (`promptKeyOf`) of the loaded active prompts: what decides while the lint cannot. */
  existingKeys: ReadonlySet<string>;
  languageCode: string;
  countryIso: string;
  /**
   * The lint answered in the shape that says what is tracked (items, country chosen): a row of it that names no
   * tracked prompt means the project has none, whatever the loaded page holds. Without it the loaded prompts decide.
   */
  authoritative?: boolean;
}

const blank = (line: number, text: string): ClassifiedLine => ({
  line,
  text,
  group: 'new',
  promptId: null,
  first: null,
  refusal: null,
  nearDuplicate: null,
});

/**
 * Each line of a pasted list with what it becomes, in the order the person typed them. The lint decides what the
 * project tracks, archived prompts and active ones beyond the loaded page included; the loaded active prompts are
 * the fallback while the lint is pending, failed, or answered in the shape that does not say.
 */
export function classifyLines({
  read,
  lint,
  existingKeys,
  languageCode,
  countryIso,
  authoritative = false,
}: ClassifyInput): ClassifiedLine[] {
  const rows = new Map((lint ?? []).map((row) => [row.text, row]));
  const lines = read.lines.map(({ line, text }): ClassifiedLine => {
    const refusal = refusalOf(text);
    if (refusal !== null) return { ...blank(line, text), group: 'refused', refusal };
    const row = rows.get(text);
    const tracked = row?.tracked ?? null;
    if (tracked !== null) {
      return { ...blank(line, text), group: tracked.is_active ? 'tracked' : 'archived', promptId: tracked.prompt_id };
    }
    const decided = authoritative && row !== undefined;
    if (!decided && existingKeys.has(promptKeyOf(text, languageCode, countryIso)))
      return { ...blank(line, text), group: 'tracked' };
    const near = row?.near_duplicate_of ?? null;
    return near === null
      ? blank(line, text)
      : { ...blank(line, text), nearDuplicate: { promptId: near.prompt_id, text: near.text } };
  });
  const repeats = read.repeats.map(({ line, first }): ClassifiedLine => ({
    ...blank(line, read.lines.find((entry) => entry.line === first)?.text ?? ''),
    group: 'repeat',
    first,
  }));
  return [...lines, ...repeats].sort((a, b) => a.line - b.line);
}

/** The lines that would be sent: the new ones, near duplicates included. */
export const linesToSend = (lines: readonly ClassifiedLine[]): ClassifiedLine[] =>
  lines.filter((line) => line.group === 'new');

export interface LineCounts {
  /** Every line typed that has text. */
  lines: number;
  new: number;
  /** Active and archived prompts the project has. */
  tracked: number;
  /** Of `tracked`, the archived ones. */
  archived: number;
  repeats: number;
  refused: number;
}

export function lineCounts(lines: readonly { group: LineGroup }[]): LineCounts {
  const of = (...groups: LineGroup[]): number => lines.filter((line) => groups.includes(line.group)).length;
  return {
    lines: lines.length,
    new: of('new'),
    tracked: of('tracked', 'archived'),
    archived: of('archived'),
    repeats: of('repeat'),
    refused: of('refused'),
  };
}

/** How many prompts the add would create: the lint's number, else the lines that look new. */
export const wouldCreateOf = (quota: Schemas['PromptQuota'] | null | undefined, counts: LineCounts): number =>
  quota?.would_create ?? counts.new;

export interface QuotaState {
  limit: number;
  used: number;
  /** Places left, never negative. */
  room: number;
  /** Places the add takes: the prompts to create and the archived ones to bring back. */
  needs: number;
  /** The workspace's active prompts once the add is done. */
  after: number;
  over: boolean;
  /** How many places short, when over. */
  short: number;
}

export function quotaState(prompts: { limit: number; used: number }, wouldCreate: number, restore: number): QuotaState {
  const room = Math.max(0, prompts.limit - prompts.used);
  const needs = wouldCreate + restore;
  const over = needs > room;
  return { ...prompts, room, needs, after: prompts.used + needs, over, short: over ? needs - room : 0 };
}

export interface EnginePlan {
  engineCode: EngineCode;
  promptsFit: number;
  answersPerMonth: number;
  /** US dollars; `null` when the price book has no price for the engine. */
  monthlyCost: number | null;
  runNowAnswers: number;
  runNowCost: number | null;
}

export interface PlanNumbers {
  prompts: number;
  engines: EnginePlan[];
  answersPerMonth: number;
  /** The engines that have a price, added; `null` when none has one. */
  monthlyCost: number | null;
  runNowAnswers: number;
  runNowCost: number | null;
  unpricedEngines: EngineCode[];
}

const priced = (value: string | null): number | null => (value === null ? null : money(value));
/** The API's money has six places, so a sum is rounded to them: 0.0108 and 0.0084 add to 0.0192, not to 0.0192000...2. */
const sum = (values: readonly number[]): number =>
  Math.round(values.reduce((total, value) => total + value, 0) * 1_000_000) / 1_000_000;

/** The plan's numbers from the lint's estimate; `null` without one, never a plan of zeros. */
export function planNumbers(
  estimate: Schemas['LintEstimate'] | null | undefined,
  wouldCreate: number,
): PlanNumbers | null {
  if (estimate === null || estimate === undefined) return null;
  const engines = estimate.engines.map((engine): EnginePlan => ({
    engineCode: engine.engine_code,
    promptsFit: engine.prompts_fit,
    answersPerMonth: engine.answers_per_month,
    monthlyCost: priced(engine.monthly_cost_usd),
    runNowAnswers: engine.run_now_answers,
    runNowCost: priced(engine.run_now_cost_usd),
  }));
  const runNowCosts = engines.flatMap((engine) => (engine.runNowCost === null ? [] : [engine.runNowCost]));
  return {
    prompts: wouldCreate,
    engines,
    answersPerMonth: sum(engines.map((engine) => engine.answersPerMonth)),
    monthlyCost: priced(estimate.total_monthly_cost_usd),
    runNowAnswers: sum(engines.map((engine) => engine.runNowAnswers)),
    runNowCost: runNowCosts.length === 0 ? null : sum(runNowCosts),
    unpricedEngines: engines.filter((engine) => engine.monthlyCost === null).map((engine) => engine.engineCode),
  };
}

/** Why the Add button is off, in the order the dialog says them. */
export type DisabledReason = 'empty' | 'cannotAdd' | 'allTracked' | 'overQuota';

/** `restore`: the archived prompts the add brings back, which make an add of their own. */
export function disabledReason(counts: LineCounts, quota: QuotaState | null, restore: number): DisabledReason | null {
  if (counts.lines === 0) return 'empty';
  if (counts.refused > 0) return 'cannotAdd';
  if (counts.new + restore === 0) return 'allTracked';
  return quota?.over === true ? 'overQuota' : null;
}
