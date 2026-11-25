import type { ProjectEngine } from '@/lib/api/types';

/**
 * Whether a platform is of keyword level (Google AI Overview): it is read from the rank checks of a prompt's linked
 * keyword and never asked per prompt, so it takes no prompt text (`max_prompt_chars` 0), has no price of its own and
 * has no answers behind it yet. Every read that counts answers leaves it out.
 */
export const isKeywordLevelEngine = (engine: ProjectEngine['engine']): boolean => engine.max_prompt_chars === 0;
