import 'server-only';

import { cache } from 'react';

import { unwrap } from '@/lib/api/client';
import { isSignedOut } from '@/lib/api/query-client';
import { serverApi } from '@/lib/api/server';
import type { Me, MeMembership } from '@/lib/api/types';

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
