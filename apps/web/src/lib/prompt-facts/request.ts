/**
 * The `include` value that asks the prompt summary for the facts of `docs/ai-visibility/backend-requests-prompts-page.md`.
 */
export const FACTS_INCLUDE = 'facts';

/**
 * Whether to send `include=facts`. The API knows the value (`LatestAnswer` with the state of its screenshot is what it
 * builds so far; the other facts are left out of its rows, and the columns that read them say not collected yet).
 */
export const factsRequested = (): boolean => true;
