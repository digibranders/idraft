import type { HttpHandler } from 'msw';

import { authHandlers } from './auth';
import { entityHandlers } from './entities';
import { costHandlers } from './costs';
import { invitationHandlers } from './invitations';
import { keywordGroupHandlers } from './keyword-groups';
import { keywordImportHandlers } from './keyword-imports';
import { keywordHandlers } from './keywords';
import { meHandlers } from './me';
import { pendingHandlers } from './pending';
import { projectEntityHandlers } from './project-entities';
import { projectHandlers } from './projects';
import { rankHistoryHandlers } from './rank-history';
import { registryHandlers } from './registries';
import { runHandlers } from './runs';
import { scheduleHandlers } from './schedules';
import { taxonomyHandlers } from './taxonomy';
import { termAssignmentHandlers } from './term-assignments';
import { trackedKeywordHandlers } from './tracked-keywords';
import { workspaceHandlers } from './workspaces';

/**
 * The two mock modes (NEXT_PUBLIC_API_MOCKING). `all` answers every API route and needs no backend;
 * `pending` answers only the endpoints the backend has not built and lets everything else through to it.
 */
export type MockMode = 'pending' | 'all';

export const handlers: readonly HttpHandler[] = [
  ...authHandlers,
  ...meHandlers,
  ...invitationHandlers,
  ...workspaceHandlers,
  ...projectHandlers,
  ...entityHandlers,
  ...projectEntityHandlers,
  ...taxonomyHandlers,
  ...registryHandlers,
  ...keywordHandlers,
  ...trackedKeywordHandlers,
  ...rankHistoryHandlers,
  ...keywordGroupHandlers,
  ...termAssignmentHandlers,
  ...keywordImportHandlers,
  ...scheduleHandlers,
  ...runHandlers,
  ...costHandlers,
  ...pendingHandlers,
];

export const handlersFor = (mode: MockMode): HttpHandler[] => [...(mode === 'all' ? handlers : pendingHandlers)];

/**
 * What happens to a request no handler answers. In `all` mode an API request without a handler is an error,
 * so a missing mock is noticed at once; anything else (pages, assets, fonts) passes. In `pending` mode every
 * other request goes to the real API.
 */
export const unhandledStrategy =
  (mode: MockMode) =>
  (request: Request, print: { error: () => void }): void => {
    if (mode === 'all' && new URL(request.url).pathname.startsWith('/api/')) print.error();
  };
