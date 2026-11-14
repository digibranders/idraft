import type { HttpHandler } from 'msw';

/**
 * WP-24: the ai/fanout-queries route stays answered in ./ai-overview.ts, where WP-33 wrote it and tested it, and
 * where WP-24 added `include=topics` and `meta.answers_truncated` in place. Its tests are in ./fanout.test.ts. This
 * array stays empty so that nothing answers the route ahead of it.
 */
export const fanoutHandlers: HttpHandler[] = [];
