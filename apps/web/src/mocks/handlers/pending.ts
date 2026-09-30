import { http, HttpResponse, type HttpHandler } from 'msw';

import { MOCK_INVITED_USER, MOCK_TOKENS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { checkBody, mswPath, problem } from '../respond';
import type { InvitationPreview, PendingPaths } from '@/lib/api/pending';
import type { Problem } from '@/lib/api/types';

/**
 * Handlers for the endpoints of src/lib/api/pending.ts, which the backend has not built. They run in every
 * mock mode, `pending` included, so the app can use the real API for the rest.
 */

const PREVIEW = '/api/v1/invitations/preview' satisfies keyof PendingPaths;
type PreviewRequest = PendingPaths[typeof PREVIEW]['post']['requestBody']['content']['application/json'];
type PreviewBody = PendingPaths[typeof PREVIEW]['post']['responses'][200]['content']['application/json'];

/** The invitation the fixture token stands for: an editor seat at Digibranders, sent by the owner. */
export const MOCK_INVITATION: InvitationPreview = {
  workspace: { name: MOCK_WORKSPACE.name, slug: MOCK_WORKSPACE.slug },
  role: MOCK_INVITED_USER.role,
  email: MOCK_INVITED_USER.email,
  inviter: { name: mockUser('owner').name },
};

export const pendingHandlers: HttpHandler[] = [
  http.post<never, PreviewRequest, PreviewBody | Problem>(mswPath(PREVIEW), async ({ request }) => {
    const body = await request.json();
    const refused = checkBody(request, body, { required: ['token'] });
    if (refused) return refused;
    return body.token === MOCK_TOKENS.invitation
      ? HttpResponse.json({ data: MOCK_INVITATION })
      : problem(request, 'invalid_token');
  }),
];
