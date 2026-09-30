import { setupServer } from 'msw/node';

import { handlers } from '@/mocks/handlers';

/**
 * The MSW server of the tests, with every mock handler as in `all` mode (vitest.msw.ts starts and resets
 * it). A test overrides a route with `server.use(...)`.
 */
export const server = setupServer(...handlers);
