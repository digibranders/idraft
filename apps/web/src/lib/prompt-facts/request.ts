import { publicEnv } from '@/lib/env/public';

/** The `include` value that asks the prompt summary for the facts of `docs/ai-visibility/backend-requests-prompts-page.md`. */
export const FACTS_INCLUDE = 'facts';

/** Only the mocks build every fact and every entity cell; the real API builds `latest` and the entity set on request. */
const mocked = (): boolean => publicEnv.NEXT_PUBLIC_API_MOCKING === 'all';

/**
 * Whether the Prompts page and its inspector send `include=facts`. The API builds `latest` (the newest answer with
 * the state of its screenshot), `position`, `recommended`, `sentiment`, `other_brands` and `top_links` for it.
 */
export const factsRequested = (): boolean => true;

/**
 * Whether the Prompts page's own read, which carries the weekly series, also asks for `entities`. With the series the
 * API adds a cell for every tracked entity to every week of every prompt row, which is megabytes, so only the mocks
 * are asked. `usePromptFacts` reads the entities without the series.
 */
export const pageEntitiesRequested = mocked;
