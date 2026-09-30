import type { Client } from 'openapi-fetch';

import { BROWSER_CLIENT_OPTIONS, createTypedClient } from './client';
import type { Problem, Role } from './types';

/**
 * Endpoints the app needs before the API has them, typed by hand from 19-api-specification.md in the shape
 * openapi-typescript generates, so the same client code works once they are generated. The mock layer
 * answers them (src/mocks/handlers/pending.ts). When the backend ships one, pending.test.ts fails: delete
 * its type here and its pending handler, and use the generated path.
 */

/**
 * `GET /api/v1/invitations/preview` (19 section 3.2.2, deferred on the backend): what an invitation token is
 * for, shown above the registration form. Workspace, role and inviter are the document's; the invited
 * address is the one the form needs as well.
 */
export interface InvitationPreview {
  workspace: { name: string; slug: string };
  role: Role;
  /** The address the invitation was sent to; the form fills it in. */
  email: string;
  inviter: { name: string };
}

interface NoParameters {
  query?: never;
  header?: never;
  path?: never;
  cookie?: never;
}
interface ProblemResponse {
  headers: { [name: string]: unknown };
  content: { 'application/problem+json': Problem };
}

export interface PendingPaths {
  '/api/v1/invitations/preview': {
    parameters: NoParameters;
    get: {
      parameters: { query: { token: string }; header?: never; path?: never; cookie?: never };
      requestBody?: never;
      responses: {
        200: { headers: { [name: string]: unknown }; content: { 'application/json': { data: InvitationPreview } } };
        default: ProblemResponse;
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}

/** Every pending path, at runtime. pending.test.ts checks that the list and the type agree. */
export const PENDING_PATHS = ['/api/v1/invitations/preview'] as const satisfies readonly (keyof PendingPaths)[];

/** The browser client for the pending endpoints. */
export const pendingApi: Client<PendingPaths> = createTypedClient<PendingPaths>(BROWSER_CLIENT_OPTIONS);
