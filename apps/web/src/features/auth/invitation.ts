'use client';

import { useMutation } from '@tanstack/react-query';

import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { homeWithInvitationFailure, type InvitationFailure } from '@/lib/routes/home-notices';
import { workspacePath } from '@/lib/routes/paths';
import { safeNextPath } from '@/lib/security/next-path';

/**
 * The fragment value that carries an invitation token through sign-in. Like every emailed token it stays
 * in the fragment, which no server sees (20-frontend-specification.md section 3.2).
 */
export const INVITATION_PARAM = 'invitation';

/** `url` with the invitation token in its fragment, when there is one. */
export const withInvitation = (url: string, token: string | null | undefined): string =>
  typeof token === 'string' ? `${url}#${INVITATION_PARAM}=${encodeURIComponent(token)}` : url;

const FAILURES: Readonly<Record<string, InvitationFailure>> = {
  invitation_expired: 'expired',
  invalid_token: 'invalid',
  workspace_suspended: 'suspended',
  email_not_verified: 'unverified',
};

/**
 * What happens once the person is signed in: with an invitation token, they join its workspace
 * (`POST /invitations/accept`, 19 section 3.2.2) and it opens; the home page says why when that fails.
 * Without one, the page they were going to opens.
 */
export function useAfterSignIn(next: string | null, invitation: string | null | undefined): () => Promise<void> {
  const accept = useMutation(apiMutation('post', '/api/v1/invitations/accept'));
  return async () => {
    if (typeof invitation !== 'string') {
      hardNavigate(safeNextPath(next));
      return;
    }
    try {
      const { data } = await accept.mutateAsync({ body: { token: invitation } });
      hardNavigate(workspacePath(data.workspace.slug));
    } catch (error) {
      hardNavigate(homeWithInvitationFailure((isApiProblem(error) ? FAILURES[error.code] : undefined) ?? 'failed'));
    }
  };
}
