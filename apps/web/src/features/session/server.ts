import 'server-only';

import type { Route } from 'next';

import type { HomeScreenProps } from './home-screen';
import type { Me } from '@/lib/api/types';
import { isIntegrationFailure, isInvitationFailure } from '@/lib/routes/home-notices';
import { SIGN_IN_PATH, workspacePath } from '@/lib/routes/paths';
import { openMemberships } from '@/lib/session/server';

export type HomeOutcome = { kind: 'redirect'; to: Route } | { kind: 'screen'; props: HomeScreenProps };

/**
 * What `/` does for `me` and its `?invitation=` value: sign in when the session has ended; open the first
 * workspace the person can open; or stay, to say why an invitation could not be accepted (with the way on
 * to that workspace) or that there is no workspace. An `invitation` value that is not a known reason is
 * ignored. The same goes for `?integration_error=`, where the Google callback lands when it cannot tell which
 * project the person was connecting for: the page says the connection did not finish.
 */
export function homeOutcome(
  me: Me | null,
  invitation: string | null,
  integrationError: string | null = null,
): HomeOutcome {
  if (me === null) return { kind: 'redirect', to: SIGN_IN_PATH };
  const failure = isInvitationFailure(invitation) ? invitation : null;
  const integrationFailed = isIntegrationFailure(integrationError);
  const [first] = openMemberships(me);
  if (failure === null && !integrationFailed && first !== undefined) {
    return { kind: 'redirect', to: workspacePath(first.workspace.slug) };
  }
  return {
    kind: 'screen',
    props: {
      email: me.user.email,
      invitation: failure,
      workspace: first === undefined ? null : { name: first.workspace.name, slug: first.workspace.slug },
      canCreateWorkspace: me.user.is_platform_operator,
      ...(integrationFailed ? { integrationFailed: true } : {}),
    },
  };
}
