import type { HttpHandler } from 'msw';

/** There is no retention route: the Data retention page states the platform's fixed policy and reads nothing. */
export const retentionHandlers: HttpHandler[] = [];
