import type { HttpHandler } from 'msw';

/** WP-21: answers the ai/citations, ai/sources/domains and ai/sources/pages routes. */
export const citationHandlers: HttpHandler[] = [];
