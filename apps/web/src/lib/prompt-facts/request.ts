import { publicEnv } from '@/lib/env/public';

/**
 * BACKEND REQUEST SHAPE: the `include` value that asks the prompt summary for the facts of
 * `docs/ai-visibility/backend-requests-prompts-page.md`. The generated client does not know it yet, so the one cast
 * to its include type lives where the query is built; drop it when `pnpm gen:api` brings the value.
 */
export const FACTS_INCLUDE = 'facts';

/**
 * Whether to send `include=facts`. The API in production refuses a value it does not know (`422`), so it is sent only
 * where the mocks answer it, until the backend ships the include. Flip this when it does.
 */
export const factsRequested = (): boolean => publicEnv.NEXT_PUBLIC_API_MOCKING === 'all';
