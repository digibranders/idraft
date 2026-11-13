import { outcomeFigures } from './outcome-model';
import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';
import { engineRates } from '@/lib/rates/strip-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The numbers of "From answer to citation, by engine" (CH-36). Pure.
 *
 * The funnel pools answers: its counts are sums over the prompts, and a share is a count over the step before. The
 * strip's rates are the mean of each prompt's own rate, so the two differ when prompts have different numbers of
 * answers; the card's footnote says so. The counts are the strip's own (`engineRates`), so one number has one
 * denominator (R12). Answers that were not valid are collection loss: they leave the funnel at its second step
 * and are never counted as a miss.
 */

export type FunnelStepId = 'answers' | 'valid' | 'named' | 'cited';

export interface FunnelStep {
  id: FunnelStepId;
  /** `null` is unknown: the engine has no answer, or no valid answer to count in. Never 0 for those. */
  count: number | null;
  /** The count of the step before; `null` for the first step and where it is unknown. */
  of: number | null;
  /** `count` over `of`, as 0 to 1; `null` where the step before has too few answers (`thin`) or the step is unknown. */
  share: number | null;
  /** The step before has fewer answers than a share needs: the card says how many there are and draws no share. */
  thin: boolean;
}

export interface EngineFunnel {
  engineCode: EngineCode;
  /** The four steps, in order. */
  steps: FunnelStep[];
  /** Answers that were not valid (collection loss); 0 when every answer was valid. */
  notValid: number;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function step(id: FunnelStepId, count: number | null, of: number | null): FunnelStep {
  if (count === null || of === null) return { id, count, of, share: null, thin: false };
  const thin = of < MIN_OBSERVATIONS;
  return { id, count, of, share: thin ? null : count / of, thin };
}

/** The funnel of each engine in `asked`, in that order. */
export function funnelOf(prompts: readonly PromptSummaryRow[], asked: readonly EngineCode[]): EngineFunnel[] {
  return asked.map((engineCode): EngineFunnel => {
    const answers = sum(
      prompts.flatMap((prompt) =>
        prompt.engines
          .filter((entry) => entry.engine_code === engineCode)
          .map((entry) => entry.mentioned.n_observations),
      ),
    );
    if (answers === 0) {
      const unknown = (id: FunnelStepId): FunnelStep => step(id, null, null);
      return {
        engineCode,
        steps: [unknown('answers'), unknown('valid'), unknown('named'), unknown('cited')],
        notValid: 0,
      };
    }
    const mentioned = engineRates(prompts, engineCode).mentioned;
    const valid = mentioned.answers;
    // With no valid answer there is nothing to name or cite in: unknown, not a miss
    const named = valid === 0 ? null : mentioned.successes;
    const cited = valid === 0 ? null : outcomeFigures(prompts, engineCode).mentioned_and_cited.successes;
    return {
      engineCode,
      steps: [
        step('answers', answers, null),
        step('valid', valid, answers),
        step('named', named, valid),
        step('cited', cited, named),
      ],
      notValid: answers - valid,
    };
  });
}

/** The largest count of any engine: the one scale of every group, so lengths compare across engines. */
export const funnelScale = (funnels: readonly EngineFunnel[]): number =>
  Math.max(0, ...funnels.flatMap((funnel) => funnel.steps.map((entry) => entry.count ?? 0)));
