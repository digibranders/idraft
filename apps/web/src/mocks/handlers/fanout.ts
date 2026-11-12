import type { HttpHandler } from 'msw';

/** WP-24: answers the ai/fanout-queries route. */
export const fanoutHandlers: HttpHandler[] = [];
