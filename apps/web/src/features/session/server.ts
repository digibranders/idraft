import 'server-only';

import type { Route } from 'next';
import { cache } from 'react';

import type { HomeScreenProps } from './home-screen';
import { unwrap } from '@/lib/api/client';
import { isSignedOut } from '@/lib/api/query-client';
import { serverApi } from '@/lib/api/server';
import type { Me, MeMembership } from '@/lib/api/types';
import { isInvitationFailure } from '@/lib/routes/home-notices';
import { workspacePath } from '@/lib/routes/paths';

/**
 * `/me` for the request being rendered, or `null` when the session is gone (a stale cookie: the proxy only
 * checks that one is present). Once per request: the page and every layout above it share the answer. Any
 * other failure throws, for the route's error boundary.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const client = await serverApi();
  try {
    return (await unwrap(client.GET('/api/v1/me'))).data;
  } catch (error) {
    if (isSignedOut(error)) return null;
    throw error;
  }
});

/**
 * The memberships a person can open. `/me` still lists one whose workspace is being deleted, and every
 * route of such a workspace answers 404, so it is left out everywhere.
 */
export function openMemberships(me: Me): MeMembership[] {
  return me.memberships.filter((membership) => membership.workspace.status !== 'deleting');
}

/** The membership of the workspace with `slug`, or `null`: not a member, or a workspace being deleted. */
export function membershipOf(me: Me, slug: string): MeMembership | null {
  return openMemberships(me).find((membership) => membership.workspace.slug === slug) ?? null;
}

export type HomeOutcome = { kind: 'redirect'; to: Route } | { kind: 'screen'; props: HomeScreenProps };

/**
 * What `/` does for `me` and its `?invitation=` value: sign in when the session has ended; open the first
 * workspace the person can open; or stay, to say why an invitation could not be accepted (with the way on
 * to that workspace) or that there is no workspace. An `invitation` value that is not a known reason is
 * ignored.
 */
export function homeOutcome(me: Me | null, invitation: string | null): HomeOutcome {
  if (me === null) return { kind: 'redirect', to: '/login' };
  const failure = isInvitationFailure(invitation) ? invitation : null;
  const [first] = openMemberships(me);
  if (failure === null && first !== undefined) return { kind: 'redirect', to: workspacePath(first.workspace.slug) };
  return {
    kind: 'screen',
    props: {
      email: me.user.email,
      invitation: failure,
      workspace: first === undefined ? null : { name: first.workspace.name, slug: first.workspace.slug },
    },
  };
}
