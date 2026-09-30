import { HttpResponse, type HttpHandler } from 'msw';

import { MOCK_CREATED_AT, MOCK_INVITED_USER, MOCK_TOKENS, MOCK_WORKSPACE } from '../fixtures';
import { checkBody, mock, problem } from '../respond';
import { joinedCookie, readSession } from '../session';

/**
 * `POST /invitations/accept` (19 section 3.2.2): the signed-in invited person joins the workspace. As in the
 * API, one answer (`invalid_token`) covers an unknown token and one sent to another address, and accepting
 * again answers the same.
 */
export const invitationHandlers: HttpHandler[] = [
  mock('post', '/api/v1/invitations/accept', async ({ request, cookies }) => {
    const session = readSession(cookies);
    if (session?.state !== 'active') return problem(request, 'unauthenticated');
    const body = await request.json();
    const refused = checkBody(request, body, { required: ['token'] });
    if (refused) return refused;
    if (body.token !== MOCK_TOKENS.invitation || session.user.user_id !== MOCK_INVITED_USER.user_id) {
      return problem(request, 'invalid_token');
    }
    const { user_id, name, email, role, project_ids } = MOCK_INVITED_USER;
    return HttpResponse.json(
      {
        data: {
          workspace: {
            workspace_id: MOCK_WORKSPACE.workspace_id,
            name: MOCK_WORKSPACE.name,
            slug: MOCK_WORKSPACE.slug,
          },
          member: {
            user: { user_id, name, email },
            role,
            project_ids: project_ids === null ? null : [...project_ids],
            joined_at: MOCK_CREATED_AT,
            last_active_at: null,
            two_factor_enabled: false,
          },
        },
      },
      { headers: { 'set-cookie': joinedCookie } },
    );
  }),
];
