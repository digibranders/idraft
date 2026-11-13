import type { useTranslations } from 'next-intl';

import type { ClassifiedLine, LineCounts, LineGroup } from './add-model';
import { PROMPT_TEXT_MAX } from '../prompt-model';
import type { EngineCode, Schemas } from '@/lib/api/types';
import { formatInteger, formatList } from '@/lib/format';

/**
 * What the check list of the Add prompts dialog shows, as plain rows: each line with its outcome and its reasons
 * already put into words. No React and no request. WP-28 builds the same rows from the lines of a CSV file.
 * shortcut: the five rules the lint added carry the API's own English `message`, as the contract words them; widen
 * the catalog when the API sends the numbers and names apart from the sentence.
 */

/** The translator of `prompts.add`, as `useTranslations('prompts.add')` and `createTranslator` give it. */
export type AddTranslate = ReturnType<typeof useTranslations<'prompts.add'>>;

export type PromptType = Schemas['PromptLint']['suggested_prompt_type'];
type Severity = Schemas['LintWarning']['severity'];

export type CheckTone = 'error' | 'warning' | 'note';

export interface CheckReason {
  tone: CheckTone;
  text: string;
}

export interface CheckRow {
  /** From 1, as the person sees the line in the field. */
  line: number;
  text: string;
  /** The language of `text`, for `lang`. */
  language: string;
  group: LineGroup;
  /** The most serious first. */
  reasons: readonly CheckReason[];
  /** "Type: comparison (from wording)", for a line that will be added with the type the wording gives. */
  suggestedType: string | null;
  /** The project's prompt a tracked or archived line is, to show it. */
  target: string | null;
}

export interface CheckContext {
  languageCode: string;
  /** The enabled engines by code: a limit of an engine that is off is not the project's concern. */
  engineLabels: ReadonlyMap<EngineCode, string>;
  /** The type the person chose; `null` when it is set from the wording. */
  promptType: PromptType | null;
}

/** The catalog key of each prompt type: keys are camelCase. */
const TYPE_KEY = {
  question: 'question',
  comparison: 'comparison',
  recommendation: 'recommendation',
  how_to: 'howTo',
  definition: 'definition',
  local: 'local',
  transactional: 'transactional',
  other: 'other',
} as const satisfies Readonly<Record<PromptType, string>>;

const TONE_RANK: Readonly<Record<CheckTone, number>> = { error: 0, warning: 1, note: 2 };
/** Errors come first, so a line that blocks the add is never the one hidden behind "and more". */
const bySeriousness = (a: CheckReason, b: CheckReason): number => TONE_RANK[a.tone] - TONE_RANK[b.tone];

const toneOf = (severity: Severity): CheckTone =>
  severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'note';

/** One finding of the lint on a line that will be added, or none when it is not the project's concern. */
function findingOf(
  warning: Schemas['LintWarning'],
  lint: Schemas['PromptLint'],
  text: string,
  context: CheckContext,
  t: AddTranslate,
): CheckReason[] {
  switch (warning.rule) {
    case 'contains_brand_alias': {
      const brand = lint.matched_aliases[0]?.entity.canonical_name;
      return [{ tone: 'note', text: brand === undefined ? warning.message : t('check.reason.branded', { brand }) }];
    }
    case 'engine_limit': {
      const engine = warning.engine_code === null ? undefined : context.engineLabels.get(warning.engine_code);
      return engine === undefined
        ? []
        : [{ tone: toneOf(warning.severity), text: t('check.reason.engineLimit', { engine }) }];
    }
    case 'contains_competitor_alias': {
      const span = warning.span;
      // A prompt that compares names its rivals on purpose, whether the person chose the type or the wording gives it
      if ((context.promptType ?? lint.suggested_prompt_type) === 'comparison') {
        const name = span === null ? '' : text.slice(span.start, span.end);
        return [{ tone: 'note', text: name === '' ? warning.message : t('check.reason.compares', { name }) }];
      }
      return [{ tone: toneOf(warning.severity), text: warning.message }];
    }
    default:
      return [{ tone: toneOf(warning.severity), text: warning.message }];
  }
}

function reasonsOf(
  line: ClassifiedLine,
  lint: Schemas['PromptLint'] | undefined,
  context: CheckContext,
  t: AddTranslate,
): CheckReason[] {
  switch (line.group) {
    case 'refused':
      return [
        {
          tone: 'error',
          text:
            line.refusal === 'tooLong'
              ? t('check.reason.tooLong', { max: formatInteger(PROMPT_TEXT_MAX) })
              : t('check.reason.unsupported'),
        },
      ];
    case 'tracked':
      return [{ tone: 'note', text: t('check.reason.tracked') }];
    case 'archived':
      return [{ tone: 'note', text: t('check.reason.archived') }];
    case 'repeat':
      return [{ tone: 'note', text: t('check.reason.repeat', { first: line.first ?? 0 }) }];
    case 'new': {
      const findings =
        lint === undefined ? [] : lint.warnings.flatMap((w) => findingOf(w, lint, line.text, context, t));
      const near: CheckReason[] =
        line.nearDuplicate === null
          ? []
          : [{ tone: 'note', text: t('check.reason.nearDuplicate', { text: line.nearDuplicate.text }) }];
      return [...findings, ...near].sort(bySeriousness);
    }
  }
}

/** Each classified line as a row: its reasons from what the lint found, and the type its wording suggests. */
export function checkRowsOf(
  lines: readonly ClassifiedLine[],
  lint: readonly Schemas['PromptLint'][] | null,
  context: CheckContext,
  t: AddTranslate,
): CheckRow[] {
  const answers = new Map((lint ?? []).map((row) => [row.text, row]));
  return lines.map((line): CheckRow => {
    const answer = answers.get(line.text);
    const suggested = line.group === 'new' && context.promptType === null ? answer?.suggested_prompt_type : undefined;
    return {
      line: line.line,
      text: line.text,
      language: context.languageCode,
      group: line.group,
      reasons: reasonsOf(line, answer, context, t),
      suggestedType:
        suggested === undefined ? null : t('check.suggestedType', { type: t(`check.types.${TYPE_KEY[suggested]}`) }),
      target: line.promptId,
    };
  });
}

/** `refused` and `warnings` come first: the blocks, then what to look at, then where the other lines go. */
export type CheckGroupId = 'refused' | 'warnings' | 'new' | 'tracked' | 'archived' | 'repeat';

export interface CheckGroup {
  id: CheckGroupId;
  rows: readonly CheckRow[];
}

const withReasons = (
  row: CheckRow,
  keep: (reason: CheckReason) => boolean,
  suggestedType: string | null,
): CheckRow => ({
  ...row,
  reasons: row.reasons.filter(keep),
  suggestedType,
});

/**
 * The rows by outcome, errors first. A line that will be added with a warning is in Warnings with its warnings and
 * in Will be added with its notes, so a count says how many lines it is about. Empty groups are left out.
 */
export function groupRows(rows: readonly CheckRow[]): CheckGroup[] {
  const of = (group: LineGroup): CheckRow[] => rows.filter((row) => row.group === group);
  const added = of('new');
  const warned = (reason: CheckReason): boolean => reason.tone !== 'note';
  const groups: CheckGroup[] = [
    { id: 'refused', rows: of('refused') },
    {
      id: 'warnings',
      rows: added.filter((row) => row.reasons.some(warned)).map((row) => withReasons(row, warned, null)),
    },
    { id: 'new', rows: added.map((row) => withReasons(row, (reason) => !warned(reason), row.suggestedType)) },
    { id: 'tracked', rows: of('tracked') },
    { id: 'archived', rows: of('archived') },
    { id: 'repeat', rows: of('repeat') },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/** "12 lines: 9 new, 2 already tracked, and 1 repeat"; `null` for a field with no line. */
export function counterText(t: AddTranslate, locale: string, counts: LineCounts): string | null {
  if (counts.lines === 0) return null;
  const parts = [
    counts.new === 0 ? null : t('check.counterNew', { count: formatInteger(counts.new) }),
    counts.tracked === 0
      ? null
      : t('check.counterTracked', { count: formatInteger(counts.tracked), archived: counts.archived }),
    counts.repeats === 0 ? null : t('check.counterRepeats', { count: counts.repeats }),
    counts.refused === 0 ? null : t('check.counterRefused', { count: formatInteger(counts.refused) }),
  ].filter((part): part is string => part !== null);
  return t('check.counter', { lines: counts.lines, parts: formatList(parts, locale) });
}
