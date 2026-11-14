import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';
import { validAnswers } from '@/lib/rates/rate-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * Engine agreement (CH-18) as plain data: for each prompt, by how many of the asked engines it is named. Pure.
 *
 * An engine names a prompt when it has `MIN_OBSERVATIONS` or more valid answers on it and at least one of them names
 * the brand. A prompt whose valid answers on any asked engine are fewer than that (or that has no cell for it) cannot
 * say whether that engine names the brand, and reading it as "not named" would turn unknown into no (R6). It is left
 * out and counted, so the steps add up to the compared prompts and the left out ones are said beside them (D6).
 */

/** Agreement compares engines: one engine has nothing to agree with. */
export const MIN_AGREEMENT_ENGINES = 2;

/** The sequential scale of CH-18, light to dark: the more engines name the brand, the darker the step. */
const SCALE = ['seq-3', 'seq-4', 'seq-5', 'seq-6'] as const;
export type AgreementScale = (typeof SCALE)[number];

export interface AgreementStep {
  /** How many engines name the prompt: 0 to the number of asked engines. */
  named: number;
  /** The compared prompts named by exactly `named` engines. */
  prompts: number;
  scale: AgreementScale;
}

export type AgreementModel =
  | { kind: 'tooFewEngines' }
  | { kind: 'noPrompts' }
  /** Every prompt has too few valid answers on some engine. */
  | { kind: 'nothingComparable'; leftOut: number; prompts: number }
  | {
      kind: 'ok';
      /** The asked engines: the "N" of "Named by 2 of N". */
      engines: number;
      /** Steps 0 to `engines`. */
      steps: AgreementStep[];
      /** The prompts with enough valid answers on every asked engine; the steps add up to it. */
      compared: number;
      /** The prompts left out for too few valid answers on an engine. */
      leftOut: number;
      /** The prompts in scope, once: `compared + leftOut`. */
      prompts: number;
    };

export interface AgreementInput {
  prompts: readonly PromptSummaryRow[];
  asked: readonly EngineCode[];
}

/** The darkest step is always `seq-6` and the lightest `seq-3`, whatever the number of engines. */
const scaleOf = (place: number, steps: number): AgreementScale =>
  SCALE[Math.round((place * (SCALE.length - 1)) / (steps - 1))] ?? 'seq-6';

export function agreementOf({ prompts, asked }: AgreementInput): AgreementModel {
  if (asked.length < MIN_AGREEMENT_ENGINES) return { kind: 'tooFewEngines' };
  if (prompts.length === 0) return { kind: 'noPrompts' };
  const counts = Array.from({ length: asked.length + 1 }, () => 0);
  let leftOut = 0;
  for (const prompt of prompts) {
    const cells = asked.map((code) => prompt.engines.find((engine) => engine.engine_code === code)?.mentioned);
    if (cells.some((cell) => cell === undefined || validAnswers(cell) < MIN_OBSERVATIONS)) {
      leftOut += 1;
    } else {
      const named = cells.filter((cell) => cell !== undefined && cell.numerator > 0).length;
      counts[named] = (counts[named] ?? 0) + 1;
    }
  }
  const compared = prompts.length - leftOut;
  if (compared === 0) return { kind: 'nothingComparable', leftOut, prompts: prompts.length };
  return {
    kind: 'ok',
    engines: asked.length,
    steps: counts.map((count, named) => ({ named, prompts: count, scale: scaleOf(named, counts.length) })),
    compared,
    leftOut,
    prompts: prompts.length,
  };
}
