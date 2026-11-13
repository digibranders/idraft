import type { BrandedChoice } from './add-values';
import type { ClassifiedLine } from './add-model';
import type { AddTranslate } from './check-rows';
import { PROMPT_TEXT_MAX } from '../prompt-model';
import type { EngineCode, PromptLint } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

/**
 * The short lines under the Prompts field that name what leaves a line out or blocks the add: a repeat, a tracked
 * line, a line the API would refuse, a name of the own brand and a limit of an engine that is on. The check list
 * below holds the full account; the rules it words alone (word count, wording, language) are not repeated here.
 */

export type FindingTone = 'error' | 'warning' | 'note';

export interface Finding {
  line: number;
  tone: FindingTone;
  text: string;
}

/** Errors come first, so a line that blocks the add is never the one hidden behind "and more". */
const TONE_ORDER: Readonly<Record<FindingTone, number>> = { error: 0, warning: 1, note: 2 };

export interface FindingsInput {
  lines: readonly ClassifiedLine[];
  /** The lint's rows; `null` while it is pending or failed. */
  lint: readonly PromptLint[] | null;
  /** The enabled engines by code: a limit of an engine that is off is not the project's concern. */
  engineLabels: ReadonlyMap<EngineCode, string>;
  branded: BrandedChoice;
  t: AddTranslate;
}

export function findingsOf({ lines, lint, engineLabels, branded, t }: FindingsInput): Finding[] {
  const rows = new Map((lint ?? []).map((row) => [row.text, row]));
  return lines
    .flatMap(({ line, text, group, first, refusal }): Finding[] => {
      if (group === 'repeat')
        return [{ line, tone: 'note', text: t('findings.repeat', { line, first: first ?? line }) }];
      if (refusal !== null) {
        const message =
          refusal === 'tooLong'
            ? t('findings.tooLong', { line, max: formatInteger(PROMPT_TEXT_MAX) })
            : t('findings.unsupported', { line });
        return [{ line, tone: 'error', text: message }];
      }
      if (group === 'tracked' || group === 'archived') {
        return [{ line, tone: 'note', text: t('findings.tracked', { line }) }];
      }
      const row = rows.get(text);
      return (row?.warnings ?? []).flatMap((warning): Finding[] => {
        if (warning.rule === 'contains_brand_alias') {
          const brand = row?.matched_aliases[0]?.entity.canonical_name ?? '';
          return branded === 'never'
            ? [{ line, tone: 'warning', text: t('findings.neverBranded', { line, brand }) }]
            : [{ line, tone: 'note', text: t('findings.branded', { line, brand }) }];
        }
        if (warning.rule !== 'engine_limit') return [];
        const engine = warning.engine_code === null ? undefined : engineLabels.get(warning.engine_code);
        return engine === undefined
          ? []
          : [{ line, tone: 'warning', text: t('findings.engineLimit', { line, engine }) }];
      });
    })
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.line - b.line);
}
