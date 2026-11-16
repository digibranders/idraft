import { rateChange, type RateChange } from '@/lib/compare/change-model';
import { visibilityOfPrompts } from '@/lib/rates/visibility-model';
import type { StripPrompt } from '@/lib/rates/strip-model';

/**
 * How the AI visibility of a platform moved since the compared window: the figure the strip shows now, minus the same
 * figure over the prompts' `previous` cells (the prompt weighted mean of "named or cited"). Each side counts its own
 * prompts, as the Mention rate chip did, and a prompt without a `previous` has no part in the earlier figure. The test
 * is the interim one of `rateChange`, on the answers of both sides; `null` where either side has no rate to show.
 */
export function visibilityChangeOf(prompts: readonly StripPrompt[], code: string): RateChange | null {
  const earlier: StripPrompt[] = prompts.map((prompt) => ({
    topic_term_ids: prompt.topic_term_ids,
    engines: prompt.engines.flatMap((engine) =>
      engine.engine_code === code && engine.previous != null ? [{ ...engine.previous, engine_code: code }] : [],
    ),
  }));
  return rateChange(visibilityOfPrompts(prompts, code), visibilityOfPrompts(earlier, code), 'mentioned');
}
