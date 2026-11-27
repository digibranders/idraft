import type { ProjectEngine } from '@/lib/api/types';

/**
 * Whether a platform is of keyword level (Google AI Overview): it is read from the rank checks of a prompt's linked
 * keyword and never asked per prompt, so it takes no prompt text (`max_prompt_chars` 0) and has no price of its own.
 * Run now, cost and schedules leave it out. Whether it has answers to read is `hasSummaryAnswers`.
 */
export const isKeywordLevelEngine = (engine: ProjectEngine['engine']): boolean => engine.max_prompt_chars === 0;

/**
 * Whether a keyword level platform has answers that the prompts summary carries (one for each prompt with a linked
 * keyword that has a valid check). Only the reads of that summary may ask for it: the metrics, competitors, sources and
 * fan-out reads do not hold its answers yet, so they keep leaving it out through `isKeywordLevelEngine`.
 */
export const hasSummaryAnswers = (engine: ProjectEngine['engine']): boolean =>
  isKeywordLevelEngine(engine) && engine.engine_code === 'google_ai_overview';
